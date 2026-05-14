const svc = require('./tipos-caracteristica.service');

const getTipos = (req, res, next) =>
  svc.getTipos(req.user.negocio_id)
    .then((data) => res.json({ ok: true, data }))
    .catch(next);

const crearTipo = (req, res, next) =>
  svc.crearTipo(req.user.negocio_id, req.body)
    .then((data) => res.status(201).json({ ok: true, data }))
    .catch(next);

const actualizarTipo = (req, res, next) =>
  svc.actualizarTipo(req.user.negocio_id, req.params.id, req.body)
    .then((data) => res.json({ ok: true, data }))
    .catch(next);

const eliminarTipo = (req, res, next) =>
  svc.eliminarTipo(req.user.negocio_id, req.params.id)
    .then(() => res.json({ ok: true, message: 'Tipo eliminado' }))
    .catch(next);

module.exports = { getTipos, crearTipo, actualizarTipo, eliminarTipo };
