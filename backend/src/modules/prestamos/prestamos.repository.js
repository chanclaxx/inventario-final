const { pool } = require('../../config/db');

const findAll = async (sucursalId, negocioId) => {
  const filtro = sucursalId ? 'p.sucursal_id = $1' : 'su.negocio_id = $1';
  const param  = sucursalId ?? negocioId;

  const { rows } = await pool.query(`
    SELECT
      p.id, p.fecha, p.prestatario, p.cedula, p.telefono,
      p.nombre_producto, p.imei, p.cantidad_prestada,
      p.valor_prestamo, p.total_abonado, p.estado,
      p.prestatario_id, p.empleado_id, p.cliente_id, p.sucursal_id,
      p.atributo_id, p.variante_id, p.atributo_label, p.variante_label,
      su.nombre AS sucursal_nombre,
      (p.valor_prestamo - p.total_abonado) AS saldo_pendiente,
      u.nombre  AS usuario_nombre,
      pr.nombre AS prestatario_nombre,
      e.nombre  AS empleado_nombre,
      c.nombre  AS cliente_nombre,
      s.color   AS serial_color,
      COALESCE(pr.saldo_a_favor, 0) AS prestatario_saldo_a_favor,
      COALESCE(c.saldo_a_favor,  0) AS cliente_saldo_a_favor,
      (SELECT MAX(ap.fecha)
       FROM abonos_prestamo ap
       JOIN prestamos       p2  ON p2.id  = ap.prestamo_id
       JOIN sucursales      su2 ON su2.id = p2.sucursal_id
       WHERE p2.prestatario_id = p.prestatario_id
         AND p2.prestatario_id IS NOT NULL
         AND su2.negocio_id    = su.negocio_id) AS ultimo_abono_prestatario,
      (SELECT MAX(ap.fecha)
       FROM abonos_prestamo ap
       JOIN prestamos       p2  ON p2.id  = ap.prestamo_id
       JOIN sucursales      su2 ON su2.id = p2.sucursal_id
       WHERE p2.cliente_id   = p.cliente_id
         AND p2.cliente_id   IS NOT NULL
         AND su2.negocio_id  = su.negocio_id) AS ultimo_abono_cliente
    FROM prestamos p
    JOIN  sucursales                su  ON su.id  = p.sucursal_id
    LEFT JOIN usuarios               u   ON u.id   = p.usuario_id
    LEFT JOIN prestatarios           pr  ON pr.id  = p.prestatario_id
    LEFT JOIN empleados_prestatario  e   ON e.id   = p.empleado_id
    LEFT JOIN clientes               c   ON c.id   = p.cliente_id
    LEFT JOIN seriales               s   ON s.imei = p.imei
    LEFT JOIN productos_serial       ps2 ON ps2.id = s.producto_id
                                        AND ps2.sucursal_id = p.sucursal_id
    WHERE ${filtro}
      AND (p.imei IS NULL OR ps2.sucursal_id IS NOT NULL)  -- ← filtra duplicados
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
      u.nombre AS usuario_nombre
    FROM abonos_prestamo ap
    LEFT JOIN usuarios u ON u.id = ap.usuario_id
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
}) => {
  const { rows } = await client.query(`
    INSERT INTO prestamos(
      sucursal_id, usuario_id, prestatario, cedula, telefono,
      nombre_producto, imei, producto_id, cantidad_prestada, valor_prestamo,
      prestatario_id, empleado_id, cliente_id,
      atributo_id, variante_id, atributo_label, variante_label
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    RETURNING *
  `, [
    sucursal_id, usuario_id, prestatario, cedula, telefono,
    nombre_producto, imei, producto_id, cantidad_prestada, valor_prestamo,
    prestatario_id || null, empleado_id || null, cliente_id || null,
    atributo_id   || null, variante_id  || null,
    atributo_label || null, variante_label || null,
  ]);
  return rows[0];
};

const insertarAbono = async (client, { prestamo_id, valor, metodo, usuario_id }) => {
  await client.query(
    'INSERT INTO abonos_prestamo(prestamo_id, valor, metodo, usuario_id) VALUES ($1, $2, $3, $4)',
    [prestamo_id, valor, metodo || 'Efectivo', usuario_id || null]
  );
  const { rows } = await client.query(`
    UPDATE prestamos SET total_abonado = total_abonado + $1
    WHERE id = $2
    RETURNING valor_prestamo, total_abonado
  `, [valor, prestamo_id]);
  return rows[0];
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
      'SELECT nombre, telefono FROM clientes WHERE id = $1 AND negocio_id = $2',
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
    return rows[0];
  } else {
    const { rows } = await pool.query(`
      INSERT INTO prestamos(fecha, prestatario, cedula, telefono, nombre_producto, imei,
        cantidad_prestada, valor_prestamo, total_abonado, estado, cliente_id, sucursal_id, usuario_id)
      VALUES (NOW(), $1, 'AJUSTE', $2, $3, NULL, 1, $4, 0, 'Activo', $5, $6, $7)
      RETURNING *
    `, [nombre, tel, nombreProducto, valor, persona_id, sucursal_id, usuario_id]);
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
      su.nombre  AS sucursal_nombre
    FROM prestamos p
    JOIN  sucursales               su  ON su.id  = p.sucursal_id
    JOIN  prestatarios             pr  ON pr.id  = p.prestatario_id
    LEFT JOIN empleados_prestatario e  ON e.id   = p.empleado_id
    LEFT JOIN seriales              s  ON s.imei = p.imei
    LEFT JOIN productos_serial      ps ON ps.id  = s.producto_id
                                      AND ps.sucursal_id = p.sucursal_id
    WHERE p.prestatario_id = $1
      AND su.negocio_id    = $2
      AND p.estado         = 'Activo'
      AND (p.imei IS NULL OR ps.sucursal_id IS NOT NULL)
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
      su.nombre  AS sucursal_nombre
    FROM prestamos p
    JOIN  sucursales su ON su.id = p.sucursal_id
    JOIN  clientes   c  ON c.id  = p.cliente_id
    LEFT JOIN seriales              s  ON s.imei = p.imei
    LEFT JOIN productos_serial      ps ON ps.id  = s.producto_id
                                      AND ps.sucursal_id = p.sucursal_id
    WHERE p.cliente_id = $1
      AND su.negocio_id = $2
      AND p.estado      = 'Activo'
      AND (p.imei IS NULL OR ps.sucursal_id IS NOT NULL)
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
  producto_id, imei, costo_compra, color, cliente_origen,
}) => {
  await client.query(`
    INSERT INTO seriales(producto_id, imei, costo_compra, color, cliente_origen, prestado, vendido)
    VALUES ($1, $2, $3, $4, $5, false, false)
  `, [producto_id, imei, costo_compra || 0, color || null, cliente_origen || null]);
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
const findRetomasDirectasPorPersona = async (executor, tipo, personaId, negocioId) => {
  const campo = tipo === 'prestatario' ? 'r.tipo_persona = \'prestatario\'' : 'r.tipo_persona = \'cliente\'';
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
    ORDER BY r.id DESC
  `, [personaId, negocioId]);
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
const findActivosPorPersona = async (executor, tipo, personaId, negocioId) => {
  const campo = tipo === 'prestatario' ? 'p.prestatario_id' : 'p.cliente_id';
  const { rows } = await executor.query(`
    SELECT
      p.id, p.fecha, p.nombre_producto, p.imei,
      p.cantidad_prestada, p.valor_prestamo, p.total_abonado,
      (p.valor_prestamo - p.total_abonado) AS saldo_pendiente,
      p.estado, p.sucursal_id, p.prestatario, p.cedula, p.telefono,
      p.prestatario_id, p.empleado_id, p.cliente_id, p.producto_id
    FROM prestamos p
    JOIN sucursales su ON su.id = p.sucursal_id
    WHERE ${campo} = $1
      AND su.negocio_id = $2
      AND p.estado = 'Activo'
    ORDER BY p.fecha ASC
  `, [personaId, negocioId]);
  return rows;
};

// ── Resumen agregado de cartera de una persona ────────────────────────────────
const getResumenPersona = async (executor, negocioId, tipo, personaId) => {
  const campo = tipo === 'prestatario' ? 'p.prestatario_id' : 'p.cliente_id';
  const tabla = TABLA_PERSONA[tipo];
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
  `, [personaId, negocioId]);
  return rows[0];
};

// ── Estado de cuenta: todos los movimientos de una persona ───────────────────
const getEstadoCuenta = async (executor, negocioId, tipo, personaId) => {
  const filtroPersona = tipo === 'prestatario'
    ? 'p.prestatario_id = $2'
    : 'p.cliente_id = $2';

  const { rows } = await executor.query(`
    SELECT fecha, tipo, concepto, cargo, abono, referencia_id, anulable, prestamo_estado
    FROM (

      -- Préstamos otorgados (aumentan deuda)
      SELECT
        p.fecha,
        'prestamo'::text                                AS tipo,
        ('Préstamo — ' || p.nombre_producto)           AS concepto,
        p.valor_prestamo::numeric                      AS cargo,
        NULL::numeric                                  AS abono,
        p.id                                           AS referencia_id,
        false                                          AS anulable,
        NULL::integer                                  AS prestamo_id,
        p.estado::text                                 AS prestamo_estado
      FROM prestamos p
      JOIN sucursales su ON su.id = p.sucursal_id
      WHERE su.negocio_id = $1 AND ${filtroPersona}

      UNION ALL

      -- Abonos a préstamos (reducen deuda)
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
        ap.id                                          AS referencia_id,
        true                                           AS anulable,
        ap.prestamo_id                                 AS prestamo_id,
        NULL::text                                     AS prestamo_estado
      FROM abonos_prestamo ap
      JOIN prestamos  p  ON p.id  = ap.prestamo_id
      JOIN sucursales su ON su.id = p.sucursal_id
      WHERE su.negocio_id = $1 AND ${filtroPersona}

      UNION ALL

      -- Compras de artículo directas (afectan saldo a favor, no la deuda)
      SELECT
        COALESCE(r.fecha, NOW()),
        'compra_directa'::text                         AS tipo,
        ('Compra de artículo — ' || COALESCE(r.nombre_producto, 'artículo')) AS concepto,
        NULL::numeric                                  AS cargo,
        r.valor_retoma::numeric                        AS abono,
        r.id                                           AS referencia_id,
        true                                           AS anulable,
        NULL::integer                                  AS prestamo_id,
        NULL::text                                     AS prestamo_estado
      FROM retomas r
      LEFT JOIN sucursales su ON su.id = r.sucursal_id
      WHERE r.prestamo_id IS NULL
        AND r.tipo_persona = $3
        AND r.persona_id   = $2
        AND (r.sucursal_id IS NULL OR su.negocio_id = $1)

    ) movs
    ORDER BY fecha ASC NULLS LAST, referencia_id ASC
  `, [negocioId, personaId, tipo]);

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

module.exports = {
  crearAjusteDeuda,
  findAll, findById, findByIdYNegocio,
  perteneceAlNegocio,
  getAbonos, create, insertarAbono, updateEstado,
  ajustarStock, actualizarCantidadYValor,
  salarSerial, findAbonosPorPrestamos, findActivosPorCliente, findActivosPorPrestatario,
  getSaldoAFavorPersona, setearSaldoAFavorPersona,
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
};