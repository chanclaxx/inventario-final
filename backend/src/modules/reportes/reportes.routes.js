const router   = require('express').Router();
const { query, body } = require('express-validator');
const { validate }      = require('../../middlewares/validate.middleware');
const { requireNivel }  = require('../../middlewares/role.middleware');
const { requireModulo } = require('../../middlewares/modulo.middleware');
const ctrl     = require('./reportes.controller');

const validarRango = [
  query('desde')
    .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Formato de fecha inválido (YYYY-MM-DD)')
    .custom((v) => { if (isNaN(Date.parse(v))) throw new Error('Fecha desde inválida'); return true; }),
  query('hasta')
    .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Formato de fecha inválido (YYYY-MM-DD)')
    .custom((v) => { if (isNaN(Date.parse(v))) throw new Error('Fecha hasta inválida'); return true; }),
];

// dashboard: solo admin_negocio, no requiere módulo de usuario
router.get('/dashboard',        requireNivel('admin_negocio'), ctrl.getDashboard);

router.get('/ventas-rango',     requireModulo('reportes'), requireNivel('supervisor'),    validarRango, validate, ctrl.getVentasRango);
router.get('/analisis',         requireModulo('reportes'), requireNivel('admin_negocio'),
  [...validarRango, query('agrupacion').optional().isIn(['dia', 'semana', 'mes']).withMessage('Agrupación inválida')],
  validate, ctrl.getAnalisis);
router.get('/analisis/pdf',     requireModulo('reportes'), requireNivel('admin_negocio'),
  [...validarRango,
   query('agrupacion').optional().isIn(['dia', 'semana', 'mes']).withMessage('Agrupación inválida'),
   query('detalle').optional().isIn(['resumen', 'completo']).withMessage('Detalle inválido')],
  validate, ctrl.exportarPdf);
// Proyección mensual + gastos fijos: solo admin_negocio.
router.get('/proyeccion',       requireModulo('reportes'), requireNivel('admin_negocio'),
  [query('meses').optional().isIn(['3', '6', '12']).withMessage('meses inválido (3, 6 o 12)')],
  validate, ctrl.getProyeccion);

const validarGastoFijo = [
  body('nombre').trim().notEmpty().withMessage('El nombre es requerido')
    .isLength({ max: 60 }).withMessage('El nombre es demasiado largo'),
  body('valor').isFloat({ min: 0 }).withMessage('El valor debe ser un número ≥ 0'),
];

router.get('/gastos-fijos',        requireModulo('reportes'), requireNivel('admin_negocio'), ctrl.listarGastosFijos);
router.post('/gastos-fijos',       requireModulo('reportes'), requireNivel('admin_negocio'), validarGastoFijo, validate, ctrl.crearGastoFijo);
router.patch('/gastos-fijos/:id',  requireModulo('reportes'), requireNivel('admin_negocio'), validarGastoFijo, validate, ctrl.actualizarGastoFijo);
router.delete('/gastos-fijos/:id', requireModulo('reportes'), requireNivel('admin_negocio'), ctrl.eliminarGastoFijo);

router.get('/ventas-vendedor',  requireModulo('reportes'), requireNivel('supervisor'),    validarRango, validate, ctrl.getVentasPorVendedor);
router.get('/productos-top',    requireModulo('reportes'), requireNivel('supervisor'),    validarRango, validate, ctrl.getProductosTop);
router.get('/inventario-bajo',  requireModulo('reportes'),                               ctrl.getInventarioBajo);
router.patch('/costo-compra',   requireModulo('reportes'), requireNivel('admin_negocio'), ctrl.actualizarCostoCompra);
router.get('/inventario/valor', requireModulo('reportes'), requireNivel('admin_negocio'), ctrl.getValorInventario);

module.exports = router;