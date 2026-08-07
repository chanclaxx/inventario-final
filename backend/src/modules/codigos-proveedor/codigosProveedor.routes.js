const router   = require('express').Router();
const { body, param, query } = require('express-validator');
const { validate }      = require('../../middlewares/validate.middleware');
const { requireNivel }  = require('../../middlewares/role.middleware');
const { requireModulo } = require('../../middlewares/modulo.middleware');
const { requireOrdenesCompra } = require('../../middlewares/ordenesCompra.middleware');
const ctrl = require('./codigosProveedor.controller');

// ─────────────────────────────────────────────────────────────────────────────
// Doble candado, y el segundo verifica DOS cosas: que el negocio encendiera los
// códigos de proveedor Y que tenga encendidos los códigos internos. La
// equivalencia apunta al código interno; sin él no hay a dónde apuntar, así que
// si alguien apaga los códigos internos después, esto se apaga solo en vez de
// resolver al vacío.
// ─────────────────────────────────────────────────────────────────────────────
router.use(requireModulo('proveedores'));
router.use(requireOrdenesCompra('codigos'));

// Resolver va ANTES de /:proveedorId — si no, Express toma "resolver" como id.
router.get('/resolver',
  [
    query('proveedor_id').isInt({ gt: 0 }).withMessage('Proveedor requerido'),
    query('codigo').isString().trim().notEmpty().withMessage('Código requerido'),
  ],
  validate, ctrl.resolverCodigo);

router.get('/producto/:codigoInterno', ctrl.getPorProducto);

router.get('/:proveedorId',
  [param('proveedorId').isInt({ gt: 0 })],
  validate, ctrl.getCodigos);

// Aprender es la vía normal: se guarda sola cuando alguien resuelve un código a
// mano al recibir. Mismo nivel que registrar una compra.
router.post('/', requireNivel('supervisor'),
  [
    body('proveedor_id').isInt({ gt: 0 }).withMessage('Proveedor requerido'),
    body('codigo_proveedor').isString().trim().notEmpty().isLength({ max: 120 })
      .withMessage('Código del proveedor requerido'),
    body('codigo_interno').isString().trim().notEmpty().isLength({ max: 120 })
      .withMessage('Código interno requerido'),
    body('descripcion_proveedor').optional({ values: 'null' }).isString().trim().isLength({ max: 300 }),
  ],
  validate, ctrl.aprenderCodigo);

router.delete('/:id', requireNivel('supervisor'),
  [param('id').isInt({ gt: 0 })],
  validate, ctrl.eliminarCodigo);

module.exports = router;
