const { pool } = require('../../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// RED INTERNA — repositorio
//
// MODELO: CONSIGNACIÓN.
//   Entregar mercancía a un local NO genera deuda. La deuda nace cuando el
//   local VENDE, y NO se guarda en ninguna parte: se DERIVA de las tablas que
//   ya existen (seriales + lineas_factura + creditos), igual que Tesorería
//   deriva los saldos de las cuentas.
//
//   Consecuencia buscada: no hay dos lados que puedan desincronizarse, porque
//   solo hay un lado. Si se anula una factura, el estado se corrige solo.
//
// SOLO SE ESCRIBE:
//   remisiones / lineas_remision  → qué salió y a dónde
//   remesas                       → qué plata volvió
//   movimientos_cuenta_interna    → gastos autorizados, ajustes, cortes
//
// CUIDADO CON EL FAN-OUT DE IMEI: un mismo IMEI puede tener varias filas
// históricas en `seriales`. Por eso la unión lineas_remision → seriales va
// SIEMPRE por `serial_id`, nunca por imei. El único cruce por IMEI es contra
// `lineas_factura` (que no tiene serial_id) y va acotado a: facturas de la
// sucursal destino, no canceladas, y posteriores a la recepción de la remisión.
// ─────────────────────────────────────────────────────────────────────────────

// ── Estados derivados de una unidad serial ───────────────────────────────────
// El CASE es EXHAUSTIVO a propósito: la rama final 'Sin ubicar' garantiza que
// ninguna unidad remisionada pueda desaparecer del conteo (invariante 1).
const CASE_ESTADO = `
  CASE
    WHEN b.estado_linea = 'Devuelta'                       THEN 'Devuelta'
    WHEN b.estado_linea = 'Faltante'                       THEN 'Faltante'
    WHEN b.remision_estado = 'En transito'
      OR b.estado_linea    = 'Pendiente'                   THEN 'En transito'
    WHEN v.credito_id  IS NOT NULL                         THEN 'En recaudo'
    WHEN v.factura_id  IS NOT NULL                         THEN 'Por liquidar'
    WHEN b.serial_id   IS NULL
      OR b.sucursal_actual IS NULL                         THEN 'Sin ubicar'
    WHEN b.prestado                                        THEN 'En prestamo'
    WHEN b.vendido                                         THEN 'Sin ubicar'
    WHEN b.sucursal_actual = b.sucursal_destino_id         THEN 'En consignacion'
    ELSE 'Movida'
  END
`;

// Unidades seriales con su estado y su valor liquidable.
//   $1 negocio_id   $2 sucursal_destino_id (NULL = todas)
const SQL_UNIDADES = `
  WITH base AS (
    SELECT
      lr.id AS linea_id, lr.remision_id, lr.serial_id, lr.imei,
      lr.valor_interno, lr.estado_linea, lr.nombre_producto,
      r.numero  AS remision_numero,
      r.estado  AS remision_estado,
      r.sucursal_destino_id,
      r.fecha_emision, r.fecha_recepcion,
      s.vendido, s.prestado,
      ps.sucursal_id AS sucursal_actual
    FROM lineas_remision lr
    JOIN remisiones r             ON r.id  = lr.remision_id
    LEFT JOIN seriales s          ON s.id  = lr.serial_id
    LEFT JOIN productos_serial ps ON ps.id = s.producto_id
    WHERE r.negocio_id = $1
      AND r.tipo    = 'entrega'
      AND r.estado <> 'Anulada'
      AND lr.tipo   = 'serial'
      AND ($2::int IS NULL OR r.sucursal_destino_id = $2)
  ),
  venta AS (
    -- La venta que consumió la unidad. DISTINCT ON + ORDER BY toma la más
    -- reciente: si el equipo se vendió, entró como retoma y se volvió a vender,
    -- la vigente es la última.
    SELECT DISTINCT ON (b.linea_id)
      b.linea_id,
      f.id     AS factura_id,
      f.numero AS factura_numero,
      f.fecha  AS factura_fecha,
      f.nombre_cliente,
      (lf.cantidad * lf.precio)::numeric AS subtotal_linea,
      c.id                                AS credito_id,
      c.valor_total                       AS credito_total,
      (COALESCE(c.cuota_inicial, 0) + COALESCE(c.total_abonado, 0))::numeric AS credito_recaudado
    FROM base b
    JOIN lineas_factura lf ON UPPER(TRIM(lf.imei)) = UPPER(TRIM(b.imei))
    JOIN facturas f        ON f.id = lf.factura_id
    LEFT JOIN creditos c   ON c.factura_id = f.id
    WHERE b.imei IS NOT NULL
      AND f.sucursal_id = b.sucursal_destino_id
      AND f.estado <> 'Cancelada'
      -- El piso es la fecha de DESPACHO, no la de recepción: si el local
      -- confirma la llegada con retraso (mercancía el lunes, confirmada el
      -- miércoles) las ventas del martes deben contar igual. Y sigue
      -- descartando ventas viejas del mismo IMEI: ninguna venta legítima de
      -- esta unidad puede ser anterior a que la bodega la despachara.
      AND f.fecha  >= b.fecha_emision
    ORDER BY b.linea_id, f.fecha DESC, f.id DESC
  ),
  calc AS (
    SELECT
      b.*,
      v.factura_id, v.factura_numero, v.factura_fecha, v.nombre_cliente,
      v.credito_id, v.subtotal_linea,
      ${CASE_ESTADO} AS estado_unidad,
      -- Recaudo de un crédito prorrateado a ESTA línea: una factura a crédito
      -- puede llevar varios equipos y el abono es de la factura completa.
      CASE
        WHEN v.credito_id IS NULL OR COALESCE(v.credito_total, 0) = 0 THEN 0
        ELSE ROUND(v.credito_recaudado * (v.subtotal_linea / v.credito_total), 2)
      END AS recaudado_prorrateado
    FROM base b
    LEFT JOIN venta v ON v.linea_id = b.linea_id
  )
  SELECT
    c.*,
    -- REGLA DE LIQUIDACIÓN (confirmada con el cliente):
    --   contado → el valor interno completo, exigible ya.
    --   crédito → mín(recaudado, valor interno): la bodega recupera primero,
    --             el margen le queda al local.
    CASE c.estado_unidad
      WHEN 'Por liquidar' THEN c.valor_interno
      WHEN 'En recaudo'   THEN LEAST(c.valor_interno, c.recaudado_prorrateado)
      ELSE 0
    END AS liquidable
  FROM calc c
`;

// ── Unidades seriales (detalle) ──────────────────────────────────────────────
const getUnidades = async (negocioId, sucursalId = null) => {
  const { rows } = await pool.query(
    `${SQL_UNIDADES} ORDER BY c.factura_fecha DESC NULLS LAST, c.linea_id DESC`,
    [negocioId, sucursalId]
  );
  return rows;
};

// ── Unidades con búsqueda y filtros (pestaña "Mercancía") ────────────────────
//   $3 estado (NULL = todos)   $4 texto libre   $5 desde   $6 hasta
//   $7 limit   $8 offset
//
// `estado` admite varios separados por coma ('Por liquidar,En recaudo'): lo que
// para el local es UNA idea ("lo que vendí") son dos estados distintos aquí.
const buscarUnidades = async (negocioId, sucursalId, {
  estado = null, q = '', desde = null, hasta = null, limit = 100, offset = 0,
} = {}) => {
  const texto = (q || '').trim().toLowerCase().replace(/[%_\\]/g, '\\$&').slice(0, 80);
  const params = [negocioId, sucursalId, estado, texto, desde, hasta, limit, offset];

  const filtro = `
    WHERE ($3::text IS NULL OR u.estado_unidad = ANY(string_to_array($3, ',')))
      AND ($4 = '' OR LOWER(COALESCE(u.nombre_producto, '')) LIKE '%' || $4 || '%' ESCAPE '\\'
                   OR LOWER(COALESCE(u.imei, ''))            LIKE '%' || $4 || '%' ESCAPE '\\'
                   OR LOWER(COALESCE(u.nombre_cliente, ''))  LIKE '%' || $4 || '%' ESCAPE '\\'
                   OR COALESCE(u.factura_numero::text, '')   LIKE '%' || $4 || '%' ESCAPE '\\'
                   OR COALESCE(u.remision_numero::text, '')  LIKE '%' || $4 || '%' ESCAPE '\\')
      AND ($5::timestamp IS NULL OR COALESCE(u.fecha_recepcion, u.fecha_emision) >= $5)
      AND ($6::timestamp IS NULL OR COALESCE(u.fecha_recepcion, u.fecha_emision) <= $6)
  `;

  const [filas, total] = await Promise.all([
    pool.query(`
      SELECT u.* FROM (${SQL_UNIDADES}) u
      ${filtro}
      ORDER BY COALESCE(u.factura_fecha, u.fecha_recepcion, u.fecha_emision) DESC, u.linea_id DESC
      LIMIT $7 OFFSET $8
    `, params),
    pool.query(`
      SELECT COUNT(*)::int AS n,
             COALESCE(SUM(u.valor_interno), 0) AS valor,
             COALESCE(SUM(u.liquidable), 0)    AS liquidable
      FROM (${SQL_UNIDADES}) u ${filtro}
    `, params.slice(0, 6)),
  ]);

  return {
    items: filas.rows,
    total: total.rows[0].n,
    valor_total: Number(total.rows[0].valor),
    liquidable_total: Number(total.rows[0].liquidable),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// EXTRACTO — el movimiento de la cuenta del local, como un extracto bancario.
//
// Cada fila es un hecho con fecha, y el saldo se va acumulando. Los CARGOS
// nacen de las ventas del local (es cuando se vuelve exigible lo consignado);
// los ABONOS, de las remesas recibidas y los gastos por cuenta de bodega.
//
// Las remisiones y devoluciones aparecen como apuntes INFORMATIVOS (valor 0 en
// el saldo): no mueven la cuenta, pero sin ellos el extracto no se entiende.
// ─────────────────────────────────────────────────────────────────────────────
const getExtracto = async (negocioId, sucursalId, { desde = null, hasta = null, limit = 300 } = {}) => {
  const { rows } = await pool.query(`
    WITH u AS (${SQL_UNIDADES}),
    eventos AS (
      -- CARGO: el local vendió una unidad consignada → se vuelve exigible
      SELECT
        u.factura_fecha                              AS fecha,
        'cargo'                                      AS clase,
        'venta'                                      AS origen,
        COALESCE(u.nombre_producto, 'Producto')      AS concepto,
        u.liquidable                                 AS valor,
        u.imei                                       AS referencia,
        u.factura_numero                             AS documento,
        u.nombre_cliente                             AS tercero,
        u.estado_unidad                              AS detalle
      FROM u
      WHERE u.liquidable > 0 AND u.factura_fecha IS NOT NULL

      UNION ALL
      -- ABONO: remesa de efectivo confirmada por la bodega
      SELECT r.fecha_recepcion, 'abono', 'remesa',
             'Remesa recibida', -r.valor,
             NULL, r.numero, ur.nombre, r.notas
      FROM remesas r
      LEFT JOIN usuarios ur ON ur.id = r.usuario_envia_id
      WHERE r.negocio_id = $1 AND r.sucursal_origen_id = $2 AND r.estado = 'Recibida'

      UNION ALL
      -- ABONO: gasto que el local pagó por cuenta de la bodega
      SELECT m.fecha, 'abono', 'gasto',
             COALESCE(m.concepto, 'Gasto por cuenta de bodega'), -m.valor,
             NULL, NULL, um.nombre, NULL
      FROM movimientos_cuenta_interna m
      LEFT JOIN usuarios um ON um.id = m.usuario_id
      WHERE m.negocio_id = $1 AND m.sucursal_id = $2
        AND NOT m.anulado AND m.tipo = 'GastoAutorizado'

      UNION ALL
      -- AJUSTE manual y saldos a favor.
      -- Convención (la misma de _armarSaldo: saldo = liquidable menos ajustes):
      -- un ajuste POSITIVO baja la deuda, así que en el extracto es un ABONO.
      SELECT m.fecha, CASE WHEN m.valor >= 0 THEN 'abono' ELSE 'cargo' END, 'ajuste',
             COALESCE(m.concepto, 'Ajuste'), -m.valor,
             NULL, NULL, um.nombre, NULL
      FROM movimientos_cuenta_interna m
      LEFT JOIN usuarios um ON um.id = m.usuario_id
      WHERE m.negocio_id = $1 AND m.sucursal_id = $2
        AND NOT m.anulado AND m.tipo = 'Ajuste'

      UNION ALL
      -- INFORMATIVO: correcciones de valor sobre una línea ya recibida.
      -- No mueven el saldo por sí solas (el cargo de la venta ya usa el valor
      -- corregido), pero sin verlas nadie entendería por qué cambió una cifra.
      SELECT c.fecha, 'info', 'correccion',
             'Corrección de valor: ' || COALESCE(lr.nombre_producto, 'producto'), 0,
             lr.imei, NULL, uc.nombre,
             'de ' || c.valor_anterior::text || ' a ' || c.valor_nuevo::text
               || COALESCE(' · ' || c.motivo, '')
      FROM correcciones_remision c
      JOIN lineas_remision lr ON lr.id = c.linea_id
      LEFT JOIN usuarios uc   ON uc.id = c.usuario_id
      WHERE c.negocio_id = $1 AND c.sucursal_id = $2

      UNION ALL
      -- INFORMATIVO: mercancía recibida (no mueve el saldo)
      SELECT rm.fecha_recepcion, 'info', 'remision',
             'Mercancía recibida', 0,
             NULL, rm.numero, ue.nombre,
             (SELECT COUNT(*)::text || ' producto(s)' FROM lineas_remision lr
              WHERE lr.remision_id = rm.id AND lr.estado_linea = 'Recibida')
      FROM remisiones rm
      LEFT JOIN usuarios ue ON ue.id = rm.usuario_emisor_id
      WHERE rm.negocio_id = $1 AND rm.sucursal_destino_id = $2
        AND rm.tipo = 'entrega' AND rm.estado IN ('Recibida', 'Parcial')

      UNION ALL
      -- INFORMATIVO: devoluciones a bodega
      SELECT rm.fecha_recepcion, 'info', 'devolucion',
             'Devolución a bodega', 0,
             NULL, rm.numero, ue.nombre,
             (SELECT COUNT(*)::text || ' producto(s)' FROM lineas_remision lr
              WHERE lr.remision_id = rm.id)
      FROM remisiones rm
      LEFT JOIN usuarios ue ON ue.id = rm.usuario_emisor_id
      WHERE rm.negocio_id = $1 AND rm.sucursal_origen_id = $2
        AND rm.tipo = 'devolucion' AND rm.estado IN ('Recibida', 'Parcial')
    ),
    filtrados AS (
      SELECT * FROM eventos
      WHERE fecha IS NOT NULL
        AND ($3::timestamp IS NULL OR fecha >= $3)
        AND ($4::timestamp IS NULL OR fecha <= $4)
    )
    SELECT f.*,
           -- Saldo corrido: cuánto debía el local justo después de este hecho.
           SUM(f.valor) OVER (ORDER BY f.fecha, f.clase, f.concepto
                              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS saldo
    FROM filtrados f
    ORDER BY f.fecha DESC, f.clase, f.concepto
    LIMIT $5
  `, [negocioId, sucursalId, desde, hasta, limit]);

  return rows;
};

// ── Resumen por estado (seriales) ────────────────────────────────────────────
const getResumenUnidades = async (negocioId, sucursalId = null) => {
  const { rows } = await pool.query(`
    SELECT
      c.sucursal_destino_id                    AS sucursal_id,
      c.estado_unidad                          AS estado,
      COUNT(*)::int                            AS unidades,
      COALESCE(SUM(c.valor_interno), 0)        AS valor_interno,
      COALESCE(SUM(c.liquidable), 0)           AS liquidable
    FROM (${SQL_UNIDADES}) c
    GROUP BY c.sucursal_destino_id, c.estado_unidad
  `, [negocioId, sucursalId]);
  return rows;
};

// ── Productos de cantidad: liquidación anclada en el stock ───────────────────
//
// Los accesorios son fungibles: no hay forma de rastrear la unidad exacta. Se
// usa el stock como ancla, que es justo la lógica de consignación:
//   "lo que te entregué, menos lo que devolviste, menos lo que te queda en
//    vitrina = lo que vendiste".
// Es deliberadamente CONSERVADOR (favorece al local): si el local tenía stock
// propio del mismo producto, nunca se le cobra de más.
const SQL_CANTIDAD = `
  WITH entregas AS (
    SELECT
      r.sucursal_destino_id                      AS sucursal_id,
      lr.producto_destino_id                     AS producto_id,
      SUM(COALESCE(lr.cantidad_recibida, 0))::int AS entregado,
      CASE WHEN SUM(COALESCE(lr.cantidad_recibida, 0)) > 0
        THEN SUM(lr.valor_interno * COALESCE(lr.cantidad_recibida, 0))
             / SUM(COALESCE(lr.cantidad_recibida, 0))
        ELSE 0 END                               AS valor_unitario
    FROM lineas_remision lr
    JOIN remisiones r ON r.id = lr.remision_id
    WHERE r.negocio_id = $1
      AND r.tipo    = 'entrega'
      AND r.estado <> 'Anulada'
      AND lr.tipo   = 'cantidad'
      AND lr.estado_linea = 'Recibida'
      AND ($2::int IS NULL OR r.sucursal_destino_id = $2)
    GROUP BY r.sucursal_destino_id, lr.producto_destino_id
  ),
  devoluciones AS (
    SELECT
      r.sucursal_origen_id                       AS sucursal_id,
      lr.producto_origen_id                      AS producto_id,
      SUM(COALESCE(lr.cantidad_recibida, lr.cantidad, 0))::int AS devuelto
    FROM lineas_remision lr
    JOIN remisiones r ON r.id = lr.remision_id
    WHERE r.negocio_id = $1
      AND r.tipo    = 'devolucion'
      AND r.estado <> 'Anulada'
      AND lr.tipo   = 'cantidad'
      AND ($2::int IS NULL OR r.sucursal_origen_id = $2)
    GROUP BY r.sucursal_origen_id, lr.producto_origen_id
  )
  SELECT
    e.sucursal_id,
    e.producto_id,
    pc.nombre,
    e.entregado,
    COALESCE(d.devuelto, 0)                                        AS devuelto,
    COALESCE(pc.stock, 0)                                          AS stock_actual,
    GREATEST(0, e.entregado - COALESCE(d.devuelto, 0) - COALESCE(pc.stock, 0))::int AS vendido_estimado,
    e.valor_unitario,
    ROUND(
      GREATEST(0, e.entregado - COALESCE(d.devuelto, 0) - COALESCE(pc.stock, 0))
      * e.valor_unitario
    , 2)                                                           AS liquidable
  FROM entregas e
  LEFT JOIN devoluciones d
         ON d.sucursal_id = e.sucursal_id AND d.producto_id = e.producto_id
  LEFT JOIN productos_cantidad pc ON pc.id = e.producto_id
  WHERE e.entregado > 0
`;

const getCantidadConsignada = async (negocioId, sucursalId = null) => {
  const { rows } = await pool.query(SQL_CANTIDAD, [negocioId, sucursalId]);
  return rows;
};

// ── Remesas y movimientos de cuenta (lo único escrito del lado del dinero) ───

const getTotalRemesado = async (negocioId, sucursalId = null) => {
  const { rows } = await pool.query(`
    SELECT
      sucursal_origen_id AS sucursal_id,
      COALESCE(SUM(valor) FILTER (WHERE estado = 'Recibida'),    0) AS recibido,
      COALESCE(SUM(valor) FILTER (WHERE estado = 'En transito'), 0) AS en_transito
    FROM remesas
    WHERE negocio_id = $1 AND estado <> 'Anulada'
      AND ($2::int IS NULL OR sucursal_origen_id = $2)
    GROUP BY sucursal_origen_id
  `, [negocioId, sucursalId]);
  return rows;
};

const getTotalMovimientosCuenta = async (negocioId, sucursalId = null) => {
  const { rows } = await pool.query(`
    SELECT
      sucursal_id,
      COALESCE(SUM(valor) FILTER (WHERE tipo = 'GastoAutorizado'), 0) AS gastos,
      COALESCE(SUM(valor) FILTER (WHERE tipo = 'Ajuste'),          0) AS ajustes
    FROM movimientos_cuenta_interna
    WHERE negocio_id = $1 AND NOT anulado
      AND ($2::int IS NULL OR sucursal_id = $2)
    GROUP BY sucursal_id
  `, [negocioId, sucursalId]);
  return rows;
};

// ── Conciliación por equipo, con liquidación FIFO ────────────────────────────
//
// Responde la pregunta del cliente: "¿cuál producto ya se vendió y todavía no
// se ha pagado?". Las remesas recibidas cubren las ventas en orden cronológico:
// una unidad está Liquidada si el acumulado de liquidable hasta ella (inclusive)
// cabe dentro de lo ya remesado.
const getConciliacion = async (negocioId, sucursalId) => {
  const { rows } = await pool.query(`
    WITH u AS (${SQL_UNIDADES}),
    cubierto AS (
      SELECT
        COALESCE((SELECT SUM(valor) FROM remesas
                  WHERE negocio_id = $1 AND sucursal_origen_id = $2 AND estado = 'Recibida'), 0)
      + COALESCE((SELECT SUM(valor) FROM movimientos_cuenta_interna
                  WHERE negocio_id = $1 AND sucursal_id = $2 AND NOT anulado
                    AND tipo = 'GastoAutorizado'), 0) AS total
    ),
    ordenadas AS (
      SELECT u.*,
             SUM(u.liquidable) OVER (
               ORDER BY u.factura_fecha, u.linea_id
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
             ) AS acumulado
      FROM u
      WHERE u.liquidable > 0
    )
    SELECT o.linea_id, o.remision_id, o.remision_numero, o.serial_id, o.imei,
           o.nombre_producto, o.valor_interno, o.estado_unidad, o.liquidable,
           o.factura_id, o.factura_numero, o.factura_fecha, o.nombre_cliente,
           o.credito_id, o.acumulado,
           (o.acumulado <= c.total) AS liquidada
    FROM ordenadas o CROSS JOIN cubierto c
    ORDER BY o.factura_fecha DESC, o.linea_id DESC
  `, [negocioId, sucursalId]);
  return rows;
};

// ─────────────────────────────────────────────────────────────────────────────
// RESUMEN POR ENVÍO — "¿qué pasó con lo que me mandaron en cada remisión?"
//
// Es la misma derivación de siempre (SQL_UNIDADES) agrupada por remisión, para
// responder la pregunta que el local hace de verdad: no "cuánto debo" sino
// "de este envío, qué vendí, qué presté y qué me queda".
//
// IMPUTACIÓN DE PAGOS: se reusa el FIFO de getConciliacion — los pagos cubren
// las ventas en orden cronológico. La porción pendiente de una unidad es la
// parte de su liquidable que queda por encima de lo ya cubierto:
//     pendiente = LEAST(liquidable, GREATEST(0, acumulado − cubierto))
// Sumada sobre todas las unidades da exactamente `liquidable_serial − cubierto`
// (acotado en 0), así que el desglose por envío CUADRA con el saldo del panel.
//
// `cubierto` incluye los tres términos que restan en _armarSaldo (remesas,
// gastos autorizados y ajustes). Si esa fórmula cambia, cambiarla también aquí.
//
// Los ACCESORIOS no se atribuyen a un envío: su liquidación se ancla en el
// stock actual del producto, que es global. Se cuentan las unidades entregadas
// (dato cierto) y nada más; su deuda vive en el resumen general.
// ─────────────────────────────────────────────────────────────────────────────
const getResumenPorRemision = async (negocioId, sucursalId, { limit = 100 } = {}) => {
  const { rows } = await pool.query(`
    WITH u AS (${SQL_UNIDADES}),
    cubierto AS (
      SELECT
        COALESCE((SELECT SUM(valor) FROM remesas
                  WHERE negocio_id = $1 AND sucursal_origen_id = $2 AND estado = 'Recibida'), 0)
      + COALESCE((SELECT SUM(valor) FROM movimientos_cuenta_interna
                  WHERE negocio_id = $1 AND sucursal_id = $2 AND NOT anulado
                    AND tipo IN ('GastoAutorizado', 'Ajuste')), 0) AS total
    ),
    ordenadas AS (
      SELECT u.remision_id, u.liquidable,
             SUM(u.liquidable) OVER (
               ORDER BY u.factura_fecha, u.linea_id
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
             ) AS acumulado
      FROM u
      WHERE u.liquidable > 0
    ),
    pendiente AS (
      SELECT o.remision_id,
             SUM(LEAST(o.liquidable, GREATEST(0, o.acumulado - c.total))) AS pendiente
      FROM ordenadas o CROSS JOIN cubierto c
      GROUP BY o.remision_id
    ),
    seriales_rollup AS (
      SELECT
        u.remision_id,
        COUNT(*)::int                                                       AS unidades,
        COUNT(*) FILTER (WHERE u.estado_unidad = 'En consignacion')::int    AS disponibles,
        COUNT(*) FILTER (WHERE u.estado_unidad IN ('Por liquidar','En recaudo'))::int AS vendidas,
        COUNT(*) FILTER (WHERE u.estado_unidad = 'Por liquidar')::int       AS vendidas_contado,
        COUNT(*) FILTER (WHERE u.estado_unidad = 'En recaudo')::int         AS vendidas_credito,
        COUNT(*) FILTER (WHERE u.estado_unidad = 'En prestamo')::int        AS prestadas,
        COUNT(*) FILTER (WHERE u.estado_unidad = 'Devuelta')::int           AS devueltas,
        COUNT(*) FILTER (WHERE u.estado_unidad = 'Faltante')::int           AS faltantes,
        COUNT(*) FILTER (WHERE u.estado_unidad = 'En transito')::int        AS en_transito,
        COUNT(*) FILTER (WHERE u.estado_unidad IN ('Sin ubicar','Movida'))::int AS sin_ubicar,
        COALESCE(SUM(u.valor_interno) FILTER (WHERE u.estado_unidad = 'En consignacion'), 0) AS disponibles_valor,
        COALESCE(SUM(u.valor_interno) FILTER (WHERE u.estado_unidad IN ('Por liquidar','En recaudo')), 0) AS vendidas_valor,
        COALESCE(SUM(u.valor_interno) FILTER (WHERE u.estado_unidad = 'En prestamo'), 0) AS prestadas_valor,
        COALESCE(SUM(u.valor_interno) FILTER (WHERE u.estado_unidad IN ('Sin ubicar','Movida')), 0) AS sin_ubicar_valor,
        -- Lo que efectivamente quedó en poder del local (lo faltante nunca llegó)
        COALESCE(SUM(u.valor_interno) FILTER (WHERE u.estado_unidad <> 'Faltante'), 0) AS valor_recibido,
        COALESCE(SUM(u.liquidable), 0)                                      AS deuda_generada
      FROM u
      GROUP BY u.remision_id
    ),
    accesorios_rollup AS (
      SELECT
        lr.remision_id,
        COALESCE(SUM(COALESCE(lr.cantidad_recibida, lr.cantidad, 0)), 0)::int AS unidades,
        COALESCE(SUM(lr.valor_interno * COALESCE(lr.cantidad_recibida, lr.cantidad, 0)), 0) AS valor
      FROM lineas_remision lr
      JOIN remisiones r ON r.id = lr.remision_id
      WHERE lr.tipo = 'cantidad' AND lr.estado_linea <> 'Faltante'
        AND r.negocio_id = $1 AND r.tipo = 'entrega'
        AND r.sucursal_destino_id = $2 AND r.estado <> 'Anulada'
      GROUP BY lr.remision_id
    )
    SELECT
      r.id, r.numero, r.estado, r.fecha_emision, r.fecha_recepcion, r.notas,
      r.valor_total,
      so.nombre AS sucursal_origen_nombre,
      ue.nombre AS usuario_emisor_nombre,
      ur.nombre AS usuario_receptor_nombre,
      COALESCE(sr.unidades, 0)          AS unidades,
      COALESCE(sr.disponibles, 0)       AS disponibles,
      COALESCE(sr.vendidas, 0)          AS vendidas,
      COALESCE(sr.vendidas_contado, 0)  AS vendidas_contado,
      COALESCE(sr.vendidas_credito, 0)  AS vendidas_credito,
      COALESCE(sr.prestadas, 0)         AS prestadas,
      COALESCE(sr.devueltas, 0)         AS devueltas,
      COALESCE(sr.faltantes, 0)         AS faltantes,
      COALESCE(sr.en_transito, 0)       AS en_transito,
      COALESCE(sr.sin_ubicar, 0)        AS sin_ubicar,
      COALESCE(sr.disponibles_valor, 0) AS disponibles_valor,
      COALESCE(sr.vendidas_valor, 0)    AS vendidas_valor,
      COALESCE(sr.prestadas_valor, 0)   AS prestadas_valor,
      COALESCE(sr.sin_ubicar_valor, 0)  AS sin_ubicar_valor,
      COALESCE(sr.valor_recibido, 0)    AS valor_recibido,
      COALESCE(sr.deuda_generada, 0)    AS deuda_generada,
      COALESCE(p.pendiente, 0)          AS deuda_pendiente,
      COALESCE(ar.unidades, 0)          AS accesorios_unidades,
      COALESCE(ar.valor, 0)             AS accesorios_valor
    FROM remisiones r
    JOIN sucursales so             ON so.id = r.sucursal_origen_id
    LEFT JOIN usuarios ue          ON ue.id = r.usuario_emisor_id
    LEFT JOIN usuarios ur          ON ur.id = r.usuario_receptor_id
    LEFT JOIN seriales_rollup sr   ON sr.remision_id = r.id
    LEFT JOIN pendiente p          ON p.remision_id  = r.id
    LEFT JOIN accesorios_rollup ar ON ar.remision_id = r.id
    WHERE r.negocio_id = $1
      AND r.tipo = 'entrega'
      AND r.sucursal_destino_id = $2
    ORDER BY r.fecha_emision DESC
    LIMIT $3
  `, [negocioId, sucursalId, limit]);
  return rows;
};

// ── Remisiones (escritura) ───────────────────────────────────────────────────

const crearRemision = async (client, {
  negocio_id, tipo, sucursal_origen_id, sucursal_destino_id,
  usuario_emisor_id, clave_idempotencia, notas, estado,
}) => {
  const { rows } = await client.query(`
    INSERT INTO remisiones
      (negocio_id, tipo, sucursal_origen_id, sucursal_destino_id,
       usuario_emisor_id, clave_idempotencia, notas, estado)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `, [negocio_id, tipo, sucursal_origen_id, sucursal_destino_id,
      usuario_emisor_id, clave_idempotencia || null, notas || null,
      estado || 'En transito']);
  return rows[0];
};

const insertarLineaRemision = async (client, l) => {
  const { rows } = await client.query(`
    INSERT INTO lineas_remision
      (remision_id, tipo, serial_id, imei, producto_origen_id, producto_destino_id,
       cantidad, cantidad_recibida, valor_interno, estado_linea, nombre_producto,
       origen_unidad, genera_saldo_favor, remision_tipo)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
            COALESCE($14, (SELECT tipo FROM remisiones WHERE id = $1)))
    RETURNING *
  `, [l.remision_id, l.tipo, l.serial_id || null, l.imei || null,
      l.producto_origen_id || null, l.producto_destino_id || null,
      l.cantidad || 1, l.cantidad_recibida ?? null, l.valor_interno || 0,
      l.estado_linea || 'Pendiente', l.nombre_producto || null,
      l.origen_unidad || null, l.genera_saldo_favor === true,
      l.remision_tipo || null]);
  return rows[0];
};

const actualizarTotalRemision = async (client, remisionId) => {
  const { rows } = await client.query(`
    UPDATE remisiones SET valor_total = (
      SELECT COALESCE(SUM(
        lr.valor_interno * CASE WHEN lr.tipo = 'cantidad'
          THEN COALESCE(lr.cantidad_recibida, lr.cantidad) ELSE 1 END
      ), 0)
      FROM lineas_remision lr
      WHERE lr.remision_id = $1 AND lr.estado_linea <> 'Faltante'
    )
    WHERE id = $1
    RETURNING *
  `, [remisionId]);
  return rows[0];
};

const findRemisionById = async (negocioId, id, client = null) => {
  const { rows } = await (client || pool).query(`
    SELECT r.*,
           so.nombre AS sucursal_origen_nombre,
           sd.nombre AS sucursal_destino_nombre,
           ue.nombre AS usuario_emisor_nombre,
           ur.nombre AS usuario_receptor_nombre
    FROM remisiones r
    JOIN sucursales so     ON so.id = r.sucursal_origen_id
    JOIN sucursales sd     ON sd.id = r.sucursal_destino_id
    LEFT JOIN usuarios ue  ON ue.id = r.usuario_emisor_id
    LEFT JOIN usuarios ur  ON ur.id = r.usuario_receptor_id
    WHERE r.id = $1 AND r.negocio_id = $2
    ${client ? 'FOR UPDATE OF r' : ''}
  `, [id, negocioId]);
  return rows[0] || null;
};

const getLineasRemision = async (remisionId) => {
  const { rows } = await pool.query(`
    SELECT lr.*, s.vendido, s.prestado
    FROM lineas_remision lr
    LEFT JOIN seriales s ON s.id = lr.serial_id
    WHERE lr.remision_id = $1
    ORDER BY lr.id
  `, [remisionId]);
  return rows;
};

// ── Detalle de una remisión, línea por línea, con su estado ACTUAL ───────────
// Cruza con el motor de estados para saber, de cada cosa enviada, si sigue en
// vitrina, ya se vendió o se devolvió — y cuánto de ese envío ya es deuda.
const getLineasDetalladas = async (negocioId, remisionId) => {
  const { rows } = await pool.query(`
    WITH u AS (${SQL_UNIDADES})
    SELECT
      lr.*,
      COALESCE(ps.nombre, pc.nombre)                    AS producto_nombre,
      COALESCE(ps.marca, '')                            AS marca,
      COALESCE(ps.modelo, '')                           AS modelo,
      pc.codigo                                         AS codigo,
      pc.unidad_medida,
      COALESCE(pcd.stock, 0)                            AS stock_destino,
      u.estado_unidad,
      COALESCE(u.liquidable, 0)                         AS liquidable,
      u.factura_numero, u.nombre_cliente, u.factura_fecha,
      s.vendido, s.prestado
    FROM lineas_remision lr
    LEFT JOIN u                    ON u.linea_id = lr.id
    LEFT JOIN seriales s           ON s.id  = lr.serial_id
    LEFT JOIN productos_serial ps  ON ps.id = lr.producto_origen_id AND lr.tipo = 'serial'
    LEFT JOIN productos_cantidad pc  ON pc.id  = lr.producto_origen_id  AND lr.tipo = 'cantidad'
    LEFT JOIN productos_cantidad pcd ON pcd.id = lr.producto_destino_id AND lr.tipo = 'cantidad'
    WHERE lr.remision_id = $2
      AND EXISTS (SELECT 1 FROM remisiones r WHERE r.id = lr.remision_id AND r.negocio_id = $1)
    ORDER BY lr.tipo, lr.id
  `, [negocioId, remisionId]);
  return rows;
};

// ── Correcciones de valor ────────────────────────────────────────────────────
const insertarCorreccion = async (client, c) => {
  const { rows } = await (client || pool).query(`
    INSERT INTO correcciones_remision
      (negocio_id, sucursal_id, linea_id, valor_anterior, valor_nuevo, diferencia, motivo, usuario_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING *
  `, [c.negocio_id, c.sucursal_id, c.linea_id, c.valor_anterior, c.valor_nuevo,
      c.diferencia, c.motivo || null, c.usuario_id || null]);
  return rows[0];
};

const getCorreccionesRemision = async (negocioId, remisionId) => {
  const { rows } = await pool.query(`
    SELECT c.*, u.nombre AS usuario_nombre, lr.nombre_producto, lr.imei
    FROM correcciones_remision c
    JOIN lineas_remision lr ON lr.id = c.linea_id
    LEFT JOIN usuarios u    ON u.id = c.usuario_id
    WHERE c.negocio_id = $1 AND lr.remision_id = $2
    ORDER BY c.fecha DESC
  `, [negocioId, remisionId]);
  return rows;
};

const findRemisiones = async (negocioId, { sucursalId, rol, estado, tipo, limit = 50 } = {}) => {
  const cond = [];
  const params = [negocioId];
  // Por defecto solo entregas: las devoluciones tienen su propia bandeja y
  // mezclarlas confundiría el listado de envíos.
  params.push(tipo || 'entrega');
  cond.push(`r.tipo = $${params.length}`);
  if (sucursalId) {
    params.push(sucursalId);
    // 'destino' = bandeja del local · 'origen' = despachos de la bodega
    if (rol === 'destino')      cond.push(`r.sucursal_destino_id = $${params.length}`);
    else if (rol === 'origen')  cond.push(`r.sucursal_origen_id  = $${params.length}`);
    else cond.push(`(r.sucursal_destino_id = $${params.length} OR r.sucursal_origen_id = $${params.length})`);
  }
  if (estado) { params.push(estado); cond.push(`r.estado = $${params.length}`); }
  params.push(limit);

  const { rows } = await pool.query(`
    SELECT r.*,
           so.nombre AS sucursal_origen_nombre,
           sd.nombre AS sucursal_destino_nombre,
           (SELECT COUNT(*) FROM lineas_remision lr WHERE lr.remision_id = r.id)::int AS total_items
    FROM remisiones r
    JOIN sucursales so ON so.id = r.sucursal_origen_id
    JOIN sucursales sd ON sd.id = r.sucursal_destino_id
    WHERE r.negocio_id = $1 ${cond.length ? 'AND ' + cond.join(' AND ') : ''}
    ORDER BY r.fecha_emision DESC
    LIMIT $${params.length}
  `, params);
  return rows;
};

const marcarRemisionRecibida = async (client, { remisionId, usuarioId, estado, trasladoId }) => {
  const { rows } = await client.query(`
    UPDATE remisiones
    SET estado = $2, usuario_receptor_id = $3, fecha_recepcion = NOW(), traslado_id = $4
    WHERE id = $1
    RETURNING *
  `, [remisionId, estado, usuarioId, trasladoId || null]);
  return rows[0];
};

const marcarRemisionAnulada = async (client, remisionId) => {
  const { rows } = await client.query(
    `UPDATE remisiones SET estado = 'Anulada' WHERE id = $1 RETURNING *`,
    [remisionId]
  );
  return rows[0];
};

const marcarLineas = async (client, ids, estado, cantidades = null) => {
  if (!ids.length) return;
  if (cantidades) {
    await client.query(`
      UPDATE lineas_remision lr
      SET estado_linea = $2, cantidad_recibida = c.cant
      FROM unnest($1::bigint[], $3::int[]) AS c(id, cant)
      WHERE lr.id = c.id
    `, [ids, estado, cantidades]);
  } else {
    await client.query(
      `UPDATE lineas_remision SET estado_linea = $2 WHERE id = ANY($1::bigint[])`,
      [ids, estado]
    );
  }
};

// ── Catálogo de la bodega para armar la remisión ─────────────────────────────

// Producto de cantidad por CÓDIGO único (feature `codigo_producto_activo`).
// Permite despachar accesorios con el mismo lector que se usa para los IMEI.
const buscarCantidadPorCodigo = async (negocioId, sucursalOrigenId, codigo) => {
  const { rows } = await pool.query(`
    SELECT pc.id AS producto_id, pc.nombre, pc.codigo, pc.stock,
           COALESCE(pc.costo_unitario, 0) AS costo_unitario,
           pc.unidad_medida, pc.linea_id
    FROM productos_cantidad pc
    JOIN sucursales su ON su.id = pc.sucursal_id
    WHERE su.negocio_id = $1
      AND pc.sucursal_id = $2
      AND pc.activo = true
      AND UPPER(TRIM(pc.codigo)) = UPPER(TRIM($3))
    ORDER BY pc.id LIMIT 1
  `, [negocioId, sucursalOrigenId, codigo]);
  return rows[0] || null;
};

// Catálogo de accesorios de la bodega para elegir a mano (los que no tienen
// código, o cuando se prefiere buscar por nombre).
const buscarCantidadDisponible = async (negocioId, sucursalOrigenId, q = '') => {
  const filtro = (q || '').trim().toLowerCase().replace(/[%_\\]/g, '\\$&').slice(0, 60);
  const { rows } = await pool.query(`
    SELECT pc.id AS producto_id, pc.nombre, pc.codigo, pc.stock,
           COALESCE(pc.costo_unitario, 0) AS costo_unitario,
           pc.unidad_medida, pc.linea_id, lp.nombre AS linea_nombre
    FROM productos_cantidad pc
    JOIN sucursales su           ON su.id = pc.sucursal_id
    LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
    WHERE su.negocio_id = $1
      AND pc.sucursal_id = $2
      AND pc.activo = true
      AND pc.stock > 0
      AND ($3 = '' OR LOWER(pc.nombre) LIKE '%' || $3 || '%' ESCAPE '\\'
                   OR LOWER(COALESCE(pc.codigo, '')) LIKE '%' || $3 || '%' ESCAPE '\\')
    ORDER BY pc.nombre
    LIMIT 50
  `, [negocioId, sucursalOrigenId, filtro]);
  return rows;
};

// Referencias de una sucursal, para que el usuario elija el destino a mano
// cuando la resolución automática no está segura.
const buscarReferencias = async (negocioId, sucursalId, tipo, q = '') => {
  const filtro = (q || '').trim().toLowerCase().replace(/[%_\\]/g, '\\$&').slice(0, 60);

  if (tipo === 'serial') {
    const { rows } = await pool.query(`
      SELECT ps.id, ps.nombre, ps.marca, ps.modelo, ps.linea_id,
             lp.nombre AS linea_nombre,
             COUNT(s.id) FILTER (WHERE NOT s.vendido AND NOT s.prestado)::int AS disponibles
      FROM productos_serial ps
      JOIN sucursales su            ON su.id = ps.sucursal_id
      LEFT JOIN lineas_producto lp  ON lp.id = ps.linea_id
      LEFT JOIN seriales s          ON s.producto_id = ps.id
      WHERE su.negocio_id = $1 AND ps.sucursal_id = $2
        AND ($3 = '' OR LOWER(ps.nombre) LIKE '%' || $3 || '%' ESCAPE '\\'
                     OR LOWER(COALESCE(ps.marca, '')) LIKE '%' || $3 || '%' ESCAPE '\\')
      GROUP BY ps.id, lp.nombre
      ORDER BY ps.nombre LIMIT 50
    `, [negocioId, sucursalId, filtro]);
    return rows;
  }

  const { rows } = await pool.query(`
    SELECT pc.id, pc.nombre, pc.codigo, pc.stock, pc.linea_id,
           lp.nombre AS linea_nombre
    FROM productos_cantidad pc
    JOIN sucursales su           ON su.id = pc.sucursal_id
    LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
    WHERE su.negocio_id = $1 AND pc.sucursal_id = $2 AND pc.activo = true
      AND ($3 = '' OR LOWER(pc.nombre) LIKE '%' || $3 || '%' ESCAPE '\\'
                   OR LOWER(COALESCE(pc.codigo, '')) LIKE '%' || $3 || '%' ESCAPE '\\')
    ORDER BY pc.nombre LIMIT 50
  `, [negocioId, sucursalId, filtro]);
  return rows;
};

// ─────────────────────────────────────────────────────────────────────────────
// DETECTOR DE REFERENCIAS DUPLICADAS
//
// Encuentra el desorden que YA existe en el catálogo. No corrige nada: fusionar
// stock e historial adivinando sería irreversible. Solo señala, para que una
// persona decida.
//
// Dos señales, de más a menos fiable:
//   1. Mismo CÓDIGO con nombres distintos → casi seguro es el mismo producto.
//   2. Mismo nombre normalizado repetido dentro de UNA sucursal → duplicado real.
// ─────────────────────────────────────────────────────────────────────────────
const getReferenciasDuplicadas = async (negocioId) => {
  const NORMSQL = (col) => `
    regexp_replace(trim(translate(lower(COALESCE(${col}, '')),
      'áàäâãéèëêíìïîóòöôõúùüûñç-_', 'aaaaaeeeeiiiiooooouuuunc  ')),
      '[[:space:]]+', ' ', 'g')`;

  const [porCodigo, enMismaSucursal, mudos] = await Promise.all([
    // 1. Mismo código, nombres distintos.
    pool.query(`
      SELECT pc.codigo,
             JSON_AGG(JSON_BUILD_OBJECT(
               'id', pc.id, 'nombre', pc.nombre, 'stock', pc.stock,
               'sucursal_id', pc.sucursal_id, 'sucursal_nombre', su.nombre
             ) ORDER BY pc.id) AS filas
      FROM productos_cantidad pc
      JOIN sucursales su ON su.id = pc.sucursal_id
      WHERE su.negocio_id = $1 AND pc.activo = true AND pc.codigo IS NOT NULL
      GROUP BY pc.codigo
      HAVING COUNT(DISTINCT ${NORMSQL('pc.nombre')}) > 1
      ORDER BY pc.codigo
    `, [negocioId]),

    // 2. Mismo nombre repetido dentro de la misma sucursal.
    pool.query(`
      SELECT su.nombre AS sucursal_nombre, pc.sucursal_id,
             ${NORMSQL('pc.nombre')} AS nombre_normalizado,
             JSON_AGG(JSON_BUILD_OBJECT(
               'id', pc.id, 'nombre', pc.nombre, 'stock', pc.stock, 'codigo', pc.codigo
             ) ORDER BY pc.id) AS filas
      FROM productos_cantidad pc
      JOIN sucursales su ON su.id = pc.sucursal_id
      WHERE su.negocio_id = $1 AND pc.activo = true
      GROUP BY su.nombre, pc.sucursal_id, ${NORMSQL('pc.nombre')}
      HAVING COUNT(*) > 1
      ORDER BY su.nombre
    `, [negocioId]),

    // 3. Referencias sin código cuando el mismo producto SÍ lo tiene en otra
    //    sucursal: el lector no las encuentra. Es el síntoma más molesto.
    pool.query(`
      SELECT pc.id, pc.nombre, pc.stock, pc.sucursal_id, su.nombre AS sucursal_nombre,
             (SELECT o.codigo FROM productos_cantidad o
              JOIN sucursales so ON so.id = o.sucursal_id
              WHERE so.negocio_id = $1 AND o.activo AND o.codigo IS NOT NULL
                AND ${NORMSQL('o.nombre')} = ${NORMSQL('pc.nombre')}
              ORDER BY o.id LIMIT 1) AS codigo_esperado
      FROM productos_cantidad pc
      JOIN sucursales su ON su.id = pc.sucursal_id
      WHERE su.negocio_id = $1 AND pc.activo = true AND pc.codigo IS NULL
        AND EXISTS (
          SELECT 1 FROM productos_cantidad o
          JOIN sucursales so ON so.id = o.sucursal_id
          WHERE so.negocio_id = $1 AND o.activo AND o.codigo IS NOT NULL
            AND ${NORMSQL('o.nombre')} = ${NORMSQL('pc.nombre')}
        )
      ORDER BY pc.nombre
    `, [negocioId]),
  ]);

  return {
    mismo_codigo_distinto_nombre: porCodigo.rows,
    repetidos_en_una_sucursal:    enMismaSucursal.rows,
    sin_codigo_teniendolo:        mudos.rows,
    total: porCodigo.rows.length + enMismaSucursal.rows.length + mudos.rows.length,
  };
};

// Datos de un producto de cantidad concreto (para resolver ítems del carrito).
const findCantidadById = async (negocioId, sucursalOrigenId, productoId) => {
  const { rows } = await pool.query(`
    SELECT pc.id AS producto_id, pc.nombre, pc.codigo, pc.stock,
           COALESCE(pc.costo_unitario, 0) AS costo_unitario, pc.unidad_medida
    FROM productos_cantidad pc
    JOIN sucursales su ON su.id = pc.sucursal_id
    WHERE su.negocio_id = $1 AND pc.sucursal_id = $2 AND pc.id = $3 AND pc.activo = true
  `, [negocioId, sucursalOrigenId, productoId]);
  return rows[0] || null;
};

// Serial por id (para resolver ítems que vienen del carrito, donde no hay IMEI).
const findSerialById = async (negocioId, sucursalOrigenId, serialId) => {
  const { rows } = await pool.query(`
    SELECT s.id AS serial_id, s.imei, s.vendido, s.prestado,
           COALESCE(s.costo_compra, 0) AS costo_compra,
           ps.id AS producto_id, ps.nombre, ps.marca, ps.modelo,
           EXISTS (
             SELECT 1 FROM lineas_remision lr
             WHERE lr.serial_id = s.id AND lr.estado_linea IN ('Pendiente', 'Recibida')
           ) AS ya_remisionado
    FROM seriales s
    JOIN productos_serial ps ON ps.id = s.producto_id
    JOIN sucursales su       ON su.id = ps.sucursal_id
    WHERE su.negocio_id = $1 AND ps.sucursal_id = $2 AND s.id = $3
  `, [negocioId, sucursalOrigenId, serialId]);
  return rows[0] || null;
};

const buscarSerialDisponible = async (negocioId, sucursalOrigenId, imei) => {
  const { rows } = await pool.query(`
    SELECT s.id AS serial_id, s.imei, s.vendido, s.prestado,
           COALESCE(s.costo_compra, 0) AS costo_compra,
           ps.id AS producto_id, ps.nombre, ps.marca, ps.modelo, ps.linea_id,
           EXISTS (
             SELECT 1 FROM lineas_remision lr
             WHERE lr.serial_id = s.id AND lr.estado_linea IN ('Pendiente', 'Recibida')
           ) AS ya_remisionado
    FROM seriales s
    JOIN productos_serial ps ON ps.id = s.producto_id
    JOIN sucursales su       ON su.id = ps.sucursal_id
    WHERE su.negocio_id = $1
      AND ps.sucursal_id = $2
      AND UPPER(TRIM(s.imei)) = UPPER(TRIM($3))
    LIMIT 1
  `, [negocioId, sucursalOrigenId, imei]);
  return rows[0] || null;
};

// ── Remesas (escritura) ──────────────────────────────────────────────────────

const crearRemesa = async (client, r) => {
  const { rows } = await client.query(`
    INSERT INTO remesas
      (negocio_id, sucursal_origen_id, sucursal_destino_id,
       cuenta_origen_id, cuenta_transito_id, cuenta_destino_id,
       valor, metodo, estado, mov_salida_id, mov_transito_id, mov_entrada_id,
       usuario_envia_id, clave_idempotencia, notas)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    RETURNING *
  `, [r.negocio_id, r.sucursal_origen_id, r.sucursal_destino_id,
      r.cuenta_origen_id || null, r.cuenta_transito_id || null, r.cuenta_destino_id || null,
      r.valor, r.metodo || 'Efectivo', r.estado || 'En transito',
      r.mov_salida_id || null, r.mov_transito_id || null, r.mov_entrada_id || null,
      r.usuario_envia_id || null, r.clave_idempotencia || null, r.notas || null]);
  return rows[0];
};

const findRemesaById = async (negocioId, id, client = null) => {
  const { rows } = await (client || pool).query(`
    SELECT r.*, so.nombre AS sucursal_origen_nombre, sd.nombre AS sucursal_destino_nombre
    FROM remesas r
    JOIN sucursales so ON so.id = r.sucursal_origen_id
    JOIN sucursales sd ON sd.id = r.sucursal_destino_id
    WHERE r.id = $1 AND r.negocio_id = $2
    ${client ? 'FOR UPDATE OF r' : ''}
  `, [id, negocioId]);
  return rows[0] || null;
};

const findRemesas = async (negocioId, { sucursalId, rol, estado, limit = 50 } = {}) => {
  const cond = [];
  const params = [negocioId];
  if (sucursalId) {
    params.push(sucursalId);
    if (rol === 'destino')     cond.push(`r.sucursal_destino_id = $${params.length}`);
    else if (rol === 'origen') cond.push(`r.sucursal_origen_id  = $${params.length}`);
    else cond.push(`(r.sucursal_destino_id = $${params.length} OR r.sucursal_origen_id = $${params.length})`);
  }
  if (estado) { params.push(estado); cond.push(`r.estado = $${params.length}`); }
  params.push(limit);

  const { rows } = await pool.query(`
    SELECT r.*, so.nombre AS sucursal_origen_nombre, sd.nombre AS sucursal_destino_nombre,
           ue.nombre AS usuario_envia_nombre, ur.nombre AS usuario_recibe_nombre
    FROM remesas r
    JOIN sucursales so    ON so.id = r.sucursal_origen_id
    JOIN sucursales sd    ON sd.id = r.sucursal_destino_id
    LEFT JOIN usuarios ue ON ue.id = r.usuario_envia_id
    LEFT JOIN usuarios ur ON ur.id = r.usuario_recibe_id
    WHERE r.negocio_id = $1 ${cond.length ? 'AND ' + cond.join(' AND ') : ''}
    ORDER BY r.fecha_envio DESC
    LIMIT $${params.length}
  `, params);
  return rows;
};

const marcarRemesaRecibida = async (client, { remesaId, usuarioId, movEntradaId }) => {
  const { rows } = await client.query(`
    UPDATE remesas
    SET estado = 'Recibida', usuario_recibe_id = $2, fecha_recepcion = NOW(), mov_entrada_id = $3
    WHERE id = $1
    RETURNING *
  `, [remesaId, usuarioId, movEntradaId || null]);
  return rows[0];
};

const marcarRemesaAnulada = async (client, remesaId) => {
  const { rows } = await client.query(
    `UPDATE remesas SET estado = 'Anulada' WHERE id = $1 RETURNING *`,
    [remesaId]
  );
  return rows[0];
};

const findRemesaPorClave = async (clave) => {
  if (!clave) return null;
  const { rows } = await pool.query('SELECT * FROM remesas WHERE clave_idempotencia = $1', [clave]);
  return rows[0] || null;
};

const findRemisionPorClave = async (clave) => {
  if (!clave) return null;
  const { rows } = await pool.query('SELECT * FROM remisiones WHERE clave_idempotencia = $1', [clave]);
  return rows[0] || null;
};

// ── Cuenta interna (gastos autorizados / ajustes / cortes) ───────────────────

const insertarMovimientoCuenta = async (client, m) => {
  const { rows } = await (client || pool).query(`
    INSERT INTO movimientos_cuenta_interna
      (negocio_id, sucursal_id, tipo, valor, saldo_congelado, mov_dinero_id, concepto, usuario_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING *
  `, [m.negocio_id, m.sucursal_id, m.tipo, m.valor || 0, m.saldo_congelado ?? null,
      m.mov_dinero_id || null, m.concepto || null, m.usuario_id || null]);
  return rows[0];
};

const findMovimientosCuenta = async (negocioId, sucursalId, limit = 100) => {
  const { rows } = await pool.query(`
    SELECT m.*, u.nombre AS usuario_nombre
    FROM movimientos_cuenta_interna m
    LEFT JOIN usuarios u ON u.id = m.usuario_id
    WHERE m.negocio_id = $1 AND m.sucursal_id = $2 AND NOT m.anulado
    ORDER BY m.fecha DESC
    LIMIT $3
  `, [negocioId, sucursalId, limit]);
  return rows;
};

// ── Sucursales del negocio (bodega + locales) ────────────────────────────────

const getSucursales = async (negocioId) => {
  const { rows } = await pool.query(
    `SELECT id, nombre FROM sucursales WHERE negocio_id = $1 AND activa = true ORDER BY id`,
    [negocioId]
  );
  return rows;
};

// ── Panel de salud: los invariantes, verificables a demanda ──────────────────
const getChequeosSalud = async (negocioId) => {
  const [sinUbicar, movidas, transitoViejo, remesasHuerfanas, dupSerial] = await Promise.all([
    pool.query(`
      SELECT c.linea_id, c.imei, c.nombre_producto, c.valor_interno, c.sucursal_destino_id
      FROM (${SQL_UNIDADES}) c WHERE c.estado_unidad = 'Sin ubicar'
    `, [negocioId, null]),

    pool.query(`
      SELECT c.linea_id, c.imei, c.nombre_producto, c.sucursal_destino_id, c.sucursal_actual
      FROM (${SQL_UNIDADES}) c WHERE c.estado_unidad = 'Movida'
    `, [negocioId, null]),

    pool.query(`
      SELECT id, numero, sucursal_destino_id, fecha_emision
      FROM remisiones
      WHERE negocio_id = $1 AND estado = 'En transito'
        AND fecha_emision < NOW() - INTERVAL '7 days'
    `, [negocioId]),

    // Toda remesa no anulada debe tener su pata de salida en movimientos_dinero.
    pool.query(`
      SELECT r.id, r.numero, r.valor, r.estado
      FROM remesas r
      WHERE r.negocio_id = $1 AND r.estado <> 'Anulada'
        AND (r.mov_salida_id IS NULL
          OR NOT EXISTS (SELECT 1 FROM movimientos_dinero md WHERE md.id = r.mov_salida_id))
    `, [negocioId]),

    // Un IMEI remisionado no puede tener dos filas vivas en `seriales`.
    //
    // Cuenta DISTINCT s.id, no COUNT(*): un mismo IMEI aparece en varias
    // `lineas_remision` en cuanto se despacha y luego se devuelve (una línea de
    // entrega + una de devolución, ambas legítimas). Con COUNT(*) el join
    // multiplicaba líneas × seriales y reportaba "2 filas" con una sola fila en
    // `seriales` — un falso positivo que dejaba el panel de salud en rojo para
    // cualquier negocio que devuelva mercancía a la bodega.
    pool.query(`
      SELECT lr.imei, COUNT(DISTINCT s.id)::int AS filas
      FROM lineas_remision lr
      JOIN remisiones r ON r.id = lr.remision_id
      JOIN seriales s   ON UPPER(TRIM(s.imei)) = UPPER(TRIM(lr.imei))
      JOIN productos_serial ps ON ps.id = s.producto_id
      JOIN sucursales su       ON su.id = ps.sucursal_id
      WHERE r.negocio_id = $1 AND su.negocio_id = $1
        AND lr.tipo = 'serial' AND lr.imei IS NOT NULL
      GROUP BY lr.imei
      HAVING COUNT(DISTINCT s.id) > 1
    `, [negocioId]),
  ]);

  return {
    sin_ubicar:        sinUbicar.rows,
    movidas:           movidas.rows,
    transito_vencido:  transitoViejo.rows,
    remesas_huerfanas: remesasHuerfanas.rows,
    imeis_duplicados:  dupSerial.rows,
  };
};

// ── Valor de consignación de unidades seriales que están en un local ─────────
//
// Para un local, el costo real de una unidad NO es `seriales.costo_compra` (esa
// es la verdad del costo de la BODEGA, que a propósito nunca se reescribe al
// remisionar): es el `valor_interno` que la bodega le puso en la remisión, que
// es lo que el local debe liquidar cuando la venda.
//
// Solo devuelve las unidades que siguen EN CONSIGNACIÓN — o sea, las que aún no
// se han vendido desde este local. Si la unidad ya se vendió y volvió (retoma),
// su ciclo de consignación se cerró y su costo dejó de ser el valor interno:
// queda fuera y el llamador la trata como unidad propia.
//
// El cruce lineas_remision → seriales va por `serial_id`, nunca por IMEI (un
// mismo IMEI tiene varias filas históricas en `seriales`). El único cruce por
// IMEI es contra `lineas_factura`, que no tiene serial_id, y va acotado a las
// facturas de la sucursal destino posteriores al despacho — el mismo criterio
// que usa SQL_UNIDADES.
const getValorConsignacionSeriales = async (negocioId, sucursalId, serialIds) => {
  if (!serialIds?.length) return [];
  const { rows } = await pool.query(`
    SELECT lr.serial_id, lr.valor_interno
    FROM lineas_remision lr
    JOIN remisiones r ON r.id = lr.remision_id
    WHERE r.negocio_id          = $1
      AND r.sucursal_destino_id = $2
      AND r.tipo                = 'entrega'
      AND r.estado             <> 'Anulada'
      AND lr.tipo               = 'serial'
      AND lr.estado_linea       = 'Recibida'
      AND lr.serial_id = ANY($3::int[])
      AND NOT EXISTS (
        SELECT 1
        FROM lineas_factura lf
        JOIN facturas f ON f.id = lf.factura_id
        WHERE UPPER(TRIM(lf.imei)) = UPPER(TRIM(lr.imei))
          AND f.sucursal_id = r.sucursal_destino_id
          AND f.estado     <> 'Cancelada'
          AND f.fecha      >= r.fecha_emision
      )
  `, [negocioId, sucursalId, serialIds]);
  return rows;
};

module.exports = {
  getUnidades, buscarUnidades, getExtracto, getResumenUnidades, getCantidadConsignada,
  getValorConsignacionSeriales,
  getTotalRemesado, getTotalMovimientosCuenta, getConciliacion, getResumenPorRemision,
  crearRemision, insertarLineaRemision, actualizarTotalRemision,
  findRemisionById, getLineasRemision, getLineasDetalladas, findRemisiones,
  insertarCorreccion, getCorreccionesRemision,
  marcarRemisionRecibida, marcarRemisionAnulada, marcarLineas,
  buscarSerialDisponible, buscarCantidadPorCodigo, buscarCantidadDisponible,
  findCantidadById, findSerialById, buscarReferencias, getReferenciasDuplicadas,
  crearRemesa, findRemesaById, findRemesas, marcarRemesaRecibida, marcarRemesaAnulada,
  findRemesaPorClave, findRemisionPorClave,
  insertarMovimientoCuenta, findMovimientosCuenta,
  getSucursales, getChequeosSalud,
};
