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
// ── UN SOLO MODELO PARA TODOS LOS PAPELES ────────────────────────────────────
// Toda hoja, rollo o tira se describe igual: una PÁGINA con una retícula de
// `columnas × filas` etiquetas, un margen hasta la primera y una separación
// entre ellas. Lo que cambia entre medios es de dónde sale la página:
//
//   · `hoja`  → plancha adhesiva en impresora de oficina. La página es el papel
//               (A4, Carta, Oficio…) y trae muchas filas.
//   · `rollo` → impresora de etiquetas (térmica) o de recibos. La página es UNA
//               FILA de la tira: tan ancha como el rollo y tan alta como la
//               etiqueta. La impresora avanza el rollo hasta la siguiente fila.
//
// Por qué la fila y no la etiqueta: un rollo de 3 columnas trae tres etiquetas
// lado a lado, y la impresora lo trata como UN papel de 104 mm de ancho. La
// versión anterior solo sabía hacer rollos de una columna (la página era la
// etiqueta) y el formato a medida no dejaba decir el ancho del rollo, los
// márgenes ni la separación: con una tira de 3 columnas no había forma de que
// las etiquetas cayeran sobre el troquel. Es el caso que se reportó.

const MM = 72 / 25.4;   // milímetros → puntos PDF

const PAPELES = {
  a4:     { id: 'a4',     nombre: 'A4',     ancho: 210,   alto: 297   },
  carta:  { id: 'carta',  nombre: 'Carta',  ancho: 215.9, alto: 279.4 },
  oficio: { id: 'oficio', nombre: 'Oficio', ancho: 215.9, alto: 330.2 },
  a5:     { id: 'a5',     nombre: 'A5',     ancho: 148,   alto: 210   },
};
const A4    = PAPELES.a4;
const CARTA = PAPELES.carta;

// Topes. No son gustos: por debajo de 10 mm por lado no cabe un símbolo legible
// ni con el código más corto; por encima de una A3 no hay impresora de bodega
// que la reciba; y 250 mm es más que el rollo más ancho de una térmica
// industrial (las de 4" imprimen 104–108 mm).
const LIMITES = {
  min: 10,                 // lado mínimo de la etiqueta
  maxEtiqueta: 300,        // lado máximo de la etiqueta
  maxAncho: 420,           // página de hoja
  maxAlto: 600,
  maxRollo: 250,           // ancho de un rollo
  maxColumnas: 12,
  maxFilas: 60,
  maxSeparacion: 50,
  maxMargen: 150,
  // A partir de este ancho de rollo se avisa: las térmicas de 4 pulgadas, que
  // son casi todas, no imprimen más allá. Lo que caiga fuera no sale.
  anchoTermica4: 108,
};

const _redondeo = (n) => Math.round(n * 100) / 100;
const _fmt = (n) => String(_redondeo(n)).replace('.', ',');

/**
 * Formato de plancha. Los valores son los de las referencias que se consiguen
 * en papelería; `separacion` es el espacio en blanco ENTRE etiquetas (muchas
 * planchas van pegadas y va en 0).
 */
const hoja = (id, nombre, papel, columnas, filas, ancho, alto, margen, separacion = { x: 0, y: 0 }) => ({
  id, nombre, medio: 'hoja', papel: papel.id,
  pagina: { ancho: papel.ancho, alto: papel.alto },
  columnas, filas,
  etiqueta: { ancho, alto },
  margen, separacion,
  porHoja: columnas * filas,
});

/**
 * Formato de rollo. La página es UNA fila de la tira: su ancho es el del rollo
 * y su alto el de la etiqueta. Las columnas se centran sobre el rollo, que es
 * como vienen troqueladas casi todas las tiras.
 *
 * `separacionY` es el hueco entre filas (el «gap» que la impresora detecta con
 * su sensor). Con una fila por página no mueve nada: se guarda para el
 * diagrama y para cuando la impresora NO detecta el hueco (papel continuo),
 * donde sí se suma al alto de la página.
 */
const rollo = (id, nombre, {
  ancho, alto, columnas = 1, separacionX = 0, separacionY = 0,
  anchoRollo = null, continuo = false,
}) => {
  const reticula = columnas * ancho + (columnas - 1) * separacionX;
  const anchoPagina = anchoRollo ?? reticula;
  return {
    id, nombre, medio: 'rollo',
    pagina: { ancho: anchoPagina, alto: alto + (continuo ? separacionY : 0) },
    columnas, filas: 1,
    etiqueta: { ancho, alto },
    margen: { arriba: 0, izquierda: _redondeo((anchoPagina - reticula) / 2) },
    separacion: { x: separacionX, y: separacionY },
    rollo: { ancho: anchoPagina, filasPorPagina: 1, incluirSeparacion: continuo },
    porHoja: columnas,
  };
};

const FORMATOS = [
  // ── Rollo de 1 columna (impresora de etiquetas) ─────────────────────────────
  rollo('rollo-50x25',  'Rollo · 50 × 25 mm',  { ancho: 50, alto: 25 }),
  rollo('rollo-40x30',  'Rollo · 40 × 30 mm',  { ancho: 40, alto: 30 }),
  rollo('rollo-38x25',  'Rollo · 38 × 25 mm',  { ancho: 38, alto: 25 }),
  rollo('rollo-32x25',  'Rollo · 32 × 25 mm',  { ancho: 32, alto: 25 }),
  rollo('rollo-60x40',  'Rollo · 60 × 40 mm',  { ancho: 60, alto: 40 }),
  rollo('rollo-100x50', 'Rollo · 100 × 50 mm', { ancho: 100, alto: 50 }),

  // ── Rollo de VARIAS columnas (tiras de 2 y 3 etiquetas por fila) ────────────
  // Medidas típicas de lo que se vende en el país: el ancho del rollo y el
  // hueco entre columnas cambian de un proveedor a otro, así que son un punto
  // de partida — el editor a medida parte de ellos para ajustar.
  rollo('rollo2-50x25', 'Rollo 2 columnas · 50 × 25 mm', { ancho: 50, alto: 25, columnas: 2, separacionX: 2, separacionY: 3, anchoRollo: 104 }),
  rollo('rollo2-40x30', 'Rollo 2 columnas · 40 × 30 mm', { ancho: 40, alto: 30, columnas: 2, separacionX: 2, separacionY: 3, anchoRollo: 84 }),
  rollo('rollo3-32x25', 'Rollo 3 columnas · 32 × 25 mm', { ancho: 32, alto: 25, columnas: 3, separacionX: 2, separacionY: 3, anchoRollo: 104 }),
  rollo('rollo3-30x20', 'Rollo 3 columnas · 30 × 20 mm', { ancho: 30, alto: 20, columnas: 3, separacionX: 3, separacionY: 3, anchoRollo: 100 }),

  // ── Papel continuo de recibo (impresora POS) ────────────────────────────────
  // La impresora de recibos del mostrador también imprime etiquetas —en papel
  // sin troquel, para recortar—. No detecta huecos, así que cada página lleva
  // la separación incluida. El ancho útil de un rollo de 80 mm es 72 mm, y el
  // de uno de 58 mm, 48.
  rollo('recibo-80', 'Papel de recibo 80 mm · 72 × 30 mm', { ancho: 72, alto: 30, separacionY: 3, anchoRollo: 80, continuo: true }),
  rollo('recibo-58', 'Papel de recibo 58 mm · 48 × 25 mm', { ancho: 48, alto: 25, separacionY: 3, anchoRollo: 58, continuo: true }),

  // ── Planchas adhesivas (impresora normal) ───────────────────────────────────
  hoja('a4-5x13', 'A4 · 65 etiquetas (38 × 21 mm)', A4, 5, 13, 38.1, 21.2,
    { arriba: 10.7, izquierda: 4.75 }, { x: 2.5, y: 0 }),
  hoja('a4-4x10', 'A4 · 40 etiquetas (52 × 30 mm)', A4, 4, 10, 52.5, 29.7,
    { arriba: 0, izquierda: 0 }),
  // 37 mm exactos, no 37,1: ocho filas de 37,1 suman 296,8 y con cualquier
  // margen superior se salen de los 297 de una A4. La prueba lo caza.
  hoja('a4-3x8',  'A4 · 24 etiquetas (70 × 37 mm)', A4, 3, 8, 70, 37,
    { arriba: 0.5, izquierda: 0 }),
  hoja('a4-3x7',  'A4 · 21 etiquetas (63,5 × 38,1 mm)', A4, 3, 7, 63.5, 38.1,
    { arriba: 15.15, izquierda: 7.21 }, { x: 2.54, y: 0 }),
  hoja('a4-2x7',  'A4 · 14 etiquetas (99 × 38 mm)', A4, 2, 7, 99.1, 38.1,
    { arriba: 15.15, izquierda: 5.9 }, { x: 0, y: 0 }),
  hoja('carta-3x10', 'Carta · 30 etiquetas (66 × 25 mm)', CARTA, 3, 10, 66.7, 25.4,
    { arriba: 12.7, izquierda: 4.8 }, { x: 3.0, y: 0 }),
  hoja('carta-2x10', 'Carta · 20 etiquetas (101,6 × 25,4 mm)', CARTA, 2, 10, 101.6, 25.4,
    { arriba: 12.7, izquierda: 3.97 }, { x: 4.76, y: 0 }),
  hoja('carta-2x5',  'Carta · 10 etiquetas (101,6 × 50,8 mm)', CARTA, 2, 5, 101.6, 50.8,
    { arriba: 12.7, izquierda: 3.97 }, { x: 4.76, y: 0 }),
];

const POR_ID = Object.fromEntries(FORMATOS.map((f) => [f.id, f]));

// ─────────────────────────────────────────────────────────────────────────────
// Formato a medida
// ─────────────────────────────────────────────────────────────────────────────

const _vacio = (v) => v === undefined || v === null || v === '';

const _num = (v, campo, { min = -Infinity, max = Infinity } = {}) => {
  const n = Number(v);
  if (_vacio(v) || !Number.isFinite(n)) throw { status: 400, message: `El formato a medida necesita ${campo}` };
  if (n < min) throw { status: 400, message: `${campo[0].toUpperCase()}${campo.slice(1)} no puede ser menor que ${_fmt(min)}` };
  if (n > max) throw { status: 400, message: `${campo[0].toUpperCase()}${campo.slice(1)} no puede ser mayor que ${_fmt(max)}` };
  return n;
};

const _entero = (v, campo, min, max) => Math.round(_num(v, campo, { min, max }));

const _opcional = (v, campo, rango) => (_vacio(v) ? null : _num(v, campo, rango));

/**
 * Formato a medida. Existe porque las planchas y los rollos que se consiguen no
 * son siempre los del catálogo, y quien ya compró un paquete raro no puede
 * quedarse sin poder imprimir.
 *
 * Se valida la geometría completa y con las medidas en el mensaje: una
 * retícula que se sale de la página imprime etiquetas cortadas por la mitad y
 * desperdicia la plancha, y "formato inválido" no le dice a nadie qué medir.
 *
 * Los márgenes que no se escriben se CENTRAN: es como vienen troquelados casi
 * todos los rollos y la mayoría de planchas, y es la mejor apuesta cuando el
 * usuario no sabe cuánto medir.
 *
 * @param {object} raw
 * @param {'hoja'|'rollo'} raw.medio
 * @param {number} raw.ancho  ancho de UNA etiqueta
 * @param {number} raw.alto   alto de UNA etiqueta
 * @param {number} [raw.columnas=1]
 * @param {{x?:number, y?:number}} [raw.separacion]  hueco entre columnas / filas
 * @param {{izquierda?:number, arriba?:number}} [raw.margen] vacío = centrado
 * rollo: `anchoRollo`, `filasPorPagina` (1 = una fila por página),
 *        `incluirSeparacion` (la impresora NO detecta el hueco entre filas)
 * hoja:  `papel` ('a4'|'carta'|'oficio'|'a5'|'personalizado'), `pagina`, `filas`
 */
const construirPersonalizado = (raw = {}) => {
  const medio = raw.medio === 'hoja' ? 'hoja' : 'rollo';

  const ancho = Number(raw.ancho);
  const alto  = Number(raw.alto);
  if (_vacio(raw.ancho) || !Number.isFinite(ancho)) throw { status: 400, message: 'El formato a medida necesita el ancho de la etiqueta' };
  if (_vacio(raw.alto)  || !Number.isFinite(alto))  throw { status: 400, message: 'El formato a medida necesita el alto de la etiqueta' };
  if (ancho < LIMITES.min || alto < LIMITES.min) {
    throw { status: 400, message: `La etiqueta no puede medir menos de ${LIMITES.min} mm por lado` };
  }
  if (ancho > LIMITES.maxEtiqueta || alto > LIMITES.maxEtiqueta) {
    throw { status: 400, message: 'La etiqueta es más grande de lo que admite una impresora' };
  }

  const columnas = _entero(raw.columnas ?? 1, 'las columnas', 1, LIMITES.maxColumnas);
  const sepX = columnas > 1
    ? _num(raw.separacion?.x ?? 0, 'la separación entre columnas', { min: 0, max: LIMITES.maxSeparacion })
    : 0;
  const sepY = _num(raw.separacion?.y ?? 0, 'la separación entre filas', { min: 0, max: LIMITES.maxSeparacion });
  const reticulaX = columnas * ancho + (columnas - 1) * sepX;
  const sufijoCol = columnas > 1 ? ` ${columnas} columnas` : '';

  if (medio === 'rollo') {
    const filasPorPagina    = _entero(raw.filasPorPagina ?? 1, 'las filas por página', 1, LIMITES.maxFilas);
    const incluirSeparacion = raw.incluirSeparacion === true;
    const anchoRollo = _opcional(raw.anchoRollo, 'el ancho del rollo', { min: LIMITES.min, max: LIMITES.maxRollo });
    const margenIzq  = _opcional(raw.margen?.izquierda, 'el margen izquierdo', { min: 0, max: LIMITES.maxMargen });

    // Sin ancho de rollo, el rollo es la retícula más el margen a cada lado.
    const anchoPagina = anchoRollo ?? (reticulaX + 2 * (margenIzq ?? 0));
    const izquierda   = margenIzq ?? (anchoPagina - reticulaX) / 2;

    if (izquierda < -0.01 || izquierda + reticulaX > anchoPagina + 0.5) {
      throw {
        status: 400,
        message: `Las etiquetas no caben en el rollo: ${columnas} de ${_fmt(ancho)} mm`
          + (columnas > 1 ? ` con ${_fmt(sepX)} mm entre ellas` : '')
          + ` ocupan ${_fmt(Math.max(0, margenIzq ?? 0) + reticulaX)} mm y el rollo mide ${_fmt(anchoPagina)} mm.`,
      };
    }
    if (anchoPagina > LIMITES.maxRollo) {
      throw { status: 400, message: `Un rollo de ${_fmt(anchoPagina)} mm es más ancho de lo que admite una impresora de etiquetas` };
    }
    const altoPagina = filasPorPagina * alto + (filasPorPagina - 1) * sepY + (incluirSeparacion ? sepY : 0);
    if (altoPagina > LIMITES.maxAlto) {
      throw { status: 400, message: `Tantas filas por página suman ${_fmt(altoPagina)} mm de papel: reduce las filas por página.` };
    }

    return {
      id: 'personalizado', personalizado: true, medio: 'rollo',
      nombre: `Rollo${sufijoCol} · ${_fmt(ancho)} × ${_fmt(alto)} mm (a medida)`,
      pagina: { ancho: _redondeo(anchoPagina), alto: _redondeo(altoPagina) },
      columnas, filas: filasPorPagina,
      etiqueta: { ancho, alto },
      margen: { arriba: 0, izquierda: _redondeo(Math.max(0, izquierda)) },
      separacion: { x: sepX, y: sepY },
      rollo: { ancho: _redondeo(anchoPagina), filasPorPagina, incluirSeparacion },
      porHoja: columnas * filasPorPagina,
    };
  }

  // ── Hoja ────────────────────────────────────────────────────────────────────
  const papelId = PAPELES[raw.papel] ? raw.papel
    : (raw.papel === 'personalizado' || raw.pagina?.ancho ? 'personalizado' : 'a4');
  const pagina = papelId === 'personalizado'
    ? {
        ancho: _num(raw.pagina?.ancho, 'el ancho de la página', { min: LIMITES.min, max: LIMITES.maxAncho }),
        alto:  _num(raw.pagina?.alto,  'el alto de la página',  { min: LIMITES.min, max: LIMITES.maxAlto }),
      }
    : { ancho: PAPELES[papelId].ancho, alto: PAPELES[papelId].alto };

  const filas = _entero(raw.filas ?? 1, 'las filas', 1, LIMITES.maxFilas);
  const reticulaY = filas * alto + (filas - 1) * sepY;
  const margenIzq = _opcional(raw.margen?.izquierda, 'el margen izquierdo', { min: 0, max: LIMITES.maxMargen });
  const margenSup = _opcional(raw.margen?.arriba,    'el margen superior',  { min: 0, max: LIMITES.maxMargen });
  const izquierda = margenIzq ?? (pagina.ancho - reticulaX) / 2;
  const arriba    = margenSup ?? (pagina.alto  - reticulaY) / 2;

  const ocupaX = Math.max(0, margenIzq ?? 0) + reticulaX;
  const ocupaY = Math.max(0, margenSup ?? 0) + reticulaY;
  if (izquierda < -0.01 || arriba < -0.01
      || izquierda + reticulaX > pagina.ancho + 0.5 || arriba + reticulaY > pagina.alto + 0.5) {
    throw {
      status: 400,
      message: `Esa retícula no cabe en la página: necesita ${_fmt(ocupaX)} × ${_fmt(ocupaY)} mm `
        + `y la hoja mide ${_fmt(pagina.ancho)} × ${_fmt(pagina.alto)} mm.`,
    };
  }

  const nombrePapel = papelId === 'personalizado'
    ? `${_fmt(pagina.ancho)} × ${_fmt(pagina.alto)} mm`
    : PAPELES[papelId].nombre;
  return {
    id: 'personalizado', personalizado: true, medio: 'hoja', papel: papelId,
    nombre: `${nombrePapel} · ${columnas * filas} etiquetas (${_fmt(ancho)} × ${_fmt(alto)} mm, a medida)`,
    pagina,
    columnas, filas,
    etiqueta: { ancho, alto },
    margen: { arriba: _redondeo(arriba), izquierda: _redondeo(izquierda) },
    separacion: { x: sepX, y: sepY },
    porHoja: columnas * filas,
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

/**
 * Lo que la pantalla necesita para pintar el selector y el editor sin llevar
 * su propia copia de nada: los formatos, los papeles y los topes.
 */
const catalogo = () => ({ formatos: FORMATOS, papeles: Object.values(PAPELES), limites: LIMITES });

module.exports = {
  FORMATOS, POR_ID, PAPELES, LIMITES, MM,
  resolver, construirPersonalizado, catalogo,
};
