const repo = require('./proveedores.repository');

const getProveedores    = (negocioId) => repo.findAll(negocioId);

const getProveedorById  = async (negocioId, id) => {
  const p = await repo.findById(negocioId, id);
  if (!p) throw { status: 404, message: 'Proveedor no encontrado' };
  return p;
};

const crearProveedor = async (negocioId, datos) => {
  // ── Verificar NIT duplicado dentro del negocio ──
  if (datos.nit) {
    const existe = await repo.findByNit(negocioId, datos.nit);
    if (existe) throw { status: 409, message: `Ya existe un proveedor con el NIT ${datos.nit}` };
  }
  return repo.create(negocioId, datos);
};

const actualizarProveedor = async (negocioId, id, datos) => {
  const p = await repo.update(negocioId, id, datos);
  if (!p) throw { status: 404, message: 'Proveedor no encontrado' };
  return p;
};

const eliminarProveedor = async (negocioId, id) => {
  // ── Verificar que no tenga productos activos vinculados ──
  const dependencias = await repo.contarDependenciasActivas(negocioId, id);
  if (dependencias.productos > 0) {
    throw {
      status: 409,
      message: `No se puede eliminar: el proveedor tiene ${dependencias.productos} producto(s) activo(s) vinculado(s)`,
    };
  }
  const ok = await repo.eliminar(negocioId, id);
  if (!ok) throw { status: 404, message: 'Proveedor no encontrado' };
};

module.exports = {
  getProveedores, getProveedorById,
  crearProveedor, actualizarProveedor, eliminarProveedor,
};