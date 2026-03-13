const { pool } = require('../../config/db');

const findAll = async (sucursalId) => {
  const { rows } = await pool.query(`
    SELECT ps.id, ps.nombre, ps.marca, ps.modelo, ps.activo,
           ps.sucursal_id, ps.proveedor_id, ps.precio,
           p.nombre AS proveedor_nombre,
           COUNT(s.id) FILTER (WHERE s.vendido = false AND s.prestado = false) AS disponibles,
           COUNT(s.id) FILTER (WHERE s.vendido = true)  AS vendidos,
           COUNT(s.id) FILTER (WHERE s.prestado = true) AS prestados,
           COUNT(s.id) AS total
    FROM productos_serial ps
    LEFT JOIN seriales s ON s.producto_id = ps.id
    LEFT JOIN proveedores p ON p.id = ps.proveedor_id
    WHERE ps.sucursal_id = $1 AND ps.activo = true
    GROUP BY ps.id, p.nombre
    ORDER BY ps.nombre
  `, [sucursalId]);
  return rows;
};

const findById = async (id) => {
  const { rows } = await pool.query(`
    SELECT ps.*, p.nombre AS proveedor_nombre
    FROM productos_serial ps
    LEFT JOIN proveedores p ON p.id = ps.proveedor_id
    WHERE ps.id = $1
  `, [id]);
  return rows[0] || null;
};

const perteneceAlNegocio = async (id, negocioId) => {
  const { rows } = await pool.query(`
    SELECT ps.id FROM productos_serial ps
    JOIN sucursales s ON s.id = ps.sucursal_id
    WHERE ps.id = $1 AND s.negocio_id = $2
  `, [id, negocioId]);
  return rows.length > 0;
};

const create = async ({ nombre, marca, modelo, precio, sucursal_id, proveedor_id }) => {
  const { rows } = await pool.query(`
    INSERT INTO productos_serial(nombre, marca, modelo, precio, sucursal_id, proveedor_id)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [nombre, marca, modelo, precio || null, sucursal_id, proveedor_id || null]);
  return rows[0];
};

const update = async (id, { nombre, marca, modelo, precio, proveedor_id }) => {
  const { rows } = await pool.query(`
    UPDATE productos_serial
    SET nombre = $1, marca = $2, modelo = $3, precio = $4, proveedor_id = $5
    WHERE id = $6
    RETURNING *
  `, [nombre, marca, modelo, precio ?? null, proveedor_id || null, id]);
  return rows[0] || null;
};

const updatePrecio = async (id, precio) => {
  const { rows } = await pool.query(`
    UPDATE productos_serial
    SET precio = $1
    WHERE id = $2
    RETURNING *
  `, [precio ?? null, id]);
  return rows[0] || null;
};

const getSeriales = async (productoId, vendido = null) => {
  let query = `
    SELECT s.id, s.imei, s.fecha_entrada, s.vendido, s.fecha_salida,
           s.cliente_origen, s.prestado, s.costo_compra, s.proveedor_id,
           p.nombre AS proveedor_nombre
    FROM seriales s
    LEFT JOIN proveedores p ON p.id = s.proveedor_id
    WHERE s.producto_id = $1
  `;
  const params = [productoId];
  if (vendido !== null) {
    params.push(vendido);
    query += ` AND s.vendido = $2`;
  }
  query += ` ORDER BY s.vendido ASC, s.fecha_entrada ASC`;
  const { rows } = await pool.query(query, params);
  return rows;
};

const findSerialByIMEI = async (imei) => {
  const { rows } = await pool.query(
    'SELECT * FROM seriales WHERE imei = $1',
    [imei]
  );
  return rows[0] || null;
};

// proveedor_id es opcional — se guarda cuando se conoce el origen del serial
const insertarSerial = async ({ producto_id, imei, fecha_entrada, costo_compra, cliente_origen, proveedor_id }) => {
  const { rows } = await pool.query(`
    INSERT INTO seriales(producto_id, imei, fecha_entrada, costo_compra, cliente_origen, proveedor_id)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [producto_id, imei, fecha_entrada, costo_compra, cliente_origen || null, proveedor_id || null]);
  return rows[0];
};

const actualizarSerial = async (id, { imei, costo_compra }) => {
  const { rows } = await pool.query(`
    UPDATE seriales
    SET imei = $1, costo_compra = $2
    WHERE id = $3
    RETURNING *
  `, [imei, costo_compra ?? null, id]);
  return rows[0] || null;
};

const eliminarSerial = async (id) => {
  const { rowCount } = await pool.query(
    'DELETE FROM seriales WHERE id = $1',
    [id]
  );
  return rowCount > 0;
};
const findSerialByIMEIEnNegocio = async (imei, negocioId) => {
  const { rows } = await pool.query(`
    SELECT
      s.id,
      s.imei,
      s.vendido,
      s.prestado,
      s.fecha_entrada,
      s.fecha_salida,
      s.cliente_origen,
      ps.id   AS producto_id,
      ps.nombre AS producto_nombre,
      ps.marca,
      ps.modelo,
      su.id   AS sucursal_id,
      su.nombre AS sucursal_nombre
    FROM seriales s
    JOIN productos_serial ps ON ps.id = s.producto_id
    JOIN sucursales        su ON su.id = ps.sucursal_id
    WHERE s.imei = $1
      AND su.negocio_id = $2
    LIMIT 1
  `, [imei, negocioId]);
 
  return rows[0] || null;
};

module.exports = {
  findAll, findById, perteneceAlNegocio, create, update, updatePrecio,
  getSeriales, findSerialByIMEI, insertarSerial, actualizarSerial, eliminarSerial,findSerialByIMEIEnNegocio
};