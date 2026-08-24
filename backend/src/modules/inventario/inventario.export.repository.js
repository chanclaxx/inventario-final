const { pool } = require('../../config/db');
const { hayUbicacion } = require('../../config/columnas');
const costoRed = require('../../utils/costoRed.util');

// Ubicacion espacial (feature opt-in): solo se selecciona si la columna existe.
// Literal SQL fijo, no entrada de usuario. Ver src/config/columnas.js.
const selUbicacion = (alias) => (hayUbicacion() ? `${alias}.ubicacion,` : '');

const getSeriales = async (sucursalId) => {
  const { rows } = await pool.query(`
    SELECT
      ps.nombre       AS producto,
      ps.marca,
      ps.modelo,
      ${selUbicacion('ps')}
      lp.nombre       AS linea,
      s.imei,
      s.color,
      s.caracteristicas,
      s.costo_compra,
      -- Costo del LOCAL: si la unidad vino de la bodega de la red, lo que vale
      -- es el valor interno de la remisión (lo que tendrá que liquidar), no lo
      -- que la bodega pagó por ella. NULL en la bodega y en negocios sin red.
      vi.valor        AS costo_local,
      COALESCE(s.precio, ps.precio) AS precio_venta,
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
      COALESCE(hist.historial, '[]'::json) AS historial_ventas,

      -- Prestamista: nombre de quien tiene el producto en préstamo activo
      CASE
        WHEN s.prestado = true
        THEN COALESCE(pr_prest.nombre, c_prest.nombre, p_activo.prestatario)
        ELSE NULL
      END AS prestamista

    FROM seriales s
    JOIN productos_serial ps ON ps.id = s.producto_id
    CROSS JOIN LATERAL (
      SELECT ${costoRed.sqlValorInternoEnStock('s.id', 'ps.sucursal_id')} AS valor
    ) vi

    -- Línea del producto
    LEFT JOIN lineas_producto lp ON lp.id = ps.linea_id

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

    -- Préstamo activo más reciente por IMEI (para prestamista)
    LEFT JOIN LATERAL (
      SELECT p2.prestatario, p2.prestatario_id, p2.cliente_id
      FROM prestamos p2
      WHERE p2.imei = s.imei AND p2.estado = 'Activo'
      ORDER BY p2.fecha DESC
      LIMIT 1
    ) p_activo ON true
    LEFT JOIN prestatarios pr_prest ON pr_prest.id = p_activo.prestatario_id
    LEFT JOIN clientes c_prest      ON c_prest.id  = p_activo.cliente_id

    WHERE ps.sucursal_id = $1
    ORDER BY ps.nombre, s.vendido ASC, s.fecha_salida DESC
  `, [sucursalId]);
  return rows;
};

/**
 * Variante liviana de getSeriales para la exportación "por líneas".
 *
 * Ese Excel solo pinta referencia, IMEI, color, características, prestamista,
 * fecha de entrada y cliente origen — nunca toca facturas ni compras. Así que
 * aquí se omiten los cruces por IMEI más caros que sí necesita el modo "por
 * productos": venta más reciente, historial completo (JSON_AGG sobre
 * lineas_factura) y proveedor vía compra. También sobra el LEFT JOIN a clientes,
 * que al normalizar con LOWER(TRIM(...)) no puede aprovechar índice común.
 *
 * Queda un solo cruce por IMEI (préstamo activo, para el prestamista) en vez de
 * cuatro, y el payload baja bastante al no arrastrar el historial de ventas.
 */
const getSerialesLineas = async (sucursalId) => {
  const { rows } = await pool.query(`
    SELECT
      ps.nombre  AS producto,
      lp.nombre  AS linea,
      s.imei,
      s.color,
      s.caracteristicas,
      s.fecha_entrada,
      s.vendido,
      s.prestado,
      s.cliente_origen,

      CASE
        WHEN s.prestado = true
        THEN COALESCE(pr_prest.nombre, c_prest.nombre, p_activo.prestatario)
        ELSE NULL
      END AS prestamista

    FROM seriales s
    JOIN productos_serial ps ON ps.id = s.producto_id
    LEFT JOIN lineas_producto lp ON lp.id = ps.linea_id

    -- Préstamo activo más reciente por IMEI (único cruce por IMEI que queda)
    LEFT JOIN LATERAL (
      SELECT p2.prestatario, p2.prestatario_id, p2.cliente_id
      FROM prestamos p2
      WHERE s.prestado = true AND p2.imei = s.imei AND p2.estado = 'Activo'
      ORDER BY p2.fecha DESC
      LIMIT 1
    ) p_activo ON true
    LEFT JOIN prestatarios pr_prest ON pr_prest.id = p_activo.prestatario_id
    LEFT JOIN clientes c_prest      ON c_prest.id  = p_activo.cliente_id

    WHERE ps.sucursal_id = $1
    ORDER BY ps.nombre, s.vendido ASC
  `, [sucursalId]);
  return rows;
};

const getProductosCantidad = async (sucursalId) => {
  const { rows } = await pool.query(`
    SELECT
      pc.id,
      pc.nombre,
      pc.codigo,
      ${selUbicacion('pc')}
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

// Trae todos los atributos y sub-variantes activos de los productos de una sucursal
// en dos queries (evita N+1). Retorna un objeto indexado por producto_id.
const getVariantesPorSucursal = async (sucursalId) => {
  const { rows: atributos } = await pool.query(`
    SELECT
      ap.id, ap.producto_id,
      ap.tipo_id, tc.nombre AS tipo_nombre,
      ap.valor, ap.stock, ap.stock_minimo, ap.precio, ap.codigo
    FROM atributos_producto ap
    JOIN productos_cantidad  pc ON pc.id  = ap.producto_id
    LEFT JOIN tipos_caracteristica tc ON tc.id = ap.tipo_id
    WHERE pc.sucursal_id = $1 AND ap.activo = true AND pc.activo = true
    ORDER BY tc.orden ASC NULLS LAST, ap.valor ASC
  `, [sucursalId]);

  if (!atributos.length) return {};

  const atributoIds = atributos.map((a) => a.id);
  const { rows: variantes } = await pool.query(`
    SELECT
      v.id, v.atributo_id,
      v.tipo_id, tc.nombre AS tipo_nombre,
      v.valor, v.stock, v.stock_minimo, v.precio, v.codigo
    FROM variantes_atributo v
    LEFT JOIN tipos_caracteristica tc ON tc.id = v.tipo_id
    WHERE v.atributo_id = ANY($1) AND v.activo = true
    ORDER BY tc.orden ASC NULLS LAST, v.valor ASC
  `, [atributoIds]);

  const varsByAtributo = {};
  for (const v of variantes) {
    if (!varsByAtributo[v.atributo_id]) varsByAtributo[v.atributo_id] = [];
    varsByAtributo[v.atributo_id].push(v);
  }

  const result = {};
  for (const a of atributos) {
    if (!result[a.producto_id]) result[a.producto_id] = [];
    result[a.producto_id].push({ ...a, variantes: varsByAtributo[a.id] || [] });
  }
  return result;
};

/**
 * Todos los seriales del negocio para la exportación "por líneas" de todas las
 * sucursales. Mismo criterio que getSerialesLineas: solo las columnas que el
 * Excel pinta, sin los cruces por IMEI contra facturas y compras.
 */
const getSerialesTodas = async (negocioId) => {
  const { rows } = await pool.query(`
    SELECT
      ps.nombre  AS producto,
      lp.nombre  AS linea,
      suc.nombre AS sucursal_nombre,
      s.imei,
      s.color,
      s.caracteristicas,
      s.fecha_entrada,
      s.vendido,
      s.prestado,
      s.cliente_origen,

      CASE
        WHEN s.prestado = true
        THEN COALESCE(pr_prest.nombre, c_prest.nombre, p_activo.prestatario)
        ELSE NULL
      END AS prestamista

    FROM seriales s
    JOIN productos_serial ps ON ps.id = s.producto_id
    JOIN sucursales suc ON suc.id = ps.sucursal_id
    LEFT JOIN lineas_producto lp ON lp.id = ps.linea_id

    LEFT JOIN LATERAL (
      SELECT p2.prestatario, p2.prestatario_id, p2.cliente_id
      FROM prestamos p2
      WHERE s.prestado = true AND p2.imei = s.imei AND p2.estado = 'Activo'
      ORDER BY p2.fecha DESC
      LIMIT 1
    ) p_activo ON true
    LEFT JOIN prestatarios pr_prest ON pr_prest.id = p_activo.prestatario_id
    LEFT JOIN clientes c_prest      ON c_prest.id  = p_activo.cliente_id

    WHERE suc.negocio_id = $1 AND suc.activa = true
    ORDER BY suc.nombre, ps.nombre, s.vendido ASC
  `, [negocioId]);
  return rows;
};

module.exports = {
  getSeriales,
  getSerialesLineas,
  getProductosCantidad,
  getVariantesPorSucursal,
  getSerialesTodas,
};