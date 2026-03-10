const router = require('express').Router();
const ctrl = require('./creditos.controller');

router.get('/',            ctrl.getCreditos);
router.get('/:id',         ctrl.getCreditoById);
router.post('/:id/abonos', ctrl.registrarAbono);

module.exports = router;