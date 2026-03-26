const { pool } = require('../../config/db');

// ── Subconsulta de proveedores reutilizable ───────────────────────────────────
//
// FIX: Se agrega filtro de negocio_id en ambas ramas de la UNION para evitar
// que se muestren proveedores de otros negocios que tengan el mismo IMEI
// o el mismo nombre de producto.
// Se resuelve via JOIN a sucursales de la propia factura (sin parámetro extra).

const _subqueryProveedores = (facturaAlias = 'f') => `
  (
    SELECT NULLIF(STRING_AGG(DISTINCT prov_nombre, ', ' ORDER BY prov_nombre), '')
    FROM (
      SELECT p.nombre AS prov_nombre
      FROM lineas_factura   lf2
      JOIN seriales         se  ON se.imei  = lf2.imei
      JOIN productos_serial ps  ON ps.id    = se.producto_id
      JOIN sucursales       su2 ON su2.id   = ps.sucursal_id
      JOIN proveedores      p   ON p.id     = se.proveedor_id
      WHERE lf2.factura_id = ${facturaAlias}.id
        AND lf2.imei IS NOT NULL
        AND se.proveedor_id IS NOT NULL
        AND su2.negocio_id = (SELECT negocio_id FROM sucursales WHERE id = ${facturaAlias}.sucursal_id)
      UNION
      SELECT p.nombre AS prov_nombre
      FROM lineas_factura    lf3
      JOIN productos_cantidad pc  ON pc.nombre ILIKE lf3.nombre_producto
                                 AND pc.sucursal_id = ${facturaAlias}.sucursal_id
      JOIN sucursales         su3 ON su3.id = pc.sucursal_id
      JOIN proveedores        p   ON p.id   = pc.proveedor_id
      WHERE lf3.factura_id = ${facturaAlias}.id
        AND lf3.imei IS NULL
        AND pc.proveedor_id IS NOT NULL
        AND su3.negocio_id = (SELECT negocio_id FROM sucursales WHERE id = ${facturaAlias}.sucursal_id)
    ) provs
  ) AS proveedor_nombre
`;

// ── Columnas SELECT compartidas ───────────────────────────────────────────────

const _selectColumnas = () => `
  f.id, f.fecha, f.nombre_cliente, f.cedula, f.celular,
  f.estado, f.notas, f.sucursal_id,
  su.nombre AS sucursal_nombre,
  u.nombre  AS usuario_nombre,
  COALESCE(SUM(l.subtotal), 0) AS total,
  COALESCE(
    (SELECT SUM(r.valor_retoma) FROM retomas r WHERE r.factura_id = f.id), 0
  ) AS total_retoma,
  STRING_AGG(DISTINCT l.nombre_producto, ', ') AS productos_nombres,
  STRING_AGG(DISTINCT l.imei,            ', ') AS productos_imeis,
  (SELECT ret.descripcion        FROM retomas ret WHERE ret.factura_id = f.id LIMIT 1) AS retoma_descripcion,
  (SELECT ret.imei               FROM retomas ret WHERE ret.factura_id = f.id LIMIT 1) AS retoma_imei,
  (SELECT ret.nombre_producto    FROM retomas ret WHERE ret.factura_id = f.id LIMIT 1) AS retoma_nombre_producto,
  (SELECT ret.ingreso_inventario FROM retomas ret WHERE ret.factura_id = f.id LIMIT 1) AS retoma_ingreso_inventario,
  (SELECT ret.valor_retoma       FROM retomas ret WHERE ret.factura_id = f.id LIMIT 1) AS retoma_valor,
  ${_subqueryProveedores('f')}
`;

const _fromJoins = () => `
  FROM facturas f
  JOIN      sucursales      su ON su.id = f.sucursal_id
  LEFT JOIN lineas_factura  l  ON l.factura_id = f.id
  LEFT JOIN usuarios        u  ON u.id = f.usuario_id
`;

// ── findAll original (se mantiene por compatibilidad) ─────────────────────────

const findAll = async (sucursalId, negocioId) => {
  const filtro = sucursalId ? 'f.sucursal_id = $1' : 'su.negocio_id = $1';
  const param  = sucursalId ?? negocioId;

  const { rows } = await pool.query(`
    SELECT ${_selectColumnas()}
    ${_fromJoins()}
    WHERE ${filtro}
    GROUP BY f.id, u.nombre, su.nombre
    ORDER BY f.fecha DESC
  `, [param]);
  return rows;
};

// ── findRecientes: últimos N días con cursor para scroll infinito ─────────────

const findRecientes = async (sucursalId, negocioId, { cursor, dias = 5 }) => {
  const filtroSucursal = sucursalId ? 'f.sucursal_id = $1' : 'su.negocio_id = $1';
  const param          = sucursalId ?? negocioId;

  const fechaHasta = cursor ? new Date(cursor) : new Date();
  const fechaDesde = new Date(fechaHasta);
  fechaDesde.setDate(fechaDesde.getDate() - dias);

  const { rows } = await pool.query(`
    SELECT ${_selectColumnas()}
    ${_fromJoins()}
    WHERE ${filtroSucursal}
      AND f.fecha >= $2 AND f.fecha < $3
    GROUP BY f.id, u.nombre, su.nombre
    ORDER BY f.fecha DESC
  `, [param, fechaDesde, fechaHasta]);

  const siguienteCursor = fechaDesde.toISOString();

  const { rows: hayMas } = await pool.query(`
    SELECT 1 FROM facturas f
    JOIN sucursales su ON su.id = f.sucursal_id
    WHERE ${filtroSucursal} AND f.fecha < $2
    LIMIT 1
  `, [param, fechaDesde]);

  return {
    items:           rows,
    siguienteCursor: hayMas.length > 0 ? siguienteCursor : null,
  };
};

// ── buscar: búsqueda de texto en TODA la historia con limit ───────────────────

const buscar = async (sucursalId, negocioId, { q, desde, hasta, limit = 100, offset = 0 }) => {
  const filtroSucursal = sucursalId ? 'f.sucursal_id = $1' : 'su.negocio_id = $1';
  const param          = sucursalId ?? negocioId;

  const condiciones = [filtroSucursal];
  const params      = [param];
  let paramIndex    = 2;

  if (q && q.trim()) {
    const textoSeguro = q.toLowerCase().replace(/[%_\\]/g, '\\$&').slice(0, 100);
    params.push(`%${textoSeguro}%`);
    condiciones.push(`(
      LOWER(f.nombre_cliente) LIKE $${paramIndex} ESCAPE '\\'
      OR f.cedula LIKE $${paramIndex} ESCAPE '\\'
      OR f.celular LIKE $${paramIndex} ESCAPE '\\'
      OR CAST(f.id AS TEXT) LIKE $${paramIndex} ESCAPE '\\'
      OR EXISTS (
        SELECT 1 FROM lineas_factura lf_s
        WHERE lf_s.factura_id = f.id
          AND (LOWER(lf_s.nombre_producto) LIKE $${paramIndex} ESCAPE '\\'
               OR LOWER(lf_s.imei) LIKE $${paramIndex} ESCAPE '\\')
      )
      OR EXISTS (
        SELECT 1 FROM retomas rt_s
        WHERE rt_s.factura_id = f.id
          AND (LOWER(rt_s.descripcion) LIKE $${paramIndex} ESCAPE '\\'
               OR LOWER(rt_s.nombre_producto) LIKE $${paramIndex} ESCAPE '\\'
               OR LOWER(rt_s.imei) LIKE $${paramIndex} ESCAPE '\\')
      )
    )`);
    paramIndex++;
  }

  if (desde) {
    params.push(desde);
    condiciones.push(`f.fecha >= $${paramIndex}::date`);
    paramIndex++;
  }

  if (hasta) {
    params.push(hasta);
    condiciones.push(`f.fecha < ($${paramIndex}::date + INTERVAL '1 day')`);
    paramIndex++;
  }

  params.push(limit, offset);

  const { rows } = await pool.query(`
    SELECT ${_selectColumnas()}
    ${_fromJoins()}
    WHERE ${condiciones.join(' AND ')}
    GROUP BY f.id, u.nombre, su.nombre
    ORDER BY f.fecha DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `, params);

  return rows;
};

// ── Resto de funciones ────────────────────────────────────────────────────────

// FIX: findById eliminada del export — era insegura (sin negocio_id).
// Toda consulta de detalle debe pasar por findByIdYNegocio.
// Se mantiene internamente por si algún módulo interno la necesita con cuidado,
// pero NO se exporta.
const _findById = async (id) => {
  const { rows } = await pool.query(`
    SELECT
      f.*,
      u.nombre  AS usuario_nombre,
      su.nombre AS sucursal_nombre,
      c.email     AS cliente_email,
      c.direccion AS cliente_direccion,
      ${_subqueryProveedores('f')}
    FROM facturas f
    LEFT JOIN usuarios   u  ON u.id  = f.usuario_id
    JOIN      sucursales su ON su.id = f.sucursal_id
    LEFT JOIN clientes   c  ON c.id  = f.cliente_id
    WHERE f.id = $1
  `, [id]);
  return rows[0] || null;
};

const perteneceAlNegocio = async (id, negocioId) => {
  const { rows } = await pool.query(`
    SELECT f.id FROM facturas f
    JOIN sucursales s ON s.id = f.sucursal_id
    WHERE f.id = $1 AND s.negocio_id = $2
  `, [id, negocioId]);
  return rows.length > 0;
};

// FIX: negocioId es ahora obligatorio para filtrar proveedores al negocio correcto.
const getLineas = async (facturaId, negocioId) => {
  const { rows } = await pool.query(`
    SELECT
      lf.*,
      COALESCE(
        (
          SELECT p.nombre
          FROM seriales         se
          JOIN productos_serial ps ON ps.id  = se.producto_id
          JOIN sucursales       su ON su.id  = ps.sucursal_id
          JOIN proveedores      p  ON p.id   = se.proveedor_id
          WHERE se.imei = lf.imei
            AND lf.imei IS NOT NULL
            AND se.proveedor_id IS NOT NULL
            AND su.negocio_id = $2
          LIMIT 1
        ),
        (
          SELECT p.nombre
          FROM productos_cantidad pc
          JOIN sucursales         su ON su.id = pc.sucursal_id
          JOIN proveedores        p  ON p.id  = pc.proveedor_id
          JOIN facturas           f  ON f.id  = lf.factura_id
          WHERE pc.nombre ILIKE lf.nombre_producto
            AND pc.sucursal_id = f.sucursal_id
            AND lf.imei IS NULL
            AND pc.proveedor_id IS NOT NULL
            AND su.negocio_id = $2
          LIMIT 1
        )
      ) AS proveedor_nombre
    FROM lineas_factura lf
    WHERE lf.factura_id = $1
    ORDER BY lf.id
  `, [facturaId, negocioId]);
  return rows;
};

const getPagos = async (facturaId) => {
  const { rows } = await pool.query(
    'SELECT * FROM pagos_factura WHERE factura_id = $1',
    [facturaId]
  );
  return rows;
};

const getRetomas = async (facturaId) => {
  const { rows } = await pool.query(`
    SELECT id, factura_id, descripcion, valor_retoma,
           ingreso_inventario, nombre_producto, imei, cantidad_retoma
    FROM retomas WHERE factura_id = $1
    ORDER BY id
  `, [facturaId]);
  return rows;
};

const create = async (client, {
  sucursal_id, usuario_id, cliente_id,
  nombre_cliente, cedula, celular, notas, estado,
}) => {
  const { rows } = await client.query(`
    INSERT INTO facturas(sucursal_id, usuario_id, cliente_id, nombre_cliente, cedula, celular, notas, estado)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `, [sucursal_id, usuario_id, cliente_id, nombre_cliente, cedula, celular, notas, estado || 'Activa']);
  return rows[0];
};

const insertarLinea = async (client, { factura_id, nombre_producto, imei, cantidad, precio, producto_id }) => {
  const { rows } = await client.query(`
    INSERT INTO lineas_factura(factura_id, nombre_producto, imei, cantidad, precio, producto_id)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [factura_id, nombre_producto, imei || null, cantidad, precio, producto_id || null]);
  return rows[0];
};

const insertarPago = async (client, { factura_id, metodo, valor }) => {
  const { rows } = await client.query(`
    INSERT INTO pagos_factura(factura_id, metodo, valor)
    VALUES ($1, $2, $3)
    RETURNING *
  `, [factura_id, metodo, valor]);
  return rows[0];
};

const insertarRetoma = async (client, {
  factura_id, descripcion, valor_retoma,
  ingreso_inventario, nombre_producto, imei, cantidad_retoma,
}) => {
  const { rows } = await client.query(`
    INSERT INTO retomas(factura_id, descripcion, valor_retoma, ingreso_inventario, nombre_producto, imei, cantidad_retoma)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `, [
    factura_id, descripcion, valor_retoma,
    ingreso_inventario || false,
    nombre_producto    || null,
    imei               || null,
    Number(cantidad_retoma) || 1,
  ]);
  return rows[0];
};

const cancelar = async (client, id) => {
  await client.query(
    "UPDATE facturas SET estado = 'Cancelada' WHERE id = $1",
    [id]
  );
};

const findByIdYNegocio = async (id, negocioId) => {
  const { rows } = await pool.query(`
    SELECT
      f.*,
      u.nombre  AS usuario_nombre,
      su.nombre AS sucursal_nombre,
      c.email     AS cliente_email,
      c.direccion AS cliente_direccion,
      ${_subqueryProveedores('f')}
    FROM facturas f
    LEFT JOIN usuarios   u  ON u.id  = f.usuario_id
    JOIN      sucursales su ON su.id = f.sucursal_id
    LEFT JOIN clientes   c  ON c.id  = f.cliente_id
    WHERE f.id = $1 AND su.negocio_id = $2
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

module.exports = {
  findAll, findRecientes, buscar,
  // findById ya NO se exporta — usar findByIdYNegocio siempre
  findByIdYNegocio,
  perteneceAlNegocio,
  getLineas, getPagos, getRetomas,
  create, insertarLinea, insertarPago, insertarRetoma, cancelar,
  ajustarStockCantidad, actualizarCostoPromedio,
};