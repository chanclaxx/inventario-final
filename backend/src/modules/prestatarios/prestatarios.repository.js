const { pool } = require('../../config/db');

const findAll = async (negocioId) => {
  const { rows } = await pool.query(`
    SELECT p.id, p.nombre, p.telefono, p.creado_en, p.saldo_a_favor,
           COUNT(e.id) AS total_empleados,
           COALESCE(SUM(pr.valor_prestamo - pr.total_abonado)
             FILTER (WHERE pr.estado = 'Activo'), 0) AS saldo_total
    FROM prestatarios p
    LEFT JOIN empleados_prestatario e  ON e.prestatario_id = p.id
    LEFT JOIN prestamos pr             ON pr.prestatario_id = p.id
    WHERE p.negocio_id = $1
    GROUP BY p.id
    ORDER BY p.nombre
  `, [negocioId]);
  return rows;
};

// Reemplaza el findById existente
const findById = async (id, negocioId) => {
  const { rows } = await pool.query(
    'SELECT * FROM prestatarios WHERE id = $1 AND negocio_id = $2',
    [id, negocioId]
  );
  return rows[0] || null;
};

const create = async ({ negocio_id, nombre, telefono }) => {
  const { rows } = await pool.query(`
    INSERT INTO prestatarios(negocio_id, nombre, telefono)
    VALUES ($1, $2, $3)
    RETURNING *
  `, [negocio_id, nombre, telefono || null]);
  return rows[0];
};

const getEmpleados = async (prestatarioId) => {
  const { rows } = await pool.query(`
    SELECT id, nombre FROM empleados_prestatario
    WHERE prestatario_id = $1
    ORDER BY nombre
  `, [prestatarioId]);
  return rows;
};

const createEmpleado = async ({ prestatario_id, nombre }) => {
  const { rows } = await pool.query(`
    INSERT INTO empleados_prestatario(prestatario_id, nombre)
    VALUES ($1, $2)
    RETURNING *
  `, [prestatario_id, nombre]);
  return rows[0];
};

// ─── Cuenta corriente: queries de movimientos ────────────────────────────────

const insertarMovimiento = async (client, {
  prestatario_id, sucursal_id, usuario_id, fecha,
  tipo, signo, valor, descripcion,
  metodo, registrar_en_caja,
  nombre_producto, imei, producto_serial_id, producto_cantidad_id,
  cantidad, color, ingreso_inventario, costo_producto,
}) => {
  const { rows } = await client.query(`
    INSERT INTO movimientos_prestatario(
      prestatario_id, sucursal_id, usuario_id, fecha,
      tipo, signo, valor, descripcion,
      metodo, registrar_en_caja,
      nombre_producto, imei, producto_serial_id, producto_cantidad_id,
      cantidad, color, ingreso_inventario, costo_producto
    )
    VALUES ($1,$2,$3,COALESCE($4,NOW()),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    RETURNING *
  `, [
    prestatario_id, sucursal_id, usuario_id || null, fecha || null,
    tipo, signo, valor, descripcion || null,
    metodo || null, registrar_en_caja ?? false,
    nombre_producto || null, imei || null,
    producto_serial_id || null, producto_cantidad_id || null,
    cantidad || 1, color || null,
    ingreso_inventario ?? false, costo_producto || null,
  ]);
  return rows[0];
};

const anularMovimiento = async (client, id, usuarioId, motivo) => {
  const { rows } = await client.query(`
    UPDATE movimientos_prestatario
    SET anulado          = true,
        anulado_en       = NOW(),
        anulado_por      = $2,
        motivo_anulacion = $3
    WHERE id = $1 AND NOT anulado
    RETURNING *
  `, [id, usuarioId || null, motivo || null]);
  return rows[0] || null;
};

const findMovimientoById = async (client, id) => {
  const { rows } = await client.query(
    'SELECT * FROM movimientos_prestatario WHERE id = $1',
    [id]
  );
  return rows[0] || null;
};

const getMovimientos = async (prestatarioId, negocioId) => {
  const { rows } = await pool.query(`
    SELECT
      m.*,
      u.nombre  AS usuario_nombre,
      ps.nombre AS producto_serial_nombre,
      pc.nombre AS producto_cantidad_nombre,
      SUM(m.valor * m.signo) OVER (
        PARTITION BY m.prestatario_id
        ORDER BY m.fecha, m.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS saldo_acumulado
    FROM movimientos_prestatario m
    LEFT JOIN usuarios          u  ON u.id  = m.usuario_id
    LEFT JOIN productos_serial  ps ON ps.id = m.producto_serial_id
    LEFT JOIN productos_cantidad pc ON pc.id = m.producto_cantidad_id
    WHERE m.prestatario_id = $1
      AND NOT m.anulado
      AND EXISTS (
        SELECT 1 FROM prestatarios p
        WHERE p.id = m.prestatario_id AND p.negocio_id = $2
      )
    ORDER BY m.fecha DESC, m.id DESC
  `, [prestatarioId, negocioId]);
  return rows;
};

const getSaldo = async (prestatarioId, negocioId) => {
  const { rows } = await pool.query(`
    SELECT COALESCE(SUM(m.valor * m.signo), 0) AS saldo
    FROM movimientos_prestatario m
    JOIN prestatarios p ON p.id = m.prestatario_id
    WHERE m.prestatario_id = $1
      AND p.negocio_id = $2
      AND NOT m.anulado
  `, [prestatarioId, negocioId]);
  return Number(rows[0]?.saldo ?? 0);
};

const getResumen = async (prestatarioId, negocioId) => {
  const { rows } = await pool.query(`
    SELECT
      p.id, p.nombre, p.telefono,
      COUNT(e.id) AS total_empleados,
      COALESCE(SUM(m.valor * m.signo) FILTER (WHERE NOT m.anulado), 0) AS saldo,
      COUNT(m.id) FILTER (WHERE NOT m.anulado) AS total_movimientos,
      MAX(m.fecha) FILTER (WHERE NOT m.anulado) AS ultimo_movimiento
    FROM prestatarios p
    LEFT JOIN empleados_prestatario   e ON e.prestatario_id = p.id
    LEFT JOIN movimientos_prestatario m ON m.prestatario_id = p.id
    WHERE p.id = $1 AND p.negocio_id = $2
    GROUP BY p.id
  `, [prestatarioId, negocioId]);
  return rows[0] || null;
};

const findCajaAbierta = async (client, sucursalId) => {
  const { rows } = await client.query(`
    SELECT id FROM aperturas_caja
    WHERE sucursal_id = $1 AND estado = 'Abierta'
    ORDER BY fecha_apertura DESC
    LIMIT 1
  `, [sucursalId]);
  return rows[0] || null;
};

const insertarMovimientoCaja = async (client, {
  caja_id, usuario_id, tipo, concepto, valor, referencia_id, metodo,
}) => {
  await client.query(`
    INSERT INTO movimientos_caja(caja_id, usuario_id, tipo, concepto, valor, referencia_id, referencia_tipo, metodo)
    VALUES ($1, $2, $3, $4, $5, $6, 'movimiento_prestatario', $7)
  `, [caja_id, usuario_id || null, tipo, concepto, valor, referencia_id, metodo || null]);
};

const desactivarMovimientoCaja = async (client, movimientoPrestatarioId) => {
  await client.query(`
    UPDATE movimientos_caja
    SET activo = false
    WHERE referencia_tipo = 'movimiento_prestatario'
      AND referencia_id   = $1
      AND activo          = true
  `, [movimientoPrestatarioId]);
};

module.exports = {
  findAll, findById, create, getEmpleados, createEmpleado,
  // Cuenta corriente
  insertarMovimiento, anularMovimiento, findMovimientoById,
  getMovimientos, getSaldo, getResumen,
  findCajaAbierta, insertarMovimientoCaja, desactivarMovimientoCaja,
};