import api from './axios.config';

export const getAcreedores = (filtro) =>
  api.get('/acreedores', { params: { filtro } });
export const getAcreedorById = (id) => api.get(`/acreedores/${id}`);
export const crearAcreedor = (data) => api.post('/acreedores', data);
export const registrarMovimiento = (id, data) =>
  api.post(`/acreedores/${id}/movimientos`, data);
// ─── PARCHE: acreedores.api.js ────────────────────────────────────────────────
// Agregar esta función al archivo existente.

export const eliminarAcreedor = (id) => api.delete(`/acreedores/${id}`);