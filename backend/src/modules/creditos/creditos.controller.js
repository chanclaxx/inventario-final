const service = require('./creditos.service');

const getCreditos = async (req, res, next) => {
  try {
    const data = await service.getCreditos(req.sucursal_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getCreditoById = async (req, res, next) => {
  try {
    const data = await service.getCreditoById(req.user.negocio_id, req.params.id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const registrarAbono = async (req, res, next) => {
  try {
    const data = await service.registrarAbono(req.user.negocio_id, req.params.id, {
      ...req.body,
      usuario_id: req.user.id,
    });
    res.json({ ok: true, data, message: 'Abono registrado correctamente' });
  } catch (err) { next(err); }
};

module.exports = { getCreditos, getCreditoById, registrarAbono };