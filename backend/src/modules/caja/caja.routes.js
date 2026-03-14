// caja.routes.js
const router    = require('express').Router();
const { body }  = require('express-validator');
const { validate } = require('../../middlewares/validate.middleware');
const ctrl      = require('./caja.controller');

const validarMovimiento = [
  body('tipo').isIn(['Ingreso', 'Egreso']).withMessage('Tipo debe ser Ingreso o Egreso'),
  body('valor').isFloat({ gt: 0 }).withMessage('El valor debe ser mayor a 0'),
];

const validarCierre = [
  body('monto_cierre').isFloat({ min: 0 }).withMessage('Monto de cierre inválido'),
];

router.get('/activa',           ctrl.getCajaActiva);
router.post('/abrir',           ctrl.abrirCaja);
router.patch('/:id/cerrar',     validarCierre,    validate, ctrl.cerrarCaja);
router.get('/:id/movimientos',  ctrl.getMovimientos);
router.post('/:id/movimientos', validarMovimiento, validate, ctrl.registrarMovimiento);
router.get('/:id/resumen-dia',  ctrl.getResumenDia);

module.exports = router;