const router   = require('express').Router();
const { body } = require('express-validator');
const { validate }     = require('../../middlewares/validate.middleware');
const { requireNivel } = require('../../middlewares/role.middleware');
const ctrl     = require('./acreedores.controller');

const validarMovimiento = [
  body('tipo')
    .isIn(['Abono', 'Cargo']).withMessage('Tipo debe ser Abono o Cargo'),
  body('valor')
    .isFloat({ gt: 0 }).withMessage('El valor debe ser mayor a 0'),
  body('descripcion')
    .optional().isString().trim().isLength({ max: 500 }),
  body('firma')
    .optional()
    .isString()
    .isLength({ max: 50000 })
    .withMessage('Firma demasiado grande'),
];

// Acreedores de cruces — accesible para supervisores
router.get('/cruces',           ctrl.getAcreedoresCruces);

// Rutas generales — todos los acreedores
router.get('/',                 ctrl.getAcreedores);
router.get('/:id',              ctrl.getAcreedorById);
router.post('/',                requireNivel('supervisor'), ctrl.crearAcreedor);
router.post('/:id/movimientos', validarMovimiento, validate, ctrl.registrarMovimiento);
router.delete('/:id',           requireNivel('admin_negocio'), ctrl.eliminarAcreedor);

module.exports = router;