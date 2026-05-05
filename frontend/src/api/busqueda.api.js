import api from './axios.config';

export const buscarPorIMEI    = (imei)        => api.get(`/busqueda/serial/${encodeURIComponent(imei)}`);
export const buscarProductos  = (q)           => api.get('/busqueda/productos', { params: { q } });
export const buscarCompras    = (q, modo)     => api.get('/busqueda/compras',   { params: { q, modo } });
export const buscarPrestamos  = (filtros)     => api.get('/busqueda/prestamos', { params: filtros });
