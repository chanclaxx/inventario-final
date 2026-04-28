const router    = require('express').Router();
const { body }  = require('express-validator');
const { validate }      = require('../../middlewares/validate.middleware');
const { requireModulo } = require('../../middlewares/modulo.middleware');
const ctrl      = require('./caja.controller');

const validarMovimiento = [
  body('tipo').isIn(['Ingreso', 'Egreso']).withMessage('Tipo debe ser Ingreso o Egreso'),
  body('valor').isFloat({ gt: 0 }).withMessage('El valor debe ser mayor a 0'),
];

const validarCierre = [
  body('monto_cierre').isFloat({ min: 0 }).withMessage('Monto de cierre inválido'),
];

router.get('/activa',           requireModulo('caja'), ctrl.getCajaActiva);
router.post('/abrir',           requireModulo('caja'), ctrl.abrirCaja);
router.patch('/:id/cerrar',     requireModulo('caja'), validarCierre,     validate, ctrl.cerrarCaja);
router.get('/:id/movimientos',  requireModulo('caja'), ctrl.getMovimientos);
router.post('/:id/movimientos', requireModulo('caja'), validarMovimiento,  validate, ctrl.registrarMovimiento);
router.get('/:id/resumen-dia',  requireModulo('caja'), ctrl.getResumenDia);
router.patch('/movimientos/:movimientoId/toggle', requireModulo('caja'), ctrl.toggleMovimiento);

module.exports = router;