const router = require('express').Router();
const ctrl = require('./caja.controller');

router.get('/activa',           ctrl.getCajaActiva);
router.post('/abrir',           ctrl.abrirCaja);
router.patch('/:id/cerrar',     ctrl.cerrarCaja);
router.get('/:id/movimientos',  ctrl.getMovimientos);
router.post('/:id/movimientos', ctrl.registrarMovimiento);
router.get('/:id/resumen-dia',  ctrl.getResumenDia);

module.exports = router;