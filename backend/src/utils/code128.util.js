// ── Code 128: del texto a los anchos de barra ────────────────────────────────
//
// Devuelve el símbolo como una lista de ANCHOS EN MÓDULOS, no como imagen. Lo
// dibuja quien lo pide (`etiquetas.pdf.js` pinta un rectángulo por barra), y eso
// no es un detalle: una etiqueta impresa desde un PNG lleva los bordes de las
// barras al píxel más cercano, y a 20 mm de ancho ese redondeo es justo el
// margen que un lector láser necesita para distinguir una barra fina de una
// gruesa. Dibujadas como vectores, los bordes salen exactos a cualquier tamaño
// y en cualquier impresora.
//
// Por qué escrito a mano y no una librería: el algoritmo cabe en este archivo,
// no tiene dependencias, y —esto es lo que importa— se puede DECODIFICAR de
// vuelta en la prueba. Un código de barras mal generado no se ve mal: se ve
// perfecto y no escanea, o peor, escanea otra cosa. La prueba `35-etiquetas`
// decodifica lo que genera esta función y compara contra el texto original.
//
// Se implementan los juegos B y C. El A (caracteres de control) no hace falta:
// `normalizarCodigo` ya deja los códigos en mayúsculas y sin espacios.

// ─────────────────────────────────────────────────────────────────────────────
// Tabla del estándar (ISO/IEC 15417). Cada valor son 6 anchos —barra, espacio,
// barra, espacio, barra, espacio— que suman 11 módulos. El 106 (STOP) es la
// excepción: 7 anchos, 13 módulos.
// ─────────────────────────────────────────────────────────────────────────────
const PATRONES = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
];

const START_B = 104;
const START_C = 105;
const CODE_B  = 100;   // desde C, cambiar a B
const CODE_C  = 99;    // desde B, cambiar a C
const STOP    = 106;

const esDigito = (c) => c >= '0' && c <= '9';

/** Cuántos dígitos seguidos hay a partir de `i`. */
const corridaDigitos = (texto, i) => {
  let n = 0;
  while (i + n < texto.length && esDigito(texto[i + n])) n += 1;
  return n;
};

/**
 * ¿Se puede imprimir este texto como Code 128?
 *
 * El juego B cubre ASCII 32–126. Un código con eñe o tilde no es representable
 * —y no hay forma de "aproximarlo": lo que se imprimiera escanearía distinto de
 * lo que está en la base—. Quien llama lo reporta y ofrece QR, que sí es UTF-8.
 */
const esImprimible = (texto) => {
  if (typeof texto !== 'string' || !texto.length) return false;
  for (const ch of texto) {
    const cc = ch.charCodeAt(0);
    if (cc < 32 || cc > 126) return false;
  }
  return true;
};

/**
 * Texto → valores del símbolo (sin dígito de control ni STOP).
 *
 * Alterna entre el juego B (un símbolo por carácter) y el C (un símbolo por
 * PAREJA de dígitos). No es cosmético: un código de 8 dígitos ocupa 90 módulos
 * en B y 57 en C. En una etiqueta de 38 mm eso es la diferencia entre una barra
 * fina de 0,22 mm —por debajo de lo que un lector láser resuelve con fiabilidad—
 * y una de 0,35 mm.
 *
 * El cambio se decide contando símbolos, que es lo único que determina el ancho:
 *   · en C cada pareja cuesta 1 símbolo, y volver a B cuesta 1 más;
 *   · a mitad de texto C gana desde 6 dígitos seguidos, y al final desde 4
 *     (porque ahí no hay que pagar el regreso a B).
 * Una corrida impar gasta su primer dígito en B para entrar a C con paridad par.
 */
const valores = (texto) => {
  if (!esImprimible(texto)) {
    throw {
      status: 400,
      message: `El código "${texto}" tiene caracteres que un código de barras no puede representar. Usa QR.`,
    };
  }

  const out = [];
  const len = texto.length;
  let i = 0;

  // Arranque. El símbolo de inicio se paga igual sea B o C, así que entrar
  // directo en C conviene desde 4 dígitos pares (con 2 empatan, y no vale la pena).
  const inicial = corridaDigitos(texto, 0);
  const todoDigitos = inicial === len && len >= 2 && len % 2 === 0;
  let modo = (todoDigitos || (inicial >= 4 && inicial % 2 === 0)) ? 'C' : 'B';
  out.push(modo === 'C' ? START_C : START_B);

  while (i < len) {
    if (modo === 'C') {
      const corrida = corridaDigitos(texto, i);
      for (let p = 0; p < Math.floor(corrida / 2); p += 1) {
        out.push(Number(texto.slice(i, i + 2)));
        i += 2;
      }
      // Queda un dígito suelto o un carácter no numérico: en C no cabe ninguno.
      if (i < len) { out.push(CODE_B); modo = 'B'; }
      continue;
    }

    const corrida = corridaDigitos(texto, i);
    const pares   = corrida % 2 === 1 ? corrida - 1 : corrida;
    const alFinal = i + corrida === len;

    if (pares >= (alFinal ? 4 : 6)) {
      if (corrida % 2 === 1) { out.push(texto.charCodeAt(i) - 32); i += 1; }
      out.push(CODE_C);
      modo = 'C';
      continue;
    }

    out.push(texto.charCodeAt(i) - 32);
    i += 1;
  }

  return out;
};

/**
 * Símbolo completo: anchos alternados empezando por BARRA.
 *
 * @returns {{ barras: number[], modulos: number, simbolos: number }}
 *   `barras[k]` es el ancho en módulos del k-ésimo elemento; los índices pares
 *   son barra y los impares espacio. `modulos` es el ancho total, que es lo que
 *   necesita quien dibuja para escalar el símbolo a la etiqueta.
 */
const codificar = (texto) => {
  const vals = valores(texto);

  // Dígito de control: (inicio + Σ posición × valor) mod 103. La posición del
  // primer dato es 1; el símbolo de inicio pesa una vez y ya está en vals[0].
  let suma = vals[0];
  for (let k = 1; k < vals.length; k += 1) suma += k * vals[k];
  vals.push(suma % 103);
  vals.push(STOP);

  const barras = [];
  for (const v of vals) for (const ch of PATRONES[v]) barras.push(Number(ch));

  return {
    barras,
    modulos:  barras.reduce((a, b) => a + b, 0),
    simbolos: vals.length,
  };
};

module.exports = {
  codificar, esImprimible, PATRONES,
  START_B, START_C, CODE_B, CODE_C, STOP,
};
