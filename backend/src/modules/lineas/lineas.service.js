const repo = require('./lineas.repository');

const getLineas = (negocioId) => repo.findAll(negocioId);

const getLineaById = async (negocioId, id) => {
  const linea = await repo.findById(id, negocioId);
  if (!linea) throw { status: 404, message: 'Línea no encontrada' };
  return linea;
};

const crearLinea = async (negocioId, nombre) => {
  if (!nombre?.trim()) throw { status: 400, message: 'El nombre es requerido' };

  const existe = await repo.findByNombre(nombre, negocioId);
  if (existe) throw { status: 409, message: `Ya existe una línea con el nombre "${nombre.trim()}"` };

  return repo.create(negocioId, nombre);
};

const actualizarLinea = async (negocioId, id, nombre) => {
  if (!nombre?.trim()) throw { status: 400, message: 'El nombre es requerido' };

  const linea = await repo.findById(id, negocioId);
  if (!linea) throw { status: 404, message: 'Línea no encontrada' };

  // ── Verificar nombre duplicado excluyendo la línea actual ──
  const existe = await repo.findByNombre(nombre, negocioId);
  if (existe && existe.id !== Number(id)) {
    throw { status: 409, message: `Ya existe una línea con el nombre "${nombre.trim()}"` };
  }

  const actualizada = await repo.update(id, negocioId, nombre);
  if (!actualizada) throw { status: 404, message: 'Línea no encontrada' };
  return actualizada;
};

const eliminarLinea = async (negocioId, id) => {
  const linea = await repo.findById(id, negocioId);
  if (!linea) throw { status: 404, message: 'Línea no encontrada' };

  // ── Advertir si tiene productos asociados ──
  const totalProductos = await repo.contarProductos(id, negocioId);
  if (totalProductos > 0) {
    throw {
      status: 409,
      message: `No se puede eliminar: la línea tiene ${totalProductos} producto(s) asociado(s). Reasígnalos primero.`,
    };
  }

  const ok = await repo.eliminar(id, negocioId);
  if (!ok) throw { status: 404, message: 'Línea no encontrada' };
};

module.exports = { getLineas, getLineaById, crearLinea, actualizarLinea, eliminarLinea };