const router = require('express').Router();
const { requireNivel } = require('../../middlewares/role.middleware');
const ctrl = require('./facturas.controller');
const { body } = require('express-validator');
const { validate } = require('../../middlewares/validate.middleware');

const validarFactura = [
  body('nombre_cliente')
    .isString().trim().notEmpty()
    .withMessage('Nombre requerido'),

  body('cedula')
    .isString().trim().notEmpty()
    .withMessage('Cédula requerida'),

  body('celular')
    .isString().trim().notEmpty()
    .withMessage('Celular requerido'),

  body('lineas')
    .isArray({ min: 1 })
    .withMessage('Debe incluir al menos un producto'),

  body('lineas.*.precio')
    .isFloat()
    .withMessage('Precio inválido'),

  body('lineas.*.cantidad')
    .isInt({ gt: 0 })
    .withMessage('Cantidad inválida'),

  // pagos puede ser [] cuando es crédito sin cuota inicial
  body('pagos')
    .isArray()
    .withMessage('Pagos debe ser un arreglo'),

  // Solo validar metodo y valor cuando el array no está vacío
   body('pagos.*.metodo')
    .if(body('pagos').isArray({ min: 1 }))
    .isString()
    .withMessage('Método de pago inválido'),

  // Permite 0 y negativos (retoma que supera el total)
  body('pagos.*.valor')
    .if(body('pagos').isArray({ min: 1 }))
    .isFloat()
    .withMessage('Valor de pago inválido'),
];

// Rutas estáticas ANTES de /:id para evitar conflictos
router.get('/recientes', ctrl.getFacturasRecientes);
router.get('/buscar',    ctrl.buscarFacturas);

router.get('/',               ctrl.getFacturas);
router.get('/:id',            ctrl.getFacturaById);
router.post('/', validarFactura, validate, ctrl.crearFactura);
router.patch('/:id/cancelar', requireNivel('supervisor'), ctrl.cancelarFactura);
router.patch('/:id',          requireNivel('supervisor'), ctrl.editarFactura);

module.exports = router;