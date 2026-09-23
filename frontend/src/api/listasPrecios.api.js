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

// ── Excel: el mismo archivo de ida y de vuelta ───────────────────────────────
//
// No hay "exportar precios" por un lado y una plantilla vacía por el otro: se
// descarga lo que hay hoy, se edita y se vuelve a subir. Por eso la descarga
// exige el mismo permiso que escribir — ofrecerle el archivo a quien después va
// a recibir un 403 al aplicarlo no le sirve a nadie.

/**
 * El .xlsx con los precios actuales. `responseType: blob` o llega corrupto.
 *
 * `incluirVariantes` sin definir NO manda el parámetro: el backend decide con
 * `variantes_activo` del negocio, que es lo correcto cuando nadie eligió.
 */
export const descargarPlantillaPrecios = ({ sucursales = [], incluirVariantes } = {}) =>
  api.get('/listas-precios/plantilla', {
    params: {
      sucursales: sucursales.join(','),
      ...(incluirVariantes === undefined ? null : { variantes: incluirVariantes ? '1' : '0' }),
    },
    responseType: 'blob',
  });

/** Qué pasaría si se aplicara este archivo. NO escribe nada. */
export const analizarPreciosExcel = (archivo, sucursales = []) => {
  const fd = new FormData();
  fd.append('archivo', archivo);
  fd.append('sucursales', sucursales.join(','));
  return api.post('/listas-precios/analizar', fd);
};

/** Aplica el archivo. Devuelve el mismo informe más cuántas filas se guardaron. */
export const importarPreciosExcel = (archivo, sucursales = []) => {
  const fd = new FormData();
  fd.append('archivo', archivo);
  fd.append('sucursales', sucursales.join(','));
  return api.post('/listas-precios/importar', fd);
};
