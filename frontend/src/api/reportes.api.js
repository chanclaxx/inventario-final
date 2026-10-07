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
// Las tablas para asesoría: proveedores, precios de compra, productos, líneas,
// clientes, cartera y hallazgos, en una sola respuesta. `alcance` = 'sede' (la
// de la cabecera) o 'negocio' (todas). Timeout propio: son una docena de
// consultas de agregación y un período largo no cabe en los 30 s globales.
export const getAnalisisAsesor = (desde, hasta, alcance = 'sede') =>
  api.get('/reportes/analisis/asesor', { params: { desde, hasta, alcance }, timeout: 120000 });
export const getProyeccion = (meses) =>
  api.get('/reportes/proyeccion', { params: { meses } });
export const exportarProyeccionPdf = (meses) =>
  api.get('/reportes/proyeccion/pdf', { params: { meses }, responseType: 'blob' });

// Gastos fijos mensuales (por sucursal) — alimentan la proyección
export const getGastosFijos    = ()             => api.get('/reportes/gastos-fijos');
export const crearGastoFijo    = (payload)      => api.post('/reportes/gastos-fijos', payload);
export const actualizarGastoFijo = (id, payload) => api.patch(`/reportes/gastos-fijos/${id}`, payload);
export const eliminarGastoFijo = (id)           => api.delete(`/reportes/gastos-fijos/${id}`);
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
  'analisis-asesor',
  'proyeccion',
  'gastos-fijos',
  'valor-inventario',
  'inventario-bajo',
  // Tesorería deriva sus saldos de las mismas transacciones: cualquier
  // mutación (venta, abono, compra, cancelación…) puede moverlos.
  'tesoreria',
];

export const invalidarReportes = (queryClient) => {
  REPORT_QUERY_KEYS.forEach((key) =>
    queryClient.invalidateQueries({ queryKey: [key], exact: false }),
  );
};