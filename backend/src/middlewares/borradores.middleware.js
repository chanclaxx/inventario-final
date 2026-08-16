// src/middlewares/borradores.middleware.js
// ─────────────────────────────────────────────────────────────────────────────
// SEGUNDO CANDADO de los borradores de venta.
//
// El primero es `requireModulo('inventario')`, que valida permisos de usuario.
// Ese no basta: `tieneAcceso` devuelve true incondicionalmente para
// admin_negocio, así que TODOS los admins de TODOS los negocios pasarían y les
// aparecería una feature que nadie pidió.
//
// Este middleware exige además que el negocio la haya encendido:
//   config_negocio: borradores_activo = '1'
//
// Un negocio que no la activó recibe 404 — para él esto no existe.
//
// ── Por qué 'inventario' y no 'facturar' ─────────────────────────────────────
// Un borrador puede acabar en factura O en préstamo, así que ninguna de las dos
// claves sola es correcta. El carrito vive dentro de Inventario: quien puede ver
// el carrito puede guardarlo. Con 'facturar' quedaría fuera el usuario que solo
// tiene préstamos.
// ─────────────────────────────────────────────────────────────────────────────

const { pool } = require('../config/db');

const CLAVES = {
  activo: 'borradores_activo',
  dias:   'borradores_dias',      // 0 = no vencen nunca
};

const DEFAULTS = {
  // Una semana: suficiente para el cliente que "vuelve el sábado" y corto para
  // que la lista no se vuelva un cementerio. Sin vencimiento, las advertencias
  // de reserva se convierten en ruido que el vendedor aprende a descartar sin
  // leer, y ahí la feature entera deja de servir.
  dias: 7,
};

// Tope duro: un borrador de más de un año no es una reserva, es basura. El
// límite vive aquí y en la validación de Configuración.
const MAX_DIAS = 365;

// Cache corto por negocio: esta config se lee en cada request del módulo y casi
// nunca cambia. 60s no castiga la BD y config.service la invalida al guardar.
const _cache = new Map(); // negocio_id → { valor, expira }
const TTL_MS = 60 * 1000;

const invalidarCache = (negocioId) => {
  if (negocioId == null) _cache.clear();
  else _cache.delete(Number(negocioId));
};

const _dias = (raw) => {
  const v = Number(raw);
  if (!Number.isInteger(v) || v < 0 || v > MAX_DIAS) return DEFAULTS.dias;
  return v;
};

/**
 * Lee (y cachea) la configuración de borradores de un negocio.
 * Devuelve siempre un objeto; `activo: false` si no está encendida.
 */
const getConfigBorradores = async (negocioId) => {
  const hit = _cache.get(negocioId);
  if (hit && hit.expira > Date.now()) return hit.valor;

  const { rows } = await pool.query(
    `SELECT clave, valor FROM config_negocio
     WHERE negocio_id = $1 AND clave = ANY($2::text[])`,
    [negocioId, Object.values(CLAVES)]
  );
  const map = Object.fromEntries(rows.map((r) => [r.clave, r.valor]));

  const dias = _dias(map[CLAVES.dias]);

  const valor = {
    activo: map[CLAVES.activo] === '1',
    // 0 = los borradores no vencen. Se guarda como número y `expira_en` queda
    // NULL, que es lo que la consulta interpreta como "vive para siempre".
    dias,
    vencen: dias > 0,
  };

  _cache.set(negocioId, { valor, expira: Date.now() + TTL_MS });
  return valor;
};

/**
 * Middleware: exige que la feature esté encendida en este negocio.
 * Deja la config en `req.configBorradores` para que el service no la relea.
 */
const requireBorradores = async (req, res, next) => {
  try {
    const negocioId = req.user?.negocio_id;
    if (!negocioId) {
      return res.status(401).json({ ok: false, error: 'No autenticado' });
    }

    const cfg = await getConfigBorradores(negocioId);
    req.configBorradores = cfg;

    if (!cfg.activo) {
      // 404 y no 403: para un negocio que no activó la feature, esto no existe.
      return res.status(404).json({ ok: false, error: 'Recurso no encontrado' });
    }

    return next();
  } catch (err) {
    // Si las tablas aún no existen (migración no aplicada), el módulo queda
    // fuera de servicio pero el resto del sistema sigue igual.
    if (err?.code === '42P01') {
      return res.status(503).json({
        ok:    false,
        error: 'Los borradores aún no están disponibles en este servidor',
      });
    }
    return next(err);
  }
};

module.exports = {
  requireBorradores,
  getConfigBorradores,
  invalidarCache,
  CLAVES,
  DEFAULTS,
  MAX_DIAS,
};
