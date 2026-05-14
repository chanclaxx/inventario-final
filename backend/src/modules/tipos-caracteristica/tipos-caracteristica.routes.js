const router           = require('express').Router();
const ctrl             = require('./tipos-caracteristica.controller');
const { requireNivel } = require('../../middlewares/role.middleware');

router.get('/',    ctrl.getTipos);
router.post('/',   requireNivel('admin_negocio'), ctrl.crearTipo);
router.put('/:id', requireNivel('admin_negocio'), ctrl.actualizarTipo);
router.delete('/:id', requireNivel('admin_negocio'), ctrl.eliminarTipo);

module.exports = router;
