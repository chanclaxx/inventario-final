import api from './axios.config';

// ─────────────────────────────────────────────────────────────────────────────
// Listas de precios — los N precios de venta de cada producto.
//
// Igual que el resto de la capa de API: este archivo es el ÚNICO sitio que arma
// estas URLs. Los componentes no llaman a axios directamente.
//
// El catálogo de listas (sus nombres) NO se pide aquí: viaja en `GET /config`,
// que ya está en caché en todas las pantallas. Pedirlo aparte sería una
// petición de más en la pantalla más caliente del sistema.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Guarda los precios de uno o varios nodos, en una sola transacción.
 *
 * `nodos` = [{ nivel: 'producto'|'atributo'|'variante'|'serial', id, precios }]
 * donde `precios` es el mapa COMPLETO de ese nodo: el backend reemplaza la
 * columna, no la mezcla.
 *
 * Exige permiso: por defecto solo `admin_negocio`. Con otro usuario responde
 * 403 aunque la pantalla le haya pintado el botón.
 */
export const guardarPreciosNodos = (nodos) =>
  api.put('/listas-precios/nodos', { nodos });

/** Los precios que hoy tiene cada nodo de un producto por cantidad. */
export const getPreciosProducto = (productoId) =>
  api.get(`/listas-precios/producto/${productoId}`);
