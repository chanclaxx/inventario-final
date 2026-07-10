const router   = require('express').Router();
const { body } = require('express-validator');
const { validate }      = require('../../middlewares/validate.middleware');
const { requireModulo } = require('../../middlewares/modulo.middleware');
const { requireRole }   = require('../../middlewares/role.middleware');
const ctrl = require('./tesoreria.controller');

const validarCuenta = [
  body('nombre').if(body('nombre').exists()).trim().notEmpty().withMessage('Nombre inválido'),
];

const validarMovimiento = [
  body('cuenta_id').isInt({ gt: 0 }).withMessage('cuenta_id inválido'),
  body('tipo').isIn(['entrada', 'salida']).withMessage('tipo debe ser entrada o salida'),
  body('valor').isFloat({ gt: 0 }).withMessage('El valor debe ser mayor a 0'),
];

const validarTraslado = [
  body('origen_id').isInt({ gt: 0 }).withMessage('origen_id inválido'),
  body('destino_id').isInt({ gt: 0 }).withMessage('destino_id inválido'),
  body('valor').isFloat({ gt: 0 }).withMessage('El valor debe ser mayor a 0'),
];

const validarArqueo = [
  body('cuenta_id').isInt({ gt: 0 }).withMessage('cuenta_id inválido'),
  body('saldo_contado').isFloat({ min: 0 }).withMessage('Saldo contado inválido'),
];

router.get('/cuentas',        requireModulo('tesoreria'), ctrl.listarCuentas);
router.post('/cuentas',       requireModulo('tesoreria'), validarCuenta, validate, ctrl.crearCuenta);
router.patch('/cuentas/:id',  requireModulo('tesoreria'), validarCuenta, validate, ctrl.actualizarCuenta);

router.get('/saldos',              requireModulo('tesoreria'), ctrl.getSaldos);
router.get('/cuentas/:id/extracto', requireModulo('tesoreria'), ctrl.getExtracto);

router.post('/movimientos',   requireModulo('tesoreria'), validarMovimiento, validate, ctrl.registrarMovimiento);
router.post('/traslados',     requireModulo('tesoreria'), validarTraslado,   validate, ctrl.trasladar);
router.patch('/movimientos/:id/toggle', requireModulo('tesoreria'), ctrl.toggleMovimiento);

router.post('/arqueos',       requireModulo('tesoreria'), validarArqueo, validate, ctrl.arquear);

// Consolidado de todas las sucursales — solo el dueño del negocio
router.get('/resumen',        requireRole('admin_negocio'), ctrl.getResumenNegocio);

module.exports = router;
