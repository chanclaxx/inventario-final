const { pool } = require('../../config/db');
const { asignarNumeroDocumento } = require('../../utils/numeracion.util');

const findAll = async (sucursalId, negocioId, proveedorIds = null) => {
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

  if (proveedorIds && proveedorIds.length > 0) {
    conditions.push(`c.proveedor_id = ANY($${idx++}::int[])`);
    params.push(proveedorIds);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const { rows } = await pool.query(`
    SELECT
      c.id, c.numero, c.fecha, c.numero_factura, c.total, c.estado, c.notas,
      c.sucursal_id, su.nombre AS sucursal_nombre,
      p.nombre AS proveedor_nombre,
      u.nombre AS usuario_nombre
    FROM compras c
    JOIN  sucursales  su ON su.id = c.sucursal_id
    JOIN  proveedores p  ON p.id  = c.proveedor_id
    LEFT JOIN usuarios u ON u.id  = c.usuario_id
    ${where}
    ORDER BY c.fecha DESC
  `, params);
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
  const { rows } = await pool.query(`
    SELECT lc.*,
      va.valor   AS variante_valor,
      tva.nombre AS variante_tipo_nombre,
      ap.valor   AS atributo_valor,
      tap.nombre AS atributo_tipo_nombre
    FROM lineas_compra lc
    LEFT JOIN variantes_atributo  va  ON va.id  = lc.variante_id
    LEFT JOIN tipos_caracteristica tva ON tva.id = va.tipo_id
    LEFT JOIN atributos_producto  ap  ON ap.id  = lc.atributo_id
    LEFT JOIN tipos_caracteristica tap ON tap.id = ap.tipo_id
    WHERE lc.compra_id = $1
  `, [compraId]);
  return rows;
};

const findByProveedor = async (proveedorId, sucursalId, negocioId) => {
  const filtro = sucursalId ? 'c.sucursal_id = $2' : 'su.negocio_id = $2';
  const param  = sucursalId ?? negocioId;

  const { rows } = await pool.query(`
    SELECT
      c.id, c.numero, c.fecha, c.numero_factura, c.total, c.estado, c.notas,
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

// `orden_compra_id` es NULL en la compra suelta de siempre —que es el único
// flujo que existe con las órdenes apagadas— y apunta a la orden cuando la
// compra es en realidad una RECEPCIÓN contra ella.
const create = async (client, { sucursal_id, proveedor_id, usuario_id, numero_factura, total, notas, registrar_en_caja, metodo, orden_compra_id }) => {
  const { rows } = await client.query(`
    INSERT INTO compras(sucursal_id, proveedor_id, usuario_id, numero_factura, total, notas, registrar_en_caja, metodo, orden_compra_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `, [sucursal_id, proveedor_id, usuario_id, numero_factura, total, notas, registrar_en_caja !== false, metodo || null, orden_compra_id || null]);
  rows[0].numero = await asignarNumeroDocumento(client, {
    tipo: 'compra', docId: rows[0].id, sucursalId: sucursal_id,
  });
  return rows[0];
};

// `orden_linea_id` ata la línea recibida a la pedida: es lo que hace DERIVABLE
// el avance de la orden, sin ningún contador guardado que pueda desfasarse.
// `garantia_dias` congela el plazo del proveedor en el momento de la entrada.
const insertarLinea = async (client, {
  compra_id, nombre_producto, imei, cantidad, precio_unitario,
  precio_usd, factor_conversion, valor_traida, variante_id, atributo_id, producto_id,
  orden_linea_id, garantia_dias,
}) => {
  const { rows } = await client.query(`
    INSERT INTO lineas_compra(
      compra_id, nombre_producto, imei, cantidad, precio_unitario,
      precio_usd, factor_conversion, valor_traida, variante_id, atributo_id, producto_id,
      orden_linea_id, garantia_dias
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *
  `, [
    compra_id, nombre_producto, imei || null, cantidad, precio_unitario,
    precio_usd        || null,
    factor_conversion || null,
    valor_traida      || null,
    variante_id       || null,
    atributo_id       || null,
    producto_id       || null,
    orden_linea_id    || null,
    // ?? y no ||: una garantía de 0 días es "sin garantía", un dato válido que
    // no es lo mismo que "nadie lo registró" (NULL).
    garantia_dias     ?? null,
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

const findAllPaginado = async (sucursalId, negocioId, { page = 1, limit = 20, busqueda, fechaDesde, fechaHasta, metodo, estado, proveedorIds } = {}) => {
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

  if (proveedorIds && proveedorIds.length > 0) {
    conditions.push(`c.proveedor_id = ANY($${idx++}::int[])`);
    params.push(proveedorIds);
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
       c.id, c.numero, c.fecha, c.numero_factura, c.total, c.estado, c.notas,
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

const marcarCancelada = async (client, compraId) => {
  await client.query(
    `UPDATE compras SET estado = 'Cancelada' WHERE id = $1`,
    [compraId]
  );
};

module.exports = {
  findAll, findById, findByIdYNegocio,
  perteneceAlNegocio, findByProveedor,
  getLineas, create, insertarLinea,
  ajustarStockCantidad, actualizarCostoPromedio,
  findAllPaginado, marcarCancelada,
};