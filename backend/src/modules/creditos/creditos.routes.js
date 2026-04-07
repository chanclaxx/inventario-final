const router   = require('express').Router();
const { body } = require('express-validator');
const { validate }     = require('../../middlewares/validate.middleware');
const { requireNivel } = require('../../middlewares/role.middleware');
const ctrl = require('./creditos.controller');

const validarAbono = [
  body('valor').isFloat({ gt: 0 }).withMessage('El valor debe ser mayor a 0'),
  body('metodo').optional().isString().withMessage('Método de pago inválido'),
];

router.get('/',              ctrl.getCreditos);
router.get('/:id',           ctrl.getCreditoById);
router.post('/:id/abonos',   validarAbono, validate, ctrl.registrarAbono);
router.patch('/:id/saldar',    requireNivel('vendedor'),      ctrl.saldarCredito);
router.patch('/:id/cancelar',  requireNivel('admin_negocio'), ctrl.cancelarCredito);

module.exports = router;