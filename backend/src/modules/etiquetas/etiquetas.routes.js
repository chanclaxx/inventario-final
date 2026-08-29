const router = require('express').Router();
const { requireNivel }  = require('../../middlewares/role.middleware');
const { requireModulo } = require('../../middlewares/modulo.middleware');
const configRepo = require('../config/config.repository');
const ctrl = require('./etiquetas.controller');

// ── Doble candado ────────────────────────────────────────────────────────────
//
// El primero es el módulo de inventario: imprimir etiquetas es una acción sobre
// el inventario y hereda su permiso, igual que el catálogo web. No hay módulo ni
// rol nuevo — el bodeguero que ya entra a Inventario ya puede etiquetar.
//
// El segundo es la feature: sin `codigo_producto_activo` no hay códigos que
// imprimir, así que para ese negocio esto no existe (404, como en órdenes de
// compra). Es lo que mantiene la feature opt-in: los 28 negocios que operan hoy
// no ven aparecer nada.
const requireCodigoActivo = async (req, res, next) => {
  try {
    const cfg = await configRepo.getMap(req.user.negocio_id);
    if (cfg.codigo_producto_activo !== '1') {
      return res.status(404).json({ ok: false, error: 'Recurso no encontrado' });
    }
    return next();
  } catch (err) { return next(err); }
};

router.use(requireModulo('inventario'));
router.use(requireCodigoActivo);

// El catálogo de formatos es la FUENTE ÚNICA: el frontend lo pide en vez de
// llevar su propia copia. Ver el comentario de etiquetas.formatos.js.
router.get('/formatos', ctrl.getFormatos);

router.get('/nodos',  ctrl.getNodos);
router.post('/plan',  ctrl.postPlan);
router.post('/pdf',   ctrl.postPdf);

// Generar códigos ESCRIBE en los tres niveles del árbol. Asignar el código de un
// atributo o una variante uno por uno ya exige `admin_negocio` (ver
// variantes-producto.routes), así que hacerlo en masa no puede pedir menos: con
// `supervisor` se estaría dando por la puerta de atrás un permiso que la pantalla
// de variantes niega.
router.post('/codigos', requireNivel('admin_negocio'), ctrl.postGenerarCodigos);

module.exports = router;
