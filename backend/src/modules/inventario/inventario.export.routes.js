const router = require('express').Router();
const { requireNivel } = require('../../middlewares/role.middleware');
const { exportarInventario } = require('./inventario.export.controller');

// Solo supervisor y admin pueden exportar inventario completo con costos
router.get('/exportar', requireNivel('admin_negocio'), exportarInventario);

module.exports = router;