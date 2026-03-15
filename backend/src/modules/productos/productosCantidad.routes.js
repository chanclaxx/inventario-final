const router = require('express').Router();
const { requireNivel } = require('../../middlewares/role.middleware');
const ctrl = require('./productosCantidad.controller');

router.get('/historial-stock', ctrl.getHistorialStock);

router.get('/',            ctrl.getProductos);
router.get('/:id',         ctrl.getProductoById);
router.post('/',           requireNivel('vendedor'), ctrl.crearProducto);
router.put('/:id',         requireNivel('supervisor'), ctrl.actualizarProducto);
router.patch('/:id/stock', requireNivel('vendedor'), ctrl.ajustarStock);
router.delete('/:id',      requireNivel('admin_negocio'), ctrl.eliminarProducto);

module.exports = router;