const router = require('express').Router();
const { requireNivel } = require('../../middlewares/role.middleware');
const ctrl = require('./cruces.controller');

// Supervisores pueden listar y crear cruces
router.get('/',    requireNivel('supervisor'), ctrl.getCruces);
router.get('/:id', requireNivel('supervisor'), ctrl.getCruceById);
router.post('/',   requireNivel('supervisor'), ctrl.crearCruce);

module.exports = router;