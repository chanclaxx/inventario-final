const router   = require('express').Router();
const { body } = require('express-validator');
const { validate }      = require('../../middlewares/validate.middleware');
const { requireNivel }  = require('../../middlewares/role.middleware');
const { requireModulo } = require('../../middlewares/modulo.middleware');
const ctrl     = require('./acreedores.controller');

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

router.get('/',                    requireModulo('acreedores'), ctrl.getAcreedores);
router.get('/:id',                 requireModulo('acreedores'), ctrl.getAcreedorById);
router.get('/:id/cargos',                    requireModulo('acreedores'), ctrl.getCargosAbiertos);
router.get('/:id/compras-saldo',             requireModulo('acreedores'), ctrl.getComprasConSaldo);
router.get('/:id/cargos/:cargoId/abonos',    requireModulo('acreedores'), ctrl.getAbonosPorCargo);
router.post('/',                   requireModulo('acreedores'), requireNivel('supervisor'),    ctrl.crearAcreedor);
router.post('/:id/movimientos',    requireModulo('acreedores'), validarMovimiento, validate,   ctrl.registrarMovimiento);
router.delete('/:id',              requireModulo('acreedores'), requireNivel('admin_negocio'), ctrl.eliminarAcreedor);

module.exports = router;