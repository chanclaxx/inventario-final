const { pool } = require('../../config/db');
const { asignarNumeroDocumento } = require('../../utils/numeracion.util');

const findAll = async (sucursalId, negocioId) => {
  const filtro = sucursalId ? 'p.sucursal_id = $1' : 'su.negocio_id = $1';
  const param  = sucursalId ?? negocioId;
  // El "último abono" es de la PERSONA y abarca el NEGOCIO entero, no la
  // sucursal que se esté mirando. Filtrando por sucursal, el negocio se deriva
  // de ella — exactamente lo que hacía `su.negocio_id` cuando esto vivía en una
  // subconsulta por fila. Así la consulta sigue teniendo UN solo parámetro y no
  // pasa a confiar en el negocio_id del token, que es otra fuente.
  const alcanceNegocio = sucursalId
    ? '(SELECT negocio_id FROM sucursales WHERE id = $1)'
    : '$1';

  const { rows } = await pool.query(`
    -- El último abono depende de la PERSONA, no del préstamo, y aquí se calcula
    -- UNA vez por persona. Antes era una subconsulta correlacionada, o sea que
    -- se recomputaba una vez por FILA: en un negocio con 8.480 préstamos y 590
    -- prestamistas eran 8.480 recorridos de abonos_prestamo para 590 valores
    -- distintos. La consulta tardaba 46 s — más que el timeout de 30 s del
    -- axios del frontend, así que la petición se abortaba, la página se quedaba
    -- con la lista vacía y el negocio veía a sus prestamistas SIN préstamos.
    -- Agrupado por persona da la misma respuesta en ~130 ms.
    WITH ult_prestatario AS (
      SELECT p2.prestatario_id AS pid, MAX(ap.fecha) AS ultimo
        FROM abonos_prestamo ap
        JOIN prestamos       p2  ON p2.id  = ap.prestamo_id
        JOIN sucursales      su2 ON su2.id = p2.sucursal_id
       WHERE su2.negocio_id = ${alcanceNegocio}
         AND p2.prestatario_id IS NOT NULL
       GROUP BY p2.prestatario_id
    ),
    ult_cliente AS (
      SELECT p2.cliente_id AS cid, MAX(ap.fecha) AS ultimo
        FROM abonos_prestamo ap
        JOIN prestamos       p2  ON p2.id  = ap.prestamo_id
        JOIN sucursales      su2 ON su2.id = p2.sucursal_id
       WHERE su2.negocio_id = ${alcanceNegocio}
         AND p2.cliente_id IS NOT NULL
       GROUP BY p2.cliente_id
    )
    SELECT
      p.id, p.numero, p.fecha, p.prestatario, p.cedula, p.telefono,
      p.nombre_producto, p.imei, p.cantidad_prestada,
      p.valor_prestamo, p.total_abonado, p.estado,
      p.prestatario_id, p.empleado_id, p.cliente_id, p.sucursal_id,
      p.atributo_id, p.variante_id, p.atributo_label, p.variante_label,
      -- Plazo y condición pactada: sin estas dos, mora.anotarLista cree que
      -- ningún préstamo tiene plazo y la lista muestra todo "sin mora".
      p.fecha_limite, p.mora_condicion,
      -- Lo mismo para el interés corriente: sin el pacto, anotarLista lo da
      -- por inexistente y el saldo saldría sin los intereses causados.
      p.interes_condicion, p.interes_desde,
      su.nombre AS sucursal_nombre,
      (p.valor_prestamo - p.total_abonado) AS saldo_pendiente,
      u.nombre  AS usuario_nombre,
      pr.nombre AS prestatario_nombre,
      e.nombre  AS empleado_nombre,
      c.nombre  AS cliente_nombre,
      c.celular AS cliente_celular,
      s.color   AS serial_color,
      COALESCE(pr.saldo_a_favor, 0) AS prestatario_saldo_a_favor,
      COALESCE(c.saldo_a_favor,  0) AS cliente_saldo_a_favor,
      COALESCE(lps.nombre, lpc.nombre) AS linea_nombre,
      up.ultimo AS ultimo_abono_prestatario,
      uc.ultimo AS ultimo_abono_cliente
    FROM prestamos p
    JOIN  sucursales                su  ON su.id  = p.sucursal_id
    LEFT JOIN usuarios               u   ON u.id   = p.usuario_id
    LEFT JOIN prestatarios           pr  ON pr.id  = p.prestatario_id
    LEFT JOIN empleados_prestatario  e   ON e.id   = p.empleado_id
    LEFT JOIN clientes               c   ON c.id   = p.cliente_id
    -- Un IMEI puede estar en VARIAS filas de seriales (el mismo equipo
    -- registrado en dos productos, o en dos sucursales), así que un LEFT JOIN
    -- plano multiplica el préstamo. Antes eso se resolvía descartando las filas
    -- cuyo serial no estuviera en la misma sucursal — y con ello se BORRABAN de
    -- la lista préstamos que sí existen: 11 en VideoTiendaGafas, 328 en
    -- Cellsite, uno de ellos con deuda viva. El usuario los buscaba y no
    -- aparecían.
    --
    -- El LATERAL escoge UNA sola fila, prefiriendo la de la sucursal del
    -- préstamo. No multiplica y no descarta: si no hay serial en esa sucursal,
    -- el préstamo igual sale, solo que sin color ni línea.
    LEFT JOIN LATERAL (
      SELECT s2.color, ps3.linea_id
        FROM seriales s2
        LEFT JOIN productos_serial ps3 ON ps3.id = s2.producto_id
       WHERE s2.imei = p.imei
       ORDER BY (ps3.sucursal_id = p.sucursal_id) DESC NULLS LAST, s2.id
       LIMIT 1
    ) s ON p.imei IS NOT NULL
    LEFT JOIN lineas_producto        lps ON lps.id = s.linea_id
    LEFT JOIN productos_cantidad     pc  ON pc.id  = p.producto_id AND p.imei IS NULL
    LEFT JOIN lineas_producto        lpc ON lpc.id = pc.linea_id
    LEFT JOIN ult_prestatario        up  ON up.pid = p.prestatario_id
    LEFT JOIN ult_cliente            uc  ON uc.cid = p.cliente_id
    WHERE ${filtro}
    ORDER BY
      CASE p.estado WHEN 'Activo' THEN 0 WHEN 'Saldado' THEN 1 ELSE 2 END,
      p.fecha DESC
  `, [param]);
  return rows;
};

const findById = async (id) => {
  const { rows } = await pool.query(`
    SELECT p.*, su.nombre AS sucursal_nombre
    FROM prestamos  p
    JOIN sucursales su ON su.id = p.sucursal_id
    WHERE p.id = $1
  `, [id]);
  return rows[0] || null;
};

const perteneceAlNegocio = async (id, negocioId) => {
  const { rows } = await pool.query(`
    SELECT p.id FROM prestamos p
    JOIN sucursales s ON s.id = p.sucursal_id
    WHERE p.id = $1 AND s.negocio_id = $2
  `, [id, negocioId]);
  return rows.length > 0;
};

const getAbonos = async (prestamoId) => {
  const { rows } = await pool.query(`
    SELECT
      ap.id, ap.prestamo_id, ap.fecha, ap.valor, ap.metodo,
      ap.abono_total_id, ap.anulado, ap.valor_anulado, ap.motivo_anulacion,
      at.valor_total  AS abono_total_valor,
      at.descripcion  AS abono_total_descripcion,
      u.nombre AS usuario_nombre
    FROM abonos_prestamo ap
    LEFT JOIN usuarios      u  ON u.id  = ap.usuario_id
    LEFT JOIN abonos_totales at ON at.id = ap.abono_total_id
    WHERE ap.prestamo_id = $1
    ORDER BY ap.fecha
  `, [prestamoId]);
  return rows;
};

const getRetomasPorPrestamo = async (prestamoId) => {
  const { rows } = await pool.query(`
    SELECT
      r.id, r.nombre_producto, r.imei, r.valor_retoma,
      r.cantidad_retoma, r.tipo_retoma, r.ingreso_inventario,
      r.color, r.descripcion,
      ps.nombre AS producto_serial_nombre,
      pc.nombre AS producto_cantidad_nombre
    FROM retomas r
    LEFT JOIN productos_serial   ps ON ps.id = r.producto_serial_id
    LEFT JOIN productos_cantidad pc ON pc.id = r.producto_cantidad_id
    WHERE r.prestamo_id = $1
    ORDER BY r.id
  `, [prestamoId]);
  return rows;
};

const create = async (client, {
  sucursal_id, usuario_id, prestatario, cedula, telefono,
  nombre_producto, imei, producto_id, cantidad_prestada, valor_prestamo,
  prestatario_id, empleado_id, cliente_id,
  atributo_id, variante_id, atributo_label, variante_label,
  // Plazo de pago y condición de mora congelada. Nulos = préstamo sin mora,
  // que es el comportamiento de siempre.
  fecha_limite = null, mora_condicion = null,
  // Plan de interés corriente congelado. Nulo = préstamo sin interés. Es
  // independiente del plazo: se puede tener uno sin el otro.
  interes_condicion = null, interes_desde = null,
}) => {
  const { rows } = await client.query(`
    INSERT INTO prestamos(
      sucursal_id, usuario_id, prestatario, cedula, telefono,
      nombre_producto, imei, producto_id, cantidad_prestada, valor_prestamo,
      prestatario_id, empleado_id, cliente_id,
      atributo_id, variante_id, atributo_label, variante_label,
      fecha_limite, mora_condicion, interes_condicion, interes_desde
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20::jsonb,$21)
    RETURNING *
  `, [
    sucursal_id, usuario_id, prestatario, cedula, telefono,
    nombre_producto, imei, producto_id, cantidad_prestada, valor_prestamo,
    prestatario_id || null, empleado_id || null, cliente_id || null,
    atributo_id   || null, variante_id  || null,
    atributo_label || null, variante_label || null,
    fecha_limite, mora_condicion ? JSON.stringify(mora_condicion) : null,
    interes_condicion ? JSON.stringify(interes_condicion) : null, interes_desde,
  ]);
  rows[0].numero = await asignarNumeroDocumento(client, {
    tipo: 'prestamo', docId: rows[0].id, sucursalId: sucursal_id,
  });
  return rows[0];
};

// `valor` es SOLO capital. La parte del pago que va a mora se registra en
// `movimientos_mora` y nunca entra a `total_abonado`: los reportes calculan la
// utilidad del producto como (abonado − costo) y la contarían como margen.
// Devuelve `abono_id` para poder ligarle el movimiento de mora y revertirlos juntos.
const insertarAbono = async (client, { prestamo_id, valor, metodo, usuario_id }) => {
  const { rows: abono } = await client.query(
    `INSERT INTO abonos_prestamo(prestamo_id, valor, metodo, usuario_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [prestamo_id, valor, metodo || 'Efectivo', usuario_id || null]
  );
  const { rows } = await client.query(`
    UPDATE prestamos SET total_abonado = total_abonado + $1
    WHERE id = $2
    RETURNING valor_prestamo, total_abonado
  `, [valor, prestamo_id]);
  return { ...rows[0], abono_id: abono[0].id };
};

/**
 * Anula los abonos VIVOS de un préstamo dejando el motivo a la vista, y baja
 * `total_abonado` por lo que se anuló.
 *
 * No se borran: la fila se queda en el estado de cuenta marcada, para que se
 * pueda leer POR QUÉ la cuenta cambió. Borrarla cuadraría el número y destruiría
 * la explicación, que es justo lo que hace imposible responderle a un cliente
 * seis meses después.
 *
 * Idempotente: los que ya estaban anulados no se vuelven a contar, así que
 * llamarla dos veces no baja `total_abonado` dos veces.
 */
const anularAbonosDePrestamo = async (client, prestamoId, motivo) => {
  const { rows } = await client.query(`
    -- El pendiente se calcula ANTES del UPDATE: RETURNING entrega los valores
    -- YA modificados, así que leerlo después daría siempre cero.
    WITH previos AS (
      SELECT id, (valor - valor_anulado) AS pendiente
        FROM abonos_prestamo
       WHERE prestamo_id = $1 AND NOT anulado
    )
    UPDATE abonos_prestamo a
       SET anulado = TRUE, valor_anulado = a.valor,
           motivo_anulacion = $2, anulado_en = NOW()
      FROM previos pv
     WHERE a.id = pv.id
     RETURNING a.id, pv.pendiente AS valor
  `, [prestamoId, motivo]);

  const total = rows.reduce((s, r) => s + Number(r.valor), 0);
  if (total > 0) {
    await client.query(
      `UPDATE prestamos SET total_abonado = GREATEST(0, total_abonado - $1) WHERE id = $2`,
      [total, prestamoId],
    );
  }
  return { anulados: rows.length, total };
};

/**
 * Anula abonos hasta cubrir un SOBRANTE, del más nuevo al más viejo.
 *
 * Es el caso de la devolución parcial: se devuelven unidades, el préstamo baja
 * de valor y lo ya abonado queda por encima. Se empieza por el más reciente
 * porque el sobrante lo produjo el último pago, no el primero.
 *
 * Si un abono es MÁS GRANDE que el sobrante no se parte en dos —eso inventaría
 * una fila que nadie registró—: se deja vivo y el resto se acomoda bajando
 * `total_abonado`. El préstamo queda exactamente en su nuevo valor, que es lo
 * que tiene que cuadrar.
 */
const anularSobranteDeAbonos = async (client, prestamoId, sobrante, motivo) => {
  let restante = Number(sobrante);
  if (restante <= 0) return { anulados: 0, total: 0 };

  const { rows } = await client.query(
    `SELECT id, (valor - valor_anulado) AS disponible FROM abonos_prestamo
      WHERE prestamo_id = $1 AND NOT anulado AND (valor - valor_anulado) > 0
      ORDER BY fecha DESC, id DESC`,
    [prestamoId],
  );

  let anulados = 0, total = 0;
  for (const a of rows) {
    if (restante <= 0) break;
    const disponible = Number(a.disponible);
    const quita = Math.min(disponible, restante);
    // Si se lleva el abono entero queda ANULADO; si solo se lleva un pedazo, la
    // fila sigue viva y contando por lo que queda. Así no hay que partir el
    // abono en dos filas que nadie registró.
    await client.query(
      `UPDATE abonos_prestamo
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
    `UPDATE prestamos SET total_abonado = GREATEST(0, total_abonado - $1) WHERE id = $2`,
    [total, prestamoId],
  );
  return { anulados, total };
};

/** Anula UN abono puntual (el caso del pago duplicado). Misma regla. */
const anularAbonoConMotivo = async (client, abonoId, motivo) => {
  const { rows } = await client.query(`
    WITH previo AS (
      SELECT id, prestamo_id, (valor - valor_anulado) AS pendiente
        FROM abonos_prestamo WHERE id = $1 AND NOT anulado
    )
    UPDATE abonos_prestamo a
       SET anulado = TRUE, valor_anulado = a.valor,
           motivo_anulacion = $2, anulado_en = NOW()
      FROM previo pv
     WHERE a.id = pv.id
     RETURNING pv.prestamo_id, pv.pendiente AS valor
  `, [abonoId, motivo]);
  if (!rows.length) return null;
  await client.query(
    `UPDATE prestamos SET total_abonado = GREATEST(0, total_abonado - $1) WHERE id = $2`,
    [rows[0].valor, rows[0].prestamo_id],
  );
  return { prestamo_id: rows[0].prestamo_id, valor: Number(rows[0].valor) };
};

/**
 * ¿Ya existe un abono idéntico recién registrado? Es la baranda contra el doble
 * clic: mismo préstamo, mismo valor, mismo método, dentro de una ventana corta.
 * Nadie paga dos veces lo mismo en el mismo minuto — cuando pasa, es el
 * formulario enviándose dos veces, no el cliente pagando dos veces.
 */
const buscarAbonoGemelo = async (executor, { prestamo_id, valor, metodo, segundos = 90 }) => {
  const { rows } = await executor.query(`
    SELECT id, fecha FROM abonos_prestamo
     WHERE prestamo_id = $1 AND valor = $2
       AND COALESCE(metodo, '') = COALESCE($3, '')
       AND NOT anulado
       AND fecha > NOW() - ($4 || ' seconds')::interval
     LIMIT 1
  `, [prestamo_id, valor, metodo || null, String(segundos)]);
  return rows[0] || null;
};

/** El gemelo de un PAGO TOTAL: misma persona, mismo valor, misma ventana. */
const buscarAbonoTotalGemelo = async (executor, { tipo_persona, persona_id, valor_total, metodo, segundos = 90 }) => {
  const { rows } = await executor.query(`
    SELECT id, fecha FROM abonos_totales
     WHERE tipo_persona = $1 AND persona_id = $2 AND valor_total = $3
       AND COALESCE(metodo, '') = COALESCE($4, '')
       AND fecha > NOW() - ($5 || ' seconds')::interval
     LIMIT 1
  `, [tipo_persona, persona_id, valor_total, metodo || null, String(segundos)]);
  return rows[0] || null;
};

const updateEstado = async (client, id, estado) => {
  await client.query('UPDATE prestamos SET estado = $1 WHERE id = $2', [estado, id]);
};

const findByIdYNegocio = async (id, negocioId) => {
  const { rows } = await pool.query(`
    SELECT p.*, su.nombre AS sucursal_nombre
    FROM prestamos  p
    JOIN sucursales su ON su.id = p.sucursal_id
    WHERE p.id = $1 AND su.negocio_id = $2
  `, [id, negocioId]);
  return rows[0] || null;
};

const crearAjusteDeuda = async ({ tipo, persona_id, valor, descripcion, sucursal_id, usuario_id, negocio_id }) => {
  let nombre, telefono;
  if (tipo === 'prestatario') {
    const { rows } = await pool.query(
      'SELECT nombre, telefono FROM prestatarios WHERE id = $1 AND negocio_id = $2',
      [persona_id, negocio_id]
    );
    if (!rows.length) return null;
    ({ nombre, telefono } = rows[0]);
  } else {
    const { rows } = await pool.query(
      'SELECT nombre, celular AS telefono FROM clientes WHERE id = $1 AND negocio_id = $2',
      [persona_id, negocio_id]
    );
    if (!rows.length) return null;
    ({ nombre, telefono } = rows[0]);
  }

  const nombreProducto = descripcion?.trim() || 'Ajuste de deuda';
  const tel = telefono || '0000000000';

  if (tipo === 'prestatario') {
    const { rows } = await pool.query(`
      INSERT INTO prestamos(fecha, prestatario, cedula, telefono, nombre_producto, imei,
        cantidad_prestada, valor_prestamo, total_abonado, estado, prestatario_id, sucursal_id, usuario_id)
      VALUES (NOW(), $1, 'AJUSTE', $2, $3, NULL, 1, $4, 0, 'Activo', $5, $6, $7)
      RETURNING *
    `, [nombre, tel, nombreProducto, valor, persona_id, sucursal_id, usuario_id]);
    rows[0].numero = await asignarNumeroDocumento(pool, {
      tipo: 'prestamo', docId: rows[0].id, negocioId: negocio_id,
    });
    return rows[0];
  } else {
    const { rows } = await pool.query(`
      INSERT INTO prestamos(fecha, prestatario, cedula, telefono, nombre_producto, imei,
        cantidad_prestada, valor_prestamo, total_abonado, estado, cliente_id, sucursal_id, usuario_id)
      VALUES (NOW(), $1, 'AJUSTE', $2, $3, NULL, 1, $4, 0, 'Activo', $5, $6, $7)
      RETURNING *
    `, [nombre, tel, nombreProducto, valor, persona_id, sucursal_id, usuario_id]);
    rows[0].numero = await asignarNumeroDocumento(pool, {
      tipo: 'prestamo', docId: rows[0].id, negocioId: negocio_id,
    });
    return rows[0];
  }
};

const ajustarStock = async (client, productoId, cantidad) => {
  await client.query(
    'UPDATE productos_cantidad SET stock = stock + $1 WHERE id = $2',
    [cantidad, productoId]
  );
};

const actualizarCantidadYValor = async (client, id, nuevaCantidad, nuevoValor) => {
  await client.query(
    `UPDATE prestamos
     SET cantidad_prestada = $1,
         valor_prestamo    = $2
     WHERE id = $3`,
    [nuevaCantidad, nuevoValor, id]
  );
};

// ── Marca el serial como vendido al saldarse el préstamo ─────────────────────
// Solo actúa sobre el serial de la sucursal del préstamo para evitar
// colisiones si el mismo IMEI existiera en otra sucursal (no debería, pero
// es una salvaguarda extra dentro de la transacción).
const salarSerial = async (client, imei, sucursalId) => {
  await client.query(`
    UPDATE seriales s
    SET vendido      = true,
        prestado     = false,
        fecha_salida = CURRENT_DATE
    FROM productos_serial ps
    WHERE s.imei         = $1
      AND ps.id          = s.producto_id
      AND ps.sucursal_id = $2
  `, [imei, sucursalId]);
};
const findActivosPorPrestatario = async (prestatarioId, negocioId) => {
  const { rows } = await pool.query(`
    SELECT
      p.id,
      p.fecha,
      p.nombre_producto,
      p.imei,
      p.cantidad_prestada,
      p.valor_prestamo,
      p.total_abonado,
      (p.valor_prestamo - p.total_abonado) AS saldo_pendiente,
      p.estado,
      pr.nombre  AS prestatario_nombre,
      e.nombre   AS empleado_nombre,
      su.nombre  AS sucursal_nombre,
      COALESCE(lps.nombre, lpc.nombre) AS linea_nombre
    FROM prestamos p
    JOIN  sucursales               su  ON su.id  = p.sucursal_id
    JOIN  prestatarios             pr  ON pr.id  = p.prestatario_id
    LEFT JOIN empleados_prestatario e  ON e.id   = p.empleado_id
    -- Mismo LATERAL que en findAll: escoge UNA fila de serial (prefiriendo la
    -- de la sucursal del préstamo) en vez de unir a ciegas y después descartar.
    -- El filtro que había aquí borraba del PDF préstamos ACTIVOS del cliente:
    -- se le entregaba un documento con menos deuda de la que tiene.
    LEFT JOIN LATERAL (
      SELECT ps4.linea_id
        FROM seriales s4
        LEFT JOIN productos_serial ps4 ON ps4.id = s4.producto_id
       WHERE s4.imei = p.imei
       ORDER BY (ps4.sucursal_id = p.sucursal_id) DESC NULLS LAST, s4.id
       LIMIT 1
    ) s ON p.imei IS NOT NULL
    LEFT JOIN lineas_producto       lps ON lps.id = s.linea_id
    LEFT JOIN productos_cantidad    pc  ON pc.id  = p.producto_id AND p.imei IS NULL
    LEFT JOIN lineas_producto       lpc ON lpc.id = pc.linea_id
    WHERE p.prestatario_id = $1
      AND su.negocio_id    = $2
      AND p.estado         = 'Activo'
    ORDER BY p.fecha DESC
  `, [prestatarioId, negocioId]);

  return rows;
};
 
/**
 * Devuelve todos los préstamos Activos de un cliente externo
 * con sus abonos, para generar el PDF de estado de cuenta.
 *
 * @param {number} clienteId
 * @param {number} negocioId
 */
const findActivosPorCliente = async (clienteId, negocioId) => {
  const { rows } = await pool.query(`
    SELECT
      p.id,
      p.fecha,
      p.nombre_producto,
      p.imei,
      p.cantidad_prestada,
      p.valor_prestamo,
      p.total_abonado,
      (p.valor_prestamo - p.total_abonado) AS saldo_pendiente,
      p.estado,
      c.nombre   AS cliente_nombre,
      c.cedula   AS cliente_cedula,
      c.celular  AS cliente_celular,
      su.nombre  AS sucursal_nombre,
      COALESCE(lps.nombre, lpc.nombre) AS linea_nombre
    FROM prestamos p
    JOIN  sucursales su ON su.id = p.sucursal_id
    JOIN  clientes   c  ON c.id  = p.cliente_id
    -- Mismo LATERAL que en findAll: escoge UNA fila de serial (prefiriendo la
    -- de la sucursal del préstamo) en vez de unir a ciegas y después descartar.
    -- El filtro que había aquí borraba del PDF préstamos ACTIVOS del cliente:
    -- se le entregaba un documento con menos deuda de la que tiene.
    LEFT JOIN LATERAL (
      SELECT ps4.linea_id
        FROM seriales s4
        LEFT JOIN productos_serial ps4 ON ps4.id = s4.producto_id
       WHERE s4.imei = p.imei
       ORDER BY (ps4.sucursal_id = p.sucursal_id) DESC NULLS LAST, s4.id
       LIMIT 1
    ) s ON p.imei IS NOT NULL
    LEFT JOIN lineas_producto       lps ON lps.id = s.linea_id
    LEFT JOIN productos_cantidad    pc  ON pc.id  = p.producto_id AND p.imei IS NULL
    LEFT JOIN lineas_producto       lpc ON lpc.id = pc.linea_id
    WHERE p.cliente_id = $1
      AND su.negocio_id = $2
      AND p.estado      = 'Activo'
    ORDER BY p.fecha DESC
  `, [clienteId, negocioId]);

  return rows;
};
 
/**
 * Devuelve los abonos de un conjunto de préstamos en un solo query.
 * Útil para enriquecer el PDF sin N+1 queries.
 *
 * @param {number[]} prestamoIds
 */
const findAbonosPorPrestamos = async (prestamoIds) => {
  if (!prestamoIds.length) return [];
 
  // Genera $1,$2,$3... dinámicamente
  const placeholders = prestamoIds.map((_, i) => `$${i + 1}`).join(',');
 
  const { rows } = await pool.query(`
    SELECT prestamo_id, fecha, valor
    FROM abonos_prestamo
    WHERE prestamo_id IN (${placeholders})
    ORDER BY prestamo_id, fecha
  `, prestamoIds);
 
  return rows;
};

// ── Retoma con origen ─────────────────────────────────────────────────────────
// Libera el serial prestado y registra quién lo entregó como retoma.
const retornarSerialConOrigen = async (client, imei, sucursalId, clienteOrigen) => {
  await client.query(`
    UPDATE seriales s
    SET prestado       = false,
        cliente_origen = $3
    FROM productos_serial ps
    WHERE s.imei         = $1
      AND ps.id          = s.producto_id
      AND ps.sucursal_id = $2
  `, [imei, sucursalId, clienteOrigen]);
};

// ── Retoma: insertar registro en tabla retomas ────────────────────────────────
const insertarRetoma = async (client, {
  prestamo_id, nombre_producto, imei, valor_retoma, cantidad_retoma,
  descripcion, tipo_retoma, producto_serial_id, producto_cantidad_id,
  color, ingreso_inventario,
}) => {
  const { rows } = await client.query(`
    INSERT INTO retomas(
      prestamo_id, nombre_producto, imei, valor_retoma, cantidad_retoma,
      descripcion, ingreso_inventario, tipo_retoma,
      producto_serial_id, producto_cantidad_id, color
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING *
  `, [
    prestamo_id,
    nombre_producto      || null,
    imei                 || null,
    valor_retoma,
    cantidad_retoma      || 1,
    descripcion          || '',
    ingreso_inventario   ?? true,
    tipo_retoma          || 'serial',
    producto_serial_id   || null,
    producto_cantidad_id || null,
    color                || null,
  ]);
  return rows[0];
};

// ── Retoma serial: inserta el IMEI al inventario ──────────────────────────────
const insertarSerialParaRetoma = async (client, {
  producto_id, imei, precio, color, cliente_origen, caracteristicas,
}) => {
  await client.query(`
    INSERT INTO seriales(producto_id, imei, precio, color, cliente_origen, caracteristicas, prestado, vendido)
    VALUES ($1, $2, $3, $4, $5, $6, false, false)
  `, [
    producto_id, imei, precio || null, color || null, cliente_origen || null,
    caracteristicas != null ? JSON.stringify(caracteristicas) : null,
  ]);
};

// ── Retoma cantidad: incrementa stock e inserta historial (dentro de tx) ──────
const ajustarStockConHistorialEnTx = async (client, {
  producto_id, sucursal_id, cantidad, costo_unitario, cliente_origen, tipo,
}) => {
  await client.query(
    'UPDATE productos_cantidad SET stock = stock + $1 WHERE id = $2',
    [cantidad, producto_id],
  );
  await client.query(`
    INSERT INTO historial_stock_cantidad
      (producto_id, sucursal_id, cantidad, costo_unitario, tipo, cliente_origen)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [
    producto_id, sucursal_id, cantidad,
    costo_unitario ?? null,
    tipo           || 'retoma',
    cliente_origen || null,
  ]);
};

// ── Saldo a favor ─────────────────────────────────────────────────────────────
// executor puede ser pool o client (ambos tienen .query())

const TABLA_PERSONA = { prestatario: 'prestatarios', cliente: 'clientes' };

const getSaldoAFavorPersona = async (executor, tipo, personaId) => {
  const tabla = TABLA_PERSONA[tipo];
  const { rows } = await executor.query(
    `SELECT saldo_a_favor FROM ${tabla} WHERE id = $1 FOR UPDATE`,
    [personaId]
  );
  return Number(rows[0]?.saldo_a_favor ?? 0);
};

const setearSaldoAFavorPersona = async (executor, tipo, personaId, monto) => {
  const tabla = TABLA_PERSONA[tipo];
  await executor.query(
    `UPDATE ${tabla} SET saldo_a_favor = $1 WHERE id = $2`,
    [monto, personaId]
  );
};

// ── Saldo a favor POR SUCURSAL ────────────────────────────────────────────────

const getSaldoSucursal = async (executor, tipo, personaId, sucursalId) => {
  const { rows } = await executor.query(
    `SELECT saldo FROM saldo_a_favor_sucursal
     WHERE tipo_persona = $1 AND persona_id = $2 AND sucursal_id = $3
     FOR UPDATE`,
    [tipo, personaId, sucursalId]
  );
  return Number(rows[0]?.saldo ?? 0);
};

const setSaldoSucursal = async (executor, tipo, personaId, sucursalId, monto) => {
  await executor.query(
    `INSERT INTO saldo_a_favor_sucursal (tipo_persona, persona_id, sucursal_id, saldo, actualizado_en)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (tipo_persona, persona_id, sucursal_id)
     DO UPDATE SET saldo = $4, actualizado_en = NOW()`,
    [tipo, personaId, sucursalId, Math.max(0, monto)]
  );
};

const registrarMovSaldoSucursal = async (executor, {
  tipo_persona, persona_id, sucursal_id,
  concepto, monto, tipo_movimiento,
  referencia_id = null, usuario_id = null,
}) => {
  await executor.query(
    `INSERT INTO historial_saldo_sucursal
       (tipo_persona, persona_id, sucursal_id, concepto, monto, tipo_movimiento, referencia_id, usuario_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [tipo_persona, persona_id, sucursal_id, concepto, monto, tipo_movimiento, referencia_id, usuario_id]
  );
};

const getHistorialSaldoSucursal = async (tipo, personaId, sucursalId) => {
  const { rows } = await pool.query(
    `SELECT h.id, h.concepto, h.monto, h.tipo_movimiento, h.referencia_id,
            h.creado_en, u.nombre AS usuario_nombre
     FROM historial_saldo_sucursal h
     LEFT JOIN usuarios u ON u.id = h.usuario_id
     WHERE h.tipo_persona = $1 AND h.persona_id = $2 AND h.sucursal_id = $3
     ORDER BY h.creado_en DESC
     LIMIT 100`,
    [tipo, personaId, sucursalId]
  );
  return rows;
};

const getSaldoSucursalPublico = async (tipo, personaId, sucursalId) => {
  const { rows } = await pool.query(
    `SELECT COALESCE(saldo, 0) AS saldo
     FROM saldo_a_favor_sucursal
     WHERE tipo_persona = $1 AND persona_id = $2 AND sucursal_id = $3`,
    [tipo, personaId, sucursalId]
  );
  return Number(rows[0]?.saldo ?? 0);
};

// ── Anulación de abono ────────────────────────────────────────────────────────

const findAbonoById = async (client, abonoId, prestamoId) => {
  const { rows } = await client.query(
    'SELECT * FROM abonos_prestamo WHERE id = $1 AND prestamo_id = $2',
    [abonoId, prestamoId]
  );
  return rows[0] || null;
};

const eliminarAbono = async (client, abonoId) => {
  await client.query('DELETE FROM abonos_prestamo WHERE id = $1', [abonoId]);
};

const restarTotalAbonado = async (client, prestamoId, valor) => {
  const { rows } = await client.query(`
    UPDATE prestamos
    SET total_abonado = GREATEST(0, total_abonado - $1)
    WHERE id = $2
    RETURNING id, valor_prestamo, total_abonado, estado, imei, sucursal_id, prestatario_id, cliente_id
  `, [valor, prestamoId]);
  return rows[0];
};

const cancelarFacturaDePrestamo = async (client, prestamoId) => {
  const { rows } = await client.query(`
    UPDATE facturas SET estado = 'Cancelada'
    WHERE notas LIKE $1
      AND estado = 'Activa'
    RETURNING id
  `, [`%préstamo #${prestamoId}%`]);
  return rows[0]?.id || null;
};

const revertirSerialVendido = async (client, imei, sucursalId) => {
  await client.query(`
    UPDATE seriales s
    SET vendido      = false,
        prestado     = true,
        fecha_salida = NULL
    FROM productos_serial ps
    WHERE s.imei         = $1
      AND ps.id          = s.producto_id
      AND ps.sucursal_id = $2
  `, [imei, sucursalId]);
};

const findRetomaPorId = async (client, retomaId) => {
  const { rows } = await client.query(
    'SELECT * FROM retomas WHERE id = $1',
    [retomaId]
  );
  return rows[0] || null;
};

const findSerialEnInventario = async (client, imei) => {
  const { rows } = await client.query(`
    SELECT s.id, s.vendido, s.prestado
    FROM seriales s
    WHERE s.imei = $1
      AND s.vendido = false
  `, [imei]);
  return rows[0] || null;
};

const eliminarSerial = async (client, serialId) => {
  await client.query('DELETE FROM seriales WHERE id = $1', [serialId]);
};

const eliminarRetoma = async (client, retomaId) => {
  await client.query('DELETE FROM retomas WHERE id = $1', [retomaId]);
};

// ── Retomas directas por persona ──────────────────────────────────────────────
const findRetomasDirectasPorPersona = async (executor, tipo, personaId, negocioId, sucursalId = null) => {
  const campo = tipo === 'prestatario' ? 'r.tipo_persona = \'prestatario\'' : 'r.tipo_persona = \'cliente\'';
  const params = [personaId, negocioId];
  let filtroSucursal = '';
  if (sucursalId) {
    params.push(sucursalId);
    filtroSucursal = `AND r.sucursal_id = $${params.length}`;
  }
  const { rows } = await executor.query(`
    SELECT
      r.id, r.nombre_producto, r.imei, r.valor_retoma,
      r.cantidad_retoma, r.tipo_retoma, r.ingreso_inventario,
      r.color, r.descripcion, r.fecha,
      r.producto_serial_id, r.producto_cantidad_id,
      r.sucursal_id,
      su.nombre AS sucursal_nombre
    FROM retomas r
    LEFT JOIN sucursales su ON su.id = r.sucursal_id
    WHERE ${campo}
      AND r.persona_id = $1
      AND r.prestamo_id IS NULL
      AND (r.sucursal_id IS NULL OR su.negocio_id = $2)
      ${filtroSucursal}
    ORDER BY r.id DESC
  `, params);
  return rows;
};

// ── Retoma directa (sin préstamo) ────────────────────────────────────────────
const insertarRetomaDirecta = async (client, {
  tipo_persona, persona_id, sucursal_id,
  nombre_producto, imei, valor_retoma, cantidad_retoma,
  descripcion, tipo_retoma, producto_serial_id, producto_cantidad_id,
  color, ingreso_inventario,
}) => {
  const { rows } = await client.query(`
    INSERT INTO retomas(
      prestamo_id, nombre_producto, imei, valor_retoma, cantidad_retoma,
      descripcion, ingreso_inventario, tipo_retoma,
      producto_serial_id, producto_cantidad_id, color,
      tipo_persona, persona_id, sucursal_id
    )
    VALUES (NULL,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING *
  `, [
    nombre_producto      || null,
    imei                 || null,
    valor_retoma,
    cantidad_retoma      || 1,
    descripcion          || '',
    ingreso_inventario   ?? true,
    tipo_retoma          || 'serial',
    producto_serial_id   || null,
    producto_cantidad_id || null,
    color                || null,
    tipo_persona,
    persona_id,
    sucursal_id,
  ]);
  return rows[0];
};

// ── Préstamos activos de una persona — ordenados por fecha ASC (FIFO) ─────────
const findActivosPorPersona = async (executor, tipo, personaId, negocioId, sucursalId = null) => {
  const campo = tipo === 'prestatario' ? 'p.prestatario_id' : 'p.cliente_id';
  const params = [personaId, negocioId];
  let filtroSucursal = '';
  if (sucursalId) {
    params.push(sucursalId);
    filtroSucursal = `AND p.sucursal_id = $${params.length}`;
  }
  const { rows } = await executor.query(`
    SELECT
      p.id, p.fecha, p.nombre_producto, p.imei,
      p.cantidad_prestada, p.valor_prestamo, p.total_abonado,
      (p.valor_prestamo - p.total_abonado) AS saldo_pendiente,
      p.estado, p.sucursal_id, p.prestatario, p.cedula, p.telefono,
      p.prestatario_id, p.empleado_id, p.cliente_id, p.producto_id,
      p.fecha_limite, p.mora_condicion
    FROM prestamos p
    JOIN sucursales su ON su.id = p.sucursal_id
    WHERE ${campo} = $1
      AND su.negocio_id = $2
      AND p.estado = 'Activo'
      ${filtroSucursal}
    ORDER BY p.fecha ASC
  `, params);
  return rows;
};

// ── Resumen agregado de cartera de una persona ────────────────────────────────
const getResumenPersona = async (executor, negocioId, tipo, personaId, sucursalId = null) => {
  const campo = tipo === 'prestatario' ? 'p.prestatario_id' : 'p.cliente_id';
  const tabla = TABLA_PERSONA[tipo];
  const params = [personaId, negocioId];
  let filtroSucursal = '';
  if (sucursalId) {
    params.push(sucursalId);
    filtroSucursal = `AND p.sucursal_id = $${params.length}`;
  }
  const { rows } = await executor.query(`
    SELECT
      COUNT(p.id) FILTER (WHERE p.estado = 'Activo')                         AS total_activos,
      COALESCE(SUM(p.valor_prestamo) FILTER (WHERE p.estado = 'Activo'), 0)  AS total_deuda,
      COALESCE(SUM(p.valor_prestamo - p.total_abonado)
               FILTER (WHERE p.estado = 'Activo'), 0)                         AS total_pendiente,
      per.saldo_a_favor
    FROM prestamos p
    JOIN sucursales su ON su.id = p.sucursal_id
    CROSS JOIN (SELECT saldo_a_favor FROM ${tabla} WHERE id = $1) per
    WHERE ${campo} = $1
      AND su.negocio_id = $2
      ${filtroSucursal}
  `, params);
  return rows[0];
};

// ── Estado de cuenta: todos los movimientos de una persona ───────────────────
const getEstadoCuenta = async (executor, negocioId, tipo, personaId, sucursalId = null) => {
  const filtroPersona = tipo === 'prestatario'
    ? 'p.prestatario_id = $2'
    : 'p.cliente_id = $2';

  const params = [negocioId, personaId, tipo];
  let filtroSucursalPrestamo  = '';
  let filtroSucursalRetoma    = '';
  let filtroSucursalAbonoTotal = '';
  let filtroSucursalPedazo     = '';
  if (sucursalId) {
    params.push(sucursalId);
    const n = params.length;
    filtroSucursalPrestamo   = `AND p.sucursal_id  = $${n}`;
    filtroSucursalRetoma     = `AND r.sucursal_id  = $${n}`;
    filtroSucursalAbonoTotal = `AND at.sucursal_id = $${n}`;
    // El reparto de un pago total se acota a la sede en curso. Hoy ningun pago
    // cruza de sucursal (auditado), pero si alguno lo hiciera, sin esto la sede
    // del pago mostraria el total ENTERO --inflando-- y la otra no veria nada,
    // pese a que si le bajo la deuda. Cada sede debe mostrar lo que se aplico
    // en ella, y las dos juntas sumar el pago.
    filtroSucursalPedazo = `AND p.sucursal_id = $${n}`;
  }

  const { rows } = await executor.query(`
    SELECT fecha, tipo, concepto, cargo, abono, abono_capital, valor_anulado,
           referencia_id, anulable,
           prestamo_id, prestamo_estado, descripcion, anulado, anulado_total, motivo_anulacion,
           es_pago_total, detalle
    FROM (

      -- Préstamos otorgados (aumentan deuda)
      SELECT
        p.fecha,
        'prestamo'::text                                AS tipo,
        ('Préstamo — ' || p.nombre_producto)           AS concepto,
        p.valor_prestamo::numeric                      AS cargo,
        NULL::numeric                                  AS abono,
        NULL::numeric                                  AS abono_capital,
        p.id                                           AS referencia_id,
        false                                          AS anulable,
        NULL::integer                                  AS prestamo_id,
        p.estado::text                                 AS prestamo_estado,
        NULL::text                                     AS descripcion,
        false                                          AS anulado,
        false                                          AS anulado_total,
        0::numeric                                     AS valor_anulado,
        NULL::text                                     AS motivo_anulacion,
        false                                          AS es_pago_total,
        NULL::jsonb                                    AS detalle
      FROM prestamos p
      JOIN sucursales su ON su.id = p.sucursal_id
      WHERE su.negocio_id = $1 AND ${filtroPersona}
        ${filtroSucursalPrestamo}

      UNION ALL

      -- Abonos a préstamos individuales (excluye los que forman parte de un abono total)
      SELECT
        ap.fecha,
        CASE ap.metodo
          WHEN 'Intercambio'   THEN 'pago_producto'
          WHEN 'Saldo a favor' THEN 'saldo_aplicado'
          ELSE 'abono'
        END::text                                      AS tipo,
        CASE ap.metodo
          WHEN 'Intercambio'   THEN 'Pago en producto — ' || p.nombre_producto
          WHEN 'Saldo a favor' THEN 'Saldo a favor aplicado'
          ELSE 'Abono ' || ap.metodo || ' — ' || p.nombre_producto
        END                                            AS concepto,
        NULL::numeric                                  AS cargo,
        ap.valor::numeric                              AS abono,
        -- Un abono ANULADO no baja la deuda. Se sigue mostrando —con su motivo
        -- al lado— porque la fila es la explicación de por qué la cuenta cuadra
        -- así. Los dos casos que anulan son la devolución del producto y el
        -- pago registrado dos veces por un doble clic.
        (ap.valor - COALESCE(ap.valor_anulado, 0))::numeric AS abono_capital,
        ap.id                                          AS referencia_id,
        true                                           AS anulable,
        ap.prestamo_id                                 AS prestamo_id,
        p.estado::text                                 AS prestamo_estado,
        NULL::text                                     AS descripcion,
        -- El primero marca la fila en pantalla en cuanto se anuló ALGO de ella;
        -- el segundo es el que la saca del saldo corrido. Confundirlos hace que
        -- una anulación PARCIAL descarte el abono entero.
        (COALESCE(ap.valor_anulado, 0) > 0)            AS anulado,
        ap.anulado                                     AS anulado_total,
        COALESCE(ap.valor_anulado, 0)::numeric         AS valor_anulado,
        ap.motivo_anulacion                            AS motivo_anulacion,
        false                                          AS es_pago_total,
        NULL::jsonb                                    AS detalle
      FROM abonos_prestamo ap
      JOIN prestamos  p  ON p.id  = ap.prestamo_id
      JOIN sucursales su ON su.id = p.sucursal_id
      WHERE su.negocio_id = $1 AND ${filtroPersona}
        AND ap.abono_total_id IS NULL
        ${filtroSucursalPrestamo}

      UNION ALL

      -- Abonos totales (un solo entry por pago masivo)
      --
      -- La descripción del usuario viaja en columna propia y NO pegada al
      -- concepto: la pantalla saca de ahí el método de pago para precargar el
      -- modal de edición, y cualquier texto extra se lo llevaría por delante.
      SELECT
        at.fecha,
        'abono_total'::text                            AS tipo,
        'Pago total ' || at.metodo                    AS concepto,
        NULL::numeric                                  AS cargo,
        -- Lo que este pago aplico EN ESTA SEDE. Se DERIVA del reparto en vez de
        -- creerle a valor_total: un total guardado no sabe donde se aplico.
        COALESCE(rep.aplicado, at.valor_total)::numeric AS abono,
        -- Un pago total se muestra ENTERO (es lo que pagó la persona) pero se
        -- repartió entre varios préstamos, y alguna de esas partes pudo
        -- anularse — porque su producto se devolvió, o porque el pago entró dos
        -- veces. Esa porción ya no baja capital. Aquí no se puede excluir la
        -- fila completa: solo el pedazo anulado.
        (COALESCE(rep.aplicado, at.valor_total)
          - COALESCE(rep.anulado, 0))::numeric         AS abono_capital,
        at.id                                          AS referencia_id,
        false                                          AS anulable,
        NULL::integer                                  AS prestamo_id,
        NULL::text                                     AS prestamo_estado,
        NULLIF(BTRIM(at.descripcion), '')              AS descripcion,
        -- Un pago total queda marcado solo si TODO lo que repartió se anuló.
        COALESCE(rep.todo_anulado, false)              AS anulado,
        COALESCE(rep.todo_anulado, false)              AS anulado_total,
        -- Cuánto de ESTE pago dejó de contar. Sin este dato la fila muestra
        -- $8.800.000 y el saldo baja $5.400.000, sin nada que explique la
        -- diferencia — justo el número sin explicación que se quería evitar.
        COALESCE(rep.anulado, 0)::numeric              AS valor_anulado,
        rep.motivo                                     AS motivo_anulacion,
        true                                           AS es_pago_total,
        rep.detalle                                    AS detalle
      FROM abonos_totales at
      JOIN sucursales su ON su.id = at.sucursal_id
      -- Todo el reparto se resuelve UNA sola vez y ya acotado a la sede en
      -- curso: el importe que se muestra, lo anulado y el detalle desplegable
      -- salen de la misma fuente. Con subconsultas sueltas era facil acotar una
      -- y olvidar otra, y entonces la fila muestra un numero y el saldo baja
      -- otro distinto.
      LEFT JOIN LATERAL (
        SELECT
          SUM(ap.valor)::numeric                        AS aplicado,
          COALESCE(SUM(ap.valor_anulado), 0)::numeric   AS anulado,
          BOOL_AND(ap.anulado)                          AS todo_anulado,
          MIN(ap.motivo_anulacion) FILTER (WHERE ap.anulado) AS motivo,
          JSONB_AGG(
            JSONB_BUILD_OBJECT(
              'id',               ap.id,
              'prestamo_id',      p.id,
              'factura',          COALESCE(p.numero, p.id),
              'producto',         p.nombre_producto,
              'valor',            ap.valor,
              'anulado',          ap.anulado,
              'motivo_anulacion', ap.motivo_anulacion
            ) ORDER BY p.fecha, p.id)                   AS detalle
        FROM abonos_prestamo ap
        JOIN prestamos p ON p.id = ap.prestamo_id
        WHERE ap.abono_total_id = at.id
          ${filtroSucursalPedazo}
      ) rep ON TRUE
      -- Cuantos pedazos tiene el pago EN TOTAL (sin acotar). Distingue el pago
      -- que no repartio nada --queda como saldo a favor y se muestra por su
      -- valor-- del que repartio en OTRA sede, que aqui no debe aparecer.
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS n FROM abonos_prestamo apt
         WHERE apt.abono_total_id = at.id
      ) tot ON TRUE
      WHERE su.negocio_id = $1
        AND at.tipo_persona = $3
        AND at.persona_id   = $2
        -- abonos_totales la comparten préstamos y créditos. Sin este filtro,
        -- el pago total que un CLIENTE hizo a sus créditos aparecería también
        -- en su extracto de préstamos, restando sin ningún abono detrás.
        AND COALESCE(at.destino, 'prestamo') = 'prestamo'
        -- Se muestra donde APLICO. Un pago que no repartio nada se muestra en
        -- su propia sede.
        AND (rep.aplicado IS NOT NULL
             OR (tot.n = 0 ${filtroSucursalAbonoTotal}))

      UNION ALL

      -- Compras de artículo directas (afectan saldo a favor, no la deuda)
      SELECT
        COALESCE(r.fecha, NOW()),
        'compra_directa'::text                         AS tipo,
        ('Compra de artículo — ' || COALESCE(r.nombre_producto, 'artículo')) AS concepto,
        NULL::numeric                                  AS cargo,
        r.valor_retoma::numeric                        AS abono,
        NULL::numeric                                  AS abono_capital,
        r.id                                           AS referencia_id,
        true                                           AS anulable,
        NULL::integer                                  AS prestamo_id,
        NULL::text                                     AS prestamo_estado,
        NULL::text                                     AS descripcion,
        false                                          AS anulado,
        false                                          AS anulado_total,
        0::numeric                                     AS valor_anulado,
        NULL::text                                     AS motivo_anulacion,
        false                                          AS es_pago_total,
        NULL::jsonb                                    AS detalle
      FROM retomas r
      LEFT JOIN sucursales su ON su.id = r.sucursal_id
      WHERE r.prestamo_id IS NULL
        AND r.tipo_persona = $3
        AND r.persona_id   = $2
        AND (r.sucursal_id IS NULL OR su.negocio_id = $1)
        ${filtroSucursalRetoma}

      UNION ALL

      -- Cargos financieros: cobros y condonaciones de MORA e INTERÉS.
      -- Son INFORMATIVOS: son deuda financiera aparte y no entran en el saldo
      -- de capital que acumula esta cuenta (igual que en créditos).
      --
      -- Se discriminan por concepto: llamarle "mora" a un cobro de interés en
      -- el estado de cuenta del cliente es decirle que se atrasó cuando no lo
      -- hizo. Los tipos nuevos ('interes_cobro'/'interes_condonacion') tienen
      -- que estar en el Set INFORMATIVOS del service, o el interés entraría al
      -- saldo acumulado y la cuenta daría mal.
      SELECT
        mm.fecha,
        (CASE
          WHEN mm.concepto = 'interes' THEN
            CASE mm.tipo WHEN 'Cobro' THEN 'interes_cobro' ELSE 'interes_condonacion' END
          ELSE
            CASE mm.tipo WHEN 'Cobro' THEN 'mora_cobro' ELSE 'mora_condonacion' END
        END)::text                                     AS tipo,
        CASE
          WHEN mm.concepto = 'interes' THEN
            CASE mm.tipo
              WHEN 'Cobro' THEN 'Interés de financiación cobrado ' || COALESCE(mm.metodo, '')
              ELSE 'Interés condonado' || COALESCE(' — ' || mm.motivo, '')
            END || ' — préstamo #' || COALESCE(p.numero, p.id)::text
          ELSE
            (CASE mm.tipo
              WHEN 'Cobro' THEN 'Mora cobrada ' || COALESCE(mm.metodo, '')
              ELSE 'Mora condonada' || COALESCE(' — ' || mm.motivo, '')
            END || ' — préstamo #' || COALESCE(p.numero, p.id)::text
               || COALESCE(' (' || NULLIF(mm.dias_mora, 0)::text || ' días de atraso)', ''))
        END                                            AS concepto,
        NULL::numeric                                  AS cargo,
        mm.valor::numeric                              AS abono,
        NULL::numeric                                  AS abono_capital,
        mm.id                                          AS referencia_id,
        false                                          AS anulable,
        mm.prestamo_id                                 AS prestamo_id,
        NULL::text                                     AS prestamo_estado,
        NULL::text                                     AS descripcion,
        false                                          AS anulado,
        false                                          AS anulado_total,
        0::numeric                                     AS valor_anulado,
        NULL::text                                     AS motivo_anulacion,
        false                                          AS es_pago_total,
        NULL::jsonb                                    AS detalle
      FROM movimientos_mora mm
      JOIN prestamos  p  ON p.id  = mm.prestamo_id
      JOIN sucursales su ON su.id = p.sucursal_id
      WHERE su.negocio_id = $1 AND ${filtroPersona}
        AND NOT mm.anulado
        ${filtroSucursalPrestamo}

    ) movs
    ORDER BY fecha ASC NULLS LAST, referencia_id ASC
  `, params);

  return rows;
};

const getPrestamoActivoById = async (executor, prestamoId, negocioId) => {
  const { rows } = await executor.query(`
    SELECT
      p.id, p.fecha, p.nombre_producto, p.imei,
      p.cantidad_prestada, p.valor_prestamo, p.total_abonado,
      (p.valor_prestamo - p.total_abonado) AS saldo_pendiente,
      p.estado, p.sucursal_id, p.prestatario, p.cedula, p.telefono,
      p.prestatario_id, p.empleado_id, p.cliente_id, p.producto_id,
      CASE WHEN p.prestatario_id IS NOT NULL THEN 'prestatario' ELSE 'cliente' END AS tipo_persona,
      COALESCE(p.prestatario_id, p.cliente_id) AS persona_id
    FROM prestamos p
    JOIN sucursales su ON su.id = p.sucursal_id
    WHERE p.id = $1 AND su.negocio_id = $2 AND p.estado = 'Activo'
    FOR UPDATE
  `, [prestamoId, negocioId]);
  return rows[0] || null;
};

const updateValorPrestamo = async (id, nuevoValor) => {
  const { rows } = await pool.query(
    `UPDATE prestamos SET valor_prestamo = $1 WHERE id = $2 RETURNING *`,
    [nuevoValor, id]
  );
  return rows[0] || null;
};

const getGarantiasPorPrestamo = async (imei, productoId, negocioId) => {
  const { rows } = await pool.query(`
    SELECT DISTINCT g.id, g.titulo, g.texto, g.orden
    FROM garantias g
    JOIN garantias_lineas  gl  ON gl.garantia_id = g.id
    LEFT JOIN seriales           s   ON s.imei  = $1
    LEFT JOIN productos_serial   ps  ON ps.id   = s.producto_id
    LEFT JOIN productos_cantidad pc  ON pc.id   = $2
    WHERE g.negocio_id = $3
      AND gl.linea_id  = COALESCE(ps.linea_id, pc.linea_id)
    ORDER BY g.orden ASC, g.id ASC
  `, [imei || null, productoId || null, negocioId]);
  return rows;
};

// ── Helpers para stock de variantes (espejo de facturas.repository) ───────────

const ajustarStockAtributoEnTx = async (client, atributoId, cantidad) => {
  await client.query(
    'UPDATE atributos_producto SET stock = stock + $1 WHERE id = $2',
    [cantidad, atributoId]
  );
};

const ajustarStockVarianteEnTx = async (client, varianteId, cantidad) => {
  await client.query(
    'UPDATE variantes_atributo SET stock = stock + $1 WHERE id = $2',
    [cantidad, varianteId]
  );
};

const sincronizarStockArbolEnTx = async (client, productoId) => {
  await client.query(
    `UPDATE atributos_producto ap
     SET stock = sub.total
     FROM (
       SELECT v.atributo_id, COALESCE(SUM(v.stock), 0) AS total
       FROM variantes_atributo v
       WHERE v.activo = true
       GROUP BY v.atributo_id
     ) sub
     WHERE ap.id = sub.atributo_id
       AND ap.producto_id = $1
       AND ap.activo = true`,
    [productoId]
  );
  await client.query(
    `UPDATE productos_cantidad pc
     SET stock = sub.total
     FROM (
       SELECT ap.producto_id, COALESCE(SUM(ap.stock), 0) AS total
       FROM atributos_producto ap
       WHERE ap.activo = true AND ap.producto_id = $1
       GROUP BY ap.producto_id
     ) sub
     WHERE pc.id = sub.producto_id
       AND EXISTS (
         SELECT 1 FROM atributos_producto ap
         WHERE ap.producto_id = $1 AND ap.activo = true
       )`,
    [productoId]
  );
};

// ── Abono total: insertar registro maestro ────────────────────────────────────
// `descripcion` es texto libre del usuario (por qué se hizo el pago). No entra
// en ningún cálculo; solo se muestra junto al movimiento.
const insertarAbonoTotal = async (client, { tipo_persona, persona_id, sucursal_id, valor_total, metodo, usuario_id, descripcion }) => {
  const { rows } = await client.query(`
    INSERT INTO abonos_totales(tipo_persona, persona_id, sucursal_id, valor_total, metodo, usuario_id, descripcion)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `, [
    tipo_persona, persona_id, sucursal_id, valor_total, metodo || 'Efectivo', usuario_id || null,
    String(descripcion ?? '').trim().slice(0, 200) || null,
  ]);
  return rows[0];
};

// ── Préstamos activos de una persona ordenados FIFO (más antiguo primero) ─────
// executor puede ser pool o un client de transacción (para ver cambios no committed)
const getPrestamoActivosPorPersona = async (executor, tipo, personaId, negocioId, sucursalId = null) => {
  const col = tipo === 'prestatario' ? 'p.prestatario_id' : 'p.cliente_id';
  const params = [personaId, negocioId];
  let filtroSucursal = '';
  if (sucursalId) {
    params.push(sucursalId);
    filtroSucursal = `AND p.sucursal_id = $${params.length}`;
  }
  const { rows } = await executor.query(`
    SELECT p.id, p.numero, p.fecha, p.nombre_producto, p.imei, p.sucursal_id,
           p.valor_prestamo, p.total_abonado, p.estado, p.producto_id,
           p.cedula, p.telefono, p.prestatario, p.cliente_id, p.prestatario_id,
           p.atributo_id, p.variante_id,
           -- Necesarias para que el ABONO TOTAL sepa cuántos cargos debe cada
           -- préstamo. Sin ellas el reparto los ignora y nunca los cobra.
           p.fecha_limite, p.mora_condicion, p.interes_condicion, p.interes_desde
    FROM prestamos p
    JOIN sucursales su ON su.id = p.sucursal_id
    WHERE ${col} = $1 AND su.negocio_id = $2 AND p.estado = 'Activo'
    ${filtroSucursal}
    ORDER BY p.fecha ASC
  `, params);
  return rows;
};

// ── Obtener un abono_total verificando que pertenece al negocio ────────────────
const getAbonoTotalById = async (id, negocioId) => {
  const { rows } = await pool.query(`
    SELECT at.*
    FROM abonos_totales at
    JOIN sucursales su ON su.id = at.sucursal_id
    WHERE at.id = $1 AND su.negocio_id = $2
  `, [id, negocioId]);
  return rows[0] || null;
};

// ── Abonos individuales que pertenecen a un abono_total (para reversión) ──────
const getAbonosPorTotal = async (client, abonoTotalId) => {
  const { rows } = await client.query(`
    SELECT ap.id, ap.prestamo_id, ap.valor,
           p.valor_prestamo, p.total_abonado, p.estado, p.imei, p.sucursal_id
    FROM abonos_prestamo ap
    JOIN prestamos p ON p.id = ap.prestamo_id
    WHERE ap.abono_total_id = $1
    ORDER BY p.fecha ASC
  `, [abonoTotalId]);
  return rows;
};

module.exports = {
  crearAjusteDeuda,
  findAll, findById, findByIdYNegocio,
  perteneceAlNegocio,
  getAbonos, create, insertarAbono, updateEstado,
  ajustarStock, actualizarCantidadYValor,
  salarSerial, findAbonosPorPrestamos, findActivosPorCliente, findActivosPorPrestatario,
  getSaldoAFavorPersona, setearSaldoAFavorPersona,
  // saldo por sucursal
  getSaldoSucursal, setSaldoSucursal, registrarMovSaldoSucursal,
  getHistorialSaldoSucursal, getSaldoSucursalPublico,
  retornarSerialConOrigen,
  insertarRetoma, insertarRetomaDirecta, insertarSerialParaRetoma, ajustarStockConHistorialEnTx,
  getRetomasPorPrestamo,
  findActivosPorPersona, getResumenPersona, getPrestamoActivoById,
  // anulación
  updateValorPrestamo,
  findAbonoById, eliminarAbono, restarTotalAbonado,
  cancelarFacturaDePrestamo, revertirSerialVendido,
  findRetomaPorId, findSerialEnInventario, eliminarSerial, eliminarRetoma,
  findRetomasDirectasPorPersona, getEstadoCuenta,
  ajustarStockAtributoEnTx, ajustarStockVarianteEnTx, sincronizarStockArbolEnTx,
  getGarantiasPorPrestamo,
  // abono total
  insertarAbonoTotal, getPrestamoActivosPorPersona, getAbonoTotalById, getAbonosPorTotal,
  anularAbonosDePrestamo, anularAbonoConMotivo, anularSobranteDeAbonos,
  buscarAbonoGemelo, buscarAbonoTotalGemelo,
};