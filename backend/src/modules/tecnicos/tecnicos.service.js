// ─────────────────────────────────────────────────────────────────────────────
// TÉCNICOS EXTERNOS — reglas. Ver migrations/20260918_tecnicos_externos.sql y
// la sección de CLAUDE.md.
//
// El ciclo de un equipo:
//   enviar → (En_tecnico: el trigger lo bloquea) → recibir (Reparado o
//   Sin_reparar) → garantía corriendo → reclamar (otra salida, normalmente sin
//   costo; si el técnico cobra, se aplica como cualquier trabajo)
//
// Todo lo que toca plata o el costo del equipo va en UNA transacción, y todo lo
// que escribe en la cuenta de un técnico pasa detrás del mismo lock
// (`tecnico:<id>`): validar el saldo y escribir el pago no pueden separarse,
// o el segundo clic de un doble clic ve un saldo que ya no existe.
// ─────────────────────────────────────────────────────────────────────────────

const { pool } = require('../../config/db');
const repo   = require('./tecnicos.repository');
const cuenta = require('./tecnicos.cuenta');
const { asignarNumeroDocumento } = require('../../utils/numeracion.util');
const { bloquearOperacion, VENTANA_DUPLICADO_SEG } = require('../../utils/idempotencia.util');
const { puedeVerCostos } = require('../../utils/costos.util');
const { exigirNoEnTecnico } = require('../../utils/serialEnTecnico.util');


const _num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const _dinero = (v) => '$' + Math.round(Number(v || 0)).toLocaleString('es-CO');
const _texto = (v, max = 500) => {
  const t = v == null ? '' : String(v).trim();
  return t ? t.slice(0, max) : null;
};

// ── El candado va PRIMERO ────────────────────────────────────────────────────
//
// La lección de préstamos (FACTURA JUANSHOP, 3 × $100.000.000 en 2,8 s): una
// verificación de "¿ya existe?" que corre ANTES del candado no ve lo que la
// petición gemela todavía no ha commiteado, y las dos pasan. Por eso toda
// operación que toca la cuenta de un técnico toma `tecnico:<id>` como PRIMERA
// cosa de la transacción, antes de leer nada con qué decidir, y uno solo por
// transacción (sin ciclo posible, sin interbloqueo).
//
// Cuando la operación llega con el id de OTRA cosa (un equipo, un pago), el
// técnico se averigua con una lectura SIN bloqueo —ese dato no cambia nunca—,
// se toma el candado, y recién entonces se lee con FOR UPDATE lo que decide.
const _tecnicoDe = async (client, tabla, id, negocioId) => {
  const { rows } = await client.query(
    `SELECT tecnico_id FROM ${tabla} WHERE id = $1 AND negocio_id = $2`, [id, negocioId]);
  return rows[0]?.tecnico_id ?? null;
};

const _transaccion = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

const _validarPlata = (p, etiqueta) => {
  const valor = _num(p?.valor);
  if (valor == null || !Number.isFinite(valor) || valor <= 0) {
    throw { status: 400, message: `${etiqueta}: el valor debe ser mayor a 0` };
  }
  // El método es el que el negocio configuró en Ajustes (puede ser «Bancolombia»):
  // tesorería lo asigna a su cuenta por nombre, igual que un pago de factura.
  const metodo = String(p.metodo || 'Efectivo').trim().slice(0, 40);
  if (!metodo || metodo === 'Credito') throw { status: 400, message: `${etiqueta}: método de pago no válido` };
  return { valor, metodo };
};

// Un no-admin solo opera en SU sucursal: el resolveSucursal ya se la fijó.
// El admin elige cuál con ?sucursal_id; lo que no puede es mezclar.
const _exigirSucursal = (user, sucursalReq, sucursalEquipo) => {
  if (user.rol === 'admin_negocio') return;
  if (Number(sucursalEquipo) !== Number(sucursalReq)) {
    throw { status: 403, message: 'Ese equipo es de otra sucursal' };
  }
};

// ── Costo visible ────────────────────────────────────────────────────────────
// Lo que COBRÓ el técnico no es el costo del producto: es lo que se le debe, y
// quien le paga tiene que verlo. El costo del EQUIPO antes y después sí lo es,
// y pasa por la regla única de costos (`costos_solo_admin`).
const _recortarEquipos = async (user, equipos) => {
  if (await puedeVerCostos(user)) return equipos;
  return equipos.map((e) => ({ ...e, costo_serial_anterior: null, costo_serial_nuevo: null }));
};

// ── Técnicos ─────────────────────────────────────────────────────────────────

const _datosTecnico = (d, previo = {}) => {
  const nombre = _texto(d.nombre ?? previo.nombre, 120);
  if (!nombre) throw { status: 400, message: 'El nombre del técnico es requerido' };
  const dias = d.garantia_dias_default !== undefined ? _num(d.garantia_dias_default) : previo.garantia_dias_default;
  if (dias != null && (!Number.isInteger(dias) || dias < 0 || dias > 3650)) {
    throw { status: 400, message: 'La garantía por defecto debe ser un número de días entre 0 y 3650' };
  }
  const pick = (k, max) => (d[k] !== undefined ? _texto(d[k], max) : (previo[k] ?? null));
  return {
    nombre,
    telefono:     pick('telefono', 40),
    cedula:       pick('cedula', 40),
    especialidad: pick('especialidad', 120),
    notas:        pick('notas', 1000),
    garantia_dias_default: dias ?? null,
    activo: typeof d.activo === 'boolean' ? d.activo : (previo.activo ?? true),
  };
};

// Cada sede tiene su propia cuenta con el técnico. Un supervisor o vendedor
// solo ve la de SU sede; el admin ve el total del negocio y el desglose.
const _alcanceCuenta = (user, sucursalId) => (user.rol === 'admin_negocio' ? null : Number(sucursalId));

const _conNombres = (cuentas, nombres) =>
  cuentas.map((c) => ({ ...c, sucursal_nombre: nombres.get(c.sucursal_id) ?? `Sucursal ${c.sucursal_id}` }));

const listarTecnicos = async (user, sucursalId, { incluirInactivos } = {}) => {
  const negocioId = user.negocio_id;
  const tecnicos = await repo.listarTecnicos(negocioId, { incluirInactivos });
  if (!tecnicos.length) return [];
  const ids = tecnicos.map((t) => t.id);
  const alcance = _alcanceCuenta(user, sucursalId);
  const [equipos, pagos, nombres] = await Promise.all([
    repo.equiposDeTecnicos(negocioId, ids, alcance),
    repo.pagosDeTecnicos(negocioId, ids, alcance),
    repo.nombresSucursales(negocioId),
  ]);
  return tecnicos.map((t) => {
    const { cuentas, total } = cuenta.cuentasPorSucursal(
      equipos.filter((e) => e.tecnico_id === t.id),
      pagos.filter((p) => p.tecnico_id === t.id));
    return { ...t, resumen: total, cuentas: _conNombres(cuentas, nombres) };
  });
};

// Dos «Juan» activos partirían la cuenta del mismo técnico en dos y harían
// dudar de a quién se le dejó qué equipo — el error que esto existe para
// evitar. El índice único lo garantiza aunque lleguen dos clics a la vez; la
// consulta previa solo da el mensaje claro.
const _mensajeDuplicado = (nombre) => ({
  status: 409, code: 'TECNICO_DUPLICADO',
  message: `Ya existe un técnico activo llamado «${nombre}». Usa ese o cámbiale el nombre a uno de los dos.`,
});
const _exigirNombreLibre = async (negocioId, nombre, excluirId = null) => {
  const { rows } = await pool.query(`
    SELECT id FROM tecnicos
    WHERE negocio_id = $1 AND activo AND LOWER(BTRIM(nombre)) = LOWER(BTRIM($2))
      AND ($3::int IS NULL OR id <> $3)
    LIMIT 1
  `, [negocioId, nombre, excluirId]);
  if (rows.length) throw _mensajeDuplicado(nombre);
};
const _traducirDuplicado = (err, nombre) => {
  if (err?.code === '23505') throw _mensajeDuplicado(nombre);
  throw err;
};

const crearTecnico = async (negocioId, d) => {
  const datos = _datosTecnico(d);
  await _exigirNombreLibre(negocioId, datos.nombre);
  return repo.crearTecnico(negocioId, datos).catch((err) => _traducirDuplicado(err, datos.nombre));
};

const actualizarTecnico = async (negocioId, id, d) => {
  const previo = await repo.findTecnico(negocioId, id);
  if (!previo) throw { status: 404, message: 'Técnico no encontrado' };
  const datos = _datosTecnico(d, previo);
  if (datos.activo) await _exigirNombreLibre(negocioId, datos.nombre, previo.id);
  return repo.actualizarTecnico(negocioId, id, datos).catch((err) => _traducirDuplicado(err, datos.nombre));
};

const _extractoLimpio = (equipos, pagos) => cuenta.extracto(equipos, pagos).map((m) => ({
  ...m,
  // El detalle de un cargo lleva el equipo entero; al extracto le basta con
  // saber cuál fue.
  detalle: m.clave.startsWith('c')
    ? { imei: m.detalle.imei, descripcion_equipo: m.detalle.descripcion_equipo,
        trabajo: m.detalle.trabajo, salida_numero: m.detalle.salida_numero }
    : m.detalle,
}));

const detalleTecnico = async (user, id, sucursalId) => {
  const negocioId = user.negocio_id;
  const tecnico = await repo.findTecnico(negocioId, id);
  if (!tecnico) throw { status: 404, message: 'Técnico no encontrado' };
  const alcance = _alcanceCuenta(user, sucursalId);
  const [equipos, pagos, nombres] = await Promise.all([
    repo.equiposDeTecnicos(negocioId, [tecnico.id], alcance),
    repo.pagosDeTecnicos(negocioId, [tecnico.id], alcance),
    repo.nombresSucursales(negocioId),
  ]);
  // Todo se imputa y se extracta POR SEDE: un saldo corrido que mezclara dos
  // cajas no sería el de ninguna.
  const imputacion = cuenta.imputarPorSucursal(equipos, pagos);
  const conPago = equipos.map((e) => ({ ...e, pago: imputacion.get(e.id) || null }));
  const { cuentas, total } = cuenta.cuentasPorSucursal(equipos, pagos);
  return {
    tecnico,
    resumen:  total,
    cuentas:  _conNombres(cuentas, nombres).map((c) => {
      const m = cuenta.deSucursal(equipos, pagos, c.sucursal_id);
      return { ...c, extracto: _extractoLimpio(m.equipos, m.pagos) };
    }),
    equipos:  await _recortarEquipos(user, conPago),
    pagos,
  };
};

// ── Equipos ──────────────────────────────────────────────────────────────────

const listarEquipos = async (user, sucursalId, filtros = {}) => {
  // Un no-admin ve lo de SU sucursal; el admin, la que eligió o todas.
  const suc = user.rol === 'admin_negocio'
    ? (filtros.alcance === 'negocio' ? null : sucursalId)
    : sucursalId;
  const equipos = await repo.listarEquipos(user.negocio_id, {
    sucursalId: suc,
    estado:     filtros.estado || null,
    tecnicoId:  _num(filtros.tecnico_id),
    busqueda:   filtros.busqueda || null,
    ordenServicioId: _num(filtros.orden_servicio_id),
    serialId:   _num(filtros.serial_id),
  });
  return _recortarEquipos(user, equipos);
};

const buscarDisponibles = (negocioId, sucursalId, q) => {
  if (String(q || '').trim().length < 2) return [];
  return repo.buscarSerialesDisponibles(negocioId, sucursalId, q);
};

// El anticipo se registra dentro de la misma transacción del envío: si el envío
// falla, no puede quedar la plata registrada como entregada.
const _insertarPago = async (client, { negocioId, tecnicoId, sucursalId, usuarioId, tipo,
  valor, metodo, salidaId = null, notas = null }) => {
  const { rows } = await client.query(`
    INSERT INTO pagos_tecnico (negocio_id, tecnico_id, sucursal_id, usuario_id, tipo, valor, metodo, salida_id, notas)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `, [negocioId, tecnicoId, sucursalId, usuarioId, tipo, valor, metodo, salidaId, notas]);
  return rows[0];
};

const _crearSalida = async (client, { negocioId, sucursalId, tecnicoId, usuarioId, ordenId = null, notas }) => {
  const { rows: [salida] } = await client.query(`
    INSERT INTO salidas_tecnico (negocio_id, sucursal_id, tecnico_id, usuario_id, orden_servicio_id, notas)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [negocioId, sucursalId, tecnicoId, usuarioId, ordenId, notas]);
  salida.numero = await asignarNumeroDocumento(client, {
    tipo: 'salida_tecnico', docId: salida.id, negocioId,
  });
  return salida;
};

const _insertarEquipo = async (client, e) => {
  const { rows } = await client.query(`
    INSERT INTO equipos_tecnico (salida_id, negocio_id, sucursal_id, tecnico_id, serial_id, imei,
                                 descripcion_equipo, trabajo, origen, reclamo_de_id, orden_servicio_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *
  `, [e.salidaId, e.negocioId, e.sucursalId, e.tecnicoId, e.serialId, e.imei,
      e.descripcion, e.trabajo, e.origen, e.reclamoDeId ?? null, e.ordenId ?? null]);
  return rows[0];
};

// Un equipo nuestro, disponible, a punto de salir. El trigger impediría después
// venderlo; esto impide mandarlo si YA no está disponible.
const _validarSerialDisponible = async (client, negocioId, serialId, sucursalId) => {
  const s = await repo.serialParaEnviar(client, negocioId, serialId);
  if (!s) throw { status: 404, message: 'El equipo no existe en este negocio' };
  if (Number(s.sucursal_id) !== Number(sucursalId)) {
    throw { status: 409, message: `El equipo ${s.imei} no está en esta sucursal` };
  }
  if (s.vendido) {
    throw {
      status: 409, code: 'EQUIPO_VENDIDO',
      message: `El equipo ${s.imei} ya está vendido. Si el cliente lo trajo, ábrele una orden de servicio y envíalo al técnico desde ella.`,
    };
  }
  if (s.prestado) throw { status: 409, message: `El equipo ${s.imei} está prestado` };
  // El índice único ya lo impide, pero con un mensaje que no dice nada.
  await exigirNoEnTecnico(client, s.id, s.imei);
  if (await repo.enRemisionActiva(client, s.id)) {
    throw { status: 409, message: `El equipo ${s.imei} va en camino en una remisión de la red interna` };
  }
  return s;
};

/**
 * Mandar uno o varios equipos del inventario a un técnico.
 * @param d { tecnico_id, equipos: [{ serial_id, trabajo }], notas, anticipo?: { valor, metodo } }
 */
const enviar = async (user, sucursalId, d) => {
  const negocioId = user.negocio_id;
  const lista = Array.isArray(d.equipos) ? d.equipos : [];
  if (!lista.length) throw { status: 400, message: 'Elige al menos un equipo' };
  if (lista.length > 50) throw { status: 400, message: 'Máximo 50 equipos por salida' };
  const ids = lista.map((e) => Number(e.serial_id));
  if (ids.some((x) => !Number.isInteger(x) || x <= 0)) throw { status: 400, message: 'Equipo no válido' };
  if (new Set(ids).size !== ids.length) throw { status: 400, message: 'Un equipo está repetido en la salida' };
  for (const e of lista) {
    if (!_texto(e.trabajo)) throw { status: 400, message: 'Escribe qué trabajo se le va a hacer a cada equipo' };
  }
  const anticipo = d.anticipo && _num(d.anticipo.valor) ? _validarPlata(d.anticipo, 'Anticipo') : null;

  return _transaccion(async (client) => {
    const tecnico = await repo.findTecnico(negocioId, d.tecnico_id, client);
    if (!tecnico || !tecnico.activo) throw { status: 404, message: 'Técnico no encontrado o inactivo' };
    await bloquearOperacion(client, `tecnico:${tecnico.id}`);

    const salida = await _crearSalida(client, {
      negocioId, sucursalId, tecnicoId: tecnico.id, usuarioId: user.id, notas: _texto(d.notas),
    });
    const equipos = [];
    for (const item of lista) {
      const s = await _validarSerialDisponible(client, negocioId, item.serial_id, sucursalId);
      equipos.push(await _insertarEquipo(client, {
        salidaId: salida.id, negocioId, sucursalId, tecnicoId: tecnico.id,
        serialId: s.id, imei: s.imei, descripcion: s.producto_nombre,
        trabajo: _texto(item.trabajo), origen: 'inventario',
      }));
    }
    let pago = null;
    if (anticipo) {
      pago = await _insertarPago(client, {
        negocioId, tecnicoId: tecnico.id, sucursalId, usuarioId: user.id,
        tipo: 'Anticipo', ...anticipo, salidaId: salida.id, notas: 'Anticipo al entregar',
      });
    }
    return { salida, equipos, anticipo: pago, tecnico };
  });
};

/**
 * Desde la orden de servicio de un CLIENTE: su equipo sale al técnico. Si el
 * IMEI es de un equipo que vendimos, queda ligado (y bloqueado); si no, es un
 * equipo del cliente sin fila en nuestro inventario.
 */
const enviarDesdeOrden = async (user, ordenId, d) => {
  const negocioId = user.negocio_id;
  const trabajo = _texto(d.trabajo);
  if (!trabajo) throw { status: 400, message: 'Escribe qué trabajo se le va a hacer' };
  const anticipo = d.anticipo && _num(d.anticipo.valor) ? _validarPlata(d.anticipo, 'Anticipo') : null;

  return _transaccion(async (client) => {
    const tecnico = await repo.findTecnico(negocioId, d.tecnico_id, client);
    if (!tecnico || !tecnico.activo) throw { status: 404, message: 'Técnico no encontrado o inactivo' };
    await bloquearOperacion(client, `tecnico:${tecnico.id}`);

    const { rows: [orden] } = await client.query(`
      SELECT id, numero, sucursal_id, estado, equipo_serial, equipo_nombre, equipo_tipo, cliente_nombre
      FROM ordenes_servicio WHERE id = $1 AND negocio_id = $2
      FOR UPDATE
    `, [ordenId, negocioId]);
    if (!orden) throw { status: 404, message: 'Orden no encontrada' };
    if (user.rol !== 'admin_negocio' && Number(orden.sucursal_id) !== Number(user.sucursal_id)) {
      throw { status: 403, message: 'Esa orden es de otra sucursal' };
    }
    if (!['Recibido', 'En_reparacion', 'Garantia'].includes(orden.estado)) {
      throw { status: 409, message: 'Solo se envía al técnico una orden recibida, en reparación o en garantía' };
    }
    const { rows: abierto } = await client.query(
      `SELECT 1 FROM equipos_tecnico WHERE orden_servicio_id = $1 AND estado = 'En_tecnico' LIMIT 1`, [orden.id]);
    if (abierto.length) throw { status: 409, message: 'El equipo de esta orden ya está donde un técnico' };

    const imei = _texto(orden.equipo_serial, 60);
    const vendido = imei ? await repo.serialVendidoPorImei(client, negocioId, imei) : null;

    const salida = await _crearSalida(client, {
      negocioId, sucursalId: orden.sucursal_id, tecnicoId: tecnico.id, usuarioId: user.id,
      ordenId: orden.id, notas: _texto(d.notas),
    });
    const descripcion = [orden.equipo_tipo, orden.equipo_nombre].filter(Boolean).join(' ')
      || vendido?.producto_nombre || 'Equipo del cliente';
    const equipo = await _insertarEquipo(client, {
      salidaId: salida.id, negocioId, sucursalId: orden.sucursal_id, tecnicoId: tecnico.id,
      serialId: vendido?.id ?? null, imei, descripcion, trabajo,
      origen: vendido ? 'vendido' : 'cliente', ordenId: orden.id,
    });
    if (orden.estado === 'Recibido') {
      await client.query(`UPDATE ordenes_servicio SET estado = 'En_reparacion' WHERE id = $1`, [orden.id]);
    }
    let pago = null;
    if (anticipo) {
      pago = await _insertarPago(client, {
        negocioId, tecnicoId: tecnico.id, sucursalId: orden.sucursal_id, usuarioId: user.id,
        tipo: 'Anticipo', ...anticipo, salidaId: salida.id, notas: 'Anticipo al entregar',
      });
    }
    return { salida, equipos: [equipo], anticipo: pago, tecnico };
  });
};

/**
 * Reclamar la garantía de un trabajo: el MISMO equipo vuelve al MISMO técnico,
 * sin costo, ligado al trabajo que falló. Una garantía vencida no se reclama:
 * eso es un trabajo nuevo, y se manda como tal.
 */
const reclamarGarantia = async (user, sucursalId, equipoId, d) => {
  const negocioId = user.negocio_id;
  const trabajo = _texto(d.trabajo) || 'Reclamo de garantía';
  return _transaccion(async (client) => {
    const tecnicoId = await _tecnicoDe(client, 'equipos_tecnico', equipoId, negocioId);
    if (!tecnicoId) throw { status: 404, message: 'Trabajo no encontrado' };
    await bloquearOperacion(client, `tecnico:${tecnicoId}`);
    const original = await repo.findEquipo(client, negocioId, equipoId, { bloquear: true });
    if (!original) throw { status: 404, message: 'Trabajo no encontrado' };
    _exigirSucursal(user, sucursalId, original.sucursal_id);
    if (original.estado !== 'Reparado') throw { status: 409, message: 'Solo se reclama la garantía de un equipo que volvió reparado' };
    if (!original.en_garantia) {
      throw {
        status: 409, code: 'GARANTIA_VENCIDA',
        message: original.garantia_hasta
          ? `La garantía de este trabajo venció el ${original.garantia_hasta}. Mándalo como un trabajo nuevo.`
          : 'Este trabajo no tiene garantía registrada. Mándalo como un trabajo nuevo.',
      };
    }
    const { rows: ya } = await client.query(
      `SELECT 1 FROM equipos_tecnico WHERE reclamo_de_id = $1 AND estado = 'En_tecnico' LIMIT 1`, [original.id]);
    if (ya.length) throw { status: 409, message: 'Ya hay un reclamo abierto de este trabajo' };

    const tecnico = await repo.findTecnico(negocioId, original.tecnico_id, client);

    // El origen se vuelve a mirar: el equipo pudo venderse desde que volvió.
    let origen = original.origen;
    if (original.serial_id) {
      const { rows: [s] } = await client.query(
        'SELECT vendido, prestado FROM seriales WHERE id = $1 FOR UPDATE', [original.serial_id]);
      if (s?.prestado) throw { status: 409, message: 'El equipo está prestado; recíbelo antes de mandarlo al técnico' };
      if (s) origen = s.vendido ? 'vendido' : 'inventario';
      if (origen === 'inventario' && await repo.enRemisionActiva(client, original.serial_id)) {
        throw { status: 409, message: 'El equipo va en camino en una remisión de la red interna' };
      }
    }

    const salida = await _crearSalida(client, {
      negocioId, sucursalId: original.sucursal_id, tecnicoId: tecnico.id, usuarioId: user.id,
      ordenId: original.orden_servicio_id, notas: _texto(d.notas) || `Reclamo de garantía del trabajo de la salida #${original.salida_numero}`,
    });
    const equipo = await _insertarEquipo(client, {
      salidaId: salida.id, negocioId, sucursalId: original.sucursal_id, tecnicoId: tecnico.id,
      serialId: original.serial_id, imei: original.imei, descripcion: original.descripcion_equipo,
      trabajo, origen, reclamoDeId: original.id, ordenId: original.orden_servicio_id,
    });
    return { salida, equipos: [equipo], tecnico };
  });
};

// ── Recibir ──────────────────────────────────────────────────────────────────

// A dónde va lo que cobró el técnico. Ver `costo_aplicado_a` en la migración.
const _aplicarCosto = async (client, eq, costo, destinoPedido) => {
  if (costo <= 0) return { aplicado: null };

  if (eq.origen === 'inventario') {
    if (await repo.esConsignado(client, eq.serial_id, eq.sucursal_id)) {
      // Consignado en un local: su costo es el valor de la remisión y
      // costo_compra es de la bodega. Se suma sobre el valor interno en los
      // reportes (utils/costoRed.util), sin tocar la verdad de la bodega.
      return { aplicado: 'valor_interno' };
    }
    const { rows: [s] } = await client.query(`
      UPDATE seriales s
      SET costo_compra = COALESCE(s.costo_compra, 0) + $2
      FROM (SELECT id, costo_compra AS anterior FROM seriales WHERE id = $1) prev
      WHERE s.id = prev.id
      RETURNING prev.anterior, s.costo_compra AS nuevo
    `, [eq.serial_id, costo]);
    if (!s) throw { status: 409, message: 'El equipo ya no existe en el inventario' };
    return { aplicado: 'costo_compra', anterior: s.anterior, nuevo: s.nuevo };
  }

  // Equipo vendido: el costo NO sube (la venta ya se reportó). Se carga a la
  // venta solo si una persona lo decidió; si no, va a la orden del cliente.
  if (eq.origen === 'vendido' && destinoPedido === 'venta') {
    const factura = await repo.ultimaFacturaDeImei(client, eq.negocio_id, eq.imei);
    if (!factura) throw { status: 409, message: 'No se encontró la venta de este equipo para cargarle el costo' };
    return { aplicado: 'venta', facturaId: factura.id };
  }
  if (eq.orden_servicio_id) {
    const { rows: [o] } = await client.query(
      'SELECT estado FROM ordenes_servicio WHERE id = $1 FOR UPDATE', [eq.orden_servicio_id]);
    // En garantía la orden lleva su costo aparte (costo_garantia); en los demás
    // estados es el de la reparación. Se SUMA: el técnico puede ser uno de
    // varios gastos de la misma orden.
    const col = o?.estado === 'Garantia' ? 'costo_garantia' : 'costo_real';
    await client.query(
      `UPDATE ordenes_servicio SET ${col} = COALESCE(${col}, 0) + $2 WHERE id = $1`,
      [eq.orden_servicio_id, costo]);
    return { aplicado: 'orden' };
  }
  if (eq.origen === 'vendido') {
    throw { status: 400, message: 'Indica si el costo se carga a la venta del equipo' };
  }
  return { aplicado: null };
};

/**
 * El equipo vuelve del técnico.
 * @param d {
 *   resultado: 'Reparado' | 'Sin_reparar',
 *   costo,              // lo que cobró (reparación o diagnóstico); 0 en un reclamo
 *   garantia_dias,      // solo Reparado; por defecto el del técnico
 *   precio_venta,       // opcional: nuevo precio del equipo (solo inventario)
 *   cargar_a,           // 'venta' | 'orden' — solo equipo ya vendido
 *   notas,
 *   pago?:       { valor, metodo }   // pagarle ahora (lo que no, queda a crédito)
 *   devolucion?: { valor, metodo }   // el técnico devuelve plata del anticipo
 * }
 */
const recibir = async (user, sucursalId, equipoId, d, { puedePagar = false } = {}) => {
  const negocioId = user.negocio_id;
  const resultado = d.resultado;
  if (!['Reparado', 'Sin_reparar'].includes(resultado)) {
    throw { status: 400, message: 'Indica si el equipo volvió reparado o sin reparar' };
  }
  let costo = _num(d.costo) ?? 0;
  if (!Number.isFinite(costo) || costo < 0) throw { status: 400, message: 'El costo no puede ser negativo' };
  const pago = d.pago && _num(d.pago.valor) ? _validarPlata(d.pago, 'Pago') : null;
  const devolucion = d.devolucion && _num(d.devolucion.valor) ? _validarPlata(d.devolucion, 'Devolución') : null;
  if ((pago || devolucion) && !puedePagar) {
    throw { status: 403, message: 'No tienes permiso para registrar pagos a técnicos' };
  }

  return _transaccion(async (client) => {
    const tecnicoId = await _tecnicoDe(client, 'equipos_tecnico', equipoId, negocioId);
    if (!tecnicoId) throw { status: 404, message: 'Equipo no encontrado' };
    await bloquearOperacion(client, `tecnico:${tecnicoId}`);
    const eq = await repo.findEquipo(client, negocioId, equipoId, { bloquear: true });
    if (!eq) throw { status: 404, message: 'Equipo no encontrado' };
    _exigirSucursal(user, sucursalId, eq.sucursal_id);
    // El doble clic en «Recibir» termina aquí: la segunda petición esperó el
    // candado, lee el equipo ya recibido y no vuelve a sumar el costo ni a
    // registrar el pago.
    if (eq.estado !== 'En_tecnico') throw { status: 409, message: 'Este equipo ya se recibió' };
    const tecnico = await repo.findTecnico(negocioId, eq.tecnico_id, client);

    // Un reclamo de garantía normalmente vuelve en $0, pero si el técnico cobró
    // algo (la falla nueva no la cubría su garantía, o cobró un repuesto) ese
    // costo es real y se aplica igual que en cualquier trabajo: ignorarlo sería
    // dejar al técnico sin cobrar y al equipo con un costo que no es el suyo.
    // El reclamo sigue ligado al trabajo original para la trazabilidad.
    const reclamoGratis = !!eq.reclamo_de_id && costo === 0;

    let garantiaDias = null;
    if (resultado === 'Reparado' && !reclamoGratis) {
      garantiaDias = d.garantia_dias !== undefined && d.garantia_dias !== ''
        ? _num(d.garantia_dias) : tecnico.garantia_dias_default;
      if (garantiaDias != null && (!Number.isInteger(garantiaDias) || garantiaDias < 0 || garantiaDias > 3650)) {
        throw { status: 400, message: 'La garantía debe ser un número de días entre 0 y 3650' };
      }
    }
    // Un reclamo reparado SIN costo hereda lo que quedaba de la garantía
    // original: la garantía la da el trabajo, no cada visita. Si el técnico
    // cobró, es un trabajo pagado y lleva su propia garantía (arriba).
    if (resultado === 'Reparado' && reclamoGratis) {
      const { rows: [o] } = await client.query(`
        SELECT GREATEST(((fecha_regreso::date + garantia_dias) - (NOW() AT TIME ZONE 'America/Bogota')::date), 0) AS resto
        FROM equipos_tecnico WHERE id = $1
      `, [eq.reclamo_de_id]);
      garantiaDias = o?.resto != null ? Number(o.resto) : null;
    }

    const destino = await _aplicarCosto(client, eq, costo, d.cargar_a);

    // Precio de venta: lo decide una persona. Vacío = no se toca.
    let precioAnterior = null, precioNuevo = null;
    const precioPedido = _num(d.precio_venta);
    if (precioPedido != null) {
      if (eq.origen !== 'inventario') throw { status: 400, message: 'Solo se cambia el precio de un equipo del inventario' };
      if (!Number.isFinite(precioPedido) || precioPedido < 0) throw { status: 400, message: 'El precio no puede ser negativo' };
      const { rows: [p] } = await client.query(`
        UPDATE seriales s SET precio = $2
        FROM (SELECT id, precio AS anterior FROM seriales WHERE id = $1) prev
        WHERE s.id = prev.id
        RETURNING prev.anterior
      `, [eq.serial_id, precioPedido]);
      precioAnterior = p?.anterior ?? null;
      precioNuevo = precioPedido;
    }

    const { rows: [actualizado] } = await client.query(`
      UPDATE equipos_tecnico
      SET estado = $2, fecha_regreso = NOW(), costo = $3, garantia_dias = $4,
          costo_aplicado_a = $5, costo_serial_anterior = $6, costo_serial_nuevo = $7,
          factura_cargo_id = $8, precio_anterior = $9, precio_nuevo = $10,
          notas_regreso = $11, usuario_regreso_id = $12
      WHERE id = $1
      RETURNING *
    `, [eq.id, resultado, costo, garantiaDias, destino.aplicado,
        destino.anterior ?? null, destino.nuevo ?? null, destino.facturaId ?? null,
        precioAnterior, precioNuevo, _texto(d.notas), user.id]);

    // Plata en el mismo momento. Pago ≤ deuda; devolución ≤ saldo a favor —
    // medidos DESPUÉS de este cargo, que ya quedó escrito.
    const pagos = [];
    // Sin la ventana de gemelos: aquí al pago lo protege el estado del EQUIPO
    // (arriba), y la ventana haría daño — recibir los dos equipos de una misma
    // salida pagando $50.000 por cada uno parecería "el mismo pago dos veces".
    if (pago) pagos.push(await _registrarPagoEnTx(client, {
      user, negocioId, tecnicoId: eq.tecnico_id, sucursalId: eq.sucursal_id,
      tipo: 'Pago', ...pago, salidaId: eq.salida_id, notas: 'Pago al recibir', sinVentana: true,
    }));
    if (devolucion) pagos.push(await _registrarPagoEnTx(client, {
      user, negocioId, tecnicoId: eq.tecnico_id, sucursalId: eq.sucursal_id,
      tipo: 'Devolucion', ...devolucion, salidaId: eq.salida_id, notas: 'Devolución del anticipo', sinVentana: true,
    }));

    const materia = await repo.materiaCuenta(client, negocioId, eq.tecnico_id, eq.sucursal_id);
    return { equipo: actualizado, pagos, resumen: cuenta.resumen(materia.equipos, materia.pagos) };
  });
};

/** Anular un envío hecho por error, mientras el equipo sigue afuera. */
const anularEquipo = async (user, sucursalId, equipoId, motivo) => {
  const m = _texto(motivo, 300);
  if (!m) throw { status: 400, message: 'Escribe el motivo de la anulación' };
  return _transaccion(async (client) => {
    const tecnicoId = await _tecnicoDe(client, 'equipos_tecnico', equipoId, user.negocio_id);
    if (!tecnicoId) throw { status: 404, message: 'Equipo no encontrado' };
    await bloquearOperacion(client, `tecnico:${tecnicoId}`);
    const eq = await repo.findEquipo(client, user.negocio_id, equipoId, { bloquear: true });
    if (!eq) throw { status: 404, message: 'Equipo no encontrado' };
    _exigirSucursal(user, sucursalId, eq.sucursal_id);
    if (eq.estado !== 'En_tecnico') {
      throw { status: 409, message: 'Solo se anula un envío mientras el equipo sigue donde el técnico' };
    }
    const { rows: [r] } = await client.query(`
      UPDATE equipos_tecnico SET estado = 'Anulado', anulado_motivo = $2,
             fecha_regreso = NOW(), usuario_regreso_id = $3
      WHERE id = $1 RETURNING *
    `, [eq.id, m, user.id]);
    return r;
  });
};

// ── Pagos ────────────────────────────────────────────────────────────────────

// PRECONDICIÓN: quien llama ya tomó `bloquearOperacion(client, 'tecnico:<id>')`.
// Sin el candado, la ventana de gemelos no ve el pago sin commitear de la
// petición hermana y las dos pasan (es exactamente lo que pasó en préstamos).
const _registrarPagoEnTx = async (client, { user, negocioId, tecnicoId, sucursalId, tipo,
  valor, metodo, salidaId = null, notas = null, sucursalNombre = null, sinVentana = false }) => {
  // Mismo pago, mismo técnico, MISMA SEDE, mismo valor en la ventana = el
  // formulario se envió dos veces, no un segundo pago. La sede cuenta: en
  // «Pagar todo» dos sedes pueden pagar el mismo valor por el mismo método.
  if (!sinVentana) {
    const { rows: gemelo } = await client.query(`
      SELECT id FROM pagos_tecnico
      WHERE tecnico_id = $1 AND sucursal_id = $2 AND tipo = $3 AND valor = $4 AND metodo = $5
        AND NOT anulado
        AND COALESCE(salida_id, -1) = COALESCE($6, -1)
        AND fecha > NOW() - ($7 || ' seconds')::interval
      LIMIT 1
    `, [tecnicoId, sucursalId, tipo, valor, metodo, salidaId, String(VENTANA_DUPLICADO_SEG)]);
    if (gemelo.length) {
      throw {
        status: 409, code: 'PAGO_DUPLICADO',
        message: 'Este mismo pago ya se registró hace un momento. Revisa la cuenta del técnico antes de volver a intentarlo.',
      };
    }
  }

  // Se valida contra la cuenta de ESTA sede: es su caja la que paga, así que
  // solo puede pagar lo que ella debe y recibir lo que ella tiene a favor.
  const materia = await repo.materiaCuenta(client, negocioId, tecnicoId, sucursalId);
  const { deuda, saldo_a_favor: aFavor } = cuenta.resumen(materia.equipos, materia.pagos);
  const sede = sucursalNombre ? ` en ${sucursalNombre}` : ' en esta sucursal';
  if (tipo === 'Pago' && valor > deuda + 0.005) {
    throw {
      status: 400, code: 'PAGO_MAYOR_A_DEUDA',
      message: deuda > 0
        ? `Al técnico se le deben ${_dinero(deuda)}${sede}. Si le vas a dar más plata, regístrala como anticipo.`
        : `Al técnico no se le debe nada${sede}. Si le vas a dar plata, regístrala como anticipo.`,
    };
  }
  if (tipo === 'Devolucion' && valor > aFavor + 0.005) {
    throw {
      status: 400, code: 'DEVOLUCION_MAYOR_A_FAVOR',
      message: aFavor > 0
        ? `El técnico solo tiene ${_dinero(aFavor)} a favor${sede} para devolver.`
        : `El técnico no tiene plata${sede} para devolver.`,
    };
  }
  if (salidaId) {
    const { rows } = await client.query(
      'SELECT 1 FROM salidas_tecnico WHERE id = $1 AND tecnico_id = $2 AND negocio_id = $3 AND sucursal_id = $4',
      [salidaId, tecnicoId, negocioId, sucursalId]);
    if (!rows.length) throw { status: 400, message: 'La salida no es de este técnico ni de esta sucursal' };
  }
  return _insertarPago(client, {
    negocioId, tecnicoId, sucursalId, usuarioId: user.id, tipo, valor, metodo, salidaId, notas,
  });
};

// ¿De qué caja sale (o a cuál entra)? Un supervisor o vendedor: siempre la de
// SU sede, pase lo que pase en el cuerpo. El admin tiene que DECIRLO: sin eso
// caía en la sucursal resuelta por defecto (la primera activa) y pagaba desde
// una caja que nadie eligió.
const _sucursalDelPago = async (client, user, sucursalReq, sucursalPedida) => {
  if (user.rol !== 'admin_negocio') return Number(sucursalReq);
  const id = _num(sucursalPedida);
  if (!id) throw { status: 400, code: 'SUCURSAL_REQUERIDA', message: 'Elige de qué sucursal sale el pago' };
  const { rows } = await client.query(
    'SELECT id FROM sucursales WHERE id = $1 AND negocio_id = $2', [id, user.negocio_id]);
  if (!rows.length) throw { status: 400, message: 'Esa sucursal no es de este negocio' };
  return id;
};

const registrarPago = async (user, sucursalId, tecnicoId, d) => {
  const tipo = d.tipo;
  if (!['Anticipo', 'Pago', 'Devolucion'].includes(tipo)) throw { status: 400, message: 'Tipo de pago no válido' };
  const { valor, metodo } = _validarPlata(d, tipo === 'Devolucion' ? 'Devolución' : tipo);
  return _transaccion(async (client) => {
    const tecnico = await repo.findTecnico(user.negocio_id, tecnicoId, client);
    if (!tecnico) throw { status: 404, message: 'Técnico no encontrado' };
    const suc = await _sucursalDelPago(client, user, sucursalId, d.sucursal_id);
    await bloquearOperacion(client, `tecnico:${tecnico.id}`);
    const pago = await _registrarPagoEnTx(client, {
      user, negocioId: user.negocio_id, tecnicoId: tecnico.id, sucursalId: suc,
      tipo, valor, metodo, salidaId: _num(d.salida_id), notas: _texto(d.notas, 300),
    });
    const materia = await repo.materiaCuenta(client, user.negocio_id, tecnico.id, suc);
    return { pago, resumen: cuenta.resumen(materia.equipos, materia.pagos) };
  });
};

/**
 * Pagarle al técnico lo de VARIAS sedes en un solo paso (solo el admin: es el
 * único que ve más de una). No hay "un pago total": hay un pago por sede, cada
 * uno de SU caja y validado contra SU deuda, todos en la misma transacción —o
 * entran todos o ninguno—. Así cada caja muestra exactamente lo suyo.
 * @param d { pagos: [{ sucursal_id, valor, metodo }], notas }
 */
const pagarPorSucursales = async (user, tecnicoId, d) => {
  if (user.rol !== 'admin_negocio') {
    throw { status: 403, message: 'Solo el administrador paga varias sucursales a la vez' };
  }
  const lista = (Array.isArray(d.pagos) ? d.pagos : []).filter((p) => _num(p?.valor) > 0);
  if (!lista.length) throw { status: 400, message: 'Indica cuánto paga al menos una sucursal' };
  const sucs = lista.map((p) => Number(p.sucursal_id));
  if (new Set(sucs).size !== sucs.length) throw { status: 400, message: 'Una sucursal está repetida' };
  const plata = lista.map((p) => ({ sucursal_id: p.sucursal_id, ..._validarPlata(p, 'Pago') }));

  return _transaccion(async (client) => {
    const tecnico = await repo.findTecnico(user.negocio_id, tecnicoId, client);
    if (!tecnico) throw { status: 404, message: 'Técnico no encontrado' };
    await bloquearOperacion(client, `tecnico:${tecnico.id}`);
    const nombres = await repo.nombresSucursales(user.negocio_id);
    const pagos = [];
    for (const p of plata) {
      const suc = await _sucursalDelPago(client, user, null, p.sucursal_id);
      pagos.push(await _registrarPagoEnTx(client, {
        user, negocioId: user.negocio_id, tecnicoId: tecnico.id, sucursalId: suc,
        tipo: 'Pago', valor: p.valor, metodo: p.metodo,
        notas: _texto(d.notas, 300) || 'Pago de varias sucursales',
        sucursalNombre: nombres.get(suc),
      }));
    }
    return { pagos };
  });
};

// Se anula, nunca se borra: el pago deja de contar para el saldo, la caja y la
// tesorería, pero sigue en el estado de cuenta con su razón.
const anularPago = async (user, pagoId, motivo, sucursalId = null) => {
  const m = _texto(motivo, 300);
  if (!m) throw { status: 400, message: 'Escribe el motivo de la anulación' };
  return _transaccion(async (client) => {
    const tecnicoId = await _tecnicoDe(client, 'pagos_tecnico', pagoId, user.negocio_id);
    if (!tecnicoId) throw { status: 404, message: 'Pago no encontrado' };
    await bloquearOperacion(client, `tecnico:${tecnicoId}`);
    const { rows: [p] } = await client.query(
      'SELECT * FROM pagos_tecnico WHERE id = $1 AND negocio_id = $2 FOR UPDATE', [pagoId, user.negocio_id]);
    if (!p) throw { status: 404, message: 'Pago no encontrado' };
    if (p.anulado) throw { status: 409, message: 'Ese pago ya estaba anulado' };
    // Anular un pago revierte la caja de SU sede: fuera del admin, solo se
    // anula lo de la propia.
    if (user.rol !== 'admin_negocio' && Number(p.sucursal_id) !== Number(sucursalId)) {
      throw { status: 403, message: 'Ese pago es de otra sucursal' };
    }
    const { rows: [r] } = await client.query(`
      UPDATE pagos_tecnico
      SET anulado = TRUE, anulado_motivo = $2, anulado_por = $3, anulado_en = NOW()
      WHERE id = $1 RETURNING *
    `, [p.id, m, user.id]);
    return r;
  });
};

const resumenPeriodo = (user, sucursalId, { desde, hasta, alcance }) => {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(desde || '') || !re.test(hasta || '')) throw { status: 400, message: 'Rango de fechas no válido' };
  const suc = user.rol === 'admin_negocio' && alcance === 'negocio' ? null : sucursalId;
  return repo.resumenPeriodo(user.negocio_id, suc, desde, hasta);
};

module.exports = {
  listarTecnicos, crearTecnico, actualizarTecnico, detalleTecnico,
  listarEquipos, buscarDisponibles,
  enviar, enviarDesdeOrden, reclamarGarantia, recibir, anularEquipo,
  registrarPago, pagarPorSucursales, anularPago, resumenPeriodo,
};
