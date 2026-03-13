const { pool } = require('../../config/db');

const findAll = async (sucursalId, negocioId) => {
  const filtro = sucursalId ? 'c.sucursal_id = $1' : 'su.negocio_id = $1';
  const param  = sucursalId ?? negocioId;

  const { rows } = await pool.query(`
    SELECT
      c.id, c.fecha, c.numero_factura, c.total, c.estado, c.notas,
      c.sucursal_id, su.nombre AS sucursal_nombre,
      p.nombre AS proveedor_nombre,
      u.nombre AS usuario_nombre
    FROM compras c
    JOIN  sucursales  su ON su.id = c.sucursal_id
    JOIN  proveedores p  ON p.id  = c.proveedor_id
    LEFT JOIN usuarios u ON u.id  = c.usuario_id
    WHERE ${filtro}
    ORDER BY c.fecha DESC
  `, [param]);
  return rows;
};

const findById = async (id) => {
  const { rows } = await pool.query(`
    SELECT c.*, p.nombre AS proveedor_nombre,
           u.nombre AS usuario_nombre, su.nombre AS sucursal_nombre
    FROM compras c
    JOIN  sucursales  su ON su.id = c.sucursal_id
    JOIN  proveedores p  ON p.id  = c.proveedor_id
    LEFT JOIN usuarios u ON u.id  = c.usuario_id
    WHERE c.id = $1
  `, [id]);
  return rows[0] || null;
};

const perteneceAlNegocio = async (id, negocioId) => {
  const { rows } = await pool.query(`
    SELECT c.id FROM compras c
    JOIN sucursales s ON s.id = c.sucursal_id
    WHERE c.id = $1 AND s.negocio_id = $2
  `, [id, negocioId]);
  return rows.length > 0;
};

const getLineas = async (compraId) => {
  const { rows } = await pool.query(
    'SELECT * FROM lineas_compra WHERE compra_id = $1',
    [compraId]
  );
  return rows;
};

// Vista global: filtra por negocio a través del proveedor (que es del negocio)
const findByProveedor = async (proveedorId, sucursalId, negocioId) => {
  const filtro = sucursalId ? 'c.sucursal_id = $2' : 'su.negocio_id = $2';
  const param  = sucursalId ?? negocioId;

  const { rows } = await pool.query(`
    SELECT
      c.id, c.fecha, c.numero_factura, c.total, c.estado, c.notas,
      c.sucursal_id, su.nombre AS sucursal_nombre,
      u.nombre AS usuario_nombre
    FROM compras c
    JOIN  sucursales  su ON su.id = c.sucursal_id
    LEFT JOIN usuarios u ON u.id  = c.usuario_id
    WHERE c.proveedor_id = $1 AND ${filtro}
    ORDER BY c.fecha DESC
  `, [proveedorId, param]);
  return rows;
};

const create = async (client, { sucursal_id, proveedor_id, usuario_id, numero_factura, total, notas }) => {
  const { rows } = await client.query(`
    INSERT INTO compras(sucursal_id, proveedor_id, usuario_id, numero_factura, total, notas)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [sucursal_id, proveedor_id, usuario_id, numero_factura, total, notas]);
  return rows[0];
};

const insertarLinea = async (client, {
  compra_id, nombre_producto, imei, cantidad, precio_unitario,
  precio_usd, factor_conversion, valor_traida,
}) => {
  const { rows } = await client.query(`
    INSERT INTO lineas_compra(
      compra_id, nombre_producto, imei, cantidad, precio_unitario,
      precio_usd, factor_conversion, valor_traida
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `, [
    compra_id, nombre_producto, imei || null, cantidad, precio_unitario,
    precio_usd        || null,
    factor_conversion || null,
    valor_traida      || null,
  ]);
  return rows[0];
};

module.exports = {
  findAll, findById, perteneceAlNegocio,
  findByProveedor, getLineas, create, insertarLinea,
};