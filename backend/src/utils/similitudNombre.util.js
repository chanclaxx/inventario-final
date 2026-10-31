// ─────────────────────────────────────────────────────────────────────────────
// ¿QUÉ TAN PARECIDOS SON DOS NOMBRES DE PRODUCTO?
//
// Nació en el módulo de traslados (traslados.repository.js) para emparejar el
// producto de una sede con el de otra cuando no se llaman exactamente igual
// («iPhone 13 128GB» y «iPhone 13 128 GB Apple»). La red interna lo usa ahora
// para SUGERIR —nunca para decidir sola— a qué producto del destino va algo
// que no tiene un igual exacto, y así no duplicar el catálogo del destino.
// Es la misma función en los dos sitios: dos copias acabarían puntuando
// distinto el mismo par de nombres.
// ─────────────────────────────────────────────────────────────────────────────

/** Minúsculas, sin tildes, guiones como espacio, espacios simples. */
const norm = (s) =>
  (s || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ');

/** Palabras de 2+ caracteres. */
const tokens = (s) => norm(s).split(/\s+/).filter((t) => t.length >= 2);

/**
 * Similitud entre un producto candidato y los datos del origen.
 * Insensible a orden de palabras, tildes, mayúsculas y guiones.
 *
 *  100 → mismo nombre normalizado
 *   99 → mismas palabras en otro orden
 * 20–98 → superposición parcial de palabras + bonos de marca/modelo/línea
 *  0–19 → poca o ninguna similitud
 */
const puntaje = (prod, { nombre, marca, modelo, linea_id }) => {
  const n1 = norm(nombre);
  const n2 = norm(prod.nombre);
  if (n1 === n2) return 100;

  const t1 = tokens(nombre);
  const t2 = tokens(prod.nombre);
  if (
    t1.length > 0
    && t1.length === t2.length
    && t1.every((t) => t2.includes(t))
    && t2.every((t) => t1.includes(t))
  ) return 99;

  let score = 0;
  if (t1.length && t2.length) {
    const hits = t1.filter((t) => t2.includes(t)).length;
    const union = new Set([...t1, ...t2]).size;
    score += (hits / union) * 60;
    if (hits === t1.length) score += 15; // todas las palabras del origen están en el destino
  }
  if (n2.includes(n1) || n1.includes(n2)) score += 10;
  else {
    // «128GB» y «128 GB» son lo mismo: sin espacios, uno contiene al otro.
    const c1 = n1.replace(/ /g, ''), c2 = n2.replace(/ /g, '');
    if (c1 && c2 && (c2.includes(c1) || c1.includes(c2))) score += 15;
  }
  if (marca && prod.marca && norm(marca) === norm(prod.marca))     score += 12;
  if (modelo && prod.modelo && norm(modelo) === norm(prod.modelo)) score += 10;
  if (linea_id && prod.linea_id === linea_id) score += 5;
  return score;
};

/** Desde aquí un candidato se ofrece como «puede que sea este». */
const UMBRAL_PARECIDO = 20;

module.exports = { norm, tokens, puntaje, UMBRAL_PARECIDO };
