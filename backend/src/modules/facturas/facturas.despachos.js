// ─────────────────────────────────────────────────────────────────────────────
// Los DESPACHOS a los locales en el historial de Facturas.
//
// Un despacho de la red interna es, para la bodega, una venta a su local: sale
// mercancía y nace una deuda. La gente lo buscaba en Facturas, donde están
// todas las demás salidas, y no aparecía.
//
// ESTO SOLO LEE `remisiones`. No crea una fila en `facturas` ni en
// `lineas_factura`, y es a propósito: todos los reportes (Ventas, Dashboard,
// Análisis, Vendedores, Productos, caja, el PDF contable) suman esas dos tablas,
// y el despacho ya se cuenta por su lado como grupo propio (`red_interna` en la
// pestaña Ventas, con su utilidad realizada al COBRAR). Una factura espejo lo
// contaría dos veces y además le pondría al local una venta «de contado» que no
// pagó. Lo que no se escribe no puede descuadrar ningún reporte.
//
// Quién lo ve: quien tenga el módulo `red_interna` y en un negocio con la red
// encendida — es el mismo candado del router de la red, porque el detalle del
// envío se abre con sus rutas. El VALOR del envío sigue la lista
// `red_interna_valores_usuarios` (ausente = solo el admin): `valor_total` es una
// de las claves que `_recortarParaVendedor` esconde, y aquí se recorta igual,
// en el backend, para que no viaje en el JSON.
//
// Solo las ENTREGAS y solo desde la sede que DESPACHA (la bodega): para el
// local, lo recibido es una compra, no una factura suya.
// ─────────────────────────────────────────────────────────────────────────────

const { pool } = require('../../config/db');
const { tieneAcceso } = require('../../config/modulos');
const { getConfigRed, hayInfraRed } = require('../../middlewares/redInterna.middleware');

/**
 * ¿Puede este request ver despachos en Facturas? Devuelve el alcance o `null`.
 * Nunca lanza por la red interna: si algo de ella falla, Facturas sigue igual.
 */
const contextoDespachos = async (req) => {
  try {
    if (!req.user || !tieneAcceso(req.user, 'red_interna')) return null;
    const red = await getConfigRed(req.user.negocio_id);
    if (!red.activa || !red.bodega_id) return null;
    if (!(await hayInfraRed())) return null;

    const sucursalId = req.todasSucursales ? null : (Number(req.sucursal_id) || null);
    if (!req.todasSucursales && !sucursalId) return null;

    const verValores = req.user.rol === 'admin_negocio'
      || (red.valores_usuarios || []).includes(Number(req.user.id));
    return { negocioId: req.user.negocio_id, sucursalId, verValores };
  } catch {
    return null;
  }
};

const _recortar = (rows, ctx) => (ctx.verValores
  ? rows
  : rows.map((r) => ({ ...r, valor_total: null })));

/**
 * Despachos (entregas) del alcance. `desde`/`hasta` aceptan Date (la ventana
 * del scroll, mismo criterio `>= desde AND < hasta` que las facturas) o texto
 * 'YYYY-MM-DD' (el buscador, con el día `hasta` incluido).
 */
const listarDespachos = async (ctx, { desde, hasta, q, limit = 200 } = {}) => {
  if (!ctx) return [];
  const params = [ctx.negocioId];
  const cond = [`r.negocio_id = $1`, `r.tipo = 'entrega'`];

  if (ctx.sucursalId) {
    params.push(ctx.sucursalId);
    cond.push(`r.sucursal_origen_id = $${params.length}`);
  }
  if (desde instanceof Date) {
    params.push(desde); cond.push(`r.fecha_emision >= $${params.length}`);
  } else if (desde) {
    params.push(desde); cond.push(`r.fecha_emision >= $${params.length}::date`);
  }
  if (hasta instanceof Date) {
    params.push(hasta); cond.push(`r.fecha_emision < $${params.length}`);
  } else if (hasta) {
    params.push(hasta); cond.push(`r.fecha_emision < ($${params.length}::date + INTERVAL '1 day')`);
  }
  if (q && q.trim()) {
    const texto = q.toLowerCase().replace(/[%_\\]/g, '\\$&').slice(0, 100);
    params.push(`%${texto}%`);
    const p = `$${params.length}`;
    cond.push(`(
      LOWER(sd.nombre) LIKE ${p} ESCAPE '\\'
      OR CAST(COALESCE(r.numero, r.id) AS TEXT) LIKE ${p} ESCAPE '\\'
      OR LOWER(COALESCE(r.notas, '')) LIKE ${p} ESCAPE '\\'
      OR EXISTS (
        SELECT 1 FROM lineas_remision lr_s
        WHERE lr_s.remision_id = r.id
          AND (LOWER(lr_s.nombre_producto) LIKE ${p} ESCAPE '\\'
               OR LOWER(lr_s.imei) LIKE ${p} ESCAPE '\\')
      )
    )`);
  }
  params.push(Math.min(Number(limit) || 200, 500));

  const { rows } = await pool.query(`
    SELECT r.id, r.numero, r.fecha_emision AS fecha, r.fecha_recepcion,
           r.estado, r.valor_total, r.notas,
           r.sucursal_origen_id, r.sucursal_destino_id,
           so.nombre AS sucursal_origen_nombre,
           sd.nombre AS sucursal_destino_nombre,
           u.nombre  AS usuario_nombre,
           COALESCE(li.unidades, 0)::int AS unidades,
           li.productos_nombres
    FROM remisiones r
    JOIN sucursales so ON so.id = r.sucursal_origen_id
    JOIN sucursales sd ON sd.id = r.sucursal_destino_id
    LEFT JOIN usuarios u ON u.id = r.usuario_emisor_id
    LEFT JOIN LATERAL (
      SELECT SUM(lr.cantidad) AS unidades,
             STRING_AGG(DISTINCT lr.nombre_producto, ', ') AS productos_nombres
      FROM lineas_remision lr
      WHERE lr.remision_id = r.id
    ) li ON TRUE
    WHERE ${cond.join(' AND ')}
    ORDER BY r.fecha_emision DESC
    LIMIT $${params.length}
  `, params);

  return _recortar(rows, ctx);
};

/** ¿Queda algún despacho anterior a `fecha`? (para no cortar el scroll). */
const hayDespachosAntes = async (ctx, fecha) => {
  if (!ctx) return false;
  const params = [ctx.negocioId, fecha];
  let filtro = '';
  if (ctx.sucursalId) { params.push(ctx.sucursalId); filtro = 'AND sucursal_origen_id = $3'; }
  const { rows } = await pool.query(`
    SELECT 1 FROM remisiones
    WHERE negocio_id = $1 AND tipo = 'entrega' AND fecha_emision < $2 ${filtro}
    LIMIT 1
  `, params);
  return rows.length > 0;
};

module.exports = { contextoDespachos, listarDespachos, hayDespachosAntes };
