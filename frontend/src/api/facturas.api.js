import api from './axios.config';

export const getFacturas = () => api.get('/facturas');
export const getFacturaById = (id) => api.get(`/facturas/${id}`);
export const crearFactura = (data) => api.post('/facturas', data);
export const cancelarFactura = (id, eliminarRetoma = false) =>
  api.delete(`/facturas/${id}`, { data: { eliminarRetoma } });
export const editarFactura = (id, data) => api.patch(`/facturas/${id}`, data);