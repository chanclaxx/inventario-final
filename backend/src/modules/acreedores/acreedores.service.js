const repo = require('./acreedores.repository');

const getAcreedores = (negocioId, filtro) => repo.findAll(negocioId, filtro);

const getAcreedorById = async (negocioId, id) => {
  const acreedor = await repo.findById(negocioId, id);
  if (!acreedor) throw { status: 404, message: 'Acreedor no encontrado' };

  const movimientos = await repo.getMovimientos(negocioId, id);

  const saldo = movimientos.length > 0
    ? Number(movimientos[movimientos.length - 1].saldo_despues)
    : 0;

  return { ...acreedor, saldo, movimientos };
};

const crearAcreedor = (negocioId, datos) => repo.create(negocioId, datos);

const registrarMovimiento = async (negocioId, acreedorId, datos) => {
  const acreedor = await repo.findById(negocioId, acreedorId);
  if (!acreedor) throw { status: 404, message: 'Acreedor no encontrado' };
  return repo.insertarMovimiento({ ...datos, acreedor_id: acreedorId });
};

module.exports = { getAcreedores, getAcreedorById, crearAcreedor, registrarMovimiento };