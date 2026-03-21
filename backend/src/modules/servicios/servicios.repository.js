const { pool } = require('../../config/db');

// ─── Constantes ───────────────────────────────────────────────────────────────

const ZONA   = `AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota'`;
const HOY_OS = `DATE(os.fecha_recepcion ${ZONA}) = (NOW() ${ZONA})::date`;
const HOY_AB = `DATE(ab.fecha           ${ZONA}) = (NOW() ${ZONA})::date`;

// saldo_pendiente y utilidad:
// - precio_final = lo que costó la reparación original
// - precio_garantia = lo que se cobra en ciclo de garantía (cobrable)
// - Para cobro activo: si hay garantia_cobrable activa → usar precio_garantia
// - Utilidad por ciclo: separada para no mezclar fechas en reportes
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
  const filtroOS = sucursalId ? `os.sucursal_id = $1` : `os.negocio_id = $1`;
  const param    = sucursalId ?? negocioId;

  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*)
       FROM ordenes_servicio os
       WHERE ${filtroOS} AND ${HOY_OS}
      ) AS ordenes_hoy,

      -- Ingresos = abonos registrados hoy (fecha del abono)
      (SELECT COALESCE(SUM(ab.valor), 0)
       FROM abonos_servicio ab
       JOIN ordenes_servicio os ON os.id = ab.orden_id
       WHERE ${filtroOS} AND ${HOY_AB}
      ) AS ingresos_hoy,

      -- Utilidad = órdenes cerradas hoy (fecha_entrega hoy)
      -- Suma utilidad reparación + utilidad garantía (si aplica)
      (SELECT COALESCE(SUM(
         COALESCE(os.precio_final, 0)    - COALESCE(os.costo_real, 0) +
         COALESCE(os.precio_garantia, 0) - COALESCE(os.costo_garantia, 0)
       ), 0)
       FROM ordenes_servicio os
       WHERE ${filtroOS}
         AND os.estado IN ('Entregado','Sin_reparar')
         AND os.precio_final IS NOT NULL
         AND os.costo_real   IS NOT NULL
         AND DATE(os.fecha_entrega ${ZONA}) = (NOW() ${ZONA})::date
      ) AS utilidad_hoy,

      -- Pendiente cobro = órdenes activas con saldo > 0
      (SELECT COALESCE(SUM(
         CASE
           WHEN os.estado = 'Garantia' AND os.garantia_cobrable AND os.precio_garantia IS NOT NULL
           THEN os.precio_garantia - os.total_abonado
           WHEN os.estado IN ('Listo','Pendiente_pago')
           THEN os.precio_final - os.total_abonado
           ELSE 0
         END
       ), 0)
       FROM ordenes_servicio os
       WHERE ${filtroOS}
         AND os.estado IN ('Listo','Pendiente_pago','Garantia')
         AND (
           (os.estado IN ('Listo','Pendiente_pago') AND os.precio_final > os.total_abonado)
           OR (os.estado = 'Garantia' AND os.garantia_cobrable
               AND os.precio_garantia IS NOT NULL
               AND os.precio_garantia > os.total_abonado)
         )
      ) AS pendiente_cobro
  `, [param]);
  return rows[0];
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

// marcarListo maneja dos casos:
// - Estado normal (Recibido/En_reparacion): actualiza precio_final y costo_real
// - Estado Garantia cobrable: actualiza precio_garantia y costo_garantia (NO toca precio_final)
const marcarListo = async (negocioId, id, { costo_real, precio_final, notas_tecnico,
  precio_garantia, costo_garantia, esGarantia }) => {
  let query, params;

  if (esGarantia) {
    // Garantía cobrable: guardar en campos separados, NO tocar precio_final original
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
    // Reparación normal: actualizar precio_final y costo_real
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

// Garantía gratis: marcar listo directamente sin precio, entrega sin cobro
const marcarListoGarantiaGratis = async (negocioId, id, notas_tecnico) => {
  const { rows } = await pool.query(`
    UPDATE ordenes_servicio
    SET estado          = 'Listo',
        precio_garantia = 0,
        costo_garantia  = $3,
        notas_tecnico   = COALESCE($3, notas_tecnico)
    WHERE id = $1 AND negocio_id = $2
      AND estado = 'Garantia' AND garantia_cobrable = false
    RETURNING *
  `, [id, negocioId, notas_tecnico || null]);
  return rows[0] || null;
};

// Abono dentro de transacción + movimiento_caja automático
// El cobro activo puede ser precio_final o precio_garantia según el estado
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

    const o = rows[0];
    // Determinar el total a cobrar según el ciclo activo
    const totalCobro = (o.estado === 'Garantia' && o.garantia_cobrable && o.precio_garantia)
      ? Number(o.precio_garantia)
      : Number(o.precio_final || 0);

    await client.query(`
      INSERT INTO abonos_servicio(orden_id, usuario_id, valor, metodo, notas)
      VALUES ($1, $2, $3, $4, $5)
    `, [ordenId, usuarioId || null, valor, metodo || 'Efectivo', notas || null]);

    const nuevoAbonado = Number(o.total_abonado) + valor;

    // Si quedó saldado y estaba Pendiente_pago → pasar a Entregado
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

// Entregar:
// - Pago completo → estado Entregado
// - Con saldo → estado Pendiente_pago (equipo va pero sigue debiendo)
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

    // Total a cobrar: garantía cobrable usa precio_garantia, resto usa precio_final
    const totalCobro = (o.estado === 'Garantia' && o.garantia_cobrable && o.precio_garantia)
      ? Number(o.precio_garantia)
      : Number(o.precio_final || 0);

    const saldo = totalCobro - Number(o.total_abonado);

    // Garantía gratis → siempre Entregado sin cobro
    // Pago completo → Entregado
    // Con saldo → Pendiente_pago (equipo va pero debe)
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

// Al abrir garantía: preservar precio_final histórico, resetear total_abonado y precio_garantia
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