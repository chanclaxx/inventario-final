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

/**
 * Cobros del día: los vencidos y los que están por vencer, para llamarlos.
 *
 * Es la pantalla a la que llevan los dos avisos de cartera, y sale de la MISMA
 * función que usa el cron para contarlos: si el aviso dice 5, aquí salen esos 5.
 *
 * El vendedor y el supervisor solo ven su sucursal (`req.sucursal_id` lo resuelve
 * el middleware). El admin ve TODO el negocio salvo que pida una sucursal
 * explícita: para cobrar, lo útil es la lista completa, no la de una sede.
 */
const getCobros = async (req, res, next) => {
  try {
    const alertas = require('./notificaciones.alertas');
    const sucursalId = req.user.rol === 'admin_negocio'
      ? (req.query.sucursal_id ? Number(req.query.sucursal_id) : null)
      : (req.sucursal_id ?? req.user.sucursal_id ?? null);

    const data = await alertas.cartera(req.user.negocio_id, sucursalId);

    // El nombre del negocio va en el mensaje de WhatsApp que arma la pantalla:
    // un cobro que llega firmado por la tienda se responde; uno anónimo, no.
    const { pool } = require('../../config/db');
    const { rows } = await pool.query('SELECT nombre FROM negocios WHERE id = $1', [req.user.negocio_id]);

    res.json({ ok: true, data: { ...data, negocio_nombre: rows[0]?.nombre ?? null } });
  } catch (err) { next(err); }
};

const prueba = async (req, res, next) => {
  try {
    const data = await service.enviarPrueba(req.user);
    res.json({ ok: true, data, message: 'Notificación de prueba enviada' });
  } catch (err) { next(err); }
};

module.exports = { getEstado, suscribir, desuscribir, prueba, getCobros };
