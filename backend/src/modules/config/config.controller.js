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

// Recibe { pin } en el body, responde { ok: true, valido: true/false }.
// Nunca expone el hash ni el PIN almacenado.
const verificarPin = async (req, res, next) => {
  try {
    const { pin } = req.body;
    if (!pin) {
      return res.status(400).json({ ok: false, error: 'PIN requerido' });
    }
    const valido = await service.verificarPin(req.user.negocio_id, pin);
    res.json({ ok: true, valido });
  } catch (err) { next(err); }
};

module.exports = { getConfig, saveConfig, verificarPin };