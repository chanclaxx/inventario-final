'use strict';

const PDFDocument = require('pdfkit');
const { pool }    = require('../../config/db');
const repo        = require('./prestamos.repository');

// Núcleo compartido con los créditos: mismo cálculo del estado de la deuda y
// mismos bloques de dibujo, para que préstamo y crédito produzcan documentos
// idénticos en estructura y en cifras.
const { resumirObligacion } = require('../../utils/obligacion');
const {
  bloqueEstadoObligacion, bloqueFechas, tablaAbonos, tablaMovimientosMora, bloqueCondiciones,
  generarAvisoMora, generarPazYSalvo,
} = require('../../utils/obligacion.pdf');

// ─── Helpers de formato ───────────────────────────────────────────────────────

const formatCOP = (valor) =>
  new Intl.NumberFormat('es-CO', {
    style:    'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number(valor) || 0);

const formatFecha = (fecha) => {
  if (!fecha) return '—';
  return new Date(fecha).toLocaleDateString('es-CO', {
    day:      '2-digit',
    month:    '2-digit',
    year:     'numeric',
    timeZone: 'America/Bogota',
  });
};

const formatFechaHora = (fecha) => {
  if (!fecha) return '—';
  return new Date(fecha).toLocaleString('es-CO', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'America/Bogota',
  });
};

// ─── Constantes de layout (compartidas) ──────────────────────────────────────

const MARGIN     = 52;
const PAGE_WIDTH = 595.28;
const PAGE_H     = 841.89;
const COL_WIDTH  = PAGE_WIDTH - MARGIN * 2;

const FONT = { normal: 'Helvetica', bold: 'Helvetica-Bold' };

// ─── Paleta premium (igual que facturas.pdf.js) ───────────────────────────────

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
  acento:       '#111827',
  acentoLine:   '#D1D5DB',
  verde:        '#059669',
  verdeFondo:   '#ECFDF5',
  rojo:         '#DC2626',
  rojoFondo:    '#FEF2F2',
  naranja:      '#D97706',
  naranjaFondo: '#FFFBEB',
  azul:         '#2563EB',
  azulFondo:    '#EFF6FF',
};

// ─── Primitivas de dibujo (igual que facturas.pdf.js) ────────────────────────

const rectFill = (doc, x, y, w, h, color, radius = 6) =>
  doc.roundedRect(x, y, w, h, radius).fill(color);

const rectFillStroke = (doc, x, y, w, h, fillColor, strokeColor, radius = 6, lineWidth = 0.75) => {
  doc.roundedRect(x, y, w, h, radius).fillAndStroke(fillColor, strokeColor);
  doc.lineWidth(lineWidth);
};

const hLine = (doc, y, { x1 = MARGIN, x2 = PAGE_WIDTH - MARGIN, color = C.grisBorde, width = 0.5 } = {}) =>
  doc.moveTo(x1, y).lineTo(x2, y).strokeColor(color).lineWidth(width).stroke();

const labelSeccion = (doc, y, texto) => {
  doc.font(FONT.bold).fontSize(7).fillColor(C.grisClaro)
    .text(texto.toUpperCase(), MARGIN, y, { characterSpacing: 1.2, width: COL_WIDTH });
  return y + 10;
};

// ─────────────────────────────────────────────────────────────────────────────
// SECCIÓN 1: PDF por persona (préstamos activos — función original sin cambios)
// ─────────────────────────────────────────────────────────────────────────────

const COLORS_ORIG = {
  primary:   '#1E3A5F', accent: '#2563EB', headerBg: '#1E3A5F',
  rowAlt:    '#F1F5F9', rowBase: '#FFFFFF', border: '#CBD5E1',
  text:      '#1E293B', textMuted: '#64748B', white: '#FFFFFF',
  greenDark: '#065F46', redDark: '#991B1B', totalBg: '#EFF6FF',
};

const drawRect = (doc, x, y, w, h, color) =>
  doc.save().rect(x, y, w, h).fill(color).restore();

const drawLine = (doc, x1, y1, x2, y2, color = COLORS_ORIG.border, width = 0.5) =>
  doc.save().moveTo(x1, y1).lineTo(x2, y2).strokeColor(color).lineWidth(width).stroke().restore();

const intentarLogoHeader = (doc, logoRaw, headerH) => {
  if (!logoRaw) return 0;
  try {
    const base64 = logoRaw.replace(/^data:image\/[a-z+]+;base64,/, '');
    const buf = Buffer.from(base64, 'base64');
    if (!buf.length) return 0;
    const LOGO_MAX = 50;
    const logoY = Math.round((headerH - LOGO_MAX) / 2);
    doc.image(buf, MARGIN, logoY, { fit: [LOGO_MAX, LOGO_MAX], align: 'center', valign: 'center' });
    return LOGO_MAX + 10;
  } catch {
    return 0;
  }
};

/**
 * Escribe un texto en UNA sola línea, reduciendo el tamaño de fuente hasta que
 * su ancho real quepa en maxW. Si ni con el mínimo cabe, se recorta con "…".
 */
const textoUnaLinea = (doc, texto, x, y, maxW, {
  max = 18, min = 9, font = FONT.bold, color = COLORS_ORIG.white,
} = {}) => {
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
};

const drawHeader = (doc, { negocioNombre, personaNombre, personaInfo, fechaGeneracion, logoNegocio }) => {
  const HEADER_H = 80;

  // ── Fondo del encabezado ──────────────────────────────────────────────────
  drawRect(doc, 0, 0, PAGE_WIDTH, HEADER_H, COLORS_ORIG.headerBg);

  // ── Logo (se dibuja encima del fondo) ─────────────────────────────────────
  const logoOffset = intentarLogoHeader(doc, logoNegocio, HEADER_H);

  // Columna izquierda (negocio) hasta el 60%; columna derecha (fecha) desde el 62%.
  const leftX  = MARGIN + logoOffset;
  const leftW  = MARGIN + COL_WIDTH * 0.60 - leftX;
  const rightX = MARGIN + COL_WIDTH * 0.62;
  const rightW = PAGE_WIDTH - rightX - MARGIN;

  textoUnaLinea(doc, negocioNombre || 'Mi Negocio', leftX, 22, leftW);
  doc.font('Helvetica').fontSize(8).fillColor('#94A3B8')
    .text(`Generado: ${fechaGeneracion}`, rightX, 55, { width: rightW, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor('#93C5FD')
    .text('Estado de cuenta — Préstamos activos', leftX, 45, { width: leftW, lineBreak: false, ellipsis: true });
  const cardY = HEADER_H + 12;
  drawRect(doc, MARGIN, cardY, COL_WIDTH, 52, COLORS_ORIG.rowAlt);
  doc.save().rect(MARGIN, cardY, 4, 52).fill(COLORS_ORIG.accent).restore();
  doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS_ORIG.text)
    .text(personaNombre, MARGIN + 14, cardY + 8, { width: COL_WIDTH - 20 });
  if (personaInfo) {
    doc.font('Helvetica').fontSize(9).fillColor(COLORS_ORIG.textMuted)
      .text(personaInfo, MARGIN + 14, cardY + 28, { width: COL_WIDTH - 20 });
  }
  return cardY + 52 + 20;
};

const drawPrestamo = (doc, prestamo, abonos, index, startY) => {
  let y = startY;
  if (y > 680) { doc.addPage(); y = MARGIN; }
  drawRect(doc, MARGIN, y, COL_WIDTH, 26, COLORS_ORIG.primary);
  const titulo = `#${index + 1}  ${prestamo.nombre_producto}`;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS_ORIG.white)
    .text(titulo, MARGIN + 8, y + 7, { width: COL_WIDTH - 120 });
  doc.font('Helvetica').fontSize(8).fillColor('#93C5FD')
    .text(formatFecha(prestamo.fecha), MARGIN + 8, y + 9, { width: COL_WIDTH - 16, align: 'right' });
  y += 26;
  drawRect(doc, MARGIN, y, COL_WIDTH, 24, COLORS_ORIG.rowAlt);
  const cantPrestada  = Number(prestamo.cantidad_prestada) || 1;
  const valorUnitario = !prestamo.imei
    ? formatCOP(Number(prestamo.valor_prestamo) / cantPrestada)
    : '—';

  const detalles = [
    { label: 'Sucursal',   val: prestamo.sucursal_nombre || '—' },
    { label: 'Línea',      val: prestamo.linea_nombre    || '—' },
    { label: 'IMEI',       val: prestamo.imei            || '—' },
    { label: 'Cantidad',   val: prestamo.imei ? '1' : String(cantPrestada) },
    { label: 'V. unitario', val: valorUnitario },
    { label: 'Empleado',   val: prestamo.empleado_nombre || '—' },
  ].filter((d) => d.val !== '—' || d.label === 'Sucursal');
  const colW = COL_WIDTH / detalles.length;
  detalles.forEach((d, i) => {
    const cx = MARGIN + i * colW;
    doc.font('Helvetica').fontSize(7).fillColor(COLORS_ORIG.textMuted)
      .text(d.label.toUpperCase(), cx + 6, y + 4, { width: colW - 8 });
    doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS_ORIG.text)
      .text(d.val, cx + 6, y + 13, { width: colW - 8 });
  });
  y += 24;
  const COL_FECHA = 120;
  const COL_VALOR = COL_WIDTH - COL_FECHA;
  drawRect(doc, MARGIN, y, COL_WIDTH, 18, '#334155');
  doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS_ORIG.white)
    .text('FECHA ABONO', MARGIN + 8, y + 5, { width: COL_FECHA - 8 });
  doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS_ORIG.white)
    .text('VALOR', MARGIN + COL_FECHA, y + 5, { width: COL_VALOR - 8, align: 'right' });
  y += 18;
  if (abonos.length === 0) {
    drawRect(doc, MARGIN, y, COL_WIDTH, 18, COLORS_ORIG.rowBase);
    doc.font('Helvetica').fontSize(8).fillColor(COLORS_ORIG.textMuted)
      .text('Sin abonos registrados', MARGIN + 8, y + 5, { width: COL_WIDTH - 16 });
    y += 18;
  } else {
    abonos.forEach((abono, idx) => {
      if (y > 730) { doc.addPage(); y = MARGIN; }
      const bgColor = idx % 2 === 0 ? COLORS_ORIG.rowBase : COLORS_ORIG.rowAlt;
      drawRect(doc, MARGIN, y, COL_WIDTH, 18, bgColor);
      doc.font('Helvetica').fontSize(8).fillColor(COLORS_ORIG.text)
        .text(formatFecha(abono.fecha), MARGIN + 8, y + 5, { width: COL_FECHA - 8 });
      doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS_ORIG.accent)
        .text(formatCOP(abono.valor), MARGIN + COL_FECHA, y + 5, { width: COL_VALOR - 8, align: 'right' });
      y += 18;
    });
  }
  drawRect(doc, MARGIN, y, COL_WIDTH, 28, COLORS_ORIG.totalBg);
  drawLine(doc, MARGIN, y, MARGIN + COL_WIDTH, y, COLORS_ORIG.accent, 1);
  const totalW = COL_WIDTH / 3;
  const saldo  = Number(prestamo.saldo_pendiente);
  doc.font('Helvetica').fontSize(7).fillColor(COLORS_ORIG.textMuted)
    .text('VALOR PRÉSTAMO', MARGIN + 6, y + 4, { width: totalW - 8 });
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS_ORIG.text)
    .text(formatCOP(prestamo.valor_prestamo), MARGIN + 6, y + 13, { width: totalW - 8 });
  doc.font('Helvetica').fontSize(7).fillColor(COLORS_ORIG.textMuted)
    .text('TOTAL ABONADO', MARGIN + totalW + 6, y + 4, { width: totalW - 8 });
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS_ORIG.greenDark)
    .text(formatCOP(prestamo.total_abonado), MARGIN + totalW + 6, y + 13, { width: totalW - 8 });
  doc.font('Helvetica').fontSize(7).fillColor(COLORS_ORIG.textMuted)
    .text('SALDO PENDIENTE', MARGIN + totalW * 2 + 6, y + 4, { width: totalW - 8 });
  doc.font('Helvetica-Bold').fontSize(9).fillColor(saldo > 0 ? COLORS_ORIG.redDark : COLORS_ORIG.greenDark)
    .text(formatCOP(saldo), MARGIN + totalW * 2 + 6, y + 13, { width: totalW - 8 });
  y += 28 + 14;
  return y;
};

const drawResumenGlobal = (doc, prestamos, y) => {
  if (y > 680) { doc.addPage(); y = MARGIN; }
  const totalValor   = prestamos.reduce((s, p) => s + Number(p.valor_prestamo),  0);
  const totalAbonado = prestamos.reduce((s, p) => s + Number(p.total_abonado),   0);
  const totalSaldo   = prestamos.reduce((s, p) => s + Number(p.saldo_pendiente), 0);
  drawLine(doc, MARGIN, y, MARGIN + COL_WIDTH, y, COLORS_ORIG.primary, 1.5);
  y += 10;
  drawRect(doc, MARGIN, y, COL_WIDTH, 46, COLORS_ORIG.primary);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS_ORIG.white)
    .text('RESUMEN GENERAL', MARGIN + 8, y + 6, { width: COL_WIDTH - 16 });
  const colW = COL_WIDTH / 3;
  doc.font('Helvetica').fontSize(7).fillColor('#93C5FD')
    .text('TOTAL PRESTADO', MARGIN + 6, y + 20, { width: colW - 8 });
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS_ORIG.white)
    .text(formatCOP(totalValor), MARGIN + 6, y + 29, { width: colW - 8 });
  doc.font('Helvetica').fontSize(7).fillColor('#93C5FD')
    .text('TOTAL ABONADO', MARGIN + colW + 6, y + 20, { width: colW - 8 });
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#6EE7B7')
    .text(formatCOP(totalAbonado), MARGIN + colW + 6, y + 29, { width: colW - 8 });
  doc.font('Helvetica').fontSize(7).fillColor('#93C5FD')
    .text('SALDO TOTAL', MARGIN + colW * 2 + 6, y + 20, { width: colW - 8 });
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#FCA5A5')
    .text(formatCOP(totalSaldo), MARGIN + colW * 2 + 6, y + 29, { width: colW - 8 });
  return y + 46;
};

const generarPdfPrestamosActivos = async ({ tipo, personaId, negocioId, negocioNombre, logoNegocio }) => {
  let prestamos;
  if (tipo === 'prestatario') {
    prestamos = await repo.findActivosPorPrestatario(personaId, negocioId);
  } else {
    prestamos = await repo.findActivosPorCliente(personaId, negocioId);
  }
  if (!prestamos.length) {
    const err = new Error('Esta persona no tiene préstamos activos');
    err.status = 404;
    throw err;
  }
  const prestamoIds       = prestamos.map((p) => p.id);
  const todosAbonos       = await repo.findAbonosPorPrestamos(prestamoIds);
  const abonosPorPrestamo = {};
  todosAbonos.forEach((a) => {
    if (!abonosPorPrestamo[a.prestamo_id]) abonosPorPrestamo[a.prestamo_id] = [];
    abonosPorPrestamo[a.prestamo_id].push(a);
  });
  const primerPrestamo = prestamos[0];
  const personaNombre  = tipo === 'prestatario'
    ? primerPrestamo.prestatario_nombre
    : primerPrestamo.cliente_nombre;
  const personaInfo = tipo === 'cliente'
    ? [
        primerPrestamo.cliente_cedula  ? `CC: ${primerPrestamo.cliente_cedula}`   : null,
        primerPrestamo.cliente_celular ? `Tel: ${primerPrestamo.cliente_celular}` : null,
      ].filter(Boolean).join('  ·  ')
    : null;
  const fechaGeneracion = new Date().toLocaleDateString('es-CO', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota',
  });
  const doc = new PDFDocument({
    size: 'A4', bufferPages: true,
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    info: {
      Title:   `Estado de cuenta — ${personaNombre}`,
      Author:  negocioNombre || 'Sistema de Préstamos',
      Subject: 'Préstamos activos',
    },
  });
  let y = drawHeader(doc, { negocioNombre, personaNombre, personaInfo, fechaGeneracion, logoNegocio });
  doc.font('Helvetica').fontSize(8).fillColor(COLORS_ORIG.textMuted)
    .text(
      `${prestamos.length} préstamo${prestamos.length !== 1 ? 's' : ''} activo${prestamos.length !== 1 ? 's' : ''}`,
      MARGIN, y, { width: COL_WIDTH }
    );
  y += 16;
  prestamos.forEach((prestamo, idx) => {
    const abonos = abonosPorPrestamo[prestamo.id] || [];
    y = drawPrestamo(doc, prestamo, abonos, idx, y);
  });
  y = drawResumenGlobal(doc, prestamos, y);
  const totalPages = doc.bufferedPageRange().count;
  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(i);
    drawLine(doc, MARGIN, 820, MARGIN + COL_WIDTH, 820, COLORS_ORIG.border, 0.5);
    doc.font('Helvetica').fontSize(7).fillColor(COLORS_ORIG.textMuted)
      .text(`${negocioNombre || 'Sistema de Préstamos'} — Generado el ${fechaGeneracion}`, MARGIN, 825, { width: COL_WIDTH / 2 });
    doc.font('Helvetica').fontSize(7).fillColor(COLORS_ORIG.textMuted)
      .text(`Página ${i + 1} de ${totalPages}`, MARGIN, 825, { width: COL_WIDTH, align: 'right' });
  }
  doc.end();
  return doc;
};

// ─────────────────────────────────────────────────────────────────────────────
// SECCIÓN 2: PDF de préstamo individual — estilo premium igual a facturas.pdf.js
// ─────────────────────────────────────────────────────────────────────────────

// ── Encabezado ────────────────────────────────────────────────────────────────

const _encabezadoIndividual = (doc, { negocioNombre, prestamo, fechaGeneracion, logoNegocio }) => {
  const HEADER_H = 80;

  rectFill(doc, 0, 0, PAGE_WIDTH, HEADER_H, C.headerBg, 0);
  doc.rect(0, HEADER_H - 3, PAGE_WIDTH, 3).fill(C.verde);

  const logoOffset = intentarLogoHeader(doc, logoNegocio, HEADER_H);
  const textX      = MARGIN + logoOffset;
  const textW      = COL_WIDTH * 0.55 - logoOffset;

  // Nombre del negocio
  doc.font(FONT.bold).fontSize(18).fillColor(C.headerText)
    .text(negocioNombre || 'Mi Negocio', textX, 16, { width: textW });
  doc.font(FONT.normal).fontSize(8.5).fillColor(C.headerSub)
    .text('Comprobante de Préstamo', textX, 40, { width: textW });

  // Número de préstamo (derecha)
  const numPrestamo = `#${String(prestamo.numero ?? prestamo.id).padStart(6, '0')}`;
  doc.font(FONT.bold).fontSize(22).fillColor(C.headerText)
    .text(numPrestamo, MARGIN, 14, { width: COL_WIDTH, align: 'right' });
  doc.font(FONT.normal).fontSize(8).fillColor(C.headerSub)
    .text('PRÉSTAMO', MARGIN, 40, { width: COL_WIDTH, align: 'right' });
  doc.font(FONT.normal).fontSize(8).fillColor(C.headerSub)
    .text(formatFechaHora(prestamo.fecha), MARGIN, 50, { width: COL_WIDTH, align: 'right' });

  // Badge de estado
  const estadoConf = {
    Activo:  { bg: C.azul,   texto: 'ACTIVO'   },
    Saldado: { bg: C.verde,  texto: 'SALDADO'  },
  };
  const est    = estadoConf[prestamo.estado] || { bg: C.gris, texto: (prestamo.estado || '').toUpperCase() };
  const badgeW = 68;
  const badgeX = PAGE_WIDTH - MARGIN - badgeW;
  rectFill(doc, badgeX, 58, badgeW, 16, est.bg, 4);
  doc.font(FONT.bold).fontSize(7).fillColor(C.blanco)
    .text(est.texto, badgeX, 62, { width: badgeW, align: 'center', characterSpacing: 0.8 });

  return HEADER_H + 16;
};

// ── Bloque prestatario ────────────────────────────────────────────────────────

const _bloquePrestatario = (doc, prestamo, y) => {
  const esCompanero  = !prestamo.cedula || prestamo.cedula === 'COMPANERO';
  const tieneTelefono = prestamo.telefono && prestamo.telefono !== '0000000000';
  const tieneEmpleado = !!prestamo.empleado_nombre;

  let lineasExtra = 0;
  if (!esCompanero)   lineasExtra += 1;
  if (tieneTelefono)  lineasExtra += 1;
  if (tieneEmpleado)  lineasExtra += 1;
  const altBloque = 32 + lineasExtra * 11;

  rectFillStroke(doc, MARGIN, y, COL_WIDTH, altBloque, C.grisFondo, C.grisBorde, 8);

  doc.font(FONT.bold).fontSize(7).fillColor(C.grisClaro)
    .text('PRESTATARIO', MARGIN + 14, y + 7, { characterSpacing: 1 });
  doc.font(FONT.bold).fontSize(12).fillColor(C.negro)
    .text(prestamo.prestatario || '—', MARGIN + 14, y + 18, { width: COL_WIDTH - 28 });

  let yDatos = y + 30;
  if (!esCompanero) {
    doc.font(FONT.normal).fontSize(8).fillColor(C.gris)
      .text(`CC: ${prestamo.cedula}`, MARGIN + 14, yDatos, { width: COL_WIDTH - 28 });
    yDatos += 11;
  }
  if (tieneTelefono) {
    doc.font(FONT.normal).fontSize(8).fillColor(C.gris)
      .text(`Tel: ${prestamo.telefono}`, MARGIN + 14, yDatos, { width: COL_WIDTH - 28 });
    yDatos += 11;
  }
  if (tieneEmpleado) {
    doc.font(FONT.normal).fontSize(7.5).fillColor(C.grisClaro)
      .text(`Empleado: ${prestamo.empleado_nombre}`, MARGIN + 14, yDatos, { width: COL_WIDTH - 28 });
  }

  return y + altBloque + 12;
};

// ── Tabla de datos del préstamo ───────────────────────────────────────────────

const _tablaDatosProducto = (doc, prestamo, y) => {
  y = labelSeccion(doc, y, 'Datos del préstamo');

  const campos = [
    { label: 'Producto',  val: prestamo.nombre_producto || '—' },
    { label: 'Línea',     val: prestamo.linea_nombre    || null },
    { label: 'IMEI',      val: prestamo.imei            || null },
    { label: 'Sucursal',  val: prestamo.sucursal_nombre || '—' },
    { label: 'Cantidad',  val: prestamo.imei ? '1' : String(prestamo.cantidad_prestada || 1) },
    { label: 'Fecha',     val: formatFechaHora(prestamo.fecha) },
  ].filter((c) => c.val);

  // Calcular altura total
  const altTotal = 22 + campos.length * 16;
  rectFillStroke(doc, MARGIN, y, COL_WIDTH, altTotal, C.blanco, C.grisBorde, 8);

  // Encabezado oscuro
  rectFill(doc, MARGIN, y, COL_WIDTH, 22, C.negro, 8);
  doc.rect(MARGIN, y + 12, COL_WIDTH, 10).fill(C.negro);
  doc.font(FONT.bold).fontSize(7.5).fillColor(C.blanco)
    .text('Campo', MARGIN + 14, y + 7, { width: COL_WIDTH * 0.4, characterSpacing: 0.5 });
  doc.font(FONT.bold).fontSize(7.5).fillColor(C.blanco)
    .text('Detalle', MARGIN + COL_WIDTH * 0.4, y + 7, { width: COL_WIDTH * 0.6 - 14, align: 'right', characterSpacing: 0.5 });

  let yFila = y + 22;
  campos.forEach((c, i) => {
    if (i > 0) hLine(doc, yFila, { color: C.grisBorde, width: 0.4 });
    const esPar = i % 2 === 1;
    if (esPar) doc.rect(MARGIN, yFila, COL_WIDTH, 16).fill('#F8FAFC');

    doc.font(FONT.normal).fontSize(8).fillColor(C.gris)
      .text(c.label, MARGIN + 14, yFila + 4, { width: COL_WIDTH * 0.4, lineBreak: false });
    doc.font(FONT.bold).fontSize(8).fillColor(C.negro)
      .text(c.val, MARGIN + COL_WIDTH * 0.4, yFila + 4, {
        width: COL_WIDTH * 0.6 - 14, align: 'right', lineBreak: false,
      });
    yFila += 16;
  });

  return y + altTotal + 12;
};

// ── Historial de abonos ───────────────────────────────────────────────────────

// ── Estado de la obligación, abonos y condiciones ────────────────────────────
//
// Estos tres bloques son EXACTAMENTE los mismos que imprime la factura a
// crédito (utils/obligacion.pdf.js). El comprobante de préstamo dejó de tener
// su propia tabla de abonos y su propio cálculo de saldo: ahora un préstamo y
// un crédito se ven y se calculan igual.


// ── Bloque de garantías del producto ─────────────────────────────────────────

const _bloqueGarantias = (doc, garantias, y) => {
  if (!garantias || garantias.length === 0) return y;

  y = labelSeccion(doc, y, 'Garantías del producto');

  garantias.forEach((g, i) => {

    const textoH = doc.font(FONT.normal).fontSize(8)
      .heightOfString(g.texto, { width: COL_WIDTH - 28 });
    const bloqueH = 20 + textoH + 8;

    rectFillStroke(doc, MARGIN, y, COL_WIDTH, bloqueH, i % 2 === 0 ? C.grisFondo : C.blanco, C.grisBorde, 6);

    doc.font(FONT.bold).fontSize(8.5).fillColor(C.negro)
      .text(g.titulo, MARGIN + 14, y + 6, { width: COL_WIDTH - 28 });
    doc.font(FONT.normal).fontSize(8).fillColor(C.grisOscuro)
      .text(g.texto, MARGIN + 14, y + 18, { width: COL_WIDTH - 28 });

    y += bloqueH + 4;
  });

  return y + 6;
};

// ── Pie de página ─────────────────────────────────────────────────────────────

const _pie = (doc, prestamoId, negocioNombre, fechaGeneracion, totalPages) => {
  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(i);
    hLine(doc, 820, { color: C.grisBorde, width: 0.5 });
    doc.font(FONT.normal).fontSize(7).fillColor(C.grisClaro)
      .text(
        `${negocioNombre || 'Sistema'} — Préstamo #${prestamoId} — ${fechaGeneracion}`,
        MARGIN, 825, { width: COL_WIDTH / 2 }
      );
    doc.font(FONT.normal).fontSize(7).fillColor(C.grisClaro)
      .text(`Página ${i + 1} de ${totalPages}`, MARGIN, 825, { width: COL_WIDTH, align: 'right' });
  }
};

// ── Función principal ─────────────────────────────────────────────────────────

const generarPdfPrestamoIndividual = async ({ prestamoId, negocioId, negocioNombre, logoNegocio }) => {
  const prestamo = await repo.findByIdYNegocio(prestamoId, negocioId);
  if (!prestamo) {
    const err = new Error('Préstamo no encontrado');
    err.status = 404;
    throw err;
  }
  if (prestamo.estado === 'Devuelto') {
    const err = new Error('Los préstamos devueltos no generan comprobante');
    err.status = 400;
    throw err;
  }

  const { rows: extra } = await pool.query(`
    SELECT
      p.*,
      su.nombre  AS sucursal_nombre,
      e.nombre   AS empleado_nombre,
      pr.nombre  AS prestatario_nombre,
      c.nombre   AS cliente_nombre,
      c.cedula   AS cliente_cedula,
      c.celular  AS cliente_celular,
      COALESCE(lps.nombre, lpc.nombre) AS linea_nombre
    FROM prestamos p
    JOIN  sucursales               su  ON su.id  = p.sucursal_id
    LEFT JOIN empleados_prestatario e   ON e.id   = p.empleado_id
    LEFT JOIN prestatarios          pr  ON pr.id  = p.prestatario_id
    LEFT JOIN clientes              c   ON c.id   = p.cliente_id
    LEFT JOIN seriales              s   ON s.imei = p.imei
    LEFT JOIN productos_serial      ps  ON ps.id  = s.producto_id AND ps.sucursal_id = p.sucursal_id
    LEFT JOIN lineas_producto       lps ON lps.id = ps.linea_id
    LEFT JOIN productos_cantidad    pc  ON pc.id  = p.producto_id AND p.imei IS NULL
    LEFT JOIN lineas_producto       lpc ON lpc.id = pc.linea_id
    WHERE p.id = $1
  `, [prestamoId]);

  const datos     = extra[0];
  const abonos    = await repo.getAbonos(prestamoId);
  const garantias = await repo.getGarantiasPorPrestamo(datos.imei, datos.producto_id, negocioId);

  // Estado de mora, solo si el préstamo tiene plazo pactado. Va en try/catch
  // porque la migración de mora puede no estar aplicada en una base vieja: el
  // comprobante debe salir igual, solo sin el bloque de condiciones.
  let mora = null;
  let interes = null;
  let moraMovimientos = [];
  // Basta con que exista CUALQUIERA de los dos pactos: un préstamo puede causar
  // interés sin tener fecha límite.
  if (datos.fecha_limite || datos.interes_condicion) {
    try {
      const moraService = require('../mora/mora.service');
      const estado = await moraService.estadoDe('prestamo', prestamoId, negocioId);
      mora    = estado.mora;
      interes = estado.interes;
      // Los cobros y condonaciones se imprimen en su propia tabla: el cliente
      // tiene que poder ver qué intereses se le cobraron y cuándo.
      moraMovimientos = estado.movimientos || [];
    } catch (err) {
      console.warn('[pdf-prestamo] Cargos no incluidos:', err.message);
    }
  }

  const fechaGeneracion = new Date().toLocaleDateString('es-CO', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota',
  });

  const doc = new PDFDocument({
    size: 'A4', bufferPages: true, margin: 0,
    info: {
      Title:  `Comprobante Préstamo #${prestamoId}`,
      Author: negocioNombre || 'Sistema de Préstamos',
    },
  });

  let y = _encabezadoIndividual(doc, { negocioNombre, prestamo: datos, fechaGeneracion, logoNegocio });
  y     = _bloquePrestatario(doc, datos, y);
  y     = _tablaDatosProducto(doc, datos, y);
  // Mismos bloques que la factura a crédito, alimentados por el mismo resumen.
  const resumen = resumirObligacion({
    tipo: 'prestamo', documento: datos, abonos, mora, interes, mora_movimientos: moraMovimientos,
  });
  y     = bloqueEstadoObligacion(doc, resumen, y, { titulo: 'Estado del préstamo' });
  y     = bloqueFechas(doc, resumen, y);
  y     = tablaAbonos(doc, resumen, y);
  y     = tablaMovimientosMora(doc, resumen, y);
  y     = bloqueCondiciones(doc, resumen, y);
  y     = _bloqueGarantias(doc, garantias, y);

  const totalPages = doc.bufferedPageRange().count;
  _pie(doc, prestamoId, negocioNombre, fechaGeneracion, totalPages);

  doc.end();
  return doc;
};

// ─────────────────────────────────────────────────────────────────────────────
// SECCIÓN 3: PDF estado de cuenta — 5 columnas igual que la cuadrícula web
// ─────────────────────────────────────────────────────────────────────────────
//
// El dibujo vive en utils/estadoCuenta.pdf.js (compartido con créditos) y los
// movimientos los calcula prestamos.service: aquí no se vuelve a acumular el
// saldo, para que el PDF no pueda diferir de lo que muestra la pantalla.

const { construirPdfEstadoCuenta } = require('../../utils/estadoCuenta.pdf');

const TIPO_LABEL = {
  prestamo:       { label: 'Préstamo',        bg: '#FFFBEB', text: '#D97706' },
  abono:          { label: 'Abono',           bg: '#ECFDF5', text: '#059669' },
  abono_total:    { label: 'Pago total',      bg: '#EEF2FF', text: '#4338CA' },
  pago_producto:  { label: 'Pago producto',   bg: '#EFF6FF', text: '#2563EB' },
  saldo_aplicado: { label: 'Saldo aplicado',  bg: '#F0FDFA', text: '#0D9488' },
  compra_directa: { label: 'Compra artículo', bg: '#F5F3FF', text: '#7C3AED' },
  // Mismos colores que en el estado de cuenta de créditos.
  mora_cobro:       { label: 'Mora',       bg: '#FEF2F2', text: '#DC2626' },
  mora_condonacion: { label: 'Mora cond.', bg: '#F3F4F6', text: '#6B7280' },
  interes_cobro:       { label: 'Interés',       bg: '#ECFDF5', text: '#0F766E' },
  interes_condonacion: { label: 'Interés cond.', bg: '#F3F4F6', text: '#6B7280' },
};

const generarPdfEstadoCuenta = async ({ tipo, personaId, negocioId, negocioNombre, logoNegocio, sucursalId = null }) => {
  // Datos de persona (prestatarios no tiene cedula/celular)
  const personaQuery = tipo === 'prestatario'
    ? `SELECT nombre, NULL AS cedula, NULL AS celular, telefono FROM prestatarios WHERE id = $1`
    : `SELECT nombre, cedula, celular, telefono           FROM clientes       WHERE id = $1`;
  const { rows: personaRows } = await pool.query(personaQuery, [personaId]);
  const persona = personaRows[0];
  if (!persona) {
    const err = new Error('Persona no encontrada');
    err.status = 404;
    throw err;
  }

  const { rows: configRows } = await pool.query(
    `SELECT clave, valor FROM config_negocio WHERE negocio_id = $1`,
    [negocioId]
  );
  const config = {};
  for (const row of configRows) config[row.clave] = row.valor;

  // Mismos movimientos que consume la pantalla.
  const service     = require('./prestamos.service');
  const movimientos = (await service.getEstadoCuenta(negocioId, tipo, personaId, sucursalId))
    .map((m) => {
      // Igual que en la pantalla: fuera del saldo va el préstamo devuelto, sus
      // abonos, y cualquier abono anulado del todo. Un pago total con solo una
      // PARTE anulada sigue contando por el resto, así que no se atenúa: se le
      // pone la nota diciendo cuánto de él no cuenta.
      const anuladoParcial = Number(m.valor_anulado || 0);
      const devuelto = m.anulado_total === true || m.prestamo_estado === 'Devuelto';
      // `nota` es el sufijo entre paréntesis del concepto. Lo usa el aviso
      // "Devuelto" y, cuando no aplica, la descripción que escribió el usuario
      // (hoy solo la del pago total): los dos casos nunca coinciden en la misma
      // fila, porque uno es de préstamos y el otro de abonos totales.
      return {
        ...m,
        nota:     m.anulado_total  ? (m.motivo_anulacion || 'Anulado')
                : anuladoParcial > 0 ? `${formatCOP(anuladoParcial)} no cuenta — ${m.motivo_anulacion || 'anulado'}`
                : devuelto           ? 'Devuelto'
                : (m.descripcion || null),
        atenuado: devuelto,
      };
    });

  const conSaldo   = movimientos.filter((m) => m.saldo != null);
  const saldoFinal = conSaldo.length ? conSaldo[conSaldo.length - 1].saldo : 0;

  return construirPdfEstadoCuenta({
    persona,
    subtitulo: tipo === 'prestatario' ? 'Prestatario' : 'Cliente',
    movimientos,
    saldoFinal,
    config,
    logoNegocio,
    tipoLabels: TIPO_LABEL,
    negocioNombre,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// SECCIÓN 4: Aviso de mora y paz y salvo — idénticos a los de créditos
// ─────────────────────────────────────────────────────────────────────────────

/** Carga el préstamo con su persona, abonos y mora, y arma el resumen. */
const _documentoPrestamo = async (prestamoId, negocioId) => {
  const prestamo = await repo.findByIdYNegocio(prestamoId, negocioId);
  if (!prestamo) {
    const err = new Error('Préstamo no encontrado');
    err.status = 404;
    throw err;
  }

  const { rows } = await pool.query(`
    SELECT p.*,
           COALESCE(pr.nombre, c.nombre, p.prestatario) AS persona_nombre,
           COALESCE(c.cedula,  p.cedula)                AS persona_cedula,
           COALESCE(c.celular, p.telefono)              AS persona_celular
    FROM prestamos p
    LEFT JOIN prestatarios pr ON pr.id = p.prestatario_id
    LEFT JOIN clientes     c  ON c.id  = p.cliente_id
    WHERE p.id = $1
  `, [prestamoId]);
  const datos = rows[0];

  const abonos = await repo.getAbonos(prestamoId);

  let mora = null;
  let interes = null;
  let moraMovimientos = [];
  if (datos.fecha_limite || datos.interes_condicion) {
    try {
      const moraService = require('../mora/mora.service');
      const estado = await moraService.estadoDe('prestamo', prestamoId, negocioId);
      mora    = estado.mora;
      interes = estado.interes;
      moraMovimientos = estado.movimientos || [];
    } catch (err) {
      console.warn('[pdf-prestamo] Cargos no incluidos:', err.message);
    }
  }

  const { rows: configRows } = await pool.query(
    `SELECT clave, valor FROM config_negocio WHERE negocio_id = $1`, [negocioId]);
  const config = {};
  for (const row of configRows) config[row.clave] = row.valor;

  const descripcion = [
    datos.nombre_producto,
    datos.imei ? `IMEI ${datos.imei}` : null,
    (!datos.imei && Number(datos.cantidad_prestada) > 1) ? `${datos.cantidad_prestada} unidades` : null,
  ].filter(Boolean).join(' · ');

  return {
    config,
    persona: {
      nombre:  datos.persona_nombre,
      cedula:  datos.persona_cedula !== 'COMPANERO' ? datos.persona_cedula : null,
      celular: datos.persona_celular !== '0000000000' ? datos.persona_celular : null,
    },
    resumen: resumirObligacion({
      tipo: 'prestamo', documento: datos, abonos, mora, interes, mora_movimientos: moraMovimientos,
    }),
    descripcion: descripcion || null,
  };
};

const generarPdfAvisoMoraPrestamo = async ({ prestamoId, negocioId }) => {
  const { config, persona, resumen, descripcion } = await _documentoPrestamo(prestamoId, negocioId);
  if (!resumen.vencido) {
    const err = new Error('Este préstamo no está vencido: no procede un aviso de mora');
    err.status = 400;
    throw err;
  }
  return generarAvisoMora({ config, persona, resumen, descripcion });
};

const generarPdfPazYSalvoPrestamo = async ({ prestamoId, negocioId }) => {
  const { config, persona, resumen, descripcion } = await _documentoPrestamo(prestamoId, negocioId);
  if (!resumen.pagada) {
    const err = new Error('El préstamo aún tiene saldo pendiente: no se puede expedir paz y salvo');
    err.status = 400;
    throw err;
  }
  return generarPazYSalvo({ config, persona, resumen, descripcion });
};

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  generarPdfPrestamosActivos, generarPdfPrestamoIndividual, generarPdfEstadoCuenta,
  generarPdfAvisoMoraPrestamo, generarPdfPazYSalvoPrestamo, _documentoPrestamo,
};