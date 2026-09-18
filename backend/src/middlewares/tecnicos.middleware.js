// ─────────────────────────────────────────────────────────────────────────────
// SEGUNDO CANDADO de técnicos externos.
//
// El primero es `requireModulo('servicios')`. Este exige además que el negocio
// haya ENCENDIDO la función y que las tablas existan:
//   config_negocio: tecnicos_externos_activo = '1'
// Ausente = apagado: los 28 negocios siguen exactamente igual hasta que cada
// uno lo encienda. Para quien no lo encendió, las rutas responden 404.
// ─────────────────────────────────────────────────────────────────────────────

const { pool } = require('../config/db');
const { hayTecnicos } = require('../config/columnas');

const CLAVES = {
  activo:       'tecnicos_externos_activo',
  diasDemora:   'tecnicos_dias_demora',          // aviso: equipo demorado donde el técnico
  diasGarantia: 'tecnicos_garantia_dias_aviso',  // aviso: garantía por vencer
};

// Los MISMOS rangos los valida config.service al guardar y los usa el motor de
// avisos al leer: si se separan, se guardaría un número que se descarta callado.
const RANGOS = {
  tecnicos_dias_demora:         { min: 1, max: 90, defecto: 7, etiqueta: 'El aviso de equipo demorado donde el técnico' },
  tecnicos_garantia_dias_aviso: { min: 1, max: 60, defecto: 5, etiqueta: 'El aviso de garantía del técnico por vencer' },
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

const getConfigTecnicos = async (negocioId) => {
  const hit = _cache.get(Number(negocioId));
  if (hit && hit.expira > Date.now()) return hit.valor;
  const { rows } = await pool.query(
    `SELECT clave, valor FROM config_negocio WHERE negocio_id = $1 AND clave = ANY($2::text[])`,
    [negocioId, Object.values(CLAVES)]
  );
  const map = Object.fromEntries(rows.map((r) => [r.clave, r.valor]));
  const valor = {
    activo:        map[CLAVES.activo] === '1' && hayTecnicos(),
    dias_demora:   _entero(map[CLAVES.diasDemora],   RANGOS.tecnicos_dias_demora),
    dias_garantia: _entero(map[CLAVES.diasGarantia], RANGOS.tecnicos_garantia_dias_aviso),
  };
  _cache.set(Number(negocioId), { valor, expira: Date.now() + TTL_MS });
  return valor;
};

const requireTecnicos = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ ok: false, error: 'No autenticado' });
    const cfg = await getConfigTecnicos(req.user.negocio_id);
    if (!cfg.activo) return res.status(404).json({ ok: false, error: 'Técnicos externos no está activo en este negocio' });
    req.tecnicosCfg = cfg;
    next();
  } catch (err) { next(err); }
};

module.exports = { requireTecnicos, getConfigTecnicos, invalidarCache, CLAVES, RANGOS };
