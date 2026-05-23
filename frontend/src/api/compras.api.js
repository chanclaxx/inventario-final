import api from './axios.config';

export const getCompras = () => api.get('/compras');
export const getCompraById = (id) => api.get(`/compras/${id}`);
export const crearCompra = (data) => api.post('/compras', data);
export const getComprasByProveedor = (proveedorId) =>
  api.get(`/compras/proveedor/${proveedorId}`);
export const getComprasPaginadas = (params) =>
  api.get('/compras/paginadas', { params });
export const cancelarCompra = (id) => api.patch(`/compras/${id}/cancelar`);
