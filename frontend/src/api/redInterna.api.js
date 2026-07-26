import api from './axios.config';

// ─────────────────────────────────────────────────────────────────────────────
// RED INTERNA (bodega → locales)
//
// Una sola ruta de panel: el backend decide si devuelve la cara de bodega o la
// del local según la sucursal activa. La UI no tiene que preguntar ni elegir.
// ─────────────────────────────────────────────────────────────────────────────

export const getPanel      = () => api.get('/red-interna/panel');
export const getSucursales = () => api.get('/red-interna/sucursales');

// ── Mercancía ────────────────────────────────────────────────────────────────
export const buscarParaDespacho = (imei) =>
  api.get('/red-interna/despacho/buscar', { params: { imei } });

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
