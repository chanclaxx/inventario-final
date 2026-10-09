const repo = require('./prestatarios.repository');

const getPrestatarios = (negocioId) => repo.findAll(negocioId);

// Un compañero (y cada empleado suyo) solo se identifica por el NOMBRE, así
// que dos nombres que solo difieren en tildes, mayúsculas o espacios son la
// misma persona partida en dos cuentas. Se rechaza con el que ya existe en
// `detalle.existente`, para que la pantalla lo seleccione en vez de crearlo.
const _yaExiste = (code, quien, existente) => ({
  status: 409, code,
  message: `Ya existe ${quien} «${existente.nombre}». Selecciónalo en la lista en vez de crearlo otra vez.`,
  detalle: { existente },
});

const crearPrestatario = async ({ negocio_id, nombre, telefono }) => {
  if (!nombre?.trim()) throw { status: 400, message: 'El nombre es requerido' };
  const existente = await repo.findHomonimo(negocio_id, nombre);
  if (existente) throw _yaExiste('PRESTATARIO_EXISTE', 'un compañero llamado', existente);
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
  const existente = await repo.findEmpleadoHomonimo(prestatario_id, nombre);
  if (existente) throw _yaExiste('EMPLEADO_EXISTE', 'un empleado llamado', existente);
  return repo.createEmpleado({ prestatario_id, nombre: nombre.trim() });
};

const actualizarPrestatario = async (negocioId, id, { nombre, telefono }) => {
  if (!nombre?.trim()) throw { status: 400, message: 'El nombre es requerido' };
  // Renombrar tampoco puede fundir dos compañeros en el mismo nombre.
  const otro = await repo.findHomonimo(negocioId, nombre, Number(id) || null);
  if (otro) throw _yaExiste('PRESTATARIO_EXISTE', 'otro compañero llamado', otro);
  const updated = await repo.update(id, negocioId, { nombre: nombre.trim(), telefono });
  if (!updated) throw { status: 404, message: 'Prestatario no encontrado' };
  return updated;
};

module.exports = {
  getPrestatarios, crearPrestatario, actualizarPrestatario, getEmpleados, crearEmpleado,
};
