const { pool } = require('../../config/db');

const findAll = async (negocioId, filtro) => {
  let query = `
    SELECT a.id, a.nombre, a.cedula, a.telefono, a.proveedor_id,
           p.tipo AS proveedor_tipo,
           COALESCE(SUM(CASE WHEN m.tipo = 'Cargo' THEN m.valor ELSE -m.valor END), 0) AS saldo,
           COALESCE(SUM(CASE WHEN m.tipo = 'Cargo' THEN m.valor ELSE 0 END), 0) AS total_cargado,
           COALESCE(SUM(CASE WHEN m.tipo = 'Abono' THEN m.valor ELSE 0 END), 0) AS total_abonado,
           MAX(m.fecha) FILTER (WHERE m.tipo = 'Abono') AS ultimo_pago
    FROM acreedores a
    LEFT JOIN proveedores p ON p.id = a.proveedor_id
    LEFT JOIN movimientos_acreedor m ON m.acreedor_id = a.id
    WHERE a.negocio_id = $1
      AND (a.proveedor_id IS NULL OR p.activo = TRUE)
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

// Acreedores cuyos proveedores están en la lista permitida del usuario
const findByProveedorIds = async (negocioId, proveedorIds, filtro) => {
  if (!proveedorIds || !proveedorIds.length) return [];

  let query = `
    SELECT a.id, a.nombre, a.cedula, a.telefono, a.proveedor_id,
           p.tipo AS proveedor_tipo,
           COALESCE(SUM(CASE WHEN m.tipo = 'Cargo' THEN m.valor ELSE -m.valor END), 0) AS saldo,
           COALESCE(SUM(CASE WHEN m.tipo = 'Cargo' THEN m.valor ELSE 0 END), 0) AS total_cargado,
           COALESCE(SUM(CASE WHEN m.tipo = 'Abono' THEN m.valor ELSE 0 END), 0) AS total_abonado,
           MAX(m.fecha) FILTER (WHERE m.tipo = 'Abono') AS ultimo_pago
    FROM acreedores a
    JOIN proveedores p ON p.id = a.proveedor_id
    LEFT JOIN movimientos_acreedor m ON m.acreedor_id = a.id
    WHERE a.negocio_id = $1
      AND a.proveedor_id = ANY($2::int[])
      AND p.activo = TRUE
  `;
  const params = [negocioId, proveedorIds];

  if (filtro) {
    const filtroSeguro = filtro.toLowerCase().replace(/[%_\\]/g, '\\$&').slice(0, 100);
    params.push(`%${filtroSeguro}%`);
    query += ` AND (LOWER(a.nombre) LIKE $3 ESCAPE '\\' OR a.cedula LIKE $3 ESCAPE '\\')`;
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

// Estado de cuenta del acreedor.
//
// Un pago total se guarda repartido entre los cargos abiertos (una fila de Abono
// por cargo) y así sigue: la contabilidad no cambia. Lo que cambia es cómo se
// LEE — las filas que comparten `pago_total_id` se colapsan en un movimiento
// único, para que un pago de $10.000.000 se vea como el usuario lo hizo y no
// como cinco abonos sueltos. El importe mostrado se DERIVA con SUM sobre esas
// mismas filas (nunca hay un total guardado que pueda quedar desfasado), así que
// anular una compra —que borra sus abonos— o editar uno ajusta el pago mostrado
// solo, y el saldo corrido sigue cuadrando con el de la tabla.
//
// El detalle del reparto viaja en `detalle` para poder desplegarlo sin otra
// consulta; caja, tesorería y los cargos siguen leyendo las filas individuales.
const getMovimientos = async (negocioId, acreedorId) => {
  const { rows } = await pool.query(`
    WITH movs AS (
      SELECT
        m.id, m.acreedor_id, m.usuario_id, m.tipo, m.valor,
        m.descripcion, m.firma, m.fecha, m.compra_id, m.registrar_en_caja,
        m.cargo_id, m.metodo, m.pago_total_id,
        co.numero         AS compra_numero,
        cargo.descripcion AS cargo_descripcion,
        cargo.fecha       AS cargo_fecha,
        ccargo.numero     AS cargo_compra_numero,
        cargo.compra_id   AS cargo_compra_id
      FROM movimientos_acreedor m
      LEFT JOIN movimientos_acreedor cargo ON cargo.id = m.cargo_id
      LEFT JOIN compras co     ON co.id     = m.compra_id
      LEFT JOIN compras ccargo ON ccargo.id = cargo.compra_id
      JOIN acreedores a ON a.id = m.acreedor_id
      WHERE m.acreedor_id = $1 AND a.negocio_id = $2
    ),
    -- Se agrupa TODO por la misma clave: las filas de un pago total caen juntas
    -- y cualquier otro movimiento forma su propio grupo de uno. Sin UNION a
    -- propósito: un UNION obliga a escribir a mano el tipo de cada columna NULL
    -- y basta que en la BD real una sea timestamptz o bigint para que
    -- Postgres rechace la consulta entera. Aquí los tipos salen de las columnas.
    --
    -- Los campos que solo tienen sentido en un movimiento suelto (firma, cargo,
    -- compra) se anulan con FILTER en vez de castear un NULL.
    agrupados AS (
      SELECT
        MIN(m.id)                            AS id,
        m.acreedor_id,
        MIN(m.tipo)                          AS tipo,
        SUM(m.valor)                         AS valor,
        MIN(m.fecha)                         AS fecha,
        MIN(m.metodo)                        AS metodo,
        BOOL_AND(m.registrar_en_caja)        AS registrar_en_caja,
        MIN(m.pago_total_id)                 AS pago_total_id,
        MIN(m.pago_total_id) IS NOT NULL     AS es_pago_total,
        CASE
          WHEN MIN(m.pago_total_id) IS NULL THEN MIN(m.descripcion)
          WHEN COUNT(*) = 1                 THEN 'Pago total'
          ELSE 'Pago total — ' || COUNT(*) || ' cargos'
        END                                  AS descripcion,

        MIN(m.usuario_id)        FILTER (WHERE m.pago_total_id IS NULL) AS usuario_id,
        MIN(m.compra_id)         FILTER (WHERE m.pago_total_id IS NULL) AS compra_id,
        MIN(m.compra_numero)     FILTER (WHERE m.pago_total_id IS NULL) AS compra_numero,
        MIN(m.cargo_id)          FILTER (WHERE m.pago_total_id IS NULL) AS cargo_id,
        MIN(m.cargo_descripcion) FILTER (WHERE m.pago_total_id IS NULL) AS cargo_descripcion,
        MIN(m.cargo_fecha)       FILTER (WHERE m.pago_total_id IS NULL) AS cargo_fecha,

        -- La firma es BYTEA en producción: MIN() sobre bytea solo existe desde
        -- Postgres 14, y castearla en un UNION rompía el estado de cuenta
        -- ("UNION types bytea and text cannot be matched"). array_agg traga
        -- cualquier tipo y conserva el suyo, sin depender de la versión.
        (array_agg(m.firma ORDER BY m.id)
           FILTER (WHERE m.pago_total_id IS NULL))[1]                   AS firma,

        CASE WHEN MIN(m.pago_total_id) IS NOT NULL THEN
          json_agg(json_build_object(
            'id',                  m.id,
            'valor',               m.valor,
            'fecha',               m.fecha,
            'metodo',              m.metodo,
            'cargo_id',            m.cargo_id,
            'cargo_descripcion',   m.cargo_descripcion,
            'cargo_compra_id',     m.cargo_compra_id,
            'cargo_compra_numero', m.cargo_compra_numero
          ) ORDER BY m.id)
        END                                  AS detalle
      FROM movs m
      GROUP BY m.acreedor_id, COALESCE('p' || m.pago_total_id, 'm' || m.id)
    )
    SELECT
      g.*,
      COALESCE(
        SUM(CASE WHEN g.tipo = 'Cargo' THEN g.valor ELSE -g.valor END)
        OVER (
          PARTITION BY g.acreedor_id
          ORDER BY g.fecha, g.id
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0
      ) AS saldo_antes,
      SUM(CASE WHEN g.tipo = 'Cargo' THEN g.valor ELSE -g.valor END)
      OVER (
        PARTITION BY g.acreedor_id
        ORDER BY g.fecha, g.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS saldo_despues
    FROM agrupados g
    ORDER BY g.fecha, g.id
  `, [acreedorId, negocioId]);
  return rows;
};

const getCargosAbiertos = async (negocioId, acreedorId) => {
  const { rows } = await pool.query(`
    SELECT
      m.id, m.descripcion, m.fecha, m.compra_id,
      co.numero                             AS compra_numero,
      m.valor                               AS valor_original,
      COALESCE(SUM(a.valor), 0)             AS total_abonado,
      m.valor - COALESCE(SUM(a.valor), 0)   AS saldo_pendiente
    FROM movimientos_acreedor m
    LEFT JOIN movimientos_acreedor a ON a.cargo_id = m.id AND a.tipo = 'Abono'
    LEFT JOIN compras co ON co.id = m.compra_id
    JOIN acreedores ac ON ac.id = m.acreedor_id
    WHERE m.acreedor_id = $1
      AND ac.negocio_id = $2
      AND m.tipo = 'Cargo'
    GROUP BY m.id, co.numero
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
  acreedor_id, usuario_id, tipo, valor, descripcion, firma, compra_id, cargo_id, registrar_en_caja, metodo, sucursal_id,
}) => {
  const { rows } = await pool.query(`
    INSERT INTO movimientos_acreedor(acreedor_id, usuario_id, tipo, valor, descripcion, firma, compra_id, cargo_id, registrar_en_caja, metodo, sucursal_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *
  `, [acreedor_id, usuario_id, tipo, valor, descripcion, firma ?? null, compra_id || null, cargo_id || null, registrar_en_caja !== false, metodo || null, sucursal_id || null]);
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
      co.numero                                          AS compra_numero,
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
    LEFT JOIN compras co ON co.id = m.compra_id
    JOIN acreedores ac ON ac.id = m.acreedor_id
    WHERE m.acreedor_id = $1
      AND ac.negocio_id = $2
      AND m.tipo = 'Cargo'
    GROUP BY m.id, co.numero
    ORDER BY m.fecha DESC
  `, [acreedorId, negocioId]);
  return rows;
};

const getSaldoAFavor = async (negocioId, acreedorId) => {
  const { rows } = await pool.query(`
    SELECT COALESCE(SUM(m.valor), 0) AS saldo_a_favor
    FROM movimientos_acreedor m
    JOIN acreedores a ON a.id = m.acreedor_id
    WHERE m.acreedor_id = $1
      AND a.negocio_id  = $2
      AND m.tipo        = 'Abono'
      AND m.cargo_id    IS NULL
  `, [acreedorId, negocioId]);
  return Number(rows[0]?.saldo_a_favor || 0);
};

// Reasigna abonos libres (saldo a favor) al cargo indicado.
// Consume los abonos más antiguos primero; divide si es necesario.
// No crea registros nuevos salvo cuando hay que dividir un abono parcialmente.
const aplicarSaldoAFavor = async (negocioId, acreedorId, cargoId, valor) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: acr } = await client.query(
      `SELECT id FROM acreedores WHERE id = $1 AND negocio_id = $2 FOR UPDATE`,
      [acreedorId, negocioId]
    );
    if (!acr.length) throw { status: 404, message: 'Acreedor no encontrado' };

    const { rows: cargoRows } = await client.query(`
      SELECT m.id,
             GREATEST(m.valor - COALESCE(SUM(a.valor), 0), 0) AS saldo_pendiente
      FROM movimientos_acreedor m
      LEFT JOIN movimientos_acreedor a ON a.cargo_id = m.id AND a.tipo = 'Abono'
      WHERE m.id = $1 AND m.acreedor_id = $2 AND m.tipo = 'Cargo'
      GROUP BY m.id
    `, [cargoId, acreedorId]);
    if (!cargoRows.length) throw { status: 404, message: 'Cargo no encontrado' };
    if (Number(cargoRows[0].saldo_pendiente) < valor) {
      throw { status: 400, message: 'El valor excede el saldo pendiente del cargo' };
    }

    const { rows: libres } = await client.query(`
      SELECT id, valor FROM movimientos_acreedor
      WHERE acreedor_id = $1 AND tipo = 'Abono' AND cargo_id IS NULL
      ORDER BY fecha ASC, id ASC
      FOR UPDATE
    `, [acreedorId]);

    const totalLibre = libres.reduce((s, r) => s + Number(r.valor), 0);
    if (totalLibre < valor) throw { status: 400, message: 'Saldo a favor insuficiente' };

    let restante = valor;
    for (const abono of libres) {
      if (restante <= 0) break;
      const av = Number(abono.valor);

      if (av <= restante) {
        await client.query(
          `UPDATE movimientos_acreedor SET cargo_id = $1 WHERE id = $2`,
          [cargoId, abono.id]
        );
        restante -= av;
      } else {
        // Dividir: reducir el abono libre y crear uno nuevo vinculado al cargo
        await client.query(
          `UPDATE movimientos_acreedor SET valor = valor - $1 WHERE id = $2`,
          [restante, abono.id]
        );
        await client.query(`
          INSERT INTO movimientos_acreedor(acreedor_id, usuario_id, tipo, valor, descripcion, cargo_id, metodo, registrar_en_caja, sucursal_id)
          SELECT acreedor_id, usuario_id, 'Abono', $1, 'Aplicación de saldo a favor', $2, metodo, false, sucursal_id
          FROM movimientos_acreedor WHERE id = $3
        `, [restante, cargoId, abono.id]);
        restante = 0;
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// Distribuye un pago único entre los cargos abiertos del acreedor (FIFO: más
// antiguo primero). Crea un Abono vinculado a cada cargo afectado. Atómico.
const registrarAbonoTotal = async (negocioId, acreedorId, { valor, metodo, registrar_en_caja, usuario_id, sucursal_id }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: acr } = await client.query(
      `SELECT id FROM acreedores WHERE id = $1 AND negocio_id = $2 FOR UPDATE`,
      [acreedorId, negocioId]
    );
    if (!acr.length) throw { status: 404, message: 'Acreedor no encontrado' };

    // Cargos abiertos, más antiguos primero
    const { rows: cargos } = await client.query(`
      SELECT
        m.id,
        m.valor - COALESCE(SUM(a.valor), 0) AS saldo_pendiente
      FROM movimientos_acreedor m
      LEFT JOIN movimientos_acreedor a ON a.cargo_id = m.id AND a.tipo = 'Abono'
      WHERE m.acreedor_id = $1 AND m.tipo = 'Cargo'
      GROUP BY m.id
      HAVING m.valor - COALESCE(SUM(a.valor), 0) > 0
      ORDER BY m.fecha ASC, m.id ASC
    `, [acreedorId]);

    if (!cargos.length) throw { status: 400, message: 'Este acreedor no tiene cargos pendientes' };

    const totalPendiente = cargos.reduce((s, c) => s + Number(c.saldo_pendiente), 0);
    if (valor > totalPendiente + 0.001) {
      throw { status: 400, message: `El pago (${valor}) supera la deuda total pendiente (${totalPendiente.toFixed(2)})` };
    }

    // Marca compartida por todas las filas de este pago. Solo agrupa: el importe
    // del pago se deriva después con SUM sobre estas mismas filas, nunca se
    // guarda aparte (ver getMovimientos y migrations/20260805_pago_total_acreedor.sql).
    const { rows: seq } = await client.query(`SELECT nextval('pago_total_acreedor_seq') AS id`);
    const pagoTotalId = seq[0].id;

    let restante = valor;
    const distribucion = [];
    for (const cargo of cargos) {
      if (restante <= 0) break;
      const pend = Number(cargo.saldo_pendiente);
      if (pend <= 0) continue;
      const aplica = Math.min(restante, pend);
      await client.query(`
        INSERT INTO movimientos_acreedor(acreedor_id, usuario_id, tipo, valor, descripcion, cargo_id, metodo, registrar_en_caja, sucursal_id, pago_total_id)
        VALUES ($1, $2, 'Abono', $3, $4, $5, $6, $7, $8, $9)
      `, [acreedorId, usuario_id || null, aplica, 'Pago total distribuido', cargo.id, metodo || null, registrar_en_caja !== false, sucursal_id || null, pagoTotalId]);
      distribucion.push({ cargo_id: cargo.id, valor: aplica });
      restante -= aplica;
    }

    await client.query('COMMIT');
    return { pago_total_id: pagoTotalId, distribucion, total_aplicado: valor - restante };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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

// Máximo valor que puede tomar un abono al editarlo, sin sobre-pagar el cargo:
//   valor_original_del_cargo − (suma de los OTROS abonos del cargo, excluyendo este)
// Devuelve null si el cargo no existe o no pertenece al acreedor.
const getMaxAbonoEditable = async (acreedorId, cargoId, movId) => {
  const { rows } = await pool.query(`
    SELECT m.valor - COALESCE(SUM(a.valor) FILTER (WHERE a.id <> $3), 0) AS max_valor
    FROM movimientos_acreedor m
    LEFT JOIN movimientos_acreedor a ON a.cargo_id = m.id AND a.tipo = 'Abono'
    WHERE m.id = $1 AND m.acreedor_id = $2 AND m.tipo = 'Cargo'
    GROUP BY m.id, m.valor
  `, [cargoId, acreedorId, movId]);
  return rows.length ? Number(rows[0].max_valor) : null;
};

const editarAbono = async (negocioId, acreedorId, movId, { valor, descripcion, metodo, cargo_id, registrar_en_caja }) => {
  const { rows } = await pool.query(`
    UPDATE movimientos_acreedor
    SET valor             = $1,
        descripcion       = $2,
        metodo            = $3,
        cargo_id          = $4,
        registrar_en_caja = $5
    WHERE id          = $6
      AND acreedor_id = $7
      AND tipo        = 'Abono'
      AND acreedor_id IN (SELECT id FROM acreedores WHERE id = $7 AND negocio_id = $8)
    RETURNING *
  `, [valor, descripcion || null, metodo || null, cargo_id || null, registrar_en_caja !== false, movId, acreedorId, negocioId]);
  if (!rows.length) throw { status: 404, message: 'Abono no encontrado' };
  return rows[0];
};

const eliminarAbono = async (negocioId, acreedorId, movId) => {
  const { rows } = await pool.query(`
    DELETE FROM movimientos_acreedor
    WHERE id          = $1
      AND acreedor_id = $2
      AND tipo        = 'Abono'
      AND acreedor_id IN (SELECT id FROM acreedores WHERE id = $2 AND negocio_id = $3)
    RETURNING id
  `, [movId, acreedorId, negocioId]);
  if (!rows.length) throw { status: 404, message: 'Abono no encontrado o no se puede eliminar' };
};

module.exports = {
  findAll, findByProveedorIds, findByCruces, findById,
  getMovimientos, getCargosAbiertos,
  getComprasConSaldo, getAbonosPorCargo,
  getSaldoAFavor, aplicarSaldoAFavor,
  registrarAbonoTotal,
  getMaxAbonoEditable, editarAbono, eliminarAbono,
  create, insertarMovimiento, eliminarSeguro,
};