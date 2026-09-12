// ─────────────────────────────────────────────────────────────────────────────
// LISTAS DE PRECIOS (feature opt-in por negocio)
//
// El negocio pregraba N listas con nombre —«1 Pasamano», «Al por mayor»,
// «Cliente final»— y cada producto guarda SU precio en cada una. En el mostrador
// el vendedor toca un chip y el precio del carrito cambia. Nada se calcula: el
// precio ya estaba escrito.
//
// ── En qué se diferencia de las TARIFAS porcentuales ────────────────────────
// Las dos ofrecen el mismo gesto, y por eso `saveConfig` las hace EXCLUYENTES:
// dos filas de chips peleándose por el mismo número no tienen desenlace bueno.
// La diferencia está en de dónde sale el precio:
//
//   tarifa → se CALCULA desde el costo (costo × 1,20). Necesita que el costo
//            llegue al navegador del vendedor, y por eso es incompatible con
//            «ocultar costos».
//   lista  → está ESCRITO producto por producto. No mira el costo para nada,
//            así que SÍ convive con «ocultar costos» — que es justo lo que
//            quiere una bodega que le esconde sus costos a los locales.
//
// Y por eso una lista puede decir 7.000 donde el cálculo daría 7.013, puede
// ponerle precio a un producto sin costo registrado, y puede vender por debajo
// del costo si el negocio lo decide. Las tres cosas pasan en catálogos reales.
//
// Este módulo es PURO (sin React, sin red): toda la aritmética y el parseo
// defensivo viven aquí para poder probarlos aislados.
//
// OJO: las REGLAS DE FORMA (tope de listas, largo del nombre, tope de precio)
// están duplicadas a mano con `backend/src/utils/listasPrecios.util.js` porque
// el frontend no puede importar del backend. Hay una prueba que lee los dos
// archivos y falla si se separan — es exactamente lo que ya les pasó a las dos
// listas de módulos, y nadie se enteró hasta que un usuario perdió un permiso.
// ─────────────────────────────────────────────────────────────────────────────

/** Tiene que coincidir con MAX_LISTAS del backend. */
export const MAX_LISTAS = 20;
/** Tiene que coincidir con MAX_NOMBRE del backend. */
export const MAX_NOMBRE = 40;
/** Tiene que coincidir con MAX_PRECIO del backend. */
export const MAX_PRECIO = 1e9;
/** Tienen que coincidir con COLORES del backend. */
export const COLORES = ['green', 'blue', 'purple', 'amber', 'gray'];

/** Origen del precio de un ítem del carrito, cuando lo puso una lista. */
export const ORIGEN_LISTA_PRECIO = 'lista_precio';

// ── Parseo de la config ──────────────────────────────────────────────────────

const _normalizarLista = (cruda, indice) => {
  if (!cruda || typeof cruda !== 'object' || Array.isArray(cruda)) return null;

  const nombre = typeof cruda.nombre === 'string' ? cruda.nombre.trim() : '';
  if (!nombre) return null;

  const id = typeof cruda.id === 'string' && cruda.id.trim()
    ? cruda.id.trim().slice(0, 24)
    : `p${indice + 1}`;

  return {
    id,
    nombre: nombre.slice(0, MAX_NOMBRE),
    color:  COLORES.includes(cruda.color) ? cruda.color : 'blue',
  };
};

/**
 * Lee `listas_precios_lista` (string JSON) y devuelve un arreglo limpio.
 * Nunca lanza: un JSON corrupto degrada a [], igual que `parsearTarifas`.
 */
export const parsearListas = (raw) => {
  let lista;
  try {
    lista = JSON.parse(raw || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(lista)) return [];

  const vistos  = new Set();
  const limpias = [];
  for (let i = 0; i < lista.length && limpias.length < MAX_LISTAS; i++) {
    const l = _normalizarLista(lista[i], i);
    if (!l || vistos.has(l.id)) continue;   // ids duplicados: gana el primero
    vistos.add(l.id);
    limpias.push(l);
  }
  return limpias;
};

/**
 * Traduce el mapa de config del negocio a la configuración de listas.
 * `config` es el objeto plano de GET /config (puede ser undefined mientras
 * carga la query).
 */
export const leerConfigListas = (config) => {
  const cfg = config || {};
  const listas = parsearListas(cfg.listas_precios_lista);

  return {
    // Activa solo si el negocio la encendió Y configuró al menos una lista:
    // encenderla sin listas dejaría un selector vacío en el carrito, que es
    // la misma guarda que ya tienen las tarifas.
    activo: cfg.listas_precios_activo === '1' && listas.length > 0,
    listas,
  };
};

// ── Resolución del precio ────────────────────────────────────────────────────

/**
 * Un mapa de precios utilizable, venga como venga.
 *
 * `node-postgres` devuelve un `jsonb` ya parseado, pero un ítem que lleva días
 * en `localStorage` puede traer cualquier cosa —o nada—, y los NUMERIC llegan
 * como STRING con decimales ("7000.00"), que es el mismo detalle que convirtió
 * un precio en 700.000 la última vez que alguien lo limpió a ciegas.
 */
export const normalizarPrecios = (crudo) => {
  let obj = crudo;
  if (typeof obj === 'string') {
    try { obj = JSON.parse(obj); } catch { return null; }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  const limpio = {};
  for (const [id, bruto] of Object.entries(obj)) {
    const n = Number(bruto);
    if (!Number.isFinite(n) || n <= 0 || n > MAX_PRECIO) continue;
    limpio[id] = Math.round(n);
  }
  return Object.keys(limpio).length > 0 ? limpio : null;
};

/**
 * Los precios de un nodo, heredando de arriba hacia abajo.
 *
 * Se pasan los niveles del más general al más específico
 * (`preciosDeNodo(producto, atributo, variante)`) y se mezclan CLAVE POR CLAVE,
 * ganando el más específico. Esto es deliberadamente distinto de cómo se
 * resuelve `precio`, que elige un valor entero con `||`:
 *
 *   precio  → la talla tiene precio propio, o no lo tiene. Uno u otro.
 *   precios → la talla puede tener SU precio mayorista y heredar los otros dos
 *             del producto. Elegir el objeto entero tiraría a la basura los
 *             precios que el producto sí tenía y dejaría al vendedor sin dos de
 *             las tres listas justo en esa talla.
 *
 * Es la misma regla que aplica el SQL del escaneo con el operador `||` de jsonb.
 */
export const preciosDeNodo = (...niveles) => {
  let mezcla = null;
  for (const nivel of niveles) {
    const limpio = normalizarPrecios(nivel?.precios ?? nivel);
    if (!limpio) continue;
    mezcla = { ...(mezcla || {}), ...limpio };
  }
  return mezcla;
};

/**
 * El precio de un ítem en una lista, o null si esa lista no le puso precio.
 *
 * null NO es cero y no debe tratarse como tal: significa "esta lista no dice
 * nada de este producto", y quien llame decide qué hacer (la respuesta es caer
 * al precio de siempre, nunca dejar el mostrador en $0).
 */
export const precioEnLista = (precios, listaId) => {
  if (!listaId) return null;
  const limpio = normalizarPrecios(precios);
  if (!limpio) return null;
  const v = limpio[listaId];
  return Number.isFinite(v) && v > 0 ? v : null;
};

/**
 * Lo que hay que cobrar por un ítem si se le aplica una lista.
 *
 * Devuelve siempre un número utilizable y dice de dónde salió:
 *   { precio, deLista: true  } → la lista tenía precio para este producto
 *   { precio, deLista: false } → no lo tenía y se cae al precio de siempre
 *
 * Ese fallback es la regla que no se negocia: una lista a medio llenar no puede
 * dejar productos a $0 en el mostrador. Y se marca, para que el vendedor sepa
 * que ese precio NO es el de la lista que escogió.
 */
export const resolverPrecioItem = (item, listaId) => {
  const base = Number(item?.precio);
  const dePrecioLista = precioEnLista(item?.precios, listaId);
  if (dePrecioLista != null) return { precio: dePrecioLista, deLista: true };
  return { precio: Number.isFinite(base) ? base : 0, deLista: false };
};

/** Busca una lista por id dentro de las configuradas. */
export const buscarLista = (listas, id) =>
  (listas || []).find((l) => l.id === id) || null;

/**
 * Cuántos de estos ítems NO tienen precio en la lista dada.
 *
 * Sirve para avisar en el carrito ANTES de cobrar: «3 productos no están en
 * “Al por mayor” y van a su precio normal». Sin este aviso, la lista a medio
 * llenar se descubre cuando el cliente ya pagó.
 */
export const contarSinPrecio = (items, listaId) => {
  if (!listaId) return 0;
  return (items || []).filter((i) => precioEnLista(i?.precios, listaId) == null).length;
};
