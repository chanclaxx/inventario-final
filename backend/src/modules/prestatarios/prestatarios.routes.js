const router  = require('express').Router();
const ctrl    = require('./prestatarios.controller');

router.get('/',                   ctrl.getPrestatarios);
router.post('/',                  ctrl.crearPrestatario);
router.get('/:id/empleados',      ctrl.getEmpleados);
router.post('/:id/empleados',     ctrl.crearEmpleado);

// ─── Cuenta corriente ────────────────────────────────────────────────────────
router.get( '/:id/movimientos',              ctrl.getMovimientos);
router.post('/:id/movimientos',              ctrl.registrarMovimiento);
router.delete('/:id/movimientos/:movId',     ctrl.anularMovimiento);
router.get( '/:id/saldo',                   ctrl.getSaldo);
router.get( '/:id/resumen',                 ctrl.getResumen);

module.exports = router;