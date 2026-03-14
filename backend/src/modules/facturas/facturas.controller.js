const service = require('./facturas.service');

const getFacturas = async (req, res, next) => {
  try {
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const data = await service.getFacturas(sucursalId, req.user.negocio_id);
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
    const sucursal_id = req.todasSucursales
      ? req.body.sucursal_id
      : req.sucursal_id;

    if (!sucursal_id) {
      return res.status(400).json({
        ok: false,
        error: 'Debes indicar la sucursal donde se emite la factura',
      });
    }

    const data = await service.crearFactura({
      ...req.body,
      sucursal_id,
      usuario_id: req.user.id,
      negocio_id: req.user.negocio_id, // necesario para resolver/crear cliente
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

const editarFactura = async (req, res, next) => {
  try {
    const data = await service.editarFactura(
      req.user.negocio_id,
      req.params.id,
      req.body,
    );
    res.json({ ok: true, data, message: 'Factura actualizada correctamente' });
  } catch (err) { next(err); }
};

module.exports = { getFacturas, getFacturaById, crearFactura, cancelarFactura, editarFactura };