const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { pool } = require('../../config/db');

const _buildPayload = (usuario) => ({
  id:                usuario.id,
  nombre:            usuario.nombre,
  email:             usuario.email,
  rol:               usuario.rol,
  negocio_id:        usuario.negocio_id,
  negocio_nombre:    usuario.negocio_nombre,
  sucursal_id:       usuario.sucursal_id,
  sucursal_nombre:   usuario.sucursal_nombre,
  password_temporal: usuario.password_temporal ?? false,
});
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const login = async (email, password) => {
  if (!email || !EMAIL_REGEX.test(email)) {
    throw { status: 400, message: 'Correo electrónico no válido' };
  }
  if (!password || password.length < 4) {
    throw { status: 400, message: 'Contraseña inválida' };
  }
  const { rows } = await pool.query(
    `SELECT
       u.id, u.nombre, u.email, u.password_hash, u.rol, u.activo,
       u.negocio_id, n.nombre AS negocio_nombre,
       n.estado_plan, n.fecha_vencimiento,
       u.sucursal_id, s.nombre AS sucursal_nombre,
       u.password_temporal
     FROM usuarios u
     JOIN negocios   n ON n.id = u.negocio_id
     LEFT JOIN sucursales s ON s.id = u.sucursal_id
     WHERE LOWER(u.email) = LOWER($1)`,
    [email]
  );

  const usuario = rows[0];
  if (!usuario) throw { status: 401, message: 'Credenciales incorrectas' };
  if (!usuario.activo) throw { status: 401, message: 'Usuario desactivado, contacta al administrador' };

  const passwordValida = await bcrypt.compare(password, usuario.password_hash);
  if (!passwordValida) throw { status: 401, message: 'Credenciales incorrectas' };

  if (usuario.estado_plan === 'suspendido') {
    throw { status: 403, message: 'Cuenta suspendida. Contacta al soporte.', code: 'CUENTA_SUSPENDIDA' };
  }
  if (usuario.estado_plan === 'pendiente') {
    throw { status: 403, message: 'Cuenta pendiente de activación.', code: 'CUENTA_PENDIENTE' };
  }
  if (usuario.estado_plan === 'activo' && new Date(usuario.fecha_vencimiento) < new Date()) {
    await pool.query(`UPDATE negocios SET estado_plan = 'vencido' WHERE id = $1`, [usuario.negocio_id]);
    throw { status: 403, message: 'Tu plan ha vencido.', code: 'PLAN_VENCIDO' };
  }
  if (usuario.estado_plan === 'vencido') {
    throw { status: 403, message: 'Tu plan ha vencido.', code: 'PLAN_VENCIDO' };
  }

  const payload = _buildPayload(usuario);

  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
  const refreshToken = jwt.sign(
    { id: usuario.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN }
  );

  await pool.query('UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = $1', [usuario.id]);

  return { accessToken, refreshToken, usuario: payload };
};

const refreshAccessToken = async (refreshToken) => {
  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    const { rows } = await pool.query(
      `SELECT
         u.id, u.nombre, u.email, u.rol, u.activo,
         u.negocio_id, n.nombre AS negocio_nombre,
         n.estado_plan, n.fecha_vencimiento,
         u.sucursal_id, s.nombre AS sucursal_nombre,
         u.password_temporal
       FROM usuarios u
       JOIN negocios   n ON n.id = u.negocio_id
       LEFT JOIN sucursales s ON s.id = u.sucursal_id
       WHERE u.id = $1`,
      [decoded.id]
    );

    const usuario = rows[0];
    if (!usuario || !usuario.activo) throw { status: 401, message: 'Usuario no válido' };

    const payload     = _buildPayload(usuario);
    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN,
    });

    return { accessToken, usuario: payload };
  } catch (err) {
    if (err.status) throw err;
    throw { status: 401, message: 'Refresh token inválido o expirado' };
  }
};

module.exports = { login, refreshAccessToken };