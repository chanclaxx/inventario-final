const router = require('express').Router();
const { requireNivel } = require('../../middlewares/role.middleware');
const ctrl = require('./usuarios.controller');

// auth y verificarPlan ya vienen aplicados desde index.js
router.get('/',                        requireNivel('admin_negocio'), ctrl.getUsuarios);
router.get('/:id',                     requireNivel('admin_negocio'), ctrl.getUsuarioById);
router.post('/',                       requireNivel('admin_negocio'), ctrl.crearUsuario);
router.put('/:id',                     requireNivel('admin_negocio'), ctrl.actualizarUsuario);
router.patch('/me/password',           ctrl.cambiarPassword);
router.patch('/me/password-temporal',  ctrl.cambiarPasswordTemporal);

module.exports = router;