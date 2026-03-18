const router        = require('express').Router();
const rateLimit     = require('express-rate-limit');
const { auth }      = require('../../middlewares/auth.middleware');
const ctrl          = require('./auth.controller');
const usuariosCtrl  = require('../usuarios/usuarios.controller');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Demasiados intentos. Espera 15 minutos.' },
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { ok: false, error: 'Demasiadas solicitudes. Espera unos minutos.' },
});

// ── Rate limiter específico para recuperación ─────────────────────────────────
// Más restrictivo que login — evita abuso del servicio de email
const recuperacionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Demasiadas solicitudes. Espera 15 minutos.' },
});

router.post('/login',   loginLimiter,   ctrl.login);
router.post('/logout',  ctrl.logout);
router.post('/refresh', refreshLimiter, ctrl.refresh);
router.get('/me',       auth,           ctrl.me);

// ── Recuperación de contraseña — públicas, sin auth ───────────────────────────
router.post('/recuperar-password',  recuperacionLimiter, usuariosCtrl.solicitarRecuperacion);
router.post('/resetear-password',   recuperacionLimiter, usuariosCtrl.resetearPassword);

module.exports = router;