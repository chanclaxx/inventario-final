const { pool } = require('../../config/db');

const getSeriales = async (sucursalId) => {
  const { rows } = await pool.query(`
    SELECT
      ps.nombre       AS producto,
      ps.marca,
      ps.modelo,
      s.imei,
      s.color,
      s.fecha_entrada,
      s.vendido,
      s.prestado,
      s.fecha_salida,
      s.cliente_origen,

      -- Cédula y celular del cliente origen (si está registrado en el sistema)
      c_origen.cedula  AS cedula_cliente_origen,
      c_origen.celular AS celular_cliente_origen,

      COALESCE(
        pr_serial.nombre,
        pr_producto.nombre,
        pr_compra.nombre
      ) AS proveedor,

      -- Venta más reciente (LATERAL → siempre una fila por serial, sin duplicados por retoma)
      COALESCE(f.nombre_cliente, p_saldado.prestatario) AS cliente_venta,
      f.cedula   AS cedula_cliente_venta,
      f.celular  AS celular_cliente_venta,

      -- Historial completo de ventas para trazabilidad en el Excel (más antigua primero)
      COALESCE(hist.historial, '[]'::json) AS historial_ventas

    FROM seriales s
    JOIN productos_serial ps ON ps.id = s.producto_id

    -- Proveedor directo del serial
    LEFT JOIN proveedores pr_serial   ON pr_serial.id   = s.proveedor_id

    -- Proveedor del producto
    LEFT JOIN proveedores pr_producto ON pr_producto.id  = ps.proveedor_id

    -- Proveedor via compra: LATERAL para evitar duplicados si el IMEI aparece en varias compras
    LEFT JOIN LATERAL (
      SELECT pr_c.nombre
      FROM lineas_compra lc2
      JOIN compras        co2 ON co2.id      = lc2.compra_id
      JOIN proveedores    pr_c ON pr_c.id    = co2.proveedor_id
      WHERE lc2.imei = s.imei
      ORDER BY co2.fecha DESC
      LIMIT 1
    ) pr_compra ON true

    -- Cliente origen registrado en el sistema (match por nombre)
    LEFT JOIN clientes c_origen
      ON LOWER(TRIM(c_origen.nombre)) = LOWER(TRIM(s.cliente_origen))
      AND c_origen.negocio_id = (
        SELECT negocio_id FROM sucursales WHERE id = $1
      )

    -- Venta más reciente por IMEI (LIMIT 1 → exactamente una fila por serial)
    LEFT JOIN LATERAL (
      SELECT f2.nombre_cliente, f2.cedula, f2.celular
      FROM lineas_factura lf2
      JOIN facturas f2 ON f2.id = lf2.factura_id AND f2.estado != 'Cancelada'
      WHERE lf2.imei = s.imei
      ORDER BY f2.fecha DESC
      LIMIT 1
    ) f ON true

    -- Historial completo de ventas por IMEI (todas las facturas, más antigua primero)
    LEFT JOIN LATERAL (
      SELECT JSON_AGG(
        JSON_BUILD_OBJECT(
          'cliente', f3.nombre_cliente,
          'cedula',  f3.cedula,
          'celular', f3.celular,
          'fecha',   f3.fecha
        ) ORDER BY f3.fecha ASC
      ) AS historial
      FROM lineas_factura lf3
      JOIN facturas f3 ON f3.id = lf3.factura_id AND f3.estado != 'Cancelada'
      WHERE lf3.imei = s.imei
    ) hist ON true

    -- Préstamo saldado más reciente por IMEI
    LEFT JOIN (
      SELECT DISTINCT ON (imei)
        imei,
        prestatario
      FROM prestamos
      WHERE estado = 'Saldado'
        AND imei IS NOT NULL
      ORDER BY imei, fecha DESC
    ) p_saldado ON p_saldado.imei = s.imei

    WHERE ps.sucursal_id = $1
    ORDER BY ps.nombre, s.vendido ASC, s.fecha_salida DESC
  `, [sucursalId]);
  return rows;
};

const getProductosCantidad = async (sucursalId) => {
  const { rows } = await pool.query(`
    SELECT
      pc.nombre,
      pc.stock,
      pc.stock_minimo,
      pc.unidad_medida,
      pc.cliente_origen,
      pr.nombre AS proveedor,
      pc.activo,
      pc.creado_en
    FROM productos_cantidad pc
    LEFT JOIN proveedores pr ON pr.id = pc.proveedor_id
    WHERE pc.sucursal_id = $1
    ORDER BY pc.nombre ASC
  `, [sucursalId]);
  return rows;
};

module.exports = { getSeriales, getProductosCantidad };