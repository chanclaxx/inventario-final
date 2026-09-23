// ─────────────────────────────────────────────────────────────────────────────
// LISTAS DE PRECIOS EN SQL — cómo se lee el mapa de precios de un NODO
//
// Las listas viven en una columna `precios` JSONB en los tres niveles del árbol
// de cantidad (y en la referencia de un serial). Al leerlas hay que heredar
// HACIA ABAJO, y no con `COALESCE` sino con el concatenado de jsonb (`||`):
// COALESCE elige UN objeto entero, así que una talla con su propio precio
// mayorista tiraría a la basura los otros dos precios que el producto sí tenía.
// `||` mezcla clave por clave y gana la derecha —el nivel más específico—, que
// es justo la regla: el producto pone los precios generales y la talla
// sobrescribe los suyos.
//
// Esto vivía SOLO dentro de `busqueda.repository` (el escaneo hacia el carrito).
// Cuando el despacho de la red interna necesitó los mismos precios —para poder
// mandar todo un envío al precio de una lista sin tocar línea por línea— la
// opción era copiar las tres expresiones a otro archivo, y las copias de este
// repositorio se han separado siempre (las dos listas de módulos, y las dos
// definiciones de lo que le cobra la bodega al local). Vive aquí una sola vez.
//
// Sin la columna (`hayListasPrecios()` en falso) cada consulta sigue emitiendo
// exactamente el SQL de antes: `omitir` la borra del SELECT y `null` la deja
// como un NULL tipado, que es lo que un UNION necesita para no cambiar de forma
// entre ramas.
//
// Los ALIAS son fijos y forman parte del contrato: `pc` productos_cantidad,
// `ap` atributos_producto, `v` variantes_atributo, `ps` productos_serial. No es
// entrada de usuario: son literales SQL que arma el código que hace la consulta.
// ─────────────────────────────────────────────────────────────────────────────
const { hayListasPrecios } = require('../config/columnas');

const HERENCIA = {
  producto: 'pc.precios',
  atributo: `COALESCE(pc.precios, '{}'::jsonb) || COALESCE(ap.precios, '{}'::jsonb)`,
  variante: `COALESCE(pc.precios, '{}'::jsonb) || COALESCE(ap.precios, '{}'::jsonb)
               || COALESCE(v.precios, '{}'::jsonb)`,
  // Los precios de un equipo viven en la REFERENCIA, no en la unidad: «a cuánto
  // vendo este modelo según el cliente» es una pregunta del modelo.
  serial:   'ps.precios',
};

/**
 * Fragmento de SELECT con los precios de un nodo.
 *
 * @param {'producto'|'atributo'|'variante'|'serial'} nivel
 * @param {object}  opciones
 * @param {string}  opciones.as        nombre de la columna de salida
 * @param {boolean} opciones.coma      agrega la coma final (para interpolar en medio de un SELECT)
 * @param {'null'|'omitir'} opciones.sinColumna  qué emitir si la migración no está
 */
const selPreciosNodo = (nivel, { as = 'precios', coma = false, sinColumna = 'null' } = {}) => {
  if (!hayListasPrecios()) {
    return sinColumna === 'omitir' ? '' : `NULL::jsonb AS ${as}${coma ? ',' : ''}`;
  }
  return `${HERENCIA[nivel]} AS ${as}${coma ? ',' : ''}`;
};

module.exports = { selPreciosNodo };
