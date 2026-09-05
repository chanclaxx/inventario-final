const router = require('express').Router();
const { requirePedidos } = require('../../middlewares/redInterna.middleware');
const { requireNivel }   = require('../../middlewares/role.middleware');
const ctrl = require('./redInterna.pedidos.controller');

// ─────────────────────────────────────────────────────────────────────────────
// PEDIDOS INTERNOS — el local le pide a la bodega
//
// Se monta bajo `/pedidos` desde `redInterna.routes.js`, así que los DOS
// candados de la red interna (`requireModulo('red_interna')` + `requireRedInterna`)
// ya se aplicaron. Aquí va el TERCERO: que la bodega no haya apagado los
// pedidos y que sus tablas existan.
//
// ── Nivel mínimo: VENDEDOR para pedir ───────────────────────────────────────
// Recibir una remisión ya lo puede hacer un vendedor, y recibir GENERA LA DEUDA
// del local. Pedir es estrictamente menos poderoso —no compromete un peso y no
// pasa nada hasta que la bodega despacha—, así que exigir supervisor aquí sería
// pedir más para lo que menos pesa. Y quien se da cuenta de que se acabó algo
// es quien está en el mostrador.
//
// Decidir sobre un pedido (cerrarlo, reabrirlo) es de la bodega y va con
// supervisor, igual que despachar. Quién es "la bodega" lo comprueba el
// service, no la ruta: el nivel dice cuánto pesa la acción, no de qué lado está
// quien la hace.
// ─────────────────────────────────────────────────────────────────────────────
router.use(requirePedidos);

// ── Lectura (los dos lados; el service aísla qué ve cada quien) ──────────────
router.get('/',         ctrl.listar);
// ANTES de '/:id'. Declarada después, Express resolvería `/catalogo` por
// `/:id` con id="catalogo" y el local se quedaría sin poder armar el pedido.
// El archivo de rutas de compras ya cobró este error una vez.
router.get('/catalogo', ctrl.catalogo);
router.get('/:id',      ctrl.getPedido);

// ── El local pide ────────────────────────────────────────────────────────────
router.post ('/',              ctrl.crear);
router.patch('/:id',           ctrl.editar);
router.post ('/:id/enviar',    ctrl.enviar);
router.post ('/:id/anular',    ctrl.anular);

// ── La bodega decide ─────────────────────────────────────────────────────────
router.post('/:id/cerrar',  requireNivel('supervisor'), ctrl.cerrar);
router.post('/:id/reabrir', requireNivel('supervisor'), ctrl.reabrir);

module.exports = router;
