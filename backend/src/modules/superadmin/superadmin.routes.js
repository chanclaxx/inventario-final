const jwt    = require('jsonwebtoken');
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const ctrl   = require('./superadmin.controller');

const loginLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             5,
  standardHeaders: true,
  legacyHeaders:   false,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Demasiados intentos fallidos. Espera 15 minutos antes de intentar de nuevo.',
    });
  },
});

// Middleware propio — verifica con JWT_SA_SECRET, no con JWT_SECRET
const authSuperadmin = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SA_SECRET);
    if (payload.rol !== 'superadmin') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

// Pública
router.post('/login', loginLimiter, ctrl.login);

// Protegidas — usan authSuperadmin en vez de auth + requireSuperadmin
router.get('/estadisticas',               authSuperadmin, ctrl.getEstadisticas);
router.get('/negocios',                   authSuperadmin, ctrl.getNegocios);
router.post('/negocios/:id/aprobar',      authSuperadmin, ctrl.aprobarNegocio);
router.patch('/negocios/:id/estado',      authSuperadmin, ctrl.cambiarEstado);
router.get('/planes',                     authSuperadmin, ctrl.getPlanes);
router.post('/negocios/:id/renovar-plan', authSuperadmin, ctrl.renovarPlan);

module.exports = router;