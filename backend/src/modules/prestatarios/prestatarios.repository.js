const { pool } = require('../../config/db');
const { sqlSinTildes, normalizarTexto } = require('../../utils/textoBusqueda.util');

const findAll = async (negocioId) => {
  const { rows } = await pool.query(`
    SELECT p.id, p.nombre, p.telefono, p.creado_en, p.saldo_a_favor,
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

// Reemplaza el findById existente
const findById = async (id, negocioId) => {
  const { rows } = await pool.query(
    'SELECT * FROM prestatarios WHERE id = $1 AND negocio_id = $2',
    [id, negocioId]
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

const update = async (id, negocioId, { nombre, telefono }) => {
  const { rows } = await pool.query(`
    UPDATE prestatarios
    SET nombre = $1, telefono = $2
    WHERE id = $3 AND negocio_id = $4
    RETURNING *
  `, [nombre, telefono || null, id, negocioId]);
  return rows[0] || null;
};

// El homónimo SIN TILDES: «Maria Lopez» choca con «María López». Así se
// detectan los duplicados que crea el teclado del celular al ponerle tildes a
// un nombre que otro escribió sin ellas (o al revés).
const findHomonimo = async (negocioId, nombre, excluirId = null) => {
  const { rows } = await pool.query(`
    SELECT id, nombre, telefono FROM prestatarios
    WHERE negocio_id = $1 AND ${sqlSinTildes('nombre')} = $2
      AND ($3::int IS NULL OR id <> $3)
    ORDER BY id LIMIT 1
  `, [negocioId, normalizarTexto(nombre), excluirId]);
  return rows[0] || null;
};

const findEmpleadoHomonimo = async (prestatarioId, nombre) => {
  const { rows } = await pool.query(`
    SELECT id, nombre FROM empleados_prestatario
    WHERE prestatario_id = $1 AND ${sqlSinTildes('nombre')} = $2
    ORDER BY id LIMIT 1
  `, [prestatarioId, normalizarTexto(nombre)]);
  return rows[0] || null;
};

module.exports = {
  findAll, findById, create, update, getEmpleados, createEmpleado,
  findHomonimo, findEmpleadoHomonimo,
};