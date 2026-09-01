import api from './axios.config';

// ─────────────────────────────────────────────────────────────────────────────
// Ubicaciones — la ubicación es una fila con identidad, y los productos se le
// cuelgan. Ver backend/migrations/20260831_ubicaciones_estructura.sql.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Catálogo plano: [{ ubicacion: 'Estante A-3', productos: 12 }].
 *
 * NO CAMBIAR LA FORMA. La consumen `InputUbicacion` (el autocompletado que
 * evita que convivan "estante a3" y "Estante A-3") y el desplegable "Todas las
 * ubicaciones" del inventario, que siguen leyendo el modelo viejo. El backend
 * hace lectura dual: mezcla las ubicaciones nuevas con el texto legado que
 * todavía no tenga fila, así que ningún negocio pierde sus sugerencias.
 */
export const getUbicaciones = () => api.get('/ubicaciones');

/**
 * Árbol de la sucursal activa, ya anidado por el backend.
 * Cada nodo: { id, padre_id, nombre, tipo, color, items, items_total, hijas[] }.
 *
 * `items` es lo asignado directamente; `items_total` suma los descendientes —
 * una bodega no guarda nada por sí misma, guardan sus estantes.
 */
export const getArbolUbicaciones = () => api.get('/ubicaciones/arbol');

/**
 * La bandeja de entrada: nodos sin ubicación PROPIA NI HEREDADA.
 *
 * Es la puerta de entrada real de la feature. Un negocio que la enciende tiene
 * cientos de productos sin sitio y nadie los va a escribir a mano; sin esta
 * lista el mapa queda decorativo.
 *
 * @param {object} params { q, limit, offset }
 */
export const getSinAsignar = (params = {}) =>
  api.get('/ubicaciones/sin-asignar', { params });

/**
 * Qué hay en una ubicación. Mezcla productos, atributos, variantes,
 * referencias con IMEI y unidades sueltas — todo junto, que es el caso real
 * ("el Cajón B7 tiene correa y tiene estuches").
 *
 * @param {object} params { q, limit, offset }
 */
export const getItemsUbicacion = (id, params = {}) =>
  api.get(`/ubicaciones/${id}/items`, { params });

/** Crear. Admite `padre_id` para anidar. Solo admin_negocio. */
export const crearUbicacion = (body) => api.post('/ubicaciones', body);

/** Renombrar, recolorear o mover de padre. Una sola fila. Solo admin_negocio. */
export const actualizarUbicacion = (id, body) => api.put(`/ubicaciones/${id}`, body);

/**
 * Baja lógica. Responde 409 si todavía tiene contenido o sub-ubicaciones —
 * borrarla desasignaría todo en silencio. Solo admin_negocio.
 */
export const eliminarUbicacion = (id) => api.delete(`/ubicaciones/${id}`);

/**
 * Asignar o mover nodos en lote. `ubicacion_id: null` los devuelve a "sin
 * ubicar".
 *
 * Es la operación más usada del módulo y va con el permiso de `inventario`: el
 * bodeguero es supervisor y guardar mercancía en un estante es su trabajo.
 *
 * @param {object} body { ubicacion_id, items: [{ nivel, id }] }
 *        nivel: 'producto' | 'atributo' | 'variante' | 'referencia' | 'unidad'
 */
export const moverAUbicacion = (body) => api.put('/ubicaciones/items', body);

/** Geometría del mapa, en lote y al soltar. Solo admin_negocio. (Fase 2.) */
export const guardarGeometriaUbicaciones = (posiciones) =>
  api.patch('/ubicaciones/geometria', { posiciones });

/**
 * Historial de movimientos. Sin `ubicacion_id` es el feed de la sucursal
 * ("qué se ha movido hoy"); con él, la historia de un estante — que incluye lo
 * que SALIÓ, no solo lo que entró: filtrar por destino escondería justo lo que
 * alguien busca cuando algo no está donde debería.
 *
 * Si la tabla del historial no está aplicada, responde una lista vacía en vez
 * de un error: anotar es un extra, mover es la operación diaria.
 *
 * @param {object} params { ubicacion_id, limit }
 */
export const getMovimientosUbicacion = (params = {}) =>
  api.get('/ubicaciones/movimientos', { params });

/**
 * "¿Dónde está esto?" — la pregunta inversa, la que más se hace en una bodega
 * grande y que el modelo viejo no podía responder desde esta pantalla.
 *
 * Devuelve nodos HOJA (lo que de verdad se va a buscar al estante) con su
 * ubicación YA RESUELTA hacia arriba: si la talla no tiene sitio propio pero su
 * producto sí, responde el del producto y lo marca como `heredada`. La
 * respuesta nunca es "no sé".
 *
 * El nombre y la ruta de la ubicación NO vienen del servidor: la pantalla ya
 * tiene el árbol en memoria y los saca de ahí.
 *
 * @param {object} params { q, limit }
 */
export const buscarEnUbicaciones = (params = {}) =>
  api.get('/ubicaciones/buscar', { params });

/**
 * Ruta de recogida: se manda la lista de nodos y responde dónde está cada uno.
 *
 * Va por POST y no por GET porque un carrito de treinta líneas no cabe con
 * holgura en una URL, y el navegador la corta sin decir nada.
 *
 * El ORDEN del recorrido no lo decide el servidor: la pantalla ya tiene el árbol
 * con su jerarquía y su geometría, y `agruparPorRuta` lo resuelve ahí.
 *
 * @param {Array} items [{ nivel, id }]
 */
export const ubicacionesDeItems = (items) =>
  api.post('/ubicaciones/ruta', { items });
