const { pool } = require('../../config/db');
// La feature de pedidos agrega dos columnas a `remisiones` y `lineas_remision`.
// Si su migración no llegó a aplicarse, nombrarlas tumbaría el despacho entero
// —la operación diaria de un módulo que ya está en producción—, así que se
// interpolan solo cuando existen. Ver src/config/columnas.js.
const { hayPedidosInternos } = require('../../config/columnas');

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
      ps.sucursal_id AS sucursal_actual,
      -- DOS NOMBRES PARA EL MISMO EQUIPO. El catálogo es por sucursal, así que
      -- la bodega y el local pueden escribir distinto el mismo modelo:
      --   po.nombre → la referencia de la BODEGA
      --   ps.nombre → la referencia de donde está el equipo HOY
      -- Si no coinciden, o el local lo escribe distinto o el despacho se
      -- equivocó de referencia. La pantalla lo muestra para que alguien mire.
      --
      -- Se comparan los dos nombres del CATÁLOGO y no lr.nombre_producto: ese
      -- guarda "nombre marca modelo" concatenados, así que enfrentarlo contra
      -- un nombre pelado marcaría diferencia en TODAS las unidades.
      po.nombre AS nombre_producto_bodega,
      ps.nombre AS nombre_producto_local
    FROM lineas_remision lr
    JOIN remisiones r             ON r.id  = lr.remision_id
    LEFT JOIN seriales s          ON s.id  = lr.serial_id
    LEFT JOIN productos_serial ps ON ps.id = s.producto_id
    LEFT JOIN productos_serial po ON po.id = lr.producto_origen_id
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
      SELECT
        u.*,
        pv.prestatario_nombre, pv.prestamo_numero, pv.prestamo_fecha,
        dv.devolucion_numero,  dv.fecha_devolucion
      FROM (${SQL_UNIDADES}) u

      -- ¿A DÓNDE FUE EL EQUIPO? De una venta ya se sabe (factura y cliente
      -- vienen del cruce principal); de un préstamo no se sabía. Los LATERAL
      -- van aquí y no en SQL_UNIDADES a propósito: solo corren sobre la página
      -- que se está mostrando, no sobre los agregados de toda la sucursal.
      LEFT JOIN LATERAL (
        SELECT COALESCE(pr.nombre, p.prestatario) AS prestatario_nombre,
               p.numero AS prestamo_numero, p.fecha AS prestamo_fecha
        FROM prestamos p
        LEFT JOIN prestatarios pr ON pr.id = p.prestatario_id
        -- Mismos candados que el cruce de ventas: préstamos de ESTA sucursal,
        -- vivos, y posteriores al despacho. Sin ellos el fan-out de IMEI
        -- traería préstamos viejos de otro equipo con el mismo número.
        WHERE u.estado_unidad = 'En prestamo'
          AND u.imei IS NOT NULL
          AND UPPER(TRIM(p.imei)) = UPPER(TRIM(u.imei))
          AND p.sucursal_id = u.sucursal_destino_id
          AND p.estado      = 'Activo'
          AND p.fecha      >= u.fecha_emision
        ORDER BY p.fecha DESC, p.id DESC
        LIMIT 1
      ) pv ON TRUE

      -- Cuándo volvió a la bodega. Va por serial_id, nunca por IMEI.
      LEFT JOIN LATERAL (
        SELECT r2.numero AS devolucion_numero,
               COALESCE(r2.fecha_recepcion, r2.fecha_emision) AS fecha_devolucion
        FROM lineas_remision lr2
        JOIN remisiones r2 ON r2.id = lr2.remision_id
        WHERE u.estado_unidad = 'Devuelta'
          AND lr2.serial_id = u.serial_id
          AND r2.tipo   = 'devolucion'
          AND r2.estado <> 'Anulada'
        ORDER BY r2.fecha_emision DESC
        LIMIT 1
      ) dv ON TRUE

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
      -- CARGO: la bodega le entregó un envío. Es el hecho que genera la deuda
      -- desde el cambio de modelo: el local paga lo que recibe, no lo que vende.
      --
      -- El valor es el ORIGINAL del envío (lo recibido MÁS lo que después
      -- devolvió), y la devolución baja aparte, con su propia fecha. Si se
      -- usara el cargo de hoy —que ya excluye lo devuelto— una devolución
      -- reescribiría hacia atrás un cargo que el local ya había visto.
      SELECT
        rm.fecha_recepcion                           AS fecha,
        'cargo'                                      AS clase,
        'remision'                                   AS origen,
        'Envío recibido'                             AS concepto,
        cargo.total                                  AS valor,
        NULL                                         AS referencia,
        rm.numero                                    AS documento,
        ue.nombre                                    AS tercero,
        cargo.items::text || ' producto(s)'          AS detalle
      FROM remisiones rm
      LEFT JOIN usuarios ue ON ue.id = rm.usuario_emisor_id
      JOIN LATERAL (
        SELECT
          COALESCE(SUM(
            lr.valor_interno * CASE WHEN lr.tipo = 'serial'
                                    THEN 1
                                    ELSE COALESCE(lr.cantidad_recibida, lr.cantidad, 0) END
          ), 0) AS total,
          COUNT(*)::int AS items
        FROM lineas_remision lr
        WHERE lr.remision_id = rm.id
          AND lr.estado_linea IN ('Recibida', 'Devuelta')
      ) cargo ON cargo.total > 0
      WHERE rm.negocio_id = $1 AND rm.sucursal_destino_id = $2
        AND rm.tipo = 'entrega' AND rm.estado IN ('Recibida', 'Parcial')

      UNION ALL
      -- NOTA CRÉDITO: mercancía que el local devolvió y la bodega recibió.
      -- Baja la deuda porque el cargo de su envío deja de contarla.
      --
      -- Cubre los dos tipos, y cada uno con su fuente:
      --   · SERIAL   → su valor_interno. Al confirmarse, su línea de entrega
      --     pasó a 'Devuelta' y salió del cargo por ese mismo importe.
      --   · CANTIDAD → valor_acreditado, el reparto FIFO real (cada tramo al
      --     valor de SU lote). El valor_interno de la línea de devolución no
      --     sirve: es solo lo que se ofreció al crearla, y una devolución que
      --     cruza dos lotes se acredita a dos precios.
      --
      -- Antes solo contaba seriales, porque los accesorios se acreditaban con un
      -- Ajuste. Al pasar a lotes ese Ajuste desapareció (habría duplicado la
      -- baja) y nadie extendió esta rama: el cargo bajaba y el extracto no
      -- mostraba ningún movimiento que lo explicara, así que su saldo dejaba de
      -- cuadrar con la deuda.
      SELECT rd.fecha_recepcion, 'abono', 'devolucion',
             'Devolución recibida en bodega', -dev.total,
             NULL, rd.numero, ud.nombre,
             dev.items::text || ' producto(s)'
      FROM remisiones rd
      LEFT JOIN usuarios ud ON ud.id = rd.usuario_emisor_id
      JOIN LATERAL (
        SELECT COALESCE(SUM(
                 CASE WHEN lr.tipo = 'serial' THEN lr.valor_interno
                      ELSE COALESCE(lr.valor_acreditado, 0) END
               ), 0) AS total,
               COUNT(*)::int AS items
        FROM lineas_remision lr
        WHERE lr.remision_id = rd.id
          AND lr.estado_linea = 'Devuelta'
          AND (lr.tipo = 'cantidad' OR lr.origen_unidad = 'bodega')
      ) dev ON dev.total > 0
      WHERE rd.negocio_id = $1 AND rd.sucursal_origen_id = $2
        AND rd.tipo = 'devolucion' AND rd.estado IN ('Recibida', 'Parcial')

      UNION ALL
      -- ABONO: remesa de efectivo confirmada por la bodega
      SELECT r.fecha_recepcion, 'abono', 'remesa',
             'Remesa recibida', -r.valor,
             NULL, r.numero, ur.nombre, r.notas
      FROM remesas r
      LEFT JOIN usuarios ur ON ur.id = r.usuario_envia_id
      WHERE r.negocio_id = $1 AND r.sucursal_origen_id = $2 AND r.estado = 'Recibida'

      UNION ALL
      -- ABONO: gasto que el local pagó por cuenta de la bodega.
      --
      -- Solo el APROBADO mueve el saldo. El que espera visto bueno y el
      -- rechazado igual se listan —el local tiene que ver en qué quedó lo que
      -- registró— pero con valor 0, como cualquier informativo. Si contaran,
      -- el extracto dejaría de cuadrar con la deuda.
      SELECT m.fecha,
             CASE WHEN m.estado = 'Aprobado' THEN 'abono' ELSE 'info' END,
             'gasto',
             COALESCE(m.concepto, 'Gasto por cuenta de bodega')
               || CASE m.estado WHEN 'Por aprobar' THEN ' (esperando visto bueno)'
                                WHEN 'Rechazado'   THEN ' (rechazado por la bodega)'
                                ELSE '' END,
             CASE WHEN m.estado = 'Aprobado' THEN -m.valor ELSE 0 END,
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
        AND NOT m.anulado AND m.estado = 'Aprobado' AND m.tipo = 'Ajuste'

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
      -- INFORMATIVO: el local vendió una unidad de la bodega.
      --
      -- Ya NO mueve el saldo: la deuda nació cuando el envío llegó. Sigue en el
      -- extracto porque es lo que el local quiere ver ("¿de dónde salió la
      -- plata que estoy entregando?"), con el valor en 0 para que no sume.
      SELECT
        u.factura_fecha, 'info', 'venta',
        'Vendido: ' || COALESCE(u.nombre_producto, 'producto'), 0,
        u.imei, u.factura_numero, u.nombre_cliente,
        CASE WHEN u.credito_id IS NOT NULL THEN 'a crédito' ELSE 'de contado' END
      FROM u
      WHERE u.factura_fecha IS NOT NULL
        AND u.estado_unidad IN ('Por liquidar', 'En recaudo')
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
    WHERE negocio_id = $1 AND NOT anulado AND estado = 'Aprobado'
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
                    -- Los AJUSTES también restan (así lo hace _armarSaldo).
                    -- Omitirlos aquí hacía que esta vista marcara como "no
                    -- liquidada" una unidad que el saldo del panel ya daba por
                    -- pagada — y los ajustes se crean solos cuando una
                    -- devolución genera saldo a favor.
                    AND tipo IN ('GastoAutorizado', 'Ajuste')), 0) AS total
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

// ═════════════════════════════════════════════════════════════════════════════
// LA CUENTA DEL ENVÍO — cargo, abonos y saldo
//
// Desde el cambio de modelo (agosto 2026) el ENVÍO es el documento de deuda:
// el local paga todo lo que la bodega le entrega, esté vendido o no. Que se
// haya vendido sigue calculándose (SQL_UNIDADES) pero ya solo informa.
//
// CARGO — derivado, nunca escrito.
//   Es la suma de las líneas que el local RECIBIÓ. Las que nunca llegaron
//   ('Faltante') y las que devolvió ('Devuelta') no cargan, y eso lo resuelve
//   el propio estado de la línea: una devolución confirmada marca la línea de
//   entrega como 'Devuelta' y el cargo baja solo. No hay contra-asiento que
//   pueda quedar desincronizado.
//
// ABONO — escrito, porque es una decisión de una persona.
//   A qué envío se imputa un pago no se puede derivar de ninguna otra tabla.
//   Vive en `abonos_remision` (20260822_red_interna_envios.sql).
// ═════════════════════════════════════════════════════════════════════════════

// Cargo por remisión. Un serial vale su `valor_interno`; una línea de cantidad,
// el valor por lo que efectivamente entró MENOS lo que ya se devolvió de ese
// lote.
//
// El descuento por `cantidad_devuelta` es el equivalente fungible del
// 'Devuelta' de un serial: un serial se devuelve entero y su línea sale del
// cargo; de una línea de cantidad se devuelven 2 de 5 y el cargo tiene que
// bajar solo esas 2. Sin esto habría que acreditarlo aparte y el cargo del
// envío seguiría diciendo que el local debe las 5.
const SQL_CARGO_ENVIO = `
  SELECT lr.remision_id,
         COALESCE(SUM(
           lr.valor_interno * CASE WHEN lr.tipo = 'serial'
                                   THEN 1
                                   ELSE GREATEST(
                                     COALESCE(lr.cantidad_recibida, lr.cantidad, 0)
                                       - COALESCE(lr.cantidad_devuelta, 0), 0) END
         ), 0) AS cargo
  FROM lineas_remision lr
  WHERE lr.estado_linea = 'Recibida'
  GROUP BY lr.remision_id
`;

// Abonos que de verdad cuentan.
//
// Una remesa EN TRÁNSITO no baja la deuda —esa regla no cambió—, pero su
// imputación ya está elegida y guardada desde que el local la envió. Por eso
// el abono se escribe al pagar y solo se vuelve efectivo cuando la bodega
// confirma: así el local no tiene que volver a decidir a qué envío iba.
const SQL_ABONOS_EFECTIVOS = `
  SELECT a.*
  FROM abonos_remision a
  LEFT JOIN remesas rm                    ON rm.id = a.remesa_id
  LEFT JOIN movimientos_cuenta_interna mc ON mc.id = a.movimiento_id
  WHERE NOT a.anulado
    AND (a.origen <> 'remesa' OR rm.estado = 'Recibida')
    -- Un gasto o un ajuste solo baja la deuda cuando está aprobado y vivo. Es
    -- la misma regla de la remesa en tránsito, aplicada al otro lado.
    AND (a.movimiento_id IS NULL OR (mc.estado = 'Aprobado' AND NOT mc.anulado))
`;

// Abonos RESERVADOS: los mismos, más los de las remesas que van en camino.
//
// Solo se usan para repartir un pago nuevo. Sin esto, un local que manda dos
// remesas seguidas antes de que la bodega confirme la primera imputaría las
// dos al mismo envío y lo pagaría dos veces: la segunda no vería la reserva
// de la primera. Para MOSTRAR el saldo manda SQL_ABONOS_EFECTIVOS — una remesa
// sin confirmar no baja la deuda, y esa regla no cambió.
const SQL_ABONOS_RESERVADOS = `
  SELECT a.*
  FROM abonos_remision a
  LEFT JOIN remesas rm                    ON rm.id = a.remesa_id
  LEFT JOIN movimientos_cuenta_interna mc ON mc.id = a.movimiento_id
  WHERE NOT a.anulado
    AND (a.origen <> 'remesa' OR rm.estado <> 'Anulada')
    AND (a.movimiento_id IS NULL OR (mc.estado <> 'Rechazado' AND NOT mc.anulado))
`;

// Cargo, abonado y saldo de cada envío de un local.
//   $1 negocio_id   $2 sucursal_destino_id (NULL = todas)
const _sqlEnviosCuenta = (fuenteAbonos) => `
  SELECT
    r.id AS remision_id,
    COALESCE(c.cargo, 0)                                          AS cargo,
    COALESCE(a.abonado, 0)                                        AS abonado,
    GREATEST(0, COALESCE(c.cargo, 0) - COALESCE(a.abonado, 0))    AS saldo,
    -- Se pagó más de lo que el envío terminó valiendo: pasa cuando el local
    -- devuelve mercancía que ya había pagado. Es crédito suyo.
    GREATEST(0, COALESCE(a.abonado, 0) - COALESCE(c.cargo, 0))    AS excedente
  FROM remisiones r
  LEFT JOIN (${SQL_CARGO_ENVIO}) c ON c.remision_id = r.id
  LEFT JOIN (
    SELECT e.remision_id, SUM(e.valor) AS abonado
    FROM (${fuenteAbonos}) e
    GROUP BY e.remision_id
  ) a ON a.remision_id = r.id
  WHERE r.negocio_id = $1
    AND r.tipo = 'entrega'
    AND r.estado <> 'Anulada'
    AND ($2::int IS NULL OR r.sucursal_destino_id = $2)
`;

const SQL_ENVIOS_CUENTA  = _sqlEnviosCuenta(SQL_ABONOS_EFECTIVOS);
const SQL_ENVIOS_RESERVA = _sqlEnviosCuenta(SQL_ABONOS_RESERVADOS);

// La cuenta de un CARGO SUELTO: un ajuste en contra (una rotura, un faltante
// que la bodega le cobra al local).
//
// Se trata igual que un envío —cargo, abonado, saldo— porque es lo mismo: una
// deuda con su propio documento. Antes era una cifra suelta que nadie podía
// pagar: el FIFO solo repartía entre envíos, así que con los envíos al día el
// dinero se volvía saldo a favor y el cargo se quedaba ahí para siempre.
//   $1 negocio_id   $2 sucursal_id
const _sqlCargosCuenta = (fuenteAbonos) => `
  SELECT
    m.id                                                       AS cargo_id,
    (-m.valor)                                                 AS cargo,
    COALESCE(a.abonado, 0)                                     AS abonado,
    GREATEST(0, (-m.valor) - COALESCE(a.abonado, 0))           AS saldo,
    GREATEST(0, COALESCE(a.abonado, 0) - (-m.valor))           AS excedente,
    m.concepto, m.fecha
  FROM movimientos_cuenta_interna m
  LEFT JOIN (
    SELECT e.cargo_id, SUM(e.valor) AS abonado
    FROM (${fuenteAbonos}) e
    WHERE e.cargo_id IS NOT NULL
    GROUP BY e.cargo_id
  ) a ON a.cargo_id = m.id
  WHERE m.negocio_id = $1
    AND ($2::int IS NULL OR m.sucursal_id = $2)
    AND m.tipo = 'Ajuste' AND m.valor < 0
    AND NOT m.anulado AND m.estado = 'Aprobado'
`;

const SQL_CARGOS_CUENTA  = _sqlCargosCuenta(SQL_ABONOS_EFECTIVOS);
const SQL_CARGOS_RESERVA = _sqlCargosCuenta(SQL_ABONOS_RESERVADOS);

/**
 * Totales de la cuenta de un local bajo el modelo de envío a crédito.
 *
 * DEUDA = Σ saldo de los envíos. Nunca negativa: lo pagado de más no se resta
 * de otro envío por su cuenta, se acumula como SALDO A FAVOR y se aplica
 * explícitamente. Así la cifra grande siempre responde "cuánto tiene que pagar"
 * sin que un crédito escondido la haga mentir.
 *
 * SALDO A FAVOR = lo pagado de más en envíos ya cerrados (devoluciones
 * posteriores al pago) + la plata que llegó y todavía no se imputó a nada
 * (el local pagó más que su deuda total) − lo que ya se consumió.
 */
const getTotalesEnvios = async (negocioId, sucursalId, client = null) => {
  const { rows } = await (client || pool).query(`
    WITH env AS (${SQL_ENVIOS_CUENTA}),
    car AS (${SQL_CARGOS_CUENTA}),
    ab AS (SELECT * FROM (${SQL_ABONOS_EFECTIVOS}) x
           WHERE x.negocio_id = $1 AND x.sucursal_id = $2)
    SELECT
      COALESCE(SUM(env.cargo), 0)     AS cargo_total,
      COALESCE(SUM(env.abonado), 0)   AS abonado_total,
      COALESCE(SUM(env.saldo), 0)     AS deuda,
      COALESCE(SUM(env.excedente), 0) AS excedente,
      COUNT(*) FILTER (WHERE env.saldo > 0)::int AS envios_abiertos,
      COUNT(*)::int                              AS envios_total,
      -- Los cargos sueltos, con su propia cuenta.
      COALESCE((SELECT SUM(cargo)     FROM car), 0) AS cargos_valor,
      COALESCE((SELECT SUM(abonado)   FROM car), 0) AS cargos_abonado,
      COALESCE((SELECT SUM(excedente) FROM car), 0) AS cargos_excedente,
      COALESCE((SELECT COUNT(*) FILTER (WHERE saldo > 0) FROM car), 0)::int AS cargos_abiertos,
      -- Plata recibida que no llegó a imputarse a ningún envío.
      GREATEST(0,
        COALESCE((SELECT SUM(valor) FROM remesas
                  WHERE negocio_id = $1 AND sucursal_origen_id = $2
                    AND estado = 'Recibida'), 0)
      + COALESCE((SELECT SUM(valor) FROM movimientos_cuenta_interna
                  WHERE negocio_id = $1 AND sucursal_id = $2
                    AND NOT anulado AND estado = 'Aprobado'
                    AND tipo IN ('GastoAutorizado', 'Ajuste')
                    AND valor > 0), 0)
      - COALESCE((SELECT SUM(valor) FROM ab WHERE origen <> 'saldo_favor'), 0)
      )                               AS sin_imputar,
      COALESCE((SELECT SUM(valor) FROM ab WHERE origen = 'saldo_favor'), 0) AS favor_usado,
      -- Lo que queda debiendo por cargos. Es su SALDO, no su valor: un cargo se
      -- puede abonar como cualquier envío, y contarlo entero mostraría deuda
      -- que ya está pagada.
      COALESCE((SELECT SUM(saldo) FROM car), 0) AS cargos_sueltos
    FROM env
  `, [negocioId, sucursalId]);
  return rows[0];
};

/** Los abonos de un envío, para su estado de cuenta. */
const getAbonosDeEnvio = async (negocioId, remisionId) => {
  const { rows } = await pool.query(`
    SELECT a.id, a.origen, a.valor, a.fecha, a.notas, a.anulado,
           a.remesa_id, a.movimiento_id, a.cargo_id,
           rm.numero AS remesa_numero, rm.metodo, rm.estado AS remesa_estado,
           m.concepto AS movimiento_concepto, m.tipo AS movimiento_tipo,
           u.nombre  AS usuario_nombre
    FROM abonos_remision a
    LEFT JOIN remesas rm                    ON rm.id = a.remesa_id
    LEFT JOIN movimientos_cuenta_interna m  ON m.id  = a.movimiento_id
    LEFT JOIN usuarios u                    ON u.id  = a.usuario_id
    WHERE a.negocio_id = $1 AND (a.remision_id = $2 OR a.cargo_id = $2)
    ORDER BY a.fecha, a.id
  `, [negocioId, remisionId]);
  return rows;
};

/**
 * Las líneas de TODOS los envíos de un local, en UNA consulta.
 *
 * La tarjeta de cada envío muestra sus productos sin desplegar nada, así que
 * pedirlas envío por envío serían N consultas por pantalla. Se traen juntas y
 * el service las agrupa.
 *
 * Trae el estado derivado de la unidad (vendida, prestada, en vitrina…), que es
 * informativo: desde el cambio de modelo no toca la cuenta.
 */
// Líneas de las DEVOLUCIONES que una sucursal mandó, para poder mostrar el
// detalle de cada una: qué productos, cuántas unidades y cuánto se acreditó.
// Sin esto la devolución era un número suelto en el extracto y no había forma de
// saber qué llevaba dentro.
const getLineasDeDevoluciones = async (negocioId, sucursalId, { limit = 600 } = {}) => {
  const { rows } = await pool.query(`
    SELECT
      lr.remision_id,
      lr.id      AS linea_id,
      lr.tipo,
      lr.imei,
      lr.nombre_producto,
      lr.cantidad,
      lr.valor_interno,
      lr.estado_linea,
      lr.origen_unidad,
      -- Lo que de verdad se le acreditó: para un serial su valor; para una línea
      -- de cantidad, el reparto FIFO real (cada tramo al valor de su lote).
      CASE WHEN lr.tipo = 'serial' THEN lr.valor_interno
           ELSE lr.valor_acreditado END               AS valor_acreditado
    FROM lineas_remision lr
    JOIN remisiones r ON r.id = lr.remision_id
    WHERE r.negocio_id = $1
      AND r.tipo = 'devolucion'
      AND r.sucursal_origen_id = $2
    ORDER BY lr.remision_id DESC, lr.id
    LIMIT $3
  `, [negocioId, sucursalId, limit]);
  return rows;
};

const getLineasDeEnvios = async (negocioId, sucursalId, { limit = 600 } = {}) => {
  const { rows } = await pool.query(`
    WITH u AS (${SQL_UNIDADES})
    SELECT
      lr.remision_id,
      lr.id            AS linea_id,
      lr.tipo,
      lr.imei,
      lr.nombre_producto,
      lr.valor_interno,
      lr.estado_linea,
      COALESCE(lr.cantidad_recibida, lr.cantidad, 1) AS cantidad,
      -- Lo que de ESTA línea ya volvió a la bodega, con su plata. La tarjeta lo
      -- muestra al lado de lo entregado ("5 entregadas · 2 devueltas −$10.000")
      -- en vez de bajar el número en silencio: el local tiene que ver POR QUÉ
      -- bajó su cargo, no encontrarse con otra cifra.
      COALESCE(lr.cantidad_devuelta, 0)              AS cantidad_devuelta,
      COALESCE(lr.cantidad_devuelta, 0) * lr.valor_interno AS valor_devuelto,
      u.estado_unidad,
      u.factura_numero,
      u.nombre_cliente
    FROM lineas_remision lr
    JOIN remisiones r ON r.id = lr.remision_id
    LEFT JOIN u       ON u.linea_id = lr.id
    WHERE r.negocio_id = $1
      AND r.tipo = 'entrega'
      AND r.sucursal_destino_id = $2
    ORDER BY lr.remision_id DESC, lr.id
    LIMIT $3
  `, [negocioId, sucursalId, limit]);
  return rows;
};

/** Todos los abonos de un local, para el extracto y la pestaña de pagos. */
const findAbonosLocal = async (negocioId, sucursalId, limit = 300) => {
  const { rows } = await pool.query(`
    SELECT a.id, a.remision_id, a.cargo_id, a.origen, a.valor, a.fecha,
           a.notas, a.anulado, a.remesa_id, a.movimiento_id,
           r.numero  AS remision_numero,
           rm.numero AS remesa_numero, rm.metodo, rm.estado AS remesa_estado,
           m.concepto AS movimiento_concepto,
           u.nombre   AS usuario_nombre
    FROM abonos_remision a
    LEFT JOIN remisiones r                  ON r.id  = a.remision_id
    LEFT JOIN remesas rm                    ON rm.id = a.remesa_id
    LEFT JOIN movimientos_cuenta_interna m  ON m.id  = a.movimiento_id
    LEFT JOIN usuarios u                    ON u.id  = a.usuario_id
    WHERE a.negocio_id = $1 AND a.sucursal_id = $2 AND NOT a.anulado
    ORDER BY a.fecha DESC, a.id DESC
    LIMIT $3
  `, [negocioId, sucursalId, limit]);
  return rows;
};

/**
 * Envíos con saldo, del más viejo al más nuevo. Es la cola del FIFO con la que
 * se reparte un pago total.
 *
 * Se lee DENTRO de la transacción del pago (por eso recibe `client`): entre
 * calcular el reparto y escribirlo no puede colarse otro abono.
 */
/**
 * La cola del FIFO: TODO lo que el local debe, del más viejo al más nuevo.
 *
 * Envíos y cargos juntos, ordenados por fecha. Un cargo es tan pagable como un
 * envío: dejarlo fuera era lo que lo volvía impagable — el dinero pasaba de
 * largo y se convertía en saldo a favor mientras el cargo seguía ahí.
 */
const getEnviosAbiertos = async (client, negocioId, sucursalId) => {
  const { rows } = await client.query(`
    WITH env AS (${SQL_ENVIOS_RESERVA}), car AS (${SQL_CARGOS_RESERVA})
    SELECT * FROM (
      SELECT 'envio'::text AS tipo, env.remision_id, NULL::bigint AS cargo_id,
             env.saldo, r.numero::text AS etiqueta,
             COALESCE(r.fecha_recepcion, r.fecha_emision) AS fecha, r.id AS orden
      FROM env JOIN remisiones r ON r.id = env.remision_id
      WHERE env.saldo > 0
      UNION ALL
      SELECT 'cargo', NULL::bigint, car.cargo_id,
             car.saldo, car.concepto, car.fecha, car.cargo_id
      FROM car WHERE car.saldo > 0
    ) d
    ORDER BY d.fecha, d.orden
  `, [negocioId, sucursalId]);
  return rows;
};

/** Los cargos sueltos de un local, para mostrarlos junto a los envíos. */
const getCargosCuenta = async (negocioId, sucursalId) => {
  const { rows } = await pool.query(`
    WITH car AS (${SQL_CARGOS_CUENTA})
    SELECT car.*, u.nombre AS usuario_nombre
    FROM car
    JOIN movimientos_cuenta_interna m ON m.id = car.cargo_id
    LEFT JOIN usuarios u ON u.id = m.usuario_id
    ORDER BY car.fecha DESC
  `, [negocioId, sucursalId]);
  return rows;
};

/** El saldo de UN cargo, para imputarle un pago dirigido. */
const getSaldoCargo = async (client, negocioId, cargoId) => {
  const { rows } = await client.query(`
    WITH car AS (${SQL_CARGOS_RESERVA})
    SELECT car.*, m.sucursal_id
    FROM car JOIN movimientos_cuenta_interna m ON m.id = car.cargo_id
    WHERE car.cargo_id = $3
  `, [negocioId, null, cargoId]);
  return rows[0] || null;
};

/**
 * El saldo de UN envío, para imputarle un pago dirigido. Cuenta las reservas
 * (ver SQL_ABONOS_RESERVADOS), así que no deja pagar dos veces lo mismo.
 * Devuelve también la sucursal, porque quien imputa tiene que comprobar que el
 * envío sea de ese local y no de otro.
 */
const getSaldoEnvio = async (client, negocioId, remisionId) => {
  const { rows } = await client.query(`
    WITH env AS (${SQL_ENVIOS_RESERVA})
    SELECT env.*, r.numero, r.estado, r.sucursal_destino_id
    FROM env JOIN remisiones r ON r.id = env.remision_id
    WHERE env.remision_id = $3
  `, [negocioId, null, remisionId]);
  return rows[0] || null;
};

const insertarAbonoRemision = async (client, {
  negocio_id, sucursal_id, remision_id = null, cargo_id = null, origen,
  remesa_id = null, movimiento_id = null, valor, usuario_id = null, notas = null,
}) => {
  const { rows } = await client.query(`
    INSERT INTO abonos_remision
      (negocio_id, sucursal_id, remision_id, cargo_id, origen, remesa_id,
       movimiento_id, valor, usuario_id, notas)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING *
  `, [negocio_id, sucursal_id, remision_id, cargo_id, origen, remesa_id,
      movimiento_id, valor, usuario_id, notas]);
  return rows[0];
};

/** Anula la imputación de una remesa (al anular la remesa misma). */
const anularAbonosDeRemesa = async (client, remesaId) => {
  const { rowCount } = await client.query(
    `UPDATE abonos_remision SET anulado = TRUE WHERE remesa_id = $1 AND NOT anulado`,
    [remesaId]
  );
  return rowCount;
};

// ─────────────────────────────────────────────────────────────────────────────
// RESUMEN POR ENVÍO — "¿qué pasó con lo que me mandaron en cada remisión?"
//
// Dos cosas distintas en una sola consulta, y conviene no confundirlas:
//
//   LA CUENTA (cargo, abonado, saldo) — sale de SQL_ENVIOS_CUENTA. Es dinero:
//   lo que el local debe por ese envío y lo que ya pagó de él. Desde el cambio
//   de modelo el saldo es REAL, no una imputación: los abonos están escritos
//   contra este envío concreto, no repartidos por un FIFO virtual que cambiaba
//   de resultado cada vez que el local vendía algo.
//
//   EL ESTADO DE LA MERCANCÍA (vendidas, prestadas, disponibles…) — sale de
//   SQL_UNIDADES. Es INFORMATIVO: responde "de este envío qué vendí y qué me
//   queda", y no toca un peso de la cuenta.
//
// Los ACCESORIOS sí cuelgan de su envío ahora: valen cantidad_recibida ×
// valor_interno, que es un dato cierto de la línea. Antes se estimaban contra
// el stock global del local y la deuda bajaba sola si el local le compraba el
// mismo accesorio a otro proveedor.
// ─────────────────────────────────────────────────────────────────────────────
const getResumenPorRemision = async (negocioId, sucursalId, { limit = 100 } = {}) => {
  const { rows } = await pool.query(`
    WITH u AS (${SQL_UNIDADES}),
    cuenta AS (${SQL_ENVIOS_CUENTA}),
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
        COALESCE(SUM(u.valor_interno) FILTER (WHERE u.estado_unidad <> 'Faltante'), 0) AS valor_recibido
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
      COALESCE(ar.unidades, 0)          AS accesorios_unidades,
      COALESCE(ar.valor, 0)             AS accesorios_valor,
      -- La cuenta del envío. El cargo incluye equipos Y accesorios recibidos.
      COALESCE(cu.cargo, 0)             AS cargo,
      COALESCE(cu.abonado, 0)           AS abonado,
      COALESCE(cu.saldo, 0)             AS saldo,
      COALESCE(cu.excedente, 0)         AS excedente
    FROM remisiones r
    JOIN sucursales so             ON so.id = r.sucursal_origen_id
    LEFT JOIN usuarios ue          ON ue.id = r.usuario_emisor_id
    LEFT JOIN usuarios ur          ON ur.id = r.usuario_receptor_id
    LEFT JOIN seriales_rollup sr   ON sr.remision_id = r.id
    LEFT JOIN cuenta cu            ON cu.remision_id = r.id
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
  usuario_emisor_id, clave_idempotencia, notas, estado, motivo, pedido_id,
}) => {
  // `pedido_id` se interpola solo si la columna existe. Si su migración no
  // llegó a aplicarse, esta consulta queda EXACTAMENTE como estaba en vez de
  // reventar el despacho, que es la operación diaria de un módulo que ya está
  // en producción. Mismo criterio que la columna `ubicacion` del inventario.
  const conPedido = hayPedidosInternos();
  const { rows } = await client.query(`
    INSERT INTO remisiones
      (negocio_id, tipo, sucursal_origen_id, sucursal_destino_id,
       usuario_emisor_id, clave_idempotencia, notas, estado, motivo${conPedido ? ', pedido_id' : ''})
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9${conPedido ? ', $10' : ''})
    RETURNING *
  `, [negocio_id, tipo, sucursal_origen_id, sucursal_destino_id,
      usuario_emisor_id, clave_idempotencia || null, notas || null,
      estado || 'En transito', motivo || null,
      // A qué pedido del local responde este envío. NULL es el caso normal —
      // la bodega despachando por su cuenta — y es el único que existía antes
      // de 20260904.
      ...(conPedido ? [pedido_id || null] : [])]);
  return rows[0];
};

const insertarLineaRemision = async (client, l) => {
  // Igual que en `crearRemision`: sin la columna, el SQL de siempre.
  const conPedido = hayPedidosInternos();
  const { rows } = await client.query(`
    INSERT INTO lineas_remision
      (remision_id, tipo, serial_id, imei, producto_origen_id, producto_destino_id,
       cantidad, cantidad_recibida, valor_interno, estado_linea, nombre_producto,
       origen_unidad, genera_saldo_favor, remision_tipo,
       atributo_origen_id, variante_origen_id, atributo_destino_id, variante_destino_id,
       costo_origen${conPedido ? ', pedido_linea_id' : ''})
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
            COALESCE($14, (SELECT tipo FROM remisiones WHERE id = $1)),
            $15, $16, $17, $18, $19${conPedido ? ', $20' : ''})
    RETURNING *
  `, [l.remision_id, l.tipo, l.serial_id || null, l.imei || null,
      l.producto_origen_id || null, l.producto_destino_id || null,
      l.cantidad || 1, l.cantidad_recibida ?? null, l.valor_interno || 0,
      l.estado_linea || 'Pendiente', l.nombre_producto || null,
      l.origen_unidad || null, l.genera_saldo_favor === true,
      l.remision_tipo || null,
      // El NODO que se mueve. NULL = la línea es del producto entero, que es lo
      // que significaban todas las líneas antes de 20260823_remision_variantes.
      l.atributo_origen_id || null, l.variante_origen_id || null,
      l.atributo_destino_id || null, l.variante_destino_id || null,
      // Lo que la unidad le costó A LA BODEGA, congelado: con él se calcula
      // después su utilidad por haber despachado. NULL es legítimo (mercancía
      // sin costo registrado, o una línea creada antes de la migración) y el
      // reporte lo dice en vez de inventar una cifra.
      l.costo_origen ?? null,
      // Qué línea de qué pedido responde esta. NULL = la bodega despachó por su
      // cuenta, que es el caso normal y el único que existía antes de 20260904.
      // Es el vínculo del que se DERIVA el avance del pedido.
      ...(conPedido ? [l.pedido_linea_id ?? null] : [])]);
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
//
// `sucursalUnidades` es la sucursal del LOCAL (destino de la entrega, u origen
// si lo que se mira es una devolución). Va explícito porque SQL_UNIDADES lo usa
// como segundo parámetro: cuando aquí se pasaba el id de la remisión en su
// lugar, el motor de estados filtraba por una sucursal inexistente y el detalle
// caía siempre al estado de la línea, con liquidable 0.
const getLineasDetalladas = async (negocioId, remisionId, sucursalUnidades = null) => {
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
      -- ── Cuánto de esta línea se puede RECLAMAR como no llegado ────────────
      --
      -- estado_unidad solo existe para seriales: el motor de estados sigue
      -- unidad por unidad (vendida, prestada, dónde está hoy) y eso no se puede
      -- hacer con mercancía fungible. Sin esto, las líneas de CANTIDAD no eran
      -- ni candidatas ni bloqueadas: desaparecían de la pantalla de reclamo, y
      -- el negocio cuyo catálogo es todo variantes no podía reclamar NADA.
      --
      -- Un reclamo saca del local unidades que en realidad nunca llegaron, así
      -- que el tope son tres cosas a la vez:
      --   · lo que ESTE lote todavía tiene pendiente (recibido − ya devuelto);
      --   · lo que el local todavía tiene de ese nodo — si ya lo vendió, no hay
      --     nada que sacar;
      --   · menos lo que los lotes MÁS VIEJOS del mismo nodo ya están
      --     reclamando contra ese mismo stock.
      --
      -- El tercero no es un detalle: sin él, dos envíos de la misma talla
      -- ofrecían cada uno todo el stock disponible y se podía reclamar el doble
      -- de lo que había en el local.
      CASE WHEN lr.tipo = 'cantidad' AND lr.estado_linea = 'Recibida'
        THEN GREATEST(0, LEAST(
          COALESCE(lr.cantidad_recibida, lr.cantidad, 0) - COALESCE(lr.cantidad_devuelta, 0),
          COALESCE(nd.stock, 0) - COALESCE(viejos.pendiente, 0)
        ))
        ELSE 0
      END                                               AS reclamable,
      COALESCE(nd.stock, 0)                             AS stock_nodo_destino,
      u.estado_unidad,
      COALESCE(u.liquidable, 0)                         AS liquidable,
      u.factura_numero, u.nombre_cliente, u.factura_fecha,
      u.nombre_producto_local,
      pv.prestatario_nombre, pv.prestamo_numero, pv.prestamo_fecha,
      s.vendido, s.prestado
    FROM lineas_remision lr
    LEFT JOIN u                    ON u.linea_id = lr.id
    -- A quién se le prestó, con los mismos candados que en buscarUnidades.
    LEFT JOIN LATERAL (
      SELECT COALESCE(pr.nombre, p.prestatario) AS prestatario_nombre,
             p.numero AS prestamo_numero, p.fecha AS prestamo_fecha
      FROM prestamos p
      LEFT JOIN prestatarios pr ON pr.id = p.prestatario_id
      WHERE u.estado_unidad = 'En prestamo'
        AND u.imei IS NOT NULL
        AND UPPER(TRIM(p.imei)) = UPPER(TRIM(u.imei))
        AND p.sucursal_id = u.sucursal_destino_id
        AND p.estado      = 'Activo'
        AND p.fecha      >= u.fecha_emision
      ORDER BY p.fecha DESC, p.id DESC
      LIMIT 1
    ) pv ON TRUE
    LEFT JOIN seriales s           ON s.id  = lr.serial_id
    LEFT JOIN productos_serial ps  ON ps.id = lr.producto_origen_id AND lr.tipo = 'serial'
    LEFT JOIN productos_cantidad pc  ON pc.id  = lr.producto_origen_id  AND lr.tipo = 'cantidad'
    LEFT JOIN productos_cantidad pcd ON pcd.id = lr.producto_destino_id AND lr.tipo = 'cantidad'
    -- Stock del NODO que recibió la línea (la talla), no el del producto: con
    -- variantes el del producto es la suma de todas y no dice nada de esta.
    LEFT JOIN LATERAL (
      SELECT CASE
        WHEN lr.variante_destino_id IS NOT NULL
          THEN (SELECT v.stock FROM variantes_atributo v WHERE v.id = lr.variante_destino_id AND v.activo)
        WHEN lr.atributo_destino_id IS NOT NULL
          THEN (SELECT a.stock FROM atributos_producto a WHERE a.id = lr.atributo_destino_id AND a.activo)
        ELSE pcd.stock
      END AS stock
    ) nd ON lr.tipo = 'cantidad'
    -- Pendiente de los lotes MÁS VIEJOS del mismo nodo en esta sucursal: es lo
    -- que ya está comprometido contra el stock disponible, y por tanto lo que
    -- esta línea no puede volver a ofrecer.
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(
               COALESCE(v.cantidad_recibida, v.cantidad, 0) - COALESCE(v.cantidad_devuelta, 0)
             ), 0) AS pendiente
      FROM lineas_remision v
      JOIN remisiones rv ON rv.id = v.remision_id
      WHERE v.tipo = 'cantidad' AND v.estado_linea = 'Recibida'
        AND rv.tipo = 'entrega' AND rv.estado <> 'Anulada'
        AND rv.sucursal_destino_id = (SELECT sucursal_destino_id FROM remisiones WHERE id = lr.remision_id)
        AND v.producto_destino_id             = lr.producto_destino_id
        AND v.atributo_destino_id IS NOT DISTINCT FROM lr.atributo_destino_id
        AND v.variante_destino_id IS NOT DISTINCT FROM lr.variante_destino_id
        AND (rv.fecha_emision, v.id) < (
          (SELECT fecha_emision FROM remisiones WHERE id = lr.remision_id), lr.id)
    ) viejos ON lr.tipo = 'cantidad'
    WHERE lr.remision_id = $3
      AND EXISTS (SELECT 1 FROM remisiones r WHERE r.id = lr.remision_id AND r.negocio_id = $1)
    ORDER BY lr.tipo, lr.id
  `, [negocioId, sucursalUnidades, remisionId]);
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
// Lo escaneable es el NODO: con variantes activas el código vive en la talla,
// no en el producto. Devuelve atributo_id/variante_id para que la línea de la
// remisión sepa exactamente qué se despacha. Si el mismo código apareciera en
// dos niveles, gana el más específico (`orden DESC`).
const buscarCantidadPorCodigo = async (negocioId, sucursalOrigenId, codigo) => {
  const { rows } = await pool.query(`
    SELECT * FROM (
      SELECT pc.id AS producto_id, NULL::int AS atributo_id, NULL::int AS variante_id,
             pc.nombre, NULL::text AS variante_label, pc.codigo, pc.stock,
             COALESCE(pc.costo_unitario, 0) AS costo_unitario,
             pc.unidad_medida, pc.linea_id, 0 AS orden
      FROM productos_cantidad pc
      JOIN sucursales su ON su.id = pc.sucursal_id
      WHERE su.negocio_id = $1 AND pc.sucursal_id = $2 AND pc.activo = true
        AND UPPER(TRIM(pc.codigo)) = UPPER(TRIM($3))
        AND NOT EXISTS (SELECT 1 FROM atributos_producto x
                        WHERE x.producto_id = pc.id AND x.activo = true)

      UNION ALL

      SELECT pc.id, ap.id, NULL::int,
             pc.nombre, ap.valor, ap.codigo, ap.stock,
             COALESCE(ap.costo_unitario, pc.costo_unitario, 0),
             pc.unidad_medida, pc.linea_id, 1
      FROM atributos_producto ap
      JOIN productos_cantidad pc ON pc.id = ap.producto_id
      JOIN sucursales su ON su.id = ap.sucursal_id
      WHERE su.negocio_id = $1 AND ap.sucursal_id = $2
        AND ap.activo = true AND pc.activo = true
        AND UPPER(TRIM(ap.codigo)) = UPPER(TRIM($3))
        AND NOT EXISTS (SELECT 1 FROM variantes_atributo v
                        WHERE v.atributo_id = ap.id AND v.activo = true)

      UNION ALL

      SELECT pc.id, ap.id, v.id,
             pc.nombre, ap.valor || ' / ' || v.valor, v.codigo, v.stock,
             COALESCE(v.costo_unitario, ap.costo_unitario, pc.costo_unitario, 0),
             pc.unidad_medida, pc.linea_id, 2
      FROM variantes_atributo v
      JOIN atributos_producto ap ON ap.id = v.atributo_id
      JOIN productos_cantidad pc ON pc.id = ap.producto_id
      JOIN sucursales su ON su.id = ap.sucursal_id
      WHERE su.negocio_id = $1 AND ap.sucursal_id = $2
        AND v.activo = true AND ap.activo = true AND pc.activo = true
        AND UPPER(TRIM(v.codigo)) = UPPER(TRIM($3))
    ) nodos
    ORDER BY orden DESC, producto_id
    LIMIT 1
  `, [negocioId, sucursalOrigenId, codigo]);
  return rows[0] || null;
};

// ─────────────────────────────────────────────────────────────────────────────
// NODOS DE CANTIDAD DE UNA SUCURSAL — la plantilla que comparten dos lecturas
//
// Devuelve NODOS, no productos: un producto con variantes se lista por talla,
// porque es la talla la que tiene el stock y la que se despacha. Un producto
// sin variantes se lista tal cual. Cada rama excluye los nodos que tienen hijos
// activos: esos son contenedores, no cosas despachables.
//
// Dos parámetros, y los dos son decisiones de seguridad o de producto, no de
// estilo:
//
//   • `conCosto` — el DESPACHO lo necesita (el costo es la base del valor de la
//     línea). El catálogo que ve el LOCAL para pedir, NO: es el costo de la
//     bodega, exactamente lo que `red_interna_ocultar_costos` y
//     `costos_solo_admin` esconden. Aquí ni siquiera se selecciona, en vez de
//     seleccionarlo y borrarlo después: un recorte olvidado deja el dato
//     viajando en el JSON y visible desde la consola del navegador.
//   • `soloConStock` — despachar exige stock; PEDIR no. Un local pide
//     justamente lo que se acabó, y esconder de su catálogo lo que la bodega
//     tiene en cero lo dejaría sin poder pedirlo.
//
// Una sola plantilla y no dos copias: son 60 líneas de SQL y las dos listas
// tienen que entender el árbol igual. El mismo criterio de `_sqlEnviosCuenta`.
const _sqlNodosCantidad = ({ conCosto, soloConStock }) => {
  const costo = (expr) => (conCosto ? expr : 'NULL::numeric');
  const stock = (col) => (soloConStock ? `AND ${col} > 0` : '');
  return `
    SELECT * FROM (
      SELECT pc.id AS producto_id, NULL::int AS atributo_id, NULL::int AS variante_id,
             pc.nombre, NULL::text AS variante_label, pc.codigo, pc.stock,
             ${costo('COALESCE(pc.costo_unitario, 0)')} AS costo_unitario,
             pc.unidad_medida, pc.linea_id, lp.nombre AS linea_nombre
      FROM productos_cantidad pc
      JOIN sucursales su           ON su.id = pc.sucursal_id
      LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
      WHERE su.negocio_id = $1 AND pc.sucursal_id = $2
        AND pc.activo = true ${stock('pc.stock')}
        AND NOT EXISTS (SELECT 1 FROM atributos_producto x
                        WHERE x.producto_id = pc.id AND x.activo = true)
        AND ($3 = '' OR LOWER(pc.nombre) LIKE '%' || $3 || '%' ESCAPE '\\'
                     OR LOWER(COALESCE(pc.codigo, '')) LIKE '%' || $3 || '%' ESCAPE '\\')

      UNION ALL

      SELECT pc.id, ap.id, NULL::int,
             pc.nombre, ap.valor, ap.codigo, ap.stock,
             ${costo('COALESCE(ap.costo_unitario, pc.costo_unitario, 0)')},
             pc.unidad_medida, pc.linea_id, lp.nombre
      FROM atributos_producto ap
      JOIN productos_cantidad pc   ON pc.id = ap.producto_id
      JOIN sucursales su           ON su.id = ap.sucursal_id
      LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
      WHERE su.negocio_id = $1 AND ap.sucursal_id = $2
        AND ap.activo = true AND pc.activo = true ${stock('ap.stock')}
        AND NOT EXISTS (SELECT 1 FROM variantes_atributo v
                        WHERE v.atributo_id = ap.id AND v.activo = true)
        AND ($3 = '' OR LOWER(pc.nombre) LIKE '%' || $3 || '%' ESCAPE '\\'
                     OR LOWER(ap.valor)  LIKE '%' || $3 || '%' ESCAPE '\\'
                     OR LOWER(COALESCE(ap.codigo, '')) LIKE '%' || $3 || '%' ESCAPE '\\')

      UNION ALL

      SELECT pc.id, ap.id, v.id,
             pc.nombre, ap.valor || ' / ' || v.valor, v.codigo, v.stock,
             ${costo('COALESCE(v.costo_unitario, ap.costo_unitario, pc.costo_unitario, 0)')},
             pc.unidad_medida, pc.linea_id, lp.nombre
      FROM variantes_atributo v
      JOIN atributos_producto ap   ON ap.id = v.atributo_id
      JOIN productos_cantidad pc   ON pc.id = ap.producto_id
      JOIN sucursales su           ON su.id = ap.sucursal_id
      LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
      WHERE su.negocio_id = $1 AND ap.sucursal_id = $2
        AND v.activo = true AND ap.activo = true AND pc.activo = true ${stock('v.stock')}
        AND ($3 = '' OR LOWER(pc.nombre) LIKE '%' || $3 || '%' ESCAPE '\\'
                     OR LOWER(ap.valor)  LIKE '%' || $3 || '%' ESCAPE '\\'
                     OR LOWER(v.valor)   LIKE '%' || $3 || '%' ESCAPE '\\'
                     OR LOWER(COALESCE(v.codigo, '')) LIKE '%' || $3 || '%' ESCAPE '\\')
    ) nodos
    ORDER BY nombre, variante_label NULLS FIRST
    LIMIT 50`;
};

const SQL_NODOS_DESPACHO = _sqlNodosCantidad({ conCosto: true,  soloConStock: true });
const SQL_NODOS_PEDIDO   = _sqlNodosCantidad({ conCosto: false, soloConStock: false });

const _normalizarFiltro = (q) =>
  (q || '').trim().toLowerCase().replace(/[%_\\]/g, '\\$&').slice(0, 60);

// Catálogo de accesorios de la bodega para elegir a mano (los que no tienen
// código, o cuando se prefiere buscar por nombre).
const buscarCantidadDisponible = async (negocioId, sucursalOrigenId, q = '') => {
  const { rows } = await pool.query(
    SQL_NODOS_DESPACHO, [negocioId, sucursalOrigenId, _normalizarFiltro(q)]
  );
  return rows;
};

// Catálogo que ve el LOCAL para armar un pedido. Sin costos y sin exigir stock:
// ver los motivos en `_sqlNodosCantidad`.
const buscarCantidadParaPedido = async (negocioId, bodegaId, q = '') => {
  const { rows } = await pool.query(
    SQL_NODOS_PEDIDO, [negocioId, bodegaId, _normalizarFiltro(q)]
  );
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
           COALESCE(pc.costo_unitario, 0) AS costo_unitario, pc.unidad_medida,
           EXISTS (SELECT 1 FROM atributos_producto x
                   WHERE x.producto_id = pc.id AND x.activo = true) AS tiene_variantes
    FROM productos_cantidad pc
    JOIN sucursales su ON su.id = pc.sucursal_id
    WHERE su.negocio_id = $1 AND pc.sucursal_id = $2 AND pc.id = $3 AND pc.activo = true
  `, [negocioId, sucursalOrigenId, productoId]);
  return rows[0] || null;
};

// ─────────────────────────────────────────────────────────────────────────────
// LOTES DE MERCANCÍA POR CANTIDAD — LEER ANTES DE TOCAR LA DEUDA DE UN LOCAL
//
// Un SERIAL tiene identidad y por eso todo es exacto: `serial_id` une la línea
// de entrega con la de devolución. La mercancía por CANTIDAD no la tiene, así
// que el vínculo se establece por FIFO sobre el NODO: cada línea de entrega es
// un LOTE con su cantidad y su valor propio, y lo que se devuelve consume lotes
// del más viejo al más nuevo, acreditando cada uno A SU VALOR.
//
// Por NODO y no por producto: el producto agrega todas sus tallas, y con eso el
// local podía devolver una talla que la bodega nunca le envió y verla
// acreditada contra su deuda porque OTRA talla sí tenía unidades pendientes.
//
// Si no quedan lotes pendientes, lo que se devuelve es del local: no se
// acredita nada (salvo que la bodega decida comprárselo, `genera_saldo_favor`).
// ─────────────────────────────────────────────────────────────────────────────

const _MISMO_NODO = `
  lr.producto_destino_id             = $3
  AND lr.atributo_destino_id IS NOT DISTINCT FROM $4
  AND lr.variante_destino_id IS NOT DISTINCT FROM $5
`;

/** Lotes con saldo pendiente de un nodo, en orden FIFO (el más viejo primero). */
const getLotesPendientes = async (ejecutor, { negocioId, sucursalLocalId, nodo }) => {
  const { rows } = await (ejecutor || pool).query(`
    SELECT lr.id, lr.valor_interno,
           (COALESCE(lr.cantidad_recibida, lr.cantidad, 0) - COALESCE(lr.cantidad_devuelta, 0)) AS pendiente,
           r.numero AS remision_numero, r.fecha_emision
    FROM lineas_remision lr
    JOIN remisiones r ON r.id = lr.remision_id
    WHERE r.negocio_id = $1
      AND r.sucursal_destino_id = $2
      AND r.tipo = 'entrega' AND r.estado <> 'Anulada'
      AND lr.tipo = 'cantidad' AND lr.estado_linea = 'Recibida'
      AND ${_MISMO_NODO}
      AND (COALESCE(lr.cantidad_recibida, lr.cantidad, 0) - COALESCE(lr.cantidad_devuelta, 0)) > 0
    ORDER BY r.fecha_emision, lr.id
  `, [negocioId, sucursalLocalId, nodo.productoId, nodo.atributoId ?? null, nodo.varianteId ?? null]);
  return rows;
};

/**
 * Consume `cantidad` unidades de los lotes de un nodo, del más viejo al más
 * nuevo, y devuelve el reparto: `[{ linea_id, unidades, valor_interno }]` más
 * `sin_lote`, que son las unidades que no correspondían a ningún envío de la
 * bodega — o sea, mercancía propia del local.
 *
 * Escribe `cantidad_devuelta` en cada lote: eso es lo que hace que el cargo del
 * envío baje solo, igual que marcar 'Devuelta' la línea de un serial.
 */
const consumirLotesFIFO = async (client, { negocioId, sucursalLocalId, nodo, cantidad }) => {
  const lotes = await getLotesPendientes(client, { negocioId, sucursalLocalId, nodo });
  const reparto = [];
  let restante = Number(cantidad);

  for (const lote of lotes) {
    if (restante <= 0) break;
    const toma = Math.min(restante, Number(lote.pendiente));
    if (toma <= 0) continue;
    await client.query(
      `UPDATE lineas_remision SET cantidad_devuelta = COALESCE(cantidad_devuelta, 0) + $2 WHERE id = $1`,
      [lote.id, toma]
    );
    reparto.push({
      linea_id: lote.id, unidades: toma,
      valor_interno: Number(lote.valor_interno),
      remision_numero: lote.remision_numero,
    });
    restante -= toma;
  }
  return {
    reparto,
    sin_lote: restante,
    credito: reparto.reduce((s, r) => s + r.valor_interno * r.unidades, 0),
  };
};

// Un NODO del árbol de cantidad por sus ids. Lo usa la traducción de los ítems
// del CARRITO al despacho: el carrito ya sabe qué talla eligió el usuario, y
// perder ese dato aquí obligaba a elegirla otra vez en el modal (y encima el
// modal mostraba el producto pelado, sin la talla).
//
// El costo baja con COALESCE, igual que en la pantalla del árbol: una talla sin
// costo propio hereda el del producto.
const findNodoCantidadById = async (negocioId, sucursalOrigenId, { productoId, atributoId, varianteId }) => {
  if (varianteId) {
    const { rows } = await pool.query(`
      SELECT pc.id AS producto_id, ap.id AS atributo_id, v.id AS variante_id,
             pc.nombre, ap.valor || ' / ' || v.valor AS variante_label,
             v.codigo, v.stock,
             COALESCE(v.costo_unitario, ap.costo_unitario, pc.costo_unitario, 0) AS costo_unitario,
             pc.unidad_medida
      FROM variantes_atributo v
      JOIN atributos_producto ap ON ap.id = v.atributo_id
      JOIN productos_cantidad pc ON pc.id = ap.producto_id
      JOIN sucursales su ON su.id = ap.sucursal_id
      WHERE su.negocio_id = $1 AND ap.sucursal_id = $2
        AND v.id = $3 AND ap.producto_id = $4
        AND v.activo = true AND ap.activo = true AND pc.activo = true
    `, [negocioId, sucursalOrigenId, varianteId, productoId]);
    return rows[0] || null;
  }
  if (atributoId) {
    const { rows } = await pool.query(`
      SELECT pc.id AS producto_id, ap.id AS atributo_id, NULL::int AS variante_id,
             pc.nombre, ap.valor AS variante_label, ap.codigo, ap.stock,
             COALESCE(ap.costo_unitario, pc.costo_unitario, 0) AS costo_unitario,
             pc.unidad_medida
      FROM atributos_producto ap
      JOIN productos_cantidad pc ON pc.id = ap.producto_id
      JOIN sucursales su ON su.id = ap.sucursal_id
      WHERE su.negocio_id = $1 AND ap.sucursal_id = $2
        AND ap.id = $3 AND ap.producto_id = $4
        AND ap.activo = true AND pc.activo = true
        AND NOT EXISTS (SELECT 1 FROM variantes_atributo x
                        WHERE x.atributo_id = ap.id AND x.activo = true)
    `, [negocioId, sucursalOrigenId, atributoId, productoId]);
    return rows[0] || null;
  }
  return findCantidadById(negocioId, sucursalOrigenId, productoId);
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
  const pendiente = m.estado === 'Por aprobar';
  const { rows } = await (client || pool).query(`
    INSERT INTO movimientos_cuenta_interna
      (negocio_id, sucursal_id, tipo, valor, saldo_congelado, mov_dinero_id,
       concepto, usuario_id, estado, fecha_aprobacion, usuario_aprueba_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING *
  `, [m.negocio_id, m.sucursal_id, m.tipo, m.valor || 0, m.saldo_congelado ?? null,
      m.mov_dinero_id || null, m.concepto || null, m.usuario_id || null,
      m.estado || 'Aprobado',
      pendiente ? null : new Date(),
      pendiente ? null : (m.usuario_id || null)]);
  return rows[0];
};

/** La bandeja de la bodega: gastos que los locales esperan que apruebe. */
const findMovimientosPorAprobar = async (negocioId) => {
  const { rows } = await pool.query(`
    SELECT m.*, u.nombre AS usuario_nombre, s.nombre AS sucursal_nombre
    FROM movimientos_cuenta_interna m
    LEFT JOIN usuarios   u ON u.id = m.usuario_id
    JOIN      sucursales s ON s.id = m.sucursal_id
    WHERE m.negocio_id = $1 AND m.estado = 'Por aprobar' AND NOT m.anulado
    ORDER BY m.fecha
  `, [negocioId]);
  return rows;
};

const findMovimientoCuentaById = async (negocioId, id, client = null) => {
  const { rows } = await (client || pool).query(
    `SELECT * FROM movimientos_cuenta_interna WHERE id = $1 AND negocio_id = $2`,
    [id, negocioId]
  );
  return rows[0] || null;
};

const decidirMovimientoCuenta = async (client, { id, estado, usuarioId }) => {
  const { rows } = await client.query(`
    UPDATE movimientos_cuenta_interna
    SET estado = $2, usuario_aprueba_id = $3, fecha_aprobacion = NOW()
    WHERE id = $1
    RETURNING *
  `, [id, estado, usuarioId]);
  return rows[0];
};

const anularMovimientoCuenta = async (client, id) => {
  const { rows } = await client.query(
    `UPDATE movimientos_cuenta_interna SET anulado = TRUE WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0];
};

/** Al anular o rechazar un movimiento, su imputación se cae con él. */
const anularAbonosDeMovimiento = async (client, movimientoId) => {
  const { rowCount } = await client.query(
    `UPDATE abonos_remision SET anulado = TRUE WHERE movimiento_id = $1 AND NOT anulado`,
    [movimientoId]
  );
  return rowCount;
};

/**
 * Mueve un abono de un envío a otro.
 *
 * Solo cambia A QUÉ ENVÍO se aplica: no toca tesorería, ni la caja, ni el valor.
 * Es para el pago que entró a la tarjeta equivocada, que hasta ahora no tenía
 * arreglo — la plata quedaba bien contada en el total y mal en el detalle.
 */
const moverAbono = async (client, { abonoId, remisionId = null, cargoId = null, negocioId }) => {
  const { rows } = await client.query(`
    UPDATE abonos_remision SET remision_id = $2, cargo_id = $3
    WHERE id = $1 AND negocio_id = $4 AND NOT anulado
    RETURNING *
  `, [abonoId, remisionId, cargoId, negocioId]);
  return rows[0] || null;
};

const findAbonoById = async (negocioId, id, client = null) => {
  const { rows } = await (client || pool).query(
    `SELECT * FROM abonos_remision WHERE id = $1 AND negocio_id = $2`,
    [id, negocioId]
  );
  return rows[0] || null;
};

const findMovimientosCuenta = async (negocioId, sucursalId, limit = 100) => {
  const { rows } = await pool.query(`
    SELECT m.*, u.nombre AS usuario_nombre, ua.nombre AS aprobado_por
    FROM movimientos_cuenta_interna m
    LEFT JOIN usuarios u  ON u.id  = m.usuario_id
    LEFT JOIN usuarios ua ON ua.id = m.usuario_aprueba_id
    -- Los 'Por aprobar' SÍ se listan: el local tiene que ver que su gasto está
    -- esperando visto bueno, igual que ve una remesa en tránsito.
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
  // Definiciones compartidas de "qué le genera cargo al local" y "qué abono
  // cuenta de verdad". Las exporta para que los REPORTES midan la venta de la
  // bodega con la misma vara con la que el local ve su deuda: dos definiciones
  // separadas terminarían diciendo que la bodega vendió algo que el local no
  // debe, y no habría forma de saber cuál de las dos miente.
  SQL_CARGO_ENVIO, SQL_ABONOS_EFECTIVOS,
  getUnidades, buscarUnidades, getExtracto, getResumenUnidades, getCantidadConsignada,
  getValorConsignacionSeriales,
  getTotalRemesado, getTotalMovimientosCuenta, getConciliacion, getResumenPorRemision,
  // Cuenta por envío (modelo "el envío es la deuda")
  getTotalesEnvios, getAbonosDeEnvio, findAbonosLocal, getEnviosAbiertos,
  getLineasDeEnvios, getLineasDeDevoluciones, findAbonoById, moverAbono,
  getCargosCuenta, getSaldoCargo,
  findMovimientosPorAprobar, findMovimientoCuentaById,
  decidirMovimientoCuenta, anularMovimientoCuenta, anularAbonosDeMovimiento,
  getSaldoEnvio, insertarAbonoRemision, anularAbonosDeRemesa,
  crearRemision, insertarLineaRemision, actualizarTotalRemision,
  findRemisionById, getLineasRemision, getLineasDetalladas, findRemisiones,
  insertarCorreccion, getCorreccionesRemision,
  marcarRemisionRecibida, marcarRemisionAnulada, marcarLineas,
  buscarSerialDisponible, buscarCantidadPorCodigo, buscarCantidadDisponible,
  buscarCantidadParaPedido,
  findCantidadById, findNodoCantidadById, findSerialById,
  getLotesPendientes, consumirLotesFIFO, buscarReferencias, getReferenciasDuplicadas,
  crearRemesa, findRemesaById, findRemesas, marcarRemesaRecibida, marcarRemesaAnulada,
  findRemesaPorClave, findRemisionPorClave,
  insertarMovimientoCuenta, findMovimientosCuenta,
  getSucursales, getChequeosSalud,
};
