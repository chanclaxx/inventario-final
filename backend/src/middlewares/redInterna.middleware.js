// src/middlewares/redInterna.middleware.js
// ─────────────────────────────────────────────────────────────────────────────
// SEGUNDO CANDADO de la red interna (bodega → locales).
//
// El primero es `requireModulo('red_interna')`, que valida permisos de usuario.
// Ese no basta: `tieneAcceso` devuelve true incondicionalmente para
// admin_negocio, así que TODOS los admins de TODOS los negocios pasarían.
//
// Este middleware exige además que el negocio haya activado la feature:
//   config_negocio: red_interna_activa = '1'
//
// Un negocio que no la activó recibe 404 — para él el módulo no existe.
// ─────────────────────────────────────────────────────────────────────────────

const { pool } = require('../config/db');

// Claves de configuración de la feature y sus valores por defecto.
const CLAVES = {
  activa:            'red_interna_activa',
  bodegaId:          'red_interna_bodega_id',
  modoPrecio:        'red_interna_modo_precio',        // 'costo' (único soportado hoy)
  confirmarRecepcion:'red_interna_confirmar_recepcion',// '1' = el local confirma
  confirmarRemesa:   'red_interna_confirmar_remesa',   // '1' = la bodega confirma
  bloquearTraslados: 'red_interna_bloquear_traslados', // '1' = traslado libre off
  ocultarCostos:     'red_interna_ocultar_costos',     // '1' = vendedor sin costos
};

const DEFAULTS = {
  modo_precio:         'costo',
  confirmar_recepcion: true,
  confirmar_remesa:    true,
};

// Cache corto por negocio: esta config se lee en cada request de la red y casi
// nunca cambia. 60s es suficiente para no castigar la BD y para que un cambio
// en Configuración se sienta inmediato.
const _cache = new Map(); // negocio_id → { valor, expira }
const TTL_MS = 60 * 1000;

const invalidarCache = (negocioId) => {
  if (negocioId == null) _cache.clear();
  else _cache.delete(Number(negocioId));
};

/**
 * Lee (y cachea) la configuración de red interna de un negocio.
 * Devuelve siempre un objeto; `activa: false` si no está encendida.
 */
const getConfigRed = async (negocioId) => {
  const hit = _cache.get(negocioId);
  if (hit && hit.expira > Date.now()) return hit.valor;

  const { rows } = await pool.query(
    `SELECT clave, valor FROM config_negocio
     WHERE negocio_id = $1 AND clave = ANY($2::text[])`,
    [negocioId, Object.values(CLAVES)]
  );
  const map = Object.fromEntries(rows.map((r) => [r.clave, r.valor]));

  const bodegaId = Number(map[CLAVES.bodegaId]);
  const valor = {
    activa:              map[CLAVES.activa] === '1',
    bodega_id:           Number.isInteger(bodegaId) && bodegaId > 0 ? bodegaId : null,
    modo_precio:         map[CLAVES.modoPrecio] || DEFAULTS.modo_precio,
    // Ausente = activado (el default seguro es exigir confirmación).
    confirmar_recepcion: map[CLAVES.confirmarRecepcion] !== '0',
    confirmar_remesa:    map[CLAVES.confirmarRemesa]    !== '0',
    // Con la red activa, el traslado libre queda cerrado por defecto: si la
    // mercancía pudiera moverse por fuera, la bodega perdería su rastro y la
    // consignación dejaría de cuadrar.
    bloquear_traslados:  map[CLAVES.bloquearTraslados]  !== '0',
    // Los costos son información comercial sensible. Por defecto un vendedor
    // no los ve: confirma entregas y remite el dinero, pero no sabe a cuánto
    // le compró la bodega cada equipo.
    ocultar_costos:      map[CLAVES.ocultarCostos]      !== '0',
  };

  _cache.set(negocioId, { valor, expira: Date.now() + TTL_MS });
  return valor;
};

/**
 * ¿Existe ya la infraestructura de tablas?
 * La migración va en try/catch (no puede tumbar el arranque), así que puede
 * no haberse aplicado. Se comprueba una sola vez por proceso.
 */
let _infraLista = null;
const _hayInfra = async () => {
  if (_infraLista !== null) return _infraLista;
  const { rows } = await pool.query(`
    SELECT to_regclass('public.remisiones')                 AS a,
           to_regclass('public.lineas_remision')            AS b,
           to_regclass('public.remesas')                    AS c,
           to_regclass('public.movimientos_cuenta_interna') AS d
  `);
  _infraLista = Boolean(rows[0].a && rows[0].b && rows[0].c && rows[0].d);
  return _infraLista;
};

/**
 * Middleware. Deja en `req.red` la config resuelta y en `req.esBodega`
 * si la sucursal activa del request es la bodega del negocio.
 */
const requireRedInterna = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: 'No autenticado' });
    }

    const config = await getConfigRed(req.user.negocio_id);
    if (!config.activa) {
      // 404 y no 403: para este negocio la funcionalidad no existe.
      return res.status(404).json({ ok: false, error: 'Módulo no disponible' });
    }
    if (!config.bodega_id) {
      return res.status(409).json({
        ok: false,
        error: 'Falta definir cuál sucursal es la bodega. Configúralo en Ajustes → Bodega.',
      });
    }
    if (!(await _hayInfra())) {
      return res.status(503).json({
        ok: false,
        error: 'La red interna aún no está instalada en la base de datos. Contacta al soporte.',
      });
    }

    req.red      = config;
    req.esBodega = Number(req.sucursal_id) === Number(config.bodega_id);
    next();
  } catch (err) { next(err); }
};

module.exports = { requireRedInterna, getConfigRed, invalidarCache, CLAVES, DEFAULTS };
