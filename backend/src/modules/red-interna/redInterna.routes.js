const router = require('express').Router();
const { requireModulo }     = require('../../middlewares/modulo.middleware');
const { requireNivel }      = require('../../middlewares/role.middleware');
const { requireRedInterna } = require('../../middlewares/redInterna.middleware');
const ctrl = require('./redInterna.controller');

// ─────────────────────────────────────────────────────────────────────────────
// DOBLE CANDADO en todas las rutas:
//   1. requireModulo('red_interna') → permisos del usuario
//   2. requireRedInterna            → el negocio activó la feature (404 si no)
//
// El nivel mínimo se decide por acción, no por módulo:
//   • RECIBIR una remisión: vendedor. Es quien está en el mostrador cuando
//     llega el mensajero (decisión del cliente).
//   • Despachar, devolver, mover plata y ajustar: supervisor o superior.
// ─────────────────────────────────────────────────────────────────────────────
router.use(requireModulo('red_interna'), requireRedInterna);

// ── El sentido inverso: el local le pide a la bodega ─────────────────────────
// Sub-router para que ninguna de sus rutas pueda chocar con las de aquí abajo
// (empezando por `/remisiones/:id`), y con su propio candado: la bodega puede
// apagar los pedidos sin apagar la red interna. Ver redInterna.pedidos.routes.js.
router.use('/pedidos', require('./redInterna.pedidos.routes'));

// ── Lectura ──────────────────────────────────────────────────────────────────
router.get('/panel',                    ctrl.getPanel);
router.get('/sucursales',               ctrl.getSucursales);
router.get('/contexto',                 ctrl.getContexto);
router.get('/remisiones',               ctrl.listarRemisiones);
router.get('/remisiones/:id',           ctrl.getRemision);
router.get('/remesas',                  ctrl.listarRemesas);
router.get('/cuenta/movimientos',       ctrl.getMovimientosCuenta);
router.get('/conciliacion/:sucursalId', ctrl.getConciliacion);
router.get('/estado-cuenta/:sucursalId', ctrl.getEstadoCuenta);
router.get('/salud',                    requireNivel('supervisor'), ctrl.getSalud);
router.get('/referencias-duplicadas',   requireNivel('supervisor'), ctrl.getReferenciasDuplicadas);

// ── Mercancía ────────────────────────────────────────────────────────────────
router.get ('/despacho/buscar',      requireNivel('supervisor'), ctrl.buscarParaDespacho);
router.get ('/despacho/accesorios',  requireNivel('supervisor'), ctrl.catalogoCantidad);
router.post('/despacho/resolver',    requireNivel('supervisor'), ctrl.resolverItems);
router.post('/despacho/previsualizar', requireNivel('supervisor'), ctrl.previsualizarDestino);
router.get ('/referencias/:sucursalId', requireNivel('supervisor'), ctrl.catalogoReferencias);
router.post('/remisiones',           requireNivel('supervisor'), ctrl.despachar);
router.post('/remisiones/:id/anular',requireNivel('supervisor'), ctrl.anularRemision);
router.post('/devoluciones',              requireNivel('supervisor'), ctrl.devolver);
router.post('/devoluciones/previsualizar', requireNivel('supervisor'), ctrl.previsualizarDevolucion);
router.post('/devoluciones/:id/confirmar', requireNivel('supervisor'), ctrl.confirmarDevolucion);
router.post('/lineas/:lineaId/corregir-valor', requireNivel('supervisor'), ctrl.corregirValorLinea);
// Un vendedor puede confirmar la recepción.
router.post('/remisiones/:id/recibir', ctrl.recibir);

// ── Dinero ───────────────────────────────────────────────────────────────────
router.get ('/remesas/cuentas',         requireNivel('supervisor'), ctrl.getCuentasParaRemesa);
router.post('/remesas',                 requireNivel('supervisor'), ctrl.enviarRemesa);
router.post('/remesas/:id/confirmar',   requireNivel('supervisor'), ctrl.confirmarRemesa);
router.post('/remesas/:id/anular',      requireNivel('supervisor'), ctrl.anularRemesa);
router.post('/cuenta/gasto-autorizado', requireNivel('supervisor'), ctrl.gastoAutorizado);
router.post('/cuenta/ajuste',           requireNivel('admin_negocio'), ctrl.ajuste);

// ── Corregir lo que salió mal ────────────────────────────────────────────────
// Aprobar/rechazar un gasto es de la bodega; el service exige `esBodega`.
router.post('/cuenta/movimientos/:id/decidir', requireNivel('supervisor'), ctrl.decidirGasto);
// Anular un gasto o un ajuste. El service decide quién puede qué: el local solo
// su propio gasto y solo mientras nadie lo haya aprobado.
router.post('/cuenta/movimientos/:id/anular',  requireNivel('supervisor'), ctrl.anularMovimientoCuenta);
// Reimputar un abono que entró al envío equivocado.
router.post('/abonos/:id/mover',               requireNivel('supervisor'), ctrl.moverAbono);

module.exports = router;
