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
      pr.nombre       AS proveedor,
      f.nombre_cliente AS cliente_venta,
      f.cedula         AS cedula_cliente_venta,
      f.celular        AS celular_cliente_venta
    FROM seriales s
    JOIN productos_serial ps ON ps.id = s.producto_id
    LEFT JOIN proveedores  pr ON pr.id = ps.proveedor_id
    LEFT JOIN lineas_factura lf ON lf.imei = s.imei
    LEFT JOIN facturas       f  ON f.id = lf.factura_id
                                AND f.estado != 'Cancelada'
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