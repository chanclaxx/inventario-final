const { pool } = require('../../config/db');

const findAll = async (negocioId) => {
  const { rows } = await pool.query(
    `SELECT id, nombre, valores, orden, activo, creado_en
     FROM tipos_caracteristica
     WHERE negocio_id = $1 AND activo = true
     ORDER BY orden ASC, nombre ASC`,
    [negocioId]
  );
  return rows;
};

const findById = async (id, negocioId) => {
  const { rows } = await pool.query(
    `SELECT id, nombre, valores, orden, activo
     FROM tipos_caracteristica
     WHERE id = $1 AND negocio_id = $2`,
    [id, negocioId]
  );
  return rows[0] || null;
};

const findByNombre = async (nombre, negocioId) => {
  const { rows } = await pool.query(
    `SELECT id FROM tipos_caracteristica
     WHERE negocio_id = $1 AND LOWER(nombre) = LOWER($2) LIMIT 1`,
    [negocioId, nombre.trim()]
  );
  return rows[0] || null;
};

const create = async (negocioId, { nombre, valores = [], orden = 0 }) => {
  const { rows } = await pool.query(
    `INSERT INTO tipos_caracteristica (negocio_id, nombre, valores, orden)
     VALUES ($1, $2, $3::jsonb, $4)
     RETURNING id, nombre, valores, orden, activo, creado_en`,
    [negocioId, nombre.trim(), JSON.stringify(valores), orden]
  );
  return rows[0];
};

const update = async (id, negocioId, { nombre, valores, orden }) => {
  const sets = [];
  const params = [id, negocioId];
  if (nombre !== undefined) { sets.push(`nombre = $${params.length + 1}`); params.push(nombre.trim()); }
  if (valores !== undefined) { sets.push(`valores = $${params.length + 1}::jsonb`); params.push(JSON.stringify(valores)); }
  if (orden !== undefined) { sets.push(`orden = $${params.length + 1}`); params.push(orden); }
  if (!sets.length) return null;
  const { rows } = await pool.query(
    `UPDATE tipos_caracteristica SET ${sets.join(', ')}
     WHERE id = $1 AND negocio_id = $2
     RETURNING id, nombre, valores, orden, activo`,
    params
  );
  return rows[0] || null;
};

const eliminar = async (id, negocioId) => {
  const { rows } = await pool.query(
    `DELETE FROM tipos_caracteristica WHERE id = $1 AND negocio_id = $2 RETURNING id`,
    [id, negocioId]
  );
  return rows[0] || null;
};

const tieneHijosActivos = async (id) => {
  const { rows } = await pool.query(
    `SELECT 1 FROM atributos_producto WHERE tipo_id = $1 AND activo = true LIMIT 1`,
    [id]
  );
  if (rows.length) return true;
  const { rows: rows2 } = await pool.query(
    `SELECT 1 FROM variantes_atributo WHERE tipo_id = $1 AND activo = true LIMIT 1`,
    [id]
  );
  return rows2.length > 0;
};

module.exports = { findAll, findById, findByNombre, create, update, eliminar, tieneHijosActivos };
