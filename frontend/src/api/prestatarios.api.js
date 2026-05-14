import api from './axios.config';

export const getPrestatarios  = ()           => api.get('/prestatarios');
export const crearPrestatario = (datos)      => api.post('/prestatarios', datos);
export const getEmpleados     = (id)         => api.get(`/prestatarios/${id}/empleados`);
export const crearEmpleado    = (id, datos)  => api.post(`/prestatarios/${id}/empleados`, datos);

// ─── Cuenta corriente ────────────────────────────────────────────────────────
export const getMovimientos      = (id)           => api.get(`/prestatarios/${id}/movimientos`);
export const registrarMovimiento = (id, datos)    => api.post(`/prestatarios/${id}/movimientos`, datos);
export const anularMovimiento    = (id, movId, motivo) =>
  api.delete(`/prestatarios/${id}/movimientos/${movId}`, { data: { motivo } });
export const getSaldo            = (id)           => api.get(`/prestatarios/${id}/saldo`);
export const getResumen          = (id)           => api.get(`/prestatarios/${id}/resumen`);