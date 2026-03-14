const jwt       = require('jsonwebtoken');
const router    = require('express').Router();
const rateLimit = require('express-rate-limit');
const { pool }  = require('../../config/db');          // ← agregar
const ctrl      = require('./superadmin.controller');

const loginLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             5,
  standardHeaders: true,
  legacyHeaders:   false,
  handler: (req, res) => {
    res.status(429).json({
      ok: false,                                        // ← agregar ok: false
      error: 'Demasiados intentos fallidos. Espera 15 minutos antes de intentar de nuevo.',
    });
  },
});

const authSuperadmin = async (req, res, next) => {     // ← async
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'Token no proporcionado' });  // ← ok: false
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SA_SECRET);
    if (payload.rol !== 'superadmin') {
      return res.status(403).json({ ok: false, error: 'Acceso denegado' });       // ← ok: false
    }

    // ── Verificar que el superadmin sigue activo en DB ──────
    const { rows } = await pool.query(
      `SELECT activo FROM superadmins WHERE id = $1 LIMIT 1`,
      [payload.id]
    );
    if (!rows.length || !rows[0].activo) {
      return res.status(401).json({ ok: false, error: 'Superadmin inactivo' });
    }

    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ ok: false, error: 'Token inválido o expirado' }); // ← ok: false
  }
};

// Sin cambios en rutas
router.post('/login', loginLimiter, ctrl.login);

router.get('/estadisticas',               authSuperadmin, ctrl.getEstadisticas);
router.get('/negocios',                   authSuperadmin, ctrl.getNegocios);
router.post('/negocios/:id/aprobar',      authSuperadmin, ctrl.aprobarNegocio);
router.patch('/negocios/:id/estado',      authSuperadmin, ctrl.cambiarEstado);
router.get('/planes',                     authSuperadmin, ctrl.getPlanes);
router.post('/negocios/:id/renovar-plan', authSuperadmin, ctrl.renovarPlan);

module.exports = router;