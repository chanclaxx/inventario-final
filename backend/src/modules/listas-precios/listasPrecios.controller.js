const svc = require('./listasPrecios.service');

const guardarPrecios = (req, res, next) =>
  svc.guardarPrecios(req.body?.nodos, req.user.negocio_id)
    .then((data) => res.json({ ok: true, data }))
    .catch(next);

const getPreciosProducto = (req, res, next) =>
  svc.getPreciosProducto(req.params.productoId, req.user.negocio_id)
    .then((data) => res.json({ ok: true, data }))
    .catch(next);

module.exports = { guardarPrecios, getPreciosProducto };
