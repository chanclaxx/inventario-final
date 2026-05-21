import api from './axios.config';

export const getPrestamos = () => api.get('/prestamos');
export const getPrestamoById = (id) => api.get(`/prestamos/${id}`);
export const crearPrestamo = (data) => api.post('/prestamos', data);
export const registrarAbonoPrestamo = (id, valor, metodo, color = null) =>
  api.post(`/prestamos/${id}/abonos`, { valor, metodo, ...(color && { color }) });
export const devolverPrestamo = (id) => api.patch(`/prestamos/${id}/devolver`);
export const crearPrestamos = (data) => api.post('/prestamos/batch', data);
export const devolverParcialPrestamo = (id, cantidad_devuelta) =>
  api.patch(`/prestamos/${id}/devolver-parcial`, { cantidad_devuelta });
export const registrarSaldoAFavor = (tipo, id, monto) =>
  api.patch(`/prestamos/personas/${tipo}/${id}/saldo-a-favor`, { monto });
export const intercambiarPrestamo = (id, data) =>
  api.post(`/prestamos/${id}/intercambio`, data);

export const getResumenCartera   = (tipo, id) =>
  api.get(`/prestamos/personas/${tipo}/${id}/resumen`);
export const retomaDirecta       = (data) =>
  api.post('/prestamos/retoma-directa', data);
export const aplicarSaldoActivos    = (tipo, id) =>
  api.post(`/prestamos/personas/${tipo}/${id}/aplicar-saldo`);
export const aplicarSaldoAPrestamo  = (prestamoId) =>
  api.post(`/prestamos/${prestamoId}/aplicar-saldo`);
export const anularAbono = (prestamoId, abonoId, retomaId = null) =>
  api.delete(`/prestamos/${prestamoId}/abonos/${abonoId}`, { data: { retoma_id: retomaId } });
export const getRetomasDirectas = (tipo, id) =>
  api.get(`/prestamos/personas/${tipo}/${id}/retomas-directas`);
export const anularRetomaDirecta = (retomaId) =>
  api.delete(`/prestamos/retomas-directas/${retomaId}`);
export const getEstadoCuenta = (tipo, id) =>
  api.get(`/prestamos/personas/${tipo}/${id}/estado-cuenta`);
export const crearAjusteDeuda = (data) =>
  api.post('/prestamos/ajuste-deuda', data);
export const editarValorPrestamo = (id, valor_prestamo) =>
  api.patch(`/prestamos/${id}/valor`, { valor_prestamo });
export const getSaldoSucursal = (tipo, id) =>
  api.get(`/prestamos/personas/${tipo}/${id}/saldo-sucursal`);
export const getHistorialSaldoSucursal = (tipo, id) =>
  api.get(`/prestamos/personas/${tipo}/${id}/historial-saldo`);