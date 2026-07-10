const { ejecutarBackup, listarBackups, generarUrlDescarga } = require('./backup.service');

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

const descargarBackup = async (req, res, next) => {
  try {
    const url = await generarUrlDescarga(req.params.nombre);
    res.json({ ok: true, data: { url, expira_en_segundos: 300 } });
  } catch (err) {
    next(err);
  }
};

module.exports = { hacerBackup, getBackups, descargarBackup };
