import api from './axios.config';

/** Lista todas las sucursales activas del negocio autenticado */
export const getSucursales = () => api.get('/sucursales');