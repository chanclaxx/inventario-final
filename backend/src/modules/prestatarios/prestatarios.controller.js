const service = require('./prestatarios.service');

const getPrestatarios = async (req, res, next) => {
  try {
    const data = await service.getPrestatarios(req.user.negocio_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const crearPrestatario = async (req, res, next) => {
  try {
    const data = await service.crearPrestatario({
      ...req.body,
      negocio_id: req.user.negocio_id,
    });
    res.status(201).json({ ok: true, data });
  } catch (err) { next(err); }
};

const getEmpleados = async (req, res, next) => {
  try {
    const data = await service.getEmpleados(req.params.id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const crearEmpleado = async (req, res, next) => {
  try {
    const data = await service.crearEmpleado({
      prestatario_id: req.params.id,
      nombre: req.body.nombre,
    });
    res.status(201).json({ ok: true, data });
  } catch (err) { next(err); }
};

module.exports = { getPrestatarios, crearPrestatario, getEmpleados, crearEmpleado };