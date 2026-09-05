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

// `pedido_id` convierte el despacho en la RESPUESTA a un pedido del local. El
// vínculo línea a línea lo resuelve el backend: la pantalla no tiene que decir
// qué línea contesta a cuál, y así el escáner, el carrito y el modal del pedido
// atribuyen igual.
export const despachar = (payload) => api.post('/red-interna/remisiones', payload);

export const recibirRemision = (id, payload = {}) =>
  api.post(`/red-interna/remisiones/${id}/recibir`, payload);

export const anularRemision = (id) => api.post(`/red-interna/remisiones/${id}/anular`);

// Dice de dónde viene cada unidad que se va a devolver (de bodega o propia
// del local), para pedir la decisión solo donde hace falta.
export const previsualizarDevolucion = (lineas) =>
  api.post('/red-interna/devoluciones/previsualizar', { lineas });

// `motivo: 'faltante'` = nunca llegó (el local confirmó de más). Hace lo mismo
// con la cuenta que una devolución, pero queda escrito como lo que fue.
export const devolverABodega = (payload) => api.post('/red-interna/devoluciones', payload);

// La bodega confirma: aquí sí se mueve el inventario.
export const confirmarDevolucion = (id, payload = {}) =>
  api.post(`/red-interna/devoluciones/${id}/confirmar`, payload);

// Corrige el valor de una línea (directo si va en tránsito, con nota si no).
export const corregirValorLinea = (lineaId, payload) =>
  api.post(`/red-interna/lineas/${lineaId}/corregir-valor`, payload);

// Cuentas desde las que el local puede remitir (efectivo, Nequi, banco…).
export const getCuentasParaRemesa = () => api.get('/red-interna/remesas/cuentas');

export const listarRemisiones = (params = {}) =>
  api.get('/red-interna/remisiones', { params });

export const getRemision = (id) => api.get(`/red-interna/remisiones/${id}`);

// ── Dinero ───────────────────────────────────────────────────────────────────
// `remision_id` dirige el pago a UN envío (el botón "Abonar" de su tarjeta).
// Sin él, el backend lo reparte entre los envíos abiertos, del más viejo al más
// nuevo, y devuelve el reparto en `data.reparto`.
export const enviarRemesa    = (payload) => api.post('/red-interna/remesas', payload);
export const confirmarRemesa = (id) => api.post(`/red-interna/remesas/${id}/confirmar`);
export const anularRemesa    = (id) => api.post(`/red-interna/remesas/${id}/anular`);
export const listarRemesas   = (params = {}) => api.get('/red-interna/remesas', { params });

export const registrarGastoAutorizado = (payload) =>
  api.post('/red-interna/cuenta/gasto-autorizado', payload);

export const registrarAjuste = (payload) => api.post('/red-interna/cuenta/ajuste', payload);

// ── Corregir lo que salió mal ────────────────────────────────────────────────
// La bodega decide sobre un gasto que el local pagó por su cuenta.
export const decidirGasto = (id, payload) =>
  api.post(`/red-interna/cuenta/movimientos/${id}/decidir`, payload);

// Anula un gasto o un ajuste mal registrado (y tumba su imputación).
export const anularMovimientoCuenta = (id, payload = {}) =>
  api.post(`/red-interna/cuenta/movimientos/${id}/anular`, payload);

// Mueve un abono al envío correcto. No toca tesorería ni caja.
export const moverAbono = (id, remisionId) =>
  api.post(`/red-interna/abonos/${id}/mover`, { remision_id: remisionId });

export const getMovimientosCuenta = (sucursal) =>
  api.get('/red-interna/cuenta/movimientos', { params: { sucursal } });

// ── Pedidos: el sentido inverso (el local le pide a la bodega) ───────────────
//
// Una sola ruta de listado y una sola de ficha para los dos lados: el backend
// decide qué ve cada quien según la sucursal activa, igual que el panel. La UI
// no manda "soy la bodega".
//
// `abiertos: '1'` es la bandeja: enviados y con algo pendiente. Se vacía sola al
// despachar —el avance es derivado— y vuelve a llenarse si esa remisión se
// anula o el local reporta un faltante.
export const listarPedidos = (params = {}) =>
  api.get('/red-interna/pedidos', { params });

export const getPedido = (id) => api.get(`/red-interna/pedidos/${id}`);

// Qué tiene la bodega, para que el local arme el pedido. Viene SIN costos: el
// costo de la bodega es justo lo que el local no puede ver.
export const catalogoPedido = (q = '') =>
  api.get('/red-interna/pedidos/catalogo', { params: { q } });

// `enviar: false` guarda un borrador; por defecto crea y envía en un paso.
export const crearPedido    = (payload) => api.post('/red-interna/pedidos', payload);
export const editarPedido   = (id, payload) => api.patch(`/red-interna/pedidos/${id}`, payload);
export const enviarPedido   = (id) => api.post(`/red-interna/pedidos/${id}/enviar`);
export const anularPedido   = (id, motivo) =>
  api.post(`/red-interna/pedidos/${id}/anular`, { motivo });

// La bodega responde. `respuesta` no es decorativa: sin ella, cerrar un pedido
// se ve desde el local exactamente igual que ignorarlo.
export const cerrarPedido   = (id, respuesta) =>
  api.post(`/red-interna/pedidos/${id}/cerrar`, { respuesta });
export const reabrirPedido  = (id) => api.post(`/red-interna/pedidos/${id}/reabrir`);

// ── Control ──────────────────────────────────────────────────────────────────
export const getConciliacion = (sucursalId) =>
  api.get(`/red-interna/conciliacion/${sucursalId}`);

// Estado de cuenta completo de un local: extracto con saldo corrido, mercancía
// rastreable con filtros, y los documentos de respaldo.
export const getEstadoCuenta = (sucursalId, params = {}) =>
  api.get(`/red-interna/estado-cuenta/${sucursalId}`, { params });

export const getSalud = () => api.get('/red-interna/salud');
