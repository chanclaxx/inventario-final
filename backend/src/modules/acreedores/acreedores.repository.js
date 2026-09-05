const { pool } = require('../../config/db');

// ── La factura ABIERTA más próxima a vencerse de un acreedor ────────────────
//
// Se define UNA vez y se pega en las tres consultas que listan acreedores. Si
// cada una llevara su copia, bastaría con tocar una para que la ficha del
// proveedor y el semáforo de cartera dijeran cosas distintas del mismo
// proveedor — el tipo de desacuerdo que ya costó caro en este repositorio.
//
// "Abierta" = el cargo todavía tiene saldo. Un cargo pagado no vence: conserva
// su fecha, pero ya no le debe nada a nadie y no debe pintar el semáforo.
//
// LATERAL con LIMIT 1, no un agregado: devuelve UNA fila por acreedor, así que
// no multiplica el GROUP BY de la consulta que lo hospeda. Sus columnas sí
// tienen que ir en ese GROUP BY (Postgres no deduce que dependen de a.id).
// Se apoya en idx_mov_acreedor_vencimiento, que ya existe.
const SQL_PROXIMO_VENCIMIENTO = `
  LEFT JOIN LATERAL (
    SELECT cg.fecha_vencimiento,
           (cg.fecha_vencimiento - CURRENT_DATE)::int AS dias
    FROM movimientos_acreedor cg
    WHERE cg.acreedor_id = a.id
      AND cg.tipo = 'Cargo'
      AND cg.fecha_vencimiento IS NOT NULL
      AND cg.valor > COALESCE((
            SELECT SUM(ab.valor) FROM movimientos_acreedor ab
            WHERE ab.cargo_id = cg.id AND ab.tipo = 'Abono'
          ), 0)
    ORDER BY cg.fecha_vencimiento ASC
    LIMIT 1
  ) venc ON TRUE`;

const SEL_VENCIMIENTO   = 'venc.fecha_vencimiento AS proximo_vencimiento, venc.dias AS dias_para_vencer';
const GROUP_VENCIMIENTO = 'venc.fecha_vencimiento, venc.dias';

const findAll = async (negocioId, filtro) => {
  let query = `
    SELECT a.id, a.nombre, a.cedula, a.telefono, a.proveedor_id,
           p.tipo AS proveedor_tipo,
           COALESCE(SUM(CASE WHEN m.tipo = 'Cargo' THEN m.valor ELSE -m.valor END), 0) AS saldo,
           COALESCE(SUM(CASE WHEN m.tipo = 'Cargo' THEN m.valor ELSE 0 END), 0) AS total_cargado,
           COALESCE(SUM(CASE WHEN m.tipo = 'Abono' THEN m.valor ELSE 0 END), 0) AS total_abonado,
           MAX(m.fecha) FILTER (WHERE m.tipo = 'Abono') AS ultimo_pago,
           ${SEL_VENCIMIENTO}
    FROM acreedores a
    LEFT JOIN proveedores p ON p.id = a.proveedor_id
    LEFT JOIN movimientos_acreedor m ON m.acreedor_id = a.id
    ${SQL_PROXIMO_VENCIMIENTO}
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

  query += ` GROUP BY a.id, p.tipo, ${GROUP_VENCIMIENTO} ORDER BY a.nombre`;
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
           MAX(m.fecha) FILTER (WHERE m.tipo = 'Abono') AS ultimo_pago,
           ${SEL_VENCIMIENTO}
    FROM acreedores a
    JOIN proveedores p ON p.id = a.proveedor_id
    LEFT JOIN movimientos_acreedor m ON m.acreedor_id = a.id
    ${SQL_PROXIMO_VENCIMIENTO}
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

  query += ` GROUP BY a.id, p.tipo, ${GROUP_VENCIMIENTO} ORDER BY a.nombre`;
  const { rows } = await pool.query(query, params);
  return rows;
};

// Solo acreedores vinculados a proveedores tipo 'cruce'
const findByCruces = async (negocioId, filtro) => {
  let query = `
    SELECT a.id, a.nombre, a.cedula, a.telefono, a.proveedor_id,
           COALESCE(SUM(CASE WHEN m.tipo = 'Cargo' THEN m.valor ELSE -m.valor END), 0) AS saldo,
           ${SEL_VENCIMIENTO}
    FROM acreedores a
    JOIN proveedores p ON p.id = a.proveedor_id
    LEFT JOIN movimientos_acreedor m ON m.acreedor_id = a.id
    ${SQL_PROXIMO_VENCIMIENTO}
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

  query += ` GROUP BY a.id, ${GROUP_VENCIMIENTO} ORDER BY a.nombre`;
  const { rows } = await pool.query(query, params);
  return rows;
};

// ─────────────────────────────────────────────────────────────────────────────
// FACTURAS DE PROVEEDOR CON PLAZO — lo que el negocio debe y cuándo lo debe
//
// Es el espejo de la cartera de clientes: aquí el deudor es el negocio. Sale de
// los CARGOS que tienen `fecha_vencimiento`, vengan de donde vengan:
//
//   · de una ORDEN de compra (modo 'orden': un cargo por la orden completa)
//   · de una COMPRA contra una orden (modo 'recepcion': un cargo por entrega,
//     que hereda el vencimiento de la orden)
//   · de una COMPRA SUELTA con plazo — a alguien se le olvidó crear la orden,
//     o el negocio no las usa, pero la factura vence igual
//
// El saldo se DERIVA (cargo − abonos). Los abonos se siguen por `cargo_id` y no
// por la compra: un pago hecho desde la cuenta del proveedor —la vía normal—
// solo lleva cargo_id, y buscarlo de otra forma dejaría la factura marcada como
// pendiente después de haberla pagado.
//
// El avance de recepción viaja al lado porque es la otra mitad de la pregunta:
// «¿le debo $2.000.000 de una orden que solo me entregó la mitad?».
const findFacturasPorVencer = async (negocioId, {
  sucursalId = null, incluirPagadas = false, proveedorIds = null,
  soloSinPlazo = false,
} = {}) => {
  const params = [negocioId];
  let i = 2;

  let filtroSucursal = '';
  if (sucursalId) {
    filtroSucursal = `AND m.sucursal_id = $${i++}`;
    params.push(sucursalId);
  }

  let filtroProveedores = '';
  if (proveedorIds && proveedorIds.length) {
    filtroProveedores = `AND a.proveedor_id = ANY($${i++}::int[])`;
    params.push(proveedorIds);
  }

  const { rows } = await pool.query(`
    WITH cargos AS (
      SELECT
        m.id, m.acreedor_id, m.valor, m.fecha, m.fecha_vencimiento,
        m.compra_id, m.orden_compra_id, m.sucursal_id, m.descripcion,
        a.nombre AS acreedor_nombre, a.proveedor_id,
        p.nombre AS proveedor_nombre
      FROM      movimientos_acreedor m
      JOIN      acreedores  a ON a.id = m.acreedor_id
      LEFT JOIN proveedores p ON p.id = a.proveedor_id
      WHERE a.negocio_id = $1
        AND m.tipo = 'Cargo'
        -- "Sin plazo" son los cargos a los que nadie les puso vencimiento: se
        -- listan aparte para poder ponérselo después. Sin esta vista, olvidar
        -- el plazo al registrar la compra dejaba la deuda invisible para
        -- siempre, y la única salida era anular la compra y rehacerla.
        AND m.fecha_vencimiento IS ${soloSinPlazo ? 'NULL' : 'NOT NULL'}
        ${filtroSucursal}
        ${filtroProveedores}
    ),
    saldos AS (
      SELECT c.id,
             COALESCE(SUM(ab.valor), 0) AS abonado
      FROM cargos c
      LEFT JOIN movimientos_acreedor ab
             ON ab.cargo_id = c.id AND ab.tipo = 'Abono'
      GROUP BY c.id
    )
    SELECT
      c.*,
      s.abonado,
      (c.valor - s.abonado)                         AS saldo,
      (c.fecha_vencimiento - CURRENT_DATE)          AS dias_para_vencer,
      su.nombre                                     AS sucursal_nombre,
      -- Datos de la orden, si el cargo viene de una. NULL en compra suelta.
      COALESCE(oc.id, oc2.id)                       AS orden_id,
      COALESCE(oc.numero, oc2.numero)               AS orden_numero,
      COALESCE(oc.numero_factura, oc2.numero_factura, co.numero_factura) AS numero_factura,
      COALESCE(oc.estado, oc2.estado)               AS orden_estado,
      co.numero                                     AS compra_numero
    FROM      cargos  c
    JOIN      saldos  s  ON s.id = c.id
    LEFT JOIN sucursales su ON su.id = c.sucursal_id
    LEFT JOIN ordenes_compra oc  ON oc.id  = c.orden_compra_id
    LEFT JOIN compras        co  ON co.id  = c.compra_id
    LEFT JOIN ordenes_compra oc2 ON oc2.id = co.orden_compra_id
    WHERE ${incluirPagadas ? 'TRUE' : '(c.valor - s.abonado) > 0'}
    ORDER BY c.fecha_vencimiento ASC, c.id ASC
  `, params);

  return rows;
};

/**
 * Avance de recepción de las órdenes indicadas, para pintarlo al lado de su
 * factura. Va en una consulta aparte y no dentro de la anterior a propósito:
 * mezclarlas obligaría a agrupar los cargos por orden y el saldo de cada cargo
 * dejaría de ser legible.
 *
 * Mismo cálculo derivado que en el módulo de órdenes, con el mismo FILTER: sin
 * él las recepciones canceladas seguirían contando como recibidas.
 */
const findAvanceOrdenes = async (ordenIds) => {
  if (!ordenIds || !ordenIds.length) return [];
  const { rows } = await pool.query(`
    SELECT loc.orden_id,
           SUM(loc.cantidad_pedida) AS pedidas,
           SUM(LEAST(
             COALESCE(av.recibida, 0), loc.cantidad_pedida
           )) AS recibidas
    FROM lineas_orden_compra loc
    LEFT JOIN (
      SELECT lc.orden_linea_id,
             COALESCE(SUM(lc.cantidad - COALESCE(lc.cantidad_devuelta, 0))
               FILTER (WHERE c.id IS NOT NULL), 0) AS recibida
      FROM      lineas_compra lc
      LEFT JOIN compras c ON c.id = lc.compra_id AND c.estado <> 'Cancelada'
      WHERE lc.orden_linea_id IS NOT NULL
      GROUP BY lc.orden_linea_id
    ) av ON av.orden_linea_id = loc.id
    WHERE loc.orden_id = ANY($1::bigint[])
    GROUP BY loc.orden_id
  `, [ordenIds]);
  return rows;
};

/**
 * Pone (o corrige) el plazo de pago de un cargo ya registrado.
 *
 * Solo toca `fecha_vencimiento`: el valor de la deuda no se puede cambiar por
 * aquí — para eso está la corrección de precios de la compra, que hace la
 * cascada completa a costo e inventario.
 *
 * Acotado por negocio en la misma consulta: sin el JOIN a `acreedores` un id de
 * cargo de otro negocio pasaría.
 */
const actualizarVencimientoCargo = async (negocioId, cargoId, fechaVencimiento) => {
  const { rows } = await pool.query(`
    UPDATE movimientos_acreedor m
    SET fecha_vencimiento = $3::date
    FROM acreedores a
    WHERE m.id = $2
      AND m.acreedor_id = a.id
      AND a.negocio_id = $1
      AND m.tipo = 'Cargo'
    RETURNING m.id, m.fecha_vencimiento
  `, [negocioId, cargoId, fechaVencimiento]);
  return rows[0] || null;
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
        m.cargo_id, m.metodo, m.pago_total_id, m.pago_total_descripcion,
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
        -- La descripción del pago se COMPONE aquí, sobre la etiqueta generada.
        -- Así aparece sola en los cuatro sitios que leen la descripción —la
        -- cuadrícula, la conversación, el PDF y el Excel— sin que cada uno
        -- tenga que acordarse de pintarla. Se repite en todas las filas hijas
        -- del pago, así que MIN() la devuelve tal cual; en los pagos anteriores
        -- a la columna es NULL y la etiqueta queda como estaba.
        CASE
          WHEN MIN(m.pago_total_id) IS NULL THEN MIN(m.descripcion)
          ELSE
            CASE WHEN COUNT(*) = 1 THEN 'Pago total'
                 ELSE 'Pago total — ' || COUNT(*) || ' cargos'
            END
            || COALESCE(' · ' || NULLIF(BTRIM(MIN(m.pago_total_descripcion)), ''), '')
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

// `executor` permite escribir dentro de la transacción del llamador, que es lo
// que necesita la baranda contra el doble clic: comprobar y escribir tienen que
// ir en la misma transacción, detrás del mismo lock.
const insertarMovimiento = async ({
  acreedor_id, usuario_id, tipo, valor, descripcion, firma, compra_id, cargo_id, registrar_en_caja, metodo, sucursal_id,
}, executor = pool) => {
  const { rows } = await executor.query(`
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
//
// `descripcion` es la nota del usuario sobre el pago (por qué se hizo). Se
// guarda repetida en cada fila hija, igual que la marca `pago_total_id`, y la
// lectura la colapsa. NO va en la columna `descripcion` de la fila: esa es la
// del abono individual, la puede editar el usuario desde el historial del
// cargo, y su valor fijo identifica los pagos totales anteriores a la marca.
const registrarAbonoTotal = async (negocioId, acreedorId, { valor, metodo, registrar_en_caja, usuario_id, sucursal_id, descripcion }) => {
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
    const nota = String(descripcion ?? '').trim().slice(0, 200) || null;

    let restante = valor;
    const distribucion = [];
    for (const cargo of cargos) {
      if (restante <= 0) break;
      const pend = Number(cargo.saldo_pendiente);
      if (pend <= 0) continue;
      const aplica = Math.min(restante, pend);
      await client.query(`
        INSERT INTO movimientos_acreedor(acreedor_id, usuario_id, tipo, valor, descripcion, cargo_id, metodo, registrar_en_caja, sucursal_id, pago_total_id, pago_total_descripcion)
        VALUES ($1, $2, 'Abono', $3, $4, $5, $6, $7, $8, $9, $10)
      `, [acreedorId, usuario_id || null, aplica, 'Pago total distribuido', cargo.id, metodo || null, registrar_en_caja !== false, sucursal_id || null, pagoTotalId, nota]);
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
      -- En columna aparte a propósito: esta lista alimenta el modal de edición
      -- del abono, que devuelve la descripción tal cual la recibió. Mezclarlas
      -- guardaría la nota del pago total como descripción del abono.
      m.pago_total_descripcion,
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
  findFacturasPorVencer, findAvanceOrdenes, actualizarVencimientoCargo,
};