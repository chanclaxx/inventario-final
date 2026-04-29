'use strict';

const PDFDocument = require('pdfkit');
const { pool }    = require('../../config/db');
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
    day:      '2-digit',
    month:    '2-digit',
    year:     'numeric',
    timeZone: 'America/Bogota',
  });
};

// ─── Constantes de layout ─────────────────────────────────────────────────────

const MARGIN     = 50;
const PAGE_WIDTH = 595.28; // A4
const COL_WIDTH  = PAGE_WIDTH - MARGIN * 2;

const COLORS = {
  primary:    '#1E3A5F',
  accent:     '#2563EB',
  headerBg:   '#1E3A5F',
  rowAlt:     '#F1F5F9',
  rowBase:    '#FFFFFF',
  border:     '#CBD5E1',
  text:       '#1E293B',
  textMuted:  '#64748B',
  white:      '#FFFFFF',
  greenLight: '#D1FAE5',
  greenDark:  '#065F46',
  redLight:   '#FEE2E2',
  redDark:    '#991B1B',
  totalBg:    '#EFF6FF',
};

// ─── Primitivas de dibujo ─────────────────────────────────────────────────────

const drawRect = (doc, x, y, w, h, color) =>
  doc.save().rect(x, y, w, h).fill(color).restore();

const drawLine = (doc, x1, y1, x2, y2, color = COLORS.border, width = 0.5) =>
  doc.save().moveTo(x1, y1).lineTo(x2, y2).strokeColor(color).lineWidth(width).stroke().restore();

// ─────────────────────────────────────────────────────────────────────────────
// SECCIÓN 1: PDF por persona (préstamos activos — función original)
// ─────────────────────────────────────────────────────────────────────────────

const drawHeader = (doc, { negocioNombre, personaNombre, personaInfo, fechaGeneracion }) => {
  drawRect(doc, 0, 0, PAGE_WIDTH, 80, COLORS.headerBg);

  doc.font('Helvetica-Bold').fontSize(18).fillColor(COLORS.white)
    .text(negocioNombre || 'Mi Negocio', MARGIN, 22, { width: COL_WIDTH - 160 });

  doc.font('Helvetica').fontSize(8).fillColor('#94A3B8')
    .text(`Generado: ${fechaGeneracion}`, MARGIN, 55, { width: COL_WIDTH, align: 'right' });

  doc.font('Helvetica').fontSize(9).fillColor('#93C5FD')
    .text('Estado de cuenta — Préstamos activos', MARGIN, 45, { width: COL_WIDTH - 160 });

  const cardY = 95;
  drawRect(doc, MARGIN, cardY, COL_WIDTH, 52, COLORS.rowAlt);
  doc.save().rect(MARGIN, cardY, 4, 52).fill(COLORS.accent).restore();

  doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.text)
    .text(personaNombre, MARGIN + 14, cardY + 8, { width: COL_WIDTH - 20 });

  if (personaInfo) {
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.textMuted)
      .text(personaInfo, MARGIN + 14, cardY + 28, { width: COL_WIDTH - 20 });
  }

  return cardY + 52 + 20;
};

const drawPrestamo = (doc, prestamo, abonos, index, startY) => {
  let y = startY;

  if (y > 680) { doc.addPage(); y = MARGIN; }

  drawRect(doc, MARGIN, y, COL_WIDTH, 26, COLORS.primary);

  const titulo = `#${index + 1}  ${prestamo.nombre_producto}`;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.white)
    .text(titulo, MARGIN + 8, y + 7, { width: COL_WIDTH - 120 });
  doc.font('Helvetica').fontSize(8).fillColor('#93C5FD')
    .text(formatFecha(prestamo.fecha), MARGIN + 8, y + 9, { width: COL_WIDTH - 16, align: 'right' });
  y += 26;

  drawRect(doc, MARGIN, y, COL_WIDTH, 24, COLORS.rowAlt);

  const detalles = [
    { label: 'Sucursal', val: prestamo.sucursal_nombre || '—' },
    { label: 'IMEI',     val: prestamo.imei            || '—' },
    { label: 'Cantidad', val: prestamo.imei ? '1' : String(prestamo.cantidad_prestada || 1) },
    { label: 'Empleado', val: prestamo.empleado_nombre || '—' },
  ].filter((d) => d.val !== '—' || d.label === 'Sucursal');

  const colW = COL_WIDTH / detalles.length;
  detalles.forEach((d, i) => {
    const cx = MARGIN + i * colW;
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.textMuted)
      .text(d.label.toUpperCase(), cx + 6, y + 4, { width: colW - 8 });
    doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.text)
      .text(d.val, cx + 6, y + 13, { width: colW - 8 });
  });
  y += 24;

  const COL_FECHA = 120;
  const COL_VALOR = COL_WIDTH - COL_FECHA;

  drawRect(doc, MARGIN, y, COL_WIDTH, 18, '#334155');
  doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.white)
    .text('FECHA ABONO', MARGIN + 8, y + 5, { width: COL_FECHA - 8 });
  doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.white)
    .text('VALOR', MARGIN + COL_FECHA, y + 5, { width: COL_VALOR - 8, align: 'right' });
  y += 18;

  if (abonos.length === 0) {
    drawRect(doc, MARGIN, y, COL_WIDTH, 18, COLORS.rowBase);
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.textMuted)
      .text('Sin abonos registrados', MARGIN + 8, y + 5, { width: COL_WIDTH - 16 });
    y += 18;
  } else {
    abonos.forEach((abono, idx) => {
      if (y > 730) { doc.addPage(); y = MARGIN; }
      const bgColor = idx % 2 === 0 ? COLORS.rowBase : COLORS.rowAlt;
      drawRect(doc, MARGIN, y, COL_WIDTH, 18, bgColor);
      doc.font('Helvetica').fontSize(8).fillColor(COLORS.text)
        .text(formatFecha(abono.fecha), MARGIN + 8, y + 5, { width: COL_FECHA - 8 });
      doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.accent)
        .text(formatCOP(abono.valor), MARGIN + COL_FECHA, y + 5, { width: COL_VALOR - 8, align: 'right' });
      y += 18;
    });
  }

  drawRect(doc, MARGIN, y, COL_WIDTH, 28, COLORS.totalBg);
  drawLine(doc, MARGIN, y, MARGIN + COL_WIDTH, y, COLORS.accent, 1);

  const totalW = COL_WIDTH / 3;
  const saldo  = Number(prestamo.saldo_pendiente);

  doc.font('Helvetica').fontSize(7).fillColor(COLORS.textMuted)
    .text('VALOR PRÉSTAMO', MARGIN + 6, y + 4, { width: totalW - 8 });
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.text)
    .text(formatCOP(prestamo.valor_prestamo), MARGIN + 6, y + 13, { width: totalW - 8 });

  doc.font('Helvetica').fontSize(7).fillColor(COLORS.textMuted)
    .text('TOTAL ABONADO', MARGIN + totalW + 6, y + 4, { width: totalW - 8 });
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.greenDark)
    .text(formatCOP(prestamo.total_abonado), MARGIN + totalW + 6, y + 13, { width: totalW - 8 });

  doc.font('Helvetica').fontSize(7).fillColor(COLORS.textMuted)
    .text('SALDO PENDIENTE', MARGIN + totalW * 2 + 6, y + 4, { width: totalW - 8 });
  doc.font('Helvetica-Bold').fontSize(9).fillColor(saldo > 0 ? COLORS.redDark : COLORS.greenDark)
    .text(formatCOP(saldo), MARGIN + totalW * 2 + 6, y + 13, { width: totalW - 8 });

  y += 28 + 14;
  return y;
};

const drawResumenGlobal = (doc, prestamos, y) => {
  if (y > 680) { doc.addPage(); y = MARGIN; }

  const totalValor   = prestamos.reduce((s, p) => s + Number(p.valor_prestamo),  0);
  const totalAbonado = prestamos.reduce((s, p) => s + Number(p.total_abonado),   0);
  const totalSaldo   = prestamos.reduce((s, p) => s + Number(p.saldo_pendiente), 0);

  drawLine(doc, MARGIN, y, MARGIN + COL_WIDTH, y, COLORS.primary, 1.5);
  y += 10;

  drawRect(doc, MARGIN, y, COL_WIDTH, 46, COLORS.primary);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.white)
    .text('RESUMEN GENERAL', MARGIN + 8, y + 6, { width: COL_WIDTH - 16 });

  const colW = COL_WIDTH / 3;

  doc.font('Helvetica').fontSize(7).fillColor('#93C5FD')
    .text('TOTAL PRESTADO', MARGIN + 6, y + 20, { width: colW - 8 });
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.white)
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

const generarPdfPrestamosActivos = async ({ tipo, personaId, negocioId, negocioNombre }) => {
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

  const prestamoIds     = prestamos.map((p) => p.id);
  const todosAbonos     = await repo.findAbonosPorPrestamos(prestamoIds);
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
        primerPrestamo.cliente_cedula  ? `CC: ${primerPrestamo.cliente_cedula}`    : null,
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

  let y = drawHeader(doc, { negocioNombre, personaNombre, personaInfo, fechaGeneracion });

  doc.font('Helvetica').fontSize(8).fillColor(COLORS.textMuted)
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
    drawLine(doc, MARGIN, 820, MARGIN + COL_WIDTH, 820, COLORS.border, 0.5);
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.textMuted)
      .text(
        `${negocioNombre || 'Sistema de Préstamos'} — Documento generado el ${fechaGeneracion}`,
        MARGIN, 825, { width: COL_WIDTH / 2 }
      );
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.textMuted)
      .text(`Página ${i + 1} de ${totalPages}`, MARGIN, 825, { width: COL_WIDTH, align: 'right' });
  }

  doc.end();
  return doc;
};

// ─────────────────────────────────────────────────────────────────────────────
// SECCIÓN 2: PDF de préstamo individual
// ─────────────────────────────────────────────────────────────────────────────

const _drawHeaderIndividual = (doc, { negocioNombre, prestamo, fechaGeneracion }) => {
  drawRect(doc, 0, 0, PAGE_WIDTH, 80, COLORS.headerBg);

  doc.font('Helvetica-Bold').fontSize(18).fillColor(COLORS.white)
    .text(negocioNombre || 'Mi Negocio', MARGIN, 22, { width: COL_WIDTH - 160 });

  doc.font('Helvetica').fontSize(9).fillColor('#93C5FD')
    .text('Comprobante de Préstamo', MARGIN, 45, { width: COL_WIDTH - 160 });

  doc.font('Helvetica').fontSize(8).fillColor('#94A3B8')
    .text(`Generado: ${fechaGeneracion}`, MARGIN, 55, { width: COL_WIDTH, align: 'right' });

  const estadoColor = prestamo.estado === 'Saldado' ? '#D1FAE5' : prestamo.estado === 'Activo' ? '#DBEAFE' : '#F3F4F6';
  const estadoText  = prestamo.estado === 'Saldado' ? '#065F46' : prestamo.estado === 'Activo' ? '#1D4ED8' : '#374151';
  const badgeX      = PAGE_WIDTH - MARGIN - 80;
  drawRect(doc, badgeX, 20, 80, 22, estadoColor);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(estadoText)
    .text(prestamo.estado, badgeX, 27, { width: 80, align: 'center' });

  const cardY = 95;
  drawRect(doc, MARGIN, cardY, COL_WIDTH, 52, COLORS.rowAlt);
  doc.save().rect(MARGIN, cardY, 4, 52).fill(COLORS.accent).restore();

  doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.text)
    .text(prestamo.prestatario || '—', MARGIN + 14, cardY + 8, { width: COL_WIDTH - 20 });

  const infoLinea = [
    prestamo.cedula   && prestamo.cedula   !== 'COMPANERO'   ? `CC: ${prestamo.cedula}`    : null,
    prestamo.telefono && prestamo.telefono !== '0000000000'  ? `Tel: ${prestamo.telefono}` : null,
    prestamo.empleado_nombre ? `Empleado: ${prestamo.empleado_nombre}` : null,
  ].filter(Boolean).join('  ·  ');

  if (infoLinea) {
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.textMuted)
      .text(infoLinea, MARGIN + 14, cardY + 28, { width: COL_WIDTH - 20 });
  }

  return cardY + 52 + 16;
};

const _drawDatosProducto = (doc, prestamo, startY) => {
  let y = startY;

  drawRect(doc, MARGIN, y, COL_WIDTH, 26, COLORS.primary);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.white)
    .text('DATOS DEL PRÉSTAMO', MARGIN + 8, y + 8, { width: COL_WIDTH - 16 });
  y += 26;

  const campos = [
    { label: 'Producto', val: prestamo.nombre_producto || '—' },
    { label: 'IMEI',     val: prestamo.imei            || '—' },
    { label: 'Sucursal', val: prestamo.sucursal_nombre || '—' },
    { label: 'Fecha',    val: formatFecha(prestamo.fecha) },
    { label: 'Cantidad', val: prestamo.imei ? '1' : String(prestamo.cantidad_prestada || 1) },
  ].filter((c) => c.val !== '—');

  const colW = COL_WIDTH / 2;
  const rows = [];
  for (let i = 0; i < campos.length; i += 2) rows.push(campos.slice(i, i + 2));

  rows.forEach((fila, ri) => {
    const bg = ri % 2 === 0 ? COLORS.rowBase : COLORS.rowAlt;
    drawRect(doc, MARGIN, y, COL_WIDTH, 28, bg);
    fila.forEach((c, ci) => {
      const cx = MARGIN + ci * colW;
      doc.font('Helvetica').fontSize(7).fillColor(COLORS.textMuted)
        .text(c.label.toUpperCase(), cx + 8, y + 4, { width: colW - 12 });
      doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.text)
        .text(c.val, cx + 8, y + 14, { width: colW - 12 });
    });
    y += 28;
  });

  return y + 12;
};

const _drawTablaAbonos = (doc, abonos, startY) => {
  let y = startY;
  if (y > 680) { doc.addPage(); y = MARGIN; }

  drawRect(doc, MARGIN, y, COL_WIDTH, 26, COLORS.primary);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.white)
    .text('HISTORIAL DE ABONOS', MARGIN + 8, y + 8, { width: COL_WIDTH - 16 });
  y += 26;

  const COL_FECHA  = 130;
  const COL_METODO = 130;
  const COL_VALOR  = COL_WIDTH - COL_FECHA - COL_METODO;

  drawRect(doc, MARGIN, y, COL_WIDTH, 18, '#334155');
  doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.white)
    .text('FECHA',  MARGIN + 8,                     y + 5, { width: COL_FECHA  - 8 })
    .text('MÉTODO', MARGIN + COL_FECHA + 4,          y + 5, { width: COL_METODO - 8 })
    .text('VALOR',  MARGIN + COL_FECHA + COL_METODO, y + 5, { width: COL_VALOR  - 8, align: 'right' });
  y += 18;

  if (!abonos.length) {
    drawRect(doc, MARGIN, y, COL_WIDTH, 20, COLORS.rowBase);
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.textMuted)
      .text('Sin abonos registrados', MARGIN + 8, y + 6, { width: COL_WIDTH - 16 });
    y += 20;
  } else {
    abonos.forEach((abono, idx) => {
      if (y > 730) { doc.addPage(); y = MARGIN; }
      const bg = idx % 2 === 0 ? COLORS.rowBase : COLORS.rowAlt;
      drawRect(doc, MARGIN, y, COL_WIDTH, 20, bg);
      doc.font('Helvetica').fontSize(8).fillColor(COLORS.text)
        .text(formatFecha(abono.fecha),   MARGIN + 8,                     y + 6, { width: COL_FECHA  - 8 })
        .text(abono.metodo || 'Efectivo', MARGIN + COL_FECHA + 4,          y + 6, { width: COL_METODO - 8 });
      doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.accent)
        .text(formatCOP(abono.valor), MARGIN + COL_FECHA + COL_METODO, y + 6, { width: COL_VALOR - 8, align: 'right' });
      y += 20;
    });
  }

  return y + 12;
};

const _drawTotales = (doc, prestamo, startY) => {
  let y = startY;
  if (y > 700) { doc.addPage(); y = MARGIN; }

  const saldo = Number(prestamo.valor_prestamo) - Number(prestamo.total_abonado);

  drawLine(doc, MARGIN, y, MARGIN + COL_WIDTH, y, COLORS.accent, 1);
  y += 4;
  drawRect(doc, MARGIN, y, COL_WIDTH, 44, COLORS.totalBg);

  const colW = COL_WIDTH / 3;

  doc.font('Helvetica').fontSize(7).fillColor(COLORS.textMuted)
    .text('VALOR PRÉSTAMO', MARGIN + 8, y + 6, { width: colW - 12 });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.text)
    .text(formatCOP(prestamo.valor_prestamo), MARGIN + 8, y + 17, { width: colW - 12 });

  doc.font('Helvetica').fontSize(7).fillColor(COLORS.textMuted)
    .text('TOTAL ABONADO', MARGIN + colW + 8, y + 6, { width: colW - 12 });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.greenDark)
    .text(formatCOP(prestamo.total_abonado), MARGIN + colW + 8, y + 17, { width: colW - 12 });

  doc.font('Helvetica').fontSize(7).fillColor(COLORS.textMuted)
    .text('SALDO PENDIENTE', MARGIN + colW * 2 + 8, y + 6, { width: colW - 12 });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(saldo > 0 ? COLORS.redDark : COLORS.greenDark)
    .text(formatCOP(saldo), MARGIN + colW * 2 + 8, y + 17, { width: colW - 12 });

  return y + 44;
};

const generarPdfPrestamoIndividual = async ({ prestamoId, negocioId, negocioNombre }) => {
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
      c.celular  AS cliente_celular
    FROM prestamos p
    JOIN  sucursales               su ON su.id = p.sucursal_id
    LEFT JOIN empleados_prestatario e  ON e.id  = p.empleado_id
    LEFT JOIN prestatarios          pr ON pr.id = p.prestatario_id
    LEFT JOIN clientes              c  ON c.id  = p.cliente_id
    WHERE p.id = $1
  `, [prestamoId]);

  const datos = extra[0];
  const abonos = await repo.getAbonos(prestamoId);

  const fechaGeneracion = new Date().toLocaleDateString('es-CO', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota',
  });

  const doc = new PDFDocument({
    size: 'A4', bufferPages: true,
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    info: {
      Title:  `Comprobante Préstamo #${prestamoId}`,
      Author: negocioNombre || 'Sistema de Préstamos',
    },
  });

  let y = _drawHeaderIndividual(doc, { negocioNombre, prestamo: datos, fechaGeneracion });
  y     = _drawDatosProducto(doc, datos, y);
  y     = _drawTablaAbonos(doc, abonos, y);
  y     = _drawTotales(doc, datos, y);

  const totalPages = doc.bufferedPageRange().count;
  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(i);
    drawLine(doc, MARGIN, 820, MARGIN + COL_WIDTH, 820, COLORS.border, 0.5);
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.textMuted)
      .text(
        `${negocioNombre || 'Sistema'} — Préstamo #${prestamoId} — ${fechaGeneracion}`,
        MARGIN, 825, { width: COL_WIDTH / 2 }
      );
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.textMuted)
      .text(`Página ${i + 1} de ${totalPages}`, MARGIN, 825, { width: COL_WIDTH, align: 'right' });
  }

  doc.end();
  return doc;
};

// ─────────────────────────────────────────────────────────────────────────────

module.exports = { generarPdfPrestamosActivos, generarPdfPrestamoIndividual };