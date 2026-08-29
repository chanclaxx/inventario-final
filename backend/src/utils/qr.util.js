// ── QR: del texto a la matriz de módulos ─────────────────────────────────────
//
// Mismo criterio que `code128.util.js`: devuelve la MATRIZ, no una imagen. El
// que dibuja pinta un cuadrito por módulo oscuro, así que el QR sale vectorial y
// sus bordes caen exactos a cualquier tamaño. Un QR rasterizado y reescalado a
// 12 mm pierde justo el contraste de borde que la cámara necesita.
//
// La única dependencia es `qrcode-generator`: cero dependencias propias, es la
// implementación canónica de Kazuhiko Arase y expone lo que hace falta
// (`isDark(fila, columna)`). Las alternativas traen un árbol entero de paquetes
// para acabar dando un PNG que aquí no sirve.
//
// QUÉ VA DENTRO DEL QR: el código pelado, nada más. No una URL, no un JSON.
// El lector de la bodega es un teclado —teclea lo que lee y pulsa Enter— y ese
// texto cae en `BarraEscaneo`, que lo resuelve con `GET /busqueda/escaneo/:codigo`
// contra los tres niveles del árbol y contra los IMEI. Meter una URL rompería
// ese camino (el lector escribiría "https://..." en el buscador) y obligaría a
// mantener una segunda vía de resolución. Con el código pelado, un lector 2D,
// un lector láser sobre el código de barras y la cámara de un celular acaban
// todos en el mismo sitio.

const qrcode = require('qrcode-generator');

// El nivel de corrección de errores M (15 %) es el equilibrio de siempre para
// etiquetas: subir a Q añade módulos, y en una etiqueta de 25 mm cada módulo
// extra encoge los demás más de lo que la redundancia compensa.
const NIVEL = 'M';

const SOLO_NUMEROS      = /^[0-9]+$/;
const ALFANUMERICO_QR   = /^[0-9A-Z $%*+\-./:]+$/;

/**
 * El modo más compacto que representa el texto.
 *
 * No es un detalle de eficiencia: un código numérico en modo Byte necesita más
 * módulos, y más módulos en la misma etiqueta significa módulos más pequeños.
 */
const _modo = (texto) => {
  if (SOLO_NUMEROS.test(texto))    return 'Numeric';
  if (ALFANUMERICO_QR.test(texto)) return 'Alphanumeric';
  return 'Byte';
};

/**
 * Texto → matriz booleana cuadrada (`true` = módulo oscuro).
 *
 * @returns {{ matriz: boolean[][], lado: number }} `lado` es el número de
 *   módulos por costado, que es lo que necesita quien dibuja para escalar.
 */
const codificar = (texto) => {
  const limpio = String(texto ?? '');
  if (!limpio) throw { status: 400, message: 'No hay nada que codificar en el QR' };

  const modo = _modo(limpio);

  // Byte es el único modo que codifica bytes crudos, así que es el único que
  // necesita saber que el texto es UTF-8. La bandera es GLOBAL en la librería:
  // se pone en cada llamada, nunca una sola vez al cargar el módulo, porque
  // otro punto del proceso podría cambiarla.
  qrcode.stringToBytes = modo === 'Byte'
    ? qrcode.stringToBytesFuncs['UTF-8']
    : qrcode.stringToBytesFuncs.default;

  const qr = qrcode(0, NIVEL);   // 0 = elige la versión más pequeña que sirva
  qr.addData(limpio, modo);
  qr.make();

  const lado   = qr.getModuleCount();
  const matriz = [];
  for (let f = 0; f < lado; f += 1) {
    const fila = [];
    for (let c = 0; c < lado; c += 1) fila.push(qr.isDark(f, c));
    matriz.push(fila);
  }

  return { matriz, lado };
};

module.exports = { codificar, NIVEL };
