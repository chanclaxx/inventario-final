const { Router } = require('express');
const ctrl = require('./busqueda.controller');

const router = Router();

router.get('/serial/:imei',                  ctrl.buscarPorIMEI);
router.get('/codigo/:codigo',                ctrl.buscarPorCodigo);
router.get('/escaneo/:codigo',               ctrl.escanear);
router.get('/productos',                     ctrl.buscarProductos);
router.get('/compras',                       ctrl.buscarCompras);
router.get('/prestamos',                     ctrl.buscarPrestamos);
router.get('/historial-cantidad/:productoId', ctrl.getHistorialCantidad);

module.exports = router;
