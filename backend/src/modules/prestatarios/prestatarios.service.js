const repo = require('./prestatarios.repository');

const getPrestatarios = (negocioId) => repo.findAll(negocioId);

const crearPrestatario = ({ negocio_id, nombre, telefono }) => {
  if (!nombre?.trim()) throw { status: 400, message: 'El nombre es requerido' };
  return repo.create({ negocio_id, nombre: nombre.trim(), telefono });
};

const getEmpleados = async (prestatarioId) => {
  const prestatario = await repo.findById(prestatarioId);
  if (!prestatario) throw { status: 404, message: 'Prestatario no encontrado' };
  return repo.getEmpleados(prestatarioId);
};

const crearEmpleado = async ({ prestatario_id, nombre }) => {
  if (!nombre?.trim()) throw { status: 400, message: 'El nombre es requerido' };
  const prestatario = await repo.findById(prestatario_id);
  if (!prestatario) throw { status: 404, message: 'Prestatario no encontrado' };
  return repo.createEmpleado({ prestatario_id, nombre: nombre.trim() });
};

module.exports = { getPrestatarios, crearPrestatario, getEmpleados, crearEmpleado };