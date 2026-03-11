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

const _emitirTokens = (payload) => ({
  accessToken: jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  }),
  refreshToken: jwt.sign(
    { id: payload.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN }
  ),
});

// ─────────────────────────────────────────────
// QUERY BASE — reutilizada en login y refresh
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// PASO 1 — Verificar credenciales y retornar
//           los negocios disponibles para ese email.
//           Si solo hay uno, hace login directo.
// ─────────────────────────────────────────────
const verificarCredenciales = async (email, password) => {
  if (!email || !EMAIL_REGEX.test(email)) {
    throw { status: 400, message: 'Correo electrónico no válido' };
  }
  if (!password || password.length < 4) {
    throw { status: 400, message: 'Contraseña inválida' };
  }

  // Buscar TODOS los usuarios con ese email (pueden estar en distintos negocios)
  const { rows } = await pool.query(
    `${QUERY_USUARIO_BASE} WHERE LOWER(u.email) = LOWER($1)`,
    [email]
  );

  if (rows.length === 0) {
    throw { status: 401, message: 'Credenciales incorrectas' };
  }

  // Verificar contraseña contra el primer registro (todos comparten el mismo hash
  // si el email es el mismo usuario, o puede diferir si son usuarios distintos).
  // Filtramos solo los que tienen contraseña válida.
  const validos = [];
  for (const u of rows) {
    const ok = await bcrypt.compare(password, u.password_hash);
    if (ok) validos.push(u);
  }

  if (validos.length === 0) {
    throw { status: 401, message: 'Credenciales incorrectas' };
  }

  // Filtrar activos
  const activos = validos.filter((u) => u.activo);
  if (activos.length === 0) {
    throw { status: 401, message: 'Usuario desactivado, contacta al administrador' };
  }

  // Si solo hay un negocio disponible → login directo
  if (activos.length === 1) {
    return _completarLogin(activos[0]);
  }

  // Más de un negocio → devolver lista para que el frontend muestre selector
  return {
    requiere_seleccion: true,
    negocios: activos.map((u) => ({
      negocio_id:     u.negocio_id,
      negocio_nombre: u.negocio_nombre,
      usuario_id:     u.id,
    })),
  };
};

// ─────────────────────────────────────────────
// PASO 2 — Login con negocio_id explícito
//           (usado cuando hay múltiples negocios)
// ─────────────────────────────────────────────
const loginConNegocio = async (email, password, negocio_id) => {
  if (!email || !EMAIL_REGEX.test(email)) {
    throw { status: 400, message: 'Correo electrónico no válido' };
  }
  if (!password || password.length < 4) {
    throw { status: 400, message: 'Contraseña inválida' };
  }
  if (!negocio_id) {
    throw { status: 400, message: 'negocio_id requerido' };
  }

  const { rows } = await pool.query(
    `${QUERY_USUARIO_BASE}
     WHERE LOWER(u.email) = LOWER($1)
       AND u.negocio_id   = $2`,
    [email, negocio_id]
  );

  const usuario = rows[0];
  if (!usuario) throw { status: 401, message: 'Credenciales incorrectas' };
  if (!usuario.activo) throw { status: 401, message: 'Usuario desactivado, contacta al administrador' };

  const passwordValida = await bcrypt.compare(password, usuario.password_hash);
  if (!passwordValida) throw { status: 401, message: 'Credenciales incorrectas' };

  return _completarLogin(usuario);
};

// ─────────────────────────────────────────────
// INTERNO — valida plan, emite tokens, actualiza acceso
// ─────────────────────────────────────────────
const _completarLogin = async (usuario) => {
  await _validarEstadoPlan(usuario);

  const payload = _buildPayload(usuario);
  const tokens  = _emitirTokens(payload);

  await pool.query('UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = $1', [usuario.id]);

  return { ...tokens, usuario: payload, requiere_seleccion: false };
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

    return { accessToken, usuario: payload };
  } catch (err) {
    if (err.status) throw err;
    throw { status: 401, message: 'Refresh token inválido o expirado' };
  }
};

module.exports = { verificarCredenciales, loginConNegocio, refreshAccessToken };