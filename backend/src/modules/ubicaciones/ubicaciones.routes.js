const router = require('express').Router();
const { requireModulo } = require('../../middlewares/modulo.middleware');
const ctrl = require('./ubicaciones.controller');

// Solo lectura: el catálogo se deriva de los productos, no se edita aparte.
// Escribir una ubicación se hace guardando el producto (PUT /productos-*).
router.get('/', requireModulo('inventario'), ctrl.getUbicaciones);

module.exports = router;
