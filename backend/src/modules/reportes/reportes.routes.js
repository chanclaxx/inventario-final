const router   = require('express').Router();
const { query, body } = require('express-validator');
const { validate }     = require('../../middlewares/validate.middleware');
const { requireNivel } = require('../../middlewares/role.middleware');
const ctrl     = require('./reportes.controller');

// ── Validador reutilizable de rango de fechas ──────────────────────────────
const validarRango = [
  query('desde')
    .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Formato de fecha inválido (YYYY-MM-DD)')
    .custom((v) => { if (isNaN(Date.parse(v))) throw new Error('Fecha desde inválida'); return true; }),
  query('hasta')
    .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Formato de fecha inválido (YYYY-MM-DD)')
    .custom((v) => { if (isNaN(Date.parse(v))) throw new Error('Fecha hasta inválida'); return true; }),
];

router.get('/dashboard',        ctrl.getDashboard);
router.get('/ventas-rango',     requireNivel('supervisor'), validarRango, validate, ctrl.getVentasRango);
router.get('/productos-top',    requireNivel('supervisor'), validarRango, validate, ctrl.getProductosTop);
router.get('/inventario-bajo',  ctrl.getInventarioBajo);
router.patch('/costo-compra',   requireNivel('admin_negocio'), ctrl.actualizarCostoCompra);
router.get('/inventario/valor', requireNivel('admin_negocio'), ctrl.getValorInventario);

module.exports = router;