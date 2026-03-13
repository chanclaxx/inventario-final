const { pool } = require('../config/db');

/**
 * Resuelve el contexto de sucursal para cada request.
 *
 * Resultado en req:
 *   req.sucursal_id       → número (operación en una sucursal específica)
 *   req.todasSucursales   → true (admin pidió vista global del negocio)
 *
 * Lógica por rol:
 *   vendedor / supervisor → siempre su sucursal asignada del token
 *   admin_negocio         → sucursal_id explícita | "todas" | fallback primera activa
 */
const resolveSucursal = async (req, res, next) => {
  try {
    if (!req.user) return next();

    // ── Vendedor y supervisor: solo su sucursal asignada ──────────────────
    if (req.user.rol !== 'admin_negocio') {
      if (!req.user.sucursal_id) {
        return res.status(403).json({
          ok: false,
          error: 'Tu usuario no tiene sucursal asignada. Contacta al administrador.',
        });
      }
      req.sucursal_id = req.user.sucursal_id;
      return next();
    }

    // ── Admin: leer sucursal_id del query param o body ────────────────────
    const param = req.query.sucursal_id ?? req.body?.sucursal_id;

    // Vista global solicitada explícitamente
    if (param === 'todas') {
      req.todasSucursales = true;
      return next();
    }

    // Sucursal numérica explícita — validar que pertenezca al negocio
    const sucursalExplicita = Number(param);
    if (sucursalExplicita) {
      const { rows } = await pool.query(
        `SELECT id FROM sucursales
         WHERE id = $1 AND negocio_id = $2 AND activa = true`,
        [sucursalExplicita, req.user.negocio_id]
      );
      if (!rows.length) {
        return res.status(403).json({
          ok: false,
          error: 'Sucursal no válida para este negocio',
        });
      }
      req.sucursal_id = sucursalExplicita;
      return next();
    }

    // Fallback: primera sucursal activa del negocio
    const { rows } = await pool.query(
      `SELECT id FROM sucursales
       WHERE negocio_id = $1 AND activa = true
       ORDER BY id
       LIMIT 1`,
      [req.user.negocio_id]
    );
    if (!rows.length) {
      return res.status(400).json({
        ok: false,
        error: 'No hay sucursales activas en este negocio',
      });
    }
    req.sucursal_id = rows[0].id;
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { resolveSucursal };