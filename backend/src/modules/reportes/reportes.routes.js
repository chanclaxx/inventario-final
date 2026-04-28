const router   = require('express').Router();
const { query, body } = require('express-validator');
const { validate }      = require('../../middlewares/validate.middleware');
const { requireNivel }  = require('../../middlewares/role.middleware');
const { requireModulo } = require('../../middlewares/modulo.middleware');
const ctrl     = require('./reportes.controller');

const validarRango = [
  query('desde')
    .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Formato de fecha inválido (YYYY-MM-DD)')
    .custom((v) => { if (isNaN(Date.parse(v))) throw new Error('Fecha desde inválida'); return true; }),
  query('hasta')
    .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Formato de fecha inválido (YYYY-MM-DD)')
    .custom((v) => { if (isNaN(Date.parse(v))) throw new Error('Fecha hasta inválida'); return true; }),
];

// dashboard: solo admin_negocio, no requiere módulo de usuario
router.get('/dashboard',        requireNivel('admin_negocio'), ctrl.getDashboard);

router.get('/ventas-rango',     requireModulo('reportes'), requireNivel('supervisor'),    validarRango, validate, ctrl.getVentasRango);
router.get('/productos-top',    requireModulo('reportes'), requireNivel('supervisor'),    validarRango, validate, ctrl.getProductosTop);
router.get('/inventario-bajo',  requireModulo('reportes'),                               ctrl.getInventarioBajo);
router.patch('/costo-compra',   requireModulo('reportes'), requireNivel('admin_negocio'), ctrl.actualizarCostoCompra);
router.get('/inventario/valor', requireModulo('reportes'), requireNivel('admin_negocio'), ctrl.getValorInventario);

module.exports = router;