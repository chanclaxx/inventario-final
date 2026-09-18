import api from './axios.config';

// Técnicos externos (Servicios → Técnicos). Ver backend/migrations/20260918_tecnicos_externos.sql.

export const getTecnicos        = (params)         => api.get('/tecnicos', { params });
export const getTecnico         = (id)             => api.get(`/tecnicos/${id}`);
export const crearTecnico       = (datos)          => api.post('/tecnicos', datos);
export const actualizarTecnico  = (id, datos)      => api.put(`/tecnicos/${id}`, datos);

export const getEquiposTecnico  = (params)         => api.get('/tecnicos/equipos', { params });
export const buscarDisponibles  = (q)              => api.get('/tecnicos/disponibles', { params: { q } });
export const getResumenTecnicos = (params)         => api.get('/tecnicos/resumen', { params });

export const enviarATecnico     = (datos)          => api.post('/tecnicos/salidas', datos);
export const enviarOrdenATecnico = (ordenId, datos) => api.post(`/tecnicos/ordenes/${ordenId}/enviar`, datos);
export const recibirDeTecnico   = (equipoId, datos) => api.post(`/tecnicos/equipos/${equipoId}/recibir`, datos);
export const reclamarGarantia   = (equipoId, datos) => api.post(`/tecnicos/equipos/${equipoId}/reclamar`, datos);
export const anularEnvio        = (equipoId, motivo) => api.patch(`/tecnicos/equipos/${equipoId}/anular`, { motivo });

export const registrarPagoTecnico = (tecnicoId, datos) => api.post(`/tecnicos/${tecnicoId}/pagos`, datos);
export const anularPagoTecnico    = (pagoId, motivo)   => api.patch(`/tecnicos/pagos/${pagoId}/anular`, { motivo });
