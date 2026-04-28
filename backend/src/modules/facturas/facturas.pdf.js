// src/modules/facturas/facturas.pdf.js
// ─────────────────────────────────────────────────────────────────────────────
// Genera el PDF de una factura usando PDFKit.
// Diseño premium con tipografía limpia, bloques bien definidos y espaciado
// consistente. Paleta oscura en encabezado, tarjetas con bordes suaves.
// ─────────────────────────────────────────────────────────────────────────────

const PDFDocument = require('pdfkit');

// ─── Paleta de colores ────────────────────────────────────────────────────────

const C = {
  // Encabezado
  headerBg:     '#111827',  // gris muy oscuro casi negro
  headerText:   '#FFFFFF',
  headerSub:    '#9CA3AF',

  // Cuerpo
  negro:        '#111827',
  grisOscuro:   '#374151',
  gris:         '#6B7280',
  grisClaro:    '#9CA3AF',
  grisFondo:    '#F9FAFB',
  grisBorde:    '#E5E7EB',
  blanco:       '#FFFFFF',

  // Acentos
  acento:       '#111827',  // mismo que header para consistencia
  acentoLine:   '#D1D5DB',

  // Estados
  verde:        '#059669',
  verdeFondo:   '#ECFDF5',
  rojo:         '#DC2626',
  rojoFondo:    '#FEF2F2',
  naranja:      '#D97706',
  naranjaFondo: '#FFFBEB',
  morado:       '#7C3AED',
  moradoFondo:  '#F5F3FF',
};

const FONT = {
  normal: 'Helvetica',
  bold:   'Helvetica-Bold',
};

// Medidas A4
const PAGE_W    = 595.28;
const PAGE_H    = 841.89;
const MARGIN    = 52;
const CONTENT_W = PAGE_W - MARGIN * 2;

// ─── Formato COP ──────────────────────────────────────────────────────────────

function formatCOP(valor) {
  return new Intl.NumberFormat('es-CO', {
    style:                 'currency',
    currency:              'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(valor || 0));
}

function formatFechaHora(fecha) {
  if (!fecha) return '';
  return new Date(fecha).toLocaleString('es-CO', {
    year:   'numeric', month:  '2-digit', day:    '2-digit',
    hour:   '2-digit', minute: '2-digit', hour12: false,
  });
}

function labelTipoRetoma(retoma) {
  return retoma.imei ? 'Equipo con serial / IMEI' : 'Producto por cantidad';
}

function calcularValorRetoma(retoma) {
  return Number(retoma?.valor_retoma || 0);
}

// ─── Helpers de dibujo ────────────────────────────────────────────────────────

/**
 * Rectángulo redondeado relleno.
 */
function rectFill(doc, x, y, w, h, color, radius = 6) {
  doc.roundedRect(x, y, w, h, radius).fill(color);
}

/**
 * Rectángulo redondeado con borde (sin relleno).
 */
function rectStroke(doc, x, y, w, h, color, radius = 6, lineWidth = 0.75) {
  doc.roundedRect(x, y, w, h, radius)
    .strokeColor(color).lineWidth(lineWidth).stroke();
}

/**
 * Rectángulo redondeado relleno + borde.
 */
function rectFillStroke(doc, x, y, w, h, fillColor, strokeColor, radius = 6, lineWidth = 0.75) {
  doc.roundedRect(x, y, w, h, radius)
    .fillAndStroke(fillColor, strokeColor);
  doc.lineWidth(lineWidth);
}

/**
 * Línea horizontal.
 */
function hLine(doc, y, { x1 = MARGIN, x2 = PAGE_W - MARGIN, color = C.grisBorde, width = 0.5 } = {}) {
  doc.moveTo(x1, y).lineTo(x2, y)
    .strokeColor(color).lineWidth(width).stroke();
}

/**
 * Fila de dos columnas dentro de un bloque.
 * Retorna el nuevo y.
 */
function fila(doc, y, label, valor, {
  labelColor  = C.gris,
  valorColor  = C.negro,
  labelFont   = FONT.normal,
  valorFont   = FONT.normal,
  labelSize   = 8.5,
  valorSize   = 8.5,
  x           = MARGIN,
  w           = CONTENT_W,
  paddingLeft = 0,
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

/**
 * Etiqueta de sección pequeña (CLIENTE, PRODUCTOS, etc.)
 */
function labelSeccion(doc, y, texto) {
  doc.font(FONT.bold).fontSize(7).fillColor(C.grisClaro)
    .text(texto.toUpperCase(), MARGIN, y, {
      characterSpacing: 1.2,
      width: CONTENT_W,
    });
  return y + 14;
}

// ─── SECCIÓN: Encabezado ──────────────────────────────────────────────────────

function seccionEncabezado(doc, config, factura) {
  const HEADER_H = 110;

  // Fondo oscuro del encabezado
  rectFill(doc, 0, 0, PAGE_W, HEADER_H, C.headerBg, 0);

  // Línea de acento inferior (delgada, verde)
  doc.rect(0, HEADER_H - 3, PAGE_W, 3).fill(C.verde);

  // ── Lado izquierdo: nombre del negocio ───────────────────────────────────
  const nombreNegocio = config?.nombre_negocio || 'MI TIENDA';
  doc.font(FONT.bold).fontSize(22).fillColor(C.headerText)
    .text(nombreNegocio, MARGIN, 28, { width: CONTENT_W * 0.55 });

  let yInfoNegocio = 56;
  const infoNegocio = [
    config?.nit       ? `NIT: ${config.nit}`       : null,
    config?.direccion ? config.direccion             : null,
    config?.telefono  ? `Tel: ${config.telefono}`   : null,
  ].filter(Boolean);

  for (const linea of infoNegocio) {
    doc.font(FONT.normal).fontSize(8).fillColor(C.headerSub)
      .text(linea, MARGIN, yInfoNegocio, { width: CONTENT_W * 0.55 });
    yInfoNegocio += 12;
  }

  // ── Lado derecho: número y datos de factura ───────────────────────────────
  const numFactura = `#${String(factura.id).padStart(6, '0')}`;

  doc.font(FONT.bold).fontSize(26).fillColor(C.headerText)
    .text(numFactura, MARGIN, 22, { width: CONTENT_W, align: 'right' });

  doc.font(FONT.normal).fontSize(8).fillColor(C.headerSub)
    .text('FACTURA DE VENTA', MARGIN, 54, { width: CONTENT_W, align: 'right' });

  doc.font(FONT.normal).fontSize(8).fillColor(C.headerSub)
    .text(formatFechaHora(factura.fecha), MARGIN, 66, { width: CONTENT_W, align: 'right' });

  // Badge de estado
  const estadoConfig = {
    Activa:   { bg: C.verde,   texto: 'ACTIVA'    },
    Credito:  { bg: C.naranja, texto: 'CRÉDITO'   },
    Cancelada:{ bg: C.rojo,    texto: 'CANCELADA' },
  };
  const est = estadoConfig[factura.estado] || { bg: C.gris, texto: factura.estado?.toUpperCase() };

  const badgeW = 68;
  const badgeX = PAGE_W - MARGIN - badgeW;
  rectFill(doc, badgeX, 79, badgeW, 18, est.bg, 4);
  doc.font(FONT.bold).fontSize(7.5).fillColor(C.blanco)
    .text(est.texto, badgeX, 84, { width: badgeW, align: 'center', characterSpacing: 0.8 });

  return HEADER_H + 28; // y de inicio del contenido
}

// ─── SECCIÓN: Cliente ─────────────────────────────────────────────────────────

function seccionCliente(doc, factura, y) {
  const esCompanero = factura.cedula === 'COMPANERO';

  // Calcular altura del bloque
  let lineasExtra = 0;
  if (!esCompanero)                                  lineasExtra += 1;
  if (!esCompanero && factura.cliente_email)         lineasExtra += 1;
  if (!esCompanero && factura.cliente_direccion)     lineasExtra += 1;
  if (factura.usuario_nombre)                        lineasExtra += 1;
  const alturaBloque = 44 + lineasExtra * 14;

  // Tarjeta con borde
  rectFillStroke(doc, MARGIN, y, CONTENT_W, alturaBloque, C.grisFondo, C.grisBorde, 8);

  // Label interno
  doc.font(FONT.bold).fontSize(7).fillColor(C.grisClaro)
    .text('CLIENTE', MARGIN + 14, y + 12, { characterSpacing: 1 });

  // Nombre del cliente
  doc.font(FONT.bold).fontSize(13).fillColor(C.negro)
    .text(factura.nombre_cliente, MARGIN + 14, y + 24, { width: CONTENT_W - 28 });

  let yDatos = y + 40;

  if (!esCompanero) {
    const cedulaTexto = `CC: ${factura.cedula}`;
    const celularTexto = (factura.celular && factura.celular !== '0000000000')
      ? `  ·  Tel: ${factura.celular}` : '';

    doc.font(FONT.normal).fontSize(8.5).fillColor(C.gris)
      .text(cedulaTexto + celularTexto, MARGIN + 14, yDatos, { width: CONTENT_W - 28 });
    yDatos += 14;
  }

  if (!esCompanero && factura.cliente_email) {
    doc.font(FONT.normal).fontSize(8.5).fillColor(C.gris)
      .text(factura.cliente_email, MARGIN + 14, yDatos, { width: CONTENT_W - 28 });
    yDatos += 14;
  }

  if (!esCompanero && factura.cliente_direccion) {
    doc.font(FONT.normal).fontSize(8.5).fillColor(C.gris)
      .text(factura.cliente_direccion, MARGIN + 14, yDatos, { width: CONTENT_W - 28 });
    yDatos += 14;
  }

  if (factura.usuario_nombre) {
    doc.font(FONT.normal).fontSize(8).fillColor(C.grisClaro)
      .text(`Atendido por: ${factura.usuario_nombre}`, MARGIN + 14, yDatos, { width: CONTENT_W - 28 });
  }

  return y + alturaBloque + 24;
}

// ─── SECCIÓN: Tabla de productos ──────────────────────────────────────────────

function seccionProductos(doc, lineas, y) {
  y = labelSeccion(doc, y, 'Productos');

  const COL = {
    desc:    { x: MARGIN + 12,              w: CONTENT_W * 0.46 },
    cant:    { x: MARGIN + CONTENT_W * 0.58, w: 40 },
    precio:  { x: MARGIN + CONTENT_W * 0.68, w: 72 },
    sub:     { x: MARGIN + CONTENT_W * 0.84, w: CONTENT_W * 0.16 - 12 },
  };

  // Calcular altura total de la tabla
  let alturaTotal = 32; // header
  for (const l of lineas) {
    alturaTotal += l.imei ? 34 : 24;
  }

  // Fondo de la tabla completa
  rectFillStroke(doc, MARGIN, y, CONTENT_W, alturaTotal, C.blanco, C.grisBorde, 8);

  // Encabezado de tabla
  rectFill(doc, MARGIN, y, CONTENT_W, 28, C.negro, 8);
  // Esquinas inferiores cuadradas en el header
  doc.rect(MARGIN, y + 16, CONTENT_W, 12).fill(C.negro);

  doc.font(FONT.bold).fontSize(7.5).fillColor(C.blanco);
  doc.text('Descripción',   COL.desc.x,   y + 10, { width: COL.desc.w,   characterSpacing: 0.5 });
  doc.text('Cant.',         COL.cant.x,   y + 10, { width: COL.cant.w,   align: 'right', characterSpacing: 0.5 });
  doc.text('Precio unit.',  COL.precio.x, y + 10, { width: COL.precio.w, align: 'right', characterSpacing: 0.5 });
  doc.text('Subtotal',      COL.sub.x,    y + 10, { width: COL.sub.w,    align: 'right', characterSpacing: 0.5 });

  let yFila = y + 28;

  for (const [i, linea] of lineas.entries()) {
    const altFila = linea.imei ? 34 : 24;
    const esPar   = i % 2 === 1;

    if (esPar) {
      // Fondo alternado — esquinas cuadradas en filas intermedias
      const esUltima = i === lineas.length - 1;
      if (esUltima) {
        doc.roundedRect(MARGIN, yFila, CONTENT_W, altFila, 8).fill('#F8FAFC');
        doc.rect(MARGIN, yFila, CONTENT_W, altFila - 8).fill('#F8FAFC');
      } else {
        doc.rect(MARGIN, yFila, CONTENT_W, altFila).fill('#F8FAFC');
      }
    }

    // Separador entre filas
    if (i > 0) {
      hLine(doc, yFila, { color: C.grisBorde, width: 0.4 });
    }

    const yTexto = yFila + (linea.imei ? 8 : 7);

    doc.font(FONT.bold).fontSize(9).fillColor(C.negro)
      .text(linea.nombre_producto, COL.desc.x, yTexto, { width: COL.desc.w, lineBreak: false });

    if (linea.imei) {
      doc.font(FONT.normal).fontSize(7.5).fillColor(C.grisClaro)
        .text(`IMEI: ${linea.imei}`, COL.desc.x, yTexto + 13, { width: COL.desc.w, lineBreak: false });
    }

    doc.font(FONT.normal).fontSize(9).fillColor(C.grisOscuro)
      .text(String(linea.cantidad), COL.cant.x, yTexto, { width: COL.cant.w, align: 'right', lineBreak: false });

    doc.font(FONT.normal).fontSize(9).fillColor(C.grisOscuro)
      .text(formatCOP(linea.precio), COL.precio.x, yTexto, { width: COL.precio.w, align: 'right', lineBreak: false });

    doc.font(FONT.bold).fontSize(9).fillColor(C.negro)
      .text(formatCOP(linea.subtotal), COL.sub.x, yTexto, { width: COL.sub.w, align: 'right', lineBreak: false });

    yFila += altFila;
  }

  return y + alturaTotal + 24;
}

// ─── SECCIÓN: Retomas ─────────────────────────────────────────────────────────

function seccionRetomas(doc, retomas, y) {
  if (!retomas || retomas.length === 0) return y;

  y = labelSeccion(doc, y, retomas.length === 1 ? 'Retoma' : `Retomas (${retomas.length})`);

  for (const [i, retoma] of retomas.entries()) {
    const nombreProd = retoma.nombre_producto_serial
      || retoma.nombre_producto_cantidad
      || retoma.nombre_producto
      || null;

    const lineas = [
      retoma.descripcion                                     ? retoma.descripcion            : null,
      `Tipo: ${labelTipoRetoma(retoma)}`,
      retoma.imei                                           ? `IMEI: ${retoma.imei}`        : null,
      nombreProd                                            ? `Producto: ${nombreProd}`     : null,
      (!retoma.imei && Number(retoma.cantidad_retoma) > 1)  ? `Cantidad: ${retoma.cantidad_retoma}` : null,
    ].filter(Boolean);

    const alturaBloque = 16 + lineas.length * 13 + 28;

    rectFillStroke(doc, MARGIN, y, CONTENT_W, alturaBloque, C.moradoFondo, '#DDD6FE', 8);

    // Número de retoma si hay varias
    let yInterna = y + 12;
    if (retomas.length > 1) {
      doc.font(FONT.bold).fontSize(7.5).fillColor(C.morado)
        .text(`RETOMA ${i + 1}`, MARGIN + 14, yInterna, { characterSpacing: 0.8 });
      yInterna += 14;
    }

    for (const linea of lineas) {
      doc.font(FONT.normal).fontSize(8.5).fillColor(C.grisOscuro)
        .text(linea, MARGIN + 14, yInterna, { width: CONTENT_W - 28, lineBreak: false });
      yInterna += 13;
    }

    // Valor retoma
    const valRetoma = calcularValorRetoma(retoma);
    hLine(doc, yInterna + 4, { x1: MARGIN + 14, x2: PAGE_W - MARGIN - 14, color: '#DDD6FE' });

    doc.font(FONT.normal).fontSize(8.5).fillColor(C.morado)
      .text('Valor retoma:', MARGIN + 14, yInterna + 10);
    doc.font(FONT.bold).fontSize(9).fillColor(C.morado)
      .text(`- ${formatCOP(valRetoma)}`, MARGIN, yInterna + 10, { width: CONTENT_W - 14, align: 'right' });

    y += alturaBloque + 10;
  }

  return y + 14;
}

// ─── SECCIÓN: Totales y Pagos ─────────────────────────────────────────────────

function seccionTotalesYPagos(doc, factura, y) {
  const lineas      = factura.lineas  || [];
  const pagos       = factura.pagos   || [];
  const retomas     = factura.retomas || [];
  const total       = lineas.reduce((s, l) => s + Number(l.subtotal || 0), 0);
  const totalRetoma = retomas.reduce((s, r) => s + calcularValorRetoma(r), 0);
  const totalNeto   = total - totalRetoma;
  const totalPagado = pagos.reduce((s, p) => s + Number(p.valor || 0), 0);
  const cambio      = totalPagado - totalNeto;

  // ── Bloque TOTAL ──────────────────────────────────────────────────────────
  const colorTotalBg  = totalNeto < 0 ? C.verdeFondo : C.negro;
  const colorTotalTxt = totalNeto < 0 ? C.verde      : C.blanco;

  rectFill(doc, MARGIN, y, CONTENT_W, 48, colorTotalBg, 8);

  doc.font(FONT.bold).fontSize(11).fillColor(colorTotalTxt)
    .text('TOTAL A PAGAR', MARGIN + 16, y + 16, { width: CONTENT_W * 0.5, lineBreak: false });

  const textoTotal = totalNeto < 0
    ? `+ ${formatCOP(Math.abs(totalNeto))}`
    : formatCOP(totalNeto);

  doc.font(FONT.bold).fontSize(16).fillColor(colorTotalTxt)
    .text(textoTotal, MARGIN, y + 12, { width: CONTENT_W - 16, align: 'right', lineBreak: false });

  y += 48 + 20;

  // Si hay retomas mostrar desglose
  if (totalRetoma > 0) {
    y = fila(doc, y, 'Subtotal productos', formatCOP(total));
    y = fila(doc, y, `Retoma${retomas.length > 1 ? 's' : ''} (${retomas.length})`,
      `- ${formatCOP(totalRetoma)}`,
      { valorColor: C.morado, valorFont: FONT.bold });

    hLine(doc, y, { color: C.grisBorde });
    y += 12;
  }

  // ── Bloque PAGOS ──────────────────────────────────────────────────────────
  y = labelSeccion(doc, y, 'Pagos');

  const altPagos = 24 + pagos.length * 22 + (cambio > 0 ? 22 : 0);
  rectFillStroke(doc, MARGIN, y, CONTENT_W, altPagos, C.grisFondo, C.grisBorde, 8);

  let yPago = y + 12;
  for (const [i, pago] of pagos.entries()) {
    if (i > 0) {
      hLine(doc, yPago - 4, { x1: MARGIN + 14, x2: PAGE_W - MARGIN - 14, color: C.grisBorde, width: 0.4 });
    }
    doc.font(FONT.normal).fontSize(9).fillColor(C.grisOscuro)
      .text(pago.metodo, MARGIN + 14, yPago, { width: CONTENT_W * 0.5, lineBreak: false });
    doc.font(FONT.bold).fontSize(9).fillColor(C.negro)
      .text(formatCOP(pago.valor), MARGIN, yPago, { width: CONTENT_W - 14, align: 'right', lineBreak: false });
    yPago += 22;
  }

  if (cambio > 0) {
    hLine(doc, yPago - 4, { x1: MARGIN + 14, x2: PAGE_W - MARGIN - 14, color: C.grisBorde, width: 0.4 });
    doc.font(FONT.normal).fontSize(9).fillColor(C.verde)
      .text('Cambio', MARGIN + 14, yPago, { width: CONTENT_W * 0.5, lineBreak: false });
    doc.font(FONT.bold).fontSize(9).fillColor(C.verde)
      .text(formatCOP(cambio), MARGIN, yPago, { width: CONTENT_W - 14, align: 'right', lineBreak: false });
  }

  return y + altPagos + 24;
}

// ─── SECCIÓN: Notas ───────────────────────────────────────────────────────────

function seccionNotas(doc, notas, y) {
  if (!notas) return y;

  y = labelSeccion(doc, y, 'Observaciones');

  const alturaTexto = doc.heightOfString(notas, { width: CONTENT_W - 28 });
  const alturaBloque = alturaTexto + 24;

  rectFillStroke(doc, MARGIN, y, CONTENT_W, alturaBloque, C.grisFondo, C.grisBorde, 8);

  doc.font(FONT.normal).fontSize(8.5).fillColor(C.grisOscuro)
    .text(notas, MARGIN + 14, y + 12, { width: CONTENT_W - 28 });

  return y + alturaBloque + 24;
}

// ─── SECCIÓN: Garantías ───────────────────────────────────────────────────────

function seccionGarantias(doc, garantias, y) {
  if (!garantias || garantias.length === 0) return y;

  // Separador antes de garantías
  hLine(doc, y, { color: C.grisBorde });
  y += 20;

  y = labelSeccion(doc, y, 'Términos y Garantías');

  const sorted = [...garantias].sort((a, b) => a.orden - b.orden);

  for (const [i, g] of sorted.entries()) {
    const altoTexto  = doc.heightOfString(g.texto, { width: CONTENT_W - 28, lineGap: 2 });
    const altoBloque = altoTexto + 36;

    rectFillStroke(doc, MARGIN, y, CONTENT_W, altoBloque, C.blanco, C.grisBorde, 8);

    // Barra izquierda de acento
    rectFill(doc, MARGIN, y, 4, altoBloque, C.negro, 0);
    doc.rect(MARGIN, y, 4, altoBloque - 8).fill(C.negro); // corregir esquina inferior

    doc.font(FONT.bold).fontSize(9).fillColor(C.negro)
      .text(g.titulo, MARGIN + 18, y + 12, { width: CONTENT_W - 32 });

    doc.font(FONT.normal).fontSize(8).fillColor(C.gris)
      .text(g.texto, MARGIN + 18, y + 24, { width: CONTENT_W - 32, lineGap: 2 });

    y += altoBloque + 10;

    if (i < sorted.length - 1) {
      // pequeño espacio entre garantías, sin línea extra
    }
  }

  return y + 14;
}

// ─── SECCIÓN: Pie de página ───────────────────────────────────────────────────

function seccionPie(doc, y) {
  // Línea decorativa
  hLine(doc, y, { color: C.grisBorde });
  y += 20;

  doc.font(FONT.bold).fontSize(11).fillColor(C.negro)
    .text('¡Gracias por su compra!', MARGIN, y, { width: CONTENT_W, align: 'center' });

  y += 22;

  // Línea de firma
  const firmaY = y + 16;
  const firmaX1 = PAGE_W / 2 - 80;
  const firmaX2 = PAGE_W / 2 + 80;

  doc.moveTo(firmaX1, firmaY).lineTo(firmaX2, firmaY)
    .strokeColor(C.grisBorde).lineWidth(0.75).stroke();

  doc.font(FONT.normal).fontSize(8).fillColor(C.grisClaro)
    .text('Firma del cliente', MARGIN, firmaY + 6, { width: CONTENT_W, align: 'center' });

  return firmaY + 24;
}

// ─── Función principal exportada ──────────────────────────────────────────────

/**
 * Genera el PDF de una factura y lo escribe en el stream de respuesta.
 *
 * @param {{ factura: object, config: object, garantias: Array, res: object }} params
 */
function generarPdfFactura({ factura, config, garantias = [], res }) {
  const numFactura = String(factura.id).padStart(6, '0');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="factura-${numFactura}.pdf"`
  );

  const doc = new PDFDocument({
    size:        'A4',
    margin:      0,           // manejamos márgenes manualmente
    autoFirstPage: true,
    info: {
      Title:   `Factura #${numFactura}`,
      Author:  config?.nombre_negocio || 'Sistema de Facturación',
      Subject: 'Factura de venta',
      Creator: 'Sistema POS',
    },
  });

  doc.pipe(res);

  let y = 0;

  y = seccionEncabezado(doc, config, factura);
  y = seccionCliente(doc, factura, y);
  y = seccionProductos(doc, factura.lineas || [], y);
  y = seccionRetomas(doc, factura.retomas || [], y);
  y = seccionTotalesYPagos(doc, factura, y);
  y = seccionNotas(doc, factura.notas, y);
  y = seccionGarantias(doc, garantias, y);
  seccionPie(doc, y);

  doc.end();
}

module.exports = { generarPdfFactura };