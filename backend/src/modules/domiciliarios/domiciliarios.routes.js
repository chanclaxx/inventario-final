// ─────────────────────────────────────────────────────────────────────────────
// domiciliarios.routes.js
// Todos los roles pueden acceder — no usa requireNivel().
// La seguridad está en la capa de servicio (negocio_id del token).
// ─────────────────────────────────────────────────────────────────────────────
const router = require('express').Router();
const { body, query } = require('express-validator');
const { validate }    = require('../../middlewares/validate.middleware');
const ctrl            = require('./domiciliarios.controller');

// ── Validaciones ──────────────────────────────────────────────────────────────

const validarDomiciliario = [
  body('nombre')
    .isString().trim().notEmpty()
    .withMessage('El nombre del domiciliario es requerido'),
  body('telefono')
    .optional({ nullable: true })
    .isString().trim(),
];

const validarAbono = [
  body('valor')
    .isFloat({ gt: 0 })
    .withMessage('El valor del abono debe ser mayor a 0'),
  body('notas')
    .optional({ nullable: true })
    .isString().trim(),
];

const validarFiltroEntregas = [
  query('domiciliario_id').optional().isInt({ gt: 0 }),
  query('estado').optional().isIn(['Pendiente', 'Entregado', 'No_entregado']),
];

// ── Domiciliarios (CRUD) ──────────────────────────────────────────────────────
router.get('/',    ctrl.getDomiciliarios);
router.post('/',   validarDomiciliario, validate, ctrl.crearDomiciliario);
router.patch('/:id', validarDomiciliario, validate, ctrl.actualizarDomiciliario);

// ── Entregas ──────────────────────────────────────────────────────────────────
router.get('/entregas',     validarFiltroEntregas, validate, ctrl.getEntregas);
router.get('/entregas/:id', ctrl.getEntregaById);

// ── Acciones sobre una entrega ────────────────────────────────────────────────
router.post('/entregas/:id/abonos',    validarAbono, validate, ctrl.registrarAbono);
router.patch('/entregas/:id/devolucion', ctrl.marcarDevolucion);

module.exports = router;