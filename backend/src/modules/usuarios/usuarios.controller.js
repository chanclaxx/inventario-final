const service = require('./usuarios.service');

const getUsuarios = async (req, res, next) => {
  try {
    const data = await service.getUsuarios(req.user.negocio_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getUsuarioById = async (req, res, next) => {
  try {
    const data = await service.getUsuarioById(req.user.negocio_id, req.params.id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const crearUsuario = async (req, res, next) => {
  try {
    const data = await service.crearUsuario(req.user.negocio_id, req.body);
    res.status(201).json({ ok: true, data, message: 'Usuario creado correctamente' });
  } catch (err) { next(err); }
};

const actualizarUsuario = async (req, res, next) => {
  try {
    const data = await service.actualizarUsuario(req.user.negocio_id, req.params.id, req.body);
    res.json({ ok: true, data, message: 'Usuario actualizado correctamente' });
  } catch (err) { next(err); }
};

const cambiarPassword = async (req, res, next) => {
  try {
    await service.cambiarPassword(req.user.negocio_id, req.user.id, req.body);
    res.json({ ok: true, message: 'Contraseña actualizada correctamente' });
  } catch (err) { next(err); }
};

const cambiarPasswordTemporal = async (req, res, next) => {
  try {
    await service.cambiarPasswordTemporal(req.user.negocio_id, req.user.id, req.body);
    res.json({ ok: true, message: 'Contraseña actualizada correctamente' });
  } catch (err) { next(err); }
};
const solicitarRecuperacion = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ ok: false, error: 'Email requerido' });
    // Siempre responde OK para no revelar si el email existe
    await service.solicitarRecuperacion(email.trim().toLowerCase());
    res.json({ ok: true, message: 'Si el correo existe, recibirás las instrucciones en breve.' });
  } catch (err) { next(err); }
};
 
// POST /usuarios/resetear-password
// Body: { token, password_nueva }
// Pública — no requiere autenticación
const resetearPassword = async (req, res, next) => {
  try {
    const { token, password_nueva } = req.body;
    if (!token || !password_nueva) {
      return res.status(400).json({ ok: false, error: 'Token y contraseña son requeridos' });
    }
    await service.resetearPassword(token, password_nueva);
    res.json({ ok: true, message: 'Contraseña actualizada correctamente. Ya puedes iniciar sesión.' });
  } catch (err) { next(err); }
};

module.exports = {
  getUsuarios, getUsuarioById, crearUsuario,
  actualizarUsuario, cambiarPassword, cambiarPasswordTemporal,solicitarRecuperacion,resetearPassword
};