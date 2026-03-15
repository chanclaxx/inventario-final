const { ejecutarBackup, listarBackups } = require('./backup.service');

const hacerBackup = async (req, res, next) => {
  try {
    const resultado = await ejecutarBackup();
    res.json({ ok: true, data: resultado });
  } catch (err) {
    next(err);
  }
};

const getBackups = async (req, res, next) => {
  try {
    const backups = await listarBackups();
    res.json({ ok: true, data: backups });
  } catch (err) {
    next(err);
  }
};

module.exports = { hacerBackup, getBackups };