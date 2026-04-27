// src/modules/facturas/facturas.pdf.js
// ─────────────────────────────────────────────────────────────────────────────
// Genera el PDF de una factura usando PDFKit.
// Diseño minimalista A4 con toda la información de la factura.
// ─────────────────────────────────────────────────────────────────────────────

const PDFDocument = require('pdfkit');

// ─── Paleta y tipografía ──────────────────────────────────────────────────────

const COLOR = {
  negro:       '#111111',
  gris:        '#6B7280',
  grisFondo:   '#F9FAFB',
  grisBorde:   '#E5E7EB',
  morado:      '#7C3AED',
  moradoClaro: '#EDE9FE',
  verde:       '#059669',
  rojo:        '#DC2626',
  azul:        '#2563EB',
  naranja:     '#EA580C',
};

const FONT = {
  normal: 'Helvetica',
  bold:   'Helvetica-Bold',
};

const MARGIN   = 48;
const PAGE_W   = 595.28; // A4
const CONTENT_W = PAGE_W - MARGIN * 2;

// ─── Utilidades de formato ────────────────────────────────────────────────────

function formatCOP(valor) {
  const num = Number(valor || 0);
  return new Intl.NumberFormat('es-CO', {
    style:    'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}

function formatFechaHora(fecha) {
  if (!fecha) return '';
  return new Date(fecha).toLocaleString('es-CO', {
    year:   'numeric',
    month:  '2-digit',
    day:    '2-digit',
    hour:   '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function labelTipoRetoma(retoma) {
  if (retoma.imei) return 'Equipo con serial / IMEI';
  return 'Producto por cantidad';
}

function calcularValorRetoma(retoma) {
  return Number(retoma?.valor_retoma || 0);
}

// ─── Helpers de dibujo ────────────────────────────────────────────────────────

/**
 * Dibuja una línea horizontal divisoria.
 */
function dibujarDivisor(doc, y, { color = COLOR.grisBorde, grosor = 0.5 } = {}) {
  doc
    .moveTo(MARGIN, y)
    .lineTo(PAGE_W - MARGIN, y)
    .strokeColor(color)
    .lineWidth(grosor)
    .stroke();
  return y + 12;
}

/**
 * Dibuja una fila de dos columnas (label izquierda, valor derecha).
 */
function filaDoble(doc, y, label, valor, { labelColor = COLOR.gris, valorColor = COLOR.negro, bold = false } = {}) {
  doc
    .font(FONT.normal).fontSize(9).fillColor(labelColor)
    .text(label, MARGIN, y, { width: CONTENT_W * 0.5 });

  doc
    .font(bold ? FONT.bold : FONT.normal).fontSize(9).fillColor(valorColor)
    .text(valor, MARGIN + CONTENT_W * 0.5, y, { width: CONTENT_W * 0.5, align: 'right' });

  return y + 16;
}

/**
 * Dibuja un bloque de fondo redondeado (simulado con rect).
 */
function bloqueFondo(doc, x, y, w, h, color = COLOR.grisFondo) {
  doc
    .roundedRect(x, y, w, h, 6)
    .fill(color);
}

// ─── Secciones del PDF ────────────────────────────────────────────────────────

function seccionEncabezado(doc, config, factura) {
  let y = MARGIN;

  // Nombre del negocio
  doc
    .font(FONT.bold).fontSize(18).fillColor(COLOR.negro)
    .text(config?.nombre_negocio || 'MI TIENDA', MARGIN, y);

  y += 26;

  // NIT y dirección
  if (config?.nit) {
    doc.font(FONT.normal).fontSize(9).fillColor(COLOR.gris)
      .text(`NIT: ${config.nit}`, MARGIN, y);
    y += 14;
  }
  if (config?.direccion) {
    doc.font(FONT.normal).fontSize(9).fillColor(COLOR.gris)
      .text(config.direccion, MARGIN, y);
    y += 14;
  }
  if (config?.telefono) {
    doc.font(FONT.normal).fontSize(9).fillColor(COLOR.gris)
      .text(`Tel: ${config.telefono}`, MARGIN, y);
    y += 14;
  }

  // Número de factura (derecha)
  const numFactura = `#${String(factura.id).padStart(6, '0')}`;
  doc
    .font(FONT.bold).fontSize(22).fillColor(COLOR.negro)
    .text(numFactura, MARGIN, MARGIN, { width: CONTENT_W, align: 'right' });

  // Etiqueta "FACTURA DE VENTA"
  doc
    .font(FONT.normal).fontSize(9).fillColor(COLOR.gris)
    .text('FACTURA DE VENTA', MARGIN, MARGIN + 30, { width: CONTENT_W, align: 'right' });

  // Fecha
  doc
    .font(FONT.normal).fontSize(9).fillColor(COLOR.gris)
    .text(formatFechaHora(factura.fecha), MARGIN, MARGIN + 44, { width: CONTENT_W, align: 'right' });

  // Badge de estado
  const estadoColor = factura.estado === 'Activa'
    ? COLOR.verde
    : factura.estado === 'Credito'
      ? COLOR.naranja
      : COLOR.rojo;

  const estadoX = PAGE_W - MARGIN - 70;
  doc
    .roundedRect(estadoX, MARGIN + 58, 70, 18, 4)
    .fill(estadoColor);
  doc
    .font(FONT.bold).fontSize(8).fillColor('#FFFFFF')
    .text(factura.estado?.toUpperCase(), estadoX, MARGIN + 63, { width: 70, align: 'center' });

  y = Math.max(y, MARGIN + 90);

  y = dibujarDivisor(doc, y + 6);
  return y;
}

function seccionCliente(doc, factura, y) {
  const esCompanero = factura.cedula === 'COMPANERO';

  bloqueFondo(doc, MARGIN, y, CONTENT_W, esCompanero ? 52 : 84);

  y += 10;

  doc.font(FONT.bold).fontSize(8).fillColor(COLOR.gris)
    .text('CLIENTE', MARGIN + 10, y);
  y += 14;

  doc.font(FONT.bold).fontSize(11).fillColor(COLOR.negro)
    .text(factura.nombre_cliente, MARGIN + 10, y);
  y += 16;

  if (!esCompanero) {
    doc.font(FONT.normal).fontSize(9).fillColor(COLOR.gris)
      .text(`CC: ${factura.cedula}`, MARGIN + 10, y);

    if (factura.celular && factura.celular !== '0000000000') {
      doc.font(FONT.normal).fontSize(9).fillColor(COLOR.gris)
        .text(`Tel: ${factura.celular}`, MARGIN + 10 + 150, y);
    }
    y += 14;

    if (factura.cliente_email) {
      doc.font(FONT.normal).fontSize(9).fillColor(COLOR.gris)
        .text(factura.cliente_email, MARGIN + 10, y);
      y += 14;
    }
    if (factura.cliente_direccion) {
      doc.font(FONT.normal).fontSize(9).fillColor(COLOR.gris)
        .text(factura.cliente_direccion, MARGIN + 10, y);
      y += 14;
    }
  }

  if (factura.usuario_nombre) {
    doc.font(FONT.normal).fontSize(8).fillColor(COLOR.gris)
      .text(`Atendido por: ${factura.usuario_nombre}`, MARGIN + 10, y);
    y += 14;
  }

  y += 6;
  y = dibujarDivisor(doc, y + 4);
  return y;
}

function seccionProductos(doc, lineas, y) {
  doc.font(FONT.bold).fontSize(8).fillColor(COLOR.gris)
    .text('PRODUCTOS', MARGIN, y);
  y += 14;

  // Encabezados de tabla
  bloqueFondo(doc, MARGIN, y, CONTENT_W, 18, COLOR.grisBorde);

  doc.font(FONT.bold).fontSize(8).fillColor(COLOR.gris)
    .text('Descripción', MARGIN + 8, y + 5)
    .text('Cant.', MARGIN + CONTENT_W * 0.55, y + 5, { width: 40, align: 'right' })
    .text('Precio unit.', MARGIN + CONTENT_W * 0.65, y + 5, { width: 70, align: 'right' })
    .text('Subtotal', MARGIN + CONTENT_W * 0.85, y + 5, { width: CONTENT_W * 0.15, align: 'right' });

  y += 22;

  for (const [i, linea] of lineas.entries()) {
    if (i % 2 === 0) {
      bloqueFondo(doc, MARGIN, y - 2, CONTENT_W, 28, '#FAFAFA');
    }

    doc.font(FONT.bold).fontSize(9).fillColor(COLOR.negro)
      .text(linea.nombre_producto, MARGIN + 8, y, { width: CONTENT_W * 0.52 });

    if (linea.imei) {
      doc.font(FONT.normal).fontSize(7.5).fillColor(COLOR.gris)
        .text(`IMEI: ${linea.imei}`, MARGIN + 8, y + 12, { width: CONTENT_W * 0.52 });
    }

    const altoFila = linea.imei ? 30 : 20;

    doc
      .font(FONT.normal).fontSize(9).fillColor(COLOR.negro)
      .text(String(linea.cantidad), MARGIN + CONTENT_W * 0.55, y, { width: 40, align: 'right' })
      .text(formatCOP(linea.precio), MARGIN + CONTENT_W * 0.65, y, { width: 70, align: 'right' })
      .font(FONT.bold).fontSize(9).fillColor(COLOR.negro)
      .text(formatCOP(linea.subtotal), MARGIN + CONTENT_W * 0.85, y, { width: CONTENT_W * 0.15, align: 'right' });

    y += altoFila;
  }

  y += 4;
  y = dibujarDivisor(doc, y);
  return y;
}

function seccionRetomas(doc, retomas, y) {
  if (!retomas || retomas.length === 0) return y;

  // Fondo morado claro para sección retomas
  const altoEstimado = retomas.length * 70 + 30;
  bloqueFondo(doc, MARGIN, y, CONTENT_W, altoEstimado, COLOR.moradoClaro);

  doc.font(FONT.bold).fontSize(8).fillColor(COLOR.morado)
    .text(retomas.length === 1 ? 'RETOMA' : `RETOMAS (${retomas.length})`, MARGIN + 10, y + 8);

  y += 24;

  for (const [i, retoma] of retomas.entries()) {
    if (retomas.length > 1) {
      doc.font(FONT.bold).fontSize(8.5).fillColor(COLOR.morado)
        .text(`Retoma ${i + 1}`, MARGIN + 10, y);
      y += 14;
    }

    if (retoma.descripcion) {
      doc.font(FONT.bold).fontSize(9).fillColor(COLOR.negro)
        .text(retoma.descripcion, MARGIN + 10, y);
      y += 14;
    }

    doc.font(FONT.normal).fontSize(8).fillColor(COLOR.gris)
      .text(`Tipo: ${labelTipoRetoma(retoma)}`, MARGIN + 10, y);
    y += 12;

    if (retoma.imei) {
      doc.font(FONT.normal).fontSize(8).fillColor(COLOR.gris)
        .text(`IMEI: ${retoma.imei}`, MARGIN + 10, y);
      y += 12;
    }

    const nombreProd = retoma.nombre_producto_serial
      || retoma.nombre_producto_cantidad
      || retoma.nombre_producto
      || null;

    if (nombreProd) {
      doc.font(FONT.normal).fontSize(8).fillColor(COLOR.gris)
        .text(`Producto: ${nombreProd}`, MARGIN + 10, y);
      y += 12;
    }

    if (!retoma.imei && Number(retoma.cantidad_retoma) > 1) {
      doc.font(FONT.normal).fontSize(8).fillColor(COLOR.gris)
        .text(`Cantidad retomada: ${retoma.cantidad_retoma}`, MARGIN + 10, y);
      y += 12;
    }

    // Valor retoma
    const valRetoma = calcularValorRetoma(retoma);
    doc
      .font(FONT.normal).fontSize(8).fillColor(COLOR.gris)
      .text('Valor retoma:', MARGIN + 10, y)
      .font(FONT.bold).fontSize(9).fillColor(COLOR.morado)
      .text(`- ${formatCOP(valRetoma)}`, MARGIN, y, { width: CONTENT_W - 10, align: 'right' });
    y += 16;

    if (i < retomas.length - 1) {
      doc.moveTo(MARGIN + 10, y).lineTo(PAGE_W - MARGIN - 10, y)
        .strokeColor(COLOR.morado).lineWidth(0.3).dash(3, { space: 3 }).stroke()
        .undash();
      y += 10;
    }
  }

  y += 10;
  y = dibujarDivisor(doc, y);
  return y;
}

function seccionPagosYTotales(doc, factura, y) {
  const lineas      = factura.lineas  || [];
  const pagos       = factura.pagos   || [];
  const retomas     = factura.retomas || [];
  const total       = lineas.reduce((s, l) => s + Number(l.subtotal || 0), 0);
  const totalRetoma = retomas.reduce((s, r) => s + calcularValorRetoma(r), 0);
  const totalNeto   = total - totalRetoma;
  const totalPagado = pagos.reduce((s, p) => s + Number(p.valor || 0), 0);
  const cambio      = totalPagado - totalNeto;

  // ── Retomas en resumen ────────────────────────────────────────────────────
  if (totalRetoma > 0) {
    y = filaDoble(doc, y, 'Subtotal productos', formatCOP(total));
    if (retomas.length === 1) {
      y = filaDoble(doc, y, 'Retoma', `- ${formatCOP(totalRetoma)}`,
        { valorColor: COLOR.morado });
    } else {
      y = filaDoble(doc, y, `Total retomas (${retomas.length})`, `- ${formatCOP(totalRetoma)}`,
        { valorColor: COLOR.morado });
    }
    y = dibujarDivisor(doc, y, { color: COLOR.grisBorde, grosor: 0.3 });
  }

  // ── Total neto ────────────────────────────────────────────────────────────
  const colorTotal = totalNeto < 0 ? COLOR.verde : COLOR.negro;
  doc
    .font(FONT.bold).fontSize(13).fillColor(colorTotal)
    .text('TOTAL A PAGAR', MARGIN, y)
    .text(
      totalNeto < 0 ? `+ ${formatCOP(Math.abs(totalNeto))}` : formatCOP(totalNeto),
      MARGIN, y, { width: CONTENT_W, align: 'right' }
    );
  y += 22;

  if (totalNeto < 0) {
    doc.font(FONT.normal).fontSize(8).fillColor(COLOR.verde)
      .text('La retoma supera el valor — el negocio devuelve la diferencia al cliente.',
        MARGIN, y, { width: CONTENT_W });
    y += 14;
  }

  y = dibujarDivisor(doc, y, { color: COLOR.grisBorde });

  // ── Pagos ─────────────────────────────────────────────────────────────────
  doc.font(FONT.bold).fontSize(8).fillColor(COLOR.gris).text('PAGOS', MARGIN, y);
  y += 14;

  for (const pago of pagos) {
    y = filaDoble(doc, y, pago.metodo, formatCOP(pago.valor));
  }

  if (pagos.length > 1) {
    y = dibujarDivisor(doc, y, { color: COLOR.grisBorde, grosor: 0.3 });
    y = filaDoble(doc, y, 'Total pagado', formatCOP(totalPagado),
      { bold: true, valorColor: COLOR.negro });
  }

  if (cambio > 0) {
    y = filaDoble(doc, y, 'Cambio', formatCOP(cambio),
      { valorColor: COLOR.verde, bold: true });
  }

  y += 4;
  y = dibujarDivisor(doc, y);
  return y;
}

function seccionNotas(doc, notas, y) {
  if (!notas) return y;

  bloqueFondo(doc, MARGIN, y, CONTENT_W, 40);
  doc
    .font(FONT.bold).fontSize(8).fillColor(COLOR.gris)
    .text('OBSERVACIONES', MARGIN + 10, y + 8);
  doc
    .font(FONT.normal).fontSize(9).fillColor(COLOR.negro)
    .text(notas, MARGIN + 10, y + 20, { width: CONTENT_W - 20 });

  y += 50;
  y = dibujarDivisor(doc, y);
  return y;
}

function seccionGarantias(doc, garantias, y) {
  if (!garantias || garantias.length === 0) return y;

  doc.font(FONT.bold).fontSize(8).fillColor(COLOR.gris)
    .text('TÉRMINOS Y GARANTÍAS', MARGIN, y, { width: CONTENT_W, align: 'center' });
  y += 16;

  const sorted = [...garantias].sort((a, b) => a.orden - b.orden);

  for (const g of sorted) {
    doc.font(FONT.bold).fontSize(9).fillColor(COLOR.negro)
      .text(g.titulo, MARGIN, y, { width: CONTENT_W });
    y += 14;

    doc.font(FONT.normal).fontSize(8.5).fillColor(COLOR.gris)
      .text(g.texto, MARGIN, y, { width: CONTENT_W, lineGap: 2 });

    y += doc.heightOfString(g.texto, { width: CONTENT_W, lineGap: 2 }) + 10;
  }

  y = dibujarDivisor(doc, y);
  return y;
}

function seccionPie(doc, y) {
  doc
    .font(FONT.normal).fontSize(10).fillColor(COLOR.gris)
    .text('¡Gracias por su compra!', MARGIN, y, { width: CONTENT_W, align: 'center' });

  y += 30;

  doc
    .font(FONT.normal).fontSize(9).fillColor(COLOR.gris)
    .text('Firma del cliente: ___________________________', MARGIN, y, {
      width: CONTENT_W,
      align: 'center',
    });

  return y;
}

// ─── Función principal exportada ──────────────────────────────────────────────

/**
 * Genera el PDF de una factura y lo escribe en el stream de respuesta.
 *
 * @param {object} params
 * @param {object} params.factura  - Objeto factura con lineas, pagos, retomas
 * @param {object} params.config   - Configuración del negocio (nombre, nit, etc.)
 * @param {Array}  params.garantias - Array de garantías
 * @param {import('http').ServerResponse} params.res - Response de Express
 */
function generarPdfFactura({ factura, config, garantias = [], res }) {
  const numFactura = String(factura.id).padStart(6, '0');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="factura-${numFactura}.pdf"`
  );

  const doc = new PDFDocument({
    size:    'A4',
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    info: {
      Title:    `Factura #${numFactura}`,
      Author:   config?.nombre_negocio || 'Sistema de Facturación',
      Subject:  'Factura de venta',
      Creator:  'Sistema POS',
    },
  });

  doc.pipe(res);

  let y = MARGIN;

  y = seccionEncabezado(doc, config, factura);
  y = seccionCliente(doc, factura, y);
  y = seccionProductos(doc, factura.lineas || [], y);
  y = seccionRetomas(doc, factura.retomas || [], y);
  y = seccionPagosYTotales(doc, factura, y);
  y = seccionNotas(doc, factura.notas, y);
  y = seccionGarantias(doc, garantias, y);
  seccionPie(doc, y);

  doc.end();
}

module.exports = { generarPdfFactura };