// src/utils/costos.util.js
// ─────────────────────────────────────────────────────────────────────────────
// ¿ESTE USUARIO PUEDE VER LOS COSTOS?  — una sola respuesta para todo el sistema
//
// Hasta ahora convivían CUATRO reglas distintas para la misma pregunta, y cada
// pantalla nueva elegía una al azar:
//
//   · `rol === 'admin_negocio'`                    en búsqueda y en el export
//   · `permisos_edicion_productos.campos`          en los modales de edición
//   · `red_interna_ocultar_costos` + rol vendedor  en la red interna
//   · nada en absoluto                             en las listas de inventario,
//                                                  el árbol de variantes y
//                                                  la procedencia
//
// De ahí salían las fugas: el costo no se pintaba en pantalla pero viajaba en
// el JSON, visible en la consola del navegador. Este archivo es la única regla
// a partir de ahora.
//
// ── Por qué es opt-in ────────────────────────────────────────────────────────
// La base es compartida por 28 negocios que hoy operan con los costos a la
// vista de supervisores y vendedores. Apretar el candado para todos sería
// cambiarles la operación sin que lo pidieran. Por eso manda una clave de
// `config_negocio`:
//
//   costos_solo_admin ausente o '0'  → TODO IGUAL QUE SIEMPRE (default)
//   costos_solo_admin === '1'        → solo `admin_negocio`, salvo excepción
//
// La excepción no es una columna nueva: es el permiso granular que YA existe y
// que ya se configura en Ajustes → Usuarios. Si el negocio le marcó el campo
// «Costo» a alguien, es que quiere que lo vea. Reusarlo evita un segundo
// interruptor que diga lo mismo.
//
// ── Lo que este archivo NO hace ──────────────────────────────────────────────
// No AFLOJA nada. La búsqueda por IMEI y la exportación de inventario ya son
// admin-only pase lo que pase, y siguen igual: pasarlas por aquí con el flag
// apagado le abriría los costos a los supervisores de los 28 negocios, que es
// exactamente el daño que se quiere evitar. Este helper solo puede QUITAR.
// ─────────────────────────────────────────────────────────────────────────────

const { pool } = require('../config/db');

const CLAVE = 'costos_solo_admin';

// Cache corto por negocio: esto se consulta en cada listado de inventario, que
// es la pantalla más caliente del sistema y corre contra una base compartida.
// 60s no castiga la BD y config.service invalida al guardar, así que el
// interruptor se siente al instante desde Ajustes.
const _cache = new Map(); // negocio_id → { valor, expira }
const TTL_MS = 60 * 1000;

const invalidarCache = (negocioId) => {
  if (negocioId == null) _cache.clear();
  else _cache.delete(Number(negocioId));
};

/**
 * ¿El negocio encendió el candado? Cacheado 60s.
 * Ante cualquier error de BD devuelve `false` — es decir, el comportamiento de
 * siempre. Una feature apagada es un problema de una feature; una consulta de
 * inventario que revienta es un problema de todos.
 */
const _soloAdmin = async (negocioId) => {
  const id = Number(negocioId);
  if (!id) return false;

  const hit = _cache.get(id);
  if (hit && hit.expira > Date.now()) return hit.valor;

  let valor = false;
  try {
    const { rows } = await pool.query(
      'SELECT valor FROM config_negocio WHERE negocio_id = $1 AND clave = $2 LIMIT 1',
      [id, CLAVE]
    );
    valor = rows[0]?.valor === '1';
  } catch (err) {
    console.warn('[costos] no se pudo leer la config, se asume abierto:', err?.message || err);
    return false;
  }

  _cache.set(id, { valor, expira: Date.now() + TTL_MS });
  return valor;
};

/**
 * La excepción por usuario. `campos` viene del JWT:
 *   null  → admin (todos los campos)
 *   array → los que el negocio le concedió
 */
const _tieneCampoCosto = (user) => {
  const permisos = user?.permisos_edicion_productos;
  if (!permisos || typeof permisos !== 'object') return false;
  return Array.isArray(permisos.campos) && permisos.campos.includes('costo');
};

/**
 * LA pregunta. Úsala en vez de comparar roles a mano.
 *
 * @param {object} user - req.user (viene del JWT)
 * @returns {Promise<boolean>}
 */
const puedeVerCostos = async (user) => {
  if (!user) return false;
  if (user.rol === 'admin_negocio') return true;
  if (!(await _soloAdmin(user.negocio_id))) return true;   // candado apagado
  return _tieneCampoCosto(user);
};

/** Versión síncrona para cuando el flag ya se leyó (p. ej. dentro de un service
 *  que ya tiene el configMap del negocio en la mano). */
const puedeVerCostosCon = (user, configMap) => {
  if (!user) return false;
  if (user.rol === 'admin_negocio') return true;
  if (configMap?.[CLAVE] !== '1') return true;
  return _tieneCampoCosto(user);
};

// ─────────────────────────────────────────────────────────────────────────────
// RECORTE
//
// Se pone a `null` en vez de borrar la clave: el frontend distingue «no hay
// costo registrado» de «no me lo mandaron» mirando otra bandera, y una clave
// que desaparece rompe destructuraciones en sitios que no controlamos.
// ─────────────────────────────────────────────────────────────────────────────

// Todo nombre de campo monetario de ENTRADA que exista en el sistema. Cuando se
// agregue uno nuevo va aquí, no en cada pantalla.
const CLAVES_COSTO = [
  'costo_unitario', 'costo_compra', 'costo', 'costo_total', 'costo_local',
  'costo_promedio', 'precio_unitario', 'precio_compra', 'costo_origen',
  'valor_compra', 'precio_usd', 'valor_traida',
];

// El proveedor viaja junto al costo en casi todas estas consultas y responde a
// la misma pregunta del negocio («de quién compro y a cuánto»). Se recorta con
// el mismo interruptor.
const CLAVES_PROVEEDOR = ['proveedor_id', 'proveedor_nombre', 'proveedor'];

const _anular = (obj, claves) => {
  if (!obj || typeof obj !== 'object') return obj;
  const copia = { ...obj };
  for (const k of claves) if (k in copia) copia[k] = null;
  return copia;
};

/**
 * Recorta un objeto o un array de objetos. `profundidad` recorre las listas
 * anidadas por nombre (el árbol de variantes trae `variantes` dentro de cada
 * atributo, y el costo vive en los tres niveles).
 */
const recortar = (dato, { proveedor = true, anidados = [] } = {}) => {
  const claves = proveedor ? [...CLAVES_COSTO, ...CLAVES_PROVEEDOR] : CLAVES_COSTO;

  const unNodo = (n) => {
    if (!n || typeof n !== 'object') return n;
    const limpio = _anular(n, claves);
    for (const hijo of anidados) {
      if (Array.isArray(limpio[hijo])) limpio[hijo] = limpio[hijo].map(unNodo);
    }
    return limpio;
  };

  return Array.isArray(dato) ? dato.map(unNodo) : unNodo(dato);
};

/**
 * Azúcar para los controladores: recorta solo si toca.
 * `await recortarSiToca(req.user, data, { anidados: ['variantes'] })`
 */
const recortarSiToca = async (user, dato, opciones) =>
  (await puedeVerCostos(user)) ? dato : recortar(dato, opciones);

module.exports = {
  CLAVE,
  puedeVerCostos,
  puedeVerCostosCon,
  recortar,
  recortarSiToca,
  invalidarCache,
  CLAVES_COSTO,
  CLAVES_PROVEEDOR,
};
