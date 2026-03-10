const repo = require('./config.repository');

const getConfig  = (negocioId) => repo.getMap(negocioId);
const saveConfig = (negocioId, datos) => repo.updateMany(negocioId, datos);

module.exports = { getConfig, saveConfig };