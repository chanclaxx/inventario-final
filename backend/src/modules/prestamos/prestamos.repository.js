const { pool } = require('../../config/db');

const findAll = async (sucursalId) => {
  const { rows } = await pool.query(`
    SELECT p.id, p.fecha, p.prestatario, p.cedula, p.telefono,
           p.nombre_producto, p.imei, p.cantidad_prestada,
           p.valor_prestamo, p.total_abonado, p.estado,
           (p.valor_prestamo - p.total_abonado) AS saldo_pendiente,
           u.nombre AS usuario_nombre
    FROM prestamos p
    LEFT JOIN usuarios u ON u.id = p.usuario_id
    WHERE p.sucursal_id = $1
    ORDER BY CASE p.estado WHEN 'Activo' THEN 0 WHEN 'Saldado' THEN 1 ELSE 2 END, p.fecha DESC
  `, [sucursalId]);
  return rows;
};

const findById = async (id) => {
  const { rows } = await pool.query('SELECT * FROM prestamos WHERE id = $1', [id]);
  return rows[0] || null;
};

const perteneceAlNegocio = async (id, negocioId) => {
  const { rows } = await pool.query(`
    SELECT p.id FROM prestamos p
    JOIN sucursales s ON s.id = p.sucursal_id
    WHERE p.id = $1 AND s.negocio_id = $2
  `, [id, negocioId]);
  return rows.length > 0;
};

const getAbonos = async (prestamoId) => {
  const { rows } = await pool.query(
    'SELECT * FROM abonos_prestamo WHERE prestamo_id = $1 ORDER BY fecha',
    [prestamoId]
  );
  return rows;
};

const create = async (client, { sucursal_id, usuario_id, prestatario, cedula, telefono, nombre_producto, imei, producto_id, cantidad_prestada, valor_prestamo }) => {
  const { rows } = await client.query(`
    INSERT INTO prestamos(sucursal_id, usuario_id, prestatario, cedula, telefono,
      nombre_producto, imei, producto_id, cantidad_prestada, valor_prestamo)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING *
  `, [sucursal_id, usuario_id, prestatario, cedula, telefono,
      nombre_producto, imei, producto_id, cantidad_prestada, valor_prestamo]);
  return rows[0];
};

const insertarAbono = async (client, { prestamo_id, valor }) => {
  await client.query(
    'INSERT INTO abonos_prestamo(prestamo_id, valor) VALUES ($1, $2)',
    [prestamo_id, valor]
  );
  const { rows } = await client.query(`
    UPDATE prestamos SET total_abonado = total_abonado + $1
    WHERE id = $2
    RETURNING valor_prestamo, total_abonado
  `, [valor, prestamo_id]);
  return rows[0];
};

const updateEstado = async (client, id, estado) => {
  await client.query('UPDATE prestamos SET estado = $1 WHERE id = $2', [estado, id]);
};

module.exports = { findAll, findById, perteneceAlNegocio, getAbonos, create, insertarAbono, updateEstado };