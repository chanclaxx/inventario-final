const { pool } = require('../../config/db');

const findAll = async (negocioId) => {
  const { rows } = await pool.query(
    `SELECT id, nombre, creado_en
     FROM lineas_producto
     WHERE negocio_id = $1
     ORDER BY nombre ASC`,
    [negocioId]
  );
  return rows;
};

const findById = async (id, negocioId) => {
  const { rows } = await pool.query(
    `SELECT id, nombre, creado_en
     FROM lineas_producto
     WHERE id = $1 AND negocio_id = $2`,
    [id, negocioId]
  );
  return rows[0] || null;
};

const findByNombre = async (nombre, negocioId) => {
  const { rows } = await pool.query(
    `SELECT id FROM lineas_producto
     WHERE negocio_id = $1 AND LOWER(nombre) = LOWER($2) LIMIT 1`,
    [negocioId, nombre.trim()]
  );
  return rows[0] || null;
};

const create = async (negocioId, nombre) => {
  const { rows } = await pool.query(
    `INSERT INTO lineas_producto (negocio_id, nombre)
     VALUES ($1, $2) RETURNING id, nombre, creado_en`,
    [negocioId, nombre.trim()]
  );
  return rows[0];
};

const update = async (id, negocioId, nombre) => {
  const { rows } = await pool.query(
    `UPDATE lineas_producto SET nombre = $1
     WHERE id = $2 AND negocio_id = $3
     RETURNING id, nombre, creado_en`,
    [nombre.trim(), id, negocioId]
  );
  return rows[0] || null;
};

const eliminar = async (id, negocioId) => {
  // ── Desasociar productos antes de eliminar ──
  await pool.query(
    `UPDATE productos_serial SET linea_id = NULL WHERE linea_id = $1`,
    [id]
  );
  await pool.query(
    `UPDATE productos_cantidad SET linea_id = NULL WHERE linea_id = $1`,
    [id]
  );
  const { rows } = await pool.query(
    `DELETE FROM lineas_producto WHERE id = $1 AND negocio_id = $2 RETURNING id`,
    [id, negocioId]
  );
  return rows[0] || null;
};

const contarProductos = async (id, negocioId) => {
  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM productos_serial   ps
        JOIN sucursales su ON su.id = ps.sucursal_id
        WHERE ps.linea_id = $1 AND su.negocio_id = $2) +
       (SELECT COUNT(*) FROM productos_cantidad pc
        JOIN sucursales su ON su.id = pc.sucursal_id
        WHERE pc.linea_id = $1 AND su.negocio_id = $2) AS total`,
    [id, negocioId]
  );
  return Number(rows[0].total);
};

module.exports = { findAll, findById, findByNombre, create, update, eliminar, contarProductos };