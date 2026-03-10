import api from './axios.config';

export const getProveedores = () => api.get('/proveedores');
export const crearProveedor = (data) => api.post('/proveedores', data);
export const actualizarProveedor = (id, data) => api.put(`/proveedores/${id}`, data);
export const eliminarProveedor = (id) => api.delete(`/proveedores/${id}`);