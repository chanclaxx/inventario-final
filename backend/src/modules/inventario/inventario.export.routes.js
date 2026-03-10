const router = require('express').Router();
const { exportarInventario } = require('./inventario.export.controller');

router.get('/exportar', exportarInventario);

module.exports = router;