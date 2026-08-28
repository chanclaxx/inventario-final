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

  if (sucursalSolicitada === req.user.sucursal_id) return next();

  // Permite también sucursales de solo lectura asignadas al usuario
  const vistaIds = req.user.sucursales_vista ?? [];
  if (vistaIds.includes(sucursalSolicitada)) return next();

  return res.status(403).json({ ok: false, error: 'No tienes acceso a esta sucursal' });
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

/**
 * Verifica permisos granulares sobre el módulo de proveedores.
 * admin_negocio siempre pasa. Para otros roles se lee req.user.permisos_proveedores
 * que viene directamente del JWT.
 *
 * @param {'ver'|'crear'} tipo
 */
const requirePermisoProveedores = (tipo) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ ok: false, error: 'No autenticado' });
  if (req.user.rol === 'admin_negocio') return next();

  const permisos = req.user.permisos_proveedores;
  if (!permisos) {
    return res.status(403).json({ ok: false, error: 'Sin permisos para proveedores' });
  }
  if (tipo === 'ver' && !permisos.ver) {
    return res.status(403).json({ ok: false, error: 'Sin permiso para ver proveedores' });
  }
  if (tipo === 'crear' && !permisos.crear) {
    return res.status(403).json({ ok: false, error: 'Sin permiso para crear proveedores' });
  }
  next();
};

/**
 * Permiso granular sobre una factura YA EMITIDA: editarla o cancelarla.
 *
 * Antes las dos acciones eran `requireNivel('supervisor')` a secas. Eso obligaba
 * a subir de rol al vendedor que solo necesitaba corregir la cédula de su propia
 * venta, y no dejaba quitarle a un supervisor la cancelación —que revierte
 * stock, caja y crédito— sin quitarle todo lo demás.
 *
 * `permisos_facturas` viene del JWT y tiene tres estados, no dos:
 *
 *   null / ausente  → permisos BASE DEL ROL: supervisor o más, igual que antes.
 *                     Es lo que ven los tokens emitidos antes de este despliegue
 *                     y los usuarios a los que nadie les ha tocado el permiso.
 *   { ... }         → manda el objeto y el rol deja de contar. Así se le puede
 *                     dar a un vendedor y quitar a un supervisor.
 *
 * `admin_negocio` pasa siempre y su columna se guarda en NULL, igual que en los
 * otros dos bloques de permisos.
 *
 * @param {'editar'|'cancelar'} accion
 */
const requirePermisoFacturas = (accion) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ ok: false, error: 'No autenticado' });
  if (req.user.rol === 'admin_negocio') return next();

  const permisos = req.user.permisos_facturas;
  const clave    = accion === 'cancelar' ? 'puede_cancelar' : 'puede_editar';

  if (permisos && typeof permisos === 'object') {
    if (permisos[clave] === true) return next();
    return res.status(403).json({
      ok: false,
      error: accion === 'cancelar'
        ? 'No tienes permiso para cancelar facturas'
        : 'No tienes permiso para editar facturas',
    });
  }

  // Sin permiso explícito: la regla de siempre.
  return requireNivel('supervisor')(req, res, next);
};

/**
 * Historial de compras — con precios.
 *
 * `permisos_proveedores.ver_compras` se configuraba en Ajustes → Usuarios, se
 * pintaba como insignia en la lista y lo consultaba UNA pantalla del frontend
 * para esconder una pestaña. El backend nunca lo leyó: `GET /api/compras`
 * respondía el historial completo, con los precios de cada línea, a cualquiera
 * que tuviera el módulo de proveedores. El interruptor no protegía nada.
 *
 * Esto no le quita el acceso a nadie que lo tuviera de verdad: la pantalla ya
 * exigía el permiso, así que quien no lo tiene tampoco veía la pestaña. Lo
 * único que cambia es que ahora tampoco lo ve quien pregunte por la API.
 */
const requirePermisoVerCompras = (req, res, next) => {
  if (!req.user) return res.status(401).json({ ok: false, error: 'No autenticado' });
  if (req.user.rol === 'admin_negocio') return next();
  if (req.user.permisos_proveedores?.ver_compras === true) return next();
  return res.status(403).json({ ok: false, error: 'No tienes permiso para ver el historial de compras' });
};

const requirePermisoExportarInventario = (req, res, next) => {
  if (!req.user) return res.status(401).json({ ok: false, error: 'No autenticado' });
  if (req.user.rol === 'admin_negocio') return next();
  if (req.user.permisos_edicion_productos?.puede_exportar === true) return next();
  return res.status(403).json({ ok: false, error: 'Sin permiso para exportar el inventario' });
};

const requirePermisoExportarNegocio = (req, res, next) => {
  if (!req.user) return res.status(401).json({ ok: false, error: 'No autenticado' });
  if (req.user.rol === 'admin_negocio') return next();
  if (req.user.permisos_edicion_productos?.puede_exportar_global === true) return next();
  return res.status(403).json({ ok: false, error: 'Sin permiso para exportar el inventario global' });
};

module.exports = { requireRole, requireNivel, requireSucursal, assertBelongsToNegocio, requirePermisoProveedores, requirePermisoFacturas, requirePermisoVerCompras, requirePermisoExportarInventario, requirePermisoExportarNegocio };