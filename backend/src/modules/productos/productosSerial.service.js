const { pool } = require('../../config/db');
const repo     = require('./productosSerial.repository');
const { fechaHoyColombia } = require('../../utils/fecha.util');

// ── Verifica que linea_id pertenece al negocio ────────────────────────────
const _verificarLineaNegocio = async (lineaId, negocioId) => {
  const { rows } = await pool.query(
    `SELECT id FROM lineas_producto WHERE id = $1 AND negocio_id = $2`,
    [lineaId, negocioId]
  );
  if (!rows.length) throw { status: 403, message: 'La línea no pertenece a este negocio' };
};

const getProductos = (sucursalId, negocioId, lineaId) =>
  repo.findAll(sucursalId, negocioId, lineaId);

const getProductoById = async (negocioId, id) => {
  const producto = await repo.findByIdYNegocio(id, negocioId);
  if (!producto) throw { status: 404, message: 'Producto no encontrado' };
  return producto;
};

const crearProducto = async (negocioId, datos) => {
  const { rows } = await pool.query(
    `SELECT id FROM sucursales WHERE id = $1 AND negocio_id = $2 AND activa = true`,
    [datos.sucursal_id, negocioId]
  );
  if (!rows.length) throw { status: 403, message: 'Sucursal no válida para este negocio' };

  if (!datos.linea_id) throw { status: 400, message: 'La línea es requerida' };
  await _verificarLineaNegocio(datos.linea_id, negocioId);

  return repo.create(datos);
};

const actualizarProducto = async (negocioId, id, datos) => {
  const producto = await repo.findByIdYNegocio(id, negocioId);
  if (!producto) throw { status: 404, message: 'Producto no encontrado' };

  if (datos.linea_id) {
    await _verificarLineaNegocio(datos.linea_id, negocioId);
  }

  const actualizado = await repo.update(id, datos);
  if (!actualizado) throw { status: 404, message: 'Producto no encontrado' };
  return actualizado;
};

const getSeriales = async (negocioId, productoId, vendido) => {
  const producto = await repo.findByIdYNegocio(productoId, negocioId);
  if (!producto) throw { status: 404, message: 'Producto no encontrado' };
  return repo.getSeriales(productoId, vendido);
};

const agregarSerial = async (
  negocioId,
  productoId,
  { imei, fecha_entrada, costo_compra, cliente_origen, proveedor_id, reactivar_serial_id, color }
) => {
  const valido = await repo.perteneceAlNegocio(productoId, negocioId);
  if (!valido) throw { status: 404, message: 'Producto no encontrado' };

  if (reactivar_serial_id) {
    return repo.reactivarSerial(reactivar_serial_id, {
      costo_compra: costo_compra ?? null,
      proveedor_id: proveedor_id || null,
    });
  }

  const existe = await repo.findSerialByIMEIEnNegocio(imei, negocioId);
  if (existe) throw { status: 409, message: `El IMEI ${imei} ya está registrado` };

  return repo.insertarSerial({
    producto_id:    productoId,
    imei,
    fecha_entrada:  fecha_entrada || fechaHoyColombia(),
    costo_compra:   costo_compra  ?? null,
    cliente_origen: cliente_origen || null,
    proveedor_id:   proveedor_id   || null,
    color:          color          || null,
  });
};

const actualizarSerial = async (negocioId, serialId, { imei, costo_compra, precio, color }) => {
  const serial = await repo.findSerialByIdYNegocio(serialId, negocioId);
  if (!serial) throw { status: 404, message: 'Serial no encontrado' };

  const actualizado = await repo.actualizarSerial(serialId, { imei, costo_compra, color });
  if (!actualizado) throw { status: 404, message: 'Serial no encontrado' };

  if (precio !== undefined) {
    await repo.updatePrecio(serial.producto_id, precio);
  }
  return actualizado;
};

const eliminarSerial = async (negocioId, serialId) => {
  const serial = await repo.findSerialByIdYNegocio(serialId, negocioId);
  if (!serial) throw { status: 404, message: 'Serial no encontrado' };
  const eliminado = await repo.eliminarSerial(serialId);
  if (!eliminado) throw { status: 404, message: 'Serial no encontrado' };
};

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

const eliminarProductoSerial = async (negocioId, id) => {
  const producto = await repo.findByIdYNegocio(id, negocioId);
  if (!producto) throw { status: 404, message: 'Producto no encontrado' };

  const totalSeriales = await repo.contarSeriales(id);
  if (totalSeriales > 0) {
    throw {
      status: 409,
      message: `No se puede eliminar: el producto tiene ${totalSeriales} serial${totalSeriales !== 1 ? 'es' : ''} registrado${totalSeriales !== 1 ? 's' : ''}. Elimínalos primero.`,
    };
  }

  const eliminado = await repo.eliminarProductoSerial(id);
  if (!eliminado) throw { status: 404, message: 'Producto no encontrado' };
};

const getComprasCliente = async (negocioId, q) =>
  repo.findComprasCliente(negocioId, q || '');

module.exports = {
  getProductos, getProductoById, crearProducto, actualizarProducto,
  getSeriales, agregarSerial, actualizarSerial, eliminarSerial,
  verificarImei, getComprasCliente, eliminarProductoSerial,
};