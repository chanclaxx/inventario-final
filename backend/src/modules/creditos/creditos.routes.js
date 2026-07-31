const router   = require('express').Router();
const { body } = require('express-validator');
const { validate }      = require('../../middlewares/validate.middleware');
const { requireNivel }  = require('../../middlewares/role.middleware');
const { requireModulo } = require('../../middlewares/modulo.middleware');
const ctrl = require('./creditos.controller');

const validarAbono = [
  body('valor').isFloat({ gt: 0 }).withMessage('El valor debe ser mayor a 0'),
  body('metodo').optional().isString().withMessage('Método de pago inválido'),
];

// Créditos viven dentro del módulo de préstamos
router.get('/',              requireModulo('prestamos'), ctrl.getCreditos);

// Estado de cuenta del cliente. Van ANTES de '/:id' o Express interpretaría
// 'estado-cuenta' como el id de un crédito.
router.get('/estado-cuenta',     requireModulo('prestamos'), ctrl.getEstadoCuenta);
router.get('/estado-cuenta/pdf', requireModulo('prestamos'), ctrl.exportarPdfEstadoCuenta);

router.get('/:id',           requireModulo('prestamos'), ctrl.getCreditoById);
router.post('/:id/abonos',   requireModulo('prestamos'), validarAbono, validate,    ctrl.registrarAbono);
router.patch('/:id/saldar',  requireModulo('prestamos'), requireNivel('vendedor'),      ctrl.saldarCredito);
router.patch('/:id/cancelar',requireModulo('prestamos'), requireNivel('admin_negocio'), ctrl.cancelarCredito);

// ── Mora ─────────────────────────────────────────────────────────────────────
// El plazo lo puede fijar un supervisor; condonar es solo del admin y además
// pide el PIN (se valida en el service, no aquí, para que el 403 traiga motivo).
router.patch('/:id/plazo',        requireModulo('prestamos'), requireNivel('supervisor'),    ctrl.fijarPlazo);
router.post('/:id/mora/cobrar',   requireModulo('prestamos'), requireNivel('vendedor'),      ctrl.cobrarMora);
router.post('/:id/mora/condonar', requireModulo('prestamos'), requireNivel('admin_negocio'), ctrl.condonarMora);

module.exports = router;