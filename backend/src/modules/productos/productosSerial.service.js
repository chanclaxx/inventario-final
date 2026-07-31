const { pool } = require('../../config/db');
const repo     = require('./productosSerial.repository');
const { fechaHoyColombia } = require('../../utils/fecha.util');
const { normalizarUbicacion } = require('../../utils/ubicacion.util');

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

  // La ubicación es de la referencia, no de cada IMEI.
  return repo.create({ ...datos, ubicacion: normalizarUbicacion(datos.ubicacion) });
};

const actualizarProducto = async (negocioId, id, datos) => {
  const producto = await repo.findByIdYNegocio(id, negocioId);
  if (!producto) throw { status: 404, message: 'Producto no encontrado' };

  if (datos.linea_id) {
    await _verificarLineaNegocio(datos.linea_id, negocioId);
  }

  const actualizado = await repo.update(id, { ...datos, ubicacion: normalizarUbicacion(datos.ubicacion) });
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

  const seriales = await repo.getSeriales(productoId, vendido);

  // En un local de la red interna el costo que vale para calcular tarifas es el
  // valor interno de la remisión, no `costo_compra` (que es el de la bodega).
  // Fuera de ese caso devuelve la lista intacta: require lazy para no acoplar
  // el inventario con la red cuando el negocio no la usa.
  const { anotarConsignacionSeriales } = require('../red-interna/redInterna.service');
  return anotarConsignacionSeriales(seriales, {
    negocioId, sucursalId: producto.sucursal_id,
  });
};

const agregarSerial = async (
  negocioId,
  productoId,
  { imei, fecha_entrada, costo_compra, cliente_origen, proveedor_id, reactivar_serial_id, color, caracteristicas }
) => {
  const producto = await repo.perteneceAlNegocio(productoId, negocioId);
  if (!producto) throw { status: 404, message: 'Producto no encontrado' };

  if (reactivar_serial_id) {
    // Solo se reactiva un serial VENDIDO que regresa; validado dentro del negocio.
    const serial = await repo.findSerialByIdYNegocio(reactivar_serial_id, negocioId);
    if (!serial) throw { status: 404, message: 'Serial a reactivar no encontrado' };
    if (serial.prestado) {
      throw { status: 409, code: 'IMEI_PRESTADO', message: `El IMEI ${serial.imei} está prestado. Ve a la pestaña de Préstamos y regístralo como devuelto para que regrese al inventario.` };
    }
    if (!serial.vendido) {
      throw { status: 409, message: `El IMEI ${serial.imei} ya está registrado y disponible en el inventario.` };
    }
    const reactivado = await repo.reactivarSerial(reactivar_serial_id, {
      costo_compra: costo_compra ?? null,
      proveedor_id: proveedor_id || null,
    });
    return {
      ...reactivado,
      producto_nombre: serial.producto_nombre ?? null,
      sucursal_id:     serial.sucursal_id     ?? null,
      reactivado:      true,
    };
  }

  const existe = await repo.findSerialByIMEIEnNegocio(imei, negocioId);
  if (existe) throw { status: 409, message: `El IMEI ${imei} ya está registrado` };

  const creado = await repo.insertarSerial({
    producto_id:    productoId,
    imei,
    fecha_entrada:  fecha_entrada || fechaHoyColombia(),
    costo_compra:   costo_compra  ?? null,
    cliente_origen: cliente_origen || null,
    proveedor_id:   proveedor_id   || null,
    color:          color          || null,
    caracteristicas: caracteristicas || null,
  });
  return {
    ...creado,
    producto_nombre: producto.nombre      ?? null,
    sucursal_id:     producto.sucursal_id ?? null,
    reactivado:      false,
  };
};

const actualizarSerial = async (negocioId, serialId, { imei, costo_compra, precio, color, caracteristicas, nota }) => {
  const serial = await repo.findSerialByIdYNegocio(serialId, negocioId);
  if (!serial) throw { status: 404, message: 'Serial no encontrado' };

  // Price is stored on the individual serial (not on the product) so other serials are unaffected
  const actualizado = await repo.actualizarSerial(serialId, { imei, costo_compra, precio, color, caracteristicas, nota });
  if (!actualizado) throw { status: 404, message: 'Serial no encontrado' };

  return {
    ...actualizado,
    producto_nombre: serial.producto_nombre ?? null,
    sucursal_id:     serial.sucursal_id     ?? null,
    imei_anterior:   serial.imei,
    precio_anterior: serial.precio ?? null,
  };
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

  return serial;
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