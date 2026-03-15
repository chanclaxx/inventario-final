const router             = require('express').Router();
const ctrl               = require('./lineas.controller');
const { requireNivel }   = require('../../middlewares/role.middleware');

// Todos los roles pueden ver líneas
router.get('/',    ctrl.getLineas);
router.get('/:id', ctrl.getLineaById);

// Solo admin_negocio puede crear, editar y eliminar
router.post('/',    requireNivel('admin_negocio'), ctrl.crearLinea);
router.put('/:id',  requireNivel('admin_negocio'), ctrl.actualizarLinea);
router.delete('/:id', requireNivel('admin_negocio'), ctrl.eliminarLinea);

module.exports = router;