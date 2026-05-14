const router = require('express').Router();
const { body } = require('express-validator');
const { validate }      = require('../../middlewares/validate.middleware');
const { requireModulo } = require('../../middlewares/modulo.middleware');
const ctrl = require('./prestamos.controller');

const validarPrestamo = [
  body('valor_prestamo').isFloat({ gt: 0 }).withMessage('Valor del préstamo debe ser mayor a 0'),
  body('cantidad_prestada').optional().isInt({ min: 1 }).withMessage('Cantidad inválida'),
];

const validarPrestamos = [
  body('items').isArray({ min: 1 }).withMessage('Se requiere al menos un ítem'),
  body('items.*.valor_prestamo').isFloat({ gt: 0 }).withMessage('Valor del préstamo debe ser mayor a 0'),
  body('items.*.cantidad_prestada').optional().isInt({ min: 1 }).withMessage('Cantidad inválida'),
];

const validarAbono = [
  body('valor').isFloat({ gt: 0 }).withMessage('El valor del abono debe ser mayor a 0'),
];

const validarDevolucionParcial = [
  body('cantidad_devuelta').isInt({ min: 1 }).withMessage('La cantidad a devolver debe ser mayor a 0'),
];

const validarSaldoAFavor = [
  body('monto').isFloat({ min: 0 }).withMessage('El monto debe ser mayor o igual a 0'),
];

const validarIntercambio = [
  body('valor_retoma').isFloat({ gt: 0 }).withMessage('El valor de retoma debe ser mayor a 0'),
  body('tipo_retoma').optional({ nullable: true }).isIn(['serial', 'cantidad']).withMessage("tipo_retoma debe ser 'serial' o 'cantidad'"),
  body('imei_retoma').optional({ nullable: true }).isString(),
  body('producto_serial_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('producto_cantidad_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('cantidad_retoma').optional({ nullable: true }).isInt({ min: 1 }),
  body('color_retoma').optional({ nullable: true }).isString(),
  body('descripcion').optional({ nullable: true }).isString(),
];

const validarRetomaDirecta = [
  body('tipo').isIn(['prestatario', 'cliente']).withMessage("tipo debe ser 'prestatario' o 'cliente'"),
  body('persona_id').isInt({ min: 1 }).withMessage('persona_id inválido'),
  body('valor_retoma').isFloat({ gt: 0 }).withMessage('El valor de retoma debe ser mayor a 0'),
  body('tipo_retoma').optional({ nullable: true }).isIn(['serial', 'cantidad']),
  body('imei_retoma').optional({ nullable: true }).isString(),
  body('producto_serial_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('producto_cantidad_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('cantidad_retoma').optional({ nullable: true }).isInt({ min: 1 }),
  body('color_retoma').optional({ nullable: true }).isString(),
  body('descripcion').optional({ nullable: true }).isString(),
];

router.get('/',       requireModulo('prestamos'), ctrl.getPrestamos);
router.post('/',      requireModulo('prestamos'), validarPrestamo,  validate, ctrl.crearPrestamo);
router.post('/batch', requireModulo('prestamos'), validarPrestamos, validate, ctrl.crearPrestamos);

// Rutas con segmentos literales — ANTES de /:id para evitar conflictos
router.patch(  '/personas/:tipo/:id/saldo-a-favor',       requireModulo('prestamos'), validarSaldoAFavor,    validate, ctrl.registrarSaldoAFavor);
router.get(    '/personas/:tipo/:id/resumen',              requireModulo('prestamos'), ctrl.getResumenCartera);
router.post(   '/personas/:tipo/:id/aplicar-saldo',        requireModulo('prestamos'), ctrl.aplicarSaldoAPrestamos);
router.get(    '/personas/:tipo/:id/retomas-directas',     requireModulo('prestamos'), ctrl.getRetomasDirectas);
router.get(    '/personas/:tipo/:id/estado-cuenta',        requireModulo('prestamos'), ctrl.getEstadoCuenta);
router.post(   '/retoma-directa',                          requireModulo('prestamos'), validarRetomaDirecta, validate, ctrl.retomaDirecta);
router.delete( '/retomas-directas/:retomaId',              requireModulo('prestamos'), ctrl.anularRetomaDirecta);
router.post(   '/ajuste-deuda',                            requireModulo('prestamos'), ctrl.crearAjusteDeuda);

router.get('/pdf/:tipo/:personaId', requireModulo('prestamos'), ctrl.exportarPdfPorPersona);
router.get('/:id/pdf',              requireModulo('prestamos'), ctrl.exportarPdfPrestamoIndividual);

// Rutas con :id dinámico — AL FINAL
router.patch( '/:id/valor',            requireModulo('prestamos'),
  body('valor_prestamo').isFloat({ gt: 0 }).withMessage('El valor debe ser mayor a 0'),
  validate, ctrl.editarValorPrestamo);
router.post(  '/:id/aplicar-saldo',    requireModulo('prestamos'), ctrl.aplicarSaldoAPrestamo);
router.get(   '/:id',                  requireModulo('prestamos'), ctrl.getPrestamoById);
router.post(  '/:id/abonos',           requireModulo('prestamos'), validarAbono,            validate, ctrl.registrarAbono);
router.delete('/:id/abonos/:abonoId',  requireModulo('prestamos'), ctrl.anularAbono);
router.post(  '/:id/intercambio',      requireModulo('prestamos'), validarIntercambio,       validate, ctrl.intercambiarPrestamo);
router.patch( '/:id/devolver',         requireModulo('prestamos'), ctrl.devolverPrestamo);
router.patch( '/:id/devolver-parcial', requireModulo('prestamos'), validarDevolucionParcial, validate, ctrl.devolverParcial);

module.exports = router;