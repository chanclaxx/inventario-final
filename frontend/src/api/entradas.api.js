import api from './axios.config';

// ─────────────────────────────────────────────────────────────────────────────
// ENTRADAS DE BODEGA
//
// Ninguna de estas llamadas manda ni recibe precios: el backend resuelve el
// valor provisional a partir de la orden o del último costo conocido, y la
// respuesta viene recortada. Si algún día hace falta mandar un precio desde
// aquí, es señal de que el diseño se torció.
// ─────────────────────────────────────────────────────────────────────────────

/** Últimas entradas registradas en la sucursal. */
export const getEntradas = () => api.get('/compras/entradas');

/** Qué llegó exactamente en una entrada: líneas, IMEI, variante y garantía. */
export const getEntradaDetalle = (id) => api.get(`/compras/entradas/${id}`);

/** Órdenes emitidas con unidades pendientes de recibir. Sin proveedor ni valores. */
export const getOrdenesParaRecibir = () => api.get('/compras/entradas/ordenes');

/**
 * Registra lo que llegó.
 * `lineas`: [{ producto_id, nombre_producto, cantidad, imei?, variante_id?,
 *              atributo_id?, orden_linea_id? }]
 */
export const registrarEntrada = (data) => api.post('/compras/entradas', data);

// ── Lado administración ──────────────────────────────────────────────────────
export const getEntradasPorConfirmar = () => api.get('/compras/por-confirmar');

export const confirmarEntrada = (id, data) =>
  api.patch(`/compras/${id}/confirmar`, data);
