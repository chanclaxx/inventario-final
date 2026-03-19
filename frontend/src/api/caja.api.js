import api from './axios.config';

export const getCajaActiva      = ()         => api.get('/caja/activa');
export const abrirCaja          = (data)     => api.post('/caja/abrir', data);
export const cerrarCaja         = (id, data) => api.patch(`/caja/${id}/cerrar`, data);
export const getMovimientos     = (id)       => api.get(`/caja/${id}/movimientos`);
export const registrarMovimiento = (id, data) => api.post(`/caja/${id}/movimientos`, data);
export const getResumenDia      = (id)       => api.get(`/caja/${id}/resumen-dia`);
export const toggleMovimiento = (movimientoId) =>
  api.patch(`/caja/movimientos/${movimientoId}/toggle`);