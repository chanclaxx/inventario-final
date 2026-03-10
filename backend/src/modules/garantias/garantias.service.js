const repo = require('./garantias.repository');

const getGarantias = (negocioId) => repo.findAll(negocioId);

const getGarantiaById = async (negocioId, id) => {
  const g = await repo.findById(negocioId, id);
  if (!g) throw { status: 404, message: 'Garantía no encontrada' };
  return g;
};

const crearGarantia = (negocioId, datos) => repo.create(negocioId, datos);

const actualizarGarantia = async (negocioId, id, datos) => {
  const g = await repo.update(negocioId, id, datos);
  if (!g) throw { status: 404, message: 'Garantía no encontrada' };
  return g;
};

const eliminarGarantia = async (negocioId, id) => {
  const ok = await repo.eliminar(negocioId, id);
  if (!ok) throw { status: 404, message: 'Garantía no encontrada' };
};

module.exports = { getGarantias, getGarantiaById, crearGarantia, actualizarGarantia, eliminarGarantia };