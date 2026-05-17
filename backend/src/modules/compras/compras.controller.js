const service = require('./compras.service');
const audit   = require('../../utils/auditoria.util');

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
    audit.registrar(req.user.negocio_id, req.user.id, 'Compra registrada', 'compras', data.id, {
      sucursal_id,
      valor:           Number(data.total ?? 0),
      proveedor_id:    req.body.proveedor_id,
      numero_factura:  req.body.numero_factura ?? null,
      metodo:          req.body.metodo ?? null,
      estado:          data.estado,
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

const getComprasPaginadas = async (req, res, next) => {
  try {
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const { page, limit, busqueda, fechaDesde, fechaHasta, metodo, estado } = req.query;
    const data = await service.getComprasPaginadas(sucursalId, req.user.negocio_id, {
      page:       parseInt(page)  || 1,
      limit:      parseInt(limit) || 20,
      busqueda:   busqueda   || null,
      fechaDesde: fechaDesde || null,
      fechaHasta: fechaHasta || null,
      metodo:     metodo     || null,
      estado:     estado     || null,
    });
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

module.exports = { getCompras, getCompraById, getComprasByProveedor, registrarCompra, getComprasPaginadas };