const { pool } = require('../../config/db');

// ─── Helper: crear factura automática al entregar ─────────────────────────────

const METODOS_FACTURA = new Set(['Efectivo','Transferencia','Tarjeta','Nequi','Daviplata','Credito','Otro']);

const _crearFacturaPorServicio = async (client, orden, precioServicio) => {
  if (orden.factura_id) return;

  const partes = ['Servicio técnico'];
  if (orden.equipo_tipo)   partes.push(`(${orden.equipo_tipo})`);
  if (orden.equipo_nombre) partes.push(`- ${orden.equipo_nombre}`);
  const nombreLinea = partes.join(' ');

  const notas = `OS-${String(orden.id).padStart(4, '0')}: ${(orden.falla_reportada || '').slice(0, 200)}`;

  const { rows: [factura] } = await client.query(`
    INSERT INTO facturas(sucursal_id, usuario_id, cliente_id, nombre_cliente, cedula, celular, notas, estado)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'Activa')
    RETURNING id
  `, [
    orden.sucursal_id,
    orden.usuario_id || null,
    orden.cliente_id || null,
    orden.cliente_nombre,
    orden.cliente_cedula  || 'S/C',
    orden.cliente_telefono || '0000000000',
    notas,
  ]);

  await client.query(`
    INSERT INTO lineas_factura(factura_id, nombre_producto, cantidad, precio)
    VALUES ($1, $2, 1, $3)
  `, [factura.id, nombreLinea, precioServicio]);

  // Pagos: suma de abonos agrupados por método
  const { rows: abonos } = await client.query(`
    SELECT metodo, SUM(valor) AS total
    FROM abonos_servicio
    WHERE orden_id = $1
    GROUP BY metodo
  `, [orden.id]);

  for (const ab of abonos) {
    const val = Number(ab.total);
    if (val > 0) {
      const metodo = METODOS_FACTURA.has(ab.metodo) ? ab.metodo : 'Otro';
      await client.query(
        'INSERT INTO pagos_factura(factura_id, metodo, valor) VALUES ($1, $2, $3)',
        [factura.id, metodo, val],
      );
    }
  }

  await client.query(
    'UPDATE ordenes_servicio SET factura_id = $1 WHERE id = $2',
    [factura.id, orden.id],
  );
};

// ─── Constantes ───────────────────────────────────────────────────────────────

const HOY_BOGOTA = `(NOW() AT TIME ZONE 'America/Bogota')::date`;

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
      os.fecha_recepcion, os.fecha_entrega, os.sucursal_id, os.factura_id,
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

  const { rows: r1 } = await pool.query(`
    SELECT COUNT(*) AS ordenes_hoy
    FROM ordenes_servicio
    WHERE ${campoFiltro} = $1
      AND ${fechaBogota('fecha_recepcion')} = ${HOY_BOGOTA}
  `, [param]);

  const { rows: r2 } = await pool.query(`
    SELECT COALESCE(SUM(ab.valor), 0) AS ingresos_hoy
    FROM abonos_servicio ab
    JOIN ordenes_servicio os ON os.id = ab.orden_id
    WHERE os.${campoFiltro} = $1
      AND ${fechaBogota('ab.fecha')} = ${HOY_BOGOTA}
  `, [param]);

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
    costo_estimado, checklist_equipo, patron_desbloqueo,
  } = datos;

  const { rows } = await pool.query(`
    INSERT INTO ordenes_servicio (
      negocio_id, sucursal_id, usuario_id,
      cliente_nombre, cliente_telefono, cliente_cedula, cliente_id,
      equipo_tipo, equipo_nombre, equipo_serial,
      falla_reportada, contrasena_equipo, notas_tecnico,
      costo_estimado, checklist_equipo, patron_desbloqueo
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb)
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
    checklist_equipo  ? JSON.stringify(checklist_equipo)  : null,
    patron_desbloqueo ? JSON.stringify(patron_desbloqueo) : null,
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
             garantia_cobrable, sucursal_id,
             usuario_id, cliente_id, cliente_nombre, cliente_cedula, cliente_telefono,
             equipo_tipo, equipo_nombre, falla_reportada, factura_id
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

    if (nuevoEstado === 'Entregado' && !o.factura_id) {
      await _crearFacturaPorServicio(client, o, totalCobro);
    }

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
             garantia_cobrable, estado,
             sucursal_id, usuario_id, cliente_id, cliente_nombre,
             cliente_cedula, cliente_telefono, equipo_tipo, equipo_nombre,
             falla_reportada, factura_id
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

    if (nuevoEstado === 'Entregado' && !o.factura_id) {
      await _crearFacturaPorServicio(client, o, totalCobro);
    }

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