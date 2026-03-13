const repo = require('./productosCantidad.repository');

const getProductos = (sucursalId, negocioId) => repo.findAll(sucursalId, negocioId);

const getProductoById = async (id) => {
  const producto = await repo.findById(id);
  if (!producto) throw { status: 404, message: 'Producto no encontrado' };
  return producto;
};

const crearProducto = (datos) => repo.create(datos);

const actualizarProducto = async (negocioId, id, datos) => {
  const valido = await repo.perteneceAlNegocio(id, negocioId);
  if (!valido) throw { status: 404, message: 'Producto no encontrado' };
  const producto = await repo.update(id, datos);
  if (!producto) throw { status: 404, message: 'Producto no encontrado' };
  return producto;
};

const ajustarStock = async (negocioId, id, cantidad, opciones = {}) => {
  const producto = await repo.findById(id);
  if (!producto) throw { status: 404, message: 'Producto no encontrado' };

  const valido = await repo.perteneceAlNegocio(id, negocioId);
  if (!valido) throw { status: 404, message: 'Producto no encontrado' };

  if (producto.stock + cantidad < 0) {
    throw { status: 400, message: 'Stock insuficiente para realizar esta operación' };
  }

  // opciones = { costo_unitario, proveedor_id } — se pasan al repo
  return repo.ajustarStock(id, cantidad, opciones);
};

const eliminarProducto = async (negocioId, id) => {
  const valido = await repo.perteneceAlNegocio(id, negocioId);
  if (!valido) throw { status: 404, message: 'Producto no encontrado' };
  const eliminado = await repo.eliminar(id);
  if (!eliminado) throw { status: 404, message: 'Producto no encontrado' };
};

module.exports = {
  getProductos, getProductoById, crearProducto,
  actualizarProducto, ajustarStock, eliminarProducto,
};