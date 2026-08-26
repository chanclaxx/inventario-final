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

// Documentos de la obligación. `/documento` alimenta la impresión POS con el
// mismo resumen que usan los PDF, para que impreso y pantalla coincidan.
router.get('/:id/documento',       requireModulo('prestamos'), ctrl.getDocumento);
router.get('/:id/pdf/aviso-mora',  requireModulo('prestamos'), ctrl.exportarPdfAvisoMora);
router.get('/:id/pdf/paz-y-salvo', requireModulo('prestamos'), ctrl.exportarPdfPazYSalvo);
// Pago total y anulación de abonos. Van ANTES de las rutas con /:id para que
// 'abono-total' no se lea como el id de un crédito.
router.post('/abono-total', requireModulo('prestamos'),
  body('cliente_id').isInt({ min: 1 }).withMessage('cliente_id inválido'),
  body('valor_total').isFloat({ gt: 0 }).withMessage('El valor del pago debe ser mayor a 0'),
  body('descripcion').optional({ values: 'null' }).isString()
    .isLength({ max: 200 }).withMessage('La descripción no puede pasar de 200 caracteres'),
  validate, ctrl.registrarAbonoTotal);
// Anular exige MOTIVO: sin él la cuenta cambia y nadie sabe por qué.
router.patch('/abonos/:abonoId/anular', requireModulo('prestamos'), requireNivel('supervisor'),
  body('motivo').isString().isLength({ min: 3, max: 200 })
    .withMessage('Escribe el motivo de la anulación'),
  validate, ctrl.anularAbono);

router.post('/:id/abonos',   requireModulo('prestamos'), validarAbono, validate,    ctrl.registrarAbono);
router.patch('/:id/saldar',  requireModulo('prestamos'), requireNivel('vendedor'),      ctrl.saldarCredito);
router.patch('/:id/cancelar',requireModulo('prestamos'), requireNivel('admin_negocio'), ctrl.cancelarCredito);

// ── Mora ─────────────────────────────────────────────────────────────────────
// El plazo lo puede fijar un supervisor; condonar es solo del admin y además
// pide el PIN (se valida en el service, no aquí, para que el 403 traiga motivo).
router.patch('/:id/plazo',        requireModulo('prestamos'), requireNivel('supervisor'),    ctrl.fijarPlazo);
router.post('/:id/mora/cobrar',   requireModulo('prestamos'), requireNivel('vendedor'),      ctrl.cobrarMora);
router.post('/:id/mora/condonar', requireModulo('prestamos'), requireNivel('admin_negocio'), ctrl.condonarMora);
// Interés corriente. Cobrar y condonar reusan las rutas de arriba con
// `concepto: 'interes'` en el body: es el mismo movimiento con otra causa.
router.patch('/:id/interes',      requireModulo('prestamos'), requireNivel('supervisor'),    ctrl.fijarInteres);

module.exports = router;