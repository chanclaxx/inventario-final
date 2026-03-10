const { registrarNegocio } = require('./registro.service');

const PLANES_VALIDOS = ['basico', 'pro'];

async function register(req, res, next) {
  try {
    const { nombre, nit, telefono, direccion, email, plan } = req.body;

    if (!nombre?.trim())   return res.status(400).json({ error: 'El nombre del negocio es requerido' });
    if (!email?.trim())    return res.status(400).json({ error: 'El email es requerido' });
    if (!telefono?.trim()) return res.status(400).json({ error: 'El teléfono es requerido' });
    if (!PLANES_VALIDOS.includes(plan)) {
      return res.status(400).json({ error: 'Plan no válido. Selecciona básico o pro' });
    }

    const negocio = await registrarNegocio({ nombre, nit, telefono, direccion, email, plan });

    res.status(201).json({
      ok: true,
      message: 'Registro exitoso. Tu solicitud está siendo revisada.',
      data: { id: negocio.id, nombre: negocio.nombre },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { register };