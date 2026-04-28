const { pool } = require('../../config/db');

const findAll = async (negocioId) => {
  const { rows } = await pool.query(`
    SELECT u.id, u.nombre, u.email, u.rol, u.activo,
           u.sucursal_id, u.creado_en, u.ultimo_acceso,
           s.nombre AS sucursal_nombre
    FROM usuarios u
    LEFT JOIN sucursales s ON s.id = u.sucursal_id
    WHERE u.negocio_id = $1
    ORDER BY u.nombre
  `, [negocioId]);
  return rows;
};

const findById = async (negocioId, id) => {
  const { rows } = await pool.query(`
    SELECT u.id, u.nombre, u.email, u.rol, u.activo,
           u.sucursal_id, u.creado_en, u.ultimo_acceso,
           s.nombre AS sucursal_nombre
    FROM usuarios u
    LEFT JOIN sucursales s ON s.id = u.sucursal_id
    WHERE u.id = $1 AND u.negocio_id = $2
  `, [id, negocioId]);
  return rows[0] || null;
};

/**
 * Búsqueda global por email — alineada con el constraint usuarios_email_key (único global).
 * Acepta excludeId para no colisionar consigo mismo al editar.
 */
const findByEmail = async (email, excludeId = null) => {
  const { rows } = await pool.query(
    `SELECT id FROM usuarios
     WHERE LOWER(email) = LOWER($1)
       AND ($2::int IS NULL OR id <> $2)`,
    [email, excludeId]
  );
  return rows[0] || null;
};

const create = async ({
  negocio_id, nombre, email, password_hash, rol,
  sucursal_id, password_temporal, modulos_permitidos,
}) => {
  const { rows } = await pool.query(`
    INSERT INTO usuarios(
      negocio_id, nombre, email, password_hash, rol,
      sucursal_id, password_temporal, modulos_permitidos
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, nombre, email, rol, activo, sucursal_id,
              creado_en, modulos_permitidos
  `, [
    negocio_id, nombre, email, password_hash, rol,
    sucursal_id || null,
    password_temporal ?? false,
    modulos_permitidos || null,   // NULL = usar permisos base del rol
  ]);
  return rows[0];
};

const update = async (negocioId, id, datos) => {
  const { nombre, email, rol, sucursal_id, modulos_permitidos } = datos;
  const activoExplicito = typeof datos.activo === 'boolean';
 
  let query, params;
 
  if (activoExplicito) {
    query = `
      UPDATE usuarios
      SET nombre = $1, email = $2, rol = $3, sucursal_id = $4,
          activo = $5, modulos_permitidos = $6
      WHERE id = $7 AND negocio_id = $8
      RETURNING id, nombre, email, rol, activo, sucursal_id, modulos_permitidos
    `;
    params = [
      nombre, email, rol, sucursal_id || null,
      datos.activo,
      modulos_permitidos !== undefined ? modulos_permitidos : null,
      id, negocioId,
    ];
  } else {
    query = `
      UPDATE usuarios
      SET nombre = $1, email = $2, rol = $3,
          sucursal_id = $4, modulos_permitidos = $5
      WHERE id = $6 AND negocio_id = $7
      RETURNING id, nombre, email, rol, activo, sucursal_id, modulos_permitidos
    `;
    params = [
      nombre, email, rol, sucursal_id || null,
      modulos_permitidos !== undefined ? modulos_permitidos : null,
      id, negocioId,
    ];
  }
 
  const { rows } = await pool.query(query, params);
  return rows[0] || null;
};

const updatePassword = async (negocioId, id, password_hash) => {
  const { rowCount } = await pool.query(
    'UPDATE usuarios SET password_hash = $1 WHERE id = $2 AND negocio_id = $3',
    [password_hash, id, negocioId]
  );
  return rowCount > 0;
};
const findAdminByEmail = async (email) => {
  const { rows } = await pool.query(
    `SELECT id, nombre, email, negocio_id
     FROM usuarios
     WHERE LOWER(email) = LOWER($1)
       AND rol = 'admin_negocio'
       AND activo = true
     LIMIT 1`,
    [email]
  );
  return rows[0] || null;
};
 
// Guarda el hash del token de recuperación.
// Invalida tokens anteriores del mismo usuario antes de insertar el nuevo.
const crearTokenRecuperacion = async (usuarioId, tokenHash, expiraEn) => {
  // Invalidar tokens previos no usados del mismo usuario
  await pool.query(
    `UPDATE tokens_recuperacion SET usado = true
     WHERE usuario_id = $1 AND usado = false`,
    [usuarioId]
  );
  const { rows } = await pool.query(
    `INSERT INTO tokens_recuperacion(usuario_id, token_hash, expira_en)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [usuarioId, tokenHash, expiraEn]
  );
  return rows[0];
};
 
// Busca un token válido (no usado, no expirado) por su hash.
const findTokenRecuperacion = async (tokenHash) => {
  const { rows } = await pool.query(
    `SELECT tr.id, tr.usuario_id, tr.expira_en, tr.usado,
            u.email, u.negocio_id
     FROM tokens_recuperacion tr
     JOIN usuarios u ON u.id = tr.usuario_id
     WHERE tr.token_hash = $1
       AND tr.usado = false
       AND tr.expira_en > now()
     LIMIT 1`,
    [tokenHash]
  );
  return rows[0] || null;
};
 
// Marca el token como usado — se llama justo después de cambiar la contraseña.
const invalidarTokenRecuperacion = async (tokenId) => {
  await pool.query(
    'UPDATE tokens_recuperacion SET usado = true WHERE id = $1',
    [tokenId]
  );
};

module.exports = { findAll, findById, findByEmail, create, update, updatePassword,invalidarTokenRecuperacion,crearTokenRecuperacion,findAdminByEmail,findTokenRecuperacion };