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

// ─── Estado de cuenta de un cliente ──────────────────────────────────────────
//
// La CLAVE del cliente es la misma que agrupa las tarjetas en pantalla:
// `cedula` si la tiene, si no el nombre. Así el estado de cuenta contiene
// exactamente los créditos que el usuario ve agrupados bajo esa persona.
const CLAVE_CLIENTE = `COALESCE(NULLIF(f.cedula, ''), f.nombre_cliente)`;

/** Datos de identidad del cliente (los de la factura más reciente). */
const findPersonaPorClave = async (negocioId, clave, sucursalId = null) => {
  const params = [negocioId, clave];
  let filtroSucursal = '';
  if (sucursalId) {
    params.push(sucursalId);
    filtroSucursal = `AND c.sucursal_id = $3`;
  }

  const { rows } = await pool.query(`
    SELECT f.nombre_cliente AS nombre, NULLIF(f.cedula, '') AS cedula,
           NULLIF(f.celular, '') AS celular
    FROM creditos   c
    JOIN facturas   f  ON f.id  = c.factura_id
    JOIN sucursales su ON su.id = c.sucursal_id
    WHERE su.negocio_id = $1
      AND ${CLAVE_CLIENTE} = $2
      ${filtroSucursal}
    ORDER BY c.creado_en DESC
    LIMIT 1
  `, params);
  return rows[0] || null;
};

/**
 * Todos los movimientos que afectan la cuenta de un cliente a crédito.
 *
 * REGLA DE ORO — una sola fuente de verdad: el saldo de un crédito es
 * `valor_total − cuota_inicial − total_abonado`, y esta consulta lo descompone
 * en movimientos cuya suma da exactamente eso:
 *
 *   cargo factura (valor ORIGINAL)  = c.valor_total + devuelto
 *   − cuota inicial                 = c.cuota_inicial
 *   − abonos                        = Σ abonos_credito.valor  (= total_abonado)
 *   − devoluciones                  = Σ cantidad_devuelta × precio (= devuelto)
 *   ─────────────────────────────────────────────────────────────────────────
 *   = valor_total − cuota_inicial − total_abonado                  ✔
 *
 * Por eso el cargo se reconstruye sumando lo devuelto en vez de leer un
 * "valor original" guardado: `valor_total` YA viene rebajado por las
 * devoluciones (ver reducirValorTotal), así que nada puede desincronizarse.
 *
 * La mora NO entra en el saldo: es deuda financiera aparte y vive en
 * `movimientos_mora` (ver 20260730_mora_credito.sql). Se lista como
 * informativa, con `saldo` nulo, igual que las compras directas en préstamos.
 */
const getEstadoCuenta = async (negocioId, clave, sucursalId = null) => {
  const params = [negocioId, clave];
  let filtroSucursal = '';
  if (sucursalId) {
    params.push(sucursalId);
    filtroSucursal = `AND c.sucursal_id = $3`;
  }

  const { rows } = await pool.query(`
    WITH cred AS (
      SELECT
        c.id, c.factura_id, c.creado_en, c.estado,
        c.valor_total::numeric   AS valor_total,
        c.cuota_inicial::numeric AS cuota_inicial,
        c.total_abonado::numeric AS total_abonado,
        f.numero AS factura_numero,
        COALESCE(dev.total, 0)::numeric AS devuelto,
        prod.nombres                    AS productos
      FROM creditos   c
      JOIN facturas   f  ON f.id  = c.factura_id
      JOIN sucursales su ON su.id = c.sucursal_id
      LEFT JOIN LATERAL (
        SELECT SUM(COALESCE(lf.cantidad_devuelta, 0) * lf.precio) AS total
        FROM lineas_factura lf WHERE lf.factura_id = f.id
      ) dev ON TRUE
      LEFT JOIN LATERAL (
        SELECT STRING_AGG(lf.nombre_producto, ', ' ORDER BY lf.id) AS nombres
        FROM lineas_factura lf WHERE lf.factura_id = f.id
      ) prod ON TRUE
      WHERE su.negocio_id = $1
        AND ${CLAVE_CLIENTE} = $2
        ${filtroSucursal}
    ),
    -- Las devoluciones no dejan fila propia (solo suben lineas_factura.cantidad_devuelta),
    -- así que la FECHA se toma de auditoría, que sí la registra por evento.
    dev_aud AS (
      SELECT
        a.id, a.fecha, cred.id AS credito_id,
        ((a.detalle::jsonb)->>'valor')::numeric AS valor
      FROM auditoria a
      JOIN cred ON cred.factura_id = a.registro_id
      WHERE a.negocio_id = $1
        AND a.tabla  = 'facturas'
        AND a.accion = 'Devolución en venta a crédito'
        AND COALESCE(((a.detalle::jsonb)->>'valor')::numeric, 0) > 0
    )

    SELECT fecha, tipo, concepto, cargo, abono, referencia_id,
           credito_id, factura_numero, credito_estado, anulable, orden
    FROM (

      -- 1. Factura a crédito otorgada (aumenta la deuda) — valor ORIGINAL
      SELECT
        cred.creado_en                                  AS fecha,
        'credito'::text                                 AS tipo,
        ('Factura #' || LPAD(COALESCE(cred.factura_numero, cred.factura_id)::text, 6, '0')
          || COALESCE(' — ' || cred.productos, ''))     AS concepto,
        (cred.valor_total + cred.devuelto)              AS cargo,
        NULL::numeric                                   AS abono,
        cred.id                                         AS referencia_id,
        cred.id                                         AS credito_id,
        COALESCE(cred.factura_numero, cred.factura_id)  AS factura_numero,
        cred.estado::text                               AS credito_estado,
        false                                           AS anulable,
        0                                               AS orden
      FROM cred

      UNION ALL

      -- 2. Cuota inicial: se paga al momento de la venta
      SELECT
        cred.creado_en, 'cuota_inicial'::text,
        'Cuota inicial — factura #' || LPAD(COALESCE(cred.factura_numero, cred.factura_id)::text, 6, '0'),
        NULL::numeric, cred.cuota_inicial,
        cred.id, cred.id, COALESCE(cred.factura_numero, cred.factura_id),
        cred.estado::text, false, 1
      FROM cred
      WHERE cred.cuota_inicial > 0

      UNION ALL

      -- 3. Abonos al capital
      SELECT
        ac.fecha, 'abono'::text,
        'Abono ' || COALESCE(ac.metodo, 'Efectivo')
          || ' — factura #' || LPAD(COALESCE(cred.factura_numero, cred.factura_id)::text, 6, '0')
          || COALESCE(' (' || NULLIF(ac.notas, '') || ')', ''),
        NULL::numeric, ac.valor::numeric,
        ac.id, cred.id, COALESCE(cred.factura_numero, cred.factura_id),
        cred.estado::text, false, 2
      FROM abonos_credito ac
      JOIN cred ON cred.id = ac.credito_id

      UNION ALL

      -- 4. Devoluciones con fecha real (auditoría)
      SELECT
        d.fecha, 'devolucion'::text,
        'Devolución de productos — factura #' || LPAD(COALESCE(cred.factura_numero, cred.factura_id)::text, 6, '0'),
        NULL::numeric, d.valor,
        d.id, cred.id, COALESCE(cred.factura_numero, cred.factura_id),
        cred.estado::text, false, 3
      FROM dev_aud d
      JOIN cred ON cred.id = d.credito_id

      UNION ALL

      -- 5. Devolución sin rastro en auditoría (cartera vieja): se emite el
      --    remanente para que el saldo cuadre, anclado a la fecha del crédito.
      SELECT
        cred.creado_en, 'devolucion'::text,
        'Devolución de productos — factura #' || LPAD(COALESCE(cred.factura_numero, cred.factura_id)::text, 6, '0')
          || ' (fecha no registrada)',
        NULL::numeric, (cred.devuelto - COALESCE(aud.total, 0)),
        cred.id, cred.id, COALESCE(cred.factura_numero, cred.factura_id),
        cred.estado::text, false, 4
      FROM cred
      LEFT JOIN LATERAL (
        SELECT SUM(d.valor) AS total FROM dev_aud d WHERE d.credito_id = cred.id
      ) aud ON TRUE
      WHERE (cred.devuelto - COALESCE(aud.total, 0)) > 1

      UNION ALL

      -- 6. Saldado a mano dejando remanente: el negocio perdonó la diferencia.
      --    Sin este ajuste el estado de cuenta mostraría una deuda que la
      --    pantalla de créditos ya no cobra.
      SELECT
        COALESCE(ult.fecha, cred.creado_en), 'ajuste'::text,
        'Ajuste por saldo condonado — factura #' || LPAD(COALESCE(cred.factura_numero, cred.factura_id)::text, 6, '0'),
        NULL::numeric, (cred.valor_total - cred.cuota_inicial - cred.total_abonado),
        cred.id, cred.id, COALESCE(cred.factura_numero, cred.factura_id),
        cred.estado::text, false, 5
      FROM cred
      LEFT JOIN LATERAL (
        SELECT MAX(ac.fecha) AS fecha FROM abonos_credito ac WHERE ac.credito_id = cred.id
      ) ult ON TRUE
      WHERE cred.estado = 'Saldado'
        AND (cred.valor_total - cred.cuota_inicial - cred.total_abonado) > 1

      UNION ALL

      -- 7. Mora: informativa. NO toca el saldo de capital (el service la deja
      --    con saldo nulo) porque es un ingreso financiero, no del producto.
      SELECT
        mm.fecha,
        CASE mm.tipo WHEN 'Cobro' THEN 'mora_cobro' ELSE 'mora_condonacion' END::text,
        CASE mm.tipo
          WHEN 'Cobro' THEN 'Mora cobrada ' || COALESCE(mm.metodo, '')
          ELSE 'Mora condonada' || COALESCE(' — ' || mm.motivo, '')
        END || ' — factura #' || LPAD(COALESCE(cred.factura_numero, cred.factura_id)::text, 6, '0'),
        NULL::numeric, mm.valor::numeric,
        mm.id, cred.id, COALESCE(cred.factura_numero, cred.factura_id),
        cred.estado::text, false, 6
      FROM movimientos_mora mm
      JOIN cred ON cred.id = mm.credito_id
      WHERE NOT mm.anulado

    ) movs
    ORDER BY fecha ASC NULLS LAST, credito_id ASC, orden ASC, referencia_id ASC
  `, params);

  return rows;
};

module.exports = {
  findAll, findByIdYNegocio,
  getAbonos, create, insertarAbono, updateEstado,
  findByFacturaId, reducirValorTotal,
  findPersonaPorClave, getEstadoCuenta,
};