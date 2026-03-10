const router = require('express').Router();
const ctrl = require('./prestamos.controller');

router.get('/',               ctrl.getPrestamos);
router.get('/:id',            ctrl.getPrestamoById);
router.post('/',              ctrl.crearPrestamo);
router.post('/:id/abonos',    ctrl.registrarAbono);
router.patch('/:id/devolver', ctrl.devolverPrestamo);

module.exports = router;