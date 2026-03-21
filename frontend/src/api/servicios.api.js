import api from './axios.config';

export const getOrdenes          = (params)       => api.get('/servicios', { params });
export const getOrdenById        = (id)            => api.get(`/servicios/${id}`);
export const getResumenHoy       = ()              => api.get('/servicios/resumen-hoy');

export const crearOrden          = (datos)         => api.post('/servicios', datos);
export const marcarEnReparacion  = (id)            => api.patch(`/servicios/${id}/en-reparacion`);
export const marcarListo         = (id, datos)     => api.patch(`/servicios/${id}/listo`, datos);
export const registrarAbono      = (id, datos)     => api.post(`/servicios/${id}/abonos`, datos);
export const entregarOrden       = (id)            => api.patch(`/servicios/${id}/entregar`);
export const sinReparar          = (id, datos)     => api.patch(`/servicios/${id}/sin-reparar`, datos);
export const abrirGarantia       = (id, datos)     => api.patch(`/servicios/${id}/garantia`, datos);
export const actualizarNotas     = (id, notas)     => api.patch(`/servicios/${id}/notas`, { notas_tecnico: notas });