import api from './axios.config';

// ── Serial ────────────────────────────────────────────────────────────────────
export const getProductosSerial        = ()           => api.get('/productos-serial');
export const crearProductoSerial       = (data)       => api.post('/productos-serial', data);
export const actualizarProductoSerial  = (id, data)   => api.put(`/productos-serial/${id}`, data);
export const getSeriales               = (productoId, vendido) =>
  api.get(`/productos-serial/${productoId}/seriales`, { params: { vendido } });
export const agregarSerial             = (productoId, data) =>
  api.post(`/productos-serial/${productoId}/seriales`, data);
export const actualizarSerial          = (id, data)   => api.put(`/productos-serial/seriales/${id}`, data);
export const eliminarSerial            = (id)         => api.delete(`/productos-serial/seriales/${id}`);

/**
 * Verifica si un IMEI ya existe en cualquier sucursal del negocio.
 * @returns {{ existe: boolean, serial?: object }}
 */
export const verificarImei = (imei) => api.get(`/productos-serial/verificar-imei/${imei}`);

// ── Cantidad ──────────────────────────────────────────────────────────────────
export const getProductosCantidad      = ()           => api.get('/productos-cantidad');
export const crearProductoCantidad     = (data)       => api.post('/productos-cantidad', data);
export const actualizarProductoCantidad = (id, data)  => api.put(`/productos-cantidad/${id}`, data);
export const ajustarStock              = (id, cantidad) =>
  api.patch(`/productos-cantidad/${id}/stock`, { cantidad });
export const eliminarProductoCantidad  = (id)         => api.delete(`/productos-cantidad/${id}`);
export const ajustarStockCantidad      = (productoId, data) =>
  api.patch(`/productos-cantidad/${productoId}/stock`, data);