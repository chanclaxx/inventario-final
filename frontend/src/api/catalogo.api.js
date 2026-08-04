import api from './axios.config';

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo web público (una vitrina por sucursal).
//
// Igual que el resto de la capa de API: este archivo es el ÚNICO lugar que arma
// las URLs del catálogo. Los componentes no llaman a axios directamente.
//
// El interceptor inyecta `sucursal_id` automáticamente, así que todas estas
// rutas operan sobre la sucursal activa — que es exactamente el alcance de una
// vitrina.
// ─────────────────────────────────────────────────────────────────────────────

// ── Vitrina de la sucursal ───────────────────────────────────────────────────
export const getVitrina     = ()      => api.get('/catalogo/vitrina');
export const getVitrinas    = ()      => api.get('/catalogo/vitrinas');
export const guardarVitrina = (datos) => api.put('/catalogo/vitrina', datos);

// Fuerza el refresco inmediato del catálogo público. El refresco automático ya
// cubre lo que se hace desde el módulo del catálogo; esto cubre el resto (un
// precio cambiado desde Inventario) y la impaciencia de querer verlo ya.
export const refrescarCatalogo = () => api.post('/catalogo/refrescar');

// ── Fichas de producto ───────────────────────────────────────────────────────
// `tipo` opcional: 'serial' | 'cantidad' | undefined (ambos).
export const getItemsCatalogo = (tipo) =>
  api.get('/catalogo/items', { params: { tipo: tipo || undefined } });

// Detalle con las URLs de las fotos. La lista solo trae el conteo: mandar todas
// las URLs de todo el inventario sería un payload enorme para una pantalla que
// casi siempre solo necesita saber si el producto tiene fotos o no.
export const getItemCatalogo = (itemId) => api.get(`/catalogo/items/${itemId}`);

export const guardarItem = (datos) => api.put('/catalogo/items', datos);

export const publicarMasivo = (tipo, productoIds, publicado = true) =>
  api.patch('/catalogo/items/publicar', { tipo, producto_ids: productoIds, publicado });

// ── Imágenes ─────────────────────────────────────────────────────────────────
// Se manda como multipart: las fotos NO viajan en JSON (el body está limitado a
// 1 MB en el backend y base64 infla el peso un 33%).
export const subirImagen = (itemId, blob, nombre = 'foto.webp') => {
  const form = new FormData();
  form.append('imagen', blob, nombre);
  return api.post(`/catalogo/items/${itemId}/imagenes`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,   // el default de 30 s se queda corto subiendo por datos móviles
  });
};

export const eliminarImagen = (imagenId) => api.delete(`/catalogo/imagenes/${imagenId}`);

export const reordenarImagenes = (itemId, ids) =>
  api.patch(`/catalogo/items/${itemId}/imagenes`, { ids });
