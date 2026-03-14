const service = require('./productosSerial.service');

// Solo esta función cambia — el resto del controller queda idéntico
const getProductos = async (req, res, next) => {
  try {
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const data = await service.getProductos(sucursalId, req.user.negocio_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getProductoById = async (req, res, next) => {
  try {
    const data = await service.getProductoById(req.user.negocio_id, req.params.id); // ← agregar negocio_id
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const crearProducto = async (req, res, next) => {
  try {
    const data = await service.crearProducto(req.user.negocio_id, { // ← agregar negocio_id
      ...req.body,
      sucursal_id: req.sucursal_id,
    });
    res.status(201).json({ ok: true, data, message: 'Producto creado correctamente' });
  } catch (err) { next(err); }
};

const actualizarProducto = async (req, res, next) => {
  try {
    const data = await service.actualizarProducto(req.user.negocio_id, req.params.id, req.body);
    res.json({ ok: true, data, message: 'Producto actualizado correctamente' });
  } catch (err) { next(err); }
};


const getSeriales = async (req, res, next) => {
  try {
    const vendido = req.query.vendido !== undefined ? req.query.vendido === 'true' : null;
    const data = await service.getSeriales(req.user.negocio_id, req.params.id, vendido); // ← agregar negocio_id
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const agregarSerial = async (req, res, next) => {
  try {
    const data = await service.agregarSerial(req.user.negocio_id, req.params.id, req.body);
    res.status(201).json({ ok: true, data, message: 'IMEI agregado correctamente' });
  } catch (err) { next(err); }
};

const actualizarSerial = async (req, res, next) => {
  try {
    const data = await service.actualizarSerial(req.user.negocio_id, req.params.id, req.body); // ← agregar negocio_id
    res.json({ ok: true, data, message: 'Serial actualizado correctamente' });
  } catch (err) { next(err); }
};

const eliminarSerial = async (req, res, next) => {
  try {
    await service.eliminarSerial(req.user.negocio_id, req.params.id); // ← agregar negocio_id
    res.json({ ok: true, message: 'Serial eliminado correctamente' });
  } catch (err) { next(err); }
};

const verificarImei = async (req, res, next) => {
  try {
    const { imei } = req.params;
    if (!imei || imei.trim().length < 5) {
      return res.status(400).json({ ok: false, error: 'IMEI inválido' });
    }
    const data = await service.verificarImei(imei.trim(), req.user.negocio_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};
const getComprasCliente = async (req, res, next) => {
  try {
    const q    = req.query.q || '';
    const data = await service.getComprasCliente(req.user.negocio_id, q);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

module.exports = {
  getProductos, getProductoById, crearProducto, actualizarProducto,
  getSeriales, agregarSerial, actualizarSerial, eliminarSerial,
  verificarImei,getComprasCliente
};