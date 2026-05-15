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
export const getAbonosPorCargo  = (id, cargoId) => api.get(`/acreedores/${id}/cargos/${cargoId}/abonos`);
export const getSaldoAFavor     = (id) => api.get(`/acreedores/${id}/saldo-favor`);
export const aplicarSaldoAFavor = (id, cargo_id, valor) =>
  api.post(`/acreedores/${id}/aplicar-saldo`, { cargo_id, valor });
export const editarAbono   = (acreedorId, movId, data) =>
  api.put(`/acreedores/${acreedorId}/movimientos/${movId}`, data);
export const eliminarAbono = (acreedorId, movId) =>
  api.delete(`/acreedores/${acreedorId}/movimientos/${movId}`);

export const exportarCuentaPdf = (id) =>
  api.get(`/acreedores/${id}/pdf`, { responseType: 'blob' });

export const getHistorialAcreedor = (id) => api.get(`/acreedores/${id}/historial`);