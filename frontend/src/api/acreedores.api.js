import api from './axios.config';

export const getAcreedores = (filtro) =>
  api.get('/acreedores', { params: { filtro } });
export const getAcreedorById = (id) => api.get(`/acreedores/${id}`);
export const getCargosAbiertos = (id) => api.get(`/acreedores/${id}/cargos`);
export const crearAcreedor = (data) => api.post('/acreedores', data);
export const registrarMovimiento = (id, data) =>
  api.post(`/acreedores/${id}/movimientos`, data);
export const eliminarAcreedor = (id) => api.delete(`/acreedores/${id}`);
export const getComprasConSaldo = (id) => api.get(`/acreedores/${id}/compras-saldo`);
export const getAbonosPorCargo = (id, cargoId) => api.get(`/acreedores/${id}/cargos/${cargoId}/abonos`);