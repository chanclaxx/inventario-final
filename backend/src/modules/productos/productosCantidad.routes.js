const router = require('express').Router();
const { requireNivel } = require('../../middlewares/role.middleware');
const ctrl = require('./productosCantidad.controller');

router.get('/',            ctrl.getProductos);
router.get('/:id',         ctrl.getProductoById);
router.post('/',           requireNivel('supervisor'), ctrl.crearProducto);
router.put('/:id',         requireNivel('supervisor'), ctrl.actualizarProducto);
router.patch('/:id/stock', requireNivel('supervisor'), ctrl.ajustarStock);
router.delete('/:id',      requireNivel('admin_negocio'), ctrl.eliminarProducto);

module.exports = router;