const repo = require('./productosSerial.repository');

// Solo esta función cambia — el resto del service queda idéntico
const getProductos = (sucursalId, negocioId) =>
  repo.findAll(sucursalId, negocioId);

const getProductoById = async (negocioId, id) => {
  const producto = await repo.findByIdYNegocio(id, negocioId);
  if (!producto) throw { status: 404, message: 'Producto no encontrado' };
  return producto;
};

const crearProducto = async (negocioId, datos) => {
  // ── Segunda capa: verificar que sucursal_id pertenece al negocio ──
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

const getSeriales = async (negocioId, productoId, vendido) => {
  // ── Verificar ownership del producto antes de listar sus seriales ──
  const producto = await repo.findByIdYNegocio(productoId, negocioId);
  if (!producto) throw { status: 404, message: 'Producto no encontrado' };
  return repo.getSeriales(productoId, vendido);
};

const actualizarSerial = async (negocioId, serialId, { imei, costo_compra, precio, producto_id }) => {
  // ── Verificar que el serial pertenece al negocio ──
  const serial = await repo.findSerialByIdYNegocio(serialId, negocioId);
  if (!serial) throw { status: 404, message: 'Serial no encontrado' };

  const actualizado = await repo.actualizarSerial(serialId, { imei, costo_compra });
  if (!actualizado) throw { status: 404, message: 'Serial no encontrado' };

  if (precio !== undefined && producto_id) {
    await repo.updatePrecio(producto_id, precio);
  }
  return actualizado;
};

const eliminarSerial = async (negocioId, serialId) => {
  // ── Verificar que el serial pertenece al negocio ──
  const serial = await repo.findSerialByIdYNegocio(serialId, negocioId);
  if (!serial) throw { status: 404, message: 'Serial no encontrado' };

  const eliminado = await repo.eliminarSerial(serialId);
  if (!eliminado) throw { status: 404, message: 'Serial no encontrado' };
};

/**
 * Verifica si un IMEI existe en cualquier sucursal del negocio.
 * Retorna { existe: false } o { existe: true, serial: { ...datos } }
 */
const verificarImei = async (imei, negocioId) => {
  const serial = await repo.findSerialByIMEIEnNegocio(imei, negocioId);
  if (!serial) return { existe: false };

  return {
    existe: true,
    serial: {
      id:              serial.id,
      imei:            serial.imei,
      vendido:         serial.vendido,
      prestado:        serial.prestado,
      fecha_entrada:   serial.fecha_entrada,
      fecha_salida:    serial.fecha_salida,
      cliente_origen:  serial.cliente_origen,
      producto_id:     serial.producto_id,
      producto_nombre: serial.producto_nombre,
      marca:           serial.marca,
      modelo:          serial.modelo,
      sucursal_id:     serial.sucursal_id,
      sucursal_nombre: serial.sucursal_nombre,
    },
  };
};
const getComprasCliente = async (negocioId, q) => {
  return repo.findComprasCliente(negocioId, q || '');
};

module.exports = {
  getProductos, getProductoById, crearProducto, actualizarProducto,
  getSeriales, agregarSerial, actualizarSerial, eliminarSerial,
  verificarImei,getComprasCliente
};