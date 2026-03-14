const router   = require('express').Router();
const { body } = require('express-validator');
const { validate }    = require('../../middlewares/validate.middleware');
const { requireNivel } = require('../../middlewares/role.middleware');
const ctrl     = require('./compras.controller');

const validarCompra = [
  body('proveedor_id').isInt({ gt: 0 }).withMessage('Proveedor requerido'),
  body('lineas').isArray({ min: 1 }).withMessage('Debe incluir al menos una línea'),
  body('lineas.*.precio_unitario').isFloat({ gt: 0 }).withMessage('Precio unitario inválido'),
  body('lineas.*.cantidad').isInt({ gt: 0 }).withMessage('Cantidad inválida'),
];

router.get('/',                       ctrl.getCompras);
router.get('/proveedor/:proveedorId', ctrl.getComprasByProveedor);
router.get('/:id',                    ctrl.getCompraById);
router.post('/', requireNivel('supervisor'), validarCompra, validate, ctrl.registrarCompra);

module.exports = router;