const router = require('express').Router();
const ctrl   = require('./superadmin.controller');
const { auth } = require('../../middlewares/auth.middleware');

// Middleware que verifica que sea superadmin
const requireSuperadmin = (req, res, next) => {
  if (req.user?.rol !== 'superadmin') {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  next();
};

// Pública
router.post('/login', ctrl.login);

// Protegidas
router.get('/estadisticas',         auth, requireSuperadmin, ctrl.getEstadisticas);
router.get('/negocios',             auth, requireSuperadmin, ctrl.getNegocios);
router.post('/negocios/:id/aprobar', auth, requireSuperadmin, ctrl.aprobarNegocio);
router.patch('/negocios/:id/estado', auth, requireSuperadmin, ctrl.cambiarEstado);
router.get('/planes',                   auth, requireSuperadmin, ctrl.getPlanes);
router.post('/negocios/:id/renovar-plan', auth, requireSuperadmin, ctrl.renovarPlan);

module.exports = router;