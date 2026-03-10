const router = require('express').Router();
const { requireNivel } = require('../../middlewares/role.middleware');
const ctrl = require('./reportes.controller');

router.get('/dashboard',       ctrl.getDashboard);
router.get('/ventas-rango',    requireNivel('supervisor'), ctrl.getVentasRango);
router.get('/productos-top',   requireNivel('supervisor'), ctrl.getProductosTop);
router.get('/inventario-bajo', ctrl.getInventarioBajo);

module.exports = router;