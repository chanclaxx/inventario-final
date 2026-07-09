import api from './axios.config';

export const getDashboard = () => api.get('/reportes/dashboard');
export const getVentasRango = (desde, hasta) =>
  api.get('/reportes/ventas-rango', { params: { desde, hasta } });
export const getProductosTop = (desde, hasta) =>
  api.get('/reportes/productos-top', { params: { desde, hasta } });
export const getVentasPorVendedor = (desde, hasta) =>
  api.get('/reportes/ventas-vendedor', { params: { desde, hasta } });
export const getAnalisis = (desde, hasta, agrupacion) =>
  api.get('/reportes/analisis', { params: { desde, hasta, agrupacion } });
export const exportarAnalisisPdf = (desde, hasta, agrupacion, detalle) =>
  api.get('/reportes/analisis/pdf', { params: { desde, hasta, agrupacion, detalle }, responseType: 'blob' });
export const getInventarioBajo = () => api.get('/reportes/inventario-bajo');

export const actualizarCostoCompra = (payload) =>
  api.patch('/reportes/costo-compra', payload)

export const getValorInventario = () => api.get('/reportes/inventario/valor');

// ─────────────────────────────────────────────────────────────────────────────
// Claves de React Query de todas las vistas de reportes que dependen de datos
// transaccionales (ventas, utilidad, inventario). Cualquier movimiento que
// pueda alterar la utilidad —crear/editar/cancelar factura, devolución, abono o
// saldo de crédito/préstamo, cierre de servicio, edición de costo— debe llamar
// a `invalidarReportes` en su onSuccess para que los reportes reflejen el cambio
// al instante, sin que el usuario tenga que recargar.
export const REPORT_QUERY_KEYS = [
  'dashboard',
  'ventas-rango',
  'productos-top',
  'ventas-vendedor',
  'analisis',
  'valor-inventario',
  'inventario-bajo',
];

export const invalidarReportes = (queryClient) => {
  REPORT_QUERY_KEYS.forEach((key) =>
    queryClient.invalidateQueries({ queryKey: [key], exact: false }),
  );
};