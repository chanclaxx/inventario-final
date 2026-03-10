const router = require('express').Router();
const { requireNivel } = require('../../middlewares/role.middleware');
const ctrl = require('./acreedores.controller');

router.get('/',                 ctrl.getAcreedores);
router.get('/:id',              ctrl.getAcreedorById);
router.post('/',                requireNivel('supervisor'), ctrl.crearAcreedor);
router.post('/:id/movimientos', ctrl.registrarMovimiento);

module.exports = router;