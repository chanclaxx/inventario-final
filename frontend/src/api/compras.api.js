import api from './axios.config';

export const getCompras = () => api.get('/compras');
export const getCompraById = (id) => api.get(`/compras/${id}`);
export const crearCompra = (data) => api.post('/compras', data);
export const getComprasByProveedor = (proveedorId) =>
  api.get(`/compras/proveedor/${proveedorId}`);
export const getComprasPaginadas = (params) =>
  api.get('/compras/paginadas', { params });
export const cancelarCompra = (id) => api.patch(`/compras/${id}/cancelar`);
export const devolverCompra = (id, data) => api.post(`/compras/${id}/devolucion`, data);
export const editarPreciosCompra = (id, data) => api.patch(`/compras/${id}/precios`, data);

// ── Archivos de la compra (opt-in `compras_archivos_activo`) ─────────────────
// El manifiesto de importación y los demás papeles. No hay borrar: lo que no
// corresponde se anula con motivo y sigue guardado.

/** `{ archivos, limites, almacenamiento }`. El admin recibe también los anulados. */
export const getArchivosCompra = (compraId) => api.get(`/compras/${compraId}/archivos`);

/**
 * Adjunta un archivo. `datos` = `{ tipo, numero_documento, fecha_documento, nota }`.
 * Timeout propio: 15 MB por una conexión de local no caben en los 30 s globales,
 * y un corte a media subida se vería como «no se adjuntó» cuando quizá sí.
 */
export const subirArchivoCompra = (compraId, archivo, datos = {}) => {
  const form = new FormData();
  // Los campos de texto van ANTES del archivo, y el nombre viaja aparte.
  form.append('nombre', archivo.name);
  Object.entries(datos).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') form.append(k, v);
  });
  form.append('archivo', archivo);
  return api.post(`/compras/${compraId}/archivos`, form, { timeout: 180000 });
};

/** El archivo, como blob. Solo sale por aquí: no tiene URL pública. */
export const descargarArchivoCompra = (archivoId) =>
  api.get(`/compras/archivos/${archivoId}/descargar`, { responseType: 'blob', timeout: 180000 });

/** Solo `admin_negocio`. El motivo es obligatorio. */
export const anularArchivoCompra = (archivoId, motivo) =>
  api.patch(`/compras/archivos/${archivoId}/anular`, { motivo });
