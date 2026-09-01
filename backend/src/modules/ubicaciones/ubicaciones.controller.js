const service = require('./ubicaciones.service');

// sucursal_id lo resuelve y valida el middleware resolveSucursal; negocio_id
// sale del JWT. Ninguno se toma del body — es la regla de todo el sistema y
// aquí importa el doble, porque estas rutas escriben sobre el mapa de una sede.
const _contexto = (req) => ({
  sucursalId: req.sucursal_id,
  negocioId:  req.user.negocio_id,
  usuarioId:  req.user.id,
});

const _paginacion = (req) => ({
  q:      req.query.q ? String(req.query.q).trim() || null : null,
  limit:  Math.min(Number(req.query.limit) || 200, 500),
  offset: Math.max(Number(req.query.offset) || 0, 0),
});

// ── Catálogo plano (compatibilidad con el autocompletado y el filtro) ────────
const getUbicaciones = async (req, res, next) => {
  try {
    const { sucursalId, negocioId } = _contexto(req);
    if (!sucursalId) return res.status(400).json({ ok: false, error: 'Sucursal requerida' });

    const data = await service.getUbicaciones(sucursalId, negocioId);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getArbol = async (req, res, next) => {
  try {
    const { sucursalId, negocioId } = _contexto(req);
    if (!sucursalId) return res.status(400).json({ ok: false, error: 'Sucursal requerida' });

    const data = await service.getArbol(sucursalId, negocioId);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getSinAsignar = async (req, res, next) => {
  try {
    const { sucursalId, negocioId } = _contexto(req);
    if (!sucursalId) return res.status(400).json({ ok: false, error: 'Sucursal requerida' });

    const data = await service.getSinAsignar(sucursalId, negocioId, _paginacion(req));
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

// "¿Dónde está esto?". Devuelve el nodo con su ubicación YA RESUELTA hacia
// arriba: si la talla no tiene sitio propio pero su producto sí, responde el
// del producto y lo marca como heredado.
const buscar = async (req, res, next) => {
  try {
    const { sucursalId, negocioId } = _contexto(req);
    if (!sucursalId) return res.status(400).json({ ok: false, error: 'Sucursal requerida' });

    const data = await service.buscar(sucursalId, negocioId, {
      q:     req.query.q ? String(req.query.q).trim() : '',
      limit: Math.min(Number(req.query.limit) || 40, 100),
    });
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

// Ruta de recogida: se manda la lista y responde dónde está cada línea. Va por
// POST y no por GET porque un carrito de treinta ítems no cabe con holgura en
// una URL, y el navegador la corta sin decir nada.
const ubicacionesDe = async (req, res, next) => {
  try {
    const { sucursalId, negocioId } = _contexto(req);
    if (!sucursalId) return res.status(400).json({ ok: false, error: 'Sucursal requerida' });

    const data = await service.ubicacionesDe(req.body?.items || [], sucursalId, negocioId);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

// Historial. Sin `ubicacion_id` es el feed de la sucursal ("qué se ha movido
// hoy"); con él, la historia de un estante — que incluye lo que SALIÓ, no solo
// lo que entró.
const getMovimientos = async (req, res, next) => {
  try {
    const { sucursalId, negocioId } = _contexto(req);
    if (!sucursalId) return res.status(400).json({ ok: false, error: 'Sucursal requerida' });

    const data = await service.getMovimientos(sucursalId, negocioId, {
      ubicacionId: req.query.ubicacion_id ? Number(req.query.ubicacion_id) : null,
      limit:       Math.min(Number(req.query.limit) || 100, 300),
    });
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getDetalle = async (req, res, next) => {
  try {
    const { negocioId } = _contexto(req);
    const data = await service.getDetalle(Number(req.params.id), negocioId, _paginacion(req));
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getItems = async (req, res, next) => {
  try {
    const { negocioId } = _contexto(req);
    const data = await service.getItems(Number(req.params.id), negocioId, _paginacion(req));
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const crear = async (req, res, next) => {
  try {
    const { sucursalId, negocioId, usuarioId } = _contexto(req);
    if (!sucursalId) return res.status(400).json({ ok: false, error: 'Sucursal requerida' });

    const data = await service.crear(req.body || {}, sucursalId, negocioId, usuarioId);
    res.status(201).json({ ok: true, data });
  } catch (err) { next(err); }
};

const actualizar = async (req, res, next) => {
  try {
    const { negocioId } = _contexto(req);
    const data = await service.actualizar(Number(req.params.id), req.body || {}, negocioId);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const eliminar = async (req, res, next) => {
  try {
    const { negocioId } = _contexto(req);
    const data = await service.eliminar(Number(req.params.id), negocioId);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const guardarGeometria = async (req, res, next) => {
  try {
    const { sucursalId, negocioId } = _contexto(req);
    if (!sucursalId) return res.status(400).json({ ok: false, error: 'Sucursal requerida' });

    const data = await service.guardarGeometria(req.body?.posiciones || [], sucursalId, negocioId);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const asignar = async (req, res, next) => {
  try {
    const { sucursalId, negocioId, usuarioId } = _contexto(req);
    if (!sucursalId) return res.status(400).json({ ok: false, error: 'Sucursal requerida' });

    const data = await service.asignar(req.body || {}, sucursalId, negocioId, usuarioId);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

module.exports = {
  getUbicaciones,
  getArbol,
  getSinAsignar,
  buscar,
  ubicacionesDe,
  getMovimientos,
  getDetalle,
  getItems,
  crear,
  actualizar,
  eliminar,
  guardarGeometria,
  asignar,
};
