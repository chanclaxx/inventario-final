const router = require('express').Router();
const { requireNivel } = require('../../middlewares/role.middleware');
const ctrl = require('./compras.controller');

router.get('/',                          ctrl.getCompras);
router.get('/proveedor/:proveedorId',    ctrl.getComprasByProveedor);
router.get('/:id',                       ctrl.getCompraById);
router.post('/',                         requireNivel('supervisor'), ctrl.registrarCompra);

module.exports = router;