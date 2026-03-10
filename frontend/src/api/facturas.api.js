import api from './axios.config';

export const getFacturas = () => api.get('/facturas');
export const getFacturaById = (id) => api.get(`/facturas/${id}`);
export const crearFactura = (data) => api.post('/facturas', data);
export const cancelarFactura = (id) => api.patch(`/facturas/${id}/cancelar`);