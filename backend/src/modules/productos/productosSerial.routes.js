const router = require('express').Router();
const { requireNivel }  = require('../../middlewares/role.middleware');
const { requireModulo } = require('../../middlewares/modulo.middleware');
const ctrl = require('./productosSerial.controller');

// Rutas estáticas primero
router.get('/verificar-imei/:imei', requireModulo('inventario'), ctrl.verificarImei);
router.get('/compras-cliente',      requireModulo('inventario'), ctrl.getComprasCliente);

// Rutas de producto
router.get('/',       requireModulo('inventario'),                                ctrl.getProductos);
router.get('/:id',    requireModulo('inventario'),                                ctrl.getProductoById);
router.post('/',      requireModulo('inventario'), requireNivel('vendedor'),       ctrl.crearProducto);
router.put('/:id',    requireModulo('inventario'), requireNivel('supervisor'),     ctrl.actualizarProducto);
router.delete('/:id', requireModulo('inventario'), requireNivel('admin_negocio'), ctrl.eliminarProductoSerial);

// Rutas de seriales
router.get('/:id/seriales',    requireModulo('inventario'),                                ctrl.getSeriales);
router.post('/:id/seriales',   requireModulo('inventario'), requireNivel('vendedor'),       ctrl.agregarSerial);
router.put('/seriales/:id',    requireModulo('inventario'), requireNivel('supervisor'),     ctrl.actualizarSerial);
router.delete('/seriales/:id', requireModulo('inventario'), requireNivel('admin_negocio'),  ctrl.eliminarSerial);

module.exports = router;