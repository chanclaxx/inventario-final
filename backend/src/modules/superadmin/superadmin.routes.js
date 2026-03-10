const router     = require('express').Router();
const rateLimit  = require('express-rate-limit');
const ctrl       = require('./superadmin.controller');
const { auth }   = require('../../middlewares/auth.middleware');

const loginLimiter = rateLimit({
  windowMs:         15 * 60 * 1000, // 15 minutos
  max:              5,               // máximo 5 intentos
  standardHeaders:  true,
  legacyHeaders:    false,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Demasiados intentos fallidos. Espera 15 minutos antes de intentar de nuevo.',
    });
  },
});

const requireSuperadmin = (req, res, next) => {
  if (req.user?.rol !== 'superadmin') {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  next();
};

// Pública con rate limit
router.post('/login', loginLimiter, ctrl.login);

// Protegidas
router.get('/estadisticas',               auth, requireSuperadmin, ctrl.getEstadisticas);
router.get('/negocios',                   auth, requireSuperadmin, ctrl.getNegocios);
router.post('/negocios/:id/aprobar',      auth, requireSuperadmin, ctrl.aprobarNegocio);
router.patch('/negocios/:id/estado',      auth, requireSuperadmin, ctrl.cambiarEstado);
router.get('/planes',                     auth, requireSuperadmin, ctrl.getPlanes);
router.post('/negocios/:id/renovar-plan', auth, requireSuperadmin, ctrl.renovarPlan);

module.exports = router;