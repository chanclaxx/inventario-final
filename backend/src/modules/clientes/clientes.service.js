const repo = require('./clientes.repository');

const getClientes = (negocioId, filtro) => repo.findAll(negocioId, filtro);

// Autocompletado al facturar: busca por nombre, cédula o celular dentro del
// negocio. Devuelve lista vacía (nunca error) si el término es muy corto, para
// que el frontend no tenga que distinguir «sin escribir» de «sin resultados».
const buscarClientes = (negocioId, termino) => repo.buscar(negocioId, termino);

const getClienteById = async (negocioId, id) => {
  const cliente = await repo.findById(negocioId, id);
  if (!cliente) throw { status: 404, message: 'Cliente no encontrado' };
  const historial = await repo.getHistorialCompras(negocioId, cliente.cedula);
  return { ...cliente, historial };
};

const buscarPorCedula = (negocioId, cedula) => repo.findByCedula(negocioId, cedula);

const crearCliente = async (negocioId, datos) => {
  const existe = await repo.findByCedula(negocioId, datos.cedula);
  // Viaja el cliente que ya existe: la pantalla lo selecciona en vez de dejar
  // al vendedor con un error y la tentación de inventarle otra cédula.
  if (existe) {
    throw {
      status: 409, code: 'CLIENTE_EXISTE',
      message: `Ya existe un cliente con esa cédula: ${existe.nombre}`,
      detalle: { existente: { id: existe.id, nombre: existe.nombre, cedula: existe.cedula,
        celular: existe.celular, email: existe.email, direccion: existe.direccion } },
    };
  }
  return repo.create(negocioId, datos);
};

const actualizarCliente = async (negocioId, id, datos) => {
  const cliente = await repo.update(negocioId, id, datos);
  if (!cliente) throw { status: 404, message: 'Cliente no encontrado' };
  return cliente;
};
const getFrecuentes = (sucursalId) => repo.findFrecuentes(sucursalId);
 
const agregarFrecuente = async (negocioId, sucursalId, clienteId) => {
  const cliente = await repo.findById(negocioId, clienteId);
  if (!cliente) throw { status: 404, message: 'Cliente no encontrado' };
  return repo.agregarFrecuente(sucursalId, clienteId);
};
 
const quitarFrecuente = (sucursalId, clienteId) =>
  repo.quitarFrecuente(sucursalId, clienteId);

module.exports = { getClientes, buscarClientes, getClienteById, buscarPorCedula, crearCliente, actualizarCliente,agregarFrecuente,quitarFrecuente,getFrecuentes };