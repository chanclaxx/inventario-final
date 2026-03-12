import api from './axios.config';

export const getDashboard = () => api.get('/reportes/dashboard');
export const getVentasRango = (desde, hasta) =>
  api.get('/reportes/ventas-rango', { params: { desde, hasta } });
export const getProductosTop = (desde, hasta) =>
  api.get('/reportes/productos-top', { params: { desde, hasta } });
export const getInventarioBajo = () => api.get('/reportes/inventario-bajo');

export const actualizarCostoCompra = (payload) =>
  api.patch('/reportes/costo-compra', payload)