import api from './axios.config';

export const buscarPorIMEI         = (imei)        => api.get(`/busqueda/serial/${encodeURIComponent(imei)}`);
export const buscarPorCodigo       = (codigo)      => api.get(`/busqueda/codigo/${encodeURIComponent(codigo)}`);
export const buscarProductos       = (q)           => api.get('/busqueda/productos', { params: { q } });
export const buscarCompras         = (q, modo)     => api.get('/busqueda/compras',   { params: { q, modo } });
export const buscarPrestamos       = (filtros)     => api.get('/busqueda/prestamos', { params: filtros });
export const getHistorialCantidad  = (productoId)  => api.get(`/busqueda/historial-cantidad/${productoId}`);
