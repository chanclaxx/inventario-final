const repo = require('./caja.repository');

const getCajaActiva = (sucursalId) => repo.findCajaAbierta(sucursalId);

const abrirCaja = async ({ sucursal_id, usuario_id, monto_inicial }) => {
  const cajaAbierta = await repo.findCajaAbierta(sucursal_id);
  if (cajaAbierta) throw { status: 400, message: 'Ya hay una caja abierta para esta sucursal' };
  return repo.abrirCaja({ sucursal_id, usuario_id, monto_inicial: monto_inicial || 0 });
};

const cerrarCaja = async (negocioId, cajaId, { monto_cierre }) => {
  const valida = await repo.perteneceAlNegocio(cajaId, negocioId);
  if (!valida) throw { status: 404, message: 'Caja no encontrada' };
  const caja = await repo.findById(cajaId);
  if (caja.estado === 'Cerrada') throw { status: 400, message: 'La caja ya está cerrada' };
  const resumen   = await repo.getResumenCaja(cajaId);
  const resultado = await repo.cerrarCaja(cajaId, monto_cierre);
  return { ...resultado, resumen };
};

const getMovimientos = async (negocioId, cajaId) => {
  const valida = await repo.perteneceAlNegocio(cajaId, negocioId);
  if (!valida) throw { status: 404, message: 'Caja no encontrada' };
  const caja        = await repo.findById(cajaId);
  const movimientos = await repo.getMovimientos(cajaId);
  const resumen     = await repo.getResumenCaja(cajaId);
  return { caja, movimientos, resumen };
};

const getResumenDia = async (negocioId, cajaId, sucursalId) => {
  const valida = await repo.perteneceAlNegocio(cajaId, negocioId);
  if (!valida) throw { status: 404, message: 'Caja no encontrada' };
  return repo.getResumenDia(cajaId, sucursalId);
};

const registrarMovimiento = async (negocioId, cajaId, { usuario_id, tipo, concepto, valor, referencia_id, referencia_tipo }) => {
  const valida = await repo.perteneceAlNegocio(cajaId, negocioId);
  if (!valida) throw { status: 404, message: 'Caja no encontrada' };
  const caja = await repo.findById(cajaId);
  if (caja.estado === 'Cerrada') throw { status: 400, message: 'No se puede registrar movimientos en una caja cerrada' };
  if (!['Ingreso', 'Egreso'].includes(tipo)) throw { status: 400, message: 'Tipo debe ser Ingreso o Egreso' };
  if (valor <= 0) throw { status: 400, message: 'El valor debe ser mayor a 0' };
  return repo.insertarMovimiento({ caja_id: cajaId, usuario_id, tipo, concepto, valor, referencia_id, referencia_tipo });
};

module.exports = { getCajaActiva, abrirCaja, cerrarCaja, getMovimientos, getResumenDia, registrarMovimiento };