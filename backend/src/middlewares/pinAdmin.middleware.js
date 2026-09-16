const configService = require('../modules/config/config.service');

/**
 * Acción reservada al admin que otro usuario puede hacer CON el PIN.
 *
 * `admin_negocio` pasa como siempre. Cualquier otro rol tiene que estar
 * autorizado para usar el PIN (Ajustes → Seguridad) y mandar `pin` en el body. Se vuelve a verificar aquí aunque la pantalla ya lo
 * haya verificado: si solo lo mirara el frontend, la ruta quedaría abierta a
 * cualquiera autorizado que llame la API sin PIN.
 */
const requireAdminOPin = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ ok: false, error: 'No autenticado' });
  if (req.user.rol === 'admin_negocio') return next();

  try {
    const pin    = req.body?.pin;
    const valido = await configService.verificarPinDeUsuario(req.user.negocio_id, req.user, pin);
    if (!valido) return res.status(403).json({ ok: false, error: 'PIN incorrecto' });
    next();
  } catch (err) { next(err); }
};

module.exports = { requireAdminOPin };
