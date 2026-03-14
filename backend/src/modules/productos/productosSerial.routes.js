const router = require('express').Router();
const { requireNivel } = require('../../middlewares/role.middleware');
const ctrl = require('./productosSerial.controller');

// auth, verificarPlan y resolveSucursal ya vienen desde index.js

// ── Rutas estáticas primero (antes de /:id para evitar conflictos) ──
router.get('/verificar-imei/:imei', ctrl.verificarImei);
router.get('/compras-cliente', ctrl.getComprasCliente);
// ── Rutas de producto ──
router.get('/',    ctrl.getProductos);
router.get('/:id', ctrl.getProductoById);
router.post('/',   requireNivel('supervisor'), ctrl.crearProducto);
router.put('/:id', requireNivel('supervisor'), ctrl.actualizarProducto);

// ── Rutas de seriales ──
router.get('/:id/seriales',    ctrl.getSeriales);
router.post('/:id/seriales',   requireNivel('supervisor'), ctrl.agregarSerial);
router.put('/seriales/:id',    requireNivel('supervisor'), ctrl.actualizarSerial);
router.delete('/seriales/:id', requireNivel('admin_negocio'), ctrl.eliminarSerial);


module.exports = router;