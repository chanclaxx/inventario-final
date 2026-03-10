const service = require('./facturas.service');

const getFacturas = async (req, res, next) => {
  try {
    const data = await service.getFacturas(req.sucursal_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getFacturaById = async (req, res, next) => {
  try {
    const data = await service.getFacturaById(req.user.negocio_id, req.params.id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const crearFactura = async (req, res, next) => {
  try {
    const data = await service.crearFactura({
      ...req.body,
      sucursal_id: req.sucursal_id,
      usuario_id:  req.user.id,
    });
    res.status(201).json({ ok: true, data, message: 'Factura creada correctamente' });
  } catch (err) { next(err); }
};

const cancelarFactura = async (req, res, next) => {
  try {
    await service.cancelarFactura(req.user.negocio_id, req.params.id);
    res.json({ ok: true, message: 'Factura cancelada correctamente' });
  } catch (err) { next(err); }
};

module.exports = { getFacturas, getFacturaById, crearFactura, cancelarFactura };