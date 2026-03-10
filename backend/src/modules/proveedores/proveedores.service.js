const repo = require('./proveedores.repository');

const getProveedores = (negocioId) => repo.findAll(negocioId);

const getProveedorById = async (negocioId, id) => {
  const p = await repo.findById(negocioId, id);
  if (!p) throw { status: 404, message: 'Proveedor no encontrado' };
  return p;
};

const crearProveedor = (negocioId, datos) => repo.create(negocioId, datos);

const actualizarProveedor = async (negocioId, id, datos) => {
  const p = await repo.update(negocioId, id, datos);
  if (!p) throw { status: 404, message: 'Proveedor no encontrado' };
  return p;
};

const eliminarProveedor = async (negocioId, id) => {
  const ok = await repo.eliminar(negocioId, id);
  if (!ok) throw { status: 404, message: 'Proveedor no encontrado' };
};

module.exports = { getProveedores, getProveedorById, crearProveedor, actualizarProveedor, eliminarProveedor };