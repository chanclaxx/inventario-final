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
  const resumen   = await repo.getResumenCaja(cajaId);
  const resultado = await repo.cerrarCaja(cajaId, monto_cierre);
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
  // Usar sucursal_id de la caja verificada, no el parámetro externo
  return repo.getResumenDia(cajaId, caja.sucursal_id, negocioId);
};

const getResumenGlobal = (negocioId) => repo.getResumenGlobal(negocioId);

const registrarMovimiento = async (negocioId, cajaId, { usuario_id, tipo, concepto, valor, referencia_id, referencia_tipo }) => {
  const caja = await repo.findByIdYNegocio(cajaId, negocioId);
  if (!caja) throw { status: 404, message: 'Caja no encontrada' };
  if (caja.estado === 'Cerrada') throw { status: 400, message: 'No se puede registrar movimientos en una caja cerrada' };
  if (!['Ingreso', 'Egreso'].includes(tipo)) throw { status: 400, message: 'Tipo debe ser Ingreso o Egreso' };
  if (valor <= 0) throw { status: 400, message: 'El valor debe ser mayor a 0' };
  return repo.insertarMovimiento({ caja_id: cajaId, usuario_id, tipo, concepto, valor, referencia_id, referencia_tipo });
};
const toggleMovimiento = async (negocioId, movimientoId) => {
  return repo.toggleMovimiento(movimientoId, negocioId);
};
module.exports = {
  getCajaActiva, abrirCaja, cerrarCaja,
  getMovimientos, getResumenDia, getResumenGlobal, registrarMovimiento,toggleMovimiento
};