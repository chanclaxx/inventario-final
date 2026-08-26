import api from './axios.config';

export const getPrestamos = () => api.get('/prestamos');
export const getPrestamoById = (id) => api.get(`/prestamos/${id}`);
export const crearPrestamo = (data) => api.post('/prestamos', data);
// `extra` lleva la imputación cuando hay mora: { modo, valor_mora }.
export const registrarAbonoPrestamo = (id, valor, metodo, color = null, extra = {}) =>
  api.post(`/prestamos/${id}/abonos`, { valor, metodo, ...(color && { color }), ...extra });
// `decision` dice qué se hace con los abonos del producto que se devuelve:
// 'anular' (no se le devuelve), 'saldo_a_favor', o 'reasignar' a sus otros
// préstamos — esta última solo aplica cuando el pago vino de un pago total.
export const devolverPrestamo = (id, decision = 'anular') =>
  api.patch(`/prestamos/${id}/devolver`, { decision });
export const crearPrestamos = (data) => api.post('/prestamos/batch', data);
export const devolverParcialPrestamo = (id, cantidad_devuelta, decision = 'anular') =>
  api.patch(`/prestamos/${id}/devolver-parcial`, { cantidad_devuelta, decision });
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

export const descargarPdfPrestamosActivos = (tipo, id) =>
  api.get(`/prestamos/pdf/${tipo}/${id}`, { responseType: 'blob' });
export const descargarPdfEstadoCuenta = (tipo, id) =>
  api.get(`/prestamos/pdf/${tipo}/${id}/estado-cuenta`, { responseType: 'blob' });

// ── Documentos de la obligación (iguales a los de facturas a crédito) ────────
export const getDocumentoPrestamo = (prestamoId) =>
  api.get(`/prestamos/${prestamoId}/documento`);
export const descargarPdfAvisoMoraPrestamo = (prestamoId) =>
  api.get(`/prestamos/${prestamoId}/pdf/aviso-mora`, { responseType: 'blob' });
export const descargarPdfPazYSalvoPrestamo = (prestamoId) =>
  api.get(`/prestamos/${prestamoId}/pdf/paz-y-salvo`, { responseType: 'blob' });

// `modo` reparte el abono total dentro de cada préstamo (mora/capital);
// `distribucion_manual` es opcional: { [prestamo_id]: valor } y debe sumar el total.
export const registrarAbonoTotal = (tipo, personaId, valor_total, metodo, extra = {}) =>
  api.post(`/prestamos/personas/${tipo}/${personaId}/abono-total`, { valor_total, metodo, ...extra });
export const modificarAbonoTotal = (abonoTotalId, valor_total, metodo, descripcion) =>
  api.patch(`/prestamos/abonos-totales/${abonoTotalId}`, { valor_total, metodo, descripcion });

// ── Mora (feature opt-in) ────────────────────────────────────────────────────

/** Fija, cambia o quita el plazo. `fecha_limite: null` lo quita. */
export const fijarPlazoPrestamo = (id, { fecha_limite, condicion_id }) =>
  api.patch(`/prestamos/${id}/plazo`, { fecha_limite, condicion_id });

/**
 * Cobra un cargo financiero sin tocar el capital. Sin `valor` cobra todo lo
 * pendiente. `concepto` distingue mora de interés — por defecto mora, para no
 * cambiarle la conducta a las pantallas que ya existían.
 */
export const cobrarMoraPrestamo = (id, { valor, metodo, concepto = 'mora' }) =>
  api.post(`/prestamos/${id}/mora/cobrar`, { valor, metodo, concepto });

/**
 * Condona un cargo. Solo admin; exige motivo y PIN. Sin `valor` condona todo.
 * `quitar_plazo` / `quitar_interes` además apagan el cargo hacia adelante:
 * condonar solo perdona lo acumulado hasta hoy, y si el pacto sigue vivo mañana
 * se vuelve a causar.
 */
export const condonarMoraPrestamo = (id, { valor, motivo, pin, quitar_plazo, quitar_interes, concepto = 'mora' }) =>
  api.post(`/prestamos/${id}/mora/condonar`, { valor, motivo, pin, quitar_plazo, quitar_interes, concepto });

/**
 * Fija, cambia o quita el plan de interés. `plan_id: null` lo quita.
 * `desde` es opcional (por defecto hoy) y NUNCA puede ser anterior a hoy: el
 * interés no se aplica hacia atrás.
 */
export const fijarInteresPrestamo = (id, { plan_id, desde }) =>
  api.patch(`/prestamos/${id}/interes`, { plan_id, desde });
// Anular el pago total ENTERO, con su motivo. Deshace todos sus pedazos en una
// sola transacción: reabre los préstamos que dejen de estar pagados, cancela la
// factura que se generó al saldarlos y devuelve el equipo a 'prestado'.
export const anularAbonoTotal = (abonoTotalId, motivo) =>
  api.patch(`/prestamos/abonos-totales/${abonoTotalId}/anular`, { motivo });
