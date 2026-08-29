const { pool } = require('../../config/db');
const repo = require('./acreedores.repository');

const { getConfigOrdenes } = require('../../middlewares/ordenesCompra.middleware');

// Estado de una factura frente a su vencimiento. UNA definición para la
// pantalla de cartera, la ficha del acreedor y el aviso de las 8:00.
const _estadoPago = (dias, diasAviso) => {
  if (dias == null) return 'sin_plazo';
  if (dias < 0)          return 'vencida';
  if (dias <= diasAviso) return 'por_vencer';
  return 'al_dia';
};

// ── El semáforo de la ficha ─────────────────────────────────────────────────
//
// La lista trae la fecha del cargo abierto que vence primero; aquí se traduce a
// estado. Se usa `_estadoPago` —el MISMO que la pantalla de cartera y el que
// alimenta el aviso de las 8:00— y el MISMO `dias_aviso` del negocio: si la
// ficha dijera "por vencer" y la cartera "al día", el usuario dejaría de
// creerle a las dos.
//
// Un acreedor sin cargos con fecha sale en `sin_plazo` y el chip queda gris: no
// es una alerta, es que nadie registró un plazo.
const _conSemaforo = async (negocioId, filas) => {
  const cfg = await getConfigOrdenes(negocioId);
  return filas.map((a) => {
    const dias = a.dias_para_vencer == null ? null : Number(a.dias_para_vencer);
    return { ...a, dias_para_vencer: dias, estado_pago: _estadoPago(dias, cfg.dias_aviso) };
  });
};

const getAcreedores = async (negocioId, filtro) =>
  _conSemaforo(negocioId, await repo.findAll(negocioId, filtro));

// Para usuarios no-admin: filtra por los proveedores que tienen permitidos
const getAcreedoresParaUsuario = async (negocioId, permisos, filtro) => {
  if (!permisos || !permisos.ver) return [];
  const filas = permisos.ver_todos
    ? await repo.findAll(negocioId, filtro)
    : await repo.findByProveedorIds(negocioId, permisos.ver_lista || [], filtro);
  return _conSemaforo(negocioId, filas);
};

// Solo acreedores vinculados a cruces — mantenida por compatibilidad interna
const getAcreedoresCruces = async (negocioId, filtro) =>
  _conSemaforo(negocioId, await repo.findByCruces(negocioId, filtro));

const getAcreedorById = async (negocioId, id) => {
  const acreedor = await repo.findById(negocioId, id);
  if (!acreedor) throw { status: 404, message: 'Acreedor no encontrado' };

  const movimientos = await repo.getMovimientos(negocioId, id);

  const saldo = movimientos.length > 0
    ? Number(movimientos[movimientos.length - 1].saldo_despues)
    : 0;

  return { ...acreedor, saldo, movimientos };
};

const crearAcreedor = async (negocioId, datos) => {
  const { rows } = await pool.query(
    `SELECT id FROM acreedores WHERE negocio_id = $1 AND cedula = $2 LIMIT 1`,
    [negocioId, datos.cedula]
  );
  if (rows.length) {
    throw { status: 409, message: `Ya existe un acreedor con la cédula ${datos.cedula}` };
  }
  return repo.create(negocioId, datos);
};

const registrarMovimiento = async (negocioId, acreedorId, datos) => {
  const acreedor = await repo.findById(negocioId, acreedorId);
  if (!acreedor) throw { status: 404, message: 'Acreedor no encontrado' };

  if (datos.tipo === 'Abono' && datos.cargo_id) {
    const { rows } = await pool.query(`
      SELECT GREATEST(m.valor - COALESCE(SUM(a.valor), 0), 0) AS saldo_pendiente
      FROM movimientos_acreedor m
      LEFT JOIN movimientos_acreedor a ON a.cargo_id = m.id AND a.tipo = 'Abono'
      WHERE m.id = $1 AND m.acreedor_id = $2 AND m.tipo = 'Cargo'
      GROUP BY m.id
    `, [datos.cargo_id, acreedorId]);
    if (rows.length && Number(datos.valor) > Number(rows[0].saldo_pendiente)) {
      throw { status: 400, message: 'El abono no puede superar el saldo pendiente del cargo' };
    }
  }

  // Baranda contra el doble clic, igual que en préstamos y créditos: un
  // movimiento idéntico (mismo acreedor, mismo tipo, mismo valor, mismo cargo)
  // dentro de la ventana es el formulario enviándose dos veces, no un segundo
  // pago. Aquí duele igual: duplicar un abono le borra al proveedor una deuda
  // que el negocio sí tiene.
  const { rows: gemelo } = await pool.query(`
    SELECT id FROM movimientos_acreedor
     WHERE acreedor_id = $1 AND tipo = $2 AND valor = $3
       AND COALESCE(cargo_id, -1) = COALESCE($4, -1)
       AND COALESCE(metodo, '')   = COALESCE($5, '')
       AND fecha > NOW() - INTERVAL '90 seconds'
     LIMIT 1
  `, [acreedorId, datos.tipo, datos.valor, datos.cargo_id ?? null, datos.metodo || null]);
  if (gemelo.length) {
    throw {
      status: 409,
      message: 'Este mismo movimiento ya se registró hace un momento. Revisa el estado de cuenta del acreedor antes de volver a intentarlo.',
    };
  }

  return repo.insertarMovimiento({ ...datos, acreedor_id: acreedorId });
};

const getCargosAbiertos = async (negocioId, acreedorId) => {
  const acreedor = await repo.findById(negocioId, acreedorId);
  if (!acreedor) throw { status: 404, message: 'Acreedor no encontrado' };
  return repo.getCargosAbiertos(negocioId, acreedorId);
};

const getComprasConSaldo = async (negocioId, acreedorId) => {
  const acreedor = await repo.findById(negocioId, acreedorId);
  if (!acreedor) throw { status: 404, message: 'Acreedor no encontrado' };
  return repo.getComprasConSaldo(negocioId, acreedorId);
};

const getAbonosPorCargo = async (negocioId, acreedorId, cargoId) => {
  const acreedor = await repo.findById(negocioId, acreedorId);
  if (!acreedor) throw { status: 404, message: 'Acreedor no encontrado' };
  return repo.getAbonosPorCargo(negocioId, acreedorId, cargoId);
};

const getSaldoAFavor = async (negocioId, acreedorId) => {
  const acreedor = await repo.findById(negocioId, acreedorId);
  if (!acreedor) throw { status: 404, message: 'Acreedor no encontrado' };
  return repo.getSaldoAFavor(negocioId, acreedorId);
};

const aplicarSaldoAFavor = async (negocioId, acreedorId, cargoId, valor) => {
  const acreedor = await repo.findById(negocioId, acreedorId);
  if (!acreedor) throw { status: 404, message: 'Acreedor no encontrado' };
  return repo.aplicarSaldoAFavor(negocioId, acreedorId, cargoId, valor);
};

const registrarAbonoTotal = async (negocioId, acreedorId, { valor, metodo, registrar_en_caja, usuario_id, sucursal_id, descripcion }) => {
  const acreedor = await repo.findById(negocioId, acreedorId);
  if (!acreedor) throw { status: 404, message: 'Acreedor no encontrado' };
  if (!valor || Number(valor) <= 0) throw { status: 400, message: 'El valor debe ser mayor a 0' };
  return repo.registrarAbonoTotal(negocioId, acreedorId, {
    valor: Number(valor), metodo, registrar_en_caja, usuario_id, sucursal_id, descripcion,
  });
};

const eliminarAcreedor = async (negocioId, acreedorId) => {
  try {
    await repo.eliminarSeguro(negocioId, acreedorId);
  } catch (err) {
    if (err.code === '23503') {
      throw {
        status: 409,
        message: 'Este acreedor tiene registros vinculados en el sistema y no puede eliminarse.',
      };
    }
    throw err;
  }
};

// Los abonos espejo (mov_dinero_id) provienen de un pago hecho en Tesorería:
// editarlos o borrarlos aquí descuadraría el dinero. Se anulan desde
// Tesorería (extracto de la cuenta) y el sistema sincroniza ambos lados.
const _bloquearAbonoEspejo = async (movId) => {
  const { rows } = await pool.query(
    `SELECT id FROM movimientos_acreedor WHERE id = $1 AND mov_dinero_id IS NOT NULL`,
    [movId]
  );
  if (rows.length) {
    throw {
      status: 400,
      message: 'Este abono proviene de un pago hecho en Tesorería. Para modificarlo, anula el pago desde Tesorería (extracto de la cuenta) y el sistema cuadra ambos lados.',
    };
  }
};

const editarAbono = async (negocioId, acreedorId, movId, datos) => {
  const acreedor = await repo.findById(negocioId, acreedorId);
  if (!acreedor) throw { status: 404, message: 'Acreedor no encontrado' };
  await _bloquearAbonoEspejo(movId);
  // Si el abono queda ligado a un cargo, no puede superar el saldo pendiente de
  // ese cargo (mismo criterio que al crear). Evita dejar cargos sobre-pagados.
  if (datos.cargo_id) {
    const max = await repo.getMaxAbonoEditable(acreedorId, Number(datos.cargo_id), Number(movId));
    if (max !== null && Number(datos.valor) > max + 0.001) {
      throw { status: 400, message: `El abono no puede superar el saldo pendiente del cargo (${max.toLocaleString('es-CO')})` };
    }
  }
  return repo.editarAbono(negocioId, acreedorId, movId, datos);
};

const eliminarAbono = async (negocioId, acreedorId, movId) => {
  const acreedor = await repo.findById(negocioId, acreedorId);
  if (!acreedor) throw { status: 404, message: 'Acreedor no encontrado' };
  await _bloquearAbonoEspejo(movId);
  return repo.eliminarAbono(negocioId, acreedorId, movId);
};

const getHistorial = async (negocioId, acreedorId) => {
  const acreedor = await repo.findById(negocioId, acreedorId);
  if (!acreedor) throw { status: 404, message: 'Acreedor no encontrado' };
  return repo.getMovimientos(negocioId, acreedorId);
};

// ─────────────────────────────────────────────────────────────────────────────
// FACTURAS DE PROVEEDOR POR VENCER
//
// La pregunta que no tenía dónde responderse: «¿qué facturas me van a vencer?».
// Incluye las de órdenes y las de compras sueltas — que a alguien se le haya
// olvidado crear la orden no hace que su factura deje de vencer.
//
// El semáforo usa el MISMO umbral que el aviso de la mañana
// (`ordenes_compra_dias_aviso`): si la pantalla dijera "por vencer" y la
// notificación no llegara, o al revés, el usuario dejaría de creerle a las dos.
// ─────────────────────────────────────────────────────────────────────────────
// (`getConfigOrdenes` y `_estadoPago` se declaran al principio del archivo:
// los usan tanto la cartera como el semáforo de la ficha del acreedor.)

/**
 * Pone el plazo a un cargo que se registró sin él.
 *
 * Existe porque olvidar el plazo al registrar una compra es normal, y sin esto
 * la única salida era anular la compra y rehacerla —moviendo inventario y
 * deuda— para arreglar una fecha.
 *
 * El cálculo es el MISMO que usan las órdenes y las compras
 * (`utils/vencimiento.util`): la misma factura no puede vencer en días
 * distintos según por dónde se le puso el plazo.
 */
const ponerPlazoACargo = async (negocioId, cargoId, { fecha_factura, dias_plazo, fecha_vencimiento }) => {
  const { resolverVencimiento } = require('../../utils/vencimiento.util');
  const vencimiento = resolverVencimiento({ fecha_factura, dias_plazo, fecha_vencimiento });

  // `null` es un valor legítimo: sirve para QUITARLE el plazo a un cargo al que
  // se le puso por error, y sacarlo del semáforo sin tocar la deuda.
  const fila = await repo.actualizarVencimientoCargo(negocioId, cargoId, vencimiento);
  if (!fila) throw { status: 404, message: 'Cargo no encontrado' };
  return fila;
};

const getFacturasPorVencer = async (negocioId, opciones = {}) => {
  const cfg = await getConfigOrdenes(negocioId);
  const filas = await repo.findFacturasPorVencer(negocioId, opciones);

  // El avance de recepción se pide de una sola vez para todas las órdenes
  // involucradas: una consulta por factura sería N+1 sobre una pantalla que se
  // abre todos los días.
  const ordenIds = [...new Set(filas.map((f) => f.orden_id).filter(Boolean))];
  const avances  = await repo.findAvanceOrdenes(ordenIds);
  const avancePorOrden = new Map(avances.map((a) => [Number(a.orden_id), a]));

  const items = filas.map((f) => {
    const dias = f.dias_para_vencer == null ? null : Number(f.dias_para_vencer);
    const av   = f.orden_id ? avancePorOrden.get(Number(f.orden_id)) : null;

    return {
      cargo_id:         f.id,
      acreedor_id:      f.acreedor_id,
      acreedor_nombre:  f.acreedor_nombre,
      proveedor_id:     f.proveedor_id,
      proveedor_nombre: f.proveedor_nombre || f.acreedor_nombre,
      sucursal_id:      f.sucursal_id,
      sucursal_nombre:  f.sucursal_nombre,
      numero_factura:   f.numero_factura,
      fecha:            f.fecha,
      fecha_vencimiento: f.fecha_vencimiento,
      dias_para_vencer: dias,
      estado_pago:      _estadoPago(dias, cfg.dias_aviso),
      valor:            Number(f.valor),
      abonado:          Number(f.abonado),
      saldo:            Number(f.saldo),
      // De dónde viene: una orden, o una compra suelta. La interfaz lo necesita
      // para saber si puede mostrar avance de recepción o no.
      origen:           f.orden_id ? 'orden' : 'compra',
      orden_id:         f.orden_id,
      orden_numero:     f.orden_numero,
      orden_estado:     f.orden_estado,
      compra_id:        f.compra_id,
      compra_numero:    f.compra_numero,
      // Solo tiene sentido en facturas que vienen de una orden: una compra
      // suelta ya llegó completa por definición (se registra al recibirla).
      unidades_pedidas:   av ? Number(av.pedidas)   : null,
      unidades_recibidas: av ? Number(av.recibidas) : null,
    };
  });

  const total = (pred) => items.filter(pred).reduce((s, i) => s + i.saldo, 0);

  return {
    items,
    dias_aviso: cfg.dias_aviso,
    resumen: {
      vencidas:    { cuantas: items.filter((i) => i.estado_pago === 'vencida').length,    valor: total((i) => i.estado_pago === 'vencida') },
      por_vencer:  { cuantas: items.filter((i) => i.estado_pago === 'por_vencer').length, valor: total((i) => i.estado_pago === 'por_vencer') },
      al_dia:      { cuantas: items.filter((i) => i.estado_pago === 'al_dia').length,     valor: total((i) => i.estado_pago === 'al_dia') },
      total:       total(() => true),
    },
  };
};

module.exports = {
  getFacturasPorVencer, ponerPlazoACargo,
  getAcreedores, getAcreedoresParaUsuario, getAcreedoresCruces, getAcreedorById,
  crearAcreedor, registrarMovimiento, getCargosAbiertos,
  getComprasConSaldo, getAbonosPorCargo,
  getSaldoAFavor, aplicarSaldoAFavor,
  registrarAbonoTotal,
  editarAbono, eliminarAbono,
  eliminarAcreedor, getHistorial,
};