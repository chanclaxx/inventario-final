const { pool } = require('../../config/db');

// ── Productos ─────────────────────────────────────────────────────────────────

const findAll = async (sucursalId) => {
  const { rows } = await pool.query(`
    SELECT
      ps.id,
      ps.nombre,
      ps.marca,
      ps.modelo,
      ps.precio,
      ps.sucursal_id,
      ps.proveedor_id,
      ps.ultimo_costo,
      COUNT(s.id) FILTER (WHERE s.vendido = false AND s.prestado = false) AS disponibles
    FROM productos_serial ps
    LEFT JOIN seriales s ON s.producto_id = ps.id
    WHERE ps.sucursal_id = $1
    GROUP BY ps.id
    ORDER BY ps.nombre ASC
  `, [sucursalId]);
  return rows;
};

const findById = async (id) => {
  const { rows } = await pool.query(
    'SELECT * FROM productos_serial WHERE id = $1',
    [id]
  );
  return rows[0] || null;
};

const perteneceAlNegocio = async (productoId, negocioId) => {
  const { rows } = await pool.query(`
    SELECT ps.id FROM productos_serial ps
    JOIN sucursales s ON s.id = ps.sucursal_id
    WHERE ps.id = $1 AND s.negocio_id = $2
  `, [productoId, negocioId]);
  return rows.length > 0;
};

const create = async ({ nombre, marca, modelo, precio, sucursal_id, proveedor_id }) => {
  const { rows } = await pool.query(`
    INSERT INTO productos_serial(nombre, marca, modelo, precio, sucursal_id, proveedor_id)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [nombre, marca || null, modelo || null, precio, sucursal_id, proveedor_id || null]);
  return rows[0];
};

const update = async (id, datos) => {
  const { rows } = await pool.query(`
    UPDATE productos_serial
    SET nombre       = COALESCE($1, nombre),
        marca        = COALESCE($2, marca),
        modelo       = COALESCE($3, modelo),
        precio       = COALESCE($4, precio),
        proveedor_id = COALESCE($5, proveedor_id)
    WHERE id = $6
    RETURNING *
  `, [datos.nombre, datos.marca, datos.modelo, datos.precio, datos.proveedor_id, id]);
  return rows[0] || null;
};

const updatePrecio = async (productoId, precio) => {
  await pool.query(
    'UPDATE productos_serial SET precio = $1 WHERE id = $2',
    [precio, productoId]
  );
};

// ── Seriales ──────────────────────────────────────────────────────────────────

const getSeriales = async (productoId, vendido) => {
  const condicion = vendido === null
    ? ''
    : `AND s.vendido = ${vendido}`;

  const { rows } = await pool.query(`
    SELECT s.*, c.nombre AS cliente_nombre
    FROM seriales s
    LEFT JOIN clientes c ON c.id = s.cliente_id
    WHERE s.producto_id = $1 ${condicion}
    ORDER BY s.fecha_entrada DESC
  `, [productoId]);
  return rows;
};

const findSerialByIMEI = async (imei) => {
  const { rows } = await pool.query(
    'SELECT id FROM seriales WHERE imei = $1',
    [imei]
  );
  return rows[0] || null;
};

/**
 * Busca un serial por IMEI dentro de cualquier sucursal del negocio.
 * Retorna el serial con datos del producto y sucursal, o null si no existe.
 */
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
      ps.id     AS producto_id,
      ps.nombre AS producto_nombre,
      ps.marca,
      ps.modelo,
      su.id     AS sucursal_id,
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

const insertarSerial = async ({ producto_id, imei, fecha_entrada, costo_compra, cliente_origen, proveedor_id }) => {
  const { rows } = await pool.query(`
    INSERT INTO seriales(producto_id, imei, fecha_entrada, costo_compra, cliente_origen, proveedor_id)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [producto_id, imei, fecha_entrada, costo_compra ?? null, cliente_origen || null, proveedor_id || null]);
  return rows[0];
};

/**
 * Reactiva un serial existente marcándolo como disponible nuevamente.
 * Usado cuando el usuario confirma reactivar un IMEI duplicado.
 * Actualiza costo_compra y proveedor_id solo si se proporcionan.
 */
const reactivarSerial = async (serialId, { costo_compra, proveedor_id } = {}) => {
  const { rows } = await pool.query(`
    UPDATE seriales
    SET vendido      = false,
        prestado     = false,
        fecha_salida = NULL,
        costo_compra = COALESCE($1, costo_compra),
        proveedor_id = COALESCE($2, proveedor_id)
    WHERE id = $3
    RETURNING *
  `, [costo_compra ?? null, proveedor_id || null, serialId]);

  if (!rows[0]) throw { status: 404, message: 'Serial no encontrado para reactivar' };
  return rows[0];
};

const actualizarSerial = async (serialId, { imei, costo_compra }) => {
  const { rows } = await pool.query(`
    UPDATE seriales
    SET imei         = COALESCE($1, imei),
        costo_compra = COALESCE($2, costo_compra)
    WHERE id = $3
    RETURNING *
  `, [imei || null, costo_compra ?? null, serialId]);
  return rows[0] || null;
};

const eliminarSerial = async (serialId) => {
  const { rows } = await pool.query(
    'DELETE FROM seriales WHERE id = $1 RETURNING id',
    [serialId]
  );
  return rows[0] || null;
};

module.exports = {
  // Productos
  findAll, findById, perteneceAlNegocio, create, update, updatePrecio,
  // Seriales
  getSeriales, findSerialByIMEI, findSerialByIMEIEnNegocio,
  insertarSerial, reactivarSerial, actualizarSerial, eliminarSerial,
};