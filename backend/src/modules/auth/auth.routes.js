const router      = require('express').Router();
const rateLimit   = require('express-rate-limit');
const { auth }    = require('../../middlewares/auth.middleware');
const ctrl        = require('./auth.controller');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // ventana de 15 minutos
  max: 10,                   // máximo 10 intentos por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Demasiados intentos. Espera 15 minutos.' },
});

router.post('/login',   loginLimiter, ctrl.login);
router.post('/refresh', ctrl.refresh);
router.post('/logout',  ctrl.logout);
router.get('/me',       auth, ctrl.me);

module.exports = router;