import api from './axios.config';

// ─────────────────────────────────────────────────────────────────────────────
// RED INTERNA (bodega → locales)
//
// Una sola ruta de panel: el backend decide si devuelve la cara de bodega o la
// del local según la sucursal activa. La UI no tiene que preguntar ni elegir.
// ─────────────────────────────────────────────────────────────────────────────

export const getPanel      = () => api.get('/red-interna/panel');
export const getSucursales = () => api.get('/red-interna/sucursales');

// Contexto liviano: "¿dónde estoy?". Lo usa el carrito de inventario para
// decidir si mostrar "Despachar" (bodega) o "Devolver" (local), sin depender
// del store de sucursal del navegador.
export const getContextoRed = () => api.get('/red-interna/contexto');

// ── Mercancía ────────────────────────────────────────────────────────────────
// Un solo campo para el lector: resuelve IMEI o código único de accesorio.
export const buscarParaDespacho = (q) =>
  api.get('/red-interna/despacho/buscar', { params: { q } });

// Accesorios de la bodega (para los que no tienen código impreso).
export const buscarAccesorios = (q = '') =>
  api.get('/red-interna/despacho/accesorios', { params: { q } });

// Traduce los ítems del carrito de inventario a líneas valorizadas al costo.
export const resolverItemsCarrito = (items) =>
  api.post('/red-interna/despacho/resolver', { items });

// Muestra a qué referencia del destino iría cada producto ANTES de despachar.
// Es lo que evita que el sistema cree referencias duplicadas por su cuenta.
export const previsualizarDestino = (payload) =>
  api.post('/red-interna/despacho/previsualizar', payload);

// Referencias de una sucursal, para elegir el destino a mano.
export const buscarReferencias = (sucursalId, { tipo, q } = {}) =>
  api.get(`/red-interna/referencias/${sucursalId}`, { params: { tipo, q } });

export const despachar = (payload) => api.post('/red-interna/remisiones', payload);

export const recibirRemision = (id, payload = {}) =>
  api.post(`/red-interna/remisiones/${id}/recibir`, payload);

export const anularRemision = (id) => api.post(`/red-interna/remisiones/${id}/anular`);

export const devolverABodega = (payload) => api.post('/red-interna/devoluciones', payload);

export const listarRemisiones = (params = {}) =>
  api.get('/red-interna/remisiones', { params });

export const getRemision = (id) => api.get(`/red-interna/remisiones/${id}`);

// ── Dinero ───────────────────────────────────────────────────────────────────
export const enviarRemesa    = (payload) => api.post('/red-interna/remesas', payload);
export const confirmarRemesa = (id) => api.post(`/red-interna/remesas/${id}/confirmar`);
export const anularRemesa    = (id) => api.post(`/red-interna/remesas/${id}/anular`);
export const listarRemesas   = (params = {}) => api.get('/red-interna/remesas', { params });

export const registrarGastoAutorizado = (payload) =>
  api.post('/red-interna/cuenta/gasto-autorizado', payload);

export const registrarAjuste = (payload) => api.post('/red-interna/cuenta/ajuste', payload);

export const getMovimientosCuenta = (sucursal) =>
  api.get('/red-interna/cuenta/movimientos', { params: { sucursal } });

// ── Control ──────────────────────────────────────────────────────────────────
export const getConciliacion = (sucursalId) =>
  api.get(`/red-interna/conciliacion/${sucursalId}`);

export const getSalud = () => api.get('/red-interna/salud');
