const { pool } = require('../config/db');

const JERARQUIA = { admin_negocio: 3, supervisor: 2, vendedor: 1 };

// ── Sin cambios ──────────────────────────────────────────────────────────
const requireRole  = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ ok: false, error: 'No autenticado' });
  if (!roles.includes(req.user.rol))
    return res.status(403).json({ ok: false, error: 'No tienes permisos para esta acción' });
  next();
};

const requireNivel = (nivelMinimo) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ ok: false, error: 'No autenticado' });
  if ((JERARQUIA[req.user.rol] || 0) < (JERARQUIA[nivelMinimo] || 0))
    return res.status(403).json({ ok: false, error: 'No tienes permisos para esta acción' });
  next();
};

// ── Patch: requireSucursal ahora valida ownership en DB ──────────────────
const requireSucursal = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ ok: false, error: 'No autenticado' });
  if (req.user.rol === 'admin_negocio') return next();

  const sucursalSolicitada = Number(req.params.sucursal_id || req.query.sucursal_id);
  if (!sucursalSolicitada) return next();

  if (sucursalSolicitada !== req.user.sucursal_id) {
    return res.status(403).json({ ok: false, error: 'No tienes acceso a esta sucursal' });
  }
  next();
};

// ── NUEVO: helper central de ownership para recursos sin negocio_id ──────
//
// Uso en controladores:
//   await assertBelongsToNegocio('credito', creditoId, req.user.negocio_id)
//
// Lanza un error con status 403 si el recurso no pertenece al negocio.
// El errorHandler lo captura automáticamente.

const CADENAS_OWNERSHIP = {
  // tabla lógica  → query que devuelve negocio_id
  caja: `
    SELECT s.negocio_id FROM aperturas_caja ac
    JOIN sucursales s ON s.id = ac.sucursal_id
    WHERE ac.id = $1 LIMIT 1`,

  credito: `
    SELECT s.negocio_id FROM creditos c
    JOIN sucursales s ON s.id = c.sucursal_id
    WHERE c.id = $1 LIMIT 1`,

  abono_credito: `
    SELECT s.negocio_id FROM abonos_credito ab
    JOIN creditos c     ON c.id = ab.credito_id
    JOIN sucursales s   ON s.id = c.sucursal_id
    WHERE ab.id = $1 LIMIT 1`,

  prestamo: `
    SELECT s.negocio_id FROM prestamos p
    JOIN sucursales s ON s.id = p.sucursal_id
    WHERE p.id = $1 LIMIT 1`,

  abono_prestamo: `
    SELECT s.negocio_id FROM abonos_prestamo ab
    JOIN prestamos p   ON p.id = ab.prestamo_id
    JOIN sucursales s  ON s.id = p.sucursal_id
    WHERE ab.id = $1 LIMIT 1`,

  movimiento_caja: `
    SELECT s.negocio_id FROM movimientos_caja mc
    JOIN aperturas_caja ac ON ac.id = mc.caja_id
    JOIN sucursales s      ON s.id = ac.sucursal_id
    WHERE mc.id = $1 LIMIT 1`,

  factura: `
    SELECT s.negocio_id FROM facturas f
    JOIN sucursales s ON s.id = f.sucursal_id
    WHERE f.id = $1 LIMIT 1`,

  compra: `
    SELECT s.negocio_id FROM compras c
    JOIN sucursales s ON s.id = c.sucursal_id
    WHERE c.id = $1 LIMIT 1`,
};

const assertBelongsToNegocio = async (tipo, id, negocioId) => {
  const query = CADENAS_OWNERSHIP[tipo];
  if (!query) throw new Error(`Tipo de ownership no registrado: ${tipo}`);

  const { rows } = await pool.query(query, [id]);

  if (!rows.length || rows[0].negocio_id !== negocioId) {
    const err = new Error('Recurso no encontrado o sin acceso');
    err.status = 403;
    throw err;
  }
};

module.exports = { requireRole, requireNivel, requireSucursal, assertBelongsToNegocio };