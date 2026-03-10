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

const agregarSerial = async (negocioId, productoId, { imei, fecha_entrada, costo_compra, cliente_origen }) => {
  const valido = await repo.perteneceAlNegocio(productoId, negocioId);
  if (!valido) throw { status: 404, message: 'Producto no encontrado' };

  const existe = await repo.findSerialByIMEI(imei);
  if (existe) throw { status: 409, message: `El IMEI ${imei} ya está registrado` };

  return repo.insertarSerial({
    producto_id:    productoId,
    imei,
    fecha_entrada:  fecha_entrada || new Date().toISOString().split('T')[0],
    costo_compra:   costo_compra  || null,
    cliente_origen: cliente_origen || null,
  });
};

const actualizarSerial = async (serialId, datos) => {
  const serial = await repo.actualizarSerial(serialId, datos);
  if (!serial) throw { status: 404, message: 'Serial no encontrado' };
  return serial;
};

const eliminarSerial = async (serialId) => {
  const eliminado = await repo.eliminarSerial(serialId);
  if (!eliminado) throw { status: 404, message: 'Serial no encontrado' };
};

module.exports = {
  getProductos, getProductoById, crearProducto, actualizarProducto,
  getSeriales, agregarSerial, actualizarSerial, eliminarSerial,
};