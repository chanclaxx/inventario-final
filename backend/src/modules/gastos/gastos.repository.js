// Centro de gastos — SQL. Todo va acotado por negocio_id (la base es compartida
// por todos los negocios) y, lo que es de una sede, por sucursal_id.
const { pool } = require('../../config/db');

const db = (client) => client || pool;

// ── Categorías ──────────────────────────────────────────────────────────────
const contarCategorias = async (negocioId, client) => {
  const { rows } = await db(client).query(
    'SELECT COUNT(*)::int AS n FROM categorias_gasto WHERE negocio_id = $1', [negocioId]);
  return rows[0].n;
};

const insertarCategoriaSiNoExiste = async (negocioId, c, orden, client) => {
  await db(client).query(
    `INSERT INTO categorias_gasto (negocio_id, nombre, tipo, color, icono, orden)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (negocio_id, lower(nombre)) WHERE activa DO NOTHING`,
    [negocioId, c.nombre, c.tipo, c.color ?? null, c.icono ?? null, orden]);
};

const listarCategorias = async (negocioId, { incluirInactivas = false } = {}, client) => {
  const { rows } = await db(client).query(
    `SELECT id, nombre, tipo, color, icono, orden, activa
     FROM categorias_gasto
     WHERE negocio_id = $1 ${incluirInactivas ? '' : 'AND activa'}
     ORDER BY activa DESC, orden, id`, [negocioId]);
  return rows;
};

const findCategoria = async (negocioId, id, client) => {
  const { rows } = await db(client).query(
    'SELECT * FROM categorias_gasto WHERE id = $1 AND negocio_id = $2', [id, negocioId]);
  return rows[0] || null;
};

const crearCategoria = async (negocioId, { nombre, tipo, color, icono }) => {
  const { rows } = await pool.query(
    `INSERT INTO categorias_gasto (negocio_id, nombre, tipo, color, icono, orden)
     VALUES ($1, $2, $3, $4, $5,
       COALESCE((SELECT MAX(orden) + 1 FROM categorias_gasto WHERE negocio_id = $1), 0))
     RETURNING id, nombre, tipo, color, icono, orden, activa`,
    [negocioId, nombre, tipo, color ?? null, icono ?? null]);
  return rows[0];
};

const actualizarCategoria = async (negocioId, id, c) => {
  const { rows } = await pool.query(
    `UPDATE categorias_gasto
     SET nombre = $3, tipo = $4, color = $5, icono = $6, activa = $7
     WHERE id = $1 AND negocio_id = $2
     RETURNING id, nombre, tipo, color, icono, orden, activa`,
    [id, negocioId, c.nombre, c.tipo, c.color ?? null, c.icono ?? null, c.activa]);
  return rows[0] || null;
};

// ── Conversión de los gastos fijos de Proyección ────────────────────────────
// Las filas activas de `gastos_fijos` del negocio que aún no tienen recurrente.
const gastosFijosSinConvertir = async (negocioId, client) => {
  const { rows } = await db(client).query(
    `SELECT gf.id, gf.sucursal_id, gf.nombre, gf.valor
     FROM gastos_fijos gf
     JOIN sucursales s ON s.id = gf.sucursal_id
     WHERE s.negocio_id = $1 AND gf.activo
       AND NOT EXISTS (SELECT 1 FROM gastos_recurrentes r WHERE r.origen_gasto_fijo_id = gf.id)
     ORDER BY gf.id`, [negocioId]);
  return rows;
};

const existeTablaGastosFijos = async (client) => {
  const { rows } = await db(client).query(`SELECT to_regclass('gastos_fijos') AS t`);
  return !!rows[0].t;
};

// ── Recurrentes ─────────────────────────────────────────────────────────────
const SELECT_RECURRENTE = `
  SELECT r.id, r.sucursal_id, r.categoria_id, r.nombre, r.valor::float AS valor, r.tipo,
         r.dia_pago, r.tercero, r.medio_pago, r.activo, r.origen_gasto_fijo_id,
         c.nombre AS categoria_nombre, c.color AS categoria_color, c.icono AS categoria_icono
  FROM gastos_recurrentes r
  JOIN categorias_gasto c ON c.id = r.categoria_id`;

const insertarRecurrente = async (negocioId, r, client) => {
  const { rows } = await db(client).query(
    `INSERT INTO gastos_recurrentes
       (negocio_id, sucursal_id, categoria_id, nombre, valor, tipo, dia_pago, tercero, medio_pago, origen_gasto_fijo_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (origen_gasto_fijo_id) DO NOTHING
     RETURNING id`,
    [negocioId, r.sucursal_id, r.categoria_id, r.nombre, r.valor, r.tipo,
      r.dia_pago ?? null, r.tercero ?? null, r.medio_pago ?? null, r.origen_gasto_fijo_id ?? null]);
  return rows[0]?.id ?? null;
};

const listarRecurrentes = async (negocioId, sucursalId, { incluirInactivos = false } = {}, client) => {
  const { rows } = await db(client).query(
    `${SELECT_RECURRENTE}
     WHERE r.negocio_id = $1 AND r.sucursal_id = $2 ${incluirInactivos ? '' : 'AND r.activo'}
     ORDER BY r.activo DESC, r.dia_pago NULLS LAST, r.id`, [negocioId, sucursalId]);
  return rows;
};

const findRecurrente = async (negocioId, id, client) => {
  const { rows } = await db(client).query(
    `${SELECT_RECURRENTE} WHERE r.id = $1 AND r.negocio_id = $2`, [id, negocioId]);
  return rows[0] || null;
};

const actualizarRecurrente = async (negocioId, id, r) => {
  await pool.query(
    `UPDATE gastos_recurrentes
     SET categoria_id = $3, nombre = $4, valor = $5, tipo = $6, dia_pago = $7,
         tercero = $8, medio_pago = $9, activo = $10
     WHERE id = $1 AND negocio_id = $2`,
    [id, negocioId, r.categoria_id, r.nombre, r.valor, r.tipo, r.dia_pago ?? null,
      r.tercero ?? null, r.medio_pago ?? null, r.activo]);
};

// ── Gastos ──────────────────────────────────────────────────────────────────
const COLUMNAS_GASTO = [
  'categoria_id', 'tipo', 'fecha', 'mes_contable', 'nombre', 'descripcion', 'tercero',
  'numero_soporte', 'cantidad', 'unidad', 'valor_unitario', 'subtotal', 'iva',
  'retenciones', 'valor_total', 'medio_pago', 'observaciones',
];

const SELECT_GASTO = `
  SELECT g.id, g.sucursal_id, g.categoria_id, g.tipo,
         to_char(g.fecha, 'YYYY-MM-DD') AS fecha,
         to_char(g.mes_contable, 'YYYY-MM') AS mes_contable,
         g.nombre, g.descripcion, g.tercero, g.numero_soporte,
         g.cantidad::float AS cantidad, g.unidad, g.valor_unitario::float AS valor_unitario,
         g.subtotal::float AS subtotal, g.iva::float AS iva, g.retenciones::float AS retenciones,
         g.valor_total::float AS valor_total, g.medio_pago, g.observaciones,
         g.recurrente_id, g.usuario_id, u.nombre AS usuario_nombre, g.creado_en,
         g.anulado, g.anulado_motivo, g.anulado_en, ua.nombre AS anulado_por_nombre,
         c.nombre AS categoria_nombre, c.color AS categoria_color, c.icono AS categoria_icono
  FROM gastos g
  JOIN categorias_gasto c ON c.id = g.categoria_id
  LEFT JOIN usuarios u  ON u.id  = g.usuario_id
  LEFT JOIN usuarios ua ON ua.id = g.anulado_por`;

const insertarGasto = async (ctx, g, client) => {
  const cols = ['negocio_id', 'sucursal_id', ...COLUMNAS_GASTO, 'recurrente_id', 'usuario_id', 'clave_idempotencia'];
  const vals = [ctx.negocioId, ctx.sucursalId, ...COLUMNAS_GASTO.map((k) => g[k] ?? null),
    g.recurrente_id ?? null, ctx.usuarioId ?? null, g.clave_idempotencia ?? null];
  const { rows } = await db(client).query(
    `INSERT INTO gastos (${cols.join(', ')})
     VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING id`, vals);
  return rows[0].id;
};

const findGastoPorClave = async (negocioId, clave) => {
  const { rows } = await pool.query(
    'SELECT id FROM gastos WHERE clave_idempotencia = $1 AND negocio_id = $2', [clave, negocioId]);
  return rows[0]?.id ?? null;
};

const findGasto = async (negocioId, id, client) => {
  const { rows } = await db(client).query(
    `${SELECT_GASTO} WHERE g.id = $1 AND g.negocio_id = $2`, [id, negocioId]);
  return rows[0] || null;
};

const actualizarGasto = async (negocioId, id, g) => {
  const sets = COLUMNAS_GASTO.map((k, i) => `${k} = $${i + 3}`).join(', ');
  await pool.query(
    `UPDATE gastos SET ${sets}, actualizado_en = NOW()
     WHERE id = $1 AND negocio_id = $2 AND NOT anulado`,
    [id, negocioId, ...COLUMNAS_GASTO.map((k) => g[k] ?? null)]);
};

const anularGasto = async (negocioId, id, motivo, usuarioId) => {
  const { rowCount } = await pool.query(
    `UPDATE gastos SET anulado = TRUE, anulado_motivo = $3, anulado_por = $4, anulado_en = NOW()
     WHERE id = $1 AND negocio_id = $2 AND NOT anulado`,
    [id, negocioId, motivo, usuarioId]);
  return rowCount > 0;
};

const listarGastosMes = async (negocioId, sucursalId, mes01, { incluirAnulados = false } = {}) => {
  const { rows } = await pool.query(
    `${SELECT_GASTO}
     WHERE g.negocio_id = $1 AND g.sucursal_id = $2 AND g.mes_contable = $3::date
       ${incluirAnulados ? '' : 'AND NOT g.anulado'}
     ORDER BY g.fecha DESC, g.id DESC`, [negocioId, sucursalId, mes01]);
  return rows;
};

// Totales por mes contable (fijo / variable) entre dos meses, ambos incluidos.
const totalesPorMes = async (negocioId, sucursalId, desde01, hasta01, { soloSinPlantilla = false } = {}) => {
  const { rows } = await pool.query(
    `SELECT to_char(mes_contable, 'YYYY-MM') AS mes,
            COALESCE(SUM(valor_total) FILTER (WHERE tipo = 'fijo'), 0)::float     AS fijos,
            COALESCE(SUM(valor_total) FILTER (WHERE tipo = 'variable'), 0)::float AS variables,
            COUNT(*)::int AS cantidad
     FROM gastos
     WHERE negocio_id = $1 AND sucursal_id = $2 AND NOT anulado
       AND mes_contable BETWEEN $3::date AND $4::date
       ${soloSinPlantilla ? 'AND recurrente_id IS NULL' : ''}
     GROUP BY mes_contable ORDER BY mes_contable`,
    [negocioId, sucursalId, desde01, hasta01]);
  return rows;
};

// Por categoría, para un rango de meses contables.
const totalesPorCategoria = async (negocioId, sucursalId, desde01, hasta01) => {
  const { rows } = await pool.query(
    `SELECT categoria_id, to_char(mes_contable, 'YYYY-MM') AS mes,
            SUM(valor_total)::float AS total, COUNT(*)::int AS cantidad
     FROM gastos
     WHERE negocio_id = $1 AND sucursal_id = $2 AND NOT anulado
       AND mes_contable BETWEEN $3::date AND $4::date
     GROUP BY categoria_id, mes_contable`,
    [negocioId, sucursalId, desde01, hasta01]);
  return rows;
};

const recurrentesPagadosMes = async (negocioId, sucursalId, mes01) => {
  const { rows } = await pool.query(
    `SELECT recurrente_id, id AS gasto_id, valor_total::float AS valor_total
     FROM gastos
     WHERE negocio_id = $1 AND sucursal_id = $2 AND mes_contable = $3::date
       AND recurrente_id IS NOT NULL AND NOT anulado`,
    [negocioId, sucursalId, mes01]);
  return rows;
};

// Uso por categoría en los últimos meses: ordena los botones de registro
// rápido con las que más se usan primero.
const usoCategorias = async (negocioId, sucursalId) => {
  const { rows } = await pool.query(
    `SELECT categoria_id, COUNT(*)::int AS usos
     FROM gastos
     WHERE negocio_id = $1 AND sucursal_id = $2 AND NOT anulado
       AND creado_en > NOW() - interval '120 days'
     GROUP BY categoria_id`, [negocioId, sucursalId]);
  return rows;
};

const negocioDeSucursal = async (sucursalId) => {
  const { rows } = await pool.query('SELECT negocio_id FROM sucursales WHERE id = $1', [sucursalId]);
  return rows[0]?.negocio_id ?? null;
};

const configActivo = async (negocioId) => {
  const { rows } = await pool.query(
    `SELECT valor FROM config_negocio WHERE negocio_id = $1 AND clave = 'gastos_activo'`, [negocioId]);
  return rows[0]?.valor === '1';
};

module.exports = {
  contarCategorias, insertarCategoriaSiNoExiste, listarCategorias, findCategoria,
  crearCategoria, actualizarCategoria,
  gastosFijosSinConvertir, existeTablaGastosFijos,
  insertarRecurrente, listarRecurrentes, findRecurrente, actualizarRecurrente,
  insertarGasto, findGastoPorClave, findGasto, actualizarGasto, anularGasto,
  listarGastosMes, totalesPorMes, totalesPorCategoria, recurrentesPagadosMes, usoCategorias,
  negocioDeSucursal, configActivo,
};
