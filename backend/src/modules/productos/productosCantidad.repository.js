const { pool } = require('../../config/db');

const findAll = async (sucursalId) => {
  const { rows } = await pool.query(`
    SELECT pc.id, pc.nombre, pc.stock, pc.stock_minimo,
           pc.unidad_medida, pc.costo_unitario, pc.precio,
           pc.cliente_origen, pc.activo, pc.sucursal_id, pc.proveedor_id,
           p.nombre AS proveedor_nombre,
           CASE WHEN pc.stock <= pc.stock_minimo THEN true ELSE false END AS stock_bajo
    FROM productos_cantidad pc
    LEFT JOIN proveedores p ON p.id = pc.proveedor_id
    WHERE pc.sucursal_id = $1 AND pc.activo = true
    ORDER BY pc.nombre
  `, [sucursalId]);
  return rows;
};

const findById = async (id) => {
  const { rows } = await pool.query(`
    SELECT pc.*, p.nombre AS proveedor_nombre
    FROM productos_cantidad pc
    LEFT JOIN proveedores p ON p.id = pc.proveedor_id
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
    INSERT INTO productos_cantidad(nombre, stock, stock_minimo, unidad_medida, costo_unitario, precio, sucursal_id, proveedor_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `, [nombre, stock || 0, stock_minimo || 0, unidad_medida || 'unidad', costo_unitario || null, precio || null, sucursal_id, proveedor_id || null]);
  return rows[0];
};

const update = async (id, { nombre, stock_minimo, unidad_medida, costo_unitario, precio, proveedor_id }) => {
  const { rows } = await pool.query(`
    UPDATE productos_cantidad
    SET nombre = $1, stock_minimo = $2, unidad_medida = $3,
        costo_unitario = $4, precio = $5, proveedor_id = $6
    WHERE id = $7
    RETURNING *
  `, [nombre, stock_minimo, unidad_medida, costo_unitario || null, precio || null, proveedor_id || null, id]);
  return rows[0] || null;
};

const ajustarStock = async (id, cantidad, { costo_unitario, proveedor_id } = {}) => {
  const sets = ['stock = stock + $1'];
  const params = [cantidad, id];

  if (costo_unitario !== undefined && costo_unitario !== null) {
    sets.push(`costo_unitario = $${params.length + 1}`);
    params.splice(params.length - 1, 0, costo_unitario);
  }
  if (proveedor_id !== undefined && proveedor_id !== null) {
    sets.push(`proveedor_id = $${params.length + 1}`);
    params.splice(params.length - 1, 0, proveedor_id);
  }

  const { rows } = await pool.query(
    `UPDATE productos_cantidad SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
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

module.exports = { findAll, findById, perteneceAlNegocio, create, update, ajustarStock, eliminar };