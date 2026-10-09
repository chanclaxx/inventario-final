// Comparar textos escritos por personas sin que importen tildes, mayúsculas ni
// espacios: el teclado del celular le pone tilde a «Maria» y quien busca
// escribe «maria» (o al revés). Comparando exacto, la persona «no existe» y se
// crea otra vez — así nacían los clientes y compañeros duplicados (oct-2026).
//
// Es la misma regla que `backend/src/utils/textoBusqueda.util.js`
// (`normalizarTexto`); la suite 77 compara las dos.

/** Minúsculas, sin tildes y sin espacios repetidos: «  María  José » → «maria jose». */
export const normalizarTexto = (texto) =>
  String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** ¿`texto` contiene lo escrito en `consulta`? Sin consulta, todo coincide. */
export const contieneTexto = (texto, consulta) =>
  normalizarTexto(texto).includes(normalizarTexto(consulta));

/** El elemento de `items` cuyo nombre es EL MISMO que `nombre` (sin tildes ni mayúsculas). */
export const buscarHomonimo = (items, nombre) => {
  const clave = normalizarTexto(nombre);
  if (!clave) return null;
  return (items ?? []).find((it) => normalizarTexto(it?.nombre) === clave) ?? null;
};
