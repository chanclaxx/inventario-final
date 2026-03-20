const { pool } = require('../../config/db');

const findAll = async (sucursalId, negocioId) => {
  const filtro = sucursalId ? 'p.sucursal_id = $1' : 'su.negocio_id = $1';
  const param  = sucursalId ?? negocioId;

  const { rows } = await pool.query(`
    SELECT
      p.id, p.fecha, p.prestatario, p.cedula, p.telefono,
      p.nombre_producto, p.imei, p.cantidad_prestada,
      p.valor_prestamo, p.total_abonado, p.estado,
      p.prestatario_id, p.empleado_id, p.cliente_id, p.sucursal_id,
      su.nombre AS sucursal_nombre,
      (p.valor_prestamo - p.total_abonado) AS saldo_pendiente,
      u.nombre  AS usuario_nombre,
      pr.nombre AS prestatario_nombre,
      e.nombre  AS empleado_nombre,
      c.nombre  AS cliente_nombre
    FROM prestamos p
    JOIN  sucursales            su ON su.id = p.sucursal_id
    LEFT JOIN usuarios          u  ON u.id  = p.usuario_id
    LEFT JOIN prestatarios      pr ON pr.id = p.prestatario_id
    LEFT JOIN empleados_prestatario e ON e.id = p.empleado_id
    LEFT JOIN clientes          c  ON c.id  = p.cliente_id
    WHERE ${filtro}
    ORDER BY
      CASE p.estado WHEN 'Activo' THEN 0 WHEN 'Saldado' THEN 1 ELSE 2 END,
      p.fecha DESC
  `, [param]);
  return rows;
};

const findById = async (id) => {
  const { rows } = await pool.query(`
    SELECT p.*, su.nombre AS sucursal_nombre
    FROM prestamos  p
    JOIN sucursales su ON su.id = p.sucursal_id
    WHERE p.id = $1
  `, [id]);
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

const create = async (client, {
  sucursal_id, usuario_id, prestatario, cedula, telefono,
  nombre_producto, imei, producto_id, cantidad_prestada, valor_prestamo,
  prestatario_id, empleado_id, cliente_id,
}) => {
  const { rows } = await client.query(`
    INSERT INTO prestamos(
      sucursal_id, usuario_id, prestatario, cedula, telefono,
      nombre_producto, imei, producto_id, cantidad_prestada, valor_prestamo,
      prestatario_id, empleado_id, cliente_id
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING *
  `, [
    sucursal_id, usuario_id, prestatario, cedula, telefono,
    nombre_producto, imei, producto_id, cantidad_prestada, valor_prestamo,
    prestatario_id || null, empleado_id || null, cliente_id || null,
  ]);
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

const findByIdYNegocio = async (id, negocioId) => {
  const { rows } = await pool.query(`
    SELECT p.*, su.nombre AS sucursal_nombre
    FROM prestamos  p
    JOIN sucursales su ON su.id = p.sucursal_id
    WHERE p.id = $1 AND su.negocio_id = $2
  `, [id, negocioId]);
  return rows[0] || null;
};

// Agregar también para usar dentro de transacciones
const ajustarStock = async (client, productoId, cantidad) => {
  await client.query(
    'UPDATE productos_cantidad SET stock = stock + $1 WHERE id = $2',
    [cantidad, productoId]
  );
};
const actualizarCantidadYValor = async (client, id, nuevaCantidad, nuevoValor) => {
  await client.query(
    `UPDATE prestamos
     SET cantidad_prestada = $1,
         valor_prestamo    = $2
     WHERE id = $3`,
    [nuevaCantidad, nuevoValor, id]
  );
};

module.exports = {
  findAll, findById, findByIdYNegocio,
  perteneceAlNegocio,
  getAbonos, create, insertarAbono, updateEstado, ajustarStock,
};