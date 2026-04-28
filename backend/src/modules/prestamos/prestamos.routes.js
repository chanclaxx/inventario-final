const router = require('express').Router();
const { body } = require('express-validator');
const { validate }      = require('../../middlewares/validate.middleware');
const { requireModulo } = require('../../middlewares/modulo.middleware');
const ctrl = require('./prestamos.controller');

const validarPrestamo = [
  body('valor_prestamo').isFloat({ gt: 0 }).withMessage('Valor del préstamo debe ser mayor a 0'),
  body('cantidad_prestada').optional().isInt({ min: 1 }).withMessage('Cantidad inválida'),
];

const validarPrestamos = [
  body('items').isArray({ min: 1 }).withMessage('Se requiere al menos un ítem'),
  body('items.*.valor_prestamo').isFloat({ gt: 0 }).withMessage('Valor del préstamo debe ser mayor a 0'),
  body('items.*.cantidad_prestada').optional().isInt({ min: 1 }).withMessage('Cantidad inválida'),
];

const validarAbono = [
  body('valor').isFloat({ gt: 0 }).withMessage('El valor del abono debe ser mayor a 0'),
];

const validarDevolucionParcial = [
  body('cantidad_devuelta').isInt({ min: 1 }).withMessage('La cantidad a devolver debe ser mayor a 0'),
];

router.get('/',       requireModulo('prestamos'), ctrl.getPrestamos);
router.post('/',      requireModulo('prestamos'), validarPrestamo,  validate, ctrl.crearPrestamo);
router.post('/batch', requireModulo('prestamos'), validarPrestamos, validate, ctrl.crearPrestamos);

router.get('/pdf/:tipo/:personaId', requireModulo('prestamos'), ctrl.exportarPdfPorPersona);

router.get('/:id',                    requireModulo('prestamos'), ctrl.getPrestamoById);
router.post('/:id/abonos',            requireModulo('prestamos'), validarAbono,             validate, ctrl.registrarAbono);
router.patch('/:id/devolver',         requireModulo('prestamos'),                                     ctrl.devolverPrestamo);
router.patch('/:id/devolver-parcial', requireModulo('prestamos'), validarDevolucionParcial, validate, ctrl.devolverParcial);

module.exports = router;