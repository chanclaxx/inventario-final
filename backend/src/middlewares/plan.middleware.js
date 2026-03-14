const { pool } = require('../config/db');

const _marcarVencido = (negocioId) =>
  pool.query(`UPDATE negocios SET estado_plan = 'vencido' WHERE id = $1`, [negocioId]);

const verificarPlan = async (req, res, next) => {
  try {
    const negocioId = req.user?.negocio_id;

    // ── Sin negocio_id en el token: rechazar, no pasar ──────
    if (!negocioId) {
      return res.status(401).json({ ok: false, error: 'Token sin contexto de negocio' });
    }

    const { rows } = await pool.query(
      `SELECT estado_plan, fecha_vencimiento FROM negocios WHERE id = $1 AND activo = true LIMIT 1`,
      [negocioId]
    );

    if (!rows.length) {
      return res.status(403).json({ ok: false, error: 'Negocio no encontrado', code: 'NEGOCIO_NO_ENCONTRADO' });
    }

    const { estado_plan, fecha_vencimiento } = rows[0];

    if (estado_plan === 'activo' && new Date(fecha_vencimiento) < new Date()) {
      await _marcarVencido(negocioId); // efecto secundario explícito
      return res.status(403).json({ ok: false, error: 'Tu plan ha vencido.', code: 'PLAN_VENCIDO', fecha_vencimiento });
    }

    const bloqueos = {
      vencido:   { error: 'Tu plan ha vencido. Contacta al administrador para renovarlo.', code: 'PLAN_VENCIDO' },
      suspendido: { error: 'Tu cuenta ha sido suspendida.',                                code: 'CUENTA_SUSPENDIDA' },
      pendiente:  { error: 'Tu cuenta está pendiente de activación.',                      code: 'CUENTA_PENDIENTE' },
    };

    if (bloqueos[estado_plan]) {
      return res.status(403).json({ ok: false, ...bloqueos[estado_plan], fecha_vencimiento });
    }

    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { verificarPlan };