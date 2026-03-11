const bcrypt       = require('bcryptjs');
const { pool }     = require('../../config/db');
const usuariosRepo = require('./usuarios.repository');

const getUsuarios = (negocioId) => usuariosRepo.findAll(negocioId);

const getUsuarioById = async (negocioId, id) => {
  const usuario = await usuariosRepo.findById(negocioId, id);
  if (!usuario) throw { status: 404, message: 'Usuario no encontrado' };
  return usuario;
};

const crearUsuario = async (negocioId, { nombre, email, password, rol, sucursal_id }) => {
  if (rol === 'admin_negocio' && sucursal_id) {
    throw { status: 400, message: 'El admin de negocio no puede tener sucursal asignada' };
  }
  if (rol !== 'admin_negocio' && !sucursal_id) {
    throw { status: 400, message: 'Supervisores y vendedores requieren sucursal asignada' };
  }

  // Verificar límite de usuarios del plan
  const { rows: [negocio] } = await pool.query(
    'SELECT max_usuarios FROM negocios WHERE id = $1',
    [negocioId]
  );
  const { rows: [conteo] } = await pool.query(
    'SELECT COUNT(*) AS total FROM usuarios WHERE negocio_id = $1 AND activo = true',
    [negocioId]
  );
  if (parseInt(conteo.total) >= negocio.max_usuarios) {
    throw {
      status: 400,
      message: `Tu plan permite máximo ${negocio.max_usuarios} usuario(s)`,
    };
  }

  // Validar email único globalmente (constraint usuarios_email_key)
  const existe = await usuariosRepo.findByEmail(email);
  if (existe) throw { status: 409, message: 'Ya existe un usuario con ese email' };

  const password_hash = await bcrypt.hash(password, 10);

  try {
    return await usuariosRepo.create({
      negocio_id: negocioId, nombre, email, password_hash, rol, sucursal_id,
      password_temporal: false,
    });
  } catch (err) {
    // Segunda línea de defensa ante race condition
    if (err.constraint === 'usuarios_email_key') {
      throw { status: 409, message: 'Ya existe un usuario con ese email' };
    }
    throw err;
  }
};

const actualizarUsuario = async (negocioId, id, datos) => {
  const existe = await usuariosRepo.findById(negocioId, id);
  if (!existe) throw { status: 404, message: 'Usuario no encontrado' };

  // Si viene email, validar que no colisione globalmente con otro usuario
  if (datos.email) {
    const duplicado = await usuariosRepo.findByEmail(datos.email, Number(id));
    if (duplicado) throw { status: 409, message: 'Ya existe un usuario con ese email' };
  }

  return usuariosRepo.update(negocioId, id, datos);
};

// Cambiar contraseña — usado por el propio usuario desde Config
const cambiarPassword = async (negocioId, id, { password_actual, password_nueva }) => {
  if (!password_nueva || password_nueva.length < 6) {
    throw { status: 400, message: 'La contraseña nueva debe tener al menos 6 caracteres' };
  }

  const { rows } = await pool.query(
    'SELECT password_hash FROM usuarios WHERE id = $1 AND negocio_id = $2',
    [id, negocioId]
  );
  if (!rows[0]) throw { status: 404, message: 'Usuario no encontrado' };

  const valida = await bcrypt.compare(password_actual, rows[0].password_hash);
  if (!valida) throw { status: 401, message: 'Contraseña actual incorrecta' };

  const password_hash = await bcrypt.hash(password_nueva, 10);
  await usuariosRepo.updatePassword(negocioId, id, password_hash);
};

// Cambiar contraseña temporal — primer login, no requiere contraseña actual
const cambiarPasswordTemporal = async (negocioId, id, { password_nueva }) => {
  if (!password_nueva || password_nueva.length < 6) {
    throw { status: 400, message: 'La contraseña debe tener al menos 6 caracteres' };
  }

  const usuario = await usuariosRepo.findById(negocioId, id);
  if (!usuario) throw { status: 404, message: 'Usuario no encontrado' };

  const password_hash = await bcrypt.hash(password_nueva, 10);
  await pool.query(
    'UPDATE usuarios SET password_hash = $1, password_temporal = false WHERE id = $2 AND negocio_id = $3',
    [password_hash, id, negocioId]
  );
};

module.exports = {
  getUsuarios, getUsuarioById, crearUsuario,
  actualizarUsuario, cambiarPassword, cambiarPasswordTemporal,
};