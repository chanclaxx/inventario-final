import api from './axios.config';

// ── Líneas ────────────────────────────────────────────────────────────────────
export const getLineas      = ()           => api.get('/lineas');
export const crearLinea     = (nombre)     => api.post('/lineas', { nombre });
export const actualizarLinea = (id, nombre) => api.put(`/lineas/${id}`, { nombre });
export const eliminarLinea  = (id)         => api.delete(`/lineas/${id}`);

// ── Serial ────────────────────────────────────────────────────────────────────
// ── linea_id opcional como query param para filtrar ──
export const getProductosSerial       = (lineaId)     => api.get('/productos-serial', { params: { linea_id: lineaId || undefined } });
export const crearProductoSerial      = (data)        => api.post('/productos-serial', data);
export const actualizarProductoSerial = (id, data)    => api.put(`/productos-serial/${id}`, data);
export const getSeriales              = (productoId, vendido) =>
  api.get(`/productos-serial/${productoId}/seriales`, { params: { vendido } });
export const agregarSerial            = (productoId, data) =>
  api.post(`/productos-serial/${productoId}/seriales`, data);
export const actualizarSerial         = (id, data)    => api.put(`/productos-serial/seriales/${id}`, data);
export const eliminarSerial           = (id)          => api.delete(`/productos-serial/seriales/${id}`);
export const verificarImei            = (imei)        => api.get(`/productos-serial/verificar-imei/${imei}`);

// ── Cantidad ──────────────────────────────────────────────────────────────────
// ── linea_id opcional como query param para filtrar ──
export const getProductosCantidad       = (lineaId)      => api.get('/productos-cantidad', { params: { linea_id: lineaId || undefined } });
export const crearProductoCantidad      = (data)         => api.post('/productos-cantidad', data);
export const actualizarProductoCantidad = (id, data)     => api.put(`/productos-cantidad/${id}`, data);
export const ajustarStock               = (id, cantidad) => api.patch(`/productos-cantidad/${id}/stock`, { cantidad });
export const eliminarProductoCantidad   = (id)           => api.delete(`/productos-cantidad/${id}`);
export const ajustarStockCantidad       = (productoId, data) => api.patch(`/productos-cantidad/${productoId}/stock`, data);