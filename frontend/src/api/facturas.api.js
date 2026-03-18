import api from './axios.config';

export const getFacturas    = ()         => api.get('/facturas');
export const getFacturaById = (id)       => api.get(`/facturas/${id}`);
export const crearFactura   = (data)     => api.post('/facturas', data);
export const editarFactura  = (id, data) => api.patch(`/facturas/${id}`, data);

// PATCH /:id/cancelar — body enviado directamente (no necesita wrapper { data } como DELETE)
export const cancelarFactura = (id, eliminarRetoma = false) =>
  api.patch(`/facturas/${id}/cancelar`, { eliminarRetoma });