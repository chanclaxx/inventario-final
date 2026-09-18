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

/**
 * Editar los PRECIOS DE LISTA de un producto.
 *
 * Por defecto: solo `admin_negocio`. Es lo que pidió el negocio y es lo que
 * corresponde — una lista de precios es la política comercial de la empresa,
 * no un dato del producto: cambiar "Al por mayor" mueve el margen de todas las
 * ventas mayoristas de todos los locales a la vez.
 *
 * NO se cuelga de `permisos_edicion_productos.campos` aunque ahí ya exista una
 * casilla «Precio», y esa es la decisión importante: esa casilla la traen
 * ENCENDIDA por defecto todos los usuarios con edición de inventario, así que
 * colgarla de ahí le habría dado los precios de lista, el día del despliegue y
 * sin que nadie lo pidiera, a todos los supervisores del sistema.
 *
 * Por eso la llave es NUEVA y explícita, y su ausencia significa "no puede".
 * Eso no contradice la regla de que `null` = permisos base del rol: esa regla
 * protege lo que el rol YA podía hacer antes de que existiera la columna, y
 * aquí el permiso nace con la feature — nadie pierde nada, porque nadie lo
 * tiene. Lo que sí se respeta es no mirar la columna entera con un `=== true`:
 * se mira ESTA clave, y un usuario sin `permisos_edicion_productos` conserva
 * intacto todo lo demás.
 */
const requirePermisoPreciosLista = (req, res, next) => {
  if (!req.user) return res.status(401).json({ ok: false, error: 'No autenticado' });
  if (req.user.rol === 'admin_negocio') return next();
  if (req.user.permisos_edicion_productos?.puede_editar_precios_lista === true) return next();
  return res.status(403).json({
    ok: false,
    error: 'No tienes permiso para cambiar las listas de precios. Pídeselo a un administrador.',
  });
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

/**
 * Técnicos externos — cuatro llaves independientes.
 *
 *   mover     → mandar equipos al técnico y recibirlos de vuelta
 *   pagar     → anticipos, pagos y devoluciones (mueven caja)
 *   anular    → anular un pago (revierte caja)
 *   gestionar → crear y editar técnicos
 *
 * `permisos_tecnicos` sigue la regla de las otras columnas de permisos:
 * null / ausente = permisos BASE DEL ROL, nunca "no puede". La base la eligió
 * el negocio: el supervisor mueve y paga, el vendedor solo mueve. Un token
 * emitido antes del despliegue no trae la clave y cae en la base, igual que
 * con `permisos_facturas`.
 *
 * Se mira CADA clave por separado: un objeto sin `anular` no le quita al
 * usuario las otras tres.
 */
const BASE_TECNICOS = {
  supervisor: { mover: true, pagar: true,  anular: false, gestionar: false },
  vendedor:   { mover: true, pagar: false, anular: false, gestionar: false },
};

const MENSAJES_TECNICOS = {
  mover:     'No tienes permiso para mandar o recibir equipos del técnico',
  pagar:     'No tienes permiso para registrar pagos a técnicos',
  anular:    'No tienes permiso para anular pagos a técnicos',
  gestionar: 'No tienes permiso para crear o editar técnicos',
};

const puedeTecnicos = (user, accion) => {
  if (!user) return false;
  if (user.rol === 'admin_negocio') return true;
  const permisos = user.permisos_tecnicos;
  if (permisos && typeof permisos === 'object' && typeof permisos[accion] === 'boolean') {
    return permisos[accion];
  }
  return BASE_TECNICOS[user.rol]?.[accion] === true;
};

const requirePermisoTecnicos = (accion) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ ok: false, error: 'No autenticado' });
  if (puedeTecnicos(req.user, accion)) return next();
  return res.status(403).json({ ok: false, error: MENSAJES_TECNICOS[accion] || 'Sin permiso' });
};

module.exports = { requireRole, requireNivel, requireSucursal, assertBelongsToNegocio, requirePermisoProveedores, requirePermisoFacturas, requirePermisoVerCompras, requirePermisoExportarInventario, requirePermisoExportarNegocio, requirePermisoPreciosLista, requirePermisoTecnicos, puedeTecnicos, BASE_TECNICOS };