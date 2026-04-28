const router = require('express').Router();
const { requireNivel }  = require('../../middlewares/role.middleware');
const { requireModulo } = require('../../middlewares/modulo.middleware');
const ctrl = require('./proveedores.controller');

// requireModulo va antes que requireNivel
router.use(requireModulo('proveedores'));
router.use(requireNivel('admin_negocio'));

router.get('/',       ctrl.getProveedores);
router.get('/:id',    ctrl.getProveedorById);
router.post('/',      ctrl.crearProveedor);
router.put('/:id',    ctrl.actualizarProveedor);
router.delete('/:id', ctrl.eliminarProveedor);

module.exports = router;