const svc    = require('./variantes-producto.service');
const costos = require('../../utils/costos.util');

// El árbol es la única consulta con costo ANIDADO: cada atributo trae sus
// variantes dentro, y el costo existe en los tres niveles. Por eso `anidados`.
const getArbol = (req, res, next) =>
  svc.getArbol(req.user.negocio_id, req.params.productoId, req.query.sucursal_id)
    .then((data) => costos.recortarSiToca(req.user, data, { anidados: ['variantes'] }))
    .then((data) => res.json({ ok: true, data }))
    .catch(next);

const crearAtributo = (req, res, next) =>
  svc.crearAtributo(req.user.negocio_id, req.params.productoId, req.body)
    .then((data) => res.status(201).json({ ok: true, data }))
    .catch(next);

const actualizarAtributo = (req, res, next) =>
  svc.actualizarAtributo(req.user.negocio_id, req.params.id, req.body)
    .then((data) => res.json({ ok: true, data }))
    .catch(next);

const eliminarAtributo = (req, res, next) =>
  svc.eliminarAtributo(req.user.negocio_id, req.params.id)
    .then(() => res.json({ ok: true, message: 'Atributo eliminado' }))
    .catch(next);

const ajustarStockAtributo = (req, res, next) =>
  svc.ajustarStockAtributo(req.user.negocio_id, req.params.id, req.body.cantidad, req.body)
    .then(() => res.json({ ok: true, message: 'Stock ajustado' }))
    .catch(next);

const crearVariante = (req, res, next) =>
  svc.crearVariante(req.user.negocio_id, req.params.atributoId, req.body)
    .then((data) => res.status(201).json({ ok: true, data }))
    .catch(next);

const actualizarVariante = (req, res, next) =>
  svc.actualizarVariante(req.user.negocio_id, req.params.id, req.body)
    .then((data) => res.json({ ok: true, data }))
    .catch(next);

const eliminarVariante = (req, res, next) =>
  svc.eliminarVariante(req.user.negocio_id, req.params.id)
    .then(() => res.json({ ok: true, message: 'Variante eliminada' }))
    .catch(next);

const ajustarStockVariante = (req, res, next) =>
  svc.ajustarStockVariante(req.user.negocio_id, req.params.id, req.body.cantidad, req.body)
    .then(() => res.json({ ok: true, message: 'Stock ajustado' }))
    .catch(next);

module.exports = {
  getArbol,
  crearAtributo, actualizarAtributo, eliminarAtributo, ajustarStockAtributo,
  crearVariante, actualizarVariante, eliminarVariante, ajustarStockVariante,
};
