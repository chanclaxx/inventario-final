const router   = require('express').Router();
const { requireNivel } = require('../../middlewares/role.middleware');
const ctrl     = require('./clientes.controller');

router.get('/',               ctrl.getClientes);
router.get('/cedula/:cedula', ctrl.buscarPorCedula);
router.get('/:id',            ctrl.getClienteById);
router.post('/',    ctrl.crearCliente);
router.put('/:id',   ctrl.actualizarCliente);

module.exports = router;