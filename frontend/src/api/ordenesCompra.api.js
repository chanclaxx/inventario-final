import api from './axios.config';

// ─────────────────────────────────────────────────────────────────────────────
// Órdenes de compra y procedencia.
//
// Único sitio del frontend que arma estas URLs — componentes y hooks nunca
// llaman a axios directo.
//
// Nota: recibir mercancía NO tiene endpoint propio. Una recepción ES una compra
// (`POST /compras` con `orden_compra_id` y `orden_linea_id` en cada línea), y
// por eso mete inventario, calcula costo promedio y crea la deuda con el mismo
// código probado de siempre. Se usa `crearCompra` de compras.api.js.
// ─────────────────────────────────────────────────────────────────────────────

export const getOrdenes    = (params) => api.get('/ordenes-compra', { params });
export const getOrdenById  = (id)     => api.get(`/ordenes-compra/${id}`);
export const crearOrden    = (data)   => api.post('/ordenes-compra', data);
export const editarOrden   = (id, data) => api.put(`/ordenes-compra/${id}`, data);
export const emitirOrden   = (id)     => api.patch(`/ordenes-compra/${id}/emitir`);
export const cerrarOrden   = (id, data) => api.patch(`/ordenes-compra/${id}/cerrar`, data);
export const anularOrden   = (id, data) => api.patch(`/ordenes-compra/${id}/anular`, data);

// ── Procedencia ──────────────────────────────────────────────────────────────
// Sin flag: lee historia de compras que todos los negocios ya tienen.
export const getProcedenciaProducto = (productoId) => api.get(`/procedencia/producto/${productoId}`);
export const getProcedenciaImei     = (imei)       => api.get(`/procedencia/imei/${encodeURIComponent(imei)}`);

// ── Códigos del proveedor ────────────────────────────────────────────────────
// `resolverCodigoProveedor` devuelve un estado, no un producto suelto:
//   'resuelto'     → hay equivalencia y el producto existe en esta sucursal
//   'sin_producto' → hay equivalencia pero el producto no está aquí
//   'desconocido'  → nadie ha dicho qué es; se pregunta y se aprende
// La diferencia importa: una pide crear el producto, la otra enseñar la
// equivalencia.
export const getCodigosProveedor = (proveedorId) => api.get(`/codigos-proveedor/${proveedorId}`);
export const resolverCodigoProveedor = (params) => api.get('/codigos-proveedor/resolver', { params });
export const aprenderCodigoProveedor = (data) => api.post('/codigos-proveedor', data);
export const eliminarCodigoProveedor = (id)   => api.delete(`/codigos-proveedor/${id}`);
export const getCodigosPorProducto   = (codigoInterno) =>
  api.get(`/codigos-proveedor/producto/${encodeURIComponent(codigoInterno)}`);
