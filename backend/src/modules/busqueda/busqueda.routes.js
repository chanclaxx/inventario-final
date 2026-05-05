const { Router } = require('express');
const ctrl = require('./busqueda.controller');

const router = Router();

router.get('/serial/:imei', ctrl.buscarPorIMEI);
router.get('/productos',    ctrl.buscarProductos);
router.get('/compras',      ctrl.buscarCompras);

module.exports = router;
