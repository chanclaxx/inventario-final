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

module.exports = {
  getUsuarios, getUsuarioById, crearUsuario,
  actualizarUsuario, cambiarPassword, cambiarPasswordTemporal,
};