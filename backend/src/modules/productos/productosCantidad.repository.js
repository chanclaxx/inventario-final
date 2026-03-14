const { pool } = require('../../config/db');

/**
 * Vista sucursal: filtra por sucursal_id
 * Vista global:   agrupa por nombre con SUM(stock), expandible por sucursal
 */
const findAll = async (sucursalId, negocioId) => {
  if (sucursalId) {
    const { rows } = await pool.query(`
      SELECT
        pc.id, pc.nombre, pc.stock, pc.stock_minimo,
        pc.unidad_medida, pc.costo_unitario, pc.precio,
        pc.cliente_origen, pc.activo, pc.sucursal_id, pc.proveedor_id,
        p.nombre AS proveedor_nombre,
        su.nombre AS sucursal_nombre,
        CASE WHEN pc.stock <= pc.stock_minimo THEN true ELSE false END AS stock_bajo
      FROM productos_cantidad pc
      LEFT JOIN proveedores p  ON p.id  = pc.proveedor_id
      JOIN  sucursales      su ON su.id = pc.sucursal_id
      WHERE pc.sucursal_id = $1 AND pc.activo = true
      ORDER BY pc.nombre
    `, [sucursalId]);
    return { modo: 'sucursal', items: rows };
  }

  // Vista global: stock consolidado agrupado por nombre + detalle por sucursal
  const { rows } = await pool.query(`
    SELECT
      pc.nombre,
      SUM(pc.stock)                                                        AS stock_total,
      BOOL_OR(pc.stock <= pc.stock_minimo)                                 AS stock_bajo,
      JSON_AGG(
        JSON_BUILD_OBJECT(
          'id',             pc.id,
          'sucursal_id',    pc.sucursal_id,
          'sucursal_nombre',su.nombre,
          'stock',          pc.stock,
          'stock_minimo',   pc.stock_minimo,
          'costo_unitario', pc.costo_unitario,
          'precio',         pc.precio,
          'proveedor_id',   pc.proveedor_id,
          'proveedor_nombre', p.nombre,
          'stock_bajo',     pc.stock <= pc.stock_minimo
        ) ORDER BY su.nombre
      ) AS sucursales
    FROM productos_cantidad pc
    JOIN  sucursales su ON su.id = pc.sucursal_id
    LEFT JOIN proveedores p ON p.id = pc.proveedor_id
    WHERE su.negocio_id = $1 AND pc.activo = true
    GROUP BY pc.nombre
    ORDER BY pc.nombre
  `, [negocioId]);
  return { modo: 'global', items: rows };
};

const findById = async (id) => {
  const { rows } = await pool.query(`
    SELECT pc.*, p.nombre AS proveedor_nombre, su.nombre AS sucursal_nombre
    FROM productos_cantidad pc
    LEFT JOIN proveedores p  ON p.id  = pc.proveedor_id
    JOIN  sucursales      su ON su.id = pc.sucursal_id
    WHERE pc.id = $1
  `, [id]);
  return rows[0] || null;
};

const perteneceAlNegocio = async (id, negocioId) => {
  const { rows } = await pool.query(`
    SELECT pc.id FROM productos_cantidad pc
    JOIN sucursales s ON s.id = pc.sucursal_id
    WHERE pc.id = $1 AND s.negocio_id = $2
  `, [id, negocioId]);
  return rows.length > 0;
};

const create = async ({ nombre, stock, stock_minimo, unidad_medida, costo_unitario, precio, sucursal_id, proveedor_id }) => {
  const { rows } = await pool.query(`
    INSERT INTO productos_cantidad
      (nombre, stock, stock_minimo, unidad_medida, costo_unitario, precio, sucursal_id, proveedor_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `, [nombre, stock || 0, stock_minimo || 0, unidad_medida || 'unidad',
      costo_unitario || null, precio || null, sucursal_id, proveedor_id || null]);
  return rows[0];
};

const update = async (id, { nombre, stock_minimo, unidad_medida, costo_unitario, precio, proveedor_id }) => {
  const { rows } = await pool.query(`
    UPDATE productos_cantidad
    SET nombre         = $1,
        stock_minimo   = $2,
        unidad_medida  = $3,
        costo_unitario = $4,
        precio         = $5,
        proveedor_id   = $6
    WHERE id = $7
    RETURNING *
  `, [nombre, stock_minimo, unidad_medida, costo_unitario || null, precio || null, proveedor_id || null, id]);
  return rows[0] || null;
};

const ajustarStock = async (id, cantidad, { costo_unitario, proveedor_id, cliente_origen } = {}) => {
  const sets   = ["stock = stock + $1"];
  const params = [cantidad, id];
 
  if (costo_unitario != null) {
    sets.push(`costo_unitario = $${params.length}`);
    params.splice(params.length - 1, 0, costo_unitario);
  }
  if (proveedor_id != null) {
    sets.push(`proveedor_id = $${params.length}`);
    params.splice(params.length - 1, 0, proveedor_id);
  }
  if (cliente_origen != null) {
    sets.push(`cliente_origen = $${params.length}`);
    params.splice(params.length - 1, 0, cliente_origen);
  }
 
  const { rows } = await pool.query(
    `UPDATE productos_cantidad SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params
  );
  return rows[0] || null;
};

const eliminar = async (id) => {
  const { rowCount } = await pool.query(
    'UPDATE productos_cantidad SET activo = false WHERE id = $1',
    [id]
  );
  return rowCount > 0;
};
const insertarHistorial = async ({
  producto_id, sucursal_id, cantidad, costo_unitario,
  tipo, cliente_origen, cedula_cliente, proveedor_id, notas,
}) => {
  await pool.query(`
    INSERT INTO historial_stock_cantidad
      (producto_id, sucursal_id, cantidad, costo_unitario,
       tipo, cliente_origen, cedula_cliente, proveedor_id, notas)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
  `, [
    producto_id, sucursal_id, cantidad,
    costo_unitario ?? null,
    tipo || 'ajuste',
    cliente_origen || null,
    cedula_cliente || null,
    proveedor_id   || null,
    notas          || null,
  ]);
};
const findByIdYNegocio = async (id, negocioId) => {
  const { rows } = await pool.query(`
    SELECT pc.*, p.nombre AS proveedor_nombre, su.nombre AS sucursal_nombre
    FROM productos_cantidad pc
    LEFT JOIN proveedores p  ON p.id  = pc.proveedor_id
    JOIN  sucursales      su ON su.id = pc.sucursal_id
    WHERE pc.id = $1 AND su.negocio_id = $2
  `, [id, negocioId]);
  return rows[0] || null;
};

 
const getHistorialStock = async (negocioId, q) => {
  // ── Escapar wildcards ──────────────────────────────────────────
  const filtro = q
    ? `%${q.toLowerCase().replace(/[%_\\]/g, '\\$&').slice(0, 100)}%`
    : '%';

  const { rows } = await pool.query(`
    SELECT
      h.id, h.cantidad, h.costo_unitario, h.tipo,
      h.cliente_origen, h.cedula_cliente,
      h.creado_en AS fecha,
      pc.nombre   AS nombre_producto,
      pc.unidad_medida,
      su.nombre   AS sucursal_nombre,
      p.nombre    AS proveedor_nombre
    FROM historial_stock_cantidad h
    JOIN productos_cantidad pc ON pc.id = h.producto_id
    JOIN sucursales         su ON su.id = h.sucursal_id
    LEFT JOIN proveedores   p  ON p.id  = h.proveedor_id
    WHERE su.negocio_id = $1
      AND (
        LOWER(COALESCE(h.cliente_origen,  '')) LIKE $2 ESCAPE '\\'
        OR LOWER(COALESCE(h.cedula_cliente,'')) LIKE $2 ESCAPE '\\'
        OR LOWER(pc.nombre)                    LIKE $2 ESCAPE '\\'
        OR LOWER(h.tipo)                       LIKE $2 ESCAPE '\\'
      )
    ORDER BY h.creado_en DESC
    LIMIT 200
  `, [negocioId, filtro]);
  return rows;
};

module.exports = {
  findAll, findById, findByIdYNegocio,
  perteneceAlNegocio,
  create, update, ajustarStock, eliminar,
  insertarHistorial, getHistorialStock,
};