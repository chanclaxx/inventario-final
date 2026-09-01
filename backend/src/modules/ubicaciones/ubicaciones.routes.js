const router = require('express').Router();
const { requireModulo } = require('../../middlewares/modulo.middleware');
const { requireNivel }  = require('../../middlewares/role.middleware');
const ctrl = require('./ubicaciones.controller');

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️  LAS RUTAS LITERALES VAN ANTES DE `/:id`.
//
// Declaradas después, Express resuelve `/arbol` por `/:id` con id="arbol" y la
// pantalla muere en un error que no tiene nada que ver con lo que pidió. Ya
// pasó con `/entradas` en el módulo de compras: la entrada se creaba pero la
// lista salía vacía y el bodeguero moría en el permiso de ver compras.
//
// ── Quién puede qué ─────────────────────────────────────────────────────────
// VER el mapa y MOVER un producto de sitio van con el módulo `inventario`: el
// bodeguero es supervisor y ya lo tiene, guardar mercancía en un estante es
// literalmente su trabajo, y mover algo de sitio no toca stock, caja ni precios.
//
// CREAR, RENOMBRAR, BORRAR y DIBUJAR el mapa exigen `admin_negocio`: reorganizar
// el espacio es una decisión del negocio, no de la operación. Es el mismo
// criterio con el que la generación masiva de códigos es admin-only mientras
// imprimir etiquetas hereda el permiso de inventario.
// ─────────────────────────────────────────────────────────────────────────────

// ── Lectura ─────────────────────────────────────────────────────────────────

// Catálogo plano [{ ubicacion, productos }]. NO CAMBIAR LA FORMA: la consumen
// `InputUbicacion` (autocompletado) y el desplegable del inventario, que no se
// tocan en este despliegue.
router.get('/',            requireModulo('inventario'), ctrl.getUbicaciones);

router.get('/arbol',       requireModulo('inventario'), ctrl.getArbol);
router.get('/sin-asignar', requireModulo('inventario'), ctrl.getSinAsignar);
router.get('/buscar',      requireModulo('inventario'), ctrl.buscar);
router.get('/movimientos', requireModulo('inventario'), ctrl.getMovimientos);

// Lectura, pero por POST: la lista del carrito no cabe en una URL.
router.post('/ruta',       requireModulo('inventario'), ctrl.ubicacionesDe);

// ── Escritura sobre el contenido (operación diaria) ──────────────────────────
router.put('/items',       requireModulo('inventario'), ctrl.asignar);

// ── Escritura sobre el espacio (decisión del negocio) ────────────────────────
router.patch('/geometria', requireNivel('admin_negocio'), ctrl.guardarGeometria);
router.post('/',           requireNivel('admin_negocio'), ctrl.crear);

// ── Por id — SIEMPRE al final ────────────────────────────────────────────────
router.get('/:id',         requireModulo('inventario'),   ctrl.getDetalle);
router.get('/:id/items',   requireModulo('inventario'),   ctrl.getItems);
router.put('/:id',         requireNivel('admin_negocio'), ctrl.actualizar);
router.delete('/:id',      requireNivel('admin_negocio'), ctrl.eliminar);

module.exports = router;
