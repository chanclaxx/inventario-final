const router = require('express').Router();
const { requireNivel } = require('../../middlewares/role.middleware');
const ctrl = require('./config.controller');

router.get('/', ctrl.getConfig);
router.put('/', requireNivel('admin_negocio'), ctrl.saveConfig);

module.exports = router;