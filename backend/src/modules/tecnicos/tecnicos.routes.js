// Técnicos externos — ver migrations/20260918_tecnicos_externos.sql.
//
// Tres candados, en orden: el módulo Servicios (el usuario), la función
// encendida en el negocio (404 si no), y la llave granular de cada acción.
// Las rutas literales van ANTES de las que llevan `:id`.
const router = require('express').Router();
const { requireModulo }          = require('../../middlewares/modulo.middleware');
const { requirePermisoTecnicos } = require('../../middlewares/role.middleware');
const { requireTecnicos }        = require('../../middlewares/tecnicos.middleware');
const ctrl = require('./tecnicos.controller');

router.use(requireModulo('servicios'), requireTecnicos);

// Estado de la función para la pantalla (umbrales, activo). Solo lectura.
router.get('/config', (req, res) => res.json({ ok: true, data: req.tecnicosCfg }));

router.get('/equipos',              ctrl.listarEquipos);
router.get('/disponibles',          requirePermisoTecnicos('mover'), ctrl.buscarDisponibles);
router.get('/resumen',              ctrl.resumenPeriodo);
router.post('/salidas',             requirePermisoTecnicos('mover'), ctrl.enviar);
router.post('/ordenes/:ordenId/enviar', requirePermisoTecnicos('mover'), ctrl.enviarDesdeOrden);
router.post('/equipos/:id/recibir', requirePermisoTecnicos('mover'), ctrl.recibir);
router.post('/equipos/:id/reclamar', requirePermisoTecnicos('mover'), ctrl.reclamarGarantia);
router.patch('/equipos/:id/anular', requirePermisoTecnicos('mover'), ctrl.anularEquipo);
router.patch('/pagos/:id/anular',   requirePermisoTecnicos('anular'), ctrl.anularPago);

router.get('/',                     ctrl.listarTecnicos);
router.post('/',                    requirePermisoTecnicos('gestionar'), ctrl.crearTecnico);
router.get('/:id',                  ctrl.detalleTecnico);
router.put('/:id',                  requirePermisoTecnicos('gestionar'), ctrl.actualizarTecnico);
router.post('/:id/pagos',           requirePermisoTecnicos('pagar'), ctrl.registrarPago);

module.exports = router;
