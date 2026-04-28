const router = require('express').Router();
const { requireNivel }  = require('../../middlewares/role.middleware');
const { requireModulo } = require('../../middlewares/modulo.middleware');
const ctrl = require('./facturas.controller');
const { getPdfFactura } = require('./facturas.pdf.controller');
const { body } = require('express-validator');
const { validate } = require('../../middlewares/validate.middleware');

const validarFactura = [
  body('nombre_cliente').isString().trim().notEmpty().withMessage('Nombre requerido'),
  body('cedula').isString().trim().notEmpty().withMessage('Cédula requerida'),
  body('celular').isString().trim().notEmpty().withMessage('Celular requerido'),
  body('lineas').isArray({ min: 1 }).withMessage('Debe incluir al menos un producto'),
  body('lineas.*.precio').isFloat().withMessage('Precio inválido'),
  body('lineas.*.cantidad').isInt({ gt: 0 }).withMessage('Cantidad inválida'),
  body('pagos').isArray().withMessage('Pagos debe ser un arreglo'),
  body('pagos.*.metodo')
    .if(body('pagos').isArray({ min: 1 }))
    .isString().withMessage('Método de pago inválido'),
  body('pagos.*.valor')
    .if(body('pagos').isArray({ min: 1 }))
    .isFloat().withMessage('Valor de pago inválido'),
];

// Rutas estáticas ANTES de /:id
router.get('/recientes', requireModulo('facturar'), ctrl.getFacturasRecientes);
router.get('/buscar',    requireModulo('facturar'), ctrl.buscarFacturas);

router.get('/',            requireModulo('facturar'),                              ctrl.getFacturas);
router.get('/:id/pdf',     requireModulo('facturar'),                              getPdfFactura);
router.get('/:id',         requireModulo('facturar'),                              ctrl.getFacturaById);
router.post('/',           requireModulo('facturar'), validarFactura, validate,    ctrl.crearFactura);
router.patch('/:id/cancelar', requireModulo('facturar'), requireNivel('supervisor'), ctrl.cancelarFactura);
router.patch('/:id',          requireModulo('facturar'), requireNivel('supervisor'), ctrl.editarFactura);

module.exports = router;