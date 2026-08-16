const router   = require('express').Router();
const { body } = require('express-validator');
const { validate }           = require('../../middlewares/validate.middleware');
const { requireModulo }      = require('../../middlewares/modulo.middleware');
const { requireBorradores }  = require('../../middlewares/borradores.middleware');
const ctrl = require('./borradores.controller');

// ─────────────────────────────────────────────────────────────────────────────
// DOBLE CANDADO, obligatorio.
//
// `requireModulo` no basta: tieneAcceso() devuelve true incondicionalmente para
// admin_negocio, así que con un solo candado les aparecería la feature a los
// admins de los 28 negocios. `requireBorradores` exige además que ESTE negocio
// la haya encendido en Ajustes; si no, responde 404 — para él no existe.
//
// El módulo es 'inventario' y no 'facturar' a propósito: un borrador puede
// acabar en factura O en préstamo, y el carrito vive dentro de Inventario. Con
// 'facturar' quedaría fuera quien solo tiene préstamos.
// ─────────────────────────────────────────────────────────────────────────────
router.use(requireModulo('inventario'));
router.use(requireBorradores);

const validarBorrador = [
  body('titulo').isString().trim().notEmpty().withMessage('Ponle un nombre al borrador')
    .isLength({ max: 120 }).withMessage('El nombre es demasiado largo'),
  body('destino').optional({ values: 'null' })
    .isIn(['factura', 'prestamo', 'indefinido']).withMessage('Destino inválido'),
  body('nota').optional({ values: 'null' })
    .isString().trim().isLength({ max: 500 }),
  body('items').isArray({ min: 1 }).withMessage('El borrador necesita al menos un producto'),
  body('items.*.key').isString().trim().notEmpty().withMessage('Producto sin identificador'),
  body('items.*.nombre').isString().trim().notEmpty().withMessage('Producto sin nombre'),
  body('items.*.cantidad').optional({ values: 'null' }).isInt({ gt: 0 }).withMessage('Cantidad inválida'),
];

router.get('/',    ctrl.getBorradores);
router.get('/:id', ctrl.getBorradorById);

// Guardar y descartar borradores es parte de vender: cualquiera que use el
// carrito puede hacerlo. No lleva requireNivel — un vendedor que no pueda
// guardar el carrito del cliente que "ya vuelve" no tiene la feature.
router.post('/', validarBorrador, validate, ctrl.crearBorrador);

router.patch('/:id',
  [
    body('titulo').optional().isString().trim().notEmpty().isLength({ max: 120 }),
    body('destino').optional().isIn(['factura', 'prestamo', 'indefinido']),
    body('nota').optional({ values: 'null' }).isString().trim().isLength({ max: 500 }),
  ],
  validate, ctrl.editarBorrador);

router.patch('/:id/renovar', ctrl.renovarBorrador);

router.delete('/:id', ctrl.eliminarBorrador);

// El "robo" de un producto apalabrado en otro borrador.
router.delete('/:id/items/:itemId', ctrl.quitarItem);

module.exports = router;
