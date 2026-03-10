import api from './axios.config';

export const getPrestamos = () => api.get('/prestamos');
export const getPrestamoById = (id) => api.get(`/prestamos/${id}`);
export const crearPrestamo = (data) => api.post('/prestamos', data);
export const registrarAbonoPrestamo = (id, valor) =>
  api.post(`/prestamos/${id}/abonos`, { valor });
export const devolverPrestamo = (id) => api.patch(`/prestamos/${id}/devolver`);