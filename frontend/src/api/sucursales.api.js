import api from './axios.config';

/** Lista todas las sucursales activas del negocio autenticado */
export const getSucursales = () => api.get('/sucursales');
// ── Datos de cada sucursal para los documentos (nombre comercial, NIT, …) ────
/** Los de todas las sedes, SIN logo (los tickets POS no lo imprimen). */
export const getDatosDocumentoSucursales = () => api.get('/sucursales/documentos');
/** Los de una sede, con logo (para editarlos; solo admin). */
export const getDatosDocumentoSucursal = (id) => api.get(`/sucursales/${id}/documento`);
/** Guarda los de una sede; todo vacío = vuelve a heredar del negocio. */
export const guardarDatosDocumentoSucursal = (id, datos) => api.put(`/sucursales/${id}/documento`, datos);
