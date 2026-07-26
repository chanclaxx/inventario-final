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
      AND f.fecha  >= COALESCE(b.fecha_recepcion, b.fecha_emision)
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
       cantidad, cantidad_recibida, valor_interno, estado_linea, nombre_producto)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *
  `, [l.remision_id, l.tipo, l.serial_id || null, l.imei || null,
      l.producto_origen_id || null, l.producto_destino_id || null,
      l.cantidad || 1, l.cantidad_recibida ?? null, l.valor_interno || 0,
      l.estado_linea || 'Pendiente', l.nombre_producto || null]);
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

const findRemisiones = async (negocioId, { sucursalId, rol, estado, limit = 50 } = {}) => {
  const cond = [];
  const params = [negocioId];
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
    pool.query(`
      SELECT lr.imei, COUNT(*)::int AS filas
      FROM lineas_remision lr
      JOIN remisiones r ON r.id = lr.remision_id
      JOIN seriales s   ON UPPER(TRIM(s.imei)) = UPPER(TRIM(lr.imei))
      JOIN productos_serial ps ON ps.id = s.producto_id
      JOIN sucursales su       ON su.id = ps.sucursal_id
      WHERE r.negocio_id = $1 AND su.negocio_id = $1
        AND lr.tipo = 'serial' AND lr.imei IS NOT NULL
      GROUP BY lr.imei
      HAVING COUNT(*) > 1
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

module.exports = {
  getUnidades, getResumenUnidades, getCantidadConsignada,
  getTotalRemesado, getTotalMovimientosCuenta, getConciliacion,
  crearRemision, insertarLineaRemision, actualizarTotalRemision,
  findRemisionById, getLineasRemision, findRemisiones,
  marcarRemisionRecibida, marcarRemisionAnulada, marcarLineas,
  buscarSerialDisponible,
  crearRemesa, findRemesaById, findRemesas, marcarRemesaRecibida, marcarRemesaAnulada,
  findRemesaPorClave, findRemisionPorClave,
  insertarMovimientoCuenta, findMovimientosCuenta,
  getSucursales, getChequeosSalud,
};
