// ─────────────────────────────────────────────────────────────────────────────
// LISTAS DE PRECIOS — N precios de venta por producto, y el vendedor elige cual
// al agregar al carrito. Feature opt-in (`config_negocio.listas_precios_activo`).
//
// Ver migrations/20260912_listas_precios.sql para el diseño completo. Lo que
// vive aquí es lo que el BACKEND necesita saber:
//
//   1. Cómo se lee y valida el catálogo de listas de `config_negocio`. La MISMA
//      función corre en `saveConfig` y al leer, igual que `normalizarCondicion`
//      en la mora: así es imposible guardar una lista que el lector descarte
//      después en silencio — y que el negocio crea que tiene tres precios
//      cuando el carrito solo le ofrece dos.
//   2. Cómo se sanea el JSONB antes de escribirlo en un nodo.
//
// La ARITMÉTICA de "qué precio le toca a este ítem" NO está aquí: vive en
// `frontend/src/utils/listasPrecios.js`, porque quien la necesita es el carrito.
// Lo que sí está duplicado a mano entre los dos lados son las REGLAS de forma
// (tope, largo del nombre, rango del precio), y por eso existe la prueba que
// lee los dos archivos y falla si se separan — es lo que ya le pasó a las dos
// listas de módulos.
// ─────────────────────────────────────────────────────────────────────────────

/** Tope defensivo: el mismo que las tarifas, y por el mismo motivo. */
const MAX_LISTAS = 20;

/** Largo máximo del nombre visible de una lista. */
const MAX_NOMBRE = 40;

/**
 * Tope de un precio. Un NUMERIC de Postgres aguanta mucho más, pero un precio
 * de venta de más de mil millones en pesos es un dedazo, no una venta — y
 * dejarlo pasar lo convierte en una factura imposible de cuadrar.
 */
const MAX_PRECIO = 1e9;

/** Colores admitidos para el chip, los mismos que ya usa SelectorTarifa. */
const COLORES = ['green', 'blue', 'purple', 'amber', 'gray'];

/**
 * Normaliza una lista cruda del JSON de config.
 * Devuelve null si no es utilizable — el llamador la descarta.
 */
const normalizarLista = (cruda, indice) => {
  if (!cruda || typeof cruda !== 'object' || Array.isArray(cruda)) return null;

  const nombre = typeof cruda.nombre === 'string' ? cruda.nombre.trim() : '';
  if (!nombre) return null;

  // El id es un slug ESTABLE y es la clave con la que cada producto guarda su
  // precio. Renombrar o reordenar una lista no puede romper lo ya guardado, así
  // que no se deriva del nombre ni de la posición salvo que falte del todo.
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
const parsearListas = (raw) => {
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
    const l = normalizarLista(lista[i], i);
    if (!l || vistos.has(l.id)) continue;   // ids duplicados: gana el primero
    vistos.add(l.id);
    limpias.push(l);
  }
  return limpias;
};

/**
 * Valida el JSON que llega de Ajustes y lanza un 400 explicando qué está mal.
 *
 * `parsearListas` descarta en silencio lo que no sirve — eso está bien al LEER
 * (una lista rota no puede tumbar el carrito) pero es inaceptable al GUARDAR:
 * el admin creería que salvó una lista que nadie va a ver nunca.
 */
const validarListas = (raw) => {
  let lista;
  try {
    lista = JSON.parse(raw);
  } catch {
    throw { status: 400, message: 'La lista de precios no es un JSON válido' };
  }
  if (!Array.isArray(lista)) {
    throw { status: 400, message: 'Las listas de precios deben venir en un arreglo' };
  }
  if (lista.length > MAX_LISTAS) {
    throw { status: 400, message: `No puedes tener más de ${MAX_LISTAS} listas de precios` };
  }

  const ids     = new Set();
  const nombres = new Set();
  for (const l of lista) {
    if (!l || typeof l !== 'object' || Array.isArray(l)) {
      throw { status: 400, message: 'Cada lista de precios debe ser un objeto' };
    }
    const nombre = typeof l.nombre === 'string' ? l.nombre.trim() : '';
    if (!nombre) {
      throw { status: 400, message: 'Cada lista de precios necesita un nombre' };
    }
    if (nombre.length > MAX_NOMBRE) {
      throw { status: 400, message: `El nombre "${nombre}" es demasiado largo (máximo ${MAX_NOMBRE} caracteres)` };
    }
    if (typeof l.id !== 'string' || !l.id.trim()) {
      throw { status: 400, message: `La lista "${nombre}" no tiene identificador` };
    }
    if (ids.has(l.id)) {
      throw { status: 400, message: `Hay dos listas de precios con el mismo identificador (${l.id})` };
    }
    // Dos listas con el mismo nombre no rompen nada por dentro —el id las
    // distingue— pero en el carrito son dos chips idénticos y el vendedor no
    // tiene forma de saber cuál toca.
    const clave = nombre.toLowerCase();
    if (nombres.has(clave)) {
      throw { status: 400, message: `Hay dos listas de precios llamadas "${nombre}"` };
    }
    ids.add(l.id);
    nombres.add(clave);
  }
};

/**
 * Saneado del mapa de precios de UN nodo, antes de escribirlo.
 *
 * `idsValidos` son los ids de las listas configuradas hoy. Lo que no esté ahí
 * se descarta: si no, borrar una lista dejaría su precio enquistado en miles de
 * productos, y volver a crear una lista con el mismo id resucitaría precios que
 * nadie revisó.
 *
 * Devuelve:
 *   null   → no hay ningún precio que guardar (se escribe NULL, no {})
 *   objeto → { <idLista>: <entero> }
 *
 * Un valor vacío, cero o negativo NO se guarda como 0: se OMITE. "Sin precio en
 * esta lista" y "vale cero" son cosas distintas, y solo la primera existe — un
 * producto a $0 en el mostrador es siempre un error de captura.
 */
const sanearPrecios = (valor, idsValidos) => {
  if (valor === null || valor === undefined || valor === '') return null;

  let crudo = valor;
  if (typeof crudo === 'string') {
    try { crudo = JSON.parse(crudo); } catch { return null; }
  }
  if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) return null;

  const permitidos = new Set(idsValidos || []);
  const limpio = {};
  for (const [id, bruto] of Object.entries(crudo)) {
    if (!permitidos.has(id)) continue;
    const n = Number(bruto);
    if (!Number.isFinite(n) || n <= 0 || n > MAX_PRECIO) continue;
    limpio[id] = Math.round(n);
  }
  return Object.keys(limpio).length > 0 ? limpio : null;
};

module.exports = {
  MAX_LISTAS, MAX_NOMBRE, MAX_PRECIO, COLORES,
  parsearListas, validarListas, sanearPrecios,
};
