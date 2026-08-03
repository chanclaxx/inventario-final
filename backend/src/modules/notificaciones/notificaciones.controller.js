const service = require('./notificaciones.service');

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

module.exports = { getEstado, suscribir, desuscribir, prueba };
