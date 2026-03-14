const router = require('express').Router();
const { requireNivel } = require('../../middlewares/role.middleware');
const { exportarInventario } = require('./inventario.export.controller');

// Solo supervisor y admin pueden exportar inventario completo con costos
router.get('/exportar', requireNivel('supervisor'), exportarInventario);

module.exports = router;