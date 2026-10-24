// Garantías con proveedores — lecturas. Ver migrations/20261023_reclamos_garantia.sql.
//
// Todo estado se DERIVA aquí, con las mismas expresiones para el listado, el
// detalle y los documentos: si cada pantalla lo calculara a su manera, el PDF
// diría «afuera» de una unidad que la lista ya muestra resuelta.
const { pool } = require('../../config/db');
const { sqlSinTildes, patronLike, normalizarTexto } = require('../../utils/textoBusqueda.util');
const { hayReclamosFase2 } = require('../../config/columnas');

// ── Estados derivados (alias: l = línea, r = reclamo, e = envío) ─────────────
const SQL_ESTADO_PROVEEDOR = `
  CASE WHEN r.anulado                    THEN 'anulado'
       WHEN l.cerrada                    THEN 'resuelto'
       WHEN l.envio_id IS NULL           THEN 'por_enviar'
       WHEN l.cantidad_resuelta > 0      THEN 'parcial'
       ELSE 'afuera' END`;

const SQL_ESTADO_CLIENTE = `
  CASE WHEN r.origen_tipo = 'inventario'       THEN 'no_aplica'
       WHEN r.anulado                          THEN 'anulado'
       WHEN l.cantidad_cliente >= l.cantidad   THEN 'resuelto'
       ELSE 'pendiente' END`;

// Días desde que salió en el envío, mientras el proveedor no haya resuelto todo.
const SQL_DIAS_AFUERA = `
  CASE WHEN l.envio_id IS NOT NULL AND NOT l.cerrada AND NOT r.anulado
       THEN (CURRENT_DATE - e.fecha::date) END`;

const SELECT_LINEA = `
  l.id, l.reclamo_id, l.tipo, l.serial_id, l.imei, l.producto_id, l.atributo_id, l.variante_id,
  l.nombre_producto, l.variante_texto, l.cantidad, l.costo_unitario, l.precio_venta,
  l.linea_factura_id, l.compra_id, l.linea_compra_id,
  to_char(l.garantia_proveedor_hasta, 'YYYY-MM-DD') AS garantia_proveedor_hasta,
  l.envio_id, l.cantidad_cliente, l.cantidad_resuelta, l.cerrada, l.sucursal_id,
  e.numero AS envio_numero, e.fecha AS envio_fecha, e.guia AS envio_guia,
  e.transportadora AS envio_transportadora,
  c.numero AS compra_numero, c.fecha AS compra_fecha,
  ${SQL_ESTADO_PROVEEDOR} AS estado_proveedor,
  ${SQL_ESTADO_CLIENTE}   AS estado_cliente,
  ${SQL_DIAS_AFUERA}      AS dias_afuera`;

const FROM_LINEA = `
  FROM reclamos_garantia_lineas l
  JOIN reclamos_garantia r   ON r.id = l.reclamo_id
  LEFT JOIN envios_garantia e ON e.id = l.envio_id
  LEFT JOIN compras c         ON c.id = l.compra_id`;

const SELECT_RECLAMO = `
  r.id, r.numero, r.negocio_id, r.sucursal_id, r.proveedor_id, r.origen_tipo,
  r.factura_id, r.prestamo_id, r.cliente_nombre, r.cliente_cedula, r.cliente_telefono,
  r.falla, r.estado_fisico, r.accesorios, r.notas, r.usuario_id, r.fecha,
  r.anulado, r.anulado_motivo, r.anulado_en,
  su.nombre AS sucursal_nombre,
  pr.nombre AS proveedor_nombre, pr.telefono AS proveedor_telefono, pr.nit AS proveedor_nit,
  u.nombre  AS usuario_nombre,
  f.numero  AS factura_numero, f.estado AS factura_estado,
  p.numero  AS prestamo_numero, p.estado AS prestamo_estado`;

const FROM_RECLAMO = `
  FROM reclamos_garantia r
  JOIN sucursales su       ON su.id = r.sucursal_id
  LEFT JOIN proveedores pr ON pr.id = r.proveedor_id
  LEFT JOIN usuarios u     ON u.id  = r.usuario_id
  LEFT JOIN facturas f     ON f.id  = r.factura_id
  LEFT JOIN prestamos p    ON p.id  = r.prestamo_id`;

/**
 * Las líneas del listado de la pestaña. `sucursalId` null = todas las sedes del
 * negocio (solo el admin llega así). La vista filtra por el estado derivado.
 */
const listarLineas = async (negocioId, sucursalId, { vista = 'abiertas', proveedorId = null, q = null, limite = 300 } = {}) => {
  const params = [negocioId, sucursalId ?? null, proveedorId ?? null];
  let filtroQ = '';
  const termino = normalizarTexto(q || '');
  if (termino.length >= 2) {
    params.push(patronLike(termino));
    const i = params.length;
    params.push(String(q).trim());
    const j = params.length;
    filtroQ = `AND (${sqlSinTildes('l.nombre_producto')} LIKE '%' || $${i} || '%'
                 OR ${sqlSinTildes("COALESCE(r.cliente_nombre, '')")} LIKE '%' || $${i} || '%'
                 OR COALESCE(r.cliente_cedula, '') = $${j}
                 OR UPPER(BTRIM(COALESCE(l.imei, ''))) LIKE '%' || UPPER(BTRIM($${j}))
                 OR CAST(COALESCE(r.numero, r.id) AS TEXT) = $${j})`;
  }
  const VISTAS = {
    abiertas:          'NOT r.anulado AND (NOT l.cerrada OR (r.origen_tipo <> \'inventario\' AND l.cantidad_cliente < l.cantidad))',
    por_enviar:        'NOT r.anulado AND NOT l.cerrada AND l.envio_id IS NULL',
    afuera:            'NOT r.anulado AND NOT l.cerrada AND l.envio_id IS NOT NULL',
    cliente_pendiente: 'NOT r.anulado AND r.origen_tipo <> \'inventario\' AND l.cantidad_cliente < l.cantidad',
    resueltas:         'NOT r.anulado AND l.cerrada',
    // La misma regla de la tarjeta «Resueltas este mes» del resumen.
    resueltas_mes:     `NOT r.anulado AND l.cerrada AND EXISTS (
                          SELECT 1 FROM reclamos_garantia_movimientos m
                          WHERE m.linea_id = l.id AND m.lado = 'proveedor' AND NOT m.anulado
                            AND m.fecha >= date_trunc('month', CURRENT_DATE))`,
    anuladas:          'r.anulado',
    todas:             'TRUE',
  };
  const condVista = VISTAS[vista] || VISTAS.abiertas;
  params.push(Math.min(Math.max(Number(limite) || 300, 1), 1000));
  const { rows } = await pool.query(`
    SELECT ${SELECT_LINEA},
           r.numero AS reclamo_numero, r.fecha AS reclamo_fecha, r.origen_tipo, r.anulado,
           r.factura_id, r.prestamo_id, r.cliente_nombre, r.cliente_telefono, r.falla,
           r.proveedor_id, pr.nombre AS proveedor_nombre, su.nombre AS sucursal_nombre,
           f.numero AS factura_numero, p.numero AS prestamo_numero
    ${FROM_LINEA}
    JOIN sucursales su       ON su.id = r.sucursal_id
    LEFT JOIN proveedores pr ON pr.id = r.proveedor_id
    LEFT JOIN facturas f     ON f.id  = r.factura_id
    LEFT JOIN prestamos p    ON p.id  = r.prestamo_id
    WHERE r.negocio_id = $1
      AND ($2::int IS NULL OR r.sucursal_id = $2)
      AND ($3::int IS NULL OR r.proveedor_id = $3)
      AND ${condVista}
      ${filtroQ}
    ORDER BY r.fecha DESC, l.id DESC
    LIMIT $${params.length}
  `, params);
  return rows;
};

/** Las cifras de las tarjetas de arriba (sobre todo lo abierto de la sede). */
const resumen = async (negocioId, sucursalId, diasDemora) => {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE NOT l.cerrada AND l.envio_id IS NULL)                       AS por_enviar,
      COALESCE(SUM(l.cantidad - l.cantidad_resuelta)
        FILTER (WHERE NOT l.cerrada AND l.envio_id IS NULL), 0)                          AS unidades_por_enviar,
      COUNT(*) FILTER (WHERE NOT l.cerrada AND l.envio_id IS NOT NULL)                   AS afuera,
      COALESCE(SUM(l.cantidad - l.cantidad_resuelta)
        FILTER (WHERE NOT l.cerrada AND l.envio_id IS NOT NULL), 0)                      AS unidades_afuera,
      COALESCE(SUM((l.cantidad - l.cantidad_resuelta) * COALESCE(l.costo_unitario, 0))
        FILTER (WHERE NOT l.cerrada AND l.envio_id IS NOT NULL), 0)                      AS valor_afuera,
      COUNT(*) FILTER (WHERE r.origen_tipo <> 'inventario' AND l.cantidad_cliente < l.cantidad) AS cliente_pendiente,
      COUNT(*) FILTER (WHERE NOT l.cerrada AND l.envio_id IS NOT NULL
                         AND (CURRENT_DATE - e.fecha::date) >= $3)                       AS demoradas,
      COUNT(*) FILTER (WHERE l.cerrada AND EXISTS (
        SELECT 1 FROM reclamos_garantia_movimientos m
        WHERE m.linea_id = l.id AND m.lado = 'proveedor' AND NOT m.anulado
          AND m.fecha >= date_trunc('month', CURRENT_DATE)))                             AS resueltas_mes
    ${FROM_LINEA}
    WHERE r.negocio_id = $1 AND ($2::int IS NULL OR r.sucursal_id = $2) AND NOT r.anulado
  `, [negocioId, sucursalId ?? null, diasDemora]);
  const x = rows[0] || {};
  const n = (v) => Number(v || 0);
  return {
    por_enviar: n(x.por_enviar), unidades_por_enviar: n(x.unidades_por_enviar),
    afuera: n(x.afuera), unidades_afuera: n(x.unidades_afuera), valor_afuera: n(x.valor_afuera),
    cliente_pendiente: n(x.cliente_pendiente), demoradas: n(x.demoradas), resueltas_mes: n(x.resueltas_mes),
  };
};

const findReclamo = async (negocioId, id, executor = pool) => {
  const { rows } = await executor.query(`
    SELECT ${SELECT_RECLAMO} ${FROM_RECLAMO}
    WHERE r.id = $1 AND r.negocio_id = $2
  `, [id, negocioId]);
  return rows[0] || null;
};

const lineasDeReclamo = async (reclamoId, executor = pool) => {
  const { rows } = await executor.query(`
    SELECT ${SELECT_LINEA} ${FROM_LINEA}
    WHERE l.reclamo_id = $1 ORDER BY l.id
  `, [reclamoId]);
  return rows;
};

const movimientosDeReclamo = async (reclamoId, executor = pool) => {
  const { rows } = await executor.query(`
    SELECT m.id, m.linea_id, m.lado, m.tipo, m.destino, m.cantidad, m.valor, m.metodo,
           m.serial_id, m.imei, m.producto_id, m.atributo_id, m.variante_id, m.nombre_producto,
           to_char(m.garantia_hasta, 'YYYY-MM-DD') AS garantia_hasta,
           m.notas, m.fecha, m.anulado, m.anulado_motivo, m.anulado_en,
           u.nombre AS usuario_nombre, ua.nombre AS anulado_por_nombre
    FROM reclamos_garantia_movimientos m
    LEFT JOIN usuarios u  ON u.id  = m.usuario_id
    LEFT JOIN usuarios ua ON ua.id = m.anulado_por
    WHERE m.reclamo_id = $1
    ORDER BY m.fecha, m.id
  `, [reclamoId]);
  return rows;
};

const findEnvio = async (negocioId, id) => {
  const { rows } = await pool.query(`
    SELECT e.*, su.nombre AS sucursal_nombre, pr.nombre AS proveedor_nombre,
           pr.telefono AS proveedor_telefono, pr.nit AS proveedor_nit, u.nombre AS usuario_nombre
    FROM envios_garantia e
    JOIN sucursales su       ON su.id = e.sucursal_id
    LEFT JOIN proveedores pr ON pr.id = e.proveedor_id
    LEFT JOIN usuarios u     ON u.id  = e.usuario_id
    WHERE e.id = $1 AND e.negocio_id = $2
  `, [id, negocioId]);
  return rows[0] || null;
};

const lineasDeEnvio = async (envioId) => {
  const { rows } = await pool.query(`
    SELECT ${SELECT_LINEA},
           r.numero AS reclamo_numero, r.falla, r.estado_fisico, r.accesorios, r.cliente_nombre,
           r.origen_tipo, r.anulado
    ${FROM_LINEA}
    WHERE l.envio_id = $1
    ORDER BY r.numero NULLS LAST, l.id
  `, [envioId]);
  return rows;
};

/**
 * Lo que la sucursal tiene en garantía, para el chip del inventario: los
 * seriales bloqueados y, por nodo, cuántas unidades por cantidad están afuera
 * (no cuentan en el stock). Las mismas claves que `useEnTransito`.
 */
const enInventario = async (negocioId, sucursalId) => {
  const { rows } = await pool.query(`
    SELECT l.tipo, l.serial_id, l.imei, l.producto_id, l.atributo_id, l.variante_id,
           SUM(l.cantidad - l.cantidad_resuelta)::int AS cantidad,
           array_agg(DISTINCT COALESCE(r.numero, r.id)) AS casos
    FROM reclamos_garantia_lineas l
    JOIN reclamos_garantia r ON r.id = l.reclamo_id
    WHERE r.negocio_id = $1 AND l.sucursal_id = $2 AND NOT l.cerrada AND NOT r.anulado
    GROUP BY l.tipo, l.serial_id, l.imei, l.producto_id, l.atributo_id, l.variante_id
  `, [negocioId, sucursalId]);
  return {
    seriales: rows.filter((r) => r.tipo === 'serial')
      .map((r) => ({ serial_id: r.serial_id, imei: r.imei, casos: r.casos })),
    nodos: rows.filter((r) => r.tipo === 'cantidad')
      .map((r) => ({ producto_id: r.producto_id, atributo_id: r.atributo_id, variante_id: r.variante_id,
        cantidad: r.cantidad, casos: r.casos })),
  };
};

/**
 * Lo de la fase 2 para el detalle: la orden de Servicios de origen y las fotos
 * (sin su ruta en el almacenamiento: eso no sale del backend). Sin la migración,
 * nada — el detalle de la fase 1 queda igual.
 */
const extraFase2 = async (reclamoId) => {
  if (!hayReclamosFase2()) return {};
  const [{ rows: os }, { rows: archivos }] = await Promise.all([
    pool.query(`
      SELECT os.id, COALESCE(os.numero, os.id) AS numero, os.estado
      FROM reclamos_garantia r JOIN ordenes_servicio os ON os.id = r.orden_servicio_id
      WHERE r.id = $1`, [reclamoId]),
    pool.query(`
      SELECT a.id, a.nombre_original, a.mime, a.tamano_bytes, a.nota, a.fecha,
             a.anulado, a.anulado_motivo, u.nombre AS usuario_nombre
      FROM reclamos_garantia_archivos a LEFT JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.reclamo_id = $1 ORDER BY a.fecha, a.id`, [reclamoId]),
  ]);
  return { orden_servicio: os[0] || null, archivos };
};

/**
 * Las líneas de las garantías con UN proveedor: las del período (por la fecha
 * del caso) y todo lo que siga abierto de antes. Con lo que respondió por cada
 * una, ya sumado por tipo (los movimientos anulados no cuentan), y los días que
 * tardó la primera respuesta desde el envío.
 */
const lineasDeProveedor = async (negocioId, sucursalId, proveedorId, { desde = null, hasta = null } = {}) => {
  const { rows } = await pool.query(`
    SELECT ${SELECT_LINEA},
           r.numero AS reclamo_numero, r.fecha AS reclamo_fecha, r.falla, r.cliente_nombre, r.origen_tipo,
           su.nombre AS sucursal_nombre,
           COALESCE(m.uds_repuestas, 0)    AS uds_repuestas,
           COALESCE(m.uds_reparadas, 0)    AS uds_reparadas,
           COALESCE(m.uds_no_cubiertas, 0) AS uds_no_cubiertas,
           COALESCE(m.uds_baja, 0)         AS uds_baja,
           COALESCE(m.valor_nota_credito, 0) AS valor_nota_credito,
           COALESCE(m.valor_dinero, 0)     AS valor_dinero,
           m.primera_respuesta,
           CASE WHEN m.primera_respuesta IS NOT NULL AND e.fecha IS NOT NULL
                THEN GREATEST(0, m.primera_respuesta::date - e.fecha::date) END AS dias_respuesta
    ${FROM_LINEA}
    JOIN sucursales su ON su.id = r.sucursal_id
    LEFT JOIN LATERAL (
      SELECT SUM(x.cantidad) FILTER (WHERE x.tipo = 'reposicion')                       AS uds_repuestas,
             SUM(x.cantidad) FILTER (WHERE x.tipo = 'reparacion')                       AS uds_reparadas,
             SUM(x.cantidad) FILTER (WHERE x.tipo = 'rechazo')                          AS uds_no_cubiertas,
             SUM(x.cantidad) FILTER (WHERE x.tipo = 'rechazo' AND x.destino = 'baja')   AS uds_baja,
             SUM(x.valor)    FILTER (WHERE x.tipo = 'nota_credito')                     AS valor_nota_credito,
             SUM(x.valor)    FILTER (WHERE x.tipo = 'reembolso_proveedor')              AS valor_dinero,
             MIN(x.fecha)                                                               AS primera_respuesta
      FROM reclamos_garantia_movimientos x
      WHERE x.linea_id = l.id AND x.lado = 'proveedor' AND NOT x.anulado
    ) m ON TRUE
    WHERE r.negocio_id = $1 AND r.proveedor_id = $3 AND NOT r.anulado
      AND ($2::int IS NULL OR r.sucursal_id = $2)
      AND (NOT l.cerrada
           OR (($4::date IS NULL OR r.fecha::date >= $4::date)
               AND ($5::date IS NULL OR r.fecha::date <= $5::date)))
    ORDER BY r.fecha, l.id
  `, [negocioId, sucursalId ?? null, proveedorId, desde, hasta]);
  return rows;
};

module.exports = {
  SQL_ESTADO_PROVEEDOR, SQL_ESTADO_CLIENTE,
  listarLineas, resumen, findReclamo, lineasDeReclamo, movimientosDeReclamo,
  findEnvio, lineasDeEnvio, enInventario, extraFase2, lineasDeProveedor,
};
