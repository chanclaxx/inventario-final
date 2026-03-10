const { pool } = require('../../config/db');

// ─────────────────────────────────────────────
// HELPERS DE TIMEZONE
// PostgreSQL guarda timestamps en UTC. Colombia es UTC-5.
// ─────────────────────────────────────────────
const HOY_F = `DATE(f.fecha AT TIME ZONE 'America/Bogota') = CURRENT_DATE AT TIME ZONE 'America/Bogota'`;
const HOY   = `DATE(fecha   AT TIME ZONE 'America/Bogota') = CURRENT_DATE AT TIME ZONE 'America/Bogota'`;

// ─────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────
const getDashboard = async (sucursalId) => {
  const [
    ventasHoy,
    facturasHoy,
    stockBajo,
    prestamosActivos,
    creditosActivos,
    pagosMethods,
    utilidadActivas,
    utilidadCreditos,
  ] = await Promise.all([

    pool.query(`
      SELECT COALESCE(SUM(l.subtotal), 0) AS total
      FROM lineas_factura l
      JOIN facturas f ON f.id = l.factura_id
      WHERE ${HOY_F} AND f.sucursal_id = $1 AND f.estado = 'Activa'
    `, [sucursalId]),

    pool.query(`
      SELECT COUNT(*) AS total
      FROM facturas
      WHERE ${HOY} AND sucursal_id = $1 AND estado != 'Cancelada'
    `, [sucursalId]),

    pool.query(`
      SELECT COUNT(*) AS total
      FROM productos_cantidad
      WHERE stock <= stock_minimo AND sucursal_id = $1 AND activo = true
    `, [sucursalId]),

    pool.query(`
      SELECT COUNT(*) AS total,
             COALESCE(SUM(valor_prestamo - total_abonado), 0) AS deuda_total
      FROM prestamos
      WHERE estado = 'Activo' AND sucursal_id = $1
    `, [sucursalId]),

    pool.query(`
      SELECT COUNT(*) AS total,
             COALESCE(SUM(valor_total - total_abonado), 0) AS deuda_total
      FROM creditos
      WHERE estado = 'Activo' AND sucursal_id = $1
    `, [sucursalId]),

    pool.query(`
      SELECT pf.metodo, COALESCE(SUM(pf.valor), 0) AS total
      FROM pagos_factura pf
      JOIN facturas f ON f.id = pf.factura_id
      WHERE ${HOY_F} AND f.sucursal_id = $1 AND f.estado != 'Cancelada'
      GROUP BY pf.metodo
      ORDER BY total DESC
    `, [sucursalId]),

    // Utilidad facturas Activas: costo calculado por línea, retomas por LEFT JOIN agrupado
    pool.query(`
      WITH retomas_por_factura AS (
        SELECT factura_id, COALESCE(SUM(valor_retoma), 0) AS total_retomas
        FROM retomas
        GROUP BY factura_id
      ),
      costo_por_linea AS (
        SELECT
          l.factura_id,
          SUM(
            l.subtotal
            - CASE
                WHEN l.imei IS NOT NULL THEN
                  COALESCE(
                    (SELECT s.costo_compra FROM seriales s WHERE s.imei = l.imei LIMIT 1),
                    (SELECT AVG(s2.costo_compra)
                     FROM seriales s2
                     JOIN seriales s3 ON s3.imei = l.imei
                     WHERE s2.producto_id = s3.producto_id AND s2.costo_compra IS NOT NULL),
                    0
                  )
                ELSE
                  COALESCE(
                    (SELECT pc.costo_unitario
                     FROM productos_cantidad pc
                     WHERE pc.nombre = l.nombre_producto AND pc.sucursal_id = f.sucursal_id
                     LIMIT 1),
                    0
                  ) * l.cantidad
              END
          ) AS utilidad_bruta
        FROM lineas_factura l
        JOIN facturas f ON f.id = l.factura_id
        WHERE ${HOY_F} AND f.sucursal_id = $1 AND f.estado = 'Activa'
        GROUP BY l.factura_id
      )
      SELECT
        COALESCE(SUM(c.utilidad_bruta), 0)                                   AS utilidad_bruta,
        COALESCE(SUM(COALESCE(r.total_retomas, 0)), 0)                       AS total_retomas
      FROM costo_por_linea c
      LEFT JOIN retomas_por_factura r ON r.factura_id = c.factura_id
    `, [sucursalId]),

    // Utilidad pendiente créditos
    pool.query(`
      WITH retomas_por_factura AS (
        SELECT factura_id, COALESCE(SUM(valor_retoma), 0) AS total_retomas
        FROM retomas
        GROUP BY factura_id
      ),
      costo_por_linea AS (
        SELECT
          l.factura_id,
          SUM(
            l.subtotal
            - CASE
                WHEN l.imei IS NOT NULL THEN
                  COALESCE(
                    (SELECT s.costo_compra FROM seriales s WHERE s.imei = l.imei LIMIT 1),
                    (SELECT AVG(s2.costo_compra)
                     FROM seriales s2
                     JOIN seriales s3 ON s3.imei = l.imei
                     WHERE s2.producto_id = s3.producto_id AND s2.costo_compra IS NOT NULL),
                    0
                  )
                ELSE
                  COALESCE(
                    (SELECT pc.costo_unitario
                     FROM productos_cantidad pc
                     WHERE pc.nombre = l.nombre_producto AND pc.sucursal_id = f.sucursal_id
                     LIMIT 1),
                    0
                  ) * l.cantidad
              END
          ) AS utilidad_bruta
        FROM lineas_factura l
        JOIN facturas f ON f.id = l.factura_id
        WHERE ${HOY_F} AND f.sucursal_id = $1 AND f.estado = 'Credito'
        GROUP BY l.factura_id
      )
      SELECT
        COALESCE(SUM(c.utilidad_bruta), 0)             AS utilidad_bruta,
        COALESCE(SUM(COALESCE(r.total_retomas, 0)), 0) AS total_retomas
      FROM costo_por_linea c
      LEFT JOIN retomas_por_factura r ON r.factura_id = c.factura_id
    `, [sucursalId]),
  ]);

  const uActiva  = utilidadActivas.rows[0];
  const uCredito = utilidadCreditos.rows[0];

  return {
    ventas_hoy:         ventasHoy.rows[0].total,
    facturas_hoy:       facturasHoy.rows[0].total,
    stock_bajo:         stockBajo.rows[0].total,
    utilidad_hoy:       Number(uActiva.utilidad_bruta)  - Number(uActiva.total_retomas),
    utilidad_pendiente: Number(uCredito.utilidad_bruta) - Number(uCredito.total_retomas),
    prestamos_activos: {
      cantidad:    prestamosActivos.rows[0].total,
      deuda_total: prestamosActivos.rows[0].deuda_total,
    },
    creditos_activos: {
      cantidad:    creditosActivos.rows[0].total,
      deuda_total: creditosActivos.rows[0].deuda_total,
    },
    pagos_hoy: pagosMethods.rows,
  };
};

// ─────────────────────────────────────────────
// VENTAS CON DETALLE Y UTILIDAD POR RANGO
// ─────────────────────────────────────────────
const getVentasRango = async (sucursalId, desde, hasta) => {
  const { rows: facturas } = await pool.query(`
    WITH retomas_por_factura AS (
      SELECT factura_id, COALESCE(SUM(valor_retoma), 0) AS total_retomas
      FROM retomas
      GROUP BY factura_id
    )
    SELECT
      f.id, f.nombre_cliente, f.cedula, f.celular,
      f.fecha, f.estado, f.notas,
      COALESCE(SUM(l.subtotal), 0)               AS total_venta,
      COALESCE(r.total_retomas, 0)               AS total_retomas
    FROM facturas f
    LEFT JOIN lineas_factura l      ON l.factura_id = f.id
    LEFT JOIN retomas_por_factura r ON r.factura_id = f.id
    WHERE f.sucursal_id = $1
      AND DATE(f.fecha AT TIME ZONE 'America/Bogota') BETWEEN $2 AND $3
      AND f.estado != 'Cancelada'
    GROUP BY f.id, r.total_retomas
    ORDER BY f.fecha DESC
  `, [sucursalId, desde, hasta]);

  if (!facturas.length) return { facturas: [], resumen: null };

  const facturaIds = facturas.map((f) => f.id);

  const { rows: lineas } = await pool.query(`
    SELECT
      l.factura_id,
      l.nombre_producto,
      l.imei,
      l.cantidad,
      l.precio,
      l.subtotal,
      CASE
        WHEN l.imei IS NOT NULL THEN
          COALESCE(
            (SELECT s.costo_compra FROM seriales s WHERE s.imei = l.imei LIMIT 1),
            (SELECT AVG(s2.costo_compra)
             FROM seriales s2
             JOIN seriales s3 ON s3.imei = l.imei
             WHERE s2.producto_id = s3.producto_id AND s2.costo_compra IS NOT NULL)
          )
        ELSE
          (SELECT pc.costo_unitario
           FROM productos_cantidad pc
           WHERE pc.nombre = l.nombre_producto AND pc.sucursal_id = f.sucursal_id
           LIMIT 1)
      END AS costo_unitario_compra,
      CASE WHEN l.imei IS NOT NULL THEN 'serial' ELSE 'cantidad' END AS tipo_producto
    FROM lineas_factura l
    JOIN facturas f ON f.id = l.factura_id
    WHERE l.factura_id = ANY($1::int[])
    ORDER BY l.id ASC
  `, [facturaIds]);

  // Agrupar líneas por factura con utilidad calculada
  const lineasPorFactura = {};
  for (const linea of lineas) {
    const costoTotal = linea.costo_unitario_compra !== null
      ? Number(linea.costo_unitario_compra) * Number(linea.cantidad)
      : null;

    const utilidad = costoTotal !== null
      ? Number(linea.subtotal) - costoTotal
      : null;

    const item = {
      nombre_producto:       linea.nombre_producto,
      imei:                  linea.imei,
      cantidad:              Number(linea.cantidad),
      precio_venta:          Number(linea.precio),
      subtotal:              Number(linea.subtotal),
      costo_unitario_compra: linea.costo_unitario_compra !== null ? Number(linea.costo_unitario_compra) : null,
      costo_total:           costoTotal,
      utilidad,
      tipo_producto:         linea.tipo_producto,
    };

    if (!lineasPorFactura[linea.factura_id]) lineasPorFactura[linea.factura_id] = [];
    lineasPorFactura[linea.factura_id].push(item);
  }

  const facturasCompletas = facturas.map((f) => {
    const items         = lineasPorFactura[f.id] || [];
    const totalRetomas  = Number(f.total_retomas);
    const utilidadBruta = items.reduce(
      (acc, i) => (i.utilidad !== null ? acc + i.utilidad : acc),
      0
    );

    return {
      id:                     f.id,
      nombre_cliente:         f.nombre_cliente,
      cedula:                 f.cedula,
      celular:                f.celular,
      fecha:                  f.fecha,
      estado:                 f.estado,
      notas:                  f.notas,
      total_venta:            Number(f.total_venta),
      total_retomas:          totalRetomas,
      utilidad_bruta:         utilidadBruta,
      utilidad_neta:          utilidadBruta - totalRetomas,
      tiene_costo_incompleto: items.some((i) => i.costo_unitario_compra === null),
      lineas:                 items,
    };
  });

  const soloActivas  = facturasCompletas.filter((f) => f.estado === 'Activa');
  const soloCreditos = facturasCompletas.filter((f) => f.estado === 'Credito');

  const resumen = {
    total_ventas:        facturasCompletas.reduce((s, f) => s + f.total_venta, 0),
    total_facturas:      facturasCompletas.length,
    total_retomas:       facturasCompletas.reduce((s, f) => s + f.total_retomas, 0),
    utilidad_neta_total: soloActivas.reduce((s, f) => s + f.utilidad_neta, 0),
    facturas_activas:    soloActivas.length,
    facturas_credito:    soloCreditos.length,
    utilidad_pendiente:  soloCreditos.reduce((s, f) => s + f.utilidad_neta, 0),
  };

  return { facturas: facturasCompletas, resumen };
};

// ─────────────────────────────────────────────
// PRODUCTOS TOP CON COSTO Y UTILIDAD
// ─────────────────────────────────────────────
const getProductosTop = async (sucursalId, desde, hasta) => {
  const { rows } = await pool.query(`
    SELECT
      l.nombre_producto,
      SUM(l.cantidad)  AS cantidad_vendida,
      SUM(l.subtotal)  AS total_ventas,
      CASE
        WHEN MAX(l.imei) IS NOT NULL THEN
          (SELECT AVG(
            COALESCE(
              s.costo_compra,
              (SELECT AVG(s2.costo_compra)
               FROM seriales s2
               WHERE s2.producto_id = s.producto_id AND s2.costo_compra IS NOT NULL)
            )
          )
          FROM seriales s
          JOIN lineas_factura lf ON lf.imei = s.imei
          JOIN facturas ff ON ff.id = lf.factura_id
          WHERE lf.nombre_producto = l.nombre_producto
            AND ff.sucursal_id = $1
            AND DATE(ff.fecha AT TIME ZONE 'America/Bogota') BETWEEN $2 AND $3
            AND ff.estado != 'Cancelada'
          )
        ELSE
          (SELECT pc.costo_unitario
           FROM productos_cantidad pc
           WHERE pc.nombre = l.nombre_producto AND pc.sucursal_id = $1
           LIMIT 1)
      END AS costo_unitario_promedio,
      CASE WHEN MAX(l.imei) IS NOT NULL THEN 'serial' ELSE 'cantidad' END AS tipo_producto
    FROM lineas_factura l
    JOIN facturas f ON f.id = l.factura_id
    WHERE f.sucursal_id = $1
      AND DATE(f.fecha AT TIME ZONE 'America/Bogota') BETWEEN $2 AND $3
      AND f.estado != 'Cancelada'
    GROUP BY l.nombre_producto
    ORDER BY cantidad_vendida DESC
    LIMIT 20
  `, [sucursalId, desde, hasta]);

  return rows.map((p) => {
    const costoTotal = p.costo_unitario_promedio !== null
      ? Number(p.costo_unitario_promedio) * Number(p.cantidad_vendida)
      : null;

    const utilidad = costoTotal !== null
      ? Number(p.total_ventas) - costoTotal
      : null;

    const margen = utilidad !== null && Number(p.total_ventas) > 0
      ? (utilidad / Number(p.total_ventas)) * 100
      : null;

    return {
      nombre_producto:         p.nombre_producto,
      tipo_producto:           p.tipo_producto,
      cantidad_vendida:        Number(p.cantidad_vendida),
      total_ventas:            Number(p.total_ventas),
      costo_unitario_promedio: p.costo_unitario_promedio !== null ? Number(p.costo_unitario_promedio) : null,
      costo_total:             costoTotal,
      utilidad,
      margen_porcentaje:       margen,
    };
  });
};

// ─────────────────────────────────────────────
// INVENTARIO BAJO
// ─────────────────────────────────────────────
const getInventarioBajo = async (sucursalId) => {
  const { rows } = await pool.query(`
    SELECT id, nombre, stock, stock_minimo, unidad_medida, costo_unitario
    FROM productos_cantidad
    WHERE stock <= stock_minimo AND sucursal_id = $1 AND activo = true
    ORDER BY stock ASC
  `, [sucursalId]);
  return rows;
};

module.exports = { getDashboard, getVentasRango, getProductosTop, getInventarioBajo };