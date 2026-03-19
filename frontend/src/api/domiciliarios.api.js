import api from './axios.config';

// ── Domiciliarios ─────────────────────────────────────────────────────────────

export const getDomiciliarios = () =>
  api.get('/domiciliarios');

export const crearDomiciliario = (datos) =>
  api.post('/domiciliarios', datos);

export const actualizarDomiciliario = (id, datos) =>
  api.patch(`/domiciliarios/${id}`, datos);

// ── Entregas ──────────────────────────────────────────────────────────────────

export const getEntregas = (params = {}) =>
  api.get('/domiciliarios/entregas', { params });

export const getEntregaById = (id) =>
  api.get(`/domiciliarios/entregas/${id}`);

export const registrarAbono = (entregaId, datos) =>
  api.post(`/domiciliarios/entregas/${entregaId}/abonos`, datos);

export const marcarDevolucion = (entregaId) =>
  api.patch(`/domiciliarios/entregas/${entregaId}/devolucion`);