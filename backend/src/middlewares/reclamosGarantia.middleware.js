// ─────────────────────────────────────────────────────────────────────────────
// SEGUNDO CANDADO de garantías con proveedores.
//
// El primero es el permiso de cada acción (`requirePermisoGarantias`). Este
// exige además que el negocio haya ENCENDIDO la función y que las tablas existan:
//   config_negocio: reclamos_garantia_activo = '1'
// Ausente = apagado: los negocios siguen exactamente igual hasta que cada uno
// lo encienda. Para quien no lo encendió, las rutas responden 404.
// ─────────────────────────────────────────────────────────────────────────────

const { pool } = require('../config/db');
const { hayReclamosGarantia } = require('../config/columnas');

const CLAVES = {
  activo:     'reclamos_garantia_activo',
  diasDemora: 'reclamos_garantia_dias_demora', // a partir de cuántos días afuera se marca «demorada»
};

// Los MISMOS rangos los valida config.service al guardar y los usa la pantalla:
// si se separan, se guardaría un número que se descarta callado.
const RANGOS = {
  reclamos_garantia_dias_demora: { min: 1, max: 180, defecto: 15, etiqueta: 'El aviso de garantía demorada con el proveedor' },
};

const _entero = (raw, { min, max, defecto }) => {
  const v = Number(raw);
  return raw != null && raw !== '' && Number.isInteger(v) && v >= min && v <= max ? v : defecto;
};

const _cache = new Map();
const TTL_MS = 60 * 1000;

const invalidarCache = (negocioId) => {
  if (negocioId == null) _cache.clear();
  else _cache.delete(Number(negocioId));
};

const getConfigReclamos = async (negocioId) => {
  const hit = _cache.get(Number(negocioId));
  if (hit && hit.expira > Date.now()) return hit.valor;
  const { rows } = await pool.query(
    `SELECT clave, valor FROM config_negocio WHERE negocio_id = $1 AND clave = ANY($2::text[])`,
    [negocioId, Object.values(CLAVES)]
  );
  const map = Object.fromEntries(rows.map((r) => [r.clave, r.valor]));
  const valor = {
    activo:      map[CLAVES.activo] === '1' && hayReclamosGarantia(),
    dias_demora: _entero(map[CLAVES.diasDemora], RANGOS.reclamos_garantia_dias_demora),
  };
  _cache.set(Number(negocioId), { valor, expira: Date.now() + TTL_MS });
  return valor;
};

const requireReclamosGarantia = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ ok: false, error: 'No autenticado' });
    const cfg = await getConfigReclamos(req.user.negocio_id);
    if (!cfg.activo) return res.status(404).json({ ok: false, error: 'Las garantías con proveedores no están activas en este negocio' });
    req.reclamosCfg = cfg;
    next();
  } catch (err) { next(err); }
};

module.exports = { requireReclamosGarantia, getConfigReclamos, invalidarCache, CLAVES, RANGOS };
