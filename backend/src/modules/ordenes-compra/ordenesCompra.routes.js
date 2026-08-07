const router   = require('express').Router();
const { body } = require('express-validator');
const { validate }      = require('../../middlewares/validate.middleware');
const { requireNivel }  = require('../../middlewares/role.middleware');
const { requireModulo } = require('../../middlewares/modulo.middleware');
const { requireOrdenesCompra } = require('../../middlewares/ordenesCompra.middleware');
const ctrl = require('./ordenesCompra.controller');

// ─────────────────────────────────────────────────────────────────────────────
// DOBLE CANDADO, obligatorio.
//
// `requireModulo` no basta: tieneAcceso() devuelve true incondicionalmente para
// admin_negocio, así que con un solo candado entrarían los admins de los 28
// negocios. `requireOrdenesCompra` exige además que ESTE negocio haya encendido
// la feature en Ajustes; si no, responde 404 — para él el módulo no existe.
// ─────────────────────────────────────────────────────────────────────────────
router.use(requireModulo('proveedores'));
router.use(requireOrdenesCompra('ordenes'));

const validarOrden = [
  body('proveedor_id').isInt({ gt: 0 }).withMessage('Proveedor requerido'),
  body('lineas').isArray({ min: 1 }).withMessage('La orden necesita al menos un producto'),
  body('lineas.*.cantidad_pedida').isInt({ gt: 0 }).withMessage('Cantidad inválida'),
  body('lineas.*.nombre_producto').isString().trim().notEmpty().withMessage('Producto sin nombre'),
  body('lineas.*.precio_estimado').optional({ values: 'null' }).isFloat({ min: 0 }),
  body('lineas.*.garantia_dias').optional({ values: 'null' }).isInt({ min: 0, max: 3650 }),
  body('numero_factura').optional({ values: 'null' }).isString().trim().isLength({ max: 60 }),
  body('dias_plazo').optional({ values: 'null' }).isInt({ min: 0, max: 365 }),
  body('notas').optional({ values: 'null' }).isString().trim().isLength({ max: 1000 }),
];

router.get('/',    ctrl.getOrdenes);
router.get('/:id', ctrl.getOrdenById);

// Crear, emitir y cerrar mueven compromisos con un proveedor: mismo nivel que
// registrar una compra.
router.post('/', requireNivel('supervisor'), validarOrden, validate, ctrl.crearOrden);

router.put('/:id', requireNivel('supervisor'),
  [
    body('lineas').optional().isArray({ min: 1 }).withMessage('La orden necesita al menos un producto'),
    body('lineas.*.cantidad_pedida').optional().isInt({ gt: 0 }).withMessage('Cantidad inválida'),
    body('numero_factura').optional({ values: 'null' }).isString().trim().isLength({ max: 60 }),
    body('dias_plazo').optional({ values: 'null' }).isInt({ min: 0, max: 365 }),
    body('notas').optional({ values: 'null' }).isString().trim().isLength({ max: 1000 }),
  ],
  validate, ctrl.editarOrden);

router.patch('/:id/emitir', requireNivel('supervisor'), ctrl.emitirOrden);

router.patch('/:id/cerrar', requireNivel('supervisor'),
  [body('motivo').optional({ values: 'null' }).isString().trim().isLength({ max: 300 })],
  validate, ctrl.cerrarOrden);

// Anular solo admin: borra el compromiso entero (y su cargo, si la deuda había
// nacido con la orden).
router.patch('/:id/anular', requireNivel('admin_negocio'),
  [body('motivo').optional({ values: 'null' }).isString().trim().isLength({ max: 300 })],
  validate, ctrl.anularOrden);

module.exports = router;
