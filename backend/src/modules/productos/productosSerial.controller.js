const service = require('./productosSerial.service');

const getProductos = async (req, res, next) => {
  try {
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const lineaId    = req.query.linea_id ? Number(req.query.linea_id) : null;
    const data = await service.getProductos(sucursalId, req.user.negocio_id, lineaId);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getProductoById = async (req, res, next) => {
  try {
    const data = await service.getProductoById(req.user.negocio_id, req.params.id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const crearProducto = async (req, res, next) => {
  try {
    const data = await service.crearProducto(req.user.negocio_id, {
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

const eliminarProductoSerial = async (req, res, next) => {
  try {
    // forzar=true viene en el body cuando el usuario confirmó la advertencia
    const forzar = req.body?.forzar === true;
    await service.eliminarProductoSerial(req.user.negocio_id, Number(req.params.id), forzar);
    res.json({ ok: true, message: 'Producto eliminado correctamente' });
  } catch (err) {
    // Si es advertencia de seriales comprometidos, retornar 409 con detalle
    // para que el frontend pueda mostrar el modal de confirmación
    if (err.code === 'SERIALES_COMPROMETIDOS' || err.code === 'SERIALES_DISPONIBLES') {
      return res.status(409).json({
        ok:      false,
        code:    err.code,
        error:   err.message,
        detalle: err.detalle,
      });
    }
    next(err);
  }
};

const getSeriales = async (req, res, next) => {
  try {
    const vendido = req.query.vendido !== undefined ? req.query.vendido === 'true' : null;
    const data    = await service.getSeriales(req.user.negocio_id, req.params.id, vendido);
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
    const data = await service.actualizarSerial(req.user.negocio_id, req.params.id, req.body);
    res.json({ ok: true, data, message: 'Serial actualizado correctamente' });
  } catch (err) { next(err); }
};

const eliminarSerial = async (req, res, next) => {
  try {
    await service.eliminarSerial(req.user.negocio_id, req.params.id);
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
  eliminarProductoSerial,
  getSeriales, agregarSerial, actualizarSerial, eliminarSerial,
  verificarImei, getComprasCliente,
};