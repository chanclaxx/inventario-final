const repo = require('./productosSerial.repository');

const getProductos = (sucursalId) => repo.findAll(sucursalId);

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

const getSeriales = async (productoId, vendido) => {
  await getProductoById(productoId);
  return repo.getSeriales(productoId, vendido);
};

/**
 * Agrega un serial a un producto.
 *
 * Si viene reactivar_serial_id: reactiva el serial existente (UPDATE)
 * en lugar de insertar uno nuevo. Esto ocurre cuando el frontend detectó
 * que el IMEI ya existe y el usuario confirmó reactivarlo.
 */
const agregarSerial = async (
  negocioId,
  productoId,
  { imei, fecha_entrada, costo_compra, cliente_origen, proveedor_id, reactivar_serial_id }
) => {
  const valido = await repo.perteneceAlNegocio(productoId, negocioId);
  if (!valido) throw { status: 404, message: 'Producto no encontrado' };

  // CASO A: usuario confirmó reactivar — UPDATE del serial existente
  if (reactivar_serial_id) {
    return repo.reactivarSerial(reactivar_serial_id, {
      costo_compra: costo_compra ?? null,
      proveedor_id: proveedor_id || null,
    });
  }

  // CASO B: serial nuevo — verificar que no exista antes de insertar
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

// Actualiza el serial (imei, costo_compra) y si viene precio,
// actualiza también el producto padre en productos_serial.
const actualizarSerial = async (serialId, { imei, costo_compra, precio, producto_id }) => {
  const serial = await repo.actualizarSerial(serialId, { imei, costo_compra });
  if (!serial) throw { status: 404, message: 'Serial no encontrado' };

  if (precio !== undefined && producto_id) {
    await repo.updatePrecio(producto_id, precio);
  }

  return serial;
};

const eliminarSerial = async (serialId) => {
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

module.exports = {
  getProductos, getProductoById, crearProducto, actualizarProducto,
  getSeriales, agregarSerial, actualizarSerial, eliminarSerial,
  verificarImei,
};