const router = require('express').Router();
const { requireNivel }  = require('../../middlewares/role.middleware');
const { requireModulo } = require('../../middlewares/modulo.middleware');
const ctrl = require('./productosCantidad.controller');

router.get('/historial-stock', requireModulo('inventario'),                                ctrl.getHistorialStock);

router.get('/',            requireModulo('inventario'),                                ctrl.getProductos);
router.get('/:id',         requireModulo('inventario'),                                ctrl.getProductoById);
router.post('/',           requireModulo('inventario'), requireNivel('vendedor'),       ctrl.crearProducto);
router.put('/:id',         requireModulo('inventario'), requireNivel('supervisor'),     ctrl.actualizarProducto);
router.patch('/:id/stock', requireModulo('inventario'), requireNivel('vendedor'),       ctrl.ajustarStock);
router.delete('/:id',      requireModulo('inventario'), requireNivel('admin_negocio'),  ctrl.eliminarProducto);

module.exports = router;