// Centro de gastos (Reportes → Gastos). Tres candados en este orden:
//   1. la función encendida (`gastos_activo` y las tablas) — si no, 404;
//   2. el módulo «reportes»;
//   3. quién: VER = admin, «Ver todos los reportes» o permiso de registrar;
//      REGISTRAR = admin o `permisos_gastos.registrar`; ADMINISTRAR categorías
//      y gastos fijos = admin; estado de resultados = admin o reportes completos.
// Las rutas literales van ANTES de `/:id`.
const router = require('express').Router();
const { requireModulo } = require('../../middlewares/modulo.middleware');
const { requireNivel, puedeRegistrarGastos, puedeVerGastos, puedeVerReportesCompletos } =
  require('../../middlewares/role.middleware');
const service = require('./gastos.service');
const ctrl = require('./gastos.controller');

const requireGastos = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ ok: false, error: 'No autenticado' });
    if (!(await service.estaActivo(req.user.negocio_id))) {
      return res.status(404).json({ ok: false, error: 'El centro de gastos no está activo en este negocio', code: 'GASTOS_APAGADO' });
    }
    next();
  } catch (e) { next(e); }
};

const exigir = (regla, mensaje) => (req, res, next) => (regla(req.user)
  ? next()
  : res.status(403).json({ ok: false, error: mensaje }));

const ver        = exigir(puedeVerGastos, 'No tienes acceso a los gastos');
const registrar  = exigir(puedeRegistrarGastos, 'No tienes permiso para registrar gastos');
const resultados = exigir(puedeVerReportesCompletos, 'No tienes acceso al estado de resultados');
const admin      = requireNivel('admin_negocio');

router.use(requireGastos, requireModulo('reportes'));

router.get('/resumen',            ver,        ctrl.resumen);
router.get('/estado-resultados',  resultados, ctrl.estadoResultados);
router.get('/periodo',            ver,        ctrl.periodo);

router.get('/categorias',         ver,   ctrl.listarCategorias);
router.post('/categorias',        admin, ctrl.crearCategoria);
router.patch('/categorias/:id',   admin, ctrl.actualizarCategoria);

router.get('/recurrentes',                ver,       ctrl.listarRecurrentes);
router.post('/recurrentes',               admin,     ctrl.crearRecurrente);
router.patch('/recurrentes/:id',          admin,     ctrl.actualizarRecurrente);
router.post('/recurrentes/:id/confirmar', registrar, ctrl.confirmarRecurrente);

router.get('/',              ver,       ctrl.listar);
router.post('/',             registrar, ctrl.registrar);
router.patch('/:id',         registrar, ctrl.editar);
router.post('/:id/anular',   registrar, ctrl.anular);

module.exports = router;
