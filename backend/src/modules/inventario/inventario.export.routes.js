const router = require('express').Router();
const { requirePermisoExportarInventario, requirePermisoExportarNegocio } = require('../../middlewares/role.middleware');
const { exportarInventario, exportarInventarioNegocio } = require('./inventario.export.controller');

router.get('/exportar',         requirePermisoExportarInventario, exportarInventario);
router.get('/exportar-negocio', requirePermisoExportarNegocio,   exportarInventarioNegocio);

module.exports = router;