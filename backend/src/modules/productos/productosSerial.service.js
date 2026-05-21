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

  // When product price is explicitly set, reset individual serial prices so all serials use the new price
  if (datos.precio != null) {
    await repo.resetPreciosSeriales(id);
  }

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
  { imei, fecha_entrada, costo_compra, cliente_origen, proveedor_id, reactivar_serial_id, color, caracteristicas }
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
    caracteristicas: caracteristicas || null,
  });
};

const actualizarSerial = async (negocioId, serialId, { imei, costo_compra, precio, color, caracteristicas }) => {
  const serial = await repo.findSerialByIdYNegocio(serialId, negocioId);
  if (!serial) throw { status: 404, message: 'Serial no encontrado' };

  // Price is stored on the individual serial (not on the product) so other serials are unaffected
  const actualizado = await repo.actualizarSerial(serialId, { imei, costo_compra, precio, color, caracteristicas });
  if (!actualizado) throw { status: 404, message: 'Serial no encontrado' };

  return actualizado;
};

const eliminarSerial = async (negocioId, serialId) => {
  const serial = await repo.findSerialByIdYNegocio(serialId, negocioId);
  if (!serial) throw { status: 404, message: 'Serial no encontrado' };

  if (serial.vendido) {
    throw { status: 400, message: 'No se puede eliminar un serial que ya fue vendido' };
  }
  if (serial.prestado) {
    throw { status: 400, message: 'No se puede eliminar un serial que está prestado' };
  }

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

const eliminarProductoSerial = async (negocioId, id, forzar = false) => {
  const producto = await repo.findByIdYNegocio(id, negocioId);
  if (!producto) throw { status: 404, message: 'Producto no encontrado' };
 
  const detalle = await repo.contarSerialesDetalle(id);
 
  // Si hay seriales comprometidos y NO se forzó la eliminación,
  // retornar advertencia con código especial para que el frontend muestre el modal
  if ((detalle.vendidos > 0 || detalle.prestados > 0) && !forzar) {
    throw {
      status:   409,
      code:     'SERIALES_COMPROMETIDOS',
      message:  'El producto tiene seriales vendidos o prestados',
      detalle,
    };
  }
 
  // Si solo hay disponibles (sin comprometidos) y no se forzó, también bloquear
  // a menos que no haya ninguno
  if (detalle.disponibles > 0 && !forzar) {
    throw {
      status:  409,
      code:    'SERIALES_DISPONIBLES',
      message: `El producto tiene ${detalle.disponibles} serial${detalle.disponibles !== 1 ? 'es' : ''} disponible${detalle.disponibles !== 1 ? 's' : ''}. Elimínalos primero o confirma la eliminación forzada.`,
      detalle,
    };
  }
 
  // Eliminar — si forzar=true, borrar todos los seriales primero
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (detalle.total > 0) {
      await repo.eliminarSerialesDeProducto(client, id);
    }
    const eliminado = await repo.eliminarProductoSerial(id);
    if (!eliminado) throw { status: 404, message: 'Producto no encontrado' };
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const getComprasCliente = async (negocioId, q) =>
  repo.findComprasCliente(negocioId, q || '');

const buscarPorImei = async (q, sucursalId, negocioId) => {
  if (!q || q.trim().length < 2) return [];
  return repo.buscarPorImei(q.trim(), sucursalId, negocioId);
};

module.exports = {
  getProductos, getProductoById, crearProducto, actualizarProducto,
  getSeriales, agregarSerial, actualizarSerial, eliminarSerial,
  verificarImei, getComprasCliente, eliminarProductoSerial, buscarPorImei,
};