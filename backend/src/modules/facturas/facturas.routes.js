const router = require('express').Router();
const { requireNivel } = require('../../middlewares/role.middleware');
const ctrl = require('./facturas.controller');

router.get('/',               ctrl.getFacturas);
router.get('/:id',            ctrl.getFacturaById);
router.post('/',              ctrl.crearFactura);
router.patch('/:id/cancelar', requireNivel('supervisor'), ctrl.cancelarFactura);
router.patch('/:id', requireNivel('supervisor'), ctrl.editarFactura);

module.exports = router;