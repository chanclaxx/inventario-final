const { pool } = require('../../config/db');

// ─── IMEI / Serial ────────────────────────────────────────────────────────────

const getSerialPorIMEI = async (imei, negocioId) => {
  const { rows } = await pool.query(`
    SELECT
      s.id, s.imei, s.fecha_entrada, s.vendido, s.prestado,
      s.costo_compra, s.color, s.caracteristicas,
      s.proveedor_id,
      prov.nombre  AS proveedor_nombre,
      ps.id        AS producto_id,
      ps.nombre    AS producto_nombre,
      ps.marca, ps.modelo, ps.precio,
      su.id        AS sucursal_id,
      su.nombre    AS sucursal_nombre
    FROM seriales s
    JOIN productos_serial ps ON ps.id   = s.producto_id
    JOIN sucursales       su ON su.id   = ps.sucursal_id
    LEFT JOIN proveedores prov ON prov.id = s.proveedor_id
    WHERE s.imei = $1 AND su.negocio_id = $2
    LIMIT 1
  `, [imei, negocioId]);
  return rows[0] || null;
};

const getVentasPorIMEI = async (imei, negocioId) => {
  const { rows } = await pool.query(`
    SELECT
      f.id, f.fecha, f.nombre_cliente, f.cedula, f.celular,
      f.estado, f.notas,
      lf.precio    AS precio_venta,
      lf.cantidad,
      lf.nombre_producto,
      u.nombre     AS usuario_nombre,
      su.nombre    AS sucursal_nombre
    FROM lineas_factura lf
    JOIN facturas   f  ON f.id  = lf.factura_id
    JOIN sucursales su ON su.id = f.sucursal_id
    LEFT JOIN usuarios u ON u.id = f.usuario_id
    WHERE lf.imei = $1 AND su.negocio_id = $2
    ORDER BY f.fecha DESC
  `, [imei, negocioId]);
  return rows;
};

const getRetomasPorIMEI = async (imei, negocioId) => {
  const { rows } = await pool.query(`
    SELECT
      r.id, r.descripcion, r.valor_retoma, r.ingreso_inventario,
      r.nombre_producto,
      f.id         AS factura_id,
      f.fecha,
      f.nombre_cliente,
      f.estado,
      su.nombre    AS sucursal_nombre
    FROM retomas    r
    JOIN facturas   f  ON f.id  = r.factura_id
    JOIN sucursales su ON su.id = f.sucursal_id
    WHERE r.imei = $1 AND su.negocio_id = $2
    ORDER BY f.fecha DESC
  `, [imei, negocioId]);
  return rows;
};

const getPrestamosPorIMEI = async (imei, negocioId) => {
  const { rows } = await pool.query(`
    SELECT
      pr.id, pr.fecha, pr.prestatario, pr.cedula, pr.telefono,
      pr.estado, pr.valor_prestamo, pr.total_abonado,
      (pr.valor_prestamo - pr.total_abonado) AS saldo_pendiente,
      su.nombre AS sucursal_nombre,
      u.nombre  AS usuario_nombre
    FROM prestamos  pr
    JOIN sucursales su ON su.id = pr.sucursal_id
    LEFT JOIN usuarios u ON u.id = pr.usuario_id
    WHERE pr.imei = $1 AND su.negocio_id = $2
    ORDER BY pr.fecha DESC
  `, [imei, negocioId]);
  return rows;
};

const getTrasladosPorIMEI = async (imei, negocioId) => {
  const { rows } = await pool.query(`
    SELECT
      t.id, t.fecha, t.notas,
      so.nombre AS origen_nombre,
      sd.nombre AS destino_nombre,
      u.nombre  AS usuario_nombre
    FROM lineas_traslado lt
    JOIN traslados  t  ON t.id  = lt.traslado_id
    JOIN sucursales so ON so.id = t.sucursal_origen_id
    JOIN sucursales sd ON sd.id = t.sucursal_destino_id
    LEFT JOIN usuarios u ON u.id = t.usuario_id
    WHERE lt.imei = $1 AND t.negocio_id = $2
    ORDER BY t.fecha DESC
  `, [imei, negocioId]);
  return rows;
};

// ─── Búsqueda por nombre ──────────────────────────────────────────────────────

const buscarSeriales = async (q, negocioId, sucursalId) => {
  const filtro = sucursalId ? 'AND ps.sucursal_id = $3' : '';
  const params = sucursalId
    ? [negocioId, `%${q.toLowerCase()}%`, sucursalId]
    : [negocioId, `%${q.toLowerCase()}%`];

  const { rows } = await pool.query(`
    SELECT
      ps.id, ps.nombre, ps.marca, ps.modelo, ps.precio,
      su.id   AS sucursal_id,
      su.nombre AS sucursal_nombre,
      COUNT(s.id) FILTER (WHERE NOT s.vendido AND NOT s.prestado) AS disponibles,
      COUNT(s.id) FILTER (WHERE s.vendido)   AS vendidos,
      COUNT(s.id) FILTER (WHERE s.prestado)  AS prestados,
      COUNT(s.id)                            AS total
    FROM productos_serial ps
    JOIN sucursales su ON su.id = ps.sucursal_id
    LEFT JOIN seriales s ON s.producto_id = ps.id
    WHERE su.negocio_id = $1
      AND ps.activo = true
      AND (
        LOWER(ps.nombre) LIKE $2
        OR LOWER(COALESCE(ps.marca, ''))   LIKE $2
        OR LOWER(COALESCE(ps.modelo, ''))  LIKE $2
      )
      ${filtro}
    GROUP BY ps.id, su.id
    ORDER BY ps.nombre
    LIMIT 40
  `, params);
  return rows;
};

const buscarCantidad = async (q, negocioId, sucursalId) => {
  const filtro = sucursalId ? 'AND pc.sucursal_id = $3' : '';
  const params = sucursalId
    ? [negocioId, `%${q.toLowerCase()}%`, sucursalId]
    : [negocioId, `%${q.toLowerCase()}%`];

  const { rows } = await pool.query(`
    SELECT
      pc.id, pc.nombre, pc.stock, pc.stock_minimo, pc.precio,
      pc.unidad_medida, pc.costo_unitario,
      su.id   AS sucursal_id,
      su.nombre AS sucursal_nombre
    FROM productos_cantidad pc
    JOIN sucursales su ON su.id = pc.sucursal_id
    WHERE su.negocio_id = $1
      AND pc.activo = true
      AND LOWER(pc.nombre) LIKE $2
      ${filtro}
    ORDER BY pc.nombre
    LIMIT 40
  `, params);
  return rows;
};

// ─── Búsqueda de compras a proveedores ───────────────────────────────────────

const buscarComprasPorIMEI = async (imei, negocioId) => {
  const { rows } = await pool.query(`
    SELECT
      lc.id           AS linea_id,
      lc.nombre_producto,
      lc.imei,
      lc.cantidad,
      lc.precio_unitario,
      c.id            AS compra_id,
      c.fecha,
      c.numero_factura,
      c.estado,
      p.nombre        AS proveedor_nombre,
      p.tipo          AS proveedor_tipo,
      su.nombre       AS sucursal_nombre,
      u.nombre        AS usuario_nombre
    FROM lineas_compra lc
    JOIN compras     c  ON c.id  = lc.compra_id
    JOIN sucursales  su ON su.id = c.sucursal_id
    JOIN proveedores p  ON p.id  = c.proveedor_id
    LEFT JOIN usuarios u ON u.id = c.usuario_id
    WHERE lc.imei = $1 AND su.negocio_id = $2
    ORDER BY c.fecha DESC
  `, [imei, negocioId]);
  return rows;
};

const buscarComprasPorTexto = async (q, negocioId, sucursalId) => {
  const filtro = sucursalId ? 'AND c.sucursal_id = $3' : '';
  const params = sucursalId
    ? [negocioId, `%${q.toLowerCase()}%`, sucursalId]
    : [negocioId, `%${q.toLowerCase()}%`];

  const { rows } = await pool.query(`
    SELECT
      lc.id           AS linea_id,
      lc.nombre_producto,
      lc.imei,
      lc.cantidad,
      lc.precio_unitario,
      c.id            AS compra_id,
      c.fecha,
      c.numero_factura,
      c.estado,
      p.nombre        AS proveedor_nombre,
      p.tipo          AS proveedor_tipo,
      su.nombre       AS sucursal_nombre,
      u.nombre        AS usuario_nombre
    FROM lineas_compra lc
    JOIN compras     c  ON c.id  = lc.compra_id
    JOIN sucursales  su ON su.id = c.sucursal_id
    JOIN proveedores p  ON p.id  = c.proveedor_id
    LEFT JOIN usuarios u ON u.id = c.usuario_id
    WHERE su.negocio_id = $1
      AND (
        LOWER(lc.nombre_producto)               LIKE $2
        OR LOWER(COALESCE(lc.imei, ''))         LIKE $2
        OR LOWER(p.nombre)                       LIKE $2
        OR LOWER(COALESCE(c.numero_factura, '')) LIKE $2
      )
      ${filtro}
    ORDER BY c.fecha DESC
    LIMIT 60
  `, params);
  return rows;
};

module.exports = {
  getSerialPorIMEI, getVentasPorIMEI, getRetomasPorIMEI,
  getPrestamosPorIMEI, getTrasladosPorIMEI,
  buscarSeriales, buscarCantidad,
  buscarComprasPorIMEI, buscarComprasPorTexto,
};
