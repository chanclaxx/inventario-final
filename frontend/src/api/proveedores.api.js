import api from './axios.config';

export const getProveedores = () => api.get('/proveedores');
export const crearProveedor = (data) => api.post('/proveedores', data);
export const actualizarProveedor = (id, data) => api.put(`/proveedores/${id}`, data);
export const eliminarProveedor = (id) => api.delete(`/proveedores/${id}`);
// Código del proveedor (opt-in): asigna a todos los que ya tienen nombre, NIT y
// ciudad. Solo admin_negocio.
export const asignarCodigosProveedores = () => api.post('/proveedores/codigos/asignar');