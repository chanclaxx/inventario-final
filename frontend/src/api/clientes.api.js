import api from './axios.config';

export const getClientes = (filtro) =>
  api.get('/clientes', { params: { filtro } });
export const getClienteById = (id) => api.get(`/clientes/${id}`);
export const buscarPorCedula = (cedula) => api.get(`/clientes/cedula/${cedula}`);
export const crearCliente = (data) => api.post('/clientes', data);
export const actualizarCliente = (id, data) => api.put(`/clientes/${id}`, data);