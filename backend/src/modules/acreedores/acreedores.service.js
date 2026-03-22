const { pool } = require('../../config/db');
const repo = require('./acreedores.repository');

const getAcreedores = (negocioId, filtro) => repo.findAll(negocioId, filtro);

// Solo acreedores vinculados a cruces — para supervisores
const getAcreedoresCruces = (negocioId, filtro) => repo.findByCruces(negocioId, filtro);

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
  return repo.insertarMovimiento({ ...datos, acreedor_id: acreedorId });
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

module.exports = {
  getAcreedores, getAcreedoresCruces, getAcreedorById,
  crearAcreedor, registrarMovimiento, eliminarAcreedor,
};