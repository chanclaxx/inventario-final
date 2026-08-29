import api from './axios.config';

// ── Etiquetas imprimibles de productos por cantidad ──────────────────────────
//
// Todo pasa por el backend, incluida la VISTA PREVIA: es el mismo `/pdf` con un
// `limite`, no un dibujo aparte. Un previsualizador propio en el navegador
// tendría que reimplementar el reparto del espacio de la etiqueta y se
// desincronizaría del que imprime — y el usuario se enteraría después de gastar
// la plancha adhesiva.
//
// Por la misma razón el catálogo de formatos se PIDE en vez de llevar una copia
// aquí: las dos listas de módulos duplicadas a mano ya se separaron una vez y
// costó una pestaña desaparecida en producción.

/** Catálogo de tamaños de plancha y de rollo. Fuente única: el backend. */
export const getFormatosEtiqueta = () => api.get('/etiquetas/formatos');

/**
 * Nodos etiquetables de la sucursal activa (el nodo HOJA: la variante si la hay).
 * @param {object} params { q, linea_id, ubicacion, con_stock: '1', codigo: 'con'|'sin' }
 */
export const getNodosEtiqueta = (params = {}) => api.get('/etiquetas/nodos', { params });

/** Cuántas etiquetas, cuántas hojas y qué puede salir mal. No genera el PDF. */
export const planEtiquetas = (body) => api.post('/etiquetas/plan', body);

/**
 * El PDF. `limite` recorta a una página para la previa.
 *
 * Timeout propio: 3.000 etiquetas son varios miles de símbolos vectoriales y el
 * tope global de 30 s las corta a media generación — que es como se ve un
 * endpoint lento desde la pantalla: como si no hubiera datos.
 */
export const pdfEtiquetas = (body) =>
  api.post('/etiquetas/pdf', body, { responseType: 'blob', timeout: 180000 });

/** Asigna código a los nodos seleccionados que no tienen. Solo admin_negocio. */
export const generarCodigosEtiqueta = (body) =>
  api.post('/etiquetas/codigos', body, { timeout: 120000 });
