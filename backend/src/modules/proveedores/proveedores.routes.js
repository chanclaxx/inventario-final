const router = require('express').Router();
const { requireNivel } = require('../../middlewares/role.middleware');
const ctrl = require('./proveedores.controller');

// Todas las rutas de /proveedores requieren admin_negocio
router.use(requireNivel('admin_negocio'));

router.get('/',       ctrl.getProveedores);
router.get('/:id',    ctrl.getProveedorById);
router.post('/',      ctrl.crearProveedor);
router.put('/:id',    ctrl.actualizarProveedor);
router.delete('/:id', ctrl.eliminarProveedor);

module.exports = router;