const { pool } = require('../../config/db');

// ── Listar créditos (por sucursal o global del negocio) ──────────────────────
const findAll = async (sucursalId, negocioId) => {
  const filtro = sucursalId ? 'c.sucursal_id = $1' : 'su.negocio_id = $1';
  const param  = sucursalId ?? negocioId;

  const { rows } = await pool.query(`
    SELECT
      c.id, c.valor_total, c.cuota_inicial, c.total_abonado,
      c.estado, c.creado_en, c.sucursal_id,
      -- Mora: solo el pacto. Lo causado/pendiente lo deriva mora.service.
      c.fecha_limite, c.mora_condicion,
      su.nombre  AS sucursal_nombre,
      f.id       AS factura_id,
      f.numero   AS factura_numero,
      f.nombre_cliente, f.cedula, f.celular,
      (c.valor_total - c.cuota_inicial - c.total_abonado) AS saldo_pendiente,
      (
        SELECT JSON_AGG(
          JSON_BUILD_OBJECT(
            'nombre', lf.nombre_producto,
            'imei',   lf.imei,
            'cantidad', lf.cantidad,
            'cantidad_devuelta', COALESCE(lf.cantidad_devuelta, 0),
            'precio',   lf.precio
          ) ORDER BY lf.id
        )
        FROM lineas_factura lf
        WHERE lf.factura_id = f.id
      ) AS productos
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
           f.numero AS factura_numero,
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
// `fecha_limite`/`mora_condicion` son opcionales: sin ellos el crédito no tiene
// mora, que es el comportamiento de siempre.
const create = async (client, {
  factura_id, cliente_id, sucursal_id, valor_total, cuota_inicial,
  fecha_limite = null, mora_condicion = null,
}) => {
  const { rows } = await client.query(`
    INSERT INTO creditos(factura_id, cliente_id, sucursal_id, valor_total, cuota_inicial,
                         total_abonado, estado, fecha_limite, mora_condicion)
    VALUES ($1, $2, $3, $4, $5, 0, 'Activo', $6, $7::jsonb)
    RETURNING *
  `, [
    factura_id, cliente_id, sucursal_id, valor_total, cuota_inicial ?? 0,
    fecha_limite, mora_condicion ? JSON.stringify(mora_condicion) : null,
  ]);
  return rows[0];
};

// ── Insertar abono (dentro de transacción externa) ───────────────────────────
//
// `valor` es SOLO el capital. La parte que va a mora la registra mora.service en
// `movimientos_mora` y no pasa por aquí: si entrara a `total_abonado`, los
// reportes la contarían como margen del producto.
const insertarAbono = async (client, { credito_id, usuario_id, valor, metodo, notas }) => {
  const { rows: abono } = await client.query(`
    INSERT INTO abonos_credito(credito_id, usuario_id, valor, metodo, notas)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `, [credito_id, usuario_id, valor, metodo, notas || null]);

  const { rows } = await client.query(`
    UPDATE creditos SET total_abonado = total_abonado + $1
    WHERE id = $2
    RETURNING valor_total, cuota_inicial, total_abonado
  `, [valor, credito_id]);
  return { ...rows[0], abono_id: abono[0].id };
};

// ── Cambiar estado ───────────────────────────────────────────────────────────
const updateEstado = async (client, id, estado) => {
  await client.query('UPDATE creditos SET estado = $1 WHERE id = $2', [estado, id]);
};

// ── Buscar crédito por factura_id (dentro de transacción) ────────────────────
const findByFacturaId = async (client, facturaId) => {
  const { rows } = await client.query(
    `SELECT * FROM creditos WHERE factura_id = $1`,
    [facturaId]
  );
  return rows[0] || null;
};

// ── Reducir valor_total del crédito ─────────────────────────────────────────
const reducirValorTotal = async (client, creditoId, monto) => {
  const { rows } = await client.query(
    `UPDATE creditos SET valor_total = valor_total - $1 WHERE id = $2
     RETURNING valor_total, cuota_inicial, total_abonado, estado`,
    [monto, creditoId]
  );
  return rows[0];
};

module.exports = {
  findAll, findByIdYNegocio,
  getAbonos, create, insertarAbono, updateEstado,
  findByFacturaId, reducirValorTotal,
};