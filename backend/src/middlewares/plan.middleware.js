const { pool } = require('../config/db');

/**
 * Verifica que el negocio del usuario tenga el plan activo.
 * Se aplica después del middleware auth.
 */
const verificarPlan = async (req, res, next) => {
  try {
    const negocioId = req.user?.negocio_id;
    if (!negocioId) return next();

    const { rows } = await pool.query(
      `SELECT estado_plan, fecha_vencimiento FROM negocios WHERE id = $1 LIMIT 1`,
      [negocioId]
    );

    if (!rows.length) {
      return res.status(403).json({ ok: false, error: 'Negocio no encontrado', code: 'NEGOCIO_NO_ENCONTRADO' });
    }

    const { estado_plan, fecha_vencimiento } = rows[0];

    if (estado_plan === 'activo' && new Date(fecha_vencimiento) < new Date()) {
      await pool.query(`UPDATE negocios SET estado_plan = 'vencido' WHERE id = $1`, [negocioId]);
      return res.status(403).json({ ok: false, error: 'Tu plan ha vencido.', code: 'PLAN_VENCIDO', fecha_vencimiento });
    }

    const bloqueos = {
      vencido:    { error: 'Tu plan ha vencido. Contacta al administrador para renovarlo.', code: 'PLAN_VENCIDO' },
      suspendido: { error: 'Tu cuenta ha sido suspendida.',                                 code: 'CUENTA_SUSPENDIDA' },
      pendiente:  { error: 'Tu cuenta está pendiente de activación.',                       code: 'CUENTA_PENDIENTE' },
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