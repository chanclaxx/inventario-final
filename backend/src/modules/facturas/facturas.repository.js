const { pool } = require('../../config/db');

const findAll = async (sucursalId) => {
  const { rows } = await pool.query(`
    SELECT
      f.id, f.fecha, f.nombre_cliente, f.cedula, f.celular,
      f.estado, f.notas, u.nombre AS usuario_nombre,
      COALESCE(SUM(l.subtotal), 0) AS total,
      COALESCE((SELECT SUM(r.valor_retoma) FROM retomas r WHERE r.factura_id = f.id), 0) AS total_retoma,
      STRING_AGG(DISTINCT l.nombre_producto, ', ') AS productos_nombres,
      STRING_AGG(DISTINCT l.imei, ', ')            AS productos_imeis,
      (SELECT ret.descripcion        FROM retomas ret WHERE ret.factura_id = f.id LIMIT 1) AS retoma_descripcion,
      (SELECT ret.imei               FROM retomas ret WHERE ret.factura_id = f.id LIMIT 1) AS retoma_imei,
      (SELECT ret.nombre_producto    FROM retomas ret WHERE ret.factura_id = f.id LIMIT 1) AS retoma_nombre_producto,
      (SELECT ret.ingreso_inventario FROM retomas ret WHERE ret.factura_id = f.id LIMIT 1) AS retoma_ingreso_inventario,
      (SELECT ret.valor_retoma       FROM retomas ret WHERE ret.factura_id = f.id LIMIT 1) AS retoma_valor,
      -- Proveedor: se obtiene del primer producto serializado de la factura
      -- (via imei -> seriales -> productos_serial -> proveedores)
      -- Si no hay serial, se busca por nombre en productos_cantidad
      (
        SELECT COALESCE(
          (
            SELECT p.nombre
            FROM lineas_factura lf2
            JOIN seriales       se ON se.imei = lf2.imei
            JOIN productos_serial ps ON ps.id = se.producto_id
            JOIN proveedores     p  ON p.id = ps.proveedor_id
            WHERE lf2.factura_id = f.id AND lf2.imei IS NOT NULL AND ps.proveedor_id IS NOT NULL
            LIMIT 1
          ),
          (
            SELECT p.nombre
            FROM lineas_factura  lf3
            JOIN productos_cantidad pc ON pc.nombre ILIKE lf3.nombre_producto
                                      AND pc.sucursal_id = f.sucursal_id
            JOIN proveedores     p  ON p.id = pc.proveedor_id
            WHERE lf3.factura_id = f.id AND lf3.imei IS NULL AND pc.proveedor_id IS NOT NULL
            LIMIT 1
          )
        )
      ) AS proveedor_nombre
    FROM facturas f
    LEFT JOIN lineas_factura l ON l.factura_id = f.id
    LEFT JOIN usuarios u ON u.id = f.usuario_id
    WHERE f.sucursal_id = $1
    GROUP BY f.id, u.nombre
    ORDER BY f.fecha DESC
  `, [sucursalId]);
  return rows;
};

const findById = async (id) => {
  const { rows } = await pool.query(`
    SELECT
      f.*,
      u.nombre AS usuario_nombre,
      -- Proveedor del primer producto serializado de la factura
      COALESCE(
        (
          SELECT p.nombre
          FROM lineas_factura lf
          JOIN seriales        se ON se.imei = lf.imei
          JOIN productos_serial ps ON ps.id = se.producto_id
          JOIN proveedores      p  ON p.id = ps.proveedor_id
          WHERE lf.factura_id = f.id AND lf.imei IS NOT NULL AND ps.proveedor_id IS NOT NULL
          LIMIT 1
        ),
        (
          SELECT p.nombre
          FROM lineas_factura    lf2
          JOIN productos_cantidad pc ON pc.nombre ILIKE lf2.nombre_producto
                                    AND pc.sucursal_id = f.sucursal_id
          JOIN proveedores        p  ON p.id = pc.proveedor_id
          WHERE lf2.factura_id = f.id AND lf2.imei IS NULL AND pc.proveedor_id IS NOT NULL
          LIMIT 1
        )
      ) AS proveedor_nombre
    FROM facturas f
    LEFT JOIN usuarios u ON u.id = f.usuario_id
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

const getLineas = async (facturaId) => {
  const { rows } = await pool.query(
    'SELECT * FROM lineas_factura WHERE factura_id = $1',
    [facturaId]
  );
  return rows;
};

const getPagos = async (facturaId) => {
  const { rows } = await pool.query(
    'SELECT * FROM pagos_factura WHERE factura_id = $1',
    [facturaId]
  );
  return rows;
};

const getRetoma = async (facturaId) => {
  const { rows } = await pool.query(`
    SELECT id, factura_id, descripcion, valor_retoma,
           ingreso_inventario, nombre_producto, imei
    FROM retomas
    WHERE factura_id = $1
  `, [facturaId]);
  return rows[0] || null;
};

const create = async (client, { sucursal_id, usuario_id, cliente_id, nombre_cliente, cedula, celular, notas, estado }) => {
  const { rows } = await client.query(`
    INSERT INTO facturas(sucursal_id, usuario_id, cliente_id, nombre_cliente, cedula, celular, notas, estado)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `, [sucursal_id, usuario_id, cliente_id, nombre_cliente, cedula, celular, notas, estado || 'Activa']);
  return rows[0];
};

const insertarLinea = async (client, { factura_id, nombre_producto, imei, cantidad, precio }) => {
  const { rows } = await client.query(`
    INSERT INTO lineas_factura(factura_id, nombre_producto, imei, cantidad, precio)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [factura_id, nombre_producto, imei, cantidad, precio]);
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
  ingreso_inventario, nombre_producto, imei,
}) => {
  const { rows } = await client.query(`
    INSERT INTO retomas(
      factura_id, descripcion, valor_retoma,
      ingreso_inventario, nombre_producto, imei
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [
    factura_id, descripcion, valor_retoma,
    ingreso_inventario || false,
    nombre_producto || null,
    imei || null,
  ]);
  return rows[0];
};

const cancelar = async (client, id) => {
  await client.query(
    "UPDATE facturas SET estado = 'Cancelada' WHERE id = $1",
    [id]
  );
};

module.exports = {
  findAll, findById, perteneceAlNegocio, getLineas, getPagos, getRetoma,
  create, insertarLinea, insertarPago, insertarRetoma, cancelar,
};