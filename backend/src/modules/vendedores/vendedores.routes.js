// ─────────────────────────────────────────────────────────────────────────────
// vendedores.routes.js
// Catálogo de vendedores por negocio/sucursal. Lectura para todos los roles;
// creación/edición solo admin_negocio. La seguridad de negocio se garantiza en
// el service (negocio_id del token).
// ─────────────────────────────────────────────────────────────────────────────
const router = require('express').Router();
const { body, query } = require('express-validator');
const { validate }    = require('../../middlewares/validate.middleware');
const { requireNivel } = require('../../middlewares/role.middleware');
const ctrl = require('./vendedores.controller');

// ── Validaciones ──────────────────────────────────────────────────────────────

const validarVendedor = [
  body('nombre')
    .isString().trim().notEmpty()
    .withMessage('El nombre del vendedor es requerido'),
  body('sucursal_id')
    .optional({ nullable: true })
    .isInt({ gt: 0 }).withMessage('Sucursal inválida'),
  body('activo')
    .optional()
    .isBoolean().withMessage('activo debe ser booleano'),
];

const validarFiltro = [
  query('sucursal_id').optional().isInt({ gt: 0 }),
];

// ── Rutas ──────────────────────────────────────────────────────────────────────
// Estática antes de /:id
router.get('/activos', ctrl.getVendedoresActivos);
router.get('/',        validarFiltro, validate, ctrl.getVendedores);
router.post('/',       requireNivel('admin_negocio'), validarVendedor, validate, ctrl.crearVendedor);
router.patch('/:id',   requireNivel('admin_negocio'), validarVendedor, validate, ctrl.actualizarVendedor);

module.exports = router;
