import api from './axios.config';

export const getCuentas       = ()           => api.get('/tesoreria/cuentas');
export const crearCuenta      = (data)       => api.post('/tesoreria/cuentas', data);
export const actualizarCuenta = (id, data)   => api.patch(`/tesoreria/cuentas/${id}`, data);

export const getSaldos        = ()           => api.get('/tesoreria/saldos');
export const getExtracto      = (id, params) => api.get(`/tesoreria/cuentas/${id}/extracto`, { params });

export const registrarMovimiento = (data)    => api.post('/tesoreria/movimientos', data);
export const trasladar           = (data)    => api.post('/tesoreria/traslados', data);
export const toggleMovimiento    = (id)      => api.patch(`/tesoreria/movimientos/${id}/toggle`);

export const arquear          = (data)       => api.post('/tesoreria/arqueos', data);
export const getResumenNegocio = ()          => api.get('/tesoreria/resumen');

export const getProveedoresTesoreria = ()    => api.get('/tesoreria/proveedores');
export const getComprasProveedor = (proveedorId) =>
  api.get(`/tesoreria/compras-proveedor/${proveedorId}`);
