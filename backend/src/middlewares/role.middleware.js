// Roles disponibles: 'admin_negocio' | 'supervisor' | 'vendedor'
//
// Jerarquía:
//   admin_negocio — acceso total al negocio (todas las sucursales)
//   supervisor    — gestión de su sucursal
//   vendedor      — operaciones básicas de su sucursal

const JERARQUIA = {
  admin_negocio: 3,
  supervisor:    2,
  vendedor:      1,
};

/**
 * Verifica que el usuario tenga alguno de los roles indicados.
 * Uso: requireRole('admin_negocio', 'supervisor')
 */
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: 'No autenticado' });
    }
    if (!roles.includes(req.user.rol)) {
      return res.status(403).json({ ok: false, error: 'No tienes permisos para esta acción' });
    }
    next();
  };
};

/**
 * Verifica que el usuario tenga al menos el nivel de jerarquía indicado.
 * Uso: requireNivel('supervisor') — permite supervisor y admin_negocio
 */
const requireNivel = (nivelMinimo) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: 'No autenticado' });
    }
    const nivelUsuario = JERARQUIA[req.user.rol] || 0;
    const nivelReq     = JERARQUIA[nivelMinimo]  || 0;

    if (nivelUsuario < nivelReq) {
      return res.status(403).json({ ok: false, error: 'No tienes permisos para esta acción' });
    }
    next();
  };
};

/**
 * Verifica que el usuario pertenezca a la sucursal del recurso que intenta acceder.
 * admin_negocio puede acceder a cualquier sucursal de su negocio.
 * Uso: en rutas que reciben sucursal_id como param o query.
 */
const requireSucursal = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ ok: false, error: 'No autenticado' });
  }
  // admin_negocio accede a todas las sucursales de su negocio
  if (req.user.rol === 'admin_negocio') return next();

  const sucursalSolicitada = Number(req.params.sucursal_id || req.query.sucursal_id);
  if (sucursalSolicitada && sucursalSolicitada !== req.user.sucursal_id) {
    return res.status(403).json({ ok: false, error: 'No tienes acceso a esta sucursal' });
  }
  next();
};

module.exports = { requireRole, requireNivel, requireSucursal };