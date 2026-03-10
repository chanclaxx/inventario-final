const router = require('express').Router();
const { requireNivel } = require('../../middlewares/role.middleware');
const ctrl = require('./garantias.controller');

router.get('/',       ctrl.getGarantias);
router.get('/:id',    ctrl.getGarantiaById);
router.post('/',      requireNivel('admin_negocio'), ctrl.crearGarantia);
router.put('/:id',    requireNivel('admin_negocio'), ctrl.actualizarGarantia);
router.delete('/:id', requireNivel('admin_negocio'), ctrl.eliminarGarantia);

module.exports = router;