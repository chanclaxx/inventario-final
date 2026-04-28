const router   = require('express').Router();
const { body } = require('express-validator');
const { validate }      = require('../../middlewares/validate.middleware');
const { requireNivel }  = require('../../middlewares/role.middleware');
const { requireModulo } = require('../../middlewares/modulo.middleware');
const ctrl = require('./creditos.controller');

const validarAbono = [
  body('valor').isFloat({ gt: 0 }).withMessage('El valor debe ser mayor a 0'),
  body('metodo').optional().isString().withMessage('Método de pago inválido'),
];

// Créditos viven dentro del módulo de préstamos
router.get('/',              requireModulo('prestamos'), ctrl.getCreditos);
router.get('/:id',           requireModulo('prestamos'), ctrl.getCreditoById);
router.post('/:id/abonos',   requireModulo('prestamos'), validarAbono, validate,    ctrl.registrarAbono);
router.patch('/:id/saldar',  requireModulo('prestamos'), requireNivel('vendedor'),      ctrl.saldarCredito);
router.patch('/:id/cancelar',requireModulo('prestamos'), requireNivel('admin_negocio'), ctrl.cancelarCredito);

module.exports = router;