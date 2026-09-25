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
 * Formatos + papeles + topes del editor a medida. Si el backend todavía no lo
 * tiene (Vercel y Railway se despliegan por separado), quien lo llama cae a
 * `getFormatosEtiqueta`, que siempre existió.
 */
export const getCatalogoEtiquetas = () => api.get('/etiquetas/catalogo');

/**
 * Nodos etiquetables de la sucursal activa (el nodo HOJA: la variante si la hay).
 * @param {object} params { q, linea_id, ubicacion, con_stock: '1', codigo: 'con'|'sin' }
 */
export const getNodosEtiqueta = (params = {}) => api.get('/etiquetas/nodos', { params });

/**
 * Cuántas etiquetas, cuántas hojas, cómo es la retícula y qué puede salir mal.
 * No genera el PDF. Responde también sin selección: el editor de formato
 * necesita la geometría antes de marcar productos.
 */
export const planEtiquetas = (body) => api.post('/etiquetas/plan', body);

/**
 * El PDF. `limite` recorta a una página para la previa; `prueba: true` saca la
 * hoja de alineación (sin productos) con el mismo formato y la misma calibración.
 *
 * Timeout propio: 3.000 etiquetas son varios miles de símbolos vectoriales y el
 * tope global de 30 s las corta a media generación — que es como se ve un
 * endpoint lento desde la pantalla: como si no hubiera datos.
 */
export const pdfEtiquetas = (body) =>
  api.post('/etiquetas/pdf', body, { responseType: 'blob', timeout: 180000 });

// ── Etiquetas de una compra (opt-in `proveedor_codigo_activo`) ──────────────
// Mismo motor y mismas opciones que las de Inventario; los items salen de las
// líneas de la compra y llevan el código del proveedor. La compra es el registro
// que permite reimprimir.

/** Qué se puede etiquetar de la compra (o Entrada) y con qué código de proveedor. */
export const getEtiquetasCompra = (compraId) => api.get(`/etiquetas/compra/${compraId}`);

/** Plan de la compra. `cantidades` = `{ [linea_id]: n }`, solo lo que se cambió. */
export const planEtiquetasCompra = (compraId, body) => api.post(`/etiquetas/compra/${compraId}/plan`, body);

/** El PDF de la compra, con el mismo timeout largo que el de Inventario. */
export const pdfEtiquetasCompra = (compraId, body) =>
  api.post(`/etiquetas/compra/${compraId}/pdf`, body, { responseType: 'blob', timeout: 180000 });

// ── Impresión directa ────────────────────────────────────────────────────────
// Las mismas etiquetas (mismo cuerpo) como COMANDOS de la impresora, `lenguaje`
// 'tspl' o 'zpl': se mandan con QZ Tray o se descargan como .prn. Y la firma
// que QZ Tray pide para no preguntar permiso en cada impresión (404 = sin
// certificado configurado: se imprime igual, preguntando).

export const comandosEtiquetas = (body) =>
  api.post('/etiquetas/comandos', body, { responseType: 'blob', timeout: 180000 });

export const comandosEtiquetasCompra = (compraId, body) =>
  api.post(`/etiquetas/compra/${compraId}/comandos`, body, { responseType: 'blob', timeout: 180000 });

export const qzCertificado = () => api.get('/etiquetas/qz/certificado', { responseType: 'text' });

export const qzFirmar = (datos) => api.post('/etiquetas/qz/firmar', { datos }, { responseType: 'text' });

/** Asigna código a los nodos seleccionados que no tienen. Solo admin_negocio. */
export const generarCodigosEtiqueta = (body) =>
  api.post('/etiquetas/codigos', body, { timeout: 120000 });
