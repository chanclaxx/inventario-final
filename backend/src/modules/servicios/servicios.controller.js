const service = require('./servicios.service');
const { pool } = require('../../config/db');

const getOrdenes = async (req, res, next) => {
  try {
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const data = await service.getOrdenes(sucursalId, req.user.negocio_id, req.query);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getOrdenById = async (req, res, next) => {
  try {
    const data = await service.getOrdenById(req.user.negocio_id, req.params.id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

// ─── DEBUG TEMPORAL — eliminar después de diagnosticar ────────────────────────
const getResumenHoy = async (req, res, next) => {
  try {
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;

    // Debug: ver qué hora cree PostgreSQL que es en Bogotá
    const { rows: dbTime } = await pool.query(`
      SELECT
        NOW() AS utc_now,
        NOW() AT TIME ZONE 'America/Bogota' AS bogota_now,
        (NOW() AT TIME ZONE 'America/Bogota')::date AS bogota_date
    `);
    console.log('[DEBUG] Hora DB UTC:', dbTime[0].utc_now);
    console.log('[DEBUG] Hora DB Bogotá:', dbTime[0].bogota_now);
    console.log('[DEBUG] Fecha DB Bogotá:', dbTime[0].bogota_date);

    // Debug: ver las fechas reales de las últimas órdenes y abonos
    const { rows: ultimasOrdenes } = await pool.query(`
      SELECT id, fecha_recepcion,
             fecha_recepcion AT TIME ZONE 'America/Bogota' AS fecha_bogota,
             (fecha_recepcion AT TIME ZONE 'America/Bogota')::date AS date_bogota
      FROM ordenes_servicio
      WHERE sucursal_id = $1
      ORDER BY fecha_recepcion DESC
      LIMIT 3
    `, [sucursalId || req.user.negocio_id]);
    console.log('[DEBUG] Últimas 3 órdenes:');
    ultimasOrdenes.forEach((o) => {
      console.log(`  OS-${o.id}: raw=${o.fecha_recepcion} | bogota=${o.fecha_bogota} | date=${o.date_bogota}`);
    });

    const { rows: ultimosAbonos } = await pool.query(`
      SELECT ab.id, ab.fecha, ab.valor,
             ab.fecha AT TIME ZONE 'America/Bogota' AS fecha_bogota,
             (ab.fecha AT TIME ZONE 'America/Bogota')::date AS date_bogota
      FROM abonos_servicio ab
      JOIN ordenes_servicio os ON os.id = ab.orden_id
      WHERE os.sucursal_id = $1
      ORDER BY ab.fecha DESC
      LIMIT 3
    `, [sucursalId || req.user.negocio_id]);
    console.log('[DEBUG] Últimos 3 abonos:');
    ultimosAbonos.forEach((a) => {
      console.log(`  AB-${a.id}: raw=${a.fecha} | bogota=${a.fecha_bogota} | date=${a.date_bogota} | valor=${a.valor}`);
    });

    // Debug: ver el tipo de columna
    const { rows: colType } = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'ordenes_servicio'
        AND column_name = 'fecha_recepcion'
    `);
    console.log('[DEBUG] Tipo de fecha_recepcion:', colType[0]?.data_type);

    const { rows: colTypeAbono } = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'abonos_servicio'
        AND column_name = 'fecha'
    `);
    console.log('[DEBUG] Tipo de abonos.fecha:', colTypeAbono[0]?.data_type);

    // Ahora sí el resumen normal
    const data = await service.getResumenHoy(sucursalId, req.user.negocio_id);
    console.log('[DEBUG] Resultado resumen:', JSON.stringify(data));

    res.json({ ok: true, data });
  } catch (err) {
    console.error('[DEBUG resumen-hoy] ERROR:', err.message, err.stack);
    next(err);
  }
};
// ─── FIN DEBUG ────────────────────────────────────────────────────────────────

const crearOrden = async (req, res, next) => {
  try {
    const sucursal_id = req.todasSucursales ? req.body.sucursal_id : req.sucursal_id;
    if (!sucursal_id) return res.status(400).json({ ok: false, error: 'Sucursal requerida' });
    const data = await service.crearOrden({
      ...req.body,
      sucursal_id,
      negocio_id: req.user.negocio_id,
      usuario_id: req.user.id,
    });
    res.status(201).json({ ok: true, data, message: 'Orden creada correctamente' });
  } catch (err) { next(err); }
};

const enReparacion = async (req, res, next) => {
  try {
    const data = await service.enReparacion(req.user.negocio_id, req.params.id);
    res.json({ ok: true, data, message: 'Orden en reparación' });
  } catch (err) { next(err); }
};

const marcarListo = async (req, res, next) => {
  try {
    const data = await service.marcarListo(req.user.negocio_id, req.params.id, req.body);
    res.json({ ok: true, data, message: 'Orden marcada como lista' });
  } catch (err) { next(err); }
};

const registrarAbono = async (req, res, next) => {
  try {
    const data = await service.registrarAbono(req.user.negocio_id, req.params.id, {
      ...req.body,
      usuarioId: req.user.id,
      cajaId:    req.caja_id || null,
    });
    res.json({ ok: true, data, message: 'Abono registrado correctamente' });
  } catch (err) { next(err); }
};

const entregar = async (req, res, next) => {
  try {
    const data = await service.entregar(req.user.negocio_id, req.params.id);
    const msg = data.estado === 'Pendiente_pago'
      ? `Equipo entregado con saldo pendiente de $${Number(data.saldo_al_entregar || 0).toLocaleString('es-CO')}`
      : 'Equipo entregado correctamente';
    res.json({ ok: true, data, message: msg });
  } catch (err) { next(err); }
};

const sinReparar = async (req, res, next) => {
  try {
    const data = await service.sinReparar(req.user.negocio_id, req.params.id, {
      ...req.body,
      usuario_id: req.user.id,
      caja_id:    req.caja_id || null,
    });
    res.json({ ok: true, data, message: 'Orden cerrada sin reparación' });
  } catch (err) { next(err); }
};

const abrirGarantia = async (req, res, next) => {
  try {
    const data = await service.abrirGarantia(req.user.negocio_id, req.params.id, req.body);
    res.json({ ok: true, data, message: 'Garantía activada' });
  } catch (err) { next(err); }
};

const actualizarNotas = async (req, res, next) => {
  try {
    const data = await service.actualizarNotas(
      req.user.negocio_id, req.params.id, req.body.notas_tecnico
    );
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

module.exports = {
  getOrdenes, getOrdenById, getResumenHoy,
  crearOrden, enReparacion, marcarListo,
  registrarAbono, entregar, sinReparar,
  abrirGarantia, actualizarNotas,
};