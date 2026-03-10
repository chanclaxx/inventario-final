const { registrarNegocio } = require('./registro.service');

async function register(req, res, next) {
  try {
    const { nombre, nit, telefono, direccion, email } = req.body;

    if (!nombre?.trim())  return res.status(400).json({ error: 'El nombre del negocio es requerido' });
    if (!email?.trim())   return res.status(400).json({ error: 'El email es requerido' });
    if (!telefono?.trim()) return res.status(400).json({ error: 'El teléfono es requerido' });

    const negocio = await registrarNegocio({ nombre, nit, telefono, direccion, email });

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