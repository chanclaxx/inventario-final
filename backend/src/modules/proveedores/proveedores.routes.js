const router = require('express').Router();
const { requireNivel } = require('../../middlewares/role.middleware');
const ctrl = require('./proveedores.controller');

router.get('/',       ctrl.getProveedores);
router.get('/:id',    ctrl.getProveedorById);
router.post('/',      requireNivel('supervisor'), ctrl.crearProveedor);
router.put('/:id',    requireNivel('supervisor'), ctrl.actualizarProveedor);
router.delete('/:id', requireNivel('admin_negocio'), ctrl.eliminarProveedor);

module.exports = router;