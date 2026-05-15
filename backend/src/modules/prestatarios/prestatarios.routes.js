const router  = require('express').Router();
const ctrl    = require('./prestatarios.controller');

router.get('/',               ctrl.getPrestatarios);
router.post('/',              ctrl.crearPrestatario);
router.put('/:id',            ctrl.actualizarPrestatario);
router.get('/:id/empleados',  ctrl.getEmpleados);
router.post('/:id/empleados', ctrl.crearEmpleado);

module.exports = router;