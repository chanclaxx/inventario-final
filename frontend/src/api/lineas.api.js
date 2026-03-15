import api from './axios.config';

/**
 * Obtiene todas las líneas de producto del negocio autenticado.
 * GET /api/lineas
 */
export const getLineas = () => api.get('/lineas');

/**
 * Crea una nueva línea de producto.
 * POST /api/lineas
 * @param {string} nombre
 */
export const crearLinea = (nombre) => api.post('/lineas', { nombre });