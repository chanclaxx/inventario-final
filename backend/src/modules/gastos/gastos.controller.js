const service = require('./gastos.service');
const audit   = require('../../utils/auditoria.util');
const { puedeRegistrarGastos } = require('../../middlewares/role.middleware');

const ctxDe = (req) => ({
  negocioId:  req.user.negocio_id,
  sucursalId: Number(req.sucursal_id),
  usuarioId:  req.user.id,
});

const responder = (fn) => async (req, res, next) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ ok: true, data });
  } catch (e) { next(e); }
};

const resumen = responder((req) =>
  service.resumenMes(ctxDe(req), req.user, req.query.mes, { puedeRegistrar: puedeRegistrarGastos(req.user) }));

const listar = responder((req) =>
  service.listarGastos(ctxDe(req), req.query.mes, { incluirAnulados: req.query.anulados === '1' }));

const estadoResultados = responder((req) => service.estadoResultados(ctxDe(req), req.query.mes));

const periodo = responder((req) => service.totalPeriodo(ctxDe(req), req.query.desde, req.query.hasta));

const listarCategorias = responder((req) =>
  service.listarCategorias(req.user.negocio_id, { incluirInactivas: req.query.todas === '1' }));
const crearCategoria = responder((req) => service.crearCategoria(req.user.negocio_id, req.body || {}));
const actualizarCategoria = responder((req) =>
  service.actualizarCategoria(req.user.negocio_id, Number(req.params.id), req.body || {}));

const listarRecurrentes = responder((req) =>
  service.listarRecurrentes(ctxDe(req), { incluirInactivos: req.query.todos === '1' }));
const crearRecurrente = responder((req) => service.crearRecurrente(ctxDe(req), req.body || {}));
const actualizarRecurrente = responder((req) =>
  service.actualizarRecurrente(ctxDe(req), Number(req.params.id), req.body || {}));

const confirmarRecurrente = responder(async (req, res) => {
  const g = await service.confirmarRecurrente(ctxDe(req), Number(req.params.id), req.body || {});
  res.status(201).json({ ok: true, data: g });
});

const registrar = responder(async (req, res) => {
  const g = await service.registrarGasto(ctxDe(req), req.body || {});
  res.status(201).json({ ok: true, data: g });
});

const editar = responder(async (req) => {
  const g = await service.editarGasto(ctxDe(req), req.user, Number(req.params.id), req.body || {});
  audit.registrar(req.user.negocio_id, req.user.id, 'Gasto editado', 'gastos', g.id, {
    sucursal_id: g.sucursal_id, valor: g.valor_total, categoria: g.categoria_nombre,
  });
  return g;
});

const anular = responder(async (req) => {
  const g = await service.anularGasto(ctxDe(req), req.user, Number(req.params.id), req.body?.motivo);
  audit.registrar(req.user.negocio_id, req.user.id, 'Gasto anulado', 'gastos', g.id, {
    sucursal_id: g.sucursal_id, valor: g.valor_total, motivo: g.anulado_motivo,
  });
  return g;
});

module.exports = {
  resumen, listar, estadoResultados, periodo,
  listarCategorias, crearCategoria, actualizarCategoria,
  listarRecurrentes, crearRecurrente, actualizarRecurrente, confirmarRecurrente,
  registrar, editar, anular,
};
