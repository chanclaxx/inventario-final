const { pool } = require('../../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// CARGOS FINANCIEROS — repositorio compartido por créditos y préstamos.
//
// La tabla se llama `movimientos_mora` por historia: nació cuando la mora era el
// único cargo. Hoy guarda los DOS, discriminados por `concepto`:
//
//   'mora'    → sanción por pagar tarde   (ancla: la fecha límite)
//   'interes' → precio del plazo          (ancla: la entrega del crédito)
//
// Comparten tabla porque comparten ciclo de vida completo: se derivan, se
// cobran, se condonan con motivo y PIN, se anulan en cascada con el abono, y
// aparecen en caja y reportes como ingreso financiero. Renombrar la tabla sería
// una migración destructiva sobre datos de producción a cambio de nada.
//
// Solo se escriben COBROS y CONDONACIONES. Lo PENDIENTE no se guarda: se deriva
// a partir del saldo, el pacto congelado y estos movimientos. Un solo lado, así
// que no hay nada que pueda quedar desincronizado.
//
// Ninguno de los dos toca `creditos.total_abonado` ni `prestamos.total_abonado`:
// los reportes calculan la utilidad del producto como (abonado − costo) y
// sumarlos ahí los contaría como margen comercial.
// ─────────────────────────────────────────────────────────────────────────────

const CAMPOS = [
  'id', 'negocio_id', 'sucursal_id', 'credito_id', 'prestamo_id', 'concepto', 'tipo', 'valor',
  'dias_mora', 'saldo_base', 'condicion', 'metodo', 'motivo',
  'abono_credito_id', 'abono_prestamo_id', 'usuario_id', 'fecha', 'anulado',
];

// Para SELECT con JOIN: cualificadas con el alias `mm`. Sin el alias, unir
// `usuarios` vuelve ambiguo `id` y la consulta falla.
const COLS = CAMPOS.map((c) => `mm.${c}`).join(', ');

// Para RETURNING, que no admite alias de tabla.
const COLS_RET = CAMPOS.join(', ');

/** Movimientos de mora de UN documento. Incluye anulados: el cálculo los filtra. */
const findPorDocumento = async (client, { credito_id = null, prestamo_id = null }) => {
  const ejecutor = client || pool;
  const { rows } = await ejecutor.query(`
    SELECT ${COLS}, u.nombre AS usuario_nombre
    FROM movimientos_mora mm
    LEFT JOIN usuarios u ON u.id = mm.usuario_id
    WHERE ($1::int IS NOT NULL AND mm.credito_id  = $1)
       OR ($2::int IS NOT NULL AND mm.prestamo_id = $2)
    ORDER BY mm.fecha ASC, mm.id ASC
  `, [credito_id, prestamo_id]);
  return rows;
};

/**
 * Movimientos de VARIOS documentos de una vez, agrupados por documento.
 * Evita el N+1 al listar créditos o los 1.793 préstamos activos de un negocio.
 * @returns {{ creditos: Map<number, rows>, prestamos: Map<number, rows> }}
 */
const findPorDocumentos = async ({ creditoIds = [], prestamoIds = [] }) => {
  const creditos  = new Map();
  const prestamos = new Map();
  if (!creditoIds.length && !prestamoIds.length) return { creditos, prestamos };

  const { rows } = await pool.query(`
    SELECT credito_id, prestamo_id, concepto, tipo, valor, anulado
    FROM movimientos_mora
    WHERE (credito_id  = ANY($1::int[]))
       OR (prestamo_id = ANY($2::int[]))
  `, [creditoIds.length ? creditoIds : [0], prestamoIds.length ? prestamoIds : [0]]);

  for (const r of rows) {
    const mapa = r.credito_id != null ? creditos : prestamos;
    const clave = Number(r.credito_id ?? r.prestamo_id);
    if (!mapa.has(clave)) mapa.set(clave, []);
    mapa.get(clave).push(r);
  }
  return { creditos, prestamos };
};

/** Inserta un movimiento. Siempre dentro de la transacción del llamador. */
const insertar = async (client, {
  negocio_id, sucursal_id, credito_id = null, prestamo_id = null,
  concepto = 'mora', tipo, valor, dias_mora = null, saldo_base = null, condicion = null,
  metodo = null, motivo = null,
  abono_credito_id = null, abono_prestamo_id = null, usuario_id = null,
}) => {
  const { rows } = await client.query(`
    INSERT INTO movimientos_mora
      (negocio_id, sucursal_id, credito_id, prestamo_id, concepto, tipo, valor,
       dias_mora, saldo_base, condicion, metodo, motivo,
       abono_credito_id, abono_prestamo_id, usuario_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15)
    RETURNING ${COLS_RET}
  `, [
    negocio_id, sucursal_id, credito_id, prestamo_id, concepto, tipo, valor,
    dias_mora, saldo_base,
    condicion ? JSON.stringify(condicion) : null,
    metodo, motivo, abono_credito_id, abono_prestamo_id, usuario_id,
  ]);
  return rows[0];
};

/** Marca un movimiento como anulado (nunca se borra: queda la traza). */
const anular = async (client, id) => {
  const { rows } = await client.query(
    `UPDATE movimientos_mora SET anulado = TRUE WHERE id = $1 AND NOT anulado RETURNING ${COLS_RET}`,
    [id]
  );
  return rows[0] || null;
};

/** Anula en cascada los movimientos ligados a un abono que se está revirtiendo. */
const anularPorAbono = async (client, { abono_credito_id = null, abono_prestamo_id = null }) => {
  const { rows } = await client.query(`
    UPDATE movimientos_mora SET anulado = TRUE
    WHERE NOT anulado
      AND (($1::int IS NOT NULL AND abono_credito_id  = $1)
        OR ($2::int IS NOT NULL AND abono_prestamo_id = $2))
    RETURNING id, valor, tipo
  `, [abono_credito_id, abono_prestamo_id]);
  return rows;
};

// ── Abonos a capital, para reconstruir la mora causada ───────────────────────
//
// La mora se acumula sobre el capital que ESTUVO vencido, no sobre el saldo de
// hoy: sin esto, un cliente que se atrasa y luego paga todo dejaría la base en 0
// y la mora ya causada desaparecería. Se necesitan las FECHAS de los abonos para
// armar los tramos de saldo constante.

/** Abonos a capital de UN documento, en orden. */
const findAbonosCapital = async (client, { credito_id = null, prestamo_id = null }) => {
  const ejecutor = client || pool;
  if (credito_id != null) {
    const { rows } = await ejecutor.query(
      `SELECT fecha, valor FROM abonos_credito WHERE credito_id = $1 ORDER BY fecha ASC`,
      [credito_id]
    );
    return rows;
  }
  const { rows } = await ejecutor.query(
    `SELECT fecha, valor FROM abonos_prestamo WHERE prestamo_id = $1 ORDER BY fecha ASC`,
    [prestamo_id]
  );
  return rows;
};

/**
 * Abonos a capital de VARIOS documentos, agrupados. Una sola consulta por tipo,
 * para no hacer N+1 al listar los préstamos activos de un negocio.
 */
const findAbonosCapitalPorDocumentos = async ({ creditoIds = [], prestamoIds = [] }) => {
  const creditos  = new Map();
  const prestamos = new Map();

  if (creditoIds.length) {
    const { rows } = await pool.query(
      `SELECT credito_id, fecha, valor FROM abonos_credito
       WHERE credito_id = ANY($1::int[]) ORDER BY fecha ASC`,
      [creditoIds]
    );
    for (const r of rows) {
      const k = Number(r.credito_id);
      if (!creditos.has(k)) creditos.set(k, []);
      creditos.get(k).push({ fecha: r.fecha, valor: r.valor });
    }
  }
  if (prestamoIds.length) {
    const { rows } = await pool.query(
      `SELECT prestamo_id, fecha, valor FROM abonos_prestamo
       WHERE prestamo_id = ANY($1::int[]) ORDER BY fecha ASC`,
      [prestamoIds]
    );
    for (const r of rows) {
      const k = Number(r.prestamo_id);
      if (!prestamos.has(k)) prestamos.set(k, []);
      prestamos.get(k).push({ fecha: r.fecha, valor: r.valor });
    }
  }
  return { creditos, prestamos };
};

/** Ownership: el movimiento pertenece al negocio. */
const findByIdYNegocio = async (id, negocioId) => {
  const { rows } = await pool.query(
    `SELECT ${COLS_RET} FROM movimientos_mora WHERE id = $1 AND negocio_id = $2`,
    [id, negocioId]
  );
  return rows[0] || null;
};

// ── Agregados para caja y reportes ───────────────────────────────────────────

/**
 * Movimientos de mora de una sucursal en un rango. Alimenta el grupo propio de
 * caja ("Intereses de mora") y el renglón de reportes. Se separan cobros de
 * condonaciones: el cobro es dinero que entró, la condonación es lo que se dejó
 * de cobrar — nunca se mezclan con la utilidad del producto.
 */
const findPorSucursalRango = async (sucursalId, desde, hasta) => {
  const { rows } = await pool.query(`
    SELECT
      mm.id, mm.concepto, mm.tipo, mm.valor, mm.metodo, mm.motivo, mm.fecha, mm.dias_mora,
      mm.credito_id, mm.prestamo_id,
      u.nombre AS usuario_nombre,
      COALESCE(f.nombre_cliente, p.prestatario) AS persona,
      f.numero AS factura_numero,
      p.numero AS prestamo_numero
    FROM movimientos_mora mm
    LEFT JOIN usuarios  u ON u.id = mm.usuario_id
    LEFT JOIN creditos  c ON c.id = mm.credito_id
    LEFT JOIN facturas  f ON f.id = c.factura_id
    LEFT JOIN prestamos p ON p.id = mm.prestamo_id
    WHERE mm.sucursal_id = $1
      AND NOT mm.anulado
      AND mm.fecha BETWEEN $2 AND $3
    ORDER BY mm.fecha ASC
  `, [sucursalId, desde, hasta]);
  return rows;
};

/**
 * Totales de cargos financieros del negocio en un rango, para el resumen de
 * reportes. Mora e interés van separados: el primero mide qué tan mal paga la
 * cartera, el segundo cuánto rinde financiar. Sumarlos escondería las dos cosas.
 */
const getTotalesRango = async (negocioId, sucursalId, desde, hasta) => {
  const { rows } = await pool.query(`
    SELECT
      COALESCE(SUM(mm.valor) FILTER (WHERE mm.tipo = 'Cobro'       AND mm.concepto = 'mora'),    0)::numeric AS cobrada,
      COALESCE(SUM(mm.valor) FILTER (WHERE mm.tipo = 'Condonacion' AND mm.concepto = 'mora'),    0)::numeric AS condonada,
      COUNT(*) FILTER (WHERE mm.tipo = 'Cobro'       AND mm.concepto = 'mora')::int    AS cobros,
      COUNT(*) FILTER (WHERE mm.tipo = 'Condonacion' AND mm.concepto = 'mora')::int    AS condonaciones,
      COALESCE(SUM(mm.valor) FILTER (WHERE mm.tipo = 'Cobro'       AND mm.concepto = 'interes'), 0)::numeric AS interes_cobrado,
      COALESCE(SUM(mm.valor) FILTER (WHERE mm.tipo = 'Condonacion' AND mm.concepto = 'interes'), 0)::numeric AS interes_condonado
    FROM movimientos_mora mm
    JOIN sucursales su ON su.id = mm.sucursal_id
    WHERE su.negocio_id = $1
      AND ($2::int IS NULL OR mm.sucursal_id = $2)
      AND NOT mm.anulado
      AND mm.fecha BETWEEN $3 AND $4
  `, [negocioId, sucursalId ?? null, desde, hasta]);
  return rows[0];
};

module.exports = {
  findPorDocumento, findPorDocumentos, insertar, anular, anularPorAbono,
  findAbonosCapital, findAbonosCapitalPorDocumentos,
  findByIdYNegocio, findPorSucursalRango, getTotalesRango,
};
