// prestamos.routes.js
const router   = require('express').Router();
const { body } = require('express-validator');
const { validate } = require('../../middlewares/validate.middleware');
const ctrl     = require('./prestamos.controller');

const validarPrestamo = [
  body('valor_prestamo').isFloat({ gt: 0 }).withMessage('Valor del préstamo debe ser mayor a 0'),
  body('cantidad_prestada').optional().isInt({ min: 1 }).withMessage('Cantidad inválida'),
];

const validarAbono = [
  body('valor').isFloat({ gt: 0 }).withMessage('El valor del abono debe ser mayor a 0'),
];

router.get('/',               ctrl.getPrestamos);
router.get('/:id',            ctrl.getPrestamoById);
router.post('/',              validarPrestamo, validate, ctrl.crearPrestamo);
router.post('/:id/abonos',    validarAbono,   validate, ctrl.registrarAbono);
router.patch('/:id/devolver', ctrl.devolverPrestamo);

module.exports = router;