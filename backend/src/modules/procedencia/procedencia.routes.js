const router = require('express').Router();
const { param } = require('express-validator');
const { validate }      = require('../../middlewares/validate.middleware');
const { requireModulo } = require('../../middlewares/modulo.middleware');
const ctrl = require('./procedencia.controller');

// ─────────────────────────────────────────────────────────────────────────────
// Procedencia: de qué proveedor salió cada lote.
//
// SIN candado de configuración, a propósito. Solo lee historia de compras que
// todos los negocios ya tienen registrada, y responde una pregunta que se hacen
// igual los que llevan órdenes de compra y los que no. Ponerle un flag sería
// esconder detrás de una feature un dato que ya es suyo.
//
// De solo lectura: nadie modifica una procedencia, se deriva. Por eso alcanza
// con el permiso de ver proveedores, sin requireNivel.
// ─────────────────────────────────────────────────────────────────────────────
router.use(requireModulo('proveedores'));

router.get('/producto/:productoId',
  [param('productoId').isInt({ gt: 0 }).withMessage('Producto inválido')],
  validate, ctrl.getPorProducto);

router.get('/imei/:imei',
  [param('imei').isString().trim().isLength({ min: 1, max: 60 }).withMessage('IMEI inválido')],
  validate, ctrl.getPorImei);

module.exports = router;
