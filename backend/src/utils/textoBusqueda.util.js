// Comparar NOMBRES DE PERSONAS sin que importen tildes, mayúsculas ni espacios.
//
// El teclado del celular pone tildes solo («Maria» → «María») y la gente busca
// sin ellas, o al revés. Si la búsqueda compara exacto, «maria» no encuentra a
// «María», el vendedor concluye que el cliente no existe y lo crea otra vez:
// así nacen los duplicados (reportado por un cliente, oct-2026).
//
// La regla es UNA y la usan las dos orillas: `normalizarTexto` para el término
// (en JS) y `sqlSinTildes` para la columna (en SQL). Si se separan, la búsqueda
// vuelve a fallar con las tildes que una de las dos no conozca.
//
// TRANSLATE y no la extensión `unaccent`, que puede no estar instalada. Las
// mayúsculas con tilde van en la lista además de las minúsculas: con una
// collation «C», LOWER('Í') devuelve 'Í' tal cual. Y las marcas combinantes
// sueltas (texto guardado descompuesto, 'a' + U+0301) se BORRAN: no tienen
// pareja en la segunda lista, y TRANSLATE elimina lo que no tiene pareja.

const VOCALES = {
  a: 'áàâãä', e: 'éèêë', i: 'íìîï', o: 'óòôõö', u: 'úùûü', n: 'ñ', c: 'ç',
};

let CON_TILDE = '';
let SIN_TILDE = '';
for (const [base, variantes] of Object.entries(VOCALES)) {
  for (const ch of variantes + variantes.toUpperCase()) {
    CON_TILDE += ch;
    SIN_TILDE += base;
  }
}
// Acento agudo, grave, circunflejo, virgulilla, diéresis y cedilla combinantes.
const COMBINANTES = '̧́̀̂̃̈';

/** Minúsculas, sin tildes y sin espacios repetidos: «  María  José » → «maria jose». */
const normalizarTexto = (texto) =>
  String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** La misma normalización, como expresión SQL sobre una columna. */
const sqlSinTildes = (col) =>
  `TRANSLATE(LOWER(REGEXP_REPLACE(BTRIM(COALESCE(${col}, '')), '[[:space:]]+', ' ', 'g')), `
  + `'${CON_TILDE}${COMBINANTES}', '${SIN_TILDE}')`;

/** Término para un LIKE: normalizado, recortado y con los comodines escapados. */
const patronLike = (texto, max = 100) =>
  normalizarTexto(String(texto ?? '').slice(0, max)).replace(/[%_\\]/g, '\\$&');

module.exports = { normalizarTexto, sqlSinTildes, patronLike, CON_TILDE, SIN_TILDE };
