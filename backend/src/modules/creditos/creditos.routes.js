// creditos.routes.js
const router   = require('express').Router();
const { body } = require('express-validator');
const { validate } = require('../../middlewares/validate.middleware');
const ctrl     = require('./creditos.controller');

const validarAbono = [
  body('valor').isFloat({ gt: 0 }).withMessage('El valor debe ser mayor a 0'),
  body('metodo')
    .optional()
    .isIn(['Efectivo', 'Transferencia', 'Tarjeta', 'Nequi', 'Daviplata', 'Otro'])
    .withMessage('Método de pago no válido'),
];

router.get('/',            ctrl.getCreditos);
router.get('/:id',         ctrl.getCreditoById);
router.post('/:id/abonos', validarAbono, validate, ctrl.registrarAbono);

module.exports = router;