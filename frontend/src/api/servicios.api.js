import api from './axios.config';

export const getOrdenes          = (params)       => api.get('/servicios', { params });
export const getOrdenById        = (id)            => api.get(`/servicios/${id}`);
export const getResumenHoy       = ()              => api.get('/servicios/resumen-hoy');

export const crearOrden          = (datos)         => api.post('/servicios', datos);
export const marcarEnReparacion  = (id, datos = {}) => api.patch(`/servicios/${id}/en-reparacion`, datos);
export const marcarListo         = (id, datos)     => api.patch(`/servicios/${id}/listo`, datos);
export const registrarAbono      = (id, datos)     => api.post(`/servicios/${id}/abonos`, datos);
export const anularAbonoServicio = (id, abonoId, motivo) =>
  api.patch(`/servicios/${id}/abonos/${abonoId}/anular`, { motivo });
export const asignarTecnicoOrden = (id, tecnicoId) => api.patch(`/servicios/${id}/tecnico`, { tecnico_id: tecnicoId });
// Corregir equivocaciones (admin, o con PIN: `pin` va en el cuerpo).
export const anularOrdenServicio     = (id, datos) => api.patch(`/servicios/${id}/anular`, datos);
export const corregirValoresServicio = (id, datos) => api.patch(`/servicios/${id}/valores`, datos);
export const entregarOrden       = (id)            => api.patch(`/servicios/${id}/entregar`);
export const sinReparar          = (id, datos)     => api.patch(`/servicios/${id}/sin-reparar`, datos);
export const abrirGarantia       = (id, datos)     => api.patch(`/servicios/${id}/garantia`, datos);
export const actualizarNotas     = (id, notas)     => api.patch(`/servicios/${id}/notas`, { notas_tecnico: notas });

// Técnicos internos (quién reparó). `todos` incluye los desactivados (Ajustes).
export const getTecnicosServicio = (todos = false) =>
  api.get('/servicios/tecnicos', { params: todos ? { todos: 1 } : {} });
export const crearTecnicoServicio      = (datos)     => api.post('/servicios/tecnicos', datos);
export const actualizarTecnicoServicio = (id, datos) => api.patch(`/servicios/tecnicos/${id}`, datos);
