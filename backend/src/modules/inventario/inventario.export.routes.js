const router = require('express').Router();
const { requirePermisoExportarInventario } = require('../../middlewares/role.middleware');
const { exportarInventario } = require('./inventario.export.controller');

router.get('/exportar', requirePermisoExportarInventario, exportarInventario);

module.exports = router;