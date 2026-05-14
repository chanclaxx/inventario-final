const repo = require('./tipos-caracteristica.repository');

const getTipos = (negocioId) => repo.findAll(negocioId);

const crearTipo = async (negocioId, { nombre, valores, orden }) => {
  if (!nombre?.trim()) throw { status: 400, message: 'El nombre es requerido' };
  const existe = await repo.findByNombre(nombre, negocioId);
  if (existe) throw { status: 409, message: `Ya existe un tipo "${nombre.trim()}"` };
  return repo.create(negocioId, { nombre, valores: valores || [], orden: orden ?? 0 });
};

const actualizarTipo = async (negocioId, id, datos) => {
  const tipo = await repo.findById(id, negocioId);
  if (!tipo) throw { status: 404, message: 'Tipo no encontrado' };
  if (datos.nombre) {
    const existe = await repo.findByNombre(datos.nombre, negocioId);
    if (existe && existe.id !== Number(id)) {
      throw { status: 409, message: `Ya existe un tipo "${datos.nombre.trim()}"` };
    }
  }
  const actualizado = await repo.update(id, negocioId, datos);
  if (!actualizado) throw { status: 404, message: 'Tipo no encontrado' };
  return actualizado;
};

const eliminarTipo = async (negocioId, id) => {
  const tipo = await repo.findById(id, negocioId);
  if (!tipo) throw { status: 404, message: 'Tipo no encontrado' };
  const enUso = await repo.tieneHijosActivos(id);
  if (enUso) {
    throw {
      status: 409,
      message: 'No se puede eliminar: este tipo está en uso en atributos o variantes activos',
    };
  }
  const ok = await repo.eliminar(id, negocioId);
  if (!ok) throw { status: 404, message: 'Tipo no encontrado' };
};

module.exports = { getTipos, crearTipo, actualizarTipo, eliminarTipo };
