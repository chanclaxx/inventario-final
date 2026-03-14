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

const ajustarStock = async (
  negocioId, id, cantidad,
  { costo_unitario, proveedor_id, cliente_origen, cedula_cliente, tipo, notas } = {}
) => {
  const valido = await repo.perteneceAlNegocio(id, negocioId);
  if (!valido) throw { status: 404, message: 'Producto no encontrado' };
 
  const producto = await repo.findById(id);
  if (!producto) throw { status: 404, message: 'Producto no encontrado' };
 
  // Actualizar stock + campos opcionales
  const actualizado = await repo.ajustarStock(id, cantidad, {
    costo_unitario,
    proveedor_id,
    cliente_origen,
  });
 
  // Determinar tipo de movimiento automáticamente si no viene explícito
  const tipoMovimiento = tipo
    || (cliente_origen ? 'compra_cliente'
    : proveedor_id     ? 'compra_proveedor'
    :                    'ajuste');
 
  // Registrar historial siempre
  await repo.insertarHistorial({
    producto_id:    id,
    sucursal_id:    producto.sucursal_id,
    cantidad,
    costo_unitario: costo_unitario ?? null,
    tipo:           tipoMovimiento,
    cliente_origen: cliente_origen || null,
    cedula_cliente: cedula_cliente || null,
    proveedor_id:   proveedor_id   || null,
    notas:          notas          || null,
  });
 
  return actualizado;
};

const eliminarProducto = async (negocioId, id) => {
  const valido = await repo.perteneceAlNegocio(id, negocioId);
  if (!valido) throw { status: 404, message: 'Producto no encontrado' };
  const eliminado = await repo.eliminar(id);
  if (!eliminado) throw { status: 404, message: 'Producto no encontrado' };
};
const getHistorialStock = (negocioId, q) =>
  repo.getHistorialStock(negocioId, q || '');

module.exports = {
  getProductos, getProductoById, crearProducto,
  actualizarProducto, ajustarStock, eliminarProducto,getHistorialStock
};