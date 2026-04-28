const bcrypt       = require('bcryptjs');
const { pool }     = require('../../config/db');
const usuariosRepo = require('./usuarios.repository');
const { PERMISOS_BASE } = require('../../config/modulos');
const crypto = require('crypto');
const { enviarRecuperacionPassword } = require('../email/email.service');

const getUsuarios = (negocioId) => usuariosRepo.findAll(negocioId);

const getUsuarioById = async (negocioId, id) => {
  const usuario = await usuariosRepo.findById(negocioId, id);
  if (!usuario) throw { status: 404, message: 'Usuario no encontrado' };
  return usuario;
};

const crearUsuario = async (negocioId, {
  nombre, email, password, rol, sucursal_id, modulos_permitidos,
}) => {
  if (rol === 'admin_negocio' && sucursal_id) {
    throw { status: 400, message: 'El admin de negocio no puede tener sucursal asignada' };
  }
  if (rol !== 'admin_negocio' && !sucursal_id) {
    throw { status: 400, message: 'Supervisores y vendedores requieren sucursal asignada' };
  }
 
  const { rows: [negocio] } = await pool.query(
    'SELECT max_usuarios FROM negocios WHERE id = $1', [negocioId]
  );
  const { rows: [conteo] } = await pool.query(
    'SELECT COUNT(*) AS total FROM usuarios WHERE negocio_id = $1 AND activo = true',
    [negocioId]
  );
  if (parseInt(conteo.total) >= negocio.max_usuarios) {
    throw { status: 400, message: `Tu plan permite máximo ${negocio.max_usuarios} usuario(s)` };
  }
 
  if (sucursal_id) {
    const { rows } = await pool.query(
      'SELECT id FROM sucursales WHERE id = $1 AND negocio_id = $2 AND activa = true',
      [sucursal_id, negocioId]
    );
    if (!rows.length) {
      throw { status: 400, message: 'La sucursal indicada no pertenece a este negocio' };
    }
  }
 
  const existe = await usuariosRepo.findByEmail(email);
  if (existe) throw { status: 409, message: 'Ya existe un usuario con ese email' };
 
  const password_hash = await bcrypt.hash(password, 10);
 
  // Si el admin envió módulos personalizados los usa; si no, guarda NULL
  // para que el sistema use los permisos base del rol automáticamente.
  const modulosAGuardar = (modulos_permitidos && rol !== 'admin_negocio')
    ? modulos_permitidos
    : null;
 
  try {
    return await usuariosRepo.create({
      negocio_id:         negocioId,
      nombre, email, password_hash, rol, sucursal_id,
      password_temporal:  false,
      modulos_permitidos: modulosAGuardar,
    });
  } catch (err) {
    if (err.constraint === 'usuarios_email_key') {
      throw { status: 409, message: 'Ya existe un usuario con ese email' };
    }
    throw err;
  }
};

const actualizarUsuario = async (negocioId, id, datos) => {
  const existe = await usuariosRepo.findById(negocioId, id);
  if (!existe) throw { status: 404, message: 'Usuario no encontrado' };
 
  if (datos.sucursal_id) {
    const { rows } = await pool.query(
      'SELECT id FROM sucursales WHERE id = $1 AND negocio_id = $2 AND activa = true',
      [datos.sucursal_id, negocioId]
    );
    if (!rows.length) {
      throw { status: 400, message: 'La sucursal indicada no pertenece a este negocio' };
    }
  }
 
  if (datos.email) {
    const duplicado = await usuariosRepo.findByEmail(datos.email, Number(id));
    if (duplicado) throw { status: 409, message: 'Ya existe un usuario con ese email' };
  }
 
  // Calcular módulos a guardar
  // Si viene modulos_permitidos en el payload → usar ese valor
  // Si es admin_negocio → siempre null (acceso total)
  const rolFinal = datos.rol || existe.rol;
  const modulosAGuardar = (rolFinal === 'admin_negocio')
    ? null
    : (datos.modulos_permitidos !== undefined
        ? datos.modulos_permitidos
        : existe.modulos_permitidos);  // mantener los que ya tenía
 
  return usuariosRepo.update(negocioId, id, {
    ...datos,
    modulos_permitidos: modulosAGuardar,
  });
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
const solicitarRecuperacion = async (email) => {
  const usuario = await usuariosRepo.findAdminByEmail(email);
 
  // Si no existe o no es admin_negocio, salir silenciosamente
  if (!usuario) return;
 
  // Generar token aleatorio seguro (32 bytes = 64 chars hex)
  const tokenPlano = crypto.randomBytes(32).toString('hex');
 
  // Guardar el hash SHA-256 — nunca el token plano en la BD
  const tokenHash = crypto.createHash('sha256').update(tokenPlano).digest('hex');
 
  // Token válido por 1 hora
  const expiraEn = new Date(Date.now() + 60 * 60 * 1000);
 
  await usuariosRepo.crearTokenRecuperacion(usuario.id, tokenHash, expiraEn);
 
  // Enviar email — fire and forget igual que el resto del sistema
  enviarRecuperacionPassword({
    email:   usuario.email,
    nombre:  usuario.nombre,
    token:   tokenPlano,
  }).catch((err) => {
    console.warn('[recuperacion] Error al enviar email:', err?.message || err);
  });
};
 
// Paso 2 — El usuario envía el token y la nueva contraseña.
const resetearPassword = async (tokenPlano, passwordNueva) => {
  if (!passwordNueva || passwordNueva.length < 6) {
    throw { status: 400, message: 'La contraseña debe tener al menos 6 caracteres' };
  }
 
  // Hashear el token recibido para comparar con la BD
  const tokenHash = crypto.createHash('sha256').update(tokenPlano).digest('hex');
 
  const tokenData = await usuariosRepo.findTokenRecuperacion(tokenHash);
  if (!tokenData) {
    throw { status: 400, message: 'El enlace es inválido o ya expiró. Solicita uno nuevo.' };
  }
 
  // Actualizar contraseña y limpiar password_temporal si aplica
  const passwordHash = await bcrypt.hash(passwordNueva, 10);
  await pool.query(
    `UPDATE usuarios
     SET password_hash = $1, password_temporal = false
     WHERE id = $2 AND negocio_id = $3`,
    [passwordHash, tokenData.usuario_id, tokenData.negocio_id]
  );
 
  // Invalidar el token — no se puede reutilizar
  await usuariosRepo.invalidarTokenRecuperacion(tokenData.id);
};

module.exports = {
  getUsuarios, getUsuarioById, crearUsuario,
  actualizarUsuario, cambiarPassword, cambiarPasswordTemporal,resetearPassword,solicitarRecuperacion
};