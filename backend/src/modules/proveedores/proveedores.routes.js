const router = require('express').Router();
const { requireNivel, requirePermisoProveedores } = require('../../middlewares/role.middleware');
const { requireModulo } = require('../../middlewares/modulo.middleware');
const ctrl = require('./proveedores.controller');

router.use(requireModulo('proveedores'));

router.get('/',       requirePermisoProveedores('ver'),   ctrl.getProveedores);
router.get('/:id',    requirePermisoProveedores('ver'),   ctrl.getProveedorById);
router.post('/',      requirePermisoProveedores('crear'),  ctrl.crearProveedor);
router.put('/:id',    requireNivel('admin_negocio'),       ctrl.actualizarProveedor);
router.delete('/:id', requireNivel('admin_negocio'),       ctrl.eliminarProveedor);

module.exports = router;
