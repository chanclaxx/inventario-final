const router = require('express').Router();
const { requireNivel } = require('../../middlewares/role.middleware');
const ctrl = require('./config.controller');

router.get('/',                                            ctrl.getConfig);
router.put('/',    requireNivel('admin_negocio'),          ctrl.saveConfig);
// Solo admin puede verificar el PIN — evita fuerza bruta desde roles inferiores
router.post('/verificar-pin', requireNivel('admin_negocio'), ctrl.verificarPin);

module.exports = router;