const { pool } = require('../../config/db');

const findAll = async (negocioId) => {
  const { rows } = await pool.query(
    `SELECT * FROM garantias WHERE negocio_id = $1 ORDER BY orden ASC, id ASC`,
    [negocioId]
  );
  return rows;
};

const findById = async (negocioId, id) => {
  const { rows } = await pool.query(
    `SELECT * FROM garantias WHERE id = $1 AND negocio_id = $2`,
    [id, negocioId]
  );
  return rows[0] || null;
};

const create = async (negocioId, { titulo, texto, orden }) => {
  const { rows } = await pool.query(`
    INSERT INTO garantias(negocio_id, titulo, texto, orden)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [negocioId, titulo, texto, orden || 0]);
  return rows[0];
};

const update = async (negocioId, id, { titulo, texto, orden }) => {
  const { rows } = await pool.query(`
    UPDATE garantias
    SET titulo = $1, texto = $2, orden = $3
    WHERE id = $4 AND negocio_id = $5
    RETURNING *
  `, [titulo, texto, orden, id, negocioId]);
  return rows[0] || null;
};

const eliminar = async (negocioId, id) => {
  const { rowCount } = await pool.query(
    `DELETE FROM garantias WHERE id = $1 AND negocio_id = $2`,
    [id, negocioId]
  );
  return rowCount > 0;
};

module.exports = { findAll, findById, create, update, eliminar };