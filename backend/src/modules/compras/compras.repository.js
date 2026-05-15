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

const findByProveedor = async (proveedorId, sucursalId, negocioId) => {
  const filtro = sucursalId ? 'c.sucursal_id = $2' : 'su.negocio_id = $2';
  const param  = sucursalId ?? negocioId;

  const { rows } = await pool.query(`
    SELECT
      c.id, c.fecha, c.numero_factura, c.total, c.estado, c.notas,
      c.metodo, c.registrar_en_caja,
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

const create = async (client, { sucursal_id, proveedor_id, usuario_id, numero_factura, total, notas, registrar_en_caja, metodo }) => {
  const { rows } = await client.query(`
    INSERT INTO compras(sucursal_id, proveedor_id, usuario_id, numero_factura, total, notas, registrar_en_caja, metodo)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `, [sucursal_id, proveedor_id, usuario_id, numero_factura, total, notas, registrar_en_caja !== false, metodo || null]);
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

const findByIdYNegocio = async (id, negocioId) => {
  const { rows } = await pool.query(`
    SELECT c.*, p.nombre AS proveedor_nombre,
           u.nombre AS usuario_nombre, su.nombre AS sucursal_nombre
    FROM compras c
    JOIN  sucursales  su ON su.id = c.sucursal_id
    JOIN  proveedores p  ON p.id  = c.proveedor_id
    LEFT JOIN usuarios u ON u.id  = c.usuario_id
    WHERE c.id = $1 AND su.negocio_id = $2
  `, [id, negocioId]);
  return rows[0] || null;
};

const ajustarStockCantidad = async (client, productoId, cantidad) => {
  await client.query(
    'UPDATE productos_cantidad SET stock = stock + $1 WHERE id = $2',
    [cantidad, productoId]
  );
};

const actualizarCostoPromedio = async (client, productoId, costoPromedio) => {
  await client.query(
    'UPDATE productos_cantidad SET costo_unitario = $1 WHERE id = $2',
    [costoPromedio, productoId]
  );
};

const findAllPaginado = async (sucursalId, negocioId, { page = 1, limit = 20, busqueda, fechaDesde, fechaHasta, metodo, estado } = {}) => {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (sucursalId) {
    conditions.push(`c.sucursal_id = $${idx++}`);
    params.push(sucursalId);
  } else {
    conditions.push(`su.negocio_id = $${idx++}`);
    params.push(negocioId);
  }

  if (busqueda) {
    conditions.push(`(p.nombre ILIKE $${idx} OR c.numero_factura ILIKE $${idx})`);
    params.push(`%${busqueda}%`);
    idx++;
  }
  if (fechaDesde) {
    conditions.push(`c.fecha::date >= $${idx++}::date`);
    params.push(fechaDesde);
  }
  if (fechaHasta) {
    conditions.push(`c.fecha::date <= $${idx++}::date`);
    params.push(fechaHasta);
  }
  if (metodo) {
    conditions.push(`c.metodo = $${idx++}`);
    params.push(metodo);
  }
  if (estado) {
    conditions.push(`c.estado = $${idx++}`);
    params.push(estado);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRes = await pool.query(
    `SELECT COUNT(DISTINCT c.id) AS total
     FROM compras c
     JOIN sucursales su ON su.id = c.sucursal_id
     JOIN proveedores p  ON p.id  = c.proveedor_id
     ${where}`,
    params
  );
  const total = parseInt(countRes.rows[0].total, 10);

  const offset = (page - 1) * limit;
  const dataParams = [...params, limit, offset];

  const { rows } = await pool.query(
    `SELECT
       c.id, c.fecha, c.numero_factura, c.total, c.estado, c.notas,
       c.metodo, c.registrar_en_caja,
       c.sucursal_id, su.nombre AS sucursal_nombre,
       p.id AS proveedor_id, p.nombre AS proveedor_nombre, p.tipo AS proveedor_tipo,
       u.nombre AS usuario_nombre,
       COUNT(lc.id) AS num_lineas
     FROM compras c
     JOIN sucursales su ON su.id = c.sucursal_id
     JOIN proveedores p  ON p.id  = c.proveedor_id
     LEFT JOIN usuarios u   ON u.id  = c.usuario_id
     LEFT JOIN lineas_compra lc ON lc.compra_id = c.id
     ${where}
     GROUP BY c.id, su.nombre, p.id, p.nombre, p.tipo, u.nombre
     ORDER BY c.fecha DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    dataParams
  );

  return { rows, total, page, limit, totalPages: Math.ceil(total / limit) };
};

module.exports = {
  findAll, findById, findByIdYNegocio,
  perteneceAlNegocio, findByProveedor,
  getLineas, create, insertarLinea,
  ajustarStockCantidad, actualizarCostoPromedio,
  findAllPaginado,
};