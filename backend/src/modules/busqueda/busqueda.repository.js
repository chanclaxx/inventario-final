const { pool } = require('../../config/db');

// ─── Normalización de texto para búsquedas ────────────────────────────────────

const normalizarBusqueda = (str) =>
  (str || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');

// translate() quita acentos comunes en SQL sin requerir extensiones
const SA = "'áéíóúüñàèìòùâêîôûãõäëïöç'";
const TA = "'aeiouunaeioaeiouaaoaeioc'";
const sn = (col) => `translate(LOWER(${col}), ${SA}, ${TA})`;

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

// Divide la query en palabras normalizadas (sin acentos) y construye condiciones
// AND: cada palabra debe aparecer en al menos uno de los campos dados.
const _wordConditions = (q, fields, params) => {
  const palabras = normalizarBusqueda(q).split(/\s+/).filter(Boolean);
  let idx = params.length + 1;
  const conds = palabras.map((word) => {
    params.push(`%${word}%`);
    const n = idx++;
    return `(${fields.map((f) => `${f} LIKE $${n}`).join(' OR ')})`;
  });
  return { conds, nextIdx: idx };
};

const buscarSeriales = async (q, negocioId, sucursalId) => {
  const params = [negocioId];
  const { conds, nextIdx } = _wordConditions(q, [
    sn('ps.nombre'),
    sn("COALESCE(ps.marca,'')"),
    sn("COALESCE(ps.modelo,'')"),
  ], params);

  let filtro = '';
  if (sucursalId) {
    filtro = `AND ps.sucursal_id = $${nextIdx}`;
    params.push(sucursalId);
  }

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
      AND ${conds.join(' AND ')}
      ${filtro}
    GROUP BY ps.id, su.id
    ORDER BY ps.nombre
    LIMIT 40
  `, params);
  return rows;
};

const buscarCantidad = async (q, negocioId, sucursalId) => {
  const params = [negocioId];
  const { conds, nextIdx } = _wordConditions(q, [sn('pc.nombre')], params);

  let filtro = '';
  if (sucursalId) {
    filtro = `AND pc.sucursal_id = $${nextIdx}`;
    params.push(sucursalId);
  }

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
      AND ${conds.join(' AND ')}
      ${filtro}
    ORDER BY pc.nombre
    LIMIT 40
  `, params);
  return rows;
};

const getHistorialCantidad = async (productoId, negocioId) => {
  const { rows } = await pool.query(`
    SELECT
      h.id, h.cantidad, h.costo_unitario, h.tipo,
      h.cliente_origen, h.cedula_cliente, h.notas,
      h.creado_en AS fecha,
      su.nombre   AS sucursal_nombre,
      p.nombre    AS proveedor_nombre
    FROM historial_stock_cantidad h
    JOIN productos_cantidad pc ON pc.id = h.producto_id
    JOIN sucursales         su ON su.id = h.sucursal_id
    LEFT JOIN proveedores   p  ON p.id  = h.proveedor_id
    WHERE h.producto_id = $1 AND su.negocio_id = $2
    ORDER BY h.creado_en DESC
    LIMIT 60
  `, [productoId, negocioId]);
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
  const qNorm  = normalizarBusqueda(q);
  const params = sucursalId
    ? [negocioId, `%${qNorm}%`, sucursalId]
    : [negocioId, `%${qNorm}%`];

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
        ${sn('lc.nombre_producto')}               LIKE $2
        OR LOWER(COALESCE(lc.imei, ''))           LIKE $2
        OR ${sn('p.nombre')}                      LIKE $2
        OR LOWER(COALESCE(c.numero_factura, ''))  LIKE $2
      )
      ${filtro}
    ORDER BY c.fecha DESC
    LIMIT 60
  `, params);
  return rows;
};

// ─── Búsqueda de préstamos con filtros ───────────────────────────────────────

const buscarPrestamos = async ({ q, estado, tipo, fechaDesde, fechaHasta }, negocioId, sucursalId) => {
  const params     = [negocioId];
  const conditions = ['su.negocio_id = $1'];
  let   i          = 2;

  if (sucursalId) {
    conditions.push(`p.sucursal_id = $${i}`);
    params.push(sucursalId);
    i++;
  }

  if (q && q.trim()) {
    conditions.push(`(
      ${sn('p.prestatario')}               LIKE $${i}
      OR ${sn('p.nombre_producto')}        LIKE $${i}
      OR LOWER(COALESCE(p.imei,  ''))      LIKE $${i}
      OR LOWER(COALESCE(p.cedula,''))      LIKE $${i}
    )`);
    params.push(`%${normalizarBusqueda(q)}%`);
    i++;
  }

  if (estado) {
    conditions.push(`p.estado = $${i}`);
    params.push(estado);
    i++;
  }

  if (tipo === 'companero') conditions.push('p.prestatario_id IS NOT NULL');
  if (tipo === 'cliente')   conditions.push('p.cliente_id IS NOT NULL');

  if (fechaDesde) {
    conditions.push(`p.fecha::date >= $${i}`);
    params.push(fechaDesde);
    i++;
  }

  if (fechaHasta) {
    conditions.push(`p.fecha::date <= $${i}`);
    params.push(fechaHasta);
    i++;
  }

  const { rows } = await pool.query(`
    SELECT
      p.id, p.fecha, p.prestatario, p.cedula, p.telefono,
      p.nombre_producto, p.imei, p.cantidad_prestada,
      p.valor_prestamo, p.total_abonado, p.estado,
      p.prestatario_id, p.empleado_id, p.cliente_id, p.sucursal_id,
      su.nombre AS sucursal_nombre,
      (p.valor_prestamo - p.total_abonado) AS saldo_pendiente,
      pr.nombre AS prestatario_nombre,
      e.nombre  AS empleado_nombre,
      c.nombre  AS cliente_nombre
    FROM prestamos p
    JOIN  sucursales                su ON su.id = p.sucursal_id
    LEFT JOIN prestatarios          pr ON pr.id = p.prestatario_id
    LEFT JOIN empleados_prestatario e  ON e.id  = p.empleado_id
    LEFT JOIN clientes              c  ON c.id  = p.cliente_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY p.fecha DESC
    LIMIT 100
  `, params);
  return rows;
};

module.exports = {
  getSerialPorIMEI, getVentasPorIMEI, getRetomasPorIMEI,
  getPrestamosPorIMEI, getTrasladosPorIMEI,
  buscarSeriales, buscarCantidad, getHistorialCantidad,
  buscarComprasPorIMEI, buscarComprasPorTexto,
  buscarPrestamos,
};
