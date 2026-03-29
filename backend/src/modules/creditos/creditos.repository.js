const { pool } = require('../../config/db');

// ── Listar créditos (por sucursal o global del negocio) ──────────────────────
const findAll = async (sucursalId, negocioId) => {
  const filtro = sucursalId ? 'c.sucursal_id = $1' : 'su.negocio_id = $1';
  const param  = sucursalId ?? negocioId;

  const { rows } = await pool.query(`
    SELECT
      c.id, c.valor_total, c.cuota_inicial, c.total_abonado,
      c.estado, c.creado_en, c.sucursal_id,
      su.nombre  AS sucursal_nombre,
      f.id       AS factura_id,
      f.nombre_cliente, f.cedula, f.celular,
      (c.valor_total - c.cuota_inicial - c.total_abonado) AS saldo_pendiente
    FROM creditos c
    JOIN facturas   f  ON f.id  = c.factura_id
    JOIN sucursales su ON su.id = c.sucursal_id
    WHERE ${filtro}
    ORDER BY
      CASE c.estado WHEN 'Activo' THEN 0 ELSE 1 END,
      c.creado_en DESC
  `, [param]);
  return rows;
};

// ── Buscar crédito por id + negocio (ownership) ─────────────────────────────
const findByIdYNegocio = async (id, negocioId) => {
  const { rows } = await pool.query(`
    SELECT c.*, f.nombre_cliente, f.cedula, f.celular,
           su.nombre AS sucursal_nombre
    FROM creditos   c
    JOIN facturas   f  ON f.id  = c.factura_id
    JOIN sucursales su ON su.id = c.sucursal_id
    WHERE c.id = $1 AND su.negocio_id = $2
  `, [id, negocioId]);
  return rows[0] || null;
};

// ── Abonos de un crédito ─────────────────────────────────────────────────────
const getAbonos = async (creditoId) => {
  const { rows } = await pool.query(`
    SELECT ac.*, u.nombre AS usuario_nombre
    FROM abonos_credito ac
    LEFT JOIN usuarios u ON u.id = ac.usuario_id
    WHERE ac.credito_id = $1
    ORDER BY ac.fecha ASC
  `, [creditoId]);
  return rows;
};

// ── Crear crédito (dentro de transacción externa) ────────────────────────────
const create = async (client, { factura_id, cliente_id, sucursal_id, valor_total, cuota_inicial }) => {
  const { rows } = await client.query(`
    INSERT INTO creditos(factura_id, cliente_id, sucursal_id, valor_total, cuota_inicial, total_abonado, estado)
    VALUES ($1, $2, $3, $4, $5, 0, 'Activo')
    RETURNING *
  `, [factura_id, cliente_id, sucursal_id, valor_total, cuota_inicial ?? 0]);
  return rows[0];
};

// ── Insertar abono (dentro de transacción externa) ───────────────────────────
const insertarAbono = async (client, { credito_id, usuario_id, valor, metodo, notas }) => {
  await client.query(`
    INSERT INTO abonos_credito(credito_id, usuario_id, valor, metodo, notas)
    VALUES ($1, $2, $3, $4, $5)
  `, [credito_id, usuario_id, valor, metodo, notas || null]);

  const { rows } = await client.query(`
    UPDATE creditos SET total_abonado = total_abonado + $1
    WHERE id = $2
    RETURNING valor_total, cuota_inicial, total_abonado
  `, [valor, credito_id]);
  return rows[0];
};

// ── Cambiar estado ───────────────────────────────────────────────────────────
const updateEstado = async (client, id, estado) => {
  await client.query('UPDATE creditos SET estado = $1 WHERE id = $2', [estado, id]);
};

module.exports = {
  findAll, findByIdYNegocio,
  getAbonos, create, insertarAbono, updateEstado,
};