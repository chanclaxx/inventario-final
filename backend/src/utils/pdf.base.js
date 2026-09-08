'use strict';

/**
 * BASE GRÁFICA COMPARTIDA DE TODOS LOS DOCUMENTOS PDF.
 *
 * Paleta, tipografía, medidas y primitivas de dibujo. Estaban copiadas en
 * facturas.pdf.js, prestamos.pdf.service.js y estadoCuenta.pdf.js; al vivir en
 * un solo sitio, un cambio de línea gráfica se refleja en todos los documentos.
 */

// ─── Medidas A4 ───────────────────────────────────────────────────────────────

const PAGE_W    = 595.28;
const PAGE_H    = 841.89;
const MARGIN    = 52;
const CONTENT_W = PAGE_W - MARGIN * 2;

// Última coordenada donde puede dibujarse contenido. Debajo va el pie con la
// paginación (la línea vive en PAGE_H - 44), así que nada del cuerpo puede
// invadir esa franja.
const BODY_BOTTOM = PAGE_H - 58;

const FONT = { normal: 'Helvetica', bold: 'Helvetica-Bold' };

// ─── Paleta ───────────────────────────────────────────────────────────────────

const C = {
  headerBg:     '#111827',
  headerText:   '#FFFFFF',
  headerSub:    '#9CA3AF',

  negro:        '#111827',
  grisOscuro:   '#374151',
  gris:         '#6B7280',
  grisClaro:    '#9CA3AF',
  grisFondo:    '#F9FAFB',
  grisBorde:    '#E5E7EB',
  blanco:       '#FFFFFF',
  filaAlterna:  '#F8FAFC',

  acento:       '#111827',
  acentoLine:   '#D1D5DB',

  verde:        '#059669',
  verdeFondo:   '#ECFDF5',
  verdeBorde:   '#A7F3D0',
  rojo:         '#DC2626',
  rojoFondo:    '#FEF2F2',
  rojoBorde:    '#FECACA',
  naranja:      '#D97706',
  naranjaFondo: '#FFFBEB',
  naranjaBorde: '#FDE68A',
  azul:         '#2563EB',
  azulFondo:    '#EFF6FF',
  azulBorde:    '#BFDBFE',
  morado:       '#7C3AED',
  moradoFondo:  '#F5F3FF',
  moradoBorde:  '#DDD6FE',
};

/** Traduce el tono de un estado de obligación a colores concretos. */
const TONOS = {
  verde:   { fg: C.verde,      bg: C.verdeFondo,   borde: C.verdeBorde   },
  rojo:    { fg: C.rojo,       bg: C.rojoFondo,    borde: C.rojoBorde    },
  naranja: { fg: C.naranja,    bg: C.naranjaFondo, borde: C.naranjaBorde },
  azul:    { fg: C.azul,       bg: C.azulFondo,    borde: C.azulBorde    },
  gris:    { fg: C.gris,       bg: C.grisFondo,    borde: C.grisBorde    },
};

// ─── Formato ──────────────────────────────────────────────────────────────────

const formatCOP = (valor) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(Number(valor || 0));

const formatFecha = (fecha) => {
  if (!fecha) return '—';
  return new Date(fecha).toLocaleDateString('es-CO', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Bogota',
  });
};

const formatFechaHora = (fecha) => {
  if (!fecha) return '—';
  return new Date(fecha).toLocaleString('es-CO', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota',
  });
};

// ─── Primitivas de dibujo ─────────────────────────────────────────────────────

const rectFill = (doc, x, y, w, h, color, radius = 6) =>
  doc.roundedRect(x, y, w, h, radius).fill(color);

const rectStroke = (doc, x, y, w, h, color, radius = 6, lineWidth = 0.75) =>
  doc.roundedRect(x, y, w, h, radius).strokeColor(color).lineWidth(lineWidth).stroke();

const rectFillStroke = (doc, x, y, w, h, fillColor, strokeColor, radius = 6, lineWidth = 0.75) => {
  doc.roundedRect(x, y, w, h, radius).fillAndStroke(fillColor, strokeColor);
  doc.lineWidth(lineWidth);
};

const hLine = (doc, y, { x1 = MARGIN, x2 = PAGE_W - MARGIN, color = C.grisBorde, width = 0.5 } = {}) =>
  doc.moveTo(x1, y).lineTo(x2, y).strokeColor(color).lineWidth(width).stroke();

/**
 * Etiqueta pequeña de sección (CLIENTE, PRODUCTOS…).
 *
 * `reservar` es el alto de lo que va DEBAJO de la etiqueta. Sin él, un título
 * que cae justo al final de la página se queda huérfano: se imprime abajo y su
 * contenido arranca en la página siguiente.
 */
const labelSeccion = (doc, y, texto, { reservar = 0, fondo = BODY_BOTTOM } = {}) => {
  if (reservar > 0) y = asegurarEspacio(doc, y, 14 + reservar, { fondo });
  doc.font(FONT.bold).fontSize(7).fillColor(C.grisClaro)
    .text(String(texto).toUpperCase(), MARGIN, y, {
      characterSpacing: 1.2, width: CONTENT_W, height: 12, lineBreak: false,
    });
  return y + 14;
};

/** Fila etiqueta → valor, alineada a los bordes del contenido. */
const fila = (doc, y, label, valor, {
  labelColor = C.gris, valorColor = C.negro,
  labelFont = FONT.normal, valorFont = FONT.normal,
  labelSize = 8.5, valorSize = 8.5,
  x = MARGIN, w = CONTENT_W, paddingLeft = 0, alto = 16,
} = {}) => {
  // `height` fija el alto y con eso PDFKit deja de poder abrir una página nueva
  // por su cuenta: una fila que caiga al filo del papel se recorta, no se lleva
  // una hoja entera para ella sola.
  doc.font(labelFont).fontSize(labelSize).fillColor(labelColor)
    .text(label, x + paddingLeft, y,
      { width: w * 0.52, lineBreak: false, height: alto, ellipsis: true });
  doc.font(valorFont).fontSize(valorSize).fillColor(valorColor)
    .text(valor, x + w * 0.52, y,
      { width: w * 0.48 - paddingLeft, align: 'right', lineBreak: false, height: alto, ellipsis: true });
  return y + alto;
};

/** Texto de una línea que se encoge hasta caber en `maxW`. */
const textoUnaLinea = (doc, texto, x, y, maxW, {
  max = 22, min = 10, font = FONT.bold, color = C.headerText,
} = {}) => {
  doc.font(font);
  let size = max;
  while (size > min && doc.fontSize(size).widthOfString(texto) > maxW) size -= 0.5;
  doc.fontSize(size);

  let salida = texto;
  if (doc.widthOfString(salida) > maxW) {
    while (salida.length > 1 && doc.widthOfString(`${salida.trimEnd()}…`) > maxW) {
      salida = salida.slice(0, -1);
    }
    salida = `${salida.trimEnd()}…`;
  }
  doc.fillColor(color).text(salida, x, y, { width: maxW, lineBreak: false });
  return size;
};

/** Logo del negocio dentro del encabezado oscuro. Devuelve el ancho ocupado. */
const dibujarLogo = (doc, logoRaw, headerH, { max = 60 } = {}) => {
  if (!logoRaw) return 0;
  try {
    const base64 = String(logoRaw).replace(/^data:image\/[a-z+]+;base64,/, '');
    const buf = Buffer.from(base64, 'base64');
    if (!buf.length) return 0;
    doc.image(buf, MARGIN, Math.round((headerH - max) / 2), {
      fit: [max, max], align: 'center', valign: 'center',
    });
    return max + 10;
  } catch {
    return 0;
  }
};

/**
 * Encabezado estándar: fondo oscuro, datos del negocio a la izquierda, título y
 * número del documento a la derecha, y una franja de color según el estado.
 *
 * @returns {number} y donde empieza el cuerpo
 */
const encabezado = (doc, {
  config, titulo, numero, subtitulo, franja = C.verde, logo = null, headerH = 110,
}) => {
  rectFill(doc, 0, 0, PAGE_W, headerH, C.headerBg, 0);
  doc.rect(0, headerH - 3, PAGE_W, 3).fill(franja);

  const logoOffset = dibujarLogo(doc, logo ?? config?.logo_negocio, headerH);

  const leftX  = MARGIN + logoOffset;
  const leftW  = MARGIN + CONTENT_W * 0.58 - leftX;
  const rightX = MARGIN + CONTENT_W * 0.60;
  const rightW = PAGE_W - rightX - MARGIN;

  textoUnaLinea(doc, config?.nombre_negocio || 'MI TIENDA', leftX, 26, leftW);

  let yInfo = 54;
  for (const linea of [
    config?.nit       ? `NIT: ${config.nit}`      : null,
    config?.direccion || null,
    config?.telefono  ? `Tel: ${config.telefono}` : null,
  ].filter(Boolean)) {
    doc.font(FONT.normal).fontSize(8).fillColor(C.headerSub)
      .text(linea, leftX, yInfo, { width: leftW, lineBreak: false, ellipsis: true });
    yInfo += 12;
  }

  if (numero) {
    doc.font(FONT.bold).fontSize(24).fillColor(C.headerText)
      .text(numero, rightX, 22, { width: rightW, align: 'right' });
  }
  doc.font(FONT.bold).fontSize(8.5).fillColor(C.headerText)
    .text(String(titulo).toUpperCase(), rightX, numero ? 52 : 34,
      { width: rightW, align: 'right', characterSpacing: 0.8 });
  if (subtitulo) {
    doc.font(FONT.normal).fontSize(8).fillColor(C.headerSub)
      .text(subtitulo, rightX, numero ? 66 : 48, { width: rightW, align: 'right' });
  }

  return headerH;
};

/** Sello/badge de estado, alineado a la derecha. */
const badgeEstado = (doc, texto, tono, x, y, { w = 92, h = 20 } = {}) => {
  const t = TONOS[tono] || TONOS.gris;
  rectFillStroke(doc, x, y, w, h, t.bg, t.borde, 5);
  doc.font(FONT.bold).fontSize(7.5).fillColor(t.fg)
    .text(String(texto).toUpperCase(), x, y + 6.5, { width: w, align: 'center', characterSpacing: 0.8 });
  return y + h;
};

/** Línea de firma centrada, con identificación de quien firma. */
const bloqueFirma = (doc, y, { titulo = 'Firma del cliente', identificacion = null, ancho = 180 } = {}) => {
  const cx = PAGE_W / 2;
  doc.moveTo(cx - ancho / 2, y).lineTo(cx + ancho / 2, y)
    .strokeColor(C.grisBorde).lineWidth(0.75).stroke();

  doc.font(FONT.bold).fontSize(8).fillColor(C.negro)
    .text(titulo, MARGIN, y + 6, { width: CONTENT_W, align: 'center' });

  if (identificacion) {
    doc.font(FONT.normal).fontSize(7.5).fillColor(C.grisClaro)
      .text(identificacion, MARGIN, y + 18, { width: CONTENT_W, align: 'center' });
    return y + 34;
  }
  return y + 22;
};

/**
 * Pie con paginación, aplicado a todas las páginas del buffer.
 *
 * `soloSiVarias` deja fuera el "Página 1 de 1" de un documento de una sola
 * hoja: ahí el número no informa de nada. En cuanto hay dos o más, saber si
 * falta una hoja es exactamente lo que hace falta al imprimir.
 */
const pieDocumento = (doc, { texto = '', soloSiVarias = false } = {}) => {
  const total = doc.bufferedPageRange().count;
  const numerar = !soloSiVarias || total > 1;
  for (let i = 0; i < total; i++) {
    doc.switchToPage(i);
    hLine(doc, PAGE_H - 44, { color: C.grisBorde });
    if (texto) {
      doc.font(FONT.normal).fontSize(7).fillColor(C.grisClaro)
        .text(texto, MARGIN, PAGE_H - 38,
          { width: CONTENT_W * 0.7, align: 'left', height: 10, ellipsis: true });
    }
    if (numerar) {
      doc.font(FONT.normal).fontSize(7).fillColor(C.grisClaro)
        .text(`Página ${i + 1} de ${total}`, MARGIN, PAGE_H - 38,
          { width: CONTENT_W, align: 'right', height: 10 });
    }
  }
};

/**
 * Y donde empieza el cuerpo de una página nueva.
 *
 * Los documentos que dibujan un encabezado de continuación lo declaran como
 * margen superior del PDFDocument, así que el salto automático de PDFKit y el
 * nuestro aterrizan en el mismo sitio. Los que no lo hacen (margen 0) siguen
 * empezando en MARGIN, exactamente como antes.
 */
const inicioCuerpo = (doc) => Math.max(doc?.page?.margins?.top || 0, MARGIN);

/** Salta de página si no caben `alto` puntos; devuelve el y utilizable. */
const asegurarEspacio = (doc, y, alto, { fondo = BODY_BOTTOM } = {}) => {
  if (y + alto <= fondo) return y;
  doc.addPage();
  return inicioCuerpo(doc);
};

/**
 * Encabezado de continuación en TODAS las páginas a partir de la segunda.
 *
 * Se engancha al evento `pageAdded` en vez de dibujarse a mano en cada salto
 * porque los saltos vienen de dos sitios: los nuestros (`asegurarEspacio`,
 * `tablaPaginada`) y los que PDFKit hace por su cuenta cuando un párrafo largo
 * desborda. Dibujarlo solo en los nuestros dejaba las páginas del segundo tipo
 * sin encabezado y con el texto pegado al borde superior del papel.
 *
 * Exige que el documento se haya creado con `margins.top` = alto del encabezado
 * y `margins.bottom` = PAGE_H - BODY_BOTTOM: eso es lo que hace que el salto
 * automático de PDFKit aterrice bajo el encabezado y se detenga sobre el pie.
 *
 * @param {Function} dibujar (doc) => void
 */
const encabezadoContinuo = (doc, dibujar) => {
  doc.on('pageAdded', () => {
    dibujar(doc);
    // Imprescindible: `addPage` deja el cursor en el margen superior, pero el
    // encabezado que acabamos de dibujar lo movió. Sin esto, el texto que venía
    // fluyendo se reanudaría ENCIMA del encabezado.
    doc.x = MARGIN;
    doc.y = inicioCuerpo(doc);
  });
  return doc;
};

/**
 * Parte las palabras que no caben en `maxW`.
 *
 * PDFKit no parte una palabra: si no cabe, la pinta igual y se sale de su
 * columna en silencio. Un código de referencia sin espacios («ABC1234567890…»)
 * se comía la columna de al lado. El corte va con salto de línea real y no con
 * un espacio de ancho cero, que Helvetica no tiene en su codificación.
 */
const partirPalabrasLargas = (doc, texto, maxW) => {
  const original = String(texto ?? '');
  const partes = original.split(/(\s+)/);
  let cambio = false;
  const salida = partes.map((token) => {
    if (!token.trim() || doc.widthOfString(token) <= maxW) return token;
    cambio = true;
    let acumulado = '';
    let linea = '';
    for (const ch of token) {
      if (linea && doc.widthOfString(linea + ch) > maxW) { acumulado += linea + '\n'; linea = ''; }
      linea += ch;
    }
    return acumulado + linea;
  });
  return cambio ? salida.join('') : original;
};

/**
 * Mide un texto limitado a `lineas` líneas, ya partido para que quepa.
 * Devuelve el texto a dibujar y el alto exacto que va a ocupar, que es lo que
 * necesita quien calcula el alto de una fila ANTES de dibujarla.
 */
const medirTexto = (doc, texto, w, {
  lineas = 1, font = FONT.normal, size = 9, lineGap = 0,
} = {}) => {
  doc.font(font).fontSize(size);
  const partido = partirPalabrasLargas(doc, texto, w);
  const altoLinea = doc.currentLineHeight(true) + lineGap;
  const natural = doc.heightOfString(partido, { width: w, lineGap });
  const n = Math.max(1, Math.min(lineas, Math.round(natural / altoLinea) || 1));
  return { texto: partido, lineas: n, altoLinea, alto: n * altoLinea };
};

/**
 * Texto que NUNCA salta de página y NUNCA se sale de su caja: se recorta con
 * puntos suspensivos al llegar al límite de líneas.
 *
 * El `height` explícito es lo que lo garantiza — con el alto fijado, el
 * `LineWrapper` de PDFKit devuelve `false` en vez de crear una página nueva.
 * Es la diferencia entre un nombre de producto largo y 40 páginas en blanco.
 */
const textoAcotado = (doc, texto, x, y, w, {
  lineas = 1, font = FONT.normal, size = 9, color = C.negro,
  align = 'left', lineGap = 0, characterSpacing,
} = {}) => {
  const m = medirTexto(doc, texto, w, { lineas, font, size, lineGap });
  const opciones = { width: w, align, lineGap, height: m.alto + 0.5, ellipsis: true };
  if (characterSpacing != null) opciones.characterSpacing = characterSpacing;
  doc.font(font).fontSize(size).fillColor(color).text(m.texto, x, y, opciones);
  return m.alto;
};

/**
 * TABLA QUE SE PARTE ENTRE PÁGINAS REPITIENDO SU CABECERA.
 *
 * Es el corazón del arreglo. Antes cada tabla calculaba su alto total, dibujaba
 * UN marco de ese alto y soltaba las filas hacia abajo: el marco se salía del
 * papel y cada fila que caía por debajo del borde hacía que PDFKit abriera una
 * página nueva para ella sola. De ahí salían las decenas de páginas casi vacías.
 *
 * Aquí el marco se dibuja por TRAMOS —uno por página—, y cada tramo solo se
 * abre después de saber cuántas filas caben dentro. Las filas traen su alto
 * calculado de antemano porque una fila no se puede partir por la mitad.
 *
 * @param {object} opts
 * @param {number}   opts.cabeceraAlto    alto reservado arriba de cada tramo
 * @param {Function} opts.dibujarCabecera (doc, y) => void, repetida en cada tramo
 * @param {Array}    opts.filas           [{ alto, dibujar(doc, y, ctx), fondo? }]
 * @returns {number} y libre debajo de la tabla
 */
const tablaPaginada = (doc, y, {
  cabeceraAlto = 0,
  dibujarCabecera = null,
  filas = [],
  radio = 8,
  fondo = C.blanco,
  borde = C.grisBorde,
  alterna = C.filaAlterna,
  separador = true,
  espacioDespues = 24,
  limiteInferior = BODY_BOTTOM,
} = {}) => {
  let i = 0;

  // `do…while`: una tabla sin filas dibuja igual su cabecera. Decir que no hay
  // nada es información; un hueco sin explicar, no.
  do {
    const altoPrimera = filas[i] ? filas[i].alto : 0;
    y = asegurarEspacio(doc, y, cabeceraAlto + altoPrimera + 4, { fondo: limiteInferior });

    let alto = cabeceraAlto;
    let j = i;
    while (j < filas.length && y + alto + filas[j].alto <= limiteInferior) {
      alto += filas[j].alto;
      j += 1;
    }
    // Una fila más alta que la página entera se dibuja igual: partirla dejaría
    // media línea de texto colgando y un marco sin cerrar.
    if (j === i && filas[i]) { alto += filas[i].alto; j += 1; }

    rectFillStroke(doc, MARGIN, y, CONTENT_W, alto, fondo, borde, radio);
    if (dibujarCabecera) dibujarCabecera(doc, y);

    let yf = y + cabeceraAlto;
    for (let k = i; k < j; k++) {
      const f = filas[k];
      const color = f.fondo || (alterna && k % 2 === 1 ? alterna : null);
      if (color) {
        if (k === j - 1) {
          // Última fila del tramo: sigue la curva inferior del marco.
          doc.roundedRect(MARGIN, yf, CONTENT_W, f.alto, radio).fill(color);
          doc.rect(MARGIN, yf, CONTENT_W, Math.max(0, f.alto - radio)).fill(color);
        } else {
          doc.rect(MARGIN, yf, CONTENT_W, f.alto).fill(color);
        }
      }
      if (separador && k > i) hLine(doc, yf, { color: borde, width: 0.4 });
      if (f.dibujar) {
        f.dibujar(doc, yf, {
          indice: k, alto: f.alto, primeraDelTramo: k === i, ultimaDelTramo: k === j - 1,
        });
      }
      yf += f.alto;
    }

    y += alto;
    i = j;
  } while (i < filas.length);

  return y + espacioDespues;
};

module.exports = {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W, BODY_BOTTOM, FONT, C, TONOS,
  formatCOP, formatFecha, formatFechaHora,
  rectFill, rectStroke, rectFillStroke, hLine,
  labelSeccion, fila, textoUnaLinea, dibujarLogo,
  encabezado, badgeEstado, bloqueFirma, pieDocumento, asegurarEspacio,
  inicioCuerpo, encabezadoContinuo, partirPalabrasLargas, medirTexto,
  textoAcotado, tablaPaginada,
};
