const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { pool } = require('../../config/db');
const { enviarAprobacion } = require('../email/email.service');

// ── Auth superadmin ───────────────────────────────────

const loginSuperadmin = async (email, password) => {
  const { rows } = await pool.query(
    `SELECT id, nombre, email, password_hash, activo
     FROM superadmins WHERE LOWER(email) = LOWER($1)`,
    [email]
  );

  const sa = rows[0];
  if (!sa) throw { status: 401, message: 'Credenciales incorrectas' };
  if (!sa.activo) throw { status: 401, message: 'Cuenta desactivada' };

  const valida = await bcrypt.compare(password, sa.password_hash);
  if (!valida) throw { status: 401, message: 'Credenciales incorrectas' };

  const payload = { id: sa.id, nombre: sa.nombre, email: sa.email, rol: 'superadmin' };

  const accessToken = jwt.sign(payload, process.env.JWT_SA_SECRET, {
  expiresIn: process.env.JWT_SA_EXPIRES_IN || '2h',
});
const refreshToken = jwt.sign(
  { id: sa.id, rol: 'superadmin' },
  process.env.JWT_SA_SECRET,
  { expiresIn: '8h' }
);

  return { accessToken, refreshToken, usuario: payload };
};

// ── Estadísticas generales ────────────────────────────

const getEstadisticas = async () => {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*)                                           AS total,
      COUNT(*) FILTER (WHERE estado_plan = 'activo')    AS activos,
      COUNT(*) FILTER (WHERE estado_plan = 'pendiente') AS pendientes,
      COUNT(*) FILTER (WHERE estado_plan = 'vencido')   AS vencidos,
      COUNT(*) FILTER (WHERE estado_plan = 'suspendido') AS suspendidos
    FROM negocios
  `);
  return rows[0];
};

// ── Listar negocios ───────────────────────────────────

const getNegocios = async ({ estado, busqueda }) => {
  let query = `
    SELECT
      n.id, n.nombre, n.nit, n.email, n.telefono, n.plan,
      n.estado_plan, n.fecha_vencimiento, n.creado_en,
      COUNT(DISTINCT s.id) AS total_sucursales,
      COUNT(DISTINCT u.id) AS total_usuarios
    FROM negocios n
    LEFT JOIN sucursales s ON s.negocio_id = n.id
    LEFT JOIN usuarios   u ON u.negocio_id = n.id
    WHERE 1=1
  `;
  const params = [];

  if (estado) {
    params.push(estado);
    query += ` AND n.estado_plan = $${params.length}`;
  }
  if (busqueda) {
    params.push(`%${busqueda}%`);
    query += ` AND (n.nombre ILIKE $${params.length} OR n.email ILIKE $${params.length})`;
  }

  query += ` GROUP BY n.id ORDER BY n.creado_en DESC`;

  const { rows } = await pool.query(query, params);
  return rows;
};

// ── Aprobar negocio ───────────────────────────────────

const aprobarNegocio = async (negocioId) => {
  const { rows: [negocio] } = await pool.query(
    `SELECT id, nombre, email, estado_plan FROM negocios WHERE id = $1`,
    [negocioId]
  );
  if (!negocio) throw { status: 404, message: 'Negocio no encontrado' };
  if (negocio.estado_plan !== 'pendiente') {
    throw { status: 400, message: 'El negocio no está en estado pendiente' };
  }

  const passwordTemporal = Math.random().toString(36).slice(-8) + '!A1';
  const hash = await bcrypt.hash(passwordTemporal, 10);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE negocios
       SET estado_plan = 'activo', fecha_vencimiento = NOW() + INTERVAL '30 days'
       WHERE id = $1`,
      [negocioId]
    );

    await client.query(
      `INSERT INTO usuarios (negocio_id, sucursal_id, nombre, email, password_hash, rol, password_temporal)
       VALUES ($1, NULL, $2, $3, $4, 'admin_negocio', true)
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         rol = 'admin_negocio',
         negocio_id = EXCLUDED.negocio_id,
         activo = true`,
      [negocioId, `Admin ${negocio.nombre}`, negocio.email, hash]
    );

    await client.query('COMMIT');

    enviarAprobacion({
      email:             negocio.email,
      nombre_negocio:    negocio.nombre,
      password_temporal: passwordTemporal,
    }).catch((err) => console.error('Error enviando email de aprobación:', err.message));

    return { ok: true, password_temporal: passwordTemporal };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── Cambiar estado de un negocio ──────────────────────

const cambiarEstadoNegocio = async (negocioId, nuevoEstado) => {
  const estadosValidos = ['activo', 'suspendido', 'vencido'];
  if (!estadosValidos.includes(nuevoEstado)) {
    throw { status: 400, message: 'Estado no válido' };
  }

  const { rows: [negocio] } = await pool.query(
    `UPDATE negocios SET estado_plan = $1 WHERE id = $2 RETURNING id, nombre, estado_plan`,
    [nuevoEstado, negocioId]
  );
  if (!negocio) throw { status: 404, message: 'Negocio no encontrado' };
  return negocio;
};

// ── Listar planes disponibles ─────────────────────────

const getPlanes = async () => {
  const { rows } = await pool.query(
    `SELECT id, nombre, precio_mensual, max_sucursales, max_usuarios, descripcion
     FROM planes WHERE activo = true ORDER BY precio_mensual ASC`
  );
  return rows;
};

// ── Renovar plan de un negocio ────────────────────────

const renovarPlan = async (negocioId, plan, superadminId, notas) => {
  const { rows: [planData] } = await pool.query(
    `SELECT * FROM planes WHERE nombre = $1 AND activo = true`,
    [plan]
  );
  if (!planData) throw { status: 400, message: 'Plan no válido' };

  const { rows: [negocio] } = await pool.query(
    `SELECT id, nombre, email, estado_plan, fecha_vencimiento FROM negocios WHERE id = $1`,
    [negocioId]
  );
  if (!negocio) throw { status: 404, message: 'Negocio no encontrado' };

  const base = negocio.fecha_vencimiento > new Date()
    ? negocio.fecha_vencimiento
    : new Date();

  const fechaDesde = new Date(base);
  const fechaHasta = new Date(base);
  fechaHasta.setMonth(fechaHasta.getMonth() + 1);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE negocios SET
        plan              = $1,
        estado_plan       = 'activo',
        fecha_vencimiento = $2,
        max_sucursales    = $3,
        max_usuarios      = $4
       WHERE id = $5`,
      [plan, fechaHasta, planData.max_sucursales, planData.max_usuarios, negocioId]
    );

    await client.query(
      `INSERT INTO pagos_plan
        (negocio_id, valor, plan, metodo, meses, fecha_desde, fecha_hasta, registrado_por, notas)
       VALUES ($1, $2, $3, 'Manual', 1, $4, $5, $6, $7)`,
      [negocioId, planData.precio_mensual, plan, fechaDesde, fechaHasta, superadminId, notas || null]
    );

    await client.query('COMMIT');
    return { ok: true, fecha_hasta: fechaHasta };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── Verificar vencimientos (tarea diaria) ─────────────

const verificarVencimientos = async () => {
  const { rows: vencidos } = await pool.query(
    `UPDATE negocios SET estado_plan = 'vencido'
     WHERE estado_plan = 'activo' AND fecha_vencimiento < NOW()
     RETURNING id, nombre, email`
  );

  const { rows: porVencer } = await pool.query(
    `SELECT id, nombre, email, fecha_vencimiento
     FROM negocios
     WHERE estado_plan = 'activo'
       AND fecha_vencimiento BETWEEN NOW() AND NOW() + INTERVAL '3 days'`
  );

  return { vencidos, porVencer };
};

module.exports = {
  loginSuperadmin,
  getEstadisticas,
  getNegocios,
  aprobarNegocio,
  cambiarEstadoNegocio,
  getPlanes,
  renovarPlan,
  verificarVencimientos,
};