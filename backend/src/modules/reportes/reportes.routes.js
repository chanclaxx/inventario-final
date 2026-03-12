// ─────────────────────────────────────────────
// REEMPLAZAR reportes.routes.js completo
// Solo se agrega la línea del PATCH al final
// ─────────────────────────────────────────────

const router = require('express').Router();
const { requireNivel } = require('../../middlewares/role.middleware');
const ctrl = require('./reportes.controller');

router.get('/dashboard',       ctrl.getDashboard);
router.get('/ventas-rango',    requireNivel('supervisor'), ctrl.getVentasRango);
router.get('/productos-top',   requireNivel('supervisor'), ctrl.getProductosTop);
router.get('/inventario-bajo', ctrl.getInventarioBajo);

// Solo admin_negocio puede corregir el costo de compra desde reportes
router.patch('/costo-compra',  requireNivel('admin_negocio'), ctrl.actualizarCostoCompra);

module.exports = router;