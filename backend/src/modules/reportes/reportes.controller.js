const service = require('./reportes.service');

const getDashboard = async (req, res, next) => {
  try {
    const data = await service.getDashboard(req.sucursal_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getVentasRango = async (req, res, next) => {
  try {
    const { desde, hasta } = req.query;
    if (!desde || !hasta) {
      return res.status(400).json({ ok: false, error: 'Los parámetros desde y hasta son requeridos' });
    }
    const data = await service.getVentasRango(req.sucursal_id, desde, hasta);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getProductosTop = async (req, res, next) => {
  try {
    const { desde, hasta } = req.query;
    if (!desde || !hasta) {
      return res.status(400).json({ ok: false, error: 'Los parámetros desde y hasta son requeridos' });
    }
    const data = await service.getProductosTop(req.sucursal_id, desde, hasta);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getInventarioBajo = async (req, res, next) => {
  try {
    const data = await service.getInventarioBajo(req.sucursal_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

module.exports = { getDashboard, getVentasRango, getProductosTop, getInventarioBajo };