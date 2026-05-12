const { pool } = require('../../config/db');

const findAll = async (negocioId, filtro) => {
  let query = `
    SELECT a.id, a.nombre, a.cedula, a.telefono, a.proveedor_id,
           p.tipo AS proveedor_tipo,
           COALESCE(SUM(CASE WHEN m.tipo = 'Cargo' THEN m.valor ELSE -m.valor END), 0) AS saldo
    FROM acreedores a
    LEFT JOIN proveedores p ON p.id = a.proveedor_id
    LEFT JOIN movimientos_acreedor m ON m.acreedor_id = a.id
    WHERE a.negocio_id = $1
  `;
  const params = [negocioId];

  if (filtro) {
    const filtroSeguro = filtro
      .toLowerCase()
      .replace(/[%_\\]/g, '\\$&')
      .slice(0, 100);
    params.push(`%${filtroSeguro}%`);
    query += ` AND (LOWER(a.nombre) LIKE $2 ESCAPE '\\' OR a.cedula LIKE $2 ESCAPE '\\')`;
  }

  query += ` GROUP BY a.id, p.tipo ORDER BY a.nombre`;
  const { rows } = await pool.query(query, params);
  return rows;
};

// Solo acreedores vinculados a proveedores tipo 'cruce'
const findByCruces = async (negocioId, filtro) => {
  let query = `
    SELECT a.id, a.nombre, a.cedula, a.telefono, a.proveedor_id,
           COALESCE(SUM(CASE WHEN m.tipo = 'Cargo' THEN m.valor ELSE -m.valor END), 0) AS saldo
    FROM acreedores a
    JOIN proveedores p ON p.id = a.proveedor_id
    LEFT JOIN movimientos_acreedor m ON m.acreedor_id = a.id
    WHERE a.negocio_id = $1
      AND p.tipo = 'cruce'
      AND p.activo = TRUE
  `;
  const params = [negocioId];

  if (filtro) {
    const filtroSeguro = filtro
      .toLowerCase()
      .replace(/[%_\\]/g, '\\$&')
      .slice(0, 100);
    params.push(`%${filtroSeguro}%`);
    query += ` AND (LOWER(a.nombre) LIKE $2 ESCAPE '\\' OR a.cedula LIKE $2 ESCAPE '\\')`;
  }

  query += ` GROUP BY a.id ORDER BY a.nombre`;
  const { rows } = await pool.query(query, params);
  return rows;
};

const findById = async (negocioId, id) => {
  const { rows } = await pool.query(
    `SELECT * FROM acreedores WHERE id = $1 AND negocio_id = $2`,
    [id, negocioId]
  );
  return rows[0] || null;
};

const getMovimientos = async (negocioId, acreedorId) => {
  const { rows } = await pool.query(`
    SELECT
      m.id, m.acreedor_id, m.usuario_id, m.tipo, m.valor,
      m.descripcion, m.firma, m.fecha, m.compra_id, m.registrar_en_caja,
      m.cargo_id,
      cargo.descripcion AS cargo_descripcion,
      cargo.fecha       AS cargo_fecha,
      COALESCE(
        SUM(CASE WHEN m.tipo = 'Cargo' THEN m.valor ELSE -m.valor END)
        OVER (
          PARTITION BY m.acreedor_id
          ORDER BY m.fecha, m.id
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0
      ) AS saldo_antes,
      SUM(CASE WHEN m.tipo = 'Cargo' THEN m.valor ELSE -m.valor END)
      OVER (
        PARTITION BY m.acreedor_id
        ORDER BY m.fecha, m.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS saldo_despues
    FROM movimientos_acreedor m
    LEFT JOIN movimientos_acreedor cargo ON cargo.id = m.cargo_id
    JOIN acreedores a ON a.id = m.acreedor_id
    WHERE m.acreedor_id = $1 AND a.negocio_id = $2
    ORDER BY m.fecha, m.id
  `, [acreedorId, negocioId]);
  return rows;
};

const getCargosAbiertos = async (negocioId, acreedorId) => {
  const { rows } = await pool.query(`
    SELECT
      m.id, m.descripcion, m.fecha, m.compra_id,
      m.valor                               AS valor_original,
      COALESCE(SUM(a.valor), 0)             AS total_abonado,
      m.valor - COALESCE(SUM(a.valor), 0)   AS saldo_pendiente
    FROM movimientos_acreedor m
    LEFT JOIN movimientos_acreedor a ON a.cargo_id = m.id AND a.tipo = 'Abono'
    JOIN acreedores ac ON ac.id = m.acreedor_id
    WHERE m.acreedor_id = $1
      AND ac.negocio_id = $2
      AND m.tipo = 'Cargo'
    GROUP BY m.id
    HAVING m.valor - COALESCE(SUM(a.valor), 0) > 0
    ORDER BY m.fecha DESC
  `, [acreedorId, negocioId]);
  return rows;
};

const create = async (negocioId, { nombre, cedula, telefono, proveedor_id }) => {
  const { rows } = await pool.query(`
    INSERT INTO acreedores(negocio_id, nombre, cedula, telefono, proveedor_id)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [negocioId, nombre, cedula, telefono, proveedor_id || null]);
  return rows[0];
};

const insertarMovimiento = async ({
  acreedor_id, usuario_id, tipo, valor, descripcion, firma, compra_id, cargo_id, registrar_en_caja, metodo,
}) => {
  const { rows } = await pool.query(`
    INSERT INTO movimientos_acreedor(acreedor_id, usuario_id, tipo, valor, descripcion, firma, compra_id, cargo_id, registrar_en_caja, metodo)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `, [acreedor_id, usuario_id, tipo, valor, descripcion, firma ?? null, compra_id || null, cargo_id || null, registrar_en_caja !== false, metodo || null]);
  return rows[0];
};

const eliminarSeguro = async (negocioId, acreedorId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: own } = await client.query(
      `SELECT id, proveedor_id
       FROM acreedores
       WHERE id = $1 AND negocio_id = $2
       FOR UPDATE`,
      [acreedorId, negocioId]
    );
    if (!own.length) {
      throw { status: 404, message: 'Acreedor no encontrado' };
    }

    if (own[0].proveedor_id) {
      throw {
        status: 409,
        message: 'Este acreedor está vinculado a un proveedor. Desvincúlalo primero desde Proveedores.',
      };
    }

    const { rows: movs } = await client.query(
      `SELECT COUNT(*) AS total FROM movimientos_acreedor WHERE acreedor_id = $1`,
      [acreedorId]
    );
    if (Number(movs[0].total) > 0) {
      throw {
        status: 409,
        message: `Este acreedor tiene ${movs[0].total} movimiento(s) registrado(s). No se puede eliminar.`,
      };
    }

    await client.query(
      `DELETE FROM acreedores WHERE id = $1 AND negocio_id = $2`,
      [acreedorId, negocioId]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const getComprasConSaldo = async (negocioId, acreedorId) => {
  const { rows } = await pool.query(`
    SELECT
      m.id, m.descripcion, m.fecha, m.compra_id,
      m.valor                                             AS valor_original,
      COALESCE(SUM(a.valor), 0)                          AS total_abonado,
      GREATEST(m.valor - COALESCE(SUM(a.valor), 0), 0)  AS saldo_pendiente,
      CASE
        WHEN m.valor - COALESCE(SUM(a.valor), 0) <= 0 THEN 'Saldada'
        WHEN COALESCE(SUM(a.valor), 0)             >  0 THEN 'Parcial'
        ELSE 'Pendiente'
      END AS estado_pago
    FROM movimientos_acreedor m
    LEFT JOIN movimientos_acreedor a ON a.cargo_id = m.id AND a.tipo = 'Abono'
    JOIN acreedores ac ON ac.id = m.acreedor_id
    WHERE m.acreedor_id = $1
      AND ac.negocio_id = $2
      AND m.tipo = 'Cargo'
    GROUP BY m.id
    ORDER BY m.fecha DESC
  `, [acreedorId, negocioId]);
  return rows;
};

const getAbonosPorCargo = async (negocioId, acreedorId, cargoId) => {
  const { rows } = await pool.query(`
    SELECT
      m.id, m.fecha, m.valor, m.descripcion, m.metodo, m.registrar_en_caja,
      u.nombre AS usuario_nombre
    FROM movimientos_acreedor m
    JOIN  acreedores ac ON ac.id  = m.acreedor_id
    LEFT JOIN usuarios u  ON u.id = m.usuario_id
    WHERE m.cargo_id    = $1
      AND m.acreedor_id = $2
      AND ac.negocio_id = $3
      AND m.tipo = 'Abono'
    ORDER BY m.fecha ASC
  `, [cargoId, acreedorId, negocioId]);
  return rows;
};

module.exports = {
  findAll, findByCruces, findById,
  getMovimientos, getCargosAbiertos,
  getComprasConSaldo, getAbonosPorCargo,
  create, insertarMovimiento, eliminarSeguro,
};