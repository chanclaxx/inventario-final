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
router.get('/paginadas',              requireModulo('proveedores'), ctrl.getComprasPaginadas);
router.get('/proveedor/:proveedorId', requireModulo('proveedores'), ctrl.getComprasByProveedor);
router.get('/:id',                    requireModulo('proveedores'), ctrl.getCompraById);
router.post('/', requireModulo('proveedores'), requireNivel('supervisor'), validarCompra, validate, ctrl.registrarCompra);
router.patch('/:id/cancelar', requireModulo('proveedores'), requireNivel('supervisor'), ctrl.cancelarCompra);
// Corrección de precios de una compra: solo admin_negocio (cascada a costo/deuda)
router.patch('/:id/precios', requireModulo('proveedores'), requireNivel('admin_negocio'),
  [
    body('lineas').isArray({ min: 1 }).withMessage('Debe indicar al menos una línea a editar'),
    body('lineas.*.linea_id').isInt({ gt: 0 }).withMessage('linea_id inválido'),
    body('lineas.*.precio_unitario').isFloat({ gt: 0 }).withMessage('Precio unitario inválido'),
    body('motivo').optional({ values: 'null' }).isString().trim().isLength({ max: 300 }),
  ],
  validate, ctrl.editarPreciosCompra);
router.post('/:id/devolucion', requireModulo('proveedores'), requireNivel('supervisor'),
  [
    body('lineas').isArray({ min: 1 }).withMessage('Debe indicar al menos una línea a devolver'),
    body('lineas.*.linea_id').isInt({ gt: 0 }).withMessage('linea_id inválido'),
    body('lineas.*.cantidad').optional().isInt({ gt: 0 }).withMessage('Cantidad inválida'),
    body('motivo').optional({ values: 'null' }).isString().trim().isLength({ max: 300 }),
  ],
  validate, ctrl.devolverCompra);

module.exports = router;