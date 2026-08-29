// ── Catálogo de formatos de etiqueta ─────────────────────────────────────────
//
// Vive SOLO aquí y el frontend lo pide con `GET /api/etiquetas/formatos`. No se
// copia al frontend a propósito: la lista de módulos está duplicada a mano entre
// `config/modulos.js` y `UsuariosConfig.jsx`, las dos copias se separaron, y a
// un usuario le desapareció la pestaña Bodega sin que nadie tocara su permiso.
// Una geometría desincronizada aquí sería peor: la pantalla diría "24 etiquetas
// por hoja", el PDF traería otra cosa, y el error solo se vería después de
// gastar la hoja adhesiva.
//
// Medidas en MILÍMETROS (es lo que dice el empaque de las etiquetas y lo que el
// usuario puede medir con una regla). La conversión a puntos la hace el que
// dibuja, una sola vez.
//
// Dos medios, y la diferencia es física:
//   · `hoja`  → una plancha adhesiva A4/Carta en una impresora de oficina. Una
//               página trae muchas etiquetas y hay que acertarle a la retícula.
//   · `rollo` → impresora térmica de etiquetas. Cada etiqueta es UNA PÁGINA del
//               tamaño exacto de la etiqueta; la impresora avanza el rollo.
//               Enviarle una A4 a una térmica no imprime nada útil.

const MM = 72 / 25.4;   // milímetros → puntos PDF

const A4    = { ancho: 210,   alto: 297   };
const CARTA = { ancho: 215.9, alto: 279.4 };

/**
 * Formato de plancha. Los valores son los de las referencias que se consiguen
 * en papelería; `separacion` es el espacio en blanco ENTRE etiquetas (muchas
 * planchas van pegadas y va en 0).
 */
const hoja = (id, nombre, pagina, columnas, filas, ancho, alto, margen, separacion = { x: 0, y: 0 }) => ({
  id, nombre, medio: 'hoja',
  pagina, columnas, filas,
  etiqueta: { ancho, alto },
  margen, separacion,
  porHoja: columnas * filas,
});

/**
 * Formato de rollo. La página ES la etiqueta: sin márgenes y sin retícula.
 * El margen interior lo pone el dibujante, igual para los dos medios.
 */
const rollo = (id, nombre, ancho, alto) => ({
  id, nombre, medio: 'rollo',
  pagina: { ancho, alto },
  columnas: 1, filas: 1,
  etiqueta: { ancho, alto },
  margen: { arriba: 0, izquierda: 0 },
  separacion: { x: 0, y: 0 },
  porHoja: 1,
});

const FORMATOS = [
  // ── Planchas adhesivas (impresora normal) ───────────────────────────────────
  hoja('a4-5x13', 'A4 · 65 etiquetas (38 × 21 mm)', A4, 5, 13, 38.1, 21.2,
    { arriba: 10.7, izquierda: 4.75 }, { x: 2.5, y: 0 }),
  hoja('a4-4x10', 'A4 · 40 etiquetas (52 × 30 mm)', A4, 4, 10, 52.5, 29.7,
    { arriba: 0, izquierda: 0 }),
  // 37 mm exactos, no 37,1: ocho filas de 37,1 suman 296,8 y con cualquier
  // margen superior se salen de los 297 de una A4. La prueba lo caza.
  hoja('a4-3x8',  'A4 · 24 etiquetas (70 × 37 mm)', A4, 3, 8, 70, 37,
    { arriba: 0.5, izquierda: 0 }),
  hoja('a4-2x7',  'A4 · 14 etiquetas (99 × 38 mm)', A4, 2, 7, 99.1, 38.1,
    { arriba: 15.15, izquierda: 5.9 }, { x: 0, y: 0 }),
  hoja('carta-3x10', 'Carta · 30 etiquetas (66 × 25 mm)', CARTA, 3, 10, 66.7, 25.4,
    { arriba: 12.7, izquierda: 4.8 }, { x: 3.0, y: 0 }),

  // ── Rollo térmico (una etiqueta por página) ────────────────────────────────
  rollo('rollo-50x25',  'Rollo · 50 × 25 mm',  50, 25),
  rollo('rollo-40x30',  'Rollo · 40 × 30 mm',  40, 30),
  rollo('rollo-38x25',  'Rollo · 38 × 25 mm',  38, 25),
  rollo('rollo-32x25',  'Rollo · 32 × 25 mm',  32, 25),
  rollo('rollo-60x40',  'Rollo · 60 × 40 mm',  60, 40),
  rollo('rollo-100x50', 'Rollo · 100 × 50 mm', 100, 50),
];

const POR_ID = Object.fromEntries(FORMATOS.map((f) => [f.id, f]));

// Topes de un formato a medida. No son gustos: por debajo de 20 × 10 mm no cabe
// un símbolo legible ni con el código más corto, y por encima de una A3 no hay
// impresora de bodega que la reciba.
const LIMITES = { min: 10, maxAncho: 420, maxAlto: 600 };

const _num = (v, campo) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw { status: 400, message: `El formato a medida necesita ${campo}` };
  return n;
};

/**
 * Formato a medida. Existe porque las planchas que se consiguen no son siempre
 * las cinco de arriba, y quien ya compró un paquete raro no puede quedarse sin
 * poder imprimir. Se valida la geometría completa: una retícula que se sale de
 * la página imprime etiquetas cortadas por la mitad y desperdicia la plancha.
 */
const construirPersonalizado = (raw = {}) => {
  const medio = raw.medio === 'hoja' ? 'hoja' : 'rollo';

  const ancho = _num(raw.ancho, 'el ancho de la etiqueta');
  const alto  = _num(raw.alto,  'el alto de la etiqueta');
  if (ancho < LIMITES.min || alto < LIMITES.min) {
    throw { status: 400, message: `La etiqueta no puede medir menos de ${LIMITES.min} mm por lado` };
  }

  if (medio === 'rollo') {
    if (ancho > LIMITES.maxAncho || alto > LIMITES.maxAlto) {
      throw { status: 400, message: 'La etiqueta es más grande de lo que admite una impresora' };
    }
    return { ...rollo('personalizado', `Rollo · ${ancho} × ${alto} mm`, ancho, alto), personalizado: true };
  }

  const pagina     = raw.pagina?.ancho ? { ancho: _num(raw.pagina.ancho, 'el ancho de la página'), alto: _num(raw.pagina.alto, 'el alto de la página') } : A4;
  const columnas   = Math.max(1, Math.round(_num(raw.columnas ?? 1, 'las columnas')));
  const filas      = Math.max(1, Math.round(_num(raw.filas ?? 1, 'las filas')));
  const margen     = {
    arriba:     Number(raw.margen?.arriba)     || 0,
    izquierda:  Number(raw.margen?.izquierda)  || 0,
  };
  const separacion = {
    x: Number(raw.separacion?.x) || 0,
    y: Number(raw.separacion?.y) || 0,
  };

  const ocupaX = margen.izquierda + columnas * ancho + (columnas - 1) * separacion.x;
  const ocupaY = margen.arriba    + filas    * alto  + (filas    - 1) * separacion.y;
  if (ocupaX > pagina.ancho + 0.5 || ocupaY > pagina.alto + 0.5) {
    throw {
      status: 400,
      message: `Esa retícula no cabe en la página: necesita ${ocupaX.toFixed(1)} × ${ocupaY.toFixed(1)} mm `
        + `y la hoja mide ${pagina.ancho} × ${pagina.alto} mm.`,
    };
  }

  return {
    ...hoja('personalizado', `A medida · ${columnas} × ${filas} (${ancho} × ${alto} mm)`,
      pagina, columnas, filas, ancho, alto, margen, separacion),
    personalizado: true,
  };
};

/**
 * Resuelve el formato pedido. `personalizado` llega con su geometría en el
 * cuerpo; cualquier otro id sale del catálogo.
 */
const resolver = (id, personalizado) => {
  if (id === 'personalizado') return construirPersonalizado(personalizado);
  const f = POR_ID[id];
  if (!f) throw { status: 400, message: `Formato de etiqueta desconocido: ${id}` };
  return f;
};

module.exports = { FORMATOS, POR_ID, resolver, construirPersonalizado, MM, LIMITES };
