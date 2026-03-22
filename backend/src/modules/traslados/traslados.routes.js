const router = require('express').Router();
const { requireNivel } = require('../../middlewares/role.middleware');
const ctrl = require('./traslados.controller');

// Buscar equivalentes en sucursal destino (para UI interactiva)
router.post('/buscar-equivalentes', requireNivel('supervisor'), ctrl.buscarEquivalentes);

// Ejecutar el traslado
router.post('/', requireNivel('supervisor'), ctrl.ejecutarTraslado);

// Historial de traslados
router.get('/',    requireNivel('supervisor'), ctrl.getTraslados);
router.get('/:id', requireNivel('supervisor'), ctrl.getTrasladoById);

// Revertir un traslado
router.post('/:id/revertir', requireNivel('supervisor'), ctrl.revertirTraslado);

module.exports = router;