const router   = require('express').Router();
const { body } = require('express-validator');
const { validate }      = require('../../middlewares/validate.middleware');
const { requireNivel }  = require('../../middlewares/role.middleware');
const { requireModulo } = require('../../middlewares/modulo.middleware');
const ctrl     = require('./acreedores.controller');
const pdfCtrl  = require('./acreedores.pdf.controller');

const validarMovimiento = [
  body('tipo').isIn(['Abono', 'Cargo']).withMessage('Tipo debe ser Abono o Cargo'),
  body('valor').isFloat({ gt: 0 }).withMessage('El valor debe ser mayor a 0'),
  body('descripcion').optional().isString().trim().isLength({ max: 500 }),
  body('firma').optional().isString().isLength({ max: 50000 }).withMessage('Firma demasiado grande'),
  body('metodo').optional({ values: 'null' }).isString().withMessage('Método de pago inválido'),
  body('registrar_en_caja').optional().toBoolean(),
  body('cargo_id').optional({ values: 'null' }).isInt({ min: 1 }).withMessage('cargo_id inválido'),
];

router.get('/cruces',              requireModulo('acreedores'), ctrl.getAcreedoresCruces);
// Va ANTES de /:id — si no, Express toma "facturas" como el id de un acreedor.
router.get('/facturas',            requireModulo('acreedores'), ctrl.getFacturasPorVencer);
// Poner o corregir el plazo de un cargo ya registrado. Mismo nivel que
// registrar una compra: cambia cuándo hay que pagar, no cuánto.
router.patch('/facturas/:cargoId/plazo', requireModulo('acreedores'), requireNivel('supervisor'),
  [
    body('fecha_factura').optional({ values: 'null' }).isISO8601().withMessage('Fecha de factura inválida'),
    body('dias_plazo').optional({ values: 'null' }).isInt({ min: 0, max: 365 }).withMessage('Plazo inválido (0 a 365 días)'),
    body('fecha_vencimiento').optional({ values: 'null' }).isISO8601().withMessage('Fecha de vencimiento inválida'),
  ],
  validate, ctrl.ponerPlazoACargo);

router.get('/',                    requireModulo('acreedores'), ctrl.getAcreedores);
router.get('/:id',                 requireModulo('acreedores'), ctrl.getAcreedorById);
router.get('/:id/cargos',                    requireModulo('acreedores'), ctrl.getCargosAbiertos);
router.get('/:id/compras-saldo',             requireModulo('acreedores'), ctrl.getComprasConSaldo);
router.get('/:id/cargos/:cargoId/abonos',    requireModulo('acreedores'), ctrl.getAbonosPorCargo);
router.get('/:id/saldo-favor',     requireModulo('acreedores'), ctrl.getSaldoAFavor);
router.get('/:id/historial',       requireModulo('acreedores'), ctrl.getHistorial);
router.get('/:id/pdf',             requireModulo('acreedores'), pdfCtrl.getPdfCuentaAcreedor);
router.post('/',                   requireModulo('acreedores'), requireNivel('supervisor'),    ctrl.crearAcreedor);
router.post('/:id/movimientos',    requireModulo('acreedores'), validarMovimiento, validate,   ctrl.registrarMovimiento);
router.post('/:id/abono-total',    requireModulo('acreedores'),
  [
    body('valor').isFloat({ gt: 0 }).withMessage('El valor debe ser mayor a 0'),
    body('metodo').optional({ values: 'null' }).isString(),
    body('registrar_en_caja').optional().toBoolean(),
    body('descripcion').optional({ values: 'null' }).isString()
      .isLength({ max: 200 }).withMessage('La descripción no puede pasar de 200 caracteres'),
  ],
  validate, ctrl.registrarAbonoTotal,
);
router.post('/:id/aplicar-saldo',  requireModulo('acreedores'),
  [
    body('cargo_id').isInt({ min: 1 }).withMessage('cargo_id requerido'),
    body('valor').isFloat({ gt: 0 }).withMessage('El valor debe ser mayor a 0'),
  ],
  validate, ctrl.aplicarSaldoAFavor,
);
router.put('/:id/movimientos/:movId',
  requireModulo('acreedores'), requireNivel('admin_negocio'),
  [
    body('valor').isFloat({ gt: 0 }).withMessage('El valor debe ser mayor a 0'),
    body('descripcion').optional({ values: 'null' }).isString().trim().isLength({ max: 500 }),
    body('metodo').optional({ values: 'null' }).isString(),
    body('cargo_id').optional({ values: 'null' }).isInt({ min: 1 }),
    body('registrar_en_caja').optional().toBoolean(),
  ],
  validate, ctrl.editarAbono,
);
router.delete('/:id/movimientos/:movId', requireModulo('acreedores'), requireNivel('admin_negocio'), ctrl.eliminarAbono);
router.delete('/:id',              requireModulo('acreedores'), requireNivel('admin_negocio'), ctrl.eliminarAcreedor);

module.exports = router;