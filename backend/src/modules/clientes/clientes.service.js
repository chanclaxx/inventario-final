const repo = require('./clientes.repository');

const getClientes = (negocioId, filtro) => repo.findAll(negocioId, filtro);

const getClienteById = async (negocioId, id) => {
  const cliente = await repo.findById(negocioId, id);
  if (!cliente) throw { status: 404, message: 'Cliente no encontrado' };
  const historial = await repo.getHistorialCompras(negocioId, cliente.cedula);
  return { ...cliente, historial };
};

const buscarPorCedula = (negocioId, cedula) => repo.findByCedula(negocioId, cedula);

const crearCliente = async (negocioId, datos) => {
  const existe = await repo.findByCedula(negocioId, datos.cedula);
  if (existe) throw { status: 409, message: 'Ya existe un cliente con esa cédula' };
  return repo.create(negocioId, datos);
};

const actualizarCliente = async (negocioId, id, datos) => {
  const cliente = await repo.update(negocioId, id, datos);
  if (!cliente) throw { status: 404, message: 'Cliente no encontrado' };
  return cliente;
};

module.exports = { getClientes, getClienteById, buscarPorCedula, crearCliente, actualizarCliente };