const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { pool } = require('../../config/db');

// ─────────────────────────────────────────────
// HELPERS PRIVADOS
// ─────────────────────────────────────────────
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

// Query reutilizada en login y refreshAccessToken
const QUERY_USUARIO_BASE = `
  SELECT
    u.id, u.nombre, u.email, u.password_hash, u.rol, u.activo,
    u.negocio_id, n.nombre AS negocio_nombre,
    n.estado_plan, n.fecha_vencimiento,
    u.sucursal_id, s.nombre AS sucursal_nombre,
    u.password_temporal
  FROM usuarios u
  JOIN negocios n ON n.id = u.negocio_id
  LEFT JOIN sucursales s ON s.id = u.sucursal_id
`;

// Query reutilizada para obtener sucursales activas de un negocio
const QUERY_SUCURSALES_NEGOCIO = `
  SELECT id, nombre
  FROM sucursales
  WHERE negocio_id = $1 AND activa = true
  ORDER BY id
`;

const _validarEstadoPlan = async (usuario) => {
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
};

/**
 * Retorna las sucursales activas del negocio solo para admin_negocio.
 * Vendedor y supervisor tienen su sucursal fija en el token — no necesitan lista.
 */
const _getSucursalesParaAdmin = async (usuario) => {
  if (usuario.rol !== 'admin_negocio') return null;
  const { rows } = await pool.query(QUERY_SUCURSALES_NEGOCIO, [usuario.negocio_id]);
  return rows;
};

// ─────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────
const login = async (email, password) => {
  if (!email || !EMAIL_REGEX.test(email)) {
    throw { status: 400, message: 'Correo electrónico no válido' };
  }
  if (!password || password.length < 4) {
    throw { status: 400, message: 'Contraseña inválida' };
  }

  const { rows } = await pool.query(
    `${QUERY_USUARIO_BASE} WHERE LOWER(u.email) = LOWER($1)`,
    [email]
  );

  const usuario = rows[0];
  if (!usuario) throw { status: 401, message: 'Credenciales incorrectas' };
  if (!usuario.activo) throw { status: 401, message: 'Usuario desactivado, contacta al administrador' };

  const passwordValida = await bcrypt.compare(password, usuario.password_hash);
  if (!passwordValida) throw { status: 401, message: 'Credenciales incorrectas' };

  await _validarEstadoPlan(usuario);

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

  const sucursales = await _getSucursalesParaAdmin(usuario);

  return { accessToken, refreshToken, usuario: payload, sucursales };
};

// ─────────────────────────────────────────────
// REFRESH TOKEN
// ─────────────────────────────────────────────
const refreshAccessToken = async (refreshToken) => {
  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    const { rows } = await pool.query(
      `${QUERY_USUARIO_BASE} WHERE u.id = $1`,
      [decoded.id]
    );

    const usuario = rows[0];
    if (!usuario || !usuario.activo) throw { status: 401, message: 'Usuario no válido' };

    const payload     = _buildPayload(usuario);
    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN,
    });

    const sucursales = await _getSucursalesParaAdmin(usuario);

    return { accessToken, usuario: payload, sucursales };
  } catch (err) {
    if (err.status) throw err;
    throw { status: 401, message: 'Refresh token inválido o expirado' };
  }
};

module.exports = { login, refreshAccessToken };