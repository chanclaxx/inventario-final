const { pool } = require('../../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// TESORERÍA — repositorio
//
// El saldo de una cuenta NUNCA se guarda: se deriva de las tablas existentes
// (las mismas fuentes y reglas que usa caja.repository.getResumenDia) mapeando
// método de pago → cuenta, anclado en el último arqueo:
//
//   saldo = último arqueo + (entradas - salidas) desde el arqueo
//
// Solo se escriben en movimientos_dinero los eventos que hoy no existen en el
// sistema: traslados, consignaciones, retiros, gastos y ajustes.
//
// IMPORTANTE (anti doble conteo): los movimientos de tesorería sobre cuentas
// de efectivo se espejan en movimientos_caja con referencia_tipo='tesoreria'
// para que el cierre de caja cuadre. Por eso la rama de movimientos manuales
// de caja EXCLUYE referencia_tipo='tesoreria' (ya se cuentan vía
// movimientos_dinero).
//
// Si cambian las reglas de qué entra/sale de caja en caja.repository.js,
// deben reflejarse aquí (las ramas están marcadas con la fuente equivalente).
// ─────────────────────────────────────────────────────────────────────────────

// Condición uniforme de asignación de método a la cuenta:
//  - el método está en la lista de la cuenta, o
//  - la fila no tiene método y la cuenta es la de efectivo (política: todo lo
//    que no declara método se asume efectivo; un arqueo corrige cualquier
//    diferencia).
const MATCH_METODO = (col) =>
  `(${col} = ANY($3::text[]) OR ($4::boolean AND ${col} IS NULL))`;

// UNION de todos los eventos de dinero que afectan una cuenta.
// Parámetros:
//   $1 cuenta_id       $2 sucursal_id     $3 metodos TEXT[]   $4 es_efectivo
//   $5 inicio (texto timestamp o NULL)    $6 fin (texto timestamp o NULL=ahora)
//   $7 usar_ancla (bool: inicio = fecha del último arqueo)
//   $8 negocio_id
const UNION_EVENTOS = `
  WITH lim AS (
    SELECT
      CASE WHEN $7::boolean THEN
        COALESCE(
          (SELECT a.fecha FROM arqueos_cuenta a
           WHERE a.cuenta_id = $1 ORDER BY a.fecha DESC, a.id DESC LIMIT 1),
          '-infinity'::timestamp)
      ELSE COALESCE($5::timestamp, '-infinity'::timestamp)
      END AS ini,
      COALESCE($6::timestamp, now()) AS fin
  ),
  eventos AS (
    -- Ventas de contado (≈ caja: pagos_factura)
    SELECT f.fecha, 'entrada' AS tipo, pf.valor, 'venta' AS fuente,
           'Factura #' || f.id || COALESCE(' — ' || f.nombre_cliente, '') AS detalle,
           pf.metodo, NULL::bigint AS mov_id
    FROM pagos_factura pf
    JOIN facturas f ON f.id = pf.factura_id
    WHERE f.sucursal_id = $2
      AND f.estado != 'Cancelada'
      AND pf.metodo != 'Credito'
      AND ${MATCH_METODO('pf.metodo')}
      AND NOT EXISTS (SELECT 1 FROM entregas_domicilio ed WHERE ed.factura_id = f.id)
      AND NOT EXISTS (SELECT 1 FROM ordenes_servicio  os WHERE os.factura_id = f.id)
      AND (f.notas IS NULL OR f.notas NOT LIKE 'Factura generada por saldo de préstamo #%')

    UNION ALL
    -- Abonos de créditos (≈ caja: abonos_credito)
    SELECT ac.fecha, 'entrada', ac.valor, 'abono_credito',
           'Abono crédito #' || c.id || COALESCE(' — ' || f.nombre_cliente, ''),
           ac.metodo, NULL::bigint AS mov_id
    FROM abonos_credito ac
    JOIN creditos c ON c.id = ac.credito_id
    JOIN facturas f ON f.id = c.factura_id
    WHERE c.sucursal_id = $2
      AND f.estado != 'Cancelada'
      AND ${MATCH_METODO('ac.metodo')}

    UNION ALL
    -- Abonos de préstamos individuales (≈ caja: abonos_prestamo)
    SELECT ab.fecha, 'entrada', ab.valor, 'abono_prestamo',
           'Abono préstamo #' || p.id || COALESCE(' — ' || p.prestatario, ''),
           ab.metodo, NULL::bigint AS mov_id
    FROM abonos_prestamo ab
    JOIN prestamos p ON p.id = ab.prestamo_id
    WHERE p.sucursal_id = $2
      AND ab.metodo NOT IN ('Intercambio', 'Saldo a favor')
      AND ab.abono_total_id IS NULL
      AND ${MATCH_METODO('ab.metodo')}

    UNION ALL
    -- Abonos totales de préstamos (≈ caja: abonos_totales)
    SELECT at.fecha, 'entrada', at.valor_total, 'abono_prestamo',
           'Abono total — ' || COALESCE(pr.nombre, cl.nombre, 'préstamos'),
           at.metodo, NULL::bigint AS mov_id
    FROM abonos_totales at
    LEFT JOIN prestatarios pr ON pr.id = at.persona_id AND at.tipo_persona = 'prestatario'
    LEFT JOIN clientes     cl ON cl.id = at.persona_id AND at.tipo_persona = 'cliente'
    WHERE at.sucursal_id = $2
      AND at.metodo NOT IN ('Intercambio', 'Saldo a favor')
      AND ${MATCH_METODO('at.metodo')}

    UNION ALL
    -- Servicio técnico (≈ caja: abonos_servicio)
    SELECT ab.fecha, 'entrada', ab.valor, 'servicio',
           'Servicio #' || os.id || COALESCE(' — ' || os.cliente_nombre, ''),
           ab.metodo, NULL::bigint AS mov_id
    FROM abonos_servicio ab
    JOIN ordenes_servicio os ON os.id = ab.orden_id
    WHERE os.sucursal_id = $2
      AND ${MATCH_METODO('ab.metodo')}

    UNION ALL
    -- Abonos de domiciliarios (≈ caja: movimientos_caja/abono_domicilio)
    SELECT m.fecha, 'entrada', m.valor, 'domicilio',
           COALESCE(m.concepto, 'Abono domiciliario'),
           m.metodo, NULL::bigint AS mov_id
    FROM movimientos_caja m
    JOIN aperturas_caja apc ON apc.id = m.caja_id
    WHERE apc.sucursal_id = $2
      AND m.activo IS NOT FALSE
      AND m.referencia_tipo = 'abono_domicilio'
      AND ${MATCH_METODO('m.metodo')}

    UNION ALL
    -- Movimientos manuales de caja (≈ caja: grupo "manuales").
    -- EXCLUYE 'tesoreria': esos son espejos de movimientos_dinero.
    SELECT m.fecha,
           CASE WHEN m.tipo = 'Ingreso' THEN 'entrada' ELSE 'salida' END,
           m.valor, 'caja_manual',
           COALESCE(m.concepto, 'Movimiento de caja'),
           m.metodo, NULL::bigint AS mov_id
    FROM movimientos_caja m
    JOIN aperturas_caja apc ON apc.id = m.caja_id
    WHERE apc.sucursal_id = $2
      AND m.activo IS NOT FALSE
      AND (m.referencia_tipo IS NULL
        OR m.referencia_tipo NOT IN ('factura_cancelada', 'abono_domicilio', 'servicio', 'tesoreria'))
      AND ${MATCH_METODO('m.metodo')}

    UNION ALL
    -- Devoluciones por cancelación (≈ caja: factura_cancelada). Sin método →
    -- se atribuyen a la cuenta de efectivo.
    SELECT m.fecha, 'salida', m.valor, 'devolucion',
           COALESCE(m.concepto, 'Devolución'),
           m.metodo, NULL::bigint AS mov_id
    FROM movimientos_caja m
    JOIN aperturas_caja apc ON apc.id = m.caja_id
    WHERE apc.sucursal_id = $2
      AND m.activo IS NOT FALSE
      AND m.referencia_tipo = 'factura_cancelada'
      AND $4::boolean

    UNION ALL
    -- Compras a proveedores (≈ caja: compras)
    SELECT c.fecha, 'salida', c.total, 'compra',
           'Compra #' || c.id || COALESCE(' — ' || pr.nombre, ''),
           c.metodo, NULL::bigint AS mov_id
    FROM compras c
    LEFT JOIN proveedores pr ON pr.id = c.proveedor_id
    WHERE c.sucursal_id = $2
      AND c.estado != 'Cancelada'
      AND c.registrar_en_caja = TRUE
      AND ${MATCH_METODO('c.metodo')}
      AND NOT EXISTS (
        SELECT 1 FROM movimientos_acreedor ma
        WHERE ma.compra_id = c.id AND ma.tipo = 'Cargo' AND ma.valor >= c.total
      )

    UNION ALL
    -- Pagos a acreedores (≈ caja: movimientos_acreedor)
    SELECT ma.fecha, 'salida', ma.valor, 'abono_acreedor',
           'Pago acreedor — ' || a.nombre,
           ma.metodo, NULL::bigint AS mov_id
    FROM movimientos_acreedor ma
    JOIN acreedores a ON a.id = ma.acreedor_id
    LEFT JOIN movimientos_acreedor cargo ON cargo.id = ma.cargo_id
    LEFT JOIN compras comp ON comp.id = COALESCE(ma.compra_id, cargo.compra_id)
    WHERE ma.tipo = 'Abono'
      AND a.negocio_id = $8
      AND ma.registrar_en_caja = TRUE
      AND COALESCE(ma.sucursal_id, comp.sucursal_id) = $2
      AND ${MATCH_METODO('ma.metodo')}

    UNION ALL
    -- Retomas (≈ caja: restan del ingreso — el cliente entregó equipo en vez
    -- de dinero). Se atribuyen a la cuenta de efectivo.
    SELECT f.fecha, 'salida', r.valor_retoma, 'retoma',
           'Retoma factura #' || f.id || COALESCE(' — ' || r.nombre_producto, ''),
           NULL::text, NULL::bigint AS mov_id
    FROM retomas r
    JOIN facturas f ON f.id = r.factura_id
    WHERE f.sucursal_id = $2
      AND f.estado != 'Cancelada'
      AND $4::boolean

    UNION ALL
    -- Movimientos propios de tesorería (traslados, retiros, consignaciones…)
    SELECT md.fecha, md.tipo, md.valor,
           'tesoreria_' || md.categoria,
           COALESCE(md.concepto, initcap(md.categoria)),
           NULL::text, md.id AS mov_id
    FROM movimientos_dinero md
    WHERE md.cuenta_id = $1
      AND md.activo IS NOT FALSE
  )
  SELECT ev.* FROM eventos ev, lim
  WHERE ev.fecha > lim.ini AND ev.fecha <= lim.fin
`;

const _paramsEventos = ({ cuentaId, sucursalId, metodos, esEfectivo, inicio, fin, usarAncla, negocioId }) => [
  cuentaId, sucursalId, metodos, esEfectivo,
  inicio || null, fin || null, !!usarAncla, negocioId,
];

// Delta (entradas - salidas) de una cuenta en un rango. Para saldos.
const getDeltaCuenta = async (params) => {
  const { rows } = await pool.query(`
    SELECT
      COALESCE(SUM(CASE WHEN q.tipo = 'entrada' THEN q.valor ELSE 0 END), 0) AS entradas,
      COALESCE(SUM(CASE WHEN q.tipo = 'salida'  THEN q.valor ELSE 0 END), 0) AS salidas
    FROM (${UNION_EVENTOS}) q
  `, _paramsEventos(params));
  return {
    entradas: Number(rows[0].entradas),
    salidas:  Number(rows[0].salidas),
    delta:    Number(rows[0].entradas) - Number(rows[0].salidas),
  };
};

// Eventos individuales de una cuenta en un rango. Para el extracto.
const getEventosCuenta = async (params) => {
  const { rows } = await pool.query(`
    SELECT q.* FROM (${UNION_EVENTOS}) q ORDER BY q.fecha ASC
  `, _paramsEventos(params));
  return rows;
};

// ─── Cuentas ──────────────────────────────────────────────────────────────────

const findCuentas = async (negocioId, sucursalId, { incluirInactivas = false } = {}) => {
  const { rows } = await pool.query(`
    SELECT * FROM cuentas_dinero
    WHERE negocio_id = $1 AND sucursal_id = $2
      ${incluirInactivas ? '' : 'AND activa'}
    ORDER BY (tipo = 'efectivo') DESC, creada_en ASC, id ASC
  `, [negocioId, sucursalId]);
  return rows;
};

const findCuentaById = async (id, negocioId) => {
  const { rows } = await pool.query(
    'SELECT * FROM cuentas_dinero WHERE id = $1 AND negocio_id = $2',
    [id, negocioId]
  );
  return rows[0] || null;
};

const crearCuenta = async ({ negocio_id, sucursal_id, nombre, tipo, metodos_pago, porcentaje_comision, moneda }) => {
  const { rows } = await pool.query(`
    INSERT INTO cuentas_dinero (negocio_id, sucursal_id, nombre, tipo, metodos_pago, porcentaje_comision, moneda)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `, [negocio_id, sucursal_id, nombre, tipo, metodos_pago || [], porcentaje_comision || 0, moneda || 'COP']);
  return rows[0];
};

const actualizarCuenta = async (id, negocioId, { nombre, tipo, metodos_pago, porcentaje_comision, activa }) => {
  const { rows } = await pool.query(`
    UPDATE cuentas_dinero SET
      nombre              = COALESCE($3, nombre),
      tipo                = COALESCE($4, tipo),
      metodos_pago        = COALESCE($5, metodos_pago),
      porcentaje_comision = COALESCE($6, porcentaje_comision),
      activa              = COALESCE($7, activa)
    WHERE id = $1 AND negocio_id = $2
    RETURNING *
  `, [id, negocioId, nombre ?? null, tipo ?? null, metodos_pago ?? null,
      porcentaje_comision ?? null, activa ?? null]);
  return rows[0] || null;
};

// Métodos ya asignados a otras cuentas activas de la sucursal (para validar
// que un método no viva en dos cuentas → doble conteo).
const metodosOcupados = async (negocioId, sucursalId, excluirCuentaId = null) => {
  const { rows } = await pool.query(`
    SELECT c.id, c.nombre, unnest(c.metodos_pago) AS metodo
    FROM cuentas_dinero c
    WHERE c.negocio_id = $1 AND c.sucursal_id = $2 AND c.activa
      AND ($3::int IS NULL OR c.id != $3)
  `, [negocioId, sucursalId, excluirCuentaId]);
  return rows;
};

// Auto-seed idempotente: garantiza que la sucursal tenga una cuenta de
// efectivo (donde caen retomas, devoluciones y movimientos sin método).
const asegurarCuentaEfectivo = async (negocioId, sucursalId) => {
  await pool.query(`
    INSERT INTO cuentas_dinero (negocio_id, sucursal_id, nombre, tipo, metodos_pago)
    SELECT $1, $2, 'Efectivo', 'efectivo', ARRAY['Efectivo']
    WHERE NOT EXISTS (
      SELECT 1 FROM cuentas_dinero
      WHERE negocio_id = $1 AND sucursal_id = $2 AND activa
        AND ('Efectivo' = ANY(metodos_pago) OR tipo = 'efectivo')
    )
    ON CONFLICT DO NOTHING
  `, [negocioId, sucursalId]);
};

// ─── Movimientos de tesorería ────────────────────────────────────────────────

const insertarMovimiento = async (client, {
  cuenta_id, tipo, categoria, valor, concepto, grupo_traslado, usuario_id, clave_idempotencia, tasa_cambio,
}) => {
  const { rows } = await (client || pool).query(`
    INSERT INTO movimientos_dinero
      (cuenta_id, tipo, categoria, valor, concepto, grupo_traslado, usuario_id, clave_idempotencia, tasa_cambio)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `, [cuenta_id, tipo, categoria, valor, concepto || null,
      grupo_traslado || null, usuario_id || null, clave_idempotencia || null,
      tasa_cambio || null]);
  return rows[0];
};

const findMovimientoPorClave = async (clave) => {
  const { rows } = await pool.query(
    'SELECT * FROM movimientos_dinero WHERE clave_idempotencia = $1',
    [clave]
  );
  return rows[0] || null;
};

const findMovimientoById = async (id, negocioId) => {
  const { rows } = await pool.query(`
    SELECT md.*, c.sucursal_id, c.tipo AS cuenta_tipo, c.nombre AS cuenta_nombre
    FROM movimientos_dinero md
    JOIN cuentas_dinero c ON c.id = md.cuenta_id
    WHERE md.id = $1 AND c.negocio_id = $2
  `, [id, negocioId]);
  return rows[0] || null;
};

// Anula/reactiva un movimiento, su pareja de traslado (si existe) y los
// espejos en movimientos_caja. Todo en una transacción.
const toggleMovimiento = async (id, negocioId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: check } = await client.query(`
      SELECT md.id, md.activo, md.grupo_traslado
      FROM movimientos_dinero md
      JOIN cuentas_dinero c ON c.id = md.cuenta_id
      WHERE md.id = $1 AND c.negocio_id = $2
      FOR UPDATE OF md
    `, [id, negocioId]);
    if (!check.length) throw { status: 404, message: 'Movimiento no encontrado' };

    const nuevoEstado = !check[0].activo;
    const grupo       = check[0].grupo_traslado;

    const { rows: afectados } = await client.query(`
      UPDATE movimientos_dinero SET activo = $1
      WHERE id = $2 OR ($3::uuid IS NOT NULL AND grupo_traslado = $3)
      RETURNING id
    `, [nuevoEstado, id, grupo]);

    // Espejos en caja (referencia_id = id del movimiento de tesorería)
    await client.query(`
      UPDATE movimientos_caja SET activo = $1
      WHERE referencia_tipo = 'tesoreria'
        AND referencia_id = ANY($2::int[])
    `, [nuevoEstado, afectados.map((r) => r.id)]);

    await client.query('COMMIT');
    return { id, activo: nuevoEstado, afectados: afectados.map((r) => r.id) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Espejo en caja ───────────────────────────────────────────────────────────

const findCajaAbierta = async (client, sucursalId) => {
  const { rows } = await (client || pool).query(`
    SELECT id FROM aperturas_caja
    WHERE sucursal_id = $1 AND estado = 'Abierta'
    ORDER BY fecha_apertura DESC LIMIT 1
  `, [sucursalId]);
  return rows[0] || null;
};

const insertarEspejoCaja = async (client, { caja_id, usuario_id, tipo, concepto, valor, movimiento_dinero_id }) => {
  await client.query(`
    INSERT INTO movimientos_caja
      (caja_id, usuario_id, tipo, concepto, valor, referencia_id, referencia_tipo, metodo)
    VALUES ($1, $2, $3, $4, $5, $6, 'tesoreria', 'Efectivo')
  `, [caja_id, usuario_id || null, tipo, concepto, valor, movimiento_dinero_id]);
};

// ─── Arqueos ──────────────────────────────────────────────────────────────────

// Última tasa COP/USD registrada en la cuenta (para mostrar el equivalente
// en pesos de una cuenta en divisa).
const ultimaTasa = async (cuentaId) => {
  const { rows } = await pool.query(`
    SELECT tasa_cambio FROM movimientos_dinero
    WHERE cuenta_id = $1 AND tasa_cambio IS NOT NULL AND activo IS NOT FALSE
    ORDER BY fecha DESC, id DESC LIMIT 1
  `, [cuentaId]);
  return rows[0] ? Number(rows[0].tasa_cambio) : null;
};

const ultimoArqueo = async (cuentaId) => {
  const { rows } = await pool.query(`
    SELECT * FROM arqueos_cuenta
    WHERE cuenta_id = $1
    ORDER BY fecha DESC, id DESC LIMIT 1
  `, [cuentaId]);
  return rows[0] || null;
};

const insertarArqueo = async ({ cuenta_id, saldo, saldo_calculado, diferencia, usuario_id, notas }) => {
  const { rows } = await pool.query(`
    INSERT INTO arqueos_cuenta (cuenta_id, saldo, saldo_calculado, diferencia, usuario_id, notas)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [cuenta_id, saldo, saldo_calculado ?? null, diferencia ?? null,
      usuario_id || null, notas || null]);
  return rows[0];
};

// ─── Cartera (dinero "en la calle") ──────────────────────────────────────────

const getCartera = async (sucursalId) => {
  const [cr, pr, dom] = await Promise.all([
    pool.query(`
      SELECT COALESCE(SUM(c.valor_total - c.cuota_inicial - c.total_abonado), 0) AS total,
             COUNT(*) AS cantidad
      FROM creditos c
      JOIN facturas f ON f.id = c.factura_id
      WHERE c.sucursal_id = $1
        AND f.estado != 'Cancelada'
        AND c.estado NOT IN ('Saldado', 'Cancelado')
        AND (c.valor_total - c.cuota_inicial - c.total_abonado) > 0
    `, [sucursalId]),
    pool.query(`
      SELECT COALESCE(SUM(p.valor_prestamo - p.total_abonado), 0) AS total,
             COUNT(*) AS cantidad
      FROM prestamos p
      WHERE p.sucursal_id = $1
        AND p.estado = 'Activo'
        AND (p.valor_prestamo - p.total_abonado) > 0
    `, [sucursalId]),
    pool.query(`
      SELECT COALESCE(SUM(e.valor_total - e.total_abonado), 0) AS total,
             COUNT(*) AS cantidad
      FROM entregas_domicilio e
      JOIN facturas f ON f.id = e.factura_id
      WHERE f.sucursal_id = $1
        AND e.estado = 'Pendiente'
        AND (e.valor_total - e.total_abonado) > 0
    `, [sucursalId]),
  ]);
  return {
    creditos:   { total: Number(cr.rows[0].total),  cantidad: Number(cr.rows[0].cantidad) },
    prestamos:  { total: Number(pr.rows[0].total),  cantidad: Number(pr.rows[0].cantidad) },
    domicilios: { total: Number(dom.rows[0].total), cantidad: Number(dom.rows[0].cantidad) },
  };
};

// Métodos de pago usados en los últimos 30 días que no están asignados a
// ninguna cuenta activa de la sucursal (alerta de configuración incompleta).
const metodosSinAsignar = async (sucursalId, negocioId) => {
  const { rows } = await pool.query(`
    WITH asignados AS (
      SELECT unnest(metodos_pago) AS metodo
      FROM cuentas_dinero
      WHERE negocio_id = $2 AND sucursal_id = $1 AND activa
    ),
    usados AS (
      SELECT pf.metodo FROM pagos_factura pf
      JOIN facturas f ON f.id = pf.factura_id
      WHERE f.sucursal_id = $1 AND pf.metodo != 'Credito'
        AND f.fecha > now() - interval '30 days'
      UNION
      SELECT ac.metodo FROM abonos_credito ac
      JOIN creditos c ON c.id = ac.credito_id
      WHERE c.sucursal_id = $1 AND ac.fecha > now() - interval '30 days'
      UNION
      SELECT ab.metodo FROM abonos_prestamo ab
      JOIN prestamos p ON p.id = ab.prestamo_id
      WHERE p.sucursal_id = $1 AND ab.fecha > now() - interval '30 days'
        AND ab.metodo NOT IN ('Intercambio', 'Saldo a favor')
      UNION
      SELECT c.metodo FROM compras c
      WHERE c.sucursal_id = $1 AND c.fecha > now() - interval '30 days'
    )
    SELECT DISTINCT u.metodo
    FROM usados u
    WHERE u.metodo IS NOT NULL
      AND u.metodo NOT IN (SELECT metodo FROM asignados)
    ORDER BY u.metodo
  `, [sucursalId, negocioId]);
  return rows.map((r) => r.metodo);
};

module.exports = {
  getDeltaCuenta, getEventosCuenta,
  findCuentas, findCuentaById, crearCuenta, actualizarCuenta,
  metodosOcupados, asegurarCuentaEfectivo,
  insertarMovimiento, findMovimientoPorClave, findMovimientoById, toggleMovimiento,
  findCajaAbierta, insertarEspejoCaja,
  ultimoArqueo, insertarArqueo, ultimaTasa,
  getCartera, metodosSinAsignar,
  pool,
};
