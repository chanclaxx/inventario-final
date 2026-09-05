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

// ── Corregir sin rehacer ─────────────────────────────────────────────────────
//
// Solo mientras la entrada siga SIN CONFIRMAR: es la frontera que usa el
// backend, y la razón es que hasta ahí no hay precios reales ni deuda cerrada
// que tocar — solo stock provisional. Después, el camino es la devolución al
// proveedor o la corrección de precios.
//
// `operaciones`: [{ linea_id, cantidad? }]                  cambiar cuánto llegó
//                [{ linea_id, variante_id, atributo_id }]   era otra variante
//                [{ linea_id, imei }]                       IMEI mal tecleado
//                [{ linea_id, quitar: true }]                no llegó
//                [{ agregar: true, producto_id, nombre_producto,
//                   cantidad, variante_id?, atributo_id?, imei? }]
//
// Sigue sin viajar un solo precio: el backend lo resuelve con el MISMO criterio
// que usó al registrar la entrada.
export const corregirEntrada = (id, data) =>
  api.patch(`/compras/entradas/${id}/corregir`, data);

/** Quién cambió qué y cuándo. El "antes" y el "después" van congelados. */
export const getCorreccionesEntrada = (id) =>
  api.get(`/compras/entradas/${id}/correcciones`);
