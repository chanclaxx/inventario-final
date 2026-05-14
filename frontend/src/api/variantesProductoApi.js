import api from './axios.config';

export const getArbol = (productoId, sucursalId) =>
  api.get(`/variantes-producto/${productoId}/arbol`, { params: { sucursal_id: sucursalId } });

export const crearAtributo     = (productoId, data)  => api.post(`/variantes-producto/${productoId}/atributos`, data);
export const actualizarAtributo = (id, data)          => api.put(`/variantes-producto/atributos/${id}`, data);
export const eliminarAtributo  = (id)                => api.delete(`/variantes-producto/atributos/${id}`);
export const ajustarStockAtributo = (id, data)        => api.patch(`/variantes-producto/atributos/${id}/stock`, data);

export const crearVariante     = (atributoId, data)  => api.post(`/variantes-producto/atributos/${atributoId}/variantes`, data);
export const actualizarVariante = (id, data)          => api.put(`/variantes-producto/variantes/${id}`, data);
export const eliminarVariante  = (id)                => api.delete(`/variantes-producto/variantes/${id}`);
export const ajustarStockVariante = (id, data)        => api.patch(`/variantes-producto/variantes/${id}/stock`, data);
