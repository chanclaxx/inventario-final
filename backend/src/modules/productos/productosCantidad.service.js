const repo = require('./productosCantidad.repository');

const getProductos = (sucursalId, negocioId) => repo.findAll(sucursalId, negocioId);

const getProductoById = async (negocioId, id) => {
  // ── Agregar negocio_id para verificar ownership ──
  const producto = await repo.findByIdYNegocio(id, negocioId);
  if (!producto) throw { status: 404, message: 'Producto no encontrado' };
  return producto;
};

const crearProducto = async (negocioId, datos) => {
  // ── Verificar que sucursal_id pertenece al negocio ──
  const { pool } = require('../../config/db');
  const { rows } = await pool.query(
    `SELECT id FROM sucursales WHERE id = $1 AND negocio_id = $2 AND activa = true`,
    [datos.sucursal_id, negocioId]
  );
  if (!rows.length) throw { status: 403, message: 'Sucursal no válida para este negocio' };
  return repo.create(datos);
};

const actualizarProducto = async (negocioId, id, datos) => {
  const producto = await repo.findByIdYNegocio(id, negocioId);
  if (!producto) throw { status: 404, message: 'Producto no encontrado' };
  const actualizado = await repo.update(id, datos);
  if (!actualizado) throw { status: 404, message: 'Producto no encontrado' };
  return actualizado;
};

const ajustarStock = async (
  negocioId, id, cantidad,
  { costo_unitario, proveedor_id, cliente_origen, cedula_cliente, tipo, notas } = {}
) => {
  // ── Una sola query: ownership + datos del producto ──
  const producto = await repo.findByIdYNegocio(id, negocioId);
  if (!producto) throw { status: 404, message: 'Producto no encontrado' };

  // ── Validar que el stock no quede negativo ──
  if (cantidad < 0 && (producto.stock + cantidad) < 0) {
    throw {
      status: 400,
      message: `Stock insuficiente. Stock actual: ${producto.stock}`,
    };
  }

  const actualizado = await repo.ajustarStock(id, cantidad, {
    costo_unitario, proveedor_id, cliente_origen,
  });

  const tipoMovimiento = tipo
    || (cliente_origen ? 'compra_cliente'
    : proveedor_id     ? 'compra_proveedor'
    :                    'ajuste');

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
  const producto = await repo.findByIdYNegocio(id, negocioId);
  if (!producto) throw { status: 404, message: 'Producto no encontrado' };
  await repo.eliminar(id);
};
const getHistorialStock = (negocioId, q) =>
  repo.getHistorialStock(negocioId, q || '');

module.exports = {
  getProductos, getProductoById, crearProducto,
  actualizarProducto, ajustarStock, eliminarProducto,getHistorialStock
};