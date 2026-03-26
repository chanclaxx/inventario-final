const router = require('express').Router();
const { body } = require('express-validator');
const { validate } = require('../../middlewares/validate.middleware');
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

// ── Rutas estáticas ANTES de /:id para evitar conflictos ──────────────────────
router.get('/',       ctrl.getPrestamos);
router.post('/',      validarPrestamo,  validate, ctrl.crearPrestamo);
router.post('/batch', validarPrestamos, validate, ctrl.crearPrestamos); // ← antes de /:id

router.get('/:id',                    ctrl.getPrestamoById);
router.post('/:id/abonos',            validarAbono,             validate, ctrl.registrarAbono);
router.patch('/:id/devolver',                                             ctrl.devolverPrestamo);
router.patch('/:id/devolver-parcial', validarDevolucionParcial, validate, ctrl.devolverParcial);

module.exports = router;