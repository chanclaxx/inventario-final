const service  = require('./facturas.service');
const audit    = require('../../utils/auditoria.util');

const getFacturas = async (req, res, next) => {
  try {
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const data = await service.getFacturas(sucursalId, req.user.negocio_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getFacturasRecientes = async (req, res, next) => {
  try {
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const cursor     = req.query.cursor || null;
    const dias       = req.query.dias ? Number(req.query.dias) : 5;
    const data = await service.getFacturasRecientes(sucursalId, req.user.negocio_id, { cursor, dias });
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const buscarFacturas = async (req, res, next) => {
  try {
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const { q, desde, hasta } = req.query;
    const limit  = req.query.limit  ? Math.min(Number(req.query.limit), 200) : 100;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const data = await service.buscarFacturas(sucursalId, req.user.negocio_id, { q, desde, hasta, limit, offset });
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
      negocio_id: req.user.negocio_id,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Venta registrada', 'facturas', data.id, {
      sucursal_id,
      cliente:  data.nombre_cliente,
      cedula:   data.cedula,
      valor:    Number(data.total ?? 0),
      estado:   data.estado,
    });
    res.status(201).json({ ok: true, data, message: 'Factura creada correctamente' });
  } catch (err) { next(err); }
};

const cancelarFactura = async (req, res, next) => {
  try {
    const eliminarRetoma = req.body?.eliminarRetoma === true;
    await service.cancelarFactura(req.user.negocio_id, req.params.id, eliminarRetoma);
    audit.registrar(req.user.negocio_id, req.user.id, 'Venta cancelada', 'facturas', Number(req.params.id), {
      sucursal_id: req.sucursal_id,
    });
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
    audit.registrar(req.user.negocio_id, req.user.id, 'Venta editada', 'facturas', Number(req.params.id), {
      sucursal_id: data?.sucursal_id ?? req.sucursal_id ?? null,
      cliente:     data?.nombre_cliente ?? null,
      valor:       Number(data?.total ?? 0),
      estado:      data?.estado ?? null,
    });
    res.json({ ok: true, data, message: 'Factura actualizada correctamente' });
  } catch (err) { next(err); }
};

const devolverLineasCredito = async (req, res, next) => {
  try {
    const { lineas } = req.body;
    const data = await service.devolverLineasCredito(
      req.user.negocio_id,
      req.params.id,
      lineas,
    );
    audit.registrar(req.user.negocio_id, req.user.id, 'Devolución en venta a crédito', 'facturas', Number(req.params.id), {
      sucursal_id: data?.sucursal_id ?? req.sucursal_id ?? null,
      cliente:     data?.nombre_cliente ?? null,
      lineas:      Array.isArray(lineas) ? lineas.length : null,
      valor:       Number(data?.valor_devuelto ?? data?.total_devuelto ?? 0),
    });
    res.json({ ok: true, data, message: 'Devolución registrada correctamente' });
  } catch (err) { next(err); }
};

module.exports = {
  getFacturas, getFacturasRecientes, buscarFacturas,
  getFacturaById, crearFactura, cancelarFactura, editarFactura,
  devolverLineasCredito,
};