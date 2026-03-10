const service = require('./config.service');

const getConfig = async (req, res, next) => {
  try {
    const data = await service.getConfig(req.user.negocio_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const saveConfig = async (req, res, next) => {
  try {
    const data = await service.saveConfig(req.user.negocio_id, req.body);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

module.exports = { getConfig, saveConfig };