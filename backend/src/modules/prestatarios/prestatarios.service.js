const repo = require('./prestatarios.repository');

const getPrestatarios = (negocioId) => repo.findAll(negocioId);

const crearPrestatario = ({ negocio_id, nombre, telefono }) => {
  if (!nombre?.trim()) throw { status: 400, message: 'El nombre es requerido' };
  return repo.create({ negocio_id, nombre: nombre.trim(), telefono });
};

const getEmpleados = async (negocioId, prestatarioId) => {
  const prestatario = await repo.findById(prestatarioId, negocioId);
  if (!prestatario) throw { status: 404, message: 'Prestatario no encontrado' };
  return repo.getEmpleados(prestatarioId);
};

const crearEmpleado = async (negocioId, { prestatario_id, nombre }) => {
  if (!nombre?.trim()) throw { status: 400, message: 'El nombre es requerido' };
  const prestatario = await repo.findById(prestatario_id, negocioId);
  if (!prestatario) throw { status: 404, message: 'Prestatario no encontrado' };
  return repo.createEmpleado({ prestatario_id, nombre: nombre.trim() });
};

const actualizarPrestatario = async (negocioId, id, { nombre, telefono }) => {
  if (!nombre?.trim()) throw { status: 400, message: 'El nombre es requerido' };
  const updated = await repo.update(id, negocioId, { nombre: nombre.trim(), telefono });
  if (!updated) throw { status: 404, message: 'Prestatario no encontrado' };
  return updated;
};

module.exports = {
  getPrestatarios, crearPrestatario, actualizarPrestatario, getEmpleados, crearEmpleado,
};