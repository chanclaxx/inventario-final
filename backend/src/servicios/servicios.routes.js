const router   = require('express').Router();
const { body } = require('express-validator');
const { validate }     = require('../../middlewares/validate.middleware');
const { requireNivel } = require('../../middlewares/role.middleware');
const ctrl = require('./servicios.controller');

const validarOrden = [
  body('cliente_nombre').notEmpty().trim().withMessage('El nombre del cliente es requerido'),
  body('falla_reportada').notEmpty().trim().withMessage('La falla reportada es requerida'),
  body('costo_estimado').optional({ nullable: true }).isFloat({ min: 0 }),
];

const validarListo = [
  body('precio_final').isFloat({ min: 0 }).withMessage('Precio final requerido'),
  body('costo_real').optional({ nullable: true }).isFloat({ min: 0 }),
];

const validarAbono = [
  body('valor').isFloat({ gt: 0 }).withMessage('El valor debe ser mayor a 0'),
  body('metodo').optional().isString().trim(),
];

const validarSinReparar = [
  body('motivo').notEmpty().withMessage('El motivo es requerido'),
  body('precio_diagnostico').optional({ nullable: true }).isFloat({ min: 0 }),
];

const validarGarantia = [
  body('cobrable').isBoolean().withMessage('Indica si la garantía es cobrable'),
];

router.get('/',            ctrl.getOrdenes);
router.get('/resumen-hoy', ctrl.getResumenHoy);
router.get('/:id',         ctrl.getOrdenById);

router.post('/',                        validarOrden,      validate, ctrl.crearOrden);
router.patch('/:id/en-reparacion',                                   ctrl.enReparacion);
router.patch('/:id/listo',              validarListo,      validate, ctrl.marcarListo);
router.post('/:id/abonos',              validarAbono,      validate, ctrl.registrarAbono);
router.patch('/:id/entregar',                                         ctrl.entregar);
router.patch('/:id/sin-reparar',        validarSinReparar, validate, ctrl.sinReparar);
router.patch('/:id/garantia',           validarGarantia,   validate, ctrl.abrirGarantia);
router.patch('/:id/notas',                                            ctrl.actualizarNotas);

module.exports = router;