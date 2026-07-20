// src/modules/servicios/servicios.pdf.js
// Genera el PDF de un comprobante de servicio técnico usando PDFKit.
// Diseño premium idéntico a facturas.pdf.js, adaptado para órdenes de servicio.

const PDFDocument = require('pdfkit');

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
  verde:        '#059669',
  verdeFondo:   '#ECFDF5',
  rojo:         '#DC2626',
  rojoFondo:    '#FEF2F2',
  naranja:      '#D97706',
  naranjaFondo: '#FFFBEB',
  morado:       '#7C3AED',
  moradoFondo:  '#F5F3FF',
  azul:         '#2563EB',
  azulFondo:    '#EFF6FF',
};

const FONT = { normal: 'Helvetica', bold: 'Helvetica-Bold' };

const PAGE_W    = 595.28;
const MARGIN    = 52;
const CONTENT_W = PAGE_W - MARGIN * 2;

// ─── Helpers de formato ───────────────────────────────────────────────────────

function formatCOP(valor) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(Number(valor || 0));
}

function formatFechaHora(fecha) {
  if (!fecha) return '';
  return new Date(fecha).toLocaleString('es-CO', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

// ─── Helpers de dibujo ────────────────────────────────────────────────────────

function rectFill(doc, x, y, w, h, color, radius = 6) {
  doc.roundedRect(x, y, w, h, radius).fill(color);
}

function rectFillStroke(doc, x, y, w, h, fillColor, strokeColor, radius = 6, lineWidth = 0.75) {
  doc.roundedRect(x, y, w, h, radius).fillAndStroke(fillColor, strokeColor);
  doc.lineWidth(lineWidth);
}

function hLine(doc, y, { x1 = MARGIN, x2 = PAGE_W - MARGIN, color = C.grisBorde, width = 0.5 } = {}) {
  doc.moveTo(x1, y).lineTo(x2, y).strokeColor(color).lineWidth(width).stroke();
}

function fila(doc, y, label, valor, {
  labelColor = C.gris, valorColor = C.negro,
  labelFont = FONT.normal, valorFont = FONT.normal,
  labelSize = 8.5, valorSize = 8.5,
  x = MARGIN, w = CONTENT_W, paddingLeft = 0,
} = {}) {
  const xL = x + paddingLeft;
  const wL = w * 0.52;
  const xR = x + w * 0.52;
  const wR = w * 0.48;

  doc.font(labelFont).fontSize(labelSize).fillColor(labelColor)
    .text(label, xL, y, { width: wL, lineBreak: false });
  doc.font(valorFont).fontSize(valorSize).fillColor(valorColor)
    .text(valor, xR, y, { width: wR, align: 'right', lineBreak: false });

  return y + 16;
}

function labelSeccion(doc, y, texto) {
  doc.font(FONT.bold).fontSize(7).fillColor(C.grisClaro)
    .text(texto.toUpperCase(), MARGIN, y, { characterSpacing: 1.2, width: CONTENT_W });
  return y + 14;
}

function dibujarLogoHeader(doc, config, headerH) {
  const raw = config?.logo_negocio;
  if (!raw) return 0;
  try {
    const base64 = raw.replace(/^data:image\/[a-z+]+;base64,/, '');
    const buf = Buffer.from(base64, 'base64');
    if (!buf.length) return 0;
    const LOGO_MAX = 60;
    const logoY = Math.round((headerH - LOGO_MAX) / 2);
    doc.image(buf, MARGIN, logoY, { fit: [LOGO_MAX, LOGO_MAX], align: 'center', valign: 'center' });
    return LOGO_MAX + 10;
  } catch {
    return 0;
  }
}

// ─── Estado → color del badge ─────────────────────────────────────────────────

const ESTADO_BADGE = {
  Recibido:       { bg: C.azul,    texto: 'RECIBIDO'       },
  En_reparacion:  { bg: C.naranja, texto: 'EN REPARACIÓN'  },
  Listo:          { bg: C.verde,   texto: 'LISTO'          },
  Pendiente_pago: { bg: C.naranja, texto: 'PENDIENTE PAGO' },
  Entregado:      { bg: C.gris,    texto: 'ENTREGADO'      },
  Sin_reparar:    { bg: C.rojo,    texto: 'SIN REPARAR'    },
  Garantia:       { bg: C.morado,  texto: 'GARANTÍA'       },
};

// ─── Helper: texto de una sola línea que se encoge hasta caber ────────────────

/**
 * Escribe un texto en UNA sola línea, reduciendo el tamaño de fuente hasta que
 * su ancho real quepa en maxW. Si ni con el mínimo cabe, se recorta con "…".
 */
function textoUnaLinea(doc, texto, x, y, maxW, {
  max = 22, min = 10, font = FONT.bold, color = C.headerText,
} = {}) {
  doc.font(font);
  let size = max;
  while (size > min && doc.fontSize(size).widthOfString(texto) > maxW) {
    size -= 0.5;
  }
  doc.fontSize(size);

  // Si ni en el tamaño mínimo cabe, recortar para no invadir la otra columna.
  let salida = texto;
  if (doc.widthOfString(salida) > maxW) {
    while (salida.length > 1 && doc.widthOfString(`${salida.trimEnd()}…`) > maxW) {
      salida = salida.slice(0, -1);
    }
    salida = `${salida.trimEnd()}…`;
  }

  doc.fillColor(color).text(salida, x, y, { width: maxW, lineBreak: false });
  return size;
}

// ─── SECCIÓN: Encabezado ──────────────────────────────────────────────────────

function seccionEncabezado(doc, config, orden) {
  const HEADER_H = 110;

  // ── Fondo del encabezado ──────────────────────────────────────────────────
  rectFill(doc, 0, 0, PAGE_W, HEADER_H, C.headerBg, 0);
  doc.rect(0, HEADER_H - 3, PAGE_W, 3).fill(C.azul);

  // ── Logo (se dibuja encima del fondo) ─────────────────────────────────────
  const logoOffset = dibujarLogoHeader(doc, config, HEADER_H);

  // Columna izquierda (negocio) hasta el 60%; columna derecha (orden) desde el 62%.
  const leftX  = MARGIN + logoOffset;
  const leftW  = MARGIN + CONTENT_W * 0.60 - leftX;
  const rightX = MARGIN + CONTENT_W * 0.62;
  const rightW = PAGE_W - rightX - MARGIN;

  // ── Lado izquierdo: nombre del negocio en una sola línea ──────────────────
  const nombreNegocio = config?.nombre_negocio || 'MI TIENDA';
  textoUnaLinea(doc, nombreNegocio, leftX, 28, leftW);

  let yInfo = 56;
  for (const linea of [
    config?.nit       ? `NIT: ${config.nit}`     : null,
    config?.direccion ? config.direccion           : null,
    config?.telefono  ? `Tel: ${config.telefono}` : null,
  ].filter(Boolean)) {
    doc.font(FONT.normal).fontSize(8).fillColor(C.headerSub)
      .text(linea, leftX, yInfo, { width: leftW, lineBreak: false, ellipsis: true });
    yInfo += 12;
  }

  const numOS = `#OS-${String(orden.numero ?? orden.id).padStart(4, '0')}`;

  doc.font(FONT.bold).fontSize(26).fillColor(C.headerText)
    .text(numOS, rightX, 22, { width: rightW, align: 'right' });

  doc.font(FONT.normal).fontSize(8).fillColor(C.headerSub)
    .text('COMPROBANTE DE SERVICIO', rightX, 54, { width: rightW, align: 'right' });

  doc.font(FONT.normal).fontSize(8).fillColor(C.headerSub)
    .text(formatFechaHora(orden.fecha_recepcion), rightX, 66, { width: rightW, align: 'right' });

  const est = ESTADO_BADGE[orden.estado] || { bg: C.gris, texto: (orden.estado || '').toUpperCase() };
  const badgeW = 80;
  const badgeX = PAGE_W - MARGIN - badgeW;
  rectFill(doc, badgeX, 79, badgeW, 18, est.bg, 4);
  doc.font(FONT.bold).fontSize(7).fillColor(C.blanco)
    .text(est.texto, badgeX, 84, { width: badgeW, align: 'center', characterSpacing: 0.6 });

  return HEADER_H + 28;
}

// ─── SECCIÓN: Cliente ─────────────────────────────────────────────────────────

function seccionCliente(doc, orden, y) {
  let lineasExtra = 0;
  if (orden.cliente_cedula   && orden.cliente_cedula !== 'S/C') lineasExtra += 1;
  if (orden.cliente_telefono)                                    lineasExtra += 1;
  if (orden.usuario_nombre)                                      lineasExtra += 1;

  const alturaBloque = 44 + lineasExtra * 14;
  rectFillStroke(doc, MARGIN, y, CONTENT_W, alturaBloque, C.grisFondo, C.grisBorde, 8);

  doc.font(FONT.bold).fontSize(7).fillColor(C.grisClaro)
    .text('CLIENTE', MARGIN + 14, y + 12, { characterSpacing: 1 });

  doc.font(FONT.bold).fontSize(13).fillColor(C.negro)
    .text(orden.cliente_nombre, MARGIN + 14, y + 24, { width: CONTENT_W - 28 });

  let yDatos = y + 40;

  if (orden.cliente_cedula && orden.cliente_cedula !== 'S/C') {
    doc.font(FONT.normal).fontSize(8.5).fillColor(C.gris)
      .text(`CC: ${orden.cliente_cedula}`, MARGIN + 14, yDatos, { width: CONTENT_W - 28 });
    yDatos += 14;
  }

  if (orden.cliente_telefono) {
    doc.font(FONT.normal).fontSize(8.5).fillColor(C.gris)
      .text(`Tel: ${orden.cliente_telefono}`, MARGIN + 14, yDatos, { width: CONTENT_W - 28 });
    yDatos += 14;
  }

  if (orden.usuario_nombre) {
    doc.font(FONT.normal).fontSize(8).fillColor(C.grisClaro)
      .text(`Atendido por: ${orden.usuario_nombre}`, MARGIN + 14, yDatos, { width: CONTENT_W - 28 });
  }

  return y + alturaBloque + 24;
}

// ─── SECCIÓN: Equipo ──────────────────────────────────────────────────────────

function seccionEquipo(doc, orden, y) {
  const lineas = [
    orden.equipo_tipo   ? `Tipo: ${orden.equipo_tipo}`     : null,
    orden.equipo_nombre ? `Modelo: ${orden.equipo_nombre}` : null,
    orden.equipo_serial ? `Serial/IMEI: ${orden.equipo_serial}` : null,
  ].filter(Boolean);

  if (lineas.length === 0) return y;

  y = labelSeccion(doc, y, 'Equipo');

  const alturaBloque = 16 + lineas.length * 16 + 12;
  rectFillStroke(doc, MARGIN, y, CONTENT_W, alturaBloque, C.azulFondo, '#BFDBFE', 8);

  let yInterna = y + 12;
  for (const linea of lineas) {
    doc.font(FONT.normal).fontSize(8.5).fillColor(C.grisOscuro)
      .text(linea, MARGIN + 14, yInterna, { width: CONTENT_W - 28, lineBreak: false });
    yInterna += 16;
  }

  return y + alturaBloque + 24;
}

// ─── SECCIÓN: Diagnóstico ─────────────────────────────────────────────────────

function seccionDiagnostico(doc, orden, y) {
  y = labelSeccion(doc, y, 'Diagnóstico');

  const textoFalla   = orden.falla_reportada || '';
  const textoNotas   = orden.notas_tecnico   || '';
  const altoFalla    = doc.heightOfString(textoFalla, { width: CONTENT_W - 28 });
  const altoNotas    = textoNotas ? doc.heightOfString(textoNotas, { width: CONTENT_W - 28 }) + 20 : 0;
  const alturaBloque = altoFalla + altoNotas + 28;

  rectFillStroke(doc, MARGIN, y, CONTENT_W, alturaBloque, C.grisFondo, C.grisBorde, 8);

  doc.font(FONT.bold).fontSize(8).fillColor(C.grisOscuro)
    .text('Falla reportada:', MARGIN + 14, y + 12);
  doc.font(FONT.normal).fontSize(8.5).fillColor(C.grisOscuro)
    .text(textoFalla, MARGIN + 14, y + 24, { width: CONTENT_W - 28 });

  if (textoNotas) {
    const yNotas = y + 24 + altoFalla + 8;
    doc.font(FONT.bold).fontSize(8).fillColor(C.grisOscuro)
      .text('Notas del técnico:', MARGIN + 14, yNotas);
    doc.font(FONT.normal).fontSize(8.5).fillColor(C.grisOscuro)
      .text(textoNotas, MARGIN + 14, yNotas + 13, { width: CONTENT_W - 28 });
  }

  return y + alturaBloque + 24;
}

// ─── SECCIÓN: Motivo sin reparar ─────────────────────────────────────────────

function seccionMotivo(doc, orden, y) {
  if (!orden.motivo_sin_reparar) return y;

  y = labelSeccion(doc, y, 'Motivo de devolución');

  const texto        = orden.motivo_sin_reparar;
  const altoTexto    = doc.heightOfString(texto, { width: CONTENT_W - 28 });
  const alturaBloque = altoTexto + 28;

  rectFillStroke(doc, MARGIN, y, CONTENT_W, alturaBloque, C.naranjaFondo, '#FDE68A', 8);

  doc.font(FONT.normal).fontSize(8.5).fillColor(C.naranja)
    .text(texto, MARGIN + 14, y + 14, { width: CONTENT_W - 28 });

  return y + alturaBloque + 24;
}

// ─── SECCIÓN: Totales y Pagos ─────────────────────────────────────────────────

function seccionTotalesYPagos(doc, orden, abonos, y) {
  const esGarantia  = orden.estado === 'Garantia' && orden.garantia_cobrable && orden.precio_garantia;
  const totalCobro  = esGarantia
    ? Number(orden.precio_garantia)
    : Number(orden.precio_final || 0);

  if (totalCobro <= 0 && abonos.length === 0) return y;

  const totalAbonado = Number(orden.total_abonado || 0);
  const saldo        = Math.max(0, totalCobro - totalAbonado);

  // Bloque TOTAL
  const colorBg  = saldo <= 0 ? C.verde : C.negro;
  rectFill(doc, MARGIN, y, CONTENT_W, 48, colorBg, 8);

  const etiquetaTotal = esGarantia ? 'COBRO GARANTÍA' : 'TOTAL REPARACIÓN';
  doc.font(FONT.bold).fontSize(11).fillColor(C.blanco)
    .text(etiquetaTotal, MARGIN + 16, y + 16, { width: CONTENT_W * 0.5, lineBreak: false });
  doc.font(FONT.bold).fontSize(16).fillColor(C.blanco)
    .text(formatCOP(totalCobro), MARGIN, y + 12, { width: CONTENT_W - 16, align: 'right', lineBreak: false });

  y += 48 + 20;

  // Abonos
  if (abonos.length > 0) {
    y = labelSeccion(doc, y, 'Pagos realizados');

    const altPagos = 24 + abonos.length * 22 + (saldo <= 0 ? 22 : 0);
    rectFillStroke(doc, MARGIN, y, CONTENT_W, altPagos, C.grisFondo, C.grisBorde, 8);

    let yPago = y + 12;
    for (const [i, ab] of abonos.entries()) {
      if (i > 0) {
        hLine(doc, yPago - 4, { x1: MARGIN + 14, x2: PAGE_W - MARGIN - 14, color: C.grisBorde, width: 0.4 });
      }
      const etiqueta = ab.metodo ? `${ab.metodo}` : 'Pago';
      const fecha    = ab.fecha ? ` · ${formatFechaHora(ab.fecha)}` : '';
      doc.font(FONT.normal).fontSize(8.5).fillColor(C.grisOscuro)
        .text(etiqueta + fecha, MARGIN + 14, yPago, { width: CONTENT_W * 0.6, lineBreak: false });
      doc.font(FONT.bold).fontSize(8.5).fillColor(C.negro)
        .text(formatCOP(ab.valor), MARGIN, yPago, { width: CONTENT_W - 14, align: 'right', lineBreak: false });
      yPago += 22;
    }

    if (saldo <= 0) {
      hLine(doc, yPago - 4, { x1: MARGIN + 14, x2: PAGE_W - MARGIN - 14, color: C.grisBorde, width: 0.4 });
      doc.font(FONT.bold).fontSize(8.5).fillColor(C.verde)
        .text('PAGADO EN SU TOTALIDAD', MARGIN + 14, yPago, { width: CONTENT_W - 28, align: 'center' });
    }

    y += altPagos + 20;
  }

  // Saldo pendiente
  if (saldo > 0) {
    y = fila(doc, y, 'Total abonado', formatCOP(totalAbonado));

    const altSaldo = 48;
    rectFill(doc, MARGIN, y, CONTENT_W, altSaldo, C.naranjaFondo, 8);
    doc.roundedRect(MARGIN, y, CONTENT_W, altSaldo, 8)
      .strokeColor('#FDE68A').lineWidth(0.75).stroke();

    doc.font(FONT.bold).fontSize(11).fillColor(C.naranja)
      .text('SALDO PENDIENTE', MARGIN + 16, y + 16, { width: CONTENT_W * 0.55, lineBreak: false });
    doc.font(FONT.bold).fontSize(16).fillColor(C.naranja)
      .text(formatCOP(saldo), MARGIN, y + 12, { width: CONTENT_W - 16, align: 'right', lineBreak: false });

    y += altSaldo + 20;
  }

  return y;
}

// ─── SECCIÓN: Fechas ─────────────────────────────────────────────────────────

function seccionFechas(doc, orden, y) {
  y = fila(doc, y, 'Fecha de recepción', formatFechaHora(orden.fecha_recepcion), {
    labelColor: C.grisClaro, valorColor: C.grisOscuro, labelSize: 8, valorSize: 8,
  });
  if (orden.fecha_entrega) {
    y = fila(doc, y, 'Fecha de entrega', formatFechaHora(orden.fecha_entrega), {
      labelColor: C.grisClaro, valorColor: C.grisOscuro, labelSize: 8, valorSize: 8,
    });
  }
  return y + 8;
}

// ─── SECCIÓN: Garantías ───────────────────────────────────────────────────────

function seccionGarantias(doc, garantias, y) {
  if (!garantias || garantias.length === 0) return y;

  hLine(doc, y, { color: C.grisBorde });
  y += 20;
  y = labelSeccion(doc, y, 'Términos y Garantías');

  const sorted = [...garantias].sort((a, b) => a.orden - b.orden);

  for (const g of sorted) {
    const altoTexto  = doc.heightOfString(g.texto, { width: CONTENT_W - 32, lineGap: 2 });
    const altoBloque = altoTexto + 36;

    rectFillStroke(doc, MARGIN, y, CONTENT_W, altoBloque, C.blanco, C.grisBorde, 8);
    rectFill(doc, MARGIN, y, 4, altoBloque, C.negro, 0);
    doc.rect(MARGIN, y, 4, altoBloque - 8).fill(C.negro);

    doc.font(FONT.bold).fontSize(9).fillColor(C.negro)
      .text(g.titulo, MARGIN + 18, y + 12, { width: CONTENT_W - 32 });
    doc.font(FONT.normal).fontSize(8).fillColor(C.gris)
      .text(g.texto, MARGIN + 18, y + 24, { width: CONTENT_W - 32, lineGap: 2 });

    y += altoBloque + 10;
  }

  return y + 14;
}

// ─── SECCIÓN: Pie de página ───────────────────────────────────────────────────

function seccionPie(doc, y) {
  hLine(doc, y, { color: C.grisBorde });
  y += 20;

  doc.font(FONT.bold).fontSize(11).fillColor(C.negro)
    .text('¡Gracias por su confianza!', MARGIN, y, { width: CONTENT_W, align: 'center' });

  y += 22;

  const firmaY  = y + 16;
  const firmaX1 = PAGE_W / 2 - 80;
  const firmaX2 = PAGE_W / 2 + 80;

  doc.moveTo(firmaX1, firmaY).lineTo(firmaX2, firmaY)
    .strokeColor(C.grisBorde).lineWidth(0.75).stroke();

  doc.font(FONT.normal).fontSize(8).fillColor(C.grisClaro)
    .text('Firma del cliente', MARGIN, firmaY + 6, { width: CONTENT_W, align: 'center' });
}

// ─── Función principal exportada ──────────────────────────────────────────────

/**
 * Genera el PDF de un comprobante de servicio y lo escribe en el stream de respuesta.
 *
 * @param {{ orden: object, abonos: Array, config: object, garantias: Array, res: object }} params
 */
function generarPdfServicio({ orden, abonos = [], config = {}, garantias = [], res }) {
  const numOS = String(orden.numero ?? orden.id).padStart(4, '0');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="comprobante-OS-${numOS}.pdf"`,
  );

  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    autoFirstPage: true,
    info: {
      Title:   `Comprobante de Servicio #OS-${numOS}`,
      Author:  config?.nombre_negocio || 'Servicio Técnico',
      Subject: 'Comprobante de servicio técnico',
      Creator: 'Sistema POS',
    },
  });

  doc.pipe(res);

  let y = 0;

  y = seccionEncabezado(doc, config, orden);
  y = seccionCliente(doc, orden, y);
  y = seccionEquipo(doc, orden, y);
  y = seccionDiagnostico(doc, orden, y);
  y = seccionMotivo(doc, orden, y);
  y = seccionTotalesYPagos(doc, orden, abonos, y);
  y = seccionFechas(doc, orden, y);
  y = seccionGarantias(doc, garantias, y);
  seccionPie(doc, y);

  doc.end();
}

// ─── PDF: Recibo de Recepción ─────────────────────────────────────────────────

function seccionEncabezadoRecepcion(doc, config, orden) {
  const HEADER_H = 110;

  // ── Fondo del encabezado ──────────────────────────────────────────────────
  rectFill(doc, 0, 0, PAGE_W, HEADER_H, C.headerBg, 0);
  doc.rect(0, HEADER_H - 3, PAGE_W, 3).fill(C.verde);

  // ── Logo (se dibuja encima del fondo) ─────────────────────────────────────
  const logoOffset = dibujarLogoHeader(doc, config, HEADER_H);

  // Columna izquierda (negocio) hasta el 60%; columna derecha (orden) desde el 62%.
  const leftX  = MARGIN + logoOffset;
  const leftW  = MARGIN + CONTENT_W * 0.60 - leftX;
  const rightX = MARGIN + CONTENT_W * 0.62;
  const rightW = PAGE_W - rightX - MARGIN;

  // ── Lado izquierdo: nombre del negocio en una sola línea ──────────────────
  const nombreNegocio = config?.nombre_negocio || 'MI TIENDA';
  textoUnaLinea(doc, nombreNegocio, leftX, 28, leftW);

  let yInfo = 56;
  for (const linea of [
    config?.nit       ? `NIT: ${config.nit}`     : null,
    config?.direccion ? config.direccion           : null,
    config?.telefono  ? `Tel: ${config.telefono}` : null,
  ].filter(Boolean)) {
    doc.font(FONT.normal).fontSize(8).fillColor(C.headerSub)
      .text(linea, leftX, yInfo, { width: leftW, lineBreak: false, ellipsis: true });
    yInfo += 12;
  }

  const numOS = `#OS-${String(orden.numero ?? orden.id).padStart(4, '0')}`;

  doc.font(FONT.bold).fontSize(26).fillColor(C.headerText)
    .text(numOS, rightX, 22, { width: rightW, align: 'right' });

  doc.font(FONT.normal).fontSize(8).fillColor(C.headerSub)
    .text('RECIBO DE RECEPCIÓN', rightX, 54, { width: rightW, align: 'right' });

  doc.font(FONT.normal).fontSize(8).fillColor(C.headerSub)
    .text(formatFechaHora(orden.fecha_recepcion), rightX, 66, { width: rightW, align: 'right' });

  const badgeW = 68;
  const badgeX = PAGE_W - MARGIN - badgeW;
  rectFill(doc, badgeX, 79, badgeW, 18, C.verde, 4);
  doc.font(FONT.bold).fontSize(7.5).fillColor(C.blanco)
    .text('RECIBIDO', badgeX, 84, { width: badgeW, align: 'center', characterSpacing: 0.8 });

  return HEADER_H + 28;
}

function seccionAvisoImportante(doc, y) {
  y = labelSeccion(doc, y, 'Importante');

  const texto = 'Conserve este recibo para reclamar su equipo. No se entregan equipos sin presentar este comprobante o documento de identidad del titular.';
  const altoTexto    = doc.heightOfString(texto, { width: CONTENT_W - 28 });
  const alturaBloque = altoTexto + 28;

  rectFillStroke(doc, MARGIN, y, CONTENT_W, alturaBloque, C.naranjaFondo, '#FDE68A', 8);

  doc.font(FONT.normal).fontSize(8.5).fillColor(C.naranja)
    .text(texto, MARGIN + 14, y + 14, { width: CONTENT_W - 28 });

  return y + alturaBloque + 24;
}

function seccionCostoEstimado(doc, orden, y) {
  if (!orden.costo_estimado || Number(orden.costo_estimado) <= 0) return y;

  y = fila(doc, y, 'Costo estimado', formatCOP(Number(orden.costo_estimado)), {
    valorFont: FONT.bold, valorColor: C.negro,
  });

  doc.font(FONT.normal).fontSize(7.5).fillColor(C.grisClaro)
    .text('* El precio final puede variar según el diagnóstico', MARGIN, y, { width: CONTENT_W });

  return y + 20;
}

/**
 * Genera el PDF del recibo de recepción de una orden de servicio.
 *
 * @param {{ orden: object, config: object, res: object }} params
 */
function generarPdfRecepcion({ orden, config = {}, res }) {
  const numOS = String(orden.numero ?? orden.id).padStart(4, '0');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="recepcion-OS-${numOS}.pdf"`,
  );

  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    autoFirstPage: true,
    info: {
      Title:   `Recibo de Recepción #OS-${numOS}`,
      Author:  config?.nombre_negocio || 'Servicio Técnico',
      Subject: 'Recibo de recepción de equipo',
      Creator: 'Sistema POS',
    },
  });

  doc.pipe(res);

  let y = 0;

  y = seccionEncabezadoRecepcion(doc, config, orden);
  y = seccionCliente(doc, orden, y);
  y = seccionEquipo(doc, orden, y);
  y = seccionDiagnostico(doc, orden, y);
  y = seccionCostoEstimado(doc, orden, y);
  y = seccionAvisoImportante(doc, y);

  // Línea de firma
  hLine(doc, y, { color: C.grisBorde });
  y += 20;

  const firmaY  = y + 16;
  const firmaX1 = PAGE_W / 2 - 80;
  const firmaX2 = PAGE_W / 2 + 80;

  doc.moveTo(firmaX1, firmaY).lineTo(firmaX2, firmaY)
    .strokeColor(C.grisBorde).lineWidth(0.75).stroke();

  doc.font(FONT.normal).fontSize(8).fillColor(C.grisClaro)
    .text('Firma del cliente', MARGIN, firmaY + 6, { width: CONTENT_W, align: 'center' });

  doc.end();
}

module.exports = { generarPdfServicio, generarPdfRecepcion };
