const router = require('express').Router();
const { requirePermisoExportarInventario, requireRole } = require('../../middlewares/role.middleware');
const { exportarInventario, exportarInventarioNegocio } = require('./inventario.export.controller');

router.get('/exportar',        requirePermisoExportarInventario,      exportarInventario);
router.get('/exportar-negocio', requireRole('admin_negocio'),         exportarInventarioNegocio);

module.exports = router;