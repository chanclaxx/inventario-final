const { pool } = require('../../config/db');

const findAll = async (negocioId) => {
  const { rows } = await pool.query(`
    SELECT p.id, p.nombre, p.telefono, p.creado_en,
           COUNT(e.id) AS total_empleados,
           COALESCE(SUM(pr.valor_prestamo - pr.total_abonado)
             FILTER (WHERE pr.estado = 'Activo'), 0) AS saldo_total
    FROM prestatarios p
    LEFT JOIN empleados_prestatario e  ON e.prestatario_id = p.id
    LEFT JOIN prestamos pr             ON pr.prestatario_id = p.id
    WHERE p.negocio_id = $1
    GROUP BY p.id
    ORDER BY p.nombre
  `, [negocioId]);
  return rows;
};

const findById = async (id) => {
  const { rows } = await pool.query(
    'SELECT * FROM prestatarios WHERE id = $1',
    [id]
  );
  return rows[0] || null;
};

const create = async ({ negocio_id, nombre, telefono }) => {
  const { rows } = await pool.query(`
    INSERT INTO prestatarios(negocio_id, nombre, telefono)
    VALUES ($1, $2, $3)
    RETURNING *
  `, [negocio_id, nombre, telefono || null]);
  return rows[0];
};

const getEmpleados = async (prestatarioId) => {
  const { rows } = await pool.query(`
    SELECT id, nombre FROM empleados_prestatario
    WHERE prestatario_id = $1
    ORDER BY nombre
  `, [prestatarioId]);
  return rows;
};

const createEmpleado = async ({ prestatario_id, nombre }) => {
  const { rows } = await pool.query(`
    INSERT INTO empleados_prestatario(prestatario_id, nombre)
    VALUES ($1, $2)
    RETURNING *
  `, [prestatario_id, nombre]);
  return rows[0];
};

module.exports = { findAll, findById, create, getEmpleados, createEmpleado };