const repo = require('./productosSerial.repository');

const getProductos = (sucursalId, negocioId) =>
  repo.findAll(sucursalId, negocioId);

// ← CAMBIADA: ahora incluye negocio_id
const getProductoById = async (negocioId, id) => {
  const producto = await repo.findByIdYNegocio(id, negocioId);
  if (!producto) throw { status: 404, message: 'Producto no encontrado' };
  return producto;
};

// ← CAMBIADA: ahora verifica sucursal
const crearProducto = async (negocioId, datos) => {
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

// ← CAMBIADA: ahora verifica ownership del producto
const getSeriales = async (negocioId, productoId, vendido) => {
  const producto = await repo.findByIdYNegocio(productoId, negocioId);
  if (!producto) throw { status: 404, message: 'Producto no encontrado' };
  return repo.getSeriales(productoId, vendido);
};

// ← SIN CAMBIOS — igual que el original
const agregarSerial = async (
  negocioId,
  productoId,
  { imei, fecha_entrada, costo_compra, cliente_origen, proveedor_id, reactivar_serial_id }
) => {
  const valido = await repo.perteneceAlNegocio(productoId, negocioId);
  if (!valido) throw { status: 404, message: 'Producto no encontrado' };

  if (reactivar_serial_id) {
    return repo.reactivarSerial(reactivar_serial_id, {
      costo_compra: costo_compra ?? null,
      proveedor_id: proveedor_id || null,
    });
  }

  const existe = await repo.findSerialByIMEI(imei);
  if (existe) throw { status: 409, message: `El IMEI ${imei} ya está registrado` };

  return repo.insertarSerial({
    producto_id:    productoId,
    imei,
    fecha_entrada:  fecha_entrada  || new Date().toISOString().split('T')[0],
    costo_compra:   costo_compra   ?? null,
    cliente_origen: cliente_origen || null,
    proveedor_id:   proveedor_id   || null,
  });
};

// ← CAMBIADA: ahora verifica ownership del serial
const actualizarSerial = async (negocioId, serialId, { imei, costo_compra, precio, producto_id }) => {
  const serial = await repo.findSerialByIdYNegocio(serialId, negocioId);
  if (!serial) throw { status: 404, message: 'Serial no encontrado' };

  const actualizado = await repo.actualizarSerial(serialId, { imei, costo_compra });
  if (!actualizado) throw { status: 404, message: 'Serial no encontrado' };

  if (precio !== undefined && producto_id) {
    await repo.updatePrecio(producto_id, precio);
  }
  return actualizado;
};

// ← CAMBIADA: ahora verifica ownership del serial
const eliminarSerial = async (negocioId, serialId) => {
  const serial = await repo.findSerialByIdYNegocio(serialId, negocioId);
  if (!serial) throw { status: 404, message: 'Serial no encontrado' };

  const eliminado = await repo.eliminarSerial(serialId);
  if (!eliminado) throw { status: 404, message: 'Serial no encontrado' };
};

// ← SIN CAMBIOS — igual que el original
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

// ← SIN CAMBIOS — igual que el original
const getComprasCliente = async (negocioId, q) =>
  repo.findComprasCliente(negocioId, q || '');

module.exports = {
  getProductos,
  getProductoById,
  crearProducto,
  actualizarProducto,
  getSeriales,
  agregarSerial,
  actualizarSerial,
  eliminarSerial,
  verificarImei,
  getComprasCliente,
};