const repo = require('./caja.repository');
const { pool } = require('../../config/db');

const getCajaActiva = (sucursalId) => repo.findCajaAbierta(sucursalId);

const abrirCaja = async ({ sucursal_id, usuario_id, monto_inicial, negocio_id }) => {
  // ── Segunda capa: verificar que la sucursal pertenece al negocio ──
  const { rows } = await pool.query(
    `SELECT id FROM sucursales WHERE id = $1 AND negocio_id = $2 AND activa = true`,
    [sucursal_id, negocio_id]
  );
  if (!rows.length) throw { status: 403, message: 'Sucursal no válida para este negocio' };

  const cajaAbierta = await repo.findCajaAbierta(sucursal_id);
  if (cajaAbierta) throw { status: 400, message: 'Ya hay una caja abierta para esta sucursal' };

  return repo.abrirCaja({ sucursal_id, usuario_id, monto_inicial: monto_inicial || 0 });
};

// ── Reemplaza perteneceAlNegocio + findById con una sola query ────────────
const cerrarCaja = async (negocioId, cajaId, { monto_cierre }) => {
  const caja = await repo.findByIdYNegocio(cajaId, negocioId);
  if (!caja) throw { status: 404, message: 'Caja no encontrada' };
  if (caja.estado === 'Cerrada') throw { status: 400, message: 'La caja ya está cerrada' };

  const resultado = await repo.cerrarCaja(cajaId, monto_cierre);

  // Congelar el resumen al cierre: se calcula con el rango ya cerrado
  // (fin = fecha_cierre) y se guarda como foto. Si algo falla aquí (p. ej. la
  // migración de resumen_cierre aún no está aplicada), NO se bloquea el cierre:
  // la caja quedará sin foto y se recalculará en vivo como antes.
  let resumen;
  try {
    resumen = await repo.getResumenDia(cajaId, caja.sucursal_id, negocioId);
    await repo.guardarResumenCierre(cajaId, resumen);
  } catch (err) {
    resumen = await repo.getResumenCaja(cajaId);
  }

  return { ...resultado, resumen };
};

const getMovimientos = async (negocioId, cajaId) => {
  const caja = await repo.findByIdYNegocio(cajaId, negocioId);
  if (!caja) throw { status: 404, message: 'Caja no encontrada' };
  const movimientos = await repo.getMovimientos(cajaId);
  const resumen     = await repo.getResumenCaja(cajaId);
  return { caja, movimientos, resumen };
};

const getResumenDia = async (negocioId, cajaId, sucursalId) => {
  const caja = await repo.findByIdYNegocio(cajaId, negocioId);
  if (!caja) throw { status: 404, message: 'Caja no encontrada' };
  // Caja cerrada con foto guardada: devolver la foto (inmutable), no recalcular.
  // Así, cancelar/editar transacciones de días pasados no altera cajas cerradas.
  if (caja.estado === 'Cerrada' && caja.resumen_cierre) {
    return caja.resumen_cierre;
  }
  // Usar sucursal_id de la caja verificada, no el parámetro externo
  return repo.getResumenDia(cajaId, caja.sucursal_id, negocioId);
};

const getResumenGlobal = (negocioId) => repo.getResumenGlobal(negocioId);

const getHistorial = (negocioId, sucursalId, { limit, offset } = {}) => {
  const lim = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const off = Math.max(Number(offset) || 0, 0);
  return repo.getHistorial(sucursalId, negocioId, lim, off);
};

const registrarMovimiento = async (negocioId, cajaId, { usuario_id, tipo, concepto, valor, referencia_id, referencia_tipo, metodo }) => {
  const caja = await repo.findByIdYNegocio(cajaId, negocioId);
  if (!caja) throw { status: 404, message: 'Caja no encontrada' };
  if (caja.estado === 'Cerrada') throw { status: 400, message: 'No se puede registrar movimientos en una caja cerrada' };
  if (!['Ingreso', 'Egreso'].includes(tipo)) throw { status: 400, message: 'Tipo debe ser Ingreso o Egreso' };
  if (valor <= 0) throw { status: 400, message: 'El valor debe ser mayor a 0' };
  return repo.insertarMovimiento({ caja_id: cajaId, usuario_id, tipo, concepto, valor, referencia_id, referencia_tipo, metodo });
};
const toggleMovimiento = async (negocioId, movimientoId) => {
  return repo.toggleMovimiento(movimientoId, negocioId);
};
module.exports = {
  getCajaActiva, abrirCaja, cerrarCaja,
  getMovimientos, getResumenDia, getResumenGlobal, registrarMovimiento, toggleMovimiento,
  getHistorial,
};