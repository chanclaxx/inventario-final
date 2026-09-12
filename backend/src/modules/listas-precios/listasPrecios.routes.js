const router = require('express').Router();
const ctrl   = require('./listasPrecios.controller');
const { requireNivel, requirePermisoPreciosLista } = require('../../middlewares/role.middleware');

// ─────────────────────────────────────────────────────────────────────────────
// LEER los precios de lista va con el inventario: son precios de VENTA y el
// vendedor los necesita en el mostrador. No pasan por el candado de costos
// (`costos_solo_admin`) a propósito — esconderle a un vendedor el precio al que
// tiene que vender no protege nada y le impide trabajar.
//
// ESCRIBIRLOS es otra cosa: una lista de precios es la política comercial de la
// empresa y cambiar «Al por mayor» mueve el margen de todas las ventas
// mayoristas de todos los locales a la vez. Por defecto, solo admin_negocio.
// ─────────────────────────────────────────────────────────────────────────────

router.get('/producto/:productoId', requireNivel('vendedor'), ctrl.getPreciosProducto);

router.put('/nodos', requirePermisoPreciosLista, ctrl.guardarPrecios);

module.exports = router;
