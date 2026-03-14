const { pool } = require('../../config/db');

// ── Subconsulta de proveedores reutilizable ───────────────────────────────────

const _subqueryProveedores = (facturaAlias = 'f') => `
  (
    SELECT NULLIF(STRING_AGG(DISTINCT prov_nombre, ', ' ORDER BY prov_nombre), '')
    FROM (
      SELECT p.nombre AS prov_nombre
      FROM lineas_factura lf2
      JOIN seriales    se ON se.imei = lf2.imei
      JOIN proveedores p  ON p.id = se.proveedor_id
      WHERE lf2.factura_id = ${facturaAlias}.id
        AND lf2.imei IS NOT NULL
        AND se.proveedor_id IS NOT NULL
      UNION
      SELECT p.nombre AS prov_nombre
      FROM lineas_factura    lf3
      JOIN productos_cantidad pc ON pc.nombre ILIKE lf3.nombre_producto
                                AND pc.sucursal_id = ${facturaAlias}.sucursal_id
      JOIN proveedores        p  ON p.id = pc.proveedor_id
      WHERE lf3.factura_id = ${facturaAlias}.id
        AND lf3.imei IS NULL
        AND pc.proveedor_id IS NOT NULL
    ) provs
  ) AS proveedor_nombre
`;

// ── findAll ───────────────────────────────────────────────────────────────────
// Vista sucursal : filtra por sucursal_id
// Vista global   : todas las sucursales del negocio, incluye sucursal_nombre
// No necesita email/dirección — es la vista de lista, no de detalle

const findAll = async (sucursalId, negocioId) => {
  const filtro = sucursalId
    ? 'f.sucursal_id = $1'
    : 'su.negocio_id = $1';

  const param = sucursalId ?? negocioId;

  const { rows } = await pool.query(`
    SELECT
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
    FROM facturas f
    JOIN      sucursales      su ON su.id = f.sucursal_id
    LEFT JOIN lineas_factura  l  ON l.factura_id = f.id
    LEFT JOIN usuarios        u  ON u.id = f.usuario_id
    WHERE ${filtro}
    GROUP BY f.id, u.nombre, su.nombre
    ORDER BY f.fecha DESC
  `, [param]);
  return rows;
};

// ── findById ──────────────────────────────────────────────────────────────────
// Trae email y direccion desde la tabla clientes cuando existe cliente_id.
// Facturas antiguas (cliente_id = null) usan los campos propios de facturas
// para nombre_cliente, cedula y celular — que ya están en f.* — y retornan
// null en email y direccion sin romper nada.

const findById = async (id) => {
  const { rows } = await pool.query(`
    SELECT
      f.*,
      u.nombre  AS usuario_nombre,
      su.nombre AS sucursal_nombre,
      -- Email y dirección solo disponibles si la factura tiene cliente vinculado
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

// ── perteneceAlNegocio ────────────────────────────────────────────────────────

const perteneceAlNegocio = async (id, negocioId) => {
  const { rows } = await pool.query(`
    SELECT f.id FROM facturas f
    JOIN sucursales s ON s.id = f.sucursal_id
    WHERE f.id = $1 AND s.negocio_id = $2
  `, [id, negocioId]);
  return rows.length > 0;
};

// ── getLineas ─────────────────────────────────────────────────────────────────

const getLineas = async (facturaId) => {
  const { rows } = await pool.query(`
    SELECT
      lf.*,
      COALESCE(
        (
          SELECT p.nombre
          FROM seriales    se
          JOIN proveedores p ON p.id = se.proveedor_id
          WHERE se.imei = lf.imei
            AND lf.imei IS NOT NULL
            AND se.proveedor_id IS NOT NULL
          LIMIT 1
        ),
        (
          SELECT p.nombre
          FROM productos_cantidad pc
          JOIN proveedores        p ON p.id = pc.proveedor_id
          JOIN facturas           f ON f.id = lf.factura_id
          WHERE pc.nombre ILIKE lf.nombre_producto
            AND pc.sucursal_id = f.sucursal_id
            AND lf.imei IS NULL
            AND pc.proveedor_id IS NOT NULL
          LIMIT 1
        )
      ) AS proveedor_nombre
    FROM lineas_factura lf
    WHERE lf.factura_id = $1
    ORDER BY lf.id
  `, [facturaId]);
  return rows;
};

// ── getPagos ──────────────────────────────────────────────────────────────────

const getPagos = async (facturaId) => {
  const { rows } = await pool.query(
    'SELECT * FROM pagos_factura WHERE factura_id = $1',
    [facturaId]
  );
  return rows;
};

// ── getRetoma ─────────────────────────────────────────────────────────────────

const getRetoma = async (facturaId) => {
  const { rows } = await pool.query(`
    SELECT id, factura_id, descripcion, valor_retoma,
           ingreso_inventario, nombre_producto, imei
    FROM retomas WHERE factura_id = $1
  `, [facturaId]);
  return rows[0] || null;
};

// ── create ────────────────────────────────────────────────────────────────────

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

// ── insertarLinea ─────────────────────────────────────────────────────────────

const insertarLinea = async (client, { factura_id, nombre_producto, imei, cantidad, precio }) => {
  const { rows } = await client.query(`
    INSERT INTO lineas_factura(factura_id, nombre_producto, imei, cantidad, precio)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [factura_id, nombre_producto, imei, cantidad, precio]);
  return rows[0];
};

// ── insertarPago ──────────────────────────────────────────────────────────────

const insertarPago = async (client, { factura_id, metodo, valor }) => {
  const { rows } = await client.query(`
    INSERT INTO pagos_factura(factura_id, metodo, valor)
    VALUES ($1, $2, $3)
    RETURNING *
  `, [factura_id, metodo, valor]);
  return rows[0];
};

// ── insertarRetoma ────────────────────────────────────────────────────────────

const insertarRetoma = async (client, {
  factura_id, descripcion, valor_retoma,
  ingreso_inventario, nombre_producto, imei,
}) => {
  const { rows } = await client.query(`
    INSERT INTO retomas(factura_id, descripcion, valor_retoma, ingreso_inventario, nombre_producto, imei)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [factura_id, descripcion, valor_retoma, ingreso_inventario || false, nombre_producto || null, imei || null]);
  return rows[0];
};

// ── cancelar ──────────────────────────────────────────────────────────────────

const cancelar = async (client, id) => {
  await client.query(
    "UPDATE facturas SET estado = 'Cancelada' WHERE id = $1",
    [id]
  );
};

module.exports = {
  findAll, findById, perteneceAlNegocio,
  getLineas, getPagos, getRetoma,
  create, insertarLinea, insertarPago, insertarRetoma, cancelar,
};