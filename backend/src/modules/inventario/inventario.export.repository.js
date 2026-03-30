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
      COALESCE(
        pr_serial.nombre,
        pr_producto.nombre,
        pr_compra.nombre
      ) AS proveedor,

      -- Cliente final: factura normal tiene prioridad;
      -- si no hay factura pero el serial fue saldado vía préstamo,
      -- se usa el nombre del prestatario del préstamo más reciente saldado.
      COALESCE(f.nombre_cliente, p_saldado.prestatario) AS cliente_venta,
      f.cedula   AS cedula_cliente_venta,
      f.celular  AS celular_cliente_venta

    FROM seriales s
    JOIN productos_serial ps ON ps.id = s.producto_id

    -- Proveedor directo del serial
    LEFT JOIN proveedores pr_serial   ON pr_serial.id   = s.proveedor_id

    -- Proveedor del producto
    LEFT JOIN proveedores pr_producto ON pr_producto.id  = ps.proveedor_id

    -- Proveedor via compra (por IMEI en lineas_compra)
    LEFT JOIN lineas_compra lc        ON lc.imei          = s.imei
    LEFT JOIN compras        co       ON co.id             = lc.compra_id
    LEFT JOIN proveedores pr_compra   ON pr_compra.id      = co.proveedor_id

    -- Cliente de venta normal (por IMEI en lineas_factura)
    LEFT JOIN lineas_factura lf       ON lf.imei           = s.imei
    LEFT JOIN facturas       f        ON f.id              = lf.factura_id
                                     AND f.estado         != 'Cancelada'

    -- Préstamo saldado más reciente por IMEI (subquery para evitar duplicados
    -- cuando el mismo IMEI tuvo varios préstamos saldados a lo largo del tiempo)
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