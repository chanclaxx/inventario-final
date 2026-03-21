const { pool } = require('../../config/db');

// ─── Constantes ───────────────────────────────────────────────────────────────

// FIX TIMEZONE: Las columnas fecha_recepcion, fecha_entrega y abonos.fecha son
// "timestamp without time zone" pero almacenan valores en UTC.
// Para convertir correctamente a Bogotá hay que:
//   1. Decirle a PG que el valor está en UTC:  col AT TIME ZONE 'UTC'
//      → esto produce un "timestamp with time zone" interpretado como UTC
//   2. Convertir a Bogotá:  ... AT TIME ZONE 'America/Bogota'
//      → esto produce un "timestamp without time zone" en hora local Bogotá
//   3. Extraer la fecha:  (...)::date
//
// Expresión reutilizable para "fecha hoy en Bogotá":
const HOY_BOGOTA = `(NOW() AT TIME ZONE 'America/Bogota')::date`;

// Helper: convierte una columna "timestamp without time zone" (guardada en UTC)
// a fecha en Bogotá. Uso: fechaBogota('os.fecha_recepcion')
const fechaBogota = (col) =>
  `(${col} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota')::date`;

const COLS_CALCULADAS = `
  CASE
    WHEN os.estado = 'Garantia' AND os.garantia_cobrable AND os.precio_garantia IS NOT NULL
    THEN os.precio_garantia - os.total_abonado
    WHEN os.estado IN ('Listo','Pendiente_pago')
    THEN os.precio_final - os.total_abonado
    ELSE 0
  END AS saldo_pendiente,
  CASE
    WHEN os.precio_final IS NOT NULL AND os.costo_real IS NOT NULL
    THEN os.precio_final - os.costo_real
    ELSE NULL
  END AS utilidad,
  CASE
    WHEN os.precio_garantia IS NOT NULL AND os.costo_garantia IS NOT NULL
    THEN os.precio_garantia - os.costo_garantia
    ELSE NULL
  END AS utilidad_garantia`;

// ─── Lectura ──────────────────────────────────────────────────────────────────

const findAll = async (sucursalId, negocioId, filtros = {}) => {
  const { estado, busqueda } = filtros;
  const params = [];

  const filtroPrincipal = sucursalId
    ? `os.sucursal_id = $${params.push(sucursalId)}`
    : `os.negocio_id  = $${params.push(negocioId)}`;

  let where = filtroPrincipal;
  if (estado) where += ` AND os.estado = $${params.push(estado)}`;

  if (busqueda) {
    const q = `%${busqueda.toLowerCase().slice(0, 100)}%`;
    const n = params.push(q);
    where += ` AND (
        LOWER(os.cliente_nombre)  LIKE $${n}
     OR LOWER(os.equipo_nombre)   LIKE $${n}
     OR os.cliente_cedula         LIKE $${n}
     OR CAST(os.id AS TEXT)       LIKE $${n}
    )`;
  }

  const { rows } = await pool.query(`
    SELECT
      os.id, os.estado,
      os.cliente_nombre, os.cliente_telefono, os.cliente_cedula, os.cliente_id,
      os.equipo_tipo, os.equipo_nombre, os.equipo_serial,
      os.falla_reportada, os.notas_tecnico,
      os.costo_estimado, os.costo_real, os.precio_final, os.total_abonado,
      os.precio_garantia, os.costo_garantia,
      os.motivo_sin_reparar, os.garantia_cobrable, os.orden_origen_id,
      os.fecha_recepcion, os.fecha_entrega, os.sucursal_id,
      ${COLS_CALCULADAS},
      u.nombre AS usuario_nombre
    FROM ordenes_servicio os
    LEFT JOIN usuarios u ON u.id = os.usuario_id
    WHERE ${where}
    ORDER BY
      CASE os.estado
        WHEN 'Listo'           THEN 0
        WHEN 'Pendiente_pago'  THEN 1
        WHEN 'Garantia'        THEN 2
        WHEN 'En_reparacion'   THEN 3
        WHEN 'Recibido'        THEN 4
        WHEN 'Entregado'       THEN 5
        WHEN 'Sin_reparar'     THEN 6
      END,
      os.fecha_recepcion DESC
  `, params);
  return rows;
};

const findById = async (negocioId, id) => {
  const { rows } = await pool.query(`
    SELECT
      os.*,
      ${COLS_CALCULADAS},
      u.nombre  AS usuario_nombre,
      su.nombre AS sucursal_nombre
    FROM ordenes_servicio os
    LEFT JOIN usuarios   u  ON u.id  = os.usuario_id
    LEFT JOIN sucursales su ON su.id = os.sucursal_id
    WHERE os.id = $1 AND os.negocio_id = $2
  `, [id, negocioId]);
  return rows[0] || null;
};

const getAbonos = async (negocioId, ordenId) => {
  const { rows } = await pool.query(`
    SELECT ab.*, u.nombre AS usuario_nombre
    FROM abonos_servicio ab
    JOIN  ordenes_servicio os ON os.id = ab.orden_id
    LEFT JOIN usuarios     u  ON u.id  = ab.usuario_id
    WHERE ab.orden_id = $1 AND os.negocio_id = $2
    ORDER BY ab.fecha ASC
  `, [ordenId, negocioId]);
  return rows;
};

// ─── Resumen del día ──────────────────────────────────────────────────────────

const getResumenHoy = async (sucursalId, negocioId) => {
  const param       = sucursalId ?? negocioId;
  const campoFiltro = sucursalId ? 'sucursal_id' : 'negocio_id';

  // 1. Órdenes recibidas hoy
  const { rows: r1 } = await pool.query(`
    SELECT COUNT(*) AS ordenes_hoy
    FROM ordenes_servicio
    WHERE ${campoFiltro} = $1
      AND ${fechaBogota('fecha_recepcion')} = ${HOY_BOGOTA}
  `, [param]);

  // 2. Ingresos hoy = suma de abonos cuya fecha (en Bogotá) es hoy
  const { rows: r2 } = await pool.query(`
    SELECT COALESCE(SUM(ab.valor), 0) AS ingresos_hoy
    FROM abonos_servicio ab
    JOIN ordenes_servicio os ON os.id = ab.orden_id
    WHERE os.${campoFiltro} = $1
      AND ${fechaBogota('ab.fecha')} = ${HOY_BOGOTA}
  `, [param]);

  // 3. Utilidad hoy = órdenes entregadas hoy con costo_real registrado
  const { rows: r3 } = await pool.query(`
    SELECT COALESCE(SUM(
      COALESCE(precio_final, 0)    - COALESCE(costo_real, 0) +
      COALESCE(precio_garantia, 0) - COALESCE(costo_garantia, 0)
    ), 0) AS utilidad_hoy
    FROM ordenes_servicio
    WHERE ${campoFiltro} = $1
      AND estado IN ('Entregado', 'Sin_reparar')
      AND precio_final IS NOT NULL
      AND costo_real   IS NOT NULL
      AND ${fechaBogota('fecha_entrega')} = ${HOY_BOGOTA}
  `, [param]);

  // 4. Pendiente cobro = órdenes activas con saldo > 0
  const { rows: r4 } = await pool.query(`
    SELECT COALESCE(SUM(
      CASE
        WHEN estado = 'Garantia' AND garantia_cobrable AND precio_garantia IS NOT NULL
        THEN precio_garantia - total_abonado
        WHEN estado IN ('Listo', 'Pendiente_pago')
        THEN precio_final - total_abonado
        ELSE 0
      END
    ), 0) AS pendiente_cobro
    FROM ordenes_servicio
    WHERE ${campoFiltro} = $1
      AND estado IN ('Listo', 'Pendiente_pago', 'Garantia')
      AND (
        (estado IN ('Listo','Pendiente_pago') AND precio_final > total_abonado)
        OR (estado = 'Garantia' AND garantia_cobrable
            AND precio_garantia IS NOT NULL
            AND precio_garantia > total_abonado)
      )
  `, [param]);

  return {
    ordenes_hoy:     r1[0].ordenes_hoy,
    ingresos_hoy:    r2[0].ingresos_hoy,
    utilidad_hoy:    r3[0].utilidad_hoy,
    pendiente_cobro: r4[0].pendiente_cobro,
  };
};

// ─── Escritura ────────────────────────────────────────────────────────────────

const create = async (negocioId, sucursalId, usuarioId, datos) => {
  const {
    cliente_nombre, cliente_telefono, cliente_cedula, cliente_id,
    equipo_tipo, equipo_nombre, equipo_serial,
    falla_reportada, contrasena_equipo, notas_tecnico,
    costo_estimado,
  } = datos;

  const { rows } = await pool.query(`
    INSERT INTO ordenes_servicio (
      negocio_id, sucursal_id, usuario_id,
      cliente_nombre, cliente_telefono, cliente_cedula, cliente_id,
      equipo_tipo, equipo_nombre, equipo_serial,
      falla_reportada, contrasena_equipo, notas_tecnico,
      costo_estimado
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    RETURNING *
  `, [
    negocioId, sucursalId, usuarioId,
    cliente_nombre.trim(),
    cliente_telefono || null,
    cliente_cedula   || null,
    cliente_id       || null,
    equipo_tipo      || null,
    equipo_nombre    || null,
    equipo_serial    || null,
    falla_reportada.trim(),
    contrasena_equipo || null,
    notas_tecnico     || null,
    costo_estimado    || null,
  ]);
  return rows[0];
};

const marcarEnReparacion = async (negocioId, id) => {
  const { rows } = await pool.query(`
    UPDATE ordenes_servicio
    SET estado = 'En_reparacion'
    WHERE id = $1 AND negocio_id = $2 AND estado = 'Recibido'
    RETURNING id, estado
  `, [id, negocioId]);
  return rows[0] || null;
};

const marcarListo = async (negocioId, id, { costo_real, precio_final, notas_tecnico,
  precio_garantia, costo_garantia, esGarantia }) => {
  let query, params;

  if (esGarantia) {
    query = `
      UPDATE ordenes_servicio
      SET estado          = 'Listo',
          precio_garantia = $3,
          costo_garantia  = $4,
          notas_tecnico   = COALESCE($5, notas_tecnico)
      WHERE id = $1 AND negocio_id = $2
        AND estado = 'Garantia' AND garantia_cobrable = true
      RETURNING *`;
    params = [id, negocioId, precio_garantia, costo_garantia || null, notas_tecnico || null];
  } else {
    query = `
      UPDATE ordenes_servicio
      SET estado        = 'Listo',
          costo_real    = $3,
          precio_final  = $4,
          notas_tecnico = COALESCE($5, notas_tecnico)
      WHERE id = $1 AND negocio_id = $2
        AND estado IN ('Recibido','En_reparacion')
      RETURNING *`;
    params = [id, negocioId, costo_real || null, precio_final, notas_tecnico || null];
  }

  const { rows } = await pool.query(query, params);
  return rows[0] || null;
};

// FIX: Garantía gratis — costo_garantia ahora es 0 (valor fijo, no $3 que era texto)
const marcarListoGarantiaGratis = async (negocioId, id, notas_tecnico) => {
  const { rows } = await pool.query(`
    UPDATE ordenes_servicio
    SET estado          = 'Listo',
        precio_garantia = 0,
        costo_garantia  = 0,
        notas_tecnico   = COALESCE($3, notas_tecnico)
    WHERE id = $1 AND negocio_id = $2
      AND estado = 'Garantia' AND garantia_cobrable = false
    RETURNING *
  `, [id, negocioId, notas_tecnico || null]);
  return rows[0] || null;
};

const registrarAbono = async (negocioId, ordenId, { valor, metodo, notas, usuarioId, cajaId }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: orden } = await client.query(`
      SELECT id, estado, precio_final, precio_garantia, total_abonado,
             garantia_cobrable, sucursal_id
      FROM ordenes_servicio
      WHERE id = $1 AND negocio_id = $2
        AND estado IN ('Listo','Pendiente_pago','Garantia')
      FOR UPDATE
    `, [ordenId, negocioId]);
    if (!orden.length) throw { status: 400, message: 'Orden no encontrada o no permite abonos en este estado' };

    const o = orden[0];
    const totalCobro = (o.estado === 'Garantia' && o.garantia_cobrable && o.precio_garantia)
      ? Number(o.precio_garantia)
      : Number(o.precio_final || 0);

    await client.query(`
      INSERT INTO abonos_servicio(orden_id, usuario_id, valor, metodo, notas)
      VALUES ($1, $2, $3, $4, $5)
    `, [ordenId, usuarioId || null, valor, metodo || 'Efectivo', notas || null]);

    const nuevoAbonado = Number(o.total_abonado) + valor;

    const nuevoEstado = (o.estado === 'Pendiente_pago' && nuevoAbonado >= totalCobro)
      ? 'Entregado'
      : o.estado;

    const fechaEntrega = nuevoEstado === 'Entregado' ? 'now()' : 'fecha_entrega';

    const { rows: actualizada } = await client.query(`
      UPDATE ordenes_servicio
      SET total_abonado = $1,
          estado        = $2,
          fecha_entrega = ${fechaEntrega}
      WHERE id = $3
      RETURNING total_abonado, precio_final, precio_garantia, estado, fecha_entrega
    `, [nuevoAbonado, nuevoEstado, ordenId]);

    if (cajaId) {
      await client.query(`
        INSERT INTO movimientos_caja
          (caja_id, usuario_id, tipo, concepto, valor, referencia_id, referencia_tipo)
        VALUES ($1, $2, 'Ingreso', $3, $4, $5, 'servicio')
      `, [
        cajaId, usuarioId || null,
        `Servicio técnico #OS-${String(ordenId).padStart(4, '0')}`,
        valor, ordenId,
      ]);
    }

    await client.query('COMMIT');
    return actualizada[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const marcarEntregado = async (negocioId, id) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(`
      SELECT id, precio_final, precio_garantia, total_abonado,
             garantia_cobrable, estado
      FROM ordenes_servicio
      WHERE id = $1 AND negocio_id = $2
        AND estado IN ('Listo','Garantia')
      FOR UPDATE
    `, [id, negocioId]);
    if (!rows.length) throw { status: 400, message: 'Orden no disponible para entrega' };

    const o = rows[0];
    const esGarantiaGratis = o.estado === 'Garantia' && !o.garantia_cobrable;

    const totalCobro = (o.estado === 'Garantia' && o.garantia_cobrable && o.precio_garantia)
      ? Number(o.precio_garantia)
      : Number(o.precio_final || 0);

    const saldo = totalCobro - Number(o.total_abonado);

    const nuevoEstado = (esGarantiaGratis || saldo <= 0) ? 'Entregado' : 'Pendiente_pago';

    const { rows: updated } = await client.query(`
      UPDATE ordenes_servicio
      SET estado        = $2,
          fecha_entrega = now()
      WHERE id = $1
      RETURNING *
    `, [id, nuevoEstado]);

    await client.query('COMMIT');
    return { ...updated[0], saldo_al_entregar: saldo > 0 ? saldo : 0 };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const marcarSinReparar = async (negocioId, id, { motivo, precio_diagnostico, cajaId, usuarioId }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(`
      SELECT id FROM ordenes_servicio
      WHERE id = $1 AND negocio_id = $2
        AND estado NOT IN ('Entregado','Sin_reparar','Pendiente_pago')
      FOR UPDATE
    `, [id, negocioId]);
    if (!rows.length) throw { status: 400, message: 'Orden no disponible para esta operación' };

    const pd = precio_diagnostico ? Number(precio_diagnostico) : null;

    const { rows: updated } = await client.query(`
      UPDATE ordenes_servicio
      SET estado             = 'Sin_reparar',
          motivo_sin_reparar = $3,
          precio_final       = $4::numeric,
          total_abonado      = COALESCE($4::numeric, 0),
          fecha_entrega      = now()
      WHERE id = $1 AND negocio_id = $2::integer
      RETURNING *
    `, [id, negocioId, motivo || null, pd]);

    if (pd && pd > 0 && cajaId) {
      await client.query(`
        INSERT INTO movimientos_caja
          (caja_id, usuario_id, tipo, concepto, valor, referencia_id, referencia_tipo)
        VALUES ($1, $2, 'Ingreso', $3, $4, $5, 'servicio')
      `, [
        cajaId, usuarioId || null,
        `Diagnóstico #OS-${String(id).padStart(4, '0')}`,
        pd, id,
      ]);
    }

    await client.query('COMMIT');
    return updated[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const abrirGarantia = async (negocioId, id, { cobrable, notas_tecnico }) => {
  const { rows } = await pool.query(`
    UPDATE ordenes_servicio
    SET estado            = 'Garantia',
        garantia_cobrable = $3,
        precio_garantia   = NULL,
        costo_garantia    = NULL,
        total_abonado     = CASE WHEN $3 THEN 0 ELSE total_abonado END,
        fecha_entrega     = NULL,
        notas_tecnico     = COALESCE($4, notas_tecnico)
    WHERE id = $1 AND negocio_id = $2
      AND estado IN ('Entregado','Pendiente_pago')
    RETURNING *
  `, [id, negocioId, cobrable, notas_tecnico || null]);
  return rows[0] || null;
};

const actualizarNotas = async (negocioId, id, notas_tecnico) => {
  const { rows } = await pool.query(`
    UPDATE ordenes_servicio
    SET notas_tecnico = $3
    WHERE id = $1 AND negocio_id = $2
    RETURNING id, notas_tecnico
  `, [id, negocioId, notas_tecnico]);
  return rows[0] || null;
};

module.exports = {
  findAll, findById, getAbonos, getResumenHoy,
  create, marcarEnReparacion, marcarListo, marcarListoGarantiaGratis,
  registrarAbono, marcarEntregado, marcarSinReparar,
  abrirGarantia, actualizarNotas,
};