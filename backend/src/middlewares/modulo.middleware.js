// src/middlewares/modulo.middleware.js
// ─────────────────────────────────────────────────────────────────────────────
// Middleware que verifica si el usuario autenticado tiene acceso
// a un módulo específico. Se aplica después del middleware de auth.
//
// Uso en router:
//   const { requireModulo } = require('../../middlewares/modulo.middleware');
//   router.get('/', requireModulo('reportes'), ctrl.getReportes);
// ─────────────────────────────────────────────────────────────────────────────

const { tieneAcceso } = require('../config/modulos');

/**
 * Fábrica de middleware: verifica que req.user tenga acceso al módulo dado.
 *
 * @param {string} modulo - Clave del módulo (ej: 'reportes', 'caja')
 */
const requireModulo = (modulo) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ ok: false, error: 'No autenticado' });
  }

  if (tieneAcceso(req.user, modulo)) {
    return next();
  }

  return res.status(403).json({
    ok:    false,
    error: `No tienes acceso al módulo "${modulo}"`,
  });
};

module.exports = { requireModulo };