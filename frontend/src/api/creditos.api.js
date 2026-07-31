import api from './axios.config';

export const getCreditos = () => api.get('/creditos');

export const getCreditoById = (id) => api.get(`/creditos/${id}`);

export const registrarAbonoCredito = (creditoId, datos) =>
  api.post(`/creditos/${creditoId}/abonos`, datos);

export const saldarCredito = (creditoId) =>
  api.patch(`/creditos/${creditoId}/saldar`);

export const cancelarCredito = (creditoId) =>
  api.patch(`/creditos/${creditoId}/cancelar`);

// ── Estado de cuenta ─────────────────────────────────────────────────────────
//
// `clave` identifica al cliente igual que la pantalla agrupa sus tarjetas:
// la cédula si la tiene, y si no el nombre.

export const getEstadoCuentaCredito = (clave) =>
  api.get('/creditos/estado-cuenta', { params: { clave } });

export const descargarPdfEstadoCuentaCredito = (clave) =>
  api.get('/creditos/estado-cuenta/pdf', { params: { clave }, responseType: 'blob' });

// ── Documentos de la obligación ──────────────────────────────────────────────
//
// `getDocumentoCredito` trae el resumen que calcula el backend (estado, saldo,
// historial con saldo corrido). Es el mismo que imprime el PDF, así que la
// impresión POS no recalcula nada.

export const getDocumentoCredito = (creditoId) =>
  api.get(`/creditos/${creditoId}/documento`);

export const descargarPdfAvisoMora = (creditoId) =>
  api.get(`/creditos/${creditoId}/pdf/aviso-mora`, { responseType: 'blob' });

export const descargarPdfPazYSalvo = (creditoId) =>
  api.get(`/creditos/${creditoId}/pdf/paz-y-salvo`, { responseType: 'blob' });

// ── Mora (feature opt-in) ────────────────────────────────────────────────────

/** Fija, cambia o quita el plazo. `fecha_limite: null` lo quita (y con él la mora). */
export const fijarPlazoCredito = (creditoId, { fecha_limite, condicion_id }) =>
  api.patch(`/creditos/${creditoId}/plazo`, { fecha_limite, condicion_id });

/** Cobra mora sin tocar el capital. Sin `valor` cobra todo lo pendiente. */
export const cobrarMoraCredito = (creditoId, { valor, metodo }) =>
  api.post(`/creditos/${creditoId}/mora/cobrar`, { valor, metodo });

/**
 * Condona mora. Solo admin; exige motivo y PIN. Sin `valor` condona todo.
 * `quitar_plazo` además borra la fecha límite, para que no se vuelva a causar
 * mora (condonar solo perdona lo acumulado hasta hoy).
 */
export const condonarMoraCredito = (creditoId, { valor, motivo, pin, quitar_plazo }) =>
  api.post(`/creditos/${creditoId}/mora/condonar`, { valor, motivo, pin, quitar_plazo });