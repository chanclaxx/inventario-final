const router   = require('express').Router();
const { body } = require('express-validator');
const { validate }     = require('../../middlewares/validate.middleware');
const { requireNivel } = require('../../middlewares/role.middleware');
const ctrl     = require('./garantias.controller');

const validarGarantia = [
  body('titulo').trim().notEmpty().withMessage('El título es requerido'),
  body('texto').trim().notEmpty().withMessage('El texto es requerido'),
  body('orden').optional().isInt({ min: 0 }).withMessage('El orden debe ser un número positivo'),
];

router.get('/',                          ctrl.getGarantias);
router.get('/factura/:facturaId',        ctrl.getGarantiasPorFactura); // ← nueva
router.get('/:id',                       ctrl.getGarantiaById);
router.post('/',     requireNivel('admin_negocio'), validarGarantia, validate, ctrl.crearGarantia);
router.put('/:id',   requireNivel('admin_negocio'), validarGarantia, validate, ctrl.actualizarGarantia);
router.delete('/:id',requireNivel('admin_negocio'), ctrl.eliminarGarantia);

module.exports = router;