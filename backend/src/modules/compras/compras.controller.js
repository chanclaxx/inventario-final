const service = require('./compras.service');

const getCompras = async (req, res, next) => {
  try {
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const data = await service.getCompras(sucursalId, req.user.negocio_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getCompraById = async (req, res, next) => {
  try {
    const data = await service.getCompraById(req.user.negocio_id, req.params.id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const registrarCompra = async (req, res, next) => {
  try {
    const sucursal_id = req.todasSucursales
      ? req.body.sucursal_id
      : req.sucursal_id;

    if (!sucursal_id) {
      return res.status(400).json({
        ok: false,
        error: 'Debes indicar la sucursal donde se registra la compra',
      });
    }

    const data = await service.registrarCompra({
      ...req.body,
      negocio_id:  req.user.negocio_id,
      sucursal_id,
      usuario_id:  req.user.id,
    });
    res.status(201).json({ ok: true, data, message: 'Compra registrada correctamente' });
  } catch (err) { next(err); }
};

const getComprasByProveedor = async (req, res, next) => {
  try {
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const data = await service.getComprasByProveedor(
      req.params.proveedorId,
      sucursalId,
      req.user.negocio_id,
    );
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

module.exports = { getCompras, getCompraById, getComprasByProveedor, registrarCompra };