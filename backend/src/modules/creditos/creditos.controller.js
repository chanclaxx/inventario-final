const service = require('./creditos.service');

const getCreditos = async (req, res, next) => {
  try {
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const data = await service.getCreditos(sucursalId, req.user.negocio_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getCreditoById = async (req, res, next) => {
  try {
    const data = await service.getCreditoById(req.user.negocio_id, Number(req.params.id));
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const registrarAbono = async (req, res, next) => {
  try {
    const data = await service.registrarAbono(req.user.negocio_id, Number(req.params.id), {
      ...req.body,
      usuario_id: req.user.id,
    });
    res.json({ ok: true, data, message: 'Abono registrado correctamente' });
  } catch (err) { next(err); }
};

const saldarCredito = async (req, res, next) => {
  try {
    await service.saldarCredito(req.user.negocio_id, Number(req.params.id));
    res.json({ ok: true, message: 'Crédito saldado correctamente' });
  } catch (err) { next(err); }
};

module.exports = { getCreditos, getCreditoById, registrarAbono, saldarCredito };