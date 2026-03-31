// src/modules/prestamos/prestamos.pdf.service.js
// ─────────────────────────────────────────────────────────────────────────────
// Genera el PDF de estado de cuenta de préstamos activos de una persona.
// Usa PDFKit (pdfkit). Instalar si no está: npm install pdfkit
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const PDFDocument = require('pdfkit');
const repo        = require('./prestamos.repository');

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
    day:   '2-digit',
    month: '2-digit',
    year:  'numeric',
    timeZone: 'America/Bogota',
  });
};

// ─── Constantes de layout ─────────────────────────────────────────────────────

const MARGIN      = 50;
const PAGE_WIDTH  = 595.28; // A4
const COL_WIDTH   = PAGE_WIDTH - MARGIN * 2;

const COLORS = {
  primary:     '#1E3A5F',
  accent:      '#2563EB',
  headerBg:    '#1E3A5F',
  rowAlt:      '#F1F5F9',
  rowBase:     '#FFFFFF',
  border:      '#CBD5E1',
  text:        '#1E293B',
  textMuted:   '#64748B',
  white:       '#FFFFFF',
  greenLight:  '#D1FAE5',
  greenDark:   '#065F46',
  redLight:    '#FEE2E2',
  redDark:     '#991B1B',
  totalBg:     '#EFF6FF',
};

// ─── Primitivas de dibujo ─────────────────────────────────────────────────────

const drawRect = (doc, x, y, w, h, color) => {
  doc.save().rect(x, y, w, h).fill(color).restore();
};

const drawLine = (doc, x1, y1, x2, y2, color = COLORS.border, width = 0.5) => {
  doc.save().moveTo(x1, y1).lineTo(x2, y2).strokeColor(color).lineWidth(width).stroke().restore();
};

// ─── Encabezado del documento ─────────────────────────────────────────────────

const drawHeader = (doc, { negocioNombre, personaNombre, personaInfo, fechaGeneracion }) => {
  // Barra superior azul
  drawRect(doc, 0, 0, PAGE_WIDTH, 80, COLORS.headerBg);

  // Nombre del negocio
  doc
    .font('Helvetica-Bold')
    .fontSize(18)
    .fillColor(COLORS.white)
    .text(negocioNombre || 'Mi Negocio', MARGIN, 22, { width: COL_WIDTH - 160 });

  // Fecha generación (derecha)
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#94A3B8')
    .text(`Generado: ${fechaGeneracion}`, MARGIN, 55, {
      width: COL_WIDTH,
      align: 'right',
    });

  // Subtítulo
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#93C5FD')
    .text('Estado de cuenta — Préstamos activos', MARGIN, 45, { width: COL_WIDTH - 160 });

  // Tarjeta de persona
  const cardY = 95;
  drawRect(doc, MARGIN, cardY, COL_WIDTH, 52, COLORS.rowAlt);
  doc.save().rect(MARGIN, cardY, 4, 52).fill(COLORS.accent).restore();

  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor(COLORS.text)
    .text(personaNombre, MARGIN + 14, cardY + 8, { width: COL_WIDTH - 20 });

  if (personaInfo) {
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(COLORS.textMuted)
      .text(personaInfo, MARGIN + 14, cardY + 28, { width: COL_WIDTH - 20 });
  }

  return cardY + 52 + 20; // y después del header
};

// ─── Tabla de préstamo individual ─────────────────────────────────────────────

/**
 * Dibuja la sección de un préstamo con su tabla de abonos.
 * Retorna la nueva posición Y.
 */
const drawPrestamo = (doc, prestamo, abonos, index, startY) => {
  let y = startY;

  // Si no hay espacio suficiente, nueva página
  if (y > 680) {
    doc.addPage();
    y = MARGIN;
  }

  // ── Encabezado del préstamo ──────────────────────────────────────────────
  drawRect(doc, MARGIN, y, COL_WIDTH, 26, COLORS.primary);

  const titulo = `#${index + 1}  ${prestamo.nombre_producto}`;
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(COLORS.white)
    .text(titulo, MARGIN + 8, y + 7, { width: COL_WIDTH - 120 });

  // Fecha del préstamo (derecha)
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#93C5FD')
    .text(formatFecha(prestamo.fecha), MARGIN + 8, y + 9, {
      width: COL_WIDTH - 16,
      align: 'right',
    });

  y += 26;

  // ── Fila de detalles del préstamo ────────────────────────────────────────
  drawRect(doc, MARGIN, y, COL_WIDTH, 24, COLORS.rowAlt);

  const detalles = [
    { label: 'Sucursal',  val: prestamo.sucursal_nombre || '—' },
    { label: 'IMEI',      val: prestamo.imei            || '—' },
    { label: 'Cantidad',  val: prestamo.imei ? '1' : String(prestamo.cantidad_prestada || 1) },
    { label: 'Empleado',  val: prestamo.empleado_nombre || '—' },
  ].filter((d) => d.val !== '—' || d.label === 'Sucursal');

  const colW = COL_WIDTH / detalles.length;
  detalles.forEach((d, i) => {
    const cx = MARGIN + i * colW;
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(COLORS.textMuted)
      .text(d.label.toUpperCase(), cx + 6, y + 4, { width: colW - 8 });
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(COLORS.text)
      .text(d.val, cx + 6, y + 13, { width: colW - 8 });
  });

  y += 24;

  // ── Tabla de abonos ──────────────────────────────────────────────────────
  const COL_FECHA = 120;
  const COL_VALOR = COL_WIDTH - COL_FECHA;

  // Encabezado tabla abonos
  drawRect(doc, MARGIN, y, COL_WIDTH, 18, '#334155');
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(COLORS.white)
    .text('FECHA ABONO', MARGIN + 8, y + 5, { width: COL_FECHA - 8 });
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(COLORS.white)
    .text('VALOR', MARGIN + COL_FECHA, y + 5, { width: COL_VALOR - 8, align: 'right' });

  y += 18;

  if (abonos.length === 0) {
    drawRect(doc, MARGIN, y, COL_WIDTH, 18, COLORS.rowBase);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(COLORS.textMuted)
      .text('Sin abonos registrados', MARGIN + 8, y + 5, { width: COL_WIDTH - 16 });
    y += 18;
  } else {
    abonos.forEach((abono, idx) => {
      // Salto de página si es necesario
      if (y > 730) {
        doc.addPage();
        y = MARGIN;
      }

      const bgColor = idx % 2 === 0 ? COLORS.rowBase : COLORS.rowAlt;
      drawRect(doc, MARGIN, y, COL_WIDTH, 18, bgColor);

      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(COLORS.text)
        .text(formatFecha(abono.fecha), MARGIN + 8, y + 5, { width: COL_FECHA - 8 });

      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor(COLORS.accent)
        .text(formatCOP(abono.valor), MARGIN + COL_FECHA, y + 5, {
          width: COL_VALOR - 8,
          align: 'right',
        });

      y += 18;
    });
  }

  // ── Totales del préstamo ─────────────────────────────────────────────────
  drawRect(doc, MARGIN, y, COL_WIDTH, 28, COLORS.totalBg);
  drawLine(doc, MARGIN, y, MARGIN + COL_WIDTH, y, COLORS.accent, 1);

  const totalW = COL_WIDTH / 3;

  // Valor total
  doc.font('Helvetica').fontSize(7).fillColor(COLORS.textMuted)
    .text('VALOR PRÉSTAMO', MARGIN + 6, y + 4, { width: totalW - 8 });
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.text)
    .text(formatCOP(prestamo.valor_prestamo), MARGIN + 6, y + 13, { width: totalW - 8 });

  // Total abonado
  doc.font('Helvetica').fontSize(7).fillColor(COLORS.textMuted)
    .text('TOTAL ABONADO', MARGIN + totalW + 6, y + 4, { width: totalW - 8 });
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.greenDark)
    .text(formatCOP(prestamo.total_abonado), MARGIN + totalW + 6, y + 13, { width: totalW - 8 });

  // Saldo pendiente
  const saldo = Number(prestamo.saldo_pendiente);
  doc.font('Helvetica').fontSize(7).fillColor(COLORS.textMuted)
    .text('SALDO PENDIENTE', MARGIN + totalW * 2 + 6, y + 4, { width: totalW - 8 });
  doc.font('Helvetica-Bold').fontSize(9).fillColor(saldo > 0 ? COLORS.redDark : COLORS.greenDark)
    .text(formatCOP(saldo), MARGIN + totalW * 2 + 6, y + 13, { width: totalW - 8 });

  y += 28 + 14; // espacio entre préstamos

  return y;
};

// ─── Resumen global al final ──────────────────────────────────────────────────

const drawResumenGlobal = (doc, prestamos, y) => {
  if (y > 680) { doc.addPage(); y = MARGIN; }

  const totalValor   = prestamos.reduce((s, p) => s + Number(p.valor_prestamo), 0);
  const totalAbonado = prestamos.reduce((s, p) => s + Number(p.total_abonado),  0);
  const totalSaldo   = prestamos.reduce((s, p) => s + Number(p.saldo_pendiente), 0);

  // Línea separadora
  drawLine(doc, MARGIN, y, MARGIN + COL_WIDTH, y, COLORS.primary, 1.5);
  y += 10;

  drawRect(doc, MARGIN, y, COL_WIDTH, 46, COLORS.primary);

  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.white)
    .text('RESUMEN GENERAL', MARGIN + 8, y + 6, { width: COL_WIDTH - 16 });

  const colW = COL_WIDTH / 3;

  // Total préstamos
  doc.font('Helvetica').fontSize(7).fillColor('#93C5FD')
    .text('TOTAL PRESTADO', MARGIN + 6, y + 20, { width: colW - 8 });
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.white)
    .text(formatCOP(totalValor), MARGIN + 6, y + 29, { width: colW - 8 });

  // Total abonado
  doc.font('Helvetica').fontSize(7).fillColor('#93C5FD')
    .text('TOTAL ABONADO', MARGIN + colW + 6, y + 20, { width: colW - 8 });
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#6EE7B7')
    .text(formatCOP(totalAbonado), MARGIN + colW + 6, y + 29, { width: colW - 8 });

  // Saldo total
  doc.font('Helvetica').fontSize(7).fillColor('#93C5FD')
    .text('SALDO TOTAL', MARGIN + colW * 2 + 6, y + 20, { width: colW - 8 });
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#FCA5A5')
    .text(formatCOP(totalSaldo), MARGIN + colW * 2 + 6, y + 29, { width: colW - 8 });

  return y + 46;
};

// ─── Función principal exportada ──────────────────────────────────────────────

/**
 * Genera un stream PDF con los préstamos activos de una persona.
 *
 * @param {'prestatario'|'cliente'} tipo
 * @param {number} personaId
 * @param {number} negocioId
 * @param {string} negocioNombre
 * @returns {Promise<PDFDocument>}  stream PDFKit listo para pipe
 */
const generarPdfPrestamosActivos = async ({ tipo, personaId, negocioId, negocioNombre }) => {
  // 1. Obtener préstamos activos
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

  // 2. Obtener todos los abonos en un solo query (evita N+1)
  const prestamoIds = prestamos.map((p) => p.id);
  const todosAbonos = await repo.findAbonosPorPrestamos(prestamoIds);

  // Agrupar abonos por prestamo_id para acceso O(1)
  const abonosPorPrestamo = {};
  todosAbonos.forEach((a) => {
    if (!abonosPorPrestamo[a.prestamo_id]) {
      abonosPorPrestamo[a.prestamo_id] = [];
    }
    abonosPorPrestamo[a.prestamo_id].push(a);
  });

  // 3. Construir datos de la persona
  const primerPrestamo = prestamos[0];
  const personaNombre  = tipo === 'prestatario'
    ? primerPrestamo.prestatario_nombre
    : primerPrestamo.cliente_nombre;

  const personaInfo = tipo === 'cliente'
    ? [
        primerPrestamo.cliente_cedula  ? `CC: ${primerPrestamo.cliente_cedula}`    : null,
        primerPrestamo.cliente_celular ? `Tel: ${primerPrestamo.cliente_celular}` : null,
      ].filter(Boolean).join('  ·  ')
    : null;

  const fechaGeneracion = new Date().toLocaleDateString('es-CO', {
    day:     '2-digit',
    month:   '2-digit',
    year:    'numeric',
    hour:    '2-digit',
    minute:  '2-digit',
    timeZone: 'America/Bogota',
  });

  // 4. Crear documento PDF
  // ⚠️ bufferPages: true es OBLIGATORIO para poder usar switchToPage() en el
  //    pie de página. Sin esto PDFKit hace flush de cada página al terminarla
  //    y switchToPage(i) lanza "out of bounds" en cualquier página ya cerrada.
  const doc = new PDFDocument({
    size:        'A4',
    bufferPages: true, // ← fix: mantiene todas las páginas en memoria hasta doc.end()
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    info: {
      Title:   `Estado de cuenta — ${personaNombre}`,
      Author:  negocioNombre || 'Sistema de Préstamos',
      Subject: 'Préstamos activos',
    },
  });

  // 5. Dibujar encabezado
  let y = drawHeader(doc, {
    negocioNombre,
    personaNombre,
    personaInfo,
    fechaGeneracion,
  });

  // Cantidad de préstamos activos
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(COLORS.textMuted)
    .text(
      `${prestamos.length} préstamo${prestamos.length !== 1 ? 's' : ''} activo${prestamos.length !== 1 ? 's' : ''}`,
      MARGIN, y,
      { width: COL_WIDTH }
    );
  y += 16;

  // 6. Dibujar cada préstamo
  prestamos.forEach((prestamo, idx) => {
    const abonos = abonosPorPrestamo[prestamo.id] || [];
    y = drawPrestamo(doc, prestamo, abonos, idx, y);
  });

  // 7. Resumen global
  y = drawResumenGlobal(doc, prestamos, y);

  // 8. Pie de página en cada página
  // Debe ir ANTES de doc.end() y DESPUÉS de todo el contenido,
  // ya que bufferedPageRange().count solo es exacto en este punto.
  const totalPages = doc.bufferedPageRange().count;
  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(i);
    drawLine(doc, MARGIN, 820, MARGIN + COL_WIDTH, 820, COLORS.border, 0.5);
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(COLORS.textMuted)
      .text(
        `${negocioNombre || 'Sistema de Préstamos'} — Documento generado el ${fechaGeneracion}`,
        MARGIN, 825,
        { width: COL_WIDTH / 2 }
      );
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(COLORS.textMuted)
      .text(
        `Página ${i + 1} de ${totalPages}`,
        MARGIN, 825,
        { width: COL_WIDTH, align: 'right' }
      );
  }

  // 9. Cerrar documento — siempre al final, después del loop del pie
  doc.end();
  return doc;
};

module.exports = { generarPdfPrestamosActivos };