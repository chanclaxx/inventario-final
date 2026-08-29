const router   = require('express').Router();
const { body } = require('express-validator');
const { validate }      = require('../../middlewares/validate.middleware');
const { requireNivel, requirePermisoVerCompras } = require('../../middlewares/role.middleware');
const { requireModulo } = require('../../middlewares/modulo.middleware');
const ctrl     = require('./compras.controller');

const validarCompra = [
  body('proveedor_id').isInt({ gt: 0 }).withMessage('Proveedor requerido'),
  body('lineas').isArray({ min: 1 }).withMessage('Debe incluir al menos una línea'),
  body('lineas.*.precio_unitario').isFloat({ gt: 0 }).withMessage('Precio unitario inválido'),
  body('lineas.*.cantidad').isInt({ gt: 0 }).withMessage('Cantidad inválida'),
  // Una compra contra una orden es una RECEPCIÓN. Ambos campos son opcionales:
  // la compra suelta de siempre —el único flujo con las órdenes apagadas— los
  // deja vacíos. No hace falta candado de configuración aquí: sin órdenes
  // creadas no hay ningún id que mandar, y el service valida que la orden sea
  // del negocio y de la sucursal antes de tocar nada.
  body('orden_compra_id').optional({ values: 'null' }).isInt({ gt: 0 }).withMessage('Orden de compra inválida'),
  body('lineas.*.orden_linea_id').optional({ values: 'null' }).isInt({ gt: 0 }).withMessage('Línea de orden inválida'),
  body('lineas.*.garantia_dias').optional({ values: 'null' }).isInt({ min: 0, max: 3650 }).withMessage('Garantía inválida (0 a 3650 días)'),
  // Compromiso de pago de una compra suelta: la factura del proveedor vence
  // aunque nadie haya creado una orden.
  body('dias_plazo').optional({ values: 'null' }).isInt({ min: 0, max: 365 }).withMessage('Plazo inválido (0 a 365 días)'),
];

// Compras viven dentro del módulo de proveedores.
// Las cuatro de lectura devuelven precios de compra, así que exigen además el
// permiso que hasta ahora solo miraba el frontend.
// ── Entradas de bodega ──────────────────────────────────────────────────────
// OJO: van ANTES de `/:id`. Express resuelve por orden de registro, así que
// `/entradas` declarada después entraría por `/:id` con id="entradas" y moriría
// en el permiso de ver compras.
//
// El bodeguero es un SUPERVISOR: no hace falta rol ni permiso nuevo, y por eso
// piden lo mismo que POST /compras. Recibir es estrictamente MENOS poderoso que
// registrar una compra: no decide proveedor, no decide precios y no toca caja.
//
// Van bajo el módulo `inventario` y no `proveedores`: el bodeguero cuenta cajas,
// no lleva la relación comercial. Pedirle proveedores para recibir le abriría la
// puerta que este trabajo vino a cerrar.
const validarEntrada = [
  body('lineas').isArray({ min: 1 }).withMessage('La entrada necesita al menos un producto'),
  body('lineas.*.cantidad').isInt({ gt: 0 }).withMessage('Cantidad invalida'),
  body('lineas.*.producto_id').isInt({ gt: 0 }).withMessage('Producto invalido'),
  body('orden_compra_id').optional({ values: 'null' }).isInt({ gt: 0 }).withMessage('Orden invalida'),
  body('notas').optional({ values: 'null' }).isString().trim().isLength({ max: 500 }),
];

router.get ('/entradas',         requireModulo('inventario'), requireNivel('supervisor'), ctrl.getEntradas);
router.get ('/entradas/ordenes', requireModulo('inventario'), requireNivel('supervisor'), ctrl.getOrdenesParaRecibir);
router.post('/entradas',         requireModulo('inventario'), requireNivel('supervisor'),
  validarEntrada, validate, ctrl.registrarEntrada);

// La bandeja y la confirmación SÍ son de administración: ponen proveedor y
// precios, y la corrección en cascada toca costo, total y deuda.
router.get('/por-confirmar', requireModulo('proveedores'), requirePermisoVerCompras, ctrl.getPorConfirmar);

router.get('/',                       requireModulo('proveedores'), requirePermisoVerCompras, ctrl.getCompras);
router.get('/paginadas',              requireModulo('proveedores'), requirePermisoVerCompras, ctrl.getComprasPaginadas);
router.get('/proveedor/:proveedorId', requireModulo('proveedores'), requirePermisoVerCompras, ctrl.getComprasByProveedor);
router.get('/:id',                    requireModulo('proveedores'), requirePermisoVerCompras, ctrl.getCompraById);

router.patch('/:id/confirmar', requireModulo('proveedores'), requireNivel('admin_negocio'),
  [
    body('proveedor_id').optional({ values: 'null' }).isInt({ gt: 0 }).withMessage('Proveedor invalido'),
    body('numero_factura').optional({ values: 'null' }).isString().trim().isLength({ max: 60 }),
    body('lineas').optional().isArray(),
    body('lineas.*.linea_id').optional().isInt({ gt: 0 }),
    body('lineas.*.precio_unitario').optional().isFloat({ gt: 0 }),
    body('fecha_factura').optional({ values: 'null' }).isISO8601().withMessage('Fecha de factura invalida'),
    body('dias_plazo').optional({ values: 'null' }).isInt({ min: 0, max: 365 }).withMessage('Plazo invalido (0 a 365 dias)'),
    body('fecha_vencimiento').optional({ values: 'null' }).isISO8601().withMessage('Vencimiento invalido'),
    body('pago.valor').optional({ values: 'null' }).isFloat({ gt: 0 }).withMessage('Valor del pago invalido'),
    body('pago.metodo').optional({ values: 'null' }).isString().trim().isLength({ max: 40 }),
  ],
  validate, ctrl.confirmarEntrada);
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