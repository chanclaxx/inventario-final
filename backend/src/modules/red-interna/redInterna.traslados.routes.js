// ─────────────────────────────────────────────────────────────────────────────
// TRASLADOS ENTRE SEDES PROPIAS — rutas
//
// Cuelga de `/red-interna/traslados`, así que ya pasó por los dos candados de
// la red (módulo «Bodega» + la red encendida). Encima:
//   · leer y RECIBIR: cualquiera de la sucursal (recibir va por la ruta de
//     siempre, `/remisiones/:id/recibir`, que valida que sea el destino);
//   · trasladar, preparar y anular: el módulo «Traslados» de Ajustes → Usuarios.
//     Es el mismo que ya daba los traslados libres: el supervisor lo trae por
//     defecto y al vendedor se le marca. Nadie gana ni pierde un permiso.
//   · cerrar la cuenta de una sede y ver su estado (Ajustes): solo el admin.
//
// Las rutas literales van ANTES de `/:id`.
// ─────────────────────────────────────────────────────────────────────────────
const router = require('express').Router();
const { requireModulo } = require('../../middlewares/modulo.middleware');
const { requireNivel }  = require('../../middlewares/role.middleware');
const traslados = require('./redInterna.traslados');
const audit     = require('../../utils/auditoria.util');

const responder = (fn) => async (req, res, next) => {
  try { res.json({ ok: true, data: await fn(req) }); } catch (err) { next(err); }
};

const puedeTrasladar = requireModulo('traslados');

// ── Ajustes: pasar una sede a «propia» ──────────────────────────────────────
router.get('/sedes', requireNivel('admin_negocio'), responder((req) => traslados.estadoSedes(req)));
router.post('/sedes/:sucursalId/cerrar-cuenta', requireNivel('admin_negocio'), responder(async (req) => {
  const data = await traslados.cerrarCuenta(req, Number(req.params.sucursalId), { nota: req.body?.nota });
  if (data.ajuste) {
    audit.registrar(req.user.negocio_id, req.user.id, 'Cuenta de sede cerrada en $0', 'red_interna',
      data.ajuste.id, { sucursal_id: Number(req.params.sucursalId), valor: data.ajuste.valor, concepto: data.ajuste.concepto });
  }
  return data;
}));

// ── Lectura ─────────────────────────────────────────────────────────────────
router.get('/panel', responder((req) => traslados.panel(req)));
router.get('/buscar', puedeTrasladar, responder((req) => traslados.buscar(req, req.query.q)));
router.post('/resolver', puedeTrasladar, responder((req) => traslados.resolver(req, req.body?.items)));
router.get('/', responder((req) => traslados.listar(req, {
  estado: req.query.estado, limit: req.query.limit, sentido: req.query.sentido,
})));

// ── Escritura ───────────────────────────────────────────────────────────────
router.post('/', puedeTrasladar, responder(async (req) => {
  const { sucursal_destino_id, lineas, notas, clave_idempotencia } = req.body || {};
  const data = await traslados.trasladar(req, { sucursal_destino_id, lineas, notas, clave_idempotencia });
  if (!data.repetido) {
    audit.registrar(req.user.negocio_id, req.user.id, 'Traslado entre sedes', 'red_interna', data.id, {
      numero: data.numero, sucursal_origen_id: data.sucursal_origen_id,
      sucursal_destino_id: data.sucursal_destino_id, unidades: data.unidades,
      recibido_directo: data.recibido_directo,
    });
  }
  return data;
}));
router.post('/:id/anular', puedeTrasladar, responder(async (req) => {
  const data = await traslados.anular(req, Number(req.params.id));
  audit.registrar(req.user.negocio_id, req.user.id, 'Traslado anulado', 'red_interna', Number(req.params.id), {});
  return data;
}));

router.get('/:id', responder((req) => traslados.detalle(req, Number(req.params.id))));

module.exports = router;
