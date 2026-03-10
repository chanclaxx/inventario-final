const { pool } = require('../config/db');

/**
 * Resuelve la sucursal_id efectiva para el request.
 *
 * - vendedor/supervisor: usa su sucursal_id del token
 * - admin_negocio: usa sucursal_id del query/body, o la primera sucursal del negocio
 *
 * Agrega req.sucursal_id para que los controllers lo usen.
 */
const resolveSucursal = async (req, res, next) => {
  try {
    if (!req.user) return next();

    // Vendedor y supervisor siempre usan su sucursal asignada
    if (req.user.rol !== 'admin_negocio') {
      req.sucursal_id = req.user.sucursal_id;
      return next();
    }

    // Admin puede pasar sucursal_id explícita por query o body
    const sucursalExplicita = Number(req.query.sucursal_id || req.body?.sucursal_id);
    if (sucursalExplicita) {
      // Verificar que la sucursal pertenezca al negocio
      const { rows } = await pool.query(
        'SELECT id FROM sucursales WHERE id = $1 AND negocio_id = $2 AND activa = true',
        [sucursalExplicita, req.user.negocio_id]
      );
      if (!rows.length) {
        return res.status(403).json({ ok: false, error: 'Sucursal no válida para este negocio' });
      }
      req.sucursal_id = sucursalExplicita;
      return next();
    }

    // Si no pasa sucursal, usar la primera del negocio
    const { rows } = await pool.query(
      'SELECT id FROM sucursales WHERE negocio_id = $1 AND activa = true ORDER BY id LIMIT 1',
      [req.user.negocio_id]
    );
    if (!rows.length) {
      return res.status(400).json({ ok: false, error: 'No hay sucursales activas en este negocio' });
    }
    req.sucursal_id = rows[0].id;
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { resolveSucursal };