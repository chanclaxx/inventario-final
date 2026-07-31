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

/** Etiqueta pequeña de sección (CLIENTE, PRODUCTOS…). */
const labelSeccion = (doc, y, texto) => {
  doc.font(FONT.bold).fontSize(7).fillColor(C.grisClaro)
    .text(String(texto).toUpperCase(), MARGIN, y, { characterSpacing: 1.2, width: CONTENT_W });
  return y + 14;
};

/** Fila etiqueta → valor, alineada a los bordes del contenido. */
const fila = (doc, y, label, valor, {
  labelColor = C.gris, valorColor = C.negro,
  labelFont = FONT.normal, valorFont = FONT.normal,
  labelSize = 8.5, valorSize = 8.5,
  x = MARGIN, w = CONTENT_W, paddingLeft = 0, alto = 16,
} = {}) => {
  doc.font(labelFont).fontSize(labelSize).fillColor(labelColor)
    .text(label, x + paddingLeft, y, { width: w * 0.52, lineBreak: false });
  doc.font(valorFont).fontSize(valorSize).fillColor(valorColor)
    .text(valor, x + w * 0.52, y, { width: w * 0.48 - paddingLeft, align: 'right', lineBreak: false });
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

/** Pie con paginación, aplicado a todas las páginas del buffer. */
const pieDocumento = (doc, { texto = '' } = {}) => {
  const total = doc.bufferedPageRange().count;
  for (let i = 0; i < total; i++) {
    doc.switchToPage(i);
    hLine(doc, PAGE_H - 44, { color: C.grisBorde });
    if (texto) {
      doc.font(FONT.normal).fontSize(7).fillColor(C.grisClaro)
        .text(texto, MARGIN, PAGE_H - 38, { width: CONTENT_W * 0.7, align: 'left' });
    }
    doc.font(FONT.normal).fontSize(7).fillColor(C.grisClaro)
      .text(`Página ${i + 1} de ${total}`, MARGIN, PAGE_H - 38, { width: CONTENT_W, align: 'right' });
  }
};

/** Salta de página si no caben `alto` puntos; devuelve el y utilizable. */
const asegurarEspacio = (doc, y, alto, { fondo = PAGE_H - 70 } = {}) => {
  if (y + alto <= fondo) return y;
  doc.addPage();
  return MARGIN;
};

module.exports = {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W, FONT, C, TONOS,
  formatCOP, formatFecha, formatFechaHora,
  rectFill, rectStroke, rectFillStroke, hLine,
  labelSeccion, fila, textoUnaLinea, dibujarLogo,
  encabezado, badgeEstado, bloqueFirma, pieDocumento, asegurarEspacio,
};
