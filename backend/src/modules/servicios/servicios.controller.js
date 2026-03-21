const service = require('./servicios.service');

const getOrdenes = async (req, res, next) => {
  try {
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const data = await service.getOrdenes(sucursalId, req.user.negocio_id, req.query);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getOrdenById = async (req, res, next) => {
  try {
    const data = await service.getOrdenById(req.user.negocio_id, req.params.id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getResumenHoy = async (req, res, next) => {
  try {
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const data = await service.getResumenHoy(sucursalId, req.user.negocio_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const crearOrden = async (req, res, next) => {
  try {
    const sucursal_id = req.todasSucursales ? req.body.sucursal_id : req.sucursal_id;
    if (!sucursal_id) return res.status(400).json({ ok: false, error: 'Sucursal requerida' });
    const data = await service.crearOrden({
      ...req.body,
      sucursal_id,
      negocio_id: req.user.negocio_id,
      usuario_id: req.user.id,
    });
    res.status(201).json({ ok: true, data, message: 'Orden creada correctamente' });
  } catch (err) { next(err); }
};

const enReparacion = async (req, res, next) => {
  try {
    const data = await service.enReparacion(req.user.negocio_id, req.params.id);
    res.json({ ok: true, data, message: 'Orden en reparación' });
  } catch (err) { next(err); }
};

const marcarListo = async (req, res, next) => {
  try {
    const data = await service.marcarListo(req.user.negocio_id, req.params.id, req.body);
    res.json({ ok: true, data, message: 'Orden marcada como lista' });
  } catch (err) { next(err); }
};

const registrarAbono = async (req, res, next) => {
  try {
    const data = await service.registrarAbono(req.user.negocio_id, req.params.id, {
      ...req.body,
      usuarioId: req.user.id,
      cajaId:    req.caja_id || null,
    });
    res.json({ ok: true, data, message: 'Abono registrado correctamente' });
  } catch (err) { next(err); }
};

const entregar = async (req, res, next) => {
  try {
    const data = await service.entregar(req.user.negocio_id, req.params.id);
    // Informar al frontend si quedó Pendiente_pago
    const msg = data.estado === 'Pendiente_pago'
      ? `Equipo entregado con saldo pendiente de $${Number(data.saldo_al_entregar || 0).toLocaleString('es-CO')}`
      : 'Equipo entregado correctamente';
    res.json({ ok: true, data, message: msg });
  } catch (err) { next(err); }
};

const sinReparar = async (req, res, next) => {
  try {
    const data = await service.sinReparar(req.user.negocio_id, req.params.id, {
      ...req.body,
      usuario_id: req.user.id,
      caja_id:    req.caja_id || null,
    });
    res.json({ ok: true, data, message: 'Orden cerrada sin reparación' });
  } catch (err) { next(err); }
};

const abrirGarantia = async (req, res, next) => {
  try {
    const data = await service.abrirGarantia(req.user.negocio_id, req.params.id, req.body);
    res.json({ ok: true, data, message: 'Garantía activada' });
  } catch (err) { next(err); }
};

const actualizarNotas = async (req, res, next) => {
  try {
    const data = await service.actualizarNotas(
      req.user.negocio_id, req.params.id, req.body.notas_tecnico
    );
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

module.exports = {
  getOrdenes, getOrdenById, getResumenHoy,
  crearOrden, enReparacion, marcarListo,
  registrarAbono, entregar, sinReparar,
  abrirGarantia, actualizarNotas,
};