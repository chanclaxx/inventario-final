const router   = require('express').Router();
const { requireNivel } = require('../../middlewares/role.middleware');
const ctrl     = require('./clientes.controller');

router.get('/',               ctrl.getClientes);
// Antes de '/:id' — si no, Express resolvería 'buscar' como un id.
router.get('/buscar',         ctrl.buscarClientes);
router.get('/cedula/:cedula', ctrl.buscarPorCedula);
router.get('/frecuentes',                                        ctrl.getFrecuentes);
router.post('/frecuentes/:clienteId',   requireNivel('supervisor'), ctrl.agregarFrecuente);
router.delete('/frecuentes/:clienteId', requireNivel('supervisor'), ctrl.quitarFrecuente);
router.get('/:id',            ctrl.getClienteById);
router.post('/',    ctrl.crearCliente);
router.put('/:id',   ctrl.actualizarCliente);

module.exports = router;