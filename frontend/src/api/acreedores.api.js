import api from './axios.config';

export const getAcreedores = (filtro) =>
  api.get('/acreedores', { params: { filtro } });
export const getAcreedorById = (id) => api.get(`/acreedores/${id}`);
export const crearAcreedor = (data) => api.post('/acreedores', data);
export const registrarMovimiento = (id, data) =>
  api.post(`/acreedores/${id}/movimientos`, data);