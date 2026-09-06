const service = require('./notificaciones.service');
const motor   = require('./notificaciones.motor');

/**
 * Estado de la feature + clave pública para suscribirse.
 *
 * La clave pública se sirve desde aquí y no se compila en el frontend a
 * propósito: rotarla no obliga a un rebuild ni a un despliegue de Vercel.
 */
const getEstado = async (req, res, next) => {
  try {
    const activo = service.estaActivo();
    const dispositivos = activo ? await service.misDispositivos(req.user.id) : [];
    res.json({
      ok: true,
      data: {
        activo,
        clave_publica: activo ? service.clavePublica() : null,
        dispositivos,
      },
    });
  } catch (err) { next(err); }
};

const suscribir = async (req, res, next) => {
  try {
    const data = await service.suscribir({
      suscripcion: req.body?.suscripcion,
      usuario:     req.user,
      userAgent:   req.headers['user-agent'],
    });
    res.status(201).json({ ok: true, data, message: 'Notificaciones activadas en este dispositivo' });
  } catch (err) { next(err); }
};

const desuscribir = async (req, res, next) => {
  try {
    const data = await service.desuscribir({
      endpoint: req.body?.endpoint,
      usuario:  req.user,
    });
    res.json({ ok: true, data, message: 'Notificaciones desactivadas en este dispositivo' });
  } catch (err) { next(err); }
};

const prueba = async (req, res, next) => {
  try {
    const data = await service.enviarPrueba(req.user);
    res.json({ ok: true, data, message: 'Notificación de prueba enviada' });
  } catch (err) { next(err); }
};

/**
 * El panel de Avisos: lo MISMO que decide las notificaciones.
 *
 * Sale del motor y no de una consulta propia, y eso es el punto: si la pantalla
 * calculara por su cuenta, el usuario abriría el resumen que le llegó y
 * encontraría algo distinto a lo que le avisaron. Una sola fuente de verdad.
 *
 * ── Por qué NO exige rol ────────────────────────────────────────────────────
 * Cualquiera puede abrir su panel; lo que ve depende de lo que el motor
 * devuelva para SU negocio. La frontera multi-tenant es `req.user.negocio_id`,
 * que viene del token y no del cliente — igual que en el envío.
 *
 * Ojo: el `detalle` lleva nombres de clientes y montos. Eso está bien en una
 * pantalla ya autenticada; lo que nunca puede llevarlos es el PUSH, que se ve
 * en la pantalla bloqueada. Esa distinción vive en el service (su regla 2).
 */
const getResumen = async (req, res, next) => {
  try {
    const { senales, urgentes, normales, detalle, umbrales } =
      await motor.recolectar(req.user.negocio_id);

    res.json({
      ok: true,
      data: {
        senales, urgentes, normales, detalle, umbrales,
        // Para que la pantalla pueda decir "todo al día" sin recorrer nada.
        total: senales.length,
        generado_en: new Date().toISOString(),
      },
    });
  } catch (err) { next(err); }
};

module.exports = { getEstado, suscribir, desuscribir, prueba, getResumen };
