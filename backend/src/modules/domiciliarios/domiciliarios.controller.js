// ─────────────────────────────────────────────────────────────────────────────
// domiciliarios.controller.js
// ─────────────────────────────────────────────────────────────────────────────
const service = require('./domiciliarios.service');

const getDomiciliarios = async (req, res, next) => {
  try {
    const data = await service.getDomiciliarios(req.user.negocio_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const crearDomiciliario = async (req, res, next) => {
  try {
    const data = await service.crearDomiciliario(req.user.negocio_id, req.body);
    res.status(201).json({ ok: true, data, message: 'Domiciliario creado correctamente' });
  } catch (err) { next(err); }
};

const actualizarDomiciliario = async (req, res, next) => {
  try {
    const data = await service.actualizarDomiciliario(
      req.user.negocio_id, req.params.id, req.body
    );
    res.json({ ok: true, data, message: 'Domiciliario actualizado correctamente' });
  } catch (err) { next(err); }
};

const getEntregas = async (req, res, next) => {
  try {
    const { domiciliario_id, estado } = req.query;
    const data = await service.getEntregas(req.user.negocio_id, {
      domiciliarioId: domiciliario_id ? Number(domiciliario_id) : undefined,
      estado:         estado || undefined,
    });
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getEntregaById = async (req, res, next) => {
  try {
    const data = await service.getEntregaById(
      Number(req.params.id), req.user.negocio_id
    );
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const registrarAbono = async (req, res, next) => {
  try {
    const data = await service.registrarAbono(
      req.user.negocio_id,
      Number(req.params.id),
      { ...req.body, usuarioId: req.user.id }
    );
    res.json({ ok: true, data, message: 'Abono registrado correctamente' });
  } catch (err) { next(err); }
};

const marcarDevolucion = async (req, res, next) => {
  try {
    await service.marcarDevolucion(
      req.user.negocio_id,
      Number(req.params.id)
    );
    res.json({ ok: true, message: 'Devolución registrada y stock revertido correctamente' });
  } catch (err) { next(err); }
};

module.exports = {
  getDomiciliarios,
  crearDomiciliario,
  actualizarDomiciliario,
  getEntregas,
  getEntregaById,
  registrarAbono,
  marcarDevolucion,
};