import api from './axios.config';

export const getPrestamos = () => api.get('/prestamos');
export const getPrestamoById = (id) => api.get(`/prestamos/${id}`);
export const crearPrestamo = (data) => api.post('/prestamos', data);
export const registrarAbonoPrestamo = (id, valor, metodo) =>
  api.post(`/prestamos/${id}/abono`, { valor, metodo });
export const devolverPrestamo = (id) => api.patch(`/prestamos/${id}/devolver`);
export const crearPrestamos         = (data) => api.post('/prestamos/batch', data);
export const devolverParcialPrestamo = (id, cantidad_devuelta) =>
  api.patch(`/prestamos/${id}/devolver-parcial`, { cantidad_devuelta });