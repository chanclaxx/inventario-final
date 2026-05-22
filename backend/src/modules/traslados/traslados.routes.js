const router = require('express').Router();
const { requireNivel }   = require('../../middlewares/role.middleware');
const { requireModulo }  = require('../../middlewares/modulo.middleware');
const ctrl = require('./traslados.controller');

router.post('/buscar-equivalentes',                                                         requireModulo('traslados'), requireNivel('supervisor'), ctrl.buscarEquivalentes);
router.get('/sucursal/:sucursalId/productos',                                               requireModulo('traslados'), requireNivel('supervisor'), ctrl.buscarEnSucursal);
router.get('/sucursal/:sucursalId/catalogo',                                                requireModulo('traslados'), requireNivel('supervisor'), ctrl.getCatalogoSucursal);
router.get('/sucursal/:sucursalId/seriales-producto/:productoSerialId',                     requireModulo('traslados'), requireNivel('supervisor'), ctrl.buscarSerialesProducto);
router.post('/:id/lineas/:lineaId/revertir',
  requireModulo('traslados'),
  requireNivel('supervisor'),
  ctrl.revertirLineaTraslado
);
router.post('/',                    requireModulo('traslados'), requireNivel('supervisor'), ctrl.ejecutarTraslado);
router.get('/',                     requireModulo('traslados'), requireNivel('supervisor'), ctrl.getTraslados);
router.get('/:id',                  requireModulo('traslados'), requireNivel('supervisor'), ctrl.getTrasladoById);
router.post('/:id/revertir',        requireModulo('traslados'), requireNivel('supervisor'), ctrl.revertirTraslado);

module.exports = router;