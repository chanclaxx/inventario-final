const router = require('express').Router();
const { requireNivel } = require('../../middlewares/role.middleware');
const ctrl = require('./config.controller');

router.get('/',                                            ctrl.getConfig);
router.put('/',    requireNivel('admin_negocio'),          ctrl.saveConfig);
// El admin siempre puede verificar el PIN; los demás solo si el admin los
// autorizó en Ajustes → Seguridad. Esa regla y el tope de intentos fallidos
// viven en config.service.verificarPinDeUsuario, no aquí.
router.post('/verificar-pin', ctrl.verificarPin);

module.exports = router;