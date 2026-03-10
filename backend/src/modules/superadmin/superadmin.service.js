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

  // Si ya tiene fecha futura, sumar desde ahí; si no, desde hoy
  const base = negocio.fecha_vencimiento > new Date()
    ? negocio.fecha_vencimiento
    : new Date();

  const fechaDesde = new Date(base);
  const fechaHasta = new Date(base);
  fechaHasta.setMonth(fechaHasta.getMonth() + 1);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Actualizar negocio
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

    // Registrar pago
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
  // Bloquear negocios vencidos
  const { rows: vencidos } = await pool.query(
    `UPDATE negocios SET estado_plan = 'vencido'
     WHERE estado_plan = 'activo' AND fecha_vencimiento < NOW()
     RETURNING id, nombre, email`
  );

  // Negocios que vencen en 3 días
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