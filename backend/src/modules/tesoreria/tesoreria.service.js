const crypto = require('crypto');
const repo   = require('./tesoreria.repository');
const { pool } = require('../../config/db');

const TIPOS_CUENTA     = ['efectivo', 'banco', 'billetera', 'corresponsal', 'otro'];
const CATEGORIAS_MOV   = ['ingreso', 'retiro', 'gasto', 'ajuste'];

// ¿La cuenta representa dinero físico? (espejo en caja + recibe retomas,
// devoluciones y movimientos sin método)
const esCuentaEfectivo = (cuenta) =>
  cuenta.tipo === 'efectivo' || (cuenta.metodos_pago || []).includes('Efectivo');

// ─── Cuentas ──────────────────────────────────────────────────────────────────

const listarCuentas = async (negocioId, sucursalId) => {
  await repo.asegurarCuentaEfectivo(negocioId, sucursalId);
  return repo.findCuentas(negocioId, sucursalId);
};

const _validarCuenta = async ({ negocioId, sucursalId, nombre, tipo, metodos_pago, porcentaje_comision, excluirCuentaId }) => {
  if (nombre !== undefined && !String(nombre || '').trim()) {
    throw { status: 400, message: 'El nombre de la cuenta es obligatorio' };
  }
  if (tipo !== undefined && !TIPOS_CUENTA.includes(tipo)) {
    throw { status: 400, message: `Tipo de cuenta inválido. Usa: ${TIPOS_CUENTA.join(', ')}` };
  }
  if (porcentaje_comision !== undefined && porcentaje_comision !== null) {
    const p = Number(porcentaje_comision);
    if (Number.isNaN(p) || p < 0 || p > 100) {
      throw { status: 400, message: 'La comisión debe estar entre 0 y 100' };
    }
  }
  if (metodos_pago !== undefined && metodos_pago !== null) {
    if (!Array.isArray(metodos_pago)) {
      throw { status: 400, message: 'metodos_pago debe ser una lista' };
    }
    if (metodos_pago.includes('Credito')) {
      throw { status: 400, message: '"Credito" no es dinero recibido: no puede asignarse a una cuenta' };
    }
    // Un método no puede vivir en dos cuentas activas de la misma sucursal
    // (contaría doble en los saldos).
    const ocupados = await repo.metodosOcupados(negocioId, sucursalId, excluirCuentaId);
    for (const m of metodos_pago) {
      const dueno = ocupados.find((o) => o.metodo === m);
      if (dueno) {
        throw {
          status: 409,
          message: `El método "${m}" ya está asignado a la cuenta "${dueno.nombre}". Quítalo de allí primero.`,
        };
      }
    }
  }
};

const crearCuenta = async (negocioId, sucursalId, datos) => {
  const { nombre, tipo = 'otro', metodos_pago = [], porcentaje_comision = 0 } = datos;
  await _validarCuenta({ negocioId, sucursalId, nombre, tipo, metodos_pago, porcentaje_comision });
  try {
    return await repo.crearCuenta({
      negocio_id: negocioId, sucursal_id: sucursalId,
      nombre: String(nombre).trim(), tipo, metodos_pago, porcentaje_comision,
    });
  } catch (err) {
    if (err.code === '23505') {
      throw { status: 409, message: 'Ya existe una cuenta con ese nombre en esta sucursal' };
    }
    throw err;
  }
};

const actualizarCuenta = async (negocioId, sucursalId, cuentaId, datos) => {
  const cuenta = await repo.findCuentaById(cuentaId, negocioId);
  if (!cuenta) throw { status: 404, message: 'Cuenta no encontrada' };
  if (cuenta.sucursal_id !== sucursalId) {
    throw { status: 403, message: 'La cuenta pertenece a otra sucursal' };
  }
  await _validarCuenta({
    negocioId, sucursalId,
    nombre: datos.nombre, tipo: datos.tipo,
    metodos_pago: datos.metodos_pago,
    porcentaje_comision: datos.porcentaje_comision,
    excluirCuentaId: cuentaId,
  });
  try {
    return await repo.actualizarCuenta(cuentaId, negocioId, datos);
  } catch (err) {
    if (err.code === '23505') {
      throw { status: 409, message: 'Ya existe una cuenta con ese nombre en esta sucursal' };
    }
    throw err;
  }
};

// ─── Saldos ───────────────────────────────────────────────────────────────────

const _saldoCuenta = async (cuenta, negocioId) => {
  const ancla = await repo.ultimoArqueo(cuenta.id);
  const delta = await repo.getDeltaCuenta({
    cuentaId:   cuenta.id,
    sucursalId: cuenta.sucursal_id,
    metodos:    cuenta.metodos_pago || [],
    esEfectivo: esCuentaEfectivo(cuenta),
    usarAncla:  true,
    negocioId,
  });
  const base = ancla ? Number(ancla.saldo) : 0;
  return {
    saldo:         base + delta.delta,
    base_arqueo:   base,
    entradas:      delta.entradas,
    salidas:       delta.salidas,
    ultimo_arqueo: ancla ? { fecha: ancla.fecha, saldo: Number(ancla.saldo) } : null,
  };
};

const getSaldos = async (negocioId, sucursalId) => {
  await repo.asegurarCuentaEfectivo(negocioId, sucursalId);
  const cuentas = await repo.findCuentas(negocioId, sucursalId);

  const [saldos, cartera, sinAsignar] = await Promise.all([
    Promise.all(cuentas.map((c) => _saldoCuenta(c, negocioId))),
    repo.getCartera(sucursalId),
    repo.metodosSinAsignar(sucursalId, negocioId),
  ]);

  const cuentasConSaldo = cuentas.map((c, i) => ({
    ...c,
    porcentaje_comision: Number(c.porcentaje_comision),
    ...saldos[i],
  }));

  const totalDisponible = cuentasConSaldo.reduce((s, c) => s + c.saldo, 0);
  const totalCartera    = cartera.creditos.total + cartera.prestamos.total + cartera.domicilios.total;
  const totalGeneral    = totalDisponible + totalCartera;

  const pct = (v) => (totalGeneral > 0 ? (v / totalGeneral) * 100 : 0);

  return {
    cuentas: cuentasConSaldo.map((c) => ({ ...c, porcentaje: pct(c.saldo) })),
    cartera: {
      creditos:   { ...cartera.creditos,   porcentaje: pct(cartera.creditos.total)   },
      prestamos:  { ...cartera.prestamos,  porcentaje: pct(cartera.prestamos.total)  },
      domicilios: { ...cartera.domicilios, porcentaje: pct(cartera.domicilios.total) },
    },
    totales: {
      disponible: totalDisponible,
      cartera:    totalCartera,
      general:    totalGeneral,
    },
    metodos_sin_asignar: sinAsignar,
  };
};

// ─── Extracto ─────────────────────────────────────────────────────────────────

const getExtracto = async (negocioId, sucursalId, cuentaId, { desde, hasta }) => {
  const cuenta = await repo.findCuentaById(cuentaId, negocioId);
  if (!cuenta) throw { status: 404, message: 'Cuenta no encontrada' };
  if (cuenta.sucursal_id !== sucursalId) {
    throw { status: 403, message: 'La cuenta pertenece a otra sucursal' };
  }

  const reFecha = /^\d{4}-\d{2}-\d{2}$/;
  if (!reFecha.test(desde || '') || !reFecha.test(hasta || '')) {
    throw { status: 400, message: 'desde y hasta deben tener formato YYYY-MM-DD' };
  }
  const inicio = `${desde} 00:00:00.000`;
  const fin    = `${hasta} 23:59:59.999`;

  const params = {
    cuentaId:   cuenta.id,
    sucursalId: cuenta.sucursal_id,
    metodos:    cuenta.metodos_pago || [],
    esEfectivo: esCuentaEfectivo(cuenta),
    negocioId,
  };

  const [saldoActual, deltaDesdeInicio, eventos] = await Promise.all([
    _saldoCuenta(cuenta, negocioId),
    // Movimientos desde el inicio del rango hasta ahora → permite retroceder
    // el saldo actual para conocer el saldo al comienzo del extracto.
    repo.getDeltaCuenta({ ...params, inicio, fin: null, usarAncla: false }),
    repo.getEventosCuenta({ ...params, inicio, fin, usarAncla: false }),
  ]);

  const saldoInicial = saldoActual.saldo - deltaDesdeInicio.delta;

  let saldoCorrido = saldoInicial;
  const movimientos = eventos.map((ev) => {
    const valor = Number(ev.valor);
    saldoCorrido += ev.tipo === 'entrada' ? valor : -valor;
    return { ...ev, valor, saldo: saldoCorrido };
  });

  return {
    cuenta: {
      id: cuenta.id, nombre: cuenta.nombre, tipo: cuenta.tipo,
      metodos_pago: cuenta.metodos_pago,
    },
    desde, hasta,
    saldo_inicial: saldoInicial,
    saldo_final:   saldoCorrido,
    movimientos,
  };
};

// ─── Movimientos (retiros, gastos, ingresos, ajustes) ────────────────────────

// Inserta el espejo en la caja abierta de la sucursal para que el cierre de
// caja cuadre. Si no hay caja abierta no pasa nada: el movimiento de
// tesorería sigue siendo la fuente de verdad del saldo.
const _espejarEnCaja = async (client, cuenta, mov, usuarioId, etiqueta) => {
  if (!esCuentaEfectivo(cuenta)) return;
  const caja = await repo.findCajaAbierta(client, cuenta.sucursal_id);
  if (!caja) return;
  await repo.insertarEspejoCaja(client, {
    caja_id:              caja.id,
    usuario_id:           usuarioId,
    tipo:                 mov.tipo === 'entrada' ? 'Ingreso' : 'Egreso',
    concepto:             `[Tesorería] ${etiqueta}`,
    valor:                mov.valor,
    movimiento_dinero_id: mov.id,
  });
};

const registrarMovimiento = async (negocioId, sucursalId, usuarioId, datos) => {
  const { cuenta_id, tipo, categoria, valor, concepto, clave_idempotencia } = datos;

  if (!['entrada', 'salida'].includes(tipo)) {
    throw { status: 400, message: 'tipo debe ser entrada o salida' };
  }
  if (!CATEGORIAS_MOV.includes(categoria)) {
    throw { status: 400, message: `categoria inválida. Usa: ${CATEGORIAS_MOV.join(', ')}` };
  }
  const monto = Number(valor);
  if (!(monto > 0)) throw { status: 400, message: 'El valor debe ser mayor a 0' };

  const cuenta = await repo.findCuentaById(cuenta_id, negocioId);
  if (!cuenta || !cuenta.activa) throw { status: 404, message: 'Cuenta no encontrada o inactiva' };
  if (cuenta.sucursal_id !== sucursalId) {
    throw { status: 403, message: 'La cuenta pertenece a otra sucursal' };
  }

  // Idempotencia: reintento del mismo POST → devolver el movimiento original
  if (clave_idempotencia) {
    const existente = await repo.findMovimientoPorClave(clave_idempotencia);
    if (existente) return { ...existente, repetido: true };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mov = await repo.insertarMovimiento(client, {
      cuenta_id, tipo, categoria, valor: monto,
      concepto, usuario_id: usuarioId, clave_idempotencia,
    });
    const etiqueta = concepto
      ? `${categoria.charAt(0).toUpperCase()}${categoria.slice(1)} — ${concepto}`
      : `${categoria.charAt(0).toUpperCase()}${categoria.slice(1)} (${cuenta.nombre})`;
    await _espejarEnCaja(client, cuenta, mov, usuarioId, etiqueta);
    await client.query('COMMIT');
    return mov;
  } catch (err) {
    await client.query('ROLLBACK');
    // Carrera entre chequeo y UNIQUE: otro request ganó → devolver el original
    if (err.code === '23505' && clave_idempotencia) {
      const existente = await repo.findMovimientoPorClave(clave_idempotencia);
      if (existente) return { ...existente, repetido: true };
    }
    throw err;
  } finally {
    client.release();
  }
};

// ─── Traslados entre cuentas ──────────────────────────────────────────────────

const trasladar = async (negocioId, sucursalId, usuarioId, datos) => {
  const { origen_id, destino_id, valor, concepto, clave_idempotencia } = datos;

  const monto = Number(valor);
  if (!(monto > 0)) throw { status: 400, message: 'El valor debe ser mayor a 0' };
  if (Number(origen_id) === Number(destino_id)) {
    throw { status: 400, message: 'La cuenta origen y destino deben ser distintas' };
  }

  const [origen, destino] = await Promise.all([
    repo.findCuentaById(origen_id, negocioId),
    repo.findCuentaById(destino_id, negocioId),
  ]);
  if (!origen || !origen.activa)  throw { status: 404, message: 'Cuenta origen no encontrada o inactiva' };
  if (!destino || !destino.activa) throw { status: 404, message: 'Cuenta destino no encontrada o inactiva' };
  // El origen debe ser de la sucursal activa; el destino puede ser de otra
  // sucursal del negocio (enviar plata de una sede a otra).
  if (origen.sucursal_id !== sucursalId) {
    throw { status: 403, message: 'La cuenta origen pertenece a otra sucursal' };
  }

  if (clave_idempotencia) {
    const existente = await repo.findMovimientoPorClave(clave_idempotencia);
    if (existente) return { salida: { ...existente, repetido: true } };
  }

  const grupo = crypto.randomUUID();
  const desc  = concepto || `Traslado ${origen.nombre} → ${destino.nombre}`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const salida = await repo.insertarMovimiento(client, {
      cuenta_id: origen.id, tipo: 'salida', categoria: 'traslado',
      valor: monto, concepto: desc, grupo_traslado: grupo,
      usuario_id: usuarioId, clave_idempotencia,
    });
    const entrada = await repo.insertarMovimiento(client, {
      cuenta_id: destino.id, tipo: 'entrada', categoria: 'traslado',
      valor: monto, concepto: desc, grupo_traslado: grupo,
      usuario_id: usuarioId,
    });
    await _espejarEnCaja(client, origen,  salida,  usuarioId, desc);
    await _espejarEnCaja(client, destino, entrada, usuarioId, desc);
    await client.query('COMMIT');
    return { salida, entrada, grupo_traslado: grupo };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505' && clave_idempotencia) {
      const existente = await repo.findMovimientoPorClave(clave_idempotencia);
      if (existente) return { salida: { ...existente, repetido: true } };
    }
    throw err;
  } finally {
    client.release();
  }
};

const toggleMovimiento = (negocioId, movimientoId) =>
  repo.toggleMovimiento(movimientoId, negocioId);

// ─── Arqueos ──────────────────────────────────────────────────────────────────

const arquear = async (negocioId, sucursalId, usuarioId, { cuenta_id, saldo_contado, notas }) => {
  const contado = Number(saldo_contado);
  if (Number.isNaN(contado) || contado < 0) {
    throw { status: 400, message: 'El saldo contado debe ser un número mayor o igual a 0' };
  }
  const cuenta = await repo.findCuentaById(cuenta_id, negocioId);
  if (!cuenta || !cuenta.activa) throw { status: 404, message: 'Cuenta no encontrada o inactiva' };
  if (cuenta.sucursal_id !== sucursalId) {
    throw { status: 403, message: 'La cuenta pertenece a otra sucursal' };
  }

  const { saldo: saldoCalculado } = await _saldoCuenta(cuenta, negocioId);

  return repo.insertarArqueo({
    cuenta_id,
    saldo:           contado,
    saldo_calculado: saldoCalculado,
    diferencia:      contado - saldoCalculado,
    usuario_id:      usuarioId,
    notas,
  });
};

// ─── Resumen consolidado del negocio (todas las sucursales) ──────────────────

const getResumenNegocio = async (negocioId) => {
  const { rows: sucursales } = await pool.query(
    `SELECT id, nombre FROM sucursales WHERE negocio_id = $1 AND activa = true ORDER BY id`,
    [negocioId]
  );

  const porSucursal = await Promise.all(
    sucursales.map(async (s) => {
      const saldos = await getSaldos(negocioId, s.id);
      return { sucursal_id: s.id, sucursal_nombre: s.nombre, ...saldos };
    })
  );

  const totales = porSucursal.reduce((acc, s) => ({
    disponible: acc.disponible + s.totales.disponible,
    cartera:    acc.cartera    + s.totales.cartera,
    general:    acc.general    + s.totales.general,
  }), { disponible: 0, cartera: 0, general: 0 });

  return { sucursales: porSucursal, totales };
};

module.exports = {
  listarCuentas, crearCuenta, actualizarCuenta,
  getSaldos, getExtracto,
  registrarMovimiento, trasladar, toggleMovimiento,
  arquear, getResumenNegocio,
};
