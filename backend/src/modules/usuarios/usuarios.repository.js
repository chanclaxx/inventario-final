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
 * Antes: findByEmail(email) — buscaba globalmente.
 * Ahora: findByEmailEnNegocio(email, negocioId) — scoped al negocio,
 * alineado con el constraint usuarios_negocio_email_unique.
 * Acepta excludeId para no colisionar consigo mismo al editar.
 */
const findByEmailEnNegocio = async (email, negocioId, excludeId = null) => {
  const { rows } = await pool.query(
    `SELECT id FROM usuarios
     WHERE LOWER(email) = LOWER($1)
       AND negocio_id   = $2
       AND ($3::int IS NULL OR id <> $3)`,
    [email, negocioId, excludeId]
  );
  return rows[0] || null;
};

const create = async ({ negocio_id, nombre, email, password_hash, rol, sucursal_id, password_temporal }) => {
  const { rows } = await pool.query(`
    INSERT INTO usuarios(negocio_id, nombre, email, password_hash, rol, sucursal_id, password_temporal)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, nombre, email, rol, activo, sucursal_id, creado_en
  `, [negocio_id, nombre, email, password_hash, rol, sucursal_id || null, password_temporal ?? false]);
  return rows[0];
};

const update = async (negocioId, id, datos) => {
  const { nombre, email, rol, sucursal_id } = datos;
  const activoExplicito = typeof datos.activo === 'boolean';

  let query, params;

  if (activoExplicito) {
    query = `
      UPDATE usuarios
      SET nombre = $1, email = $2, rol = $3, sucursal_id = $4, activo = $5
      WHERE id = $6 AND negocio_id = $7
      RETURNING id, nombre, email, rol, activo, sucursal_id
    `;
    params = [nombre, email, rol, sucursal_id || null, datos.activo, id, negocioId];
  } else {
    query = `
      UPDATE usuarios
      SET nombre = $1, email = $2, rol = $3, sucursal_id = $4
      WHERE id = $5 AND negocio_id = $6
      RETURNING id, nombre, email, rol, activo, sucursal_id
    `;
    params = [nombre, email, rol, sucursal_id || null, id, negocioId];
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

module.exports = { findAll, findById, findByEmailEnNegocio, create, update, updatePassword };