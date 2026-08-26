const { pool } = require('../../config/db');

// ── Listar créditos (por sucursal o global del negocio) ──────────────────────
const findAll = async (sucursalId, negocioId) => {
  const filtro = sucursalId ? 'c.sucursal_id = $1' : 'su.negocio_id = $1';
  const param  = sucursalId ?? negocioId;

  const { rows } = await pool.query(`
    SELECT
      c.id, c.valor_total, c.cuota_inicial, c.total_abonado,
      c.estado, c.creado_en, c.sucursal_id,
      -- El pago total se dirige al CLIENTE, no a la clave de texto con la que
      -- la pantalla agrupa las tarjetas. Sin este id habria que resolverlo por
      -- cedula/nombre y dos personas homonimas compartirian el pago.
      c.cliente_id,
      -- Cargos: solo el pacto. Lo causado/pendiente lo deriva mora.service.
      c.fecha_limite, c.mora_condicion,
      c.interes_condicion, c.interes_desde,
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
//
// Un abono que vino de un PAGO TOTAL trae el contexto del pago completo: sin
// eso, en la ficha de un credito aparece una cifra suelta que no coincide con
// lo que el cliente pago, y el usuario cree que falta plata. Es exactamente el
// reclamo que llego de produccion en prestamos.
const getAbonos = async (creditoId) => {
  const { rows } = await pool.query(`
    SELECT ac.*, u.nombre AS usuario_nombre,
           (ac.abono_total_id IS NOT NULL)      AS de_pago_total,
           at.valor_total                       AS pago_total_valor,
           NULLIF(BTRIM(at.descripcion), '')    AS pago_total_descripcion,
           -- Entre cuantas facturas se repartio aquel pago.
           (SELECT COUNT(*) FROM abonos_credito h
             WHERE h.abono_total_id = ac.abono_total_id)::int AS pago_total_facturas
    FROM abonos_credito ac
    LEFT JOIN usuarios u ON u.id = ac.usuario_id
    LEFT JOIN abonos_totales at ON at.id = ac.abono_total_id
    WHERE ac.credito_id = $1
    ORDER BY ac.fecha ASC
  `, [creditoId]);
  return rows;
};

// ── Crear crédito (dentro de transacción externa) ────────────────────────────
// `fecha_limite`/`mora_condicion` son opcionales: sin ellos el crédito no tiene
// mora, que es el comportamiento de siempre. Lo mismo con `interes_condicion`,
// y las dos cosas son independientes entre sí.
const create = async (client, {
  factura_id, cliente_id, sucursal_id, valor_total, cuota_inicial,
  fecha_limite = null, mora_condicion = null,
  interes_condicion = null, interes_desde = null,
}) => {
  const { rows } = await client.query(`
    INSERT INTO creditos(factura_id, cliente_id, sucursal_id, valor_total, cuota_inicial,
                         total_abonado, estado, fecha_limite, mora_condicion,
                         interes_condicion, interes_desde)
    VALUES ($1, $2, $3, $4, $5, 0, 'Activo', $6, $7::jsonb, $8::jsonb, $9)
    RETURNING *
  `, [
    factura_id, cliente_id, sucursal_id, valor_total, cuota_inicial ?? 0,
    fecha_limite, mora_condicion ? JSON.stringify(mora_condicion) : null,
    interes_condicion ? JSON.stringify(interes_condicion) : null, interes_desde,
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
           credito_id, factura_numero, credito_estado, anulable, orden,
           abono_total_id, pago_total_valor, descripcion,
           anulado, motivo_anulacion, es_pago_total, detalle
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
        0                                               AS orden,
        NULL::integer                                   AS abono_total_id,
        NULL::numeric                                   AS pago_total_valor,
        NULL::text                                      AS descripcion,
        false                                           AS anulado,
        NULL::text                                      AS motivo_anulacion,
        false                                           AS es_pago_total,
        NULL::jsonb                                     AS detalle
      FROM cred

      UNION ALL

      -- 2. Cuota inicial: se paga al momento de la venta
      SELECT
        cred.creado_en, 'cuota_inicial'::text,
        'Cuota inicial — factura #' || LPAD(COALESCE(cred.factura_numero, cred.factura_id)::text, 6, '0'),
        NULL::numeric, cred.cuota_inicial,
        cred.id, cred.id, COALESCE(cred.factura_numero, cred.factura_id),
        cred.estado::text, false, 1,
        NULL::integer, NULL::numeric, NULL::text, false, NULL::text,
        false, NULL::jsonb
      FROM cred
      WHERE cred.cuota_inicial > 0

      UNION ALL

      -- 3. Abonos al capital.
      --
      -- Un PAGO TOTAL se escribe como una fila por credito, pero el usuario hizo
      -- UN pago: mostrarlo despedazado le hace buscar una plata que cree perdida
      -- —paso exactamente asi en prestamos—. Aqui las filas que comparten
      -- abono_total_id se COLAPSAN en un solo movimiento y el reparto viaja en
      -- detalle para poder desplegarlo. Es el mismo criterio que ya usa el
      -- estado de cuenta de acreedores.
      --
      -- El importe se DERIVA con SUM, nunca se guarda: cancelar una factura
      -- anula uno de los pedazos y un total guardado quedaria inflado contra un
      -- saldo ya bajado.
      --
      -- La clave de agrupacion es el pago cuando existe, y el id del abono
      -- cuando no: asi un abono suelto sigue siendo su propia fila.
      SELECT
        MIN(ac.fecha),
        'abono'::text,
        CASE WHEN ac.abono_total_id IS NOT NULL
          THEN 'Pago total ' || COALESCE(MIN(ac.metodo), 'Efectivo')
               || ' — repartido entre ' || COUNT(*)::text
               || CASE WHEN COUNT(*) = 1 THEN ' factura' ELSE ' facturas' END
          ELSE 'Abono ' || COALESCE(MIN(ac.metodo), 'Efectivo')
               || ' — factura #' || LPAD(MIN(COALESCE(cred.factura_numero, cred.factura_id))::text, 6, '0')
               || COALESCE(' (' || NULLIF(MIN(ac.notas), '') || ')', '')
        END,
        NULL::numeric,
        SUM(ac.valor)::numeric,
        -- referencia_id: el abono cuando es suelto (es lo que anula el service),
        -- y el pago cuando esta colapsado (no hay una sola fila que representar).
        COALESCE(ac.abono_total_id, MIN(ac.id)),
        -- Un pago colapsado abarca VARIOS creditos: no tiene uno solo.
        CASE WHEN ac.abono_total_id IS NULL THEN MIN(cred.id) END,
        CASE WHEN ac.abono_total_id IS NULL THEN MIN(COALESCE(cred.factura_numero, cred.factura_id)) END,
        -- Solo se marca Cancelado si TODOS los creditos del reparto lo estan;
        -- si solo uno lo esta, su pedazo ya quedo anulado y eso lo cubre
        -- valor_anulado. Marcar el movimiento entero sacaria del saldo
        -- tambien lo que se abono a las facturas vivas.
        CASE WHEN ac.abono_total_id IS NULL THEN MIN(cred.estado::text)
             WHEN BOOL_AND(cred.estado = 'Cancelado') THEN 'Cancelado'
        END,
        -- Anulable solo el abono suelto y todavia vigente: anular medio reparto
        -- de un pago total deja la cuenta a medias, y anular dos veces el mismo
        -- abono bajaria la deuda dos veces.
        (ac.abono_total_id IS NULL AND NOT BOOL_OR(ac.anulado)), 2,
        ac.abono_total_id, MIN(at.valor_total)::numeric,
        -- La nota viaja en columna PROPIA, no pegada al concepto.
        NULLIF(BTRIM(MIN(at.descripcion)), ''),
        -- El movimiento sale del saldo solo si NO queda nada vigente en el.
        BOOL_AND(ac.anulado),
        MIN(ac.motivo_anulacion),
        (ac.abono_total_id IS NOT NULL),
        -- El reparto, para desplegarlo. En el orden en que se aplico (FIFO).
        CASE WHEN ac.abono_total_id IS NOT NULL THEN
          JSONB_AGG(
            JSONB_BUILD_OBJECT(
              'id',               ac.id,
              'credito_id',       cred.id,
              'factura',          COALESCE(cred.factura_numero, cred.factura_id),
              'valor',            ac.valor,
              'anulado',          ac.anulado,
              'motivo_anulacion', ac.motivo_anulacion
            ) ORDER BY cred.creado_en, cred.id
          )
        END
      FROM abonos_credito ac
      JOIN cred ON cred.id = ac.credito_id
      LEFT JOIN abonos_totales at ON at.id = ac.abono_total_id
      -- El abono anulado NO se filtra: se muestra marcado con su motivo y sin
      -- bajar la deuda (el service lo deja fuera del saldo). Ocultarlo cuadraria
      -- el numero y borraria la explicacion de por que cambio la cuenta, que es
      -- justo con lo que un negocio le responde a un cliente meses despues.
      -- Es el mismo criterio que ya usa prestamos.
      GROUP BY ac.abono_total_id, (CASE WHEN ac.abono_total_id IS NULL THEN ac.id END)

      UNION ALL

      -- 4. Devoluciones con fecha real (auditoría)
      SELECT
        d.fecha, 'devolucion'::text,
        'Devolución de productos — factura #' || LPAD(COALESCE(cred.factura_numero, cred.factura_id)::text, 6, '0'),
        NULL::numeric, d.valor,
        d.id, cred.id, COALESCE(cred.factura_numero, cred.factura_id),
        cred.estado::text, false, 3,
        NULL::integer, NULL::numeric, NULL::text, false, NULL::text,
        false, NULL::jsonb
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
        cred.estado::text, false, 4,
        NULL::integer, NULL::numeric, NULL::text, false, NULL::text,
        false, NULL::jsonb
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
        cred.estado::text, false, 5,
        NULL::integer, NULL::numeric, NULL::text, false, NULL::text,
        false, NULL::jsonb
      FROM cred
      LEFT JOIN LATERAL (
        SELECT MAX(ac.fecha) AS fecha FROM abonos_credito ac WHERE ac.credito_id = cred.id
      ) ult ON TRUE
      WHERE cred.estado = 'Saldado'
        AND (cred.valor_total - cred.cuota_inicial - cred.total_abonado) > 1

      UNION ALL

      -- 7. Cargos financieros (mora e interés): informativos. NO tocan el saldo
      --    de capital (el service los deja con saldo nulo) porque son ingreso
      --    financiero, no del producto.
      --
      --    Se discriminan por concepto: llamarle "mora" a un cobro de interés
      --    es decirle al cliente que se atrasó cuando no lo hizo. Los tipos
      --    nuevos tienen que estar en el Set INFORMATIVOS del service.
      SELECT
        mm.fecha,
        (CASE
          WHEN mm.concepto = 'interes' THEN
            CASE mm.tipo WHEN 'Cobro' THEN 'interes_cobro' ELSE 'interes_condonacion' END
          ELSE
            CASE mm.tipo WHEN 'Cobro' THEN 'mora_cobro' ELSE 'mora_condonacion' END
        END)::text,
        CASE
          WHEN mm.concepto = 'interes' THEN
            CASE mm.tipo
              WHEN 'Cobro' THEN 'Interés de financiación cobrado ' || COALESCE(mm.metodo, '')
              ELSE 'Interés condonado' || COALESCE(' — ' || mm.motivo, '')
            END
          ELSE
            CASE mm.tipo
              WHEN 'Cobro' THEN 'Mora cobrada ' || COALESCE(mm.metodo, '')
              ELSE 'Mora condonada' || COALESCE(' — ' || mm.motivo, '')
            END
        END || ' — factura #' || LPAD(COALESCE(cred.factura_numero, cred.factura_id)::text, 6, '0'),
        NULL::numeric, mm.valor::numeric,
        mm.id, cred.id, COALESCE(cred.factura_numero, cred.factura_id),
        cred.estado::text, false, 6,
        NULL::integer, NULL::numeric, NULL::text, false, NULL::text,
        false, NULL::jsonb
      FROM movimientos_mora mm
      JOIN cred ON cred.id = mm.credito_id
      WHERE NOT mm.anulado

    ) movs
    ORDER BY fecha ASC NULLS LAST, credito_id ASC, orden ASC, referencia_id ASC
  `, params);

  return rows;
};

/**
 * Anula los abonos VIVOS de un crédito dejando el motivo a la vista, y baja
 * `total_abonado`.
 *
 * Espejo exacto de lo que hace préstamos al devolver un producto. Cancelar una
 * factura a crédito ponía el crédito en 'Cancelado' pero dejaba sus abonos
 * vivos: el cobro salía de la cuenta y los pagos se quedaban restando contra
 * nada, igual que pasaba en préstamos. Se anulan, no se borran — la fila es la
 * explicación de por qué la cuenta cuadra así.
 *
 * Idempotente: lo ya anulado no se vuelve a descontar.
 */
const anularAbonosDeCredito = async (client, creditoId, motivo) => {
  const { rows } = await client.query(`
    WITH previos AS (
      SELECT id, (valor - valor_anulado) AS pendiente
        FROM abonos_credito WHERE credito_id = $1 AND NOT anulado
    )
    UPDATE abonos_credito a
       SET anulado = TRUE, valor_anulado = a.valor,
           motivo_anulacion = $2, anulado_en = NOW()
      FROM previos pv
     WHERE a.id = pv.id
     RETURNING pv.pendiente AS valor
  `, [creditoId, motivo]);

  const total = rows.reduce((s, r) => s + Number(r.valor), 0);
  if (total > 0) {
    await client.query(
      `UPDATE creditos SET total_abonado = GREATEST(0, total_abonado - $1) WHERE id = $2`,
      [total, creditoId],
    );
  }
  return { anulados: rows.length, total };
};

/**
 * Anula abonos hasta cubrir un SOBRANTE, del más nuevo al más viejo. Es el caso
 * de la devolución PARCIAL de una venta a crédito: el crédito baja de valor y
 * lo ya pagado puede quedar por encima.
 */
const anularSobranteDeAbonosCredito = async (client, creditoId, sobrante, motivo) => {
  let restante = Number(sobrante);
  if (restante <= 0) return { anulados: 0, total: 0 };

  const { rows } = await client.query(
    `SELECT id, (valor - valor_anulado) AS disponible FROM abonos_credito
      WHERE credito_id = $1 AND NOT anulado AND (valor - valor_anulado) > 0
      ORDER BY fecha DESC, id DESC`,
    [creditoId],
  );

  let anulados = 0, total = 0;
  for (const a of rows) {
    if (restante <= 0) break;
    const disponible = Number(a.disponible);
    const quita = Math.min(disponible, restante);
    await client.query(
      `UPDATE abonos_credito
          SET valor_anulado = valor_anulado + $2,
              anulado = (valor_anulado + $2) >= valor,
              motivo_anulacion = $3, anulado_en = NOW()
        WHERE id = $1`,
      [a.id, quita, motivo],
    );
    restante -= quita; total += quita;
    if (quita >= disponible) anulados++;
  }

  await client.query(
    `UPDATE creditos SET total_abonado = GREATEST(0, total_abonado - $1) WHERE id = $2`,
    [total, creditoId],
  );
  return { anulados, total };
};

// ── Pago total: créditos ACTIVOS de un cliente, en orden de antigüedad ───────
//
// El reparto va del más viejo al más nuevo y **solo dentro de una sucursal**:
// un pago hecho en una sede no puede bajar la deuda de otra, o la cartera de
// cada una deja de cuadrar. Es la misma regla que en préstamos.
const findCreditosActivosDeCliente = async (executor, clienteId, negocioId, sucursalId) => {
  const { rows } = await executor.query(`
    SELECT c.id, c.valor_total, c.cuota_inicial, c.total_abonado, c.estado,
           c.sucursal_id, c.fecha_limite, c.mora_condicion,
           c.interes_condicion, c.interes_desde, c.creado_en,
           (c.valor_total - c.cuota_inicial - c.total_abonado) AS saldo_pendiente,
           f.numero AS factura_numero, f.nombre_cliente
      FROM creditos   c
      JOIN facturas   f  ON f.id  = c.factura_id
      JOIN sucursales su ON su.id = c.sucursal_id
     WHERE c.cliente_id = $1
       AND su.negocio_id = $2
       AND c.sucursal_id = $3
       AND c.estado = 'Activo'
       AND (c.valor_total - c.cuota_inicial - c.total_abonado) > 0
     ORDER BY c.creado_en ASC
  `, [clienteId, negocioId, sucursalId]);
  return rows;
};

const insertarAbonoTotalCredito = async (client, {
  cliente_id, sucursal_id, valor_total, metodo, usuario_id, descripcion,
}) => {
  const { rows } = await client.query(`
    INSERT INTO abonos_totales
      (tipo_persona, persona_id, sucursal_id, valor_total, metodo, usuario_id, descripcion, destino)
    VALUES ('cliente', $1, $2, $3, $4, $5, $6, 'credito')
    RETURNING id, fecha
  `, [cliente_id, sucursal_id, valor_total, metodo, usuario_id || null,
      descripcion ? String(descripcion).trim().slice(0, 200) : null]);
  return rows[0];
};

/** Inserta un pedazo del reparto, atado al pago que lo originó. */
const insertarAbonoDeTotal = async (client, { credito_id, usuario_id, valor, metodo, abono_total_id }) => {
  const { rows: abono } = await client.query(`
    INSERT INTO abonos_credito(credito_id, usuario_id, valor, metodo, abono_total_id)
    VALUES ($1, $2, $3, $4, $5) RETURNING id
  `, [credito_id, usuario_id || null, valor, metodo, abono_total_id]);
  const { rows } = await client.query(`
    UPDATE creditos SET total_abonado = total_abonado + $1 WHERE id = $2
    RETURNING valor_total, cuota_inicial, total_abonado
  `, [valor, credito_id]);
  return { ...rows[0], abono_id: abono[0].id };
};

/** El gemelo de un pago total de créditos: misma persona, valor y ventana. */
const buscarAbonoTotalCreditoGemelo = async (executor, { cliente_id, valor_total, metodo, segundos = 90 }) => {
  const { rows } = await executor.query(`
    SELECT id, fecha FROM abonos_totales
     WHERE destino = 'credito' AND tipo_persona = 'cliente' AND persona_id = $1
       AND valor_total = $2 AND COALESCE(metodo, '') = COALESCE($3, '')
       AND fecha > NOW() - ($4 || ' seconds')::interval
     LIMIT 1
  `, [cliente_id, valor_total, metodo || null, String(segundos)]);
  return rows[0] || null;
};

// ── Anular UN abono de crédito ───────────────────────────────────────────────
//
// Se anula, no se borra: la fila queda en el extracto con su motivo, que es la
// única forma de explicar después por qué la cuenta cambió.
const anularAbonoCredito = async (client, abonoId, creditoId, motivo) => {
  const { rows } = await client.query(`
    WITH previo AS (
      SELECT id, (valor - valor_anulado) AS pendiente
        FROM abonos_credito
       WHERE id = $1 AND credito_id = $2 AND NOT anulado
    )
    UPDATE abonos_credito a
       SET anulado = TRUE, valor_anulado = a.valor,
           motivo_anulacion = $3, anulado_en = NOW()
      FROM previo pv WHERE a.id = pv.id
     RETURNING pv.pendiente AS valor
  `, [abonoId, creditoId, motivo]);
  if (!rows.length) return null;
  const valor = Number(rows[0].valor);
  await client.query(
    `UPDATE creditos SET total_abonado = GREATEST(0, total_abonado - $1) WHERE id = $2`,
    [valor, creditoId],
  );
  return { valor };
};

const findAbonoCreditoById = async (executor, abonoId, negocioId) => {
  const { rows } = await executor.query(`
    SELECT ac.*, c.estado AS credito_estado, c.sucursal_id, c.factura_id,
           c.valor_total, c.cuota_inicial, c.total_abonado
      FROM abonos_credito ac
      JOIN creditos   c  ON c.id  = ac.credito_id
      JOIN sucursales su ON su.id = c.sucursal_id
     WHERE ac.id = $1 AND su.negocio_id = $2
  `, [abonoId, negocioId]);
  return rows[0] || null;
};

module.exports = {
  findAll, findByIdYNegocio,
  getAbonos, create, insertarAbono, updateEstado,
  findByFacturaId, reducirValorTotal,
  findPersonaPorClave, getEstadoCuenta,
  anularAbonosDeCredito, anularSobranteDeAbonosCredito,
  findCreditosActivosDeCliente, insertarAbonoTotalCredito, insertarAbonoDeTotal,
  buscarAbonoTotalCreditoGemelo, anularAbonoCredito, findAbonoCreditoById,
};