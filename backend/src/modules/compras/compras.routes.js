const router   = require('express').Router();
const { body } = require('express-validator');
const { validate }      = require('../../middlewares/validate.middleware');
const { requireNivel }  = require('../../middlewares/role.middleware');
const { requireModulo } = require('../../middlewares/modulo.middleware');
const ctrl     = require('./compras.controller');

const validarCompra = [
  body('proveedor_id').isInt({ gt: 0 }).withMessage('Proveedor requerido'),
  body('lineas').isArray({ min: 1 }).withMessage('Debe incluir al menos una línea'),
  body('lineas.*.precio_unitario').isFloat({ gt: 0 }).withMessage('Precio unitario inválido'),
  body('lineas.*.cantidad').isInt({ gt: 0 }).withMessage('Cantidad inválida'),
];

// Compras viven dentro del módulo de proveedores
router.get('/',                       requireModulo('proveedores'), ctrl.getCompras);
router.get('/proveedor/:proveedorId', requireModulo('proveedores'), ctrl.getComprasByProveedor);
router.get('/:id',                    requireModulo('proveedores'), ctrl.getCompraById);
router.post('/', requireModulo('proveedores'), requireNivel('supervisor'), validarCompra, validate, ctrl.registrarCompra);

module.exports = router;