const svc = require('./lineas.service');

const getLineas     = (req, res, next) =>
  svc.getLineas(req.user.negocio_id)
    .then((data) => res.json({ ok: true, data }))
    .catch(next);

const getLineaById  = (req, res, next) =>
  svc.getLineaById(req.user.negocio_id, req.params.id)
    .then((data) => res.json({ ok: true, data }))
    .catch(next);

const crearLinea    = (req, res, next) =>
  svc.crearLinea(req.user.negocio_id, req.body.nombre)
    .then((data) => res.status(201).json({ ok: true, data }))
    .catch(next);

const actualizarLinea = (req, res, next) =>
  svc.actualizarLinea(req.user.negocio_id, req.params.id, req.body.nombre)
    .then((data) => res.json({ ok: true, data }))
    .catch(next);

const eliminarLinea = (req, res, next) =>
  svc.eliminarLinea(req.user.negocio_id, req.params.id)
    .then(() => res.json({ ok: true, message: 'Línea eliminada' }))
    .catch(next);

module.exports = { getLineas, getLineaById, crearLinea, actualizarLinea, eliminarLinea };