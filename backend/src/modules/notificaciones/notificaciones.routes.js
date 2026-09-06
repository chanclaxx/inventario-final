const router   = require('express').Router();
const { body } = require('express-validator');
const { validate } = require('../../middlewares/validate.middleware');
const ctrl     = require('./notificaciones.controller');

// ─────────────────────────────────────────────────────────────────────────────
// Notificaciones push. Todas las rutas cuelgan de la cadena `protegida` que se
// arma en index.js, así que aquí ya hay `req.user` con negocio y rol.
//
// No hay restricción de rol: cualquier usuario puede activar los avisos en SU
// dispositivo. Quién recibe cada tipo de aviso se decide en el envío, no aquí.
// ─────────────────────────────────────────────────────────────────────────────

const validarSuscripcion = [
  body('suscripcion.endpoint').isString().trim().notEmpty()
    .withMessage('Falta el endpoint de la suscripción'),
  body('suscripcion.keys.p256dh').isString().trim().notEmpty()
    .withMessage('Falta la clave p256dh de la suscripción'),
  body('suscripcion.keys.auth').isString().trim().notEmpty()
    .withMessage('Falta la clave auth de la suscripción'),
];

router.get('/estado', ctrl.getEstado);
// El panel de Avisos. Va aquí y no en `reportes` porque no es un reporte: es
// exactamente lo que el sistema decidió notificar, y tiene que salir del mismo
// motor para que la pantalla y el push nunca se contradigan.
router.get('/resumen', ctrl.getResumen);
router.post('/suscribir',   validarSuscripcion, validate, ctrl.suscribir);
router.delete('/suscribir', ctrl.desuscribir);
router.post('/prueba',      ctrl.prueba);

module.exports = router;
