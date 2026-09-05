// src/middlewares/ordenesCompra.middleware.js
// ─────────────────────────────────────────────────────────────────────────────
// SEGUNDO CANDADO de la compra por órdenes (orden → recepción parcial).
//
// El primero es `requireModulo('proveedores')`, que valida permisos de usuario.
// Ese no basta: `tieneAcceso` devuelve true incondicionalmente para
// admin_negocio, así que TODOS los admins de TODOS los negocios pasarían.
//
// Este middleware exige además que el negocio haya activado la feature:
//   config_negocio: ordenes_compra_activas = '1'
//
// Un negocio que no la activó recibe 404 — para él el módulo no existe.
//
// ── Tres interruptores, no uno ───────────────────────────────────────────────
// Las órdenes, la garantía del proveedor y los códigos del proveedor se prenden
// por separado a propósito. Un negocio puede querer reclamar garantías sin
// llevar órdenes de compra, o traducir las referencias del proveedor sin nada
// más. Amarrarlos obligaría a tragarse el módulo completo para usar una pieza.
// ─────────────────────────────────────────────────────────────────────────────

const { pool } = require('../config/db');

const CLAVES = {
  activas:        'ordenes_compra_activas',
  modoCargo:      'ordenes_compra_modo_cargo',      // 'recepcion' | 'orden'
  diasAviso:      'ordenes_compra_dias_aviso',      // semáforo de vencimiento
  garantia:       'garantia_proveedor_activa',
  garantiaAviso:  'garantia_proveedor_dias_aviso',
  codigos:        'codigos_proveedor_activos',
  codigoInterno:  'codigo_producto_activo',         // prerrequisito de `codigos`
  detalleNodo:    'ordenes_compra_detalle_nodo',    // pedir la variante, no el producto
  variantes:      'variantes_activo',               // prerrequisito de `detalleNodo`
};

const DEFAULTS = {
  // El proveedor factura cada entrega. Es el caso normal en distribución, y es
  // además el comportamiento que el sistema ya tiene: cada compra crea su cargo.
  modo_cargo:            'recepcion',
  dias_aviso:            3,
  garantia_dias_aviso:   15,
};

// Cache corto por negocio: esta config se lee en cada request del módulo y casi
// nunca cambia. 60s no castiga la BD y deja que un cambio en Configuración se
// sienta de inmediato (config.service la invalida al guardar, además).
const _cache = new Map(); // negocio_id → { valor, expira }
const TTL_MS = 60 * 1000;

const invalidarCache = (negocioId) => {
  if (negocioId == null) _cache.clear();
  else _cache.delete(Number(negocioId));
};

const _entero = (raw, porDefecto) => {
  const v = Number(raw);
  return Number.isInteger(v) && v >= 0 ? v : porDefecto;
};

/**
 * Lee (y cachea) la configuración de compra por órdenes de un negocio.
 * Devuelve siempre un objeto; `activas: false` si no está encendida.
 */
const getConfigOrdenes = async (negocioId) => {
  const hit = _cache.get(negocioId);
  if (hit && hit.expira > Date.now()) return hit.valor;

  const { rows } = await pool.query(
    `SELECT clave, valor FROM config_negocio
     WHERE negocio_id = $1 AND clave = ANY($2::text[])`,
    [negocioId, Object.values(CLAVES)]
  );
  const map = Object.fromEntries(rows.map((r) => [r.clave, r.valor]));

  const modo = map[CLAVES.modoCargo];

  const valor = {
    activas: map[CLAVES.activas] === '1',

    // CUÁNDO nace la deuda con el proveedor:
    //   'recepcion' → cada recepción crea su Cargo (comportamiento de siempre)
    //   'orden'     → el Cargo nace al registrar la factura de la orden y las
    //                 recepciones NO crean cargo propio
    // Un valor desconocido cae al default en vez de romper: es preferible cobrar
    // como siempre a dejar una compra sin registrar la deuda.
    modo_cargo: modo === 'orden' ? 'orden' : DEFAULTS.modo_cargo,

    dias_aviso: _entero(map[CLAVES.diasAviso], DEFAULTS.dias_aviso),

    garantia_activa:     map[CLAVES.garantia] === '1',
    garantia_dias_aviso: _entero(map[CLAVES.garantiaAviso], DEFAULTS.garantia_dias_aviso),

    // Los códigos del proveedor resuelven contra el código interno del producto.
    // Sin códigos internos no hay a dónde apuntar, así que el prerrequisito se
    // vuelve a verificar AQUÍ y no solo al guardar: si alguien apaga los códigos
    // internos después, esta feature se apaga sola en vez de resolver a nada.
    codigos_activos: map[CLAVES.codigos] === '1' && map[CLAVES.codigoInterno] === '1',

    // ── Pedir la VARIANTE y conciliarla al recibir ──────────────────────────
    // Exige `variantes_activo` por la misma razón que los códigos del proveedor
    // exigen los códigos internos: sin árbol de variantes no hay nodo que pedir,
    // y la feature resolvería a nada. Se vuelve a verificar AQUÍ y no solo al
    // guardar, para que apagar las variantes después apague esto solo.
    //
    // Enciende la CAPACIDAD, no la obliga: una misma orden mezcla líneas al nodo
    // y líneas al producto, porque el nodo en NULL ya significa hoy "el producto
    // en general" y esa lectura no cambia.
    detalle_nodo: map[CLAVES.detalleNodo] === '1' && map[CLAVES.variantes] === '1',
  };

  _cache.set(negocioId, { valor, expira: Date.now() + TTL_MS });
  return valor;
};

/**
 * Fábrica de middleware. Exige que la feature indicada esté encendida.
 * Deja la config en `req.configOrdenes` para que el service no la relea.
 *
 * @param {'ordenes'|'garantia'|'codigos'|'detalle'} feature
 */
const requireOrdenesCompra = (feature = 'ordenes') => async (req, res, next) => {
  try {
    const negocioId = req.user?.negocio_id;
    if (!negocioId) {
      return res.status(401).json({ ok: false, error: 'No autenticado' });
    }

    const cfg = await getConfigOrdenes(negocioId);
    req.configOrdenes = cfg;

    const encendida = feature === 'garantia' ? cfg.garantia_activa
      : feature === 'codigos' ? cfg.codigos_activos
        : feature === 'detalle' ? (cfg.activas && cfg.detalle_nodo)
          : cfg.activas;

    if (!encendida) {
      // 404 y no 403: para un negocio que no activó la feature, esto no existe.
      return res.status(404).json({ ok: false, error: 'Recurso no encontrado' });
    }

    return next();
  } catch (err) {
    // Si las tablas aún no existen (migración no aplicada), el módulo queda
    // fuera de servicio pero el resto del sistema sigue igual.
    if (err?.code === '42P01') {
      return res.status(503).json({
        ok: false,
        error: 'La compra por órdenes aún no está disponible en este servidor',
      });
    }
    return next(err);
  }
};

module.exports = { requireOrdenesCompra, getConfigOrdenes, invalidarCache, CLAVES, DEFAULTS };
