'use strict';

/**
 * PDF de ESTADO DE CUENTA — compartido por préstamos y créditos.
 *
 * Este módulo solo DIBUJA. No consulta la base ni calcula saldos: recibe los
 * movimientos ya resueltos por el service del módulo correspondiente, que es la
 * única fuente de verdad del acumulado. Así el PDF no puede mostrar un número
 * distinto al de la pantalla.
 *
 * Cada movimiento debe traer:
 *   { fecha, tipo, concepto, cargo, abono, saldo, nota?, atenuado? }
 *   · `saldo` en null  → el movimiento no entra al acumulado (se pinta "—").
 *   · `nota`           → sufijo entre paréntesis en el concepto ("Devuelto"…).
 *   · `atenuado`       → se pinta en gris (documento anulado/devuelto).
 */

const PDFDocument = require('pdfkit');

// ─── Formato ─────────────────────────────────────────────────────────────────

const formatCOP = (valor) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: 0,
  }).format(Number(valor) || 0);

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

// ─── Layout y paleta (misma que facturas.pdf.js) ─────────────────────────────

const MARGIN     = 52;
const PAGE_WIDTH = 595.28;
const PAGE_H     = 841.89;
const COL_WIDTH  = PAGE_WIDTH - MARGIN * 2;

const FONT = { normal: 'Helvetica', bold: 'Helvetica-Bold' };

const C = {
  headerBg:   '#111827',
  headerText: '#FFFFFF',
  headerSub:  '#9CA3AF',
  negro:      '#111827',
  gris:       '#6B7280',
  grisClaro:  '#9CA3AF',
  grisFondo:  '#F9FAFB',
  grisBorde:  '#E5E7EB',
  blanco:     '#FFFFFF',
  verde:      '#059669',
  verdeFondo: '#ECFDF5',
  rojo:       '#DC2626',
  rojoFondo:  '#FEF2F2',
  naranja:    '#D97706',
};

const rectFill = (doc, x, y, w, h, color, radius = 6) =>
  doc.roundedRect(x, y, w, h, radius).fill(color);

const rectFillStroke = (doc, x, y, w, h, fillColor, strokeColor, radius = 6, lineWidth = 0.75) => {
  doc.roundedRect(x, y, w, h, radius).fillAndStroke(fillColor, strokeColor);
  doc.lineWidth(lineWidth);
};

const hLine = (doc, y, { x1 = MARGIN, x2 = PAGE_WIDTH - MARGIN, color = C.grisBorde, width = 0.5 } = {}) =>
  doc.moveTo(x1, y).lineTo(x2, y).strokeColor(color).lineWidth(width).stroke();

// ─── Bloques ─────────────────────────────────────────────────────────────────

const _encabezado = (doc, config, logoNegocio) => {
  const HEADER_H = 110;
  doc.roundedRect(0, 0, PAGE_WIDTH, HEADER_H, 0).fill(C.headerBg);

  let logoOffset = 0;
  if (logoNegocio) {
    try {
      const base64 = logoNegocio.replace(/^data:image\/[a-z+]+;base64,/, '');
      const buf = Buffer.from(base64, 'base64');
      if (buf.length) {
        doc.image(buf, MARGIN, Math.round((HEADER_H - 50) / 2), { fit: [50, 50] });
        logoOffset = 60;
      }
    } catch { /* sin logo */ }
  }

  const textX = MARGIN + logoOffset;
  const textW = COL_WIDTH - logoOffset;

  doc.font(FONT.bold).fontSize(18).fillColor(C.headerText)
    .text(config?.nombre_negocio || 'Mi Negocio', textX, 22, { width: textW });

  const sub = [config?.direccion, config?.telefono_negocio].filter(Boolean).join('  ·  ');
  if (sub) {
    doc.font(FONT.normal).fontSize(8).fillColor(C.headerSub)
      .text(sub, textX, 44, { width: textW });
  }

  doc.font(FONT.bold).fontSize(11).fillColor(C.headerText)
    .text('ESTADO DE CUENTA', PAGE_WIDTH - MARGIN - 150, 22, { width: 150, align: 'right' });
  doc.font(FONT.normal).fontSize(8).fillColor(C.headerSub)
    .text(`Generado: ${formatFechaHora(new Date())}`, PAGE_WIDTH - MARGIN - 150, 38, { width: 150, align: 'right' });

  return HEADER_H;
};

const _infoPersona = (doc, persona, subtitulo, saldoFinal, y) => {
  const H = 70;
  rectFillStroke(doc, MARGIN, y, COL_WIDTH, H, C.grisFondo, C.grisBorde, 8);

  const avSize = 38;
  const avX = MARGIN + 14;
  const avY = y + (H - avSize) / 2;
  rectFill(doc, avX, avY, avSize, avSize, saldoFinal > 0 ? C.rojoFondo : C.verdeFondo, 10);
  doc.font(FONT.bold).fontSize(13).fillColor(saldoFinal > 0 ? C.rojo : C.verde)
    .text((persona.nombre || '?').slice(0, 2).toUpperCase(), avX, avY + 11, { width: avSize, align: 'center' });

  const dataX = avX + avSize + 12;
  doc.font(FONT.bold).fontSize(11).fillColor(C.negro)
    .text(persona.nombre || '', dataX, y + 12, { width: 220 });
  doc.font(FONT.normal).fontSize(8).fillColor(C.gris)
    .text(subtitulo || '', dataX, y + 27);
  if (persona.cedula || persona.celular) {
    const datos = [persona.cedula && `CC: ${persona.cedula}`, persona.celular && `Tel: ${persona.celular}`]
      .filter(Boolean).join('  ·  ');
    doc.font(FONT.normal).fontSize(8).fillColor(C.gris).text(datos, dataX, y + 38);
  }

  const saldoX = PAGE_WIDTH - MARGIN - 14;
  doc.font(FONT.normal).fontSize(7.5).fillColor(C.grisClaro)
    .text('Saldo deuda', saldoX - 90, y + 18, { width: 90, align: 'right' });
  doc.font(FONT.bold).fontSize(12).fillColor(saldoFinal > 0 ? C.rojo : C.verde)
    .text(formatCOP(saldoFinal), saldoX - 90, y + 30, { width: 90, align: 'right' });

  return y + H + 12;
};

const _tabla = (doc, movimientos, tipoLabels, startY) => {
  // Fecha(62) + Justificación(199) + −(76) + +(76) + Saldo(86) = 499 = COL_WIDTH
  const cols = [
    { label: 'Fecha',         x: MARGIN,       w: 62,  align: 'left'  },
    { label: 'Justificación', x: MARGIN + 62,  w: 199, align: 'left'  },
    { label: '−',             x: MARGIN + 261, w: 76,  align: 'right' },
    { label: '+',             x: MARGIN + 337, w: 76,  align: 'right' },
    { label: 'Saldo',         x: MARGIN + 413, w: 86,  align: 'right' },
  ];

  const ROW_H       = 24;
  const HEAD_H      = 26;
  const PAGE_BOTTOM = PAGE_H - 60;
  let y = startY;

  const dibujarCabecera = (yy) => {
    rectFill(doc, MARGIN, yy, COL_WIDTH, HEAD_H, C.negro, 6);
    cols.forEach((col) => {
      const color = col.label === '−' ? C.verde : col.label === '+' ? C.naranja : C.blanco;
      doc.font(FONT.bold).fontSize(8).fillColor(color)
        .text(col.label, col.x + 4, yy + 9, { width: col.w - 8, align: col.align });
    });
    return yy + HEAD_H;
  };

  y = dibujarCabecera(y);

  const fallback = Object.values(tipoLabels)[0];

  movimientos.forEach((mov, i) => {
    if (y + ROW_H > PAGE_BOTTOM) {
      doc.addPage();
      y = MARGIN;
      y = dibujarCabecera(y);
    }

    const rowBg   = i % 2 === 0 ? C.blanco : C.grisFondo;
    rectFill(doc, MARGIN, y, COL_WIDTH, ROW_H, rowBg, 0);

    const esCargo = !!mov.cargo;
    const tipoCfg = tipoLabels[mov.tipo] || fallback;
    const badgeW  = 52;
    const badgeH  = 13;

    doc.font(FONT.normal).fontSize(7.5).fillColor(C.grisClaro)
      .text(formatFecha(mov.fecha), cols[0].x + 4, y + 8, { width: cols[0].w - 8, align: 'left' });

    rectFill(doc, cols[1].x + 4, y + (ROW_H - badgeH) / 2, badgeW, badgeH, tipoCfg.bg, 6);
    doc.font(FONT.bold).fontSize(6.5).fillColor(tipoCfg.text)
      .text(tipoCfg.label, cols[1].x + 4, y + (ROW_H - badgeH) / 2 + 3.5, { width: badgeW, align: 'center' });

    const conceptoTexto = mov.nota ? `${mov.concepto || ''} (${mov.nota})` : (mov.concepto || '');
    doc.font(FONT.normal).fontSize(8).fillColor(mov.atenuado ? C.grisClaro : C.negro)
      .text(conceptoTexto, cols[1].x + badgeW + 8, y + 8,
        { width: cols[1].w - badgeW - 12, align: 'left', ellipsis: true, height: ROW_H - 10 });

    // − abonos (reducen deuda)
    if (!esCargo) {
      doc.font(FONT.normal).fontSize(8).fillColor(C.verde)
        .text(formatCOP(mov.abono), cols[2].x + 4, y + 8, { width: cols[2].w - 8, align: 'right' });
    } else {
      doc.font(FONT.normal).fontSize(8).fillColor(C.grisBorde)
        .text('—', cols[2].x + 4, y + 8, { width: cols[2].w - 8, align: 'right' });
    }

    // + cargos (aumentan deuda)
    if (esCargo) {
      doc.font(FONT.normal).fontSize(8).fillColor(C.naranja)
        .text(formatCOP(mov.cargo), cols[3].x + 4, y + 8, { width: cols[3].w - 8, align: 'right' });
    } else {
      doc.font(FONT.normal).fontSize(8).fillColor(C.grisBorde)
        .text('—', cols[3].x + 4, y + 8, { width: cols[3].w - 8, align: 'right' });
    }

    if (mov.saldo != null) {
      doc.font(FONT.bold).fontSize(8).fillColor(mov.saldo > 0 ? C.rojo : C.verde)
        .text(formatCOP(mov.saldo), cols[4].x + 4, y + 8, { width: cols[4].w - 8, align: 'right' });
    } else {
      doc.font(FONT.normal).fontSize(8).fillColor(C.grisClaro)
        .text('—', cols[4].x + 4, y + 8, { width: cols[4].w - 8, align: 'right' });
    }

    hLine(doc, y + ROW_H, { x1: MARGIN, x2: PAGE_WIDTH - MARGIN, color: C.grisBorde });
    y += ROW_H;
  });

  doc.roundedRect(MARGIN, startY, COL_WIDTH, y - startY, 6).strokeColor(C.grisBorde).lineWidth(0.5).stroke();
  return y;
};

const _resumen = (doc, movimientos, saldoFinal, y) => {
  const totalCargos = movimientos.filter((m) => m.cargo).reduce((s, m) => s + Number(m.cargo), 0);
  const totalAbonos = movimientos.filter((m) => m.abono).reduce((s, m) => s + Number(m.abono), 0);
  const nCargos     = movimientos.filter((m) => m.cargo).length;
  const nAbonos     = movimientos.filter((m) => m.abono).length;

  y += 14;
  const H = 64;
  rectFillStroke(doc, MARGIN, y, COL_WIDTH, H, C.grisFondo, C.grisBorde, 8);

  doc.font(FONT.bold).fontSize(9).fillColor(C.negro).text('Resumen', MARGIN + 14, y + 10);

  const statW = (COL_WIDTH - 28) / 4;
  const stats = [
    { label: 'Movimientos',         value: String(movimientos.length), color: C.negro   },
    { label: `Cargos (${nCargos})`, value: formatCOP(totalCargos),     color: C.naranja },
    { label: `Abonos (${nAbonos})`, value: formatCOP(totalAbonos),     color: C.verde   },
    { label: 'Saldo final',         value: formatCOP(saldoFinal),      color: saldoFinal > 0 ? C.rojo : C.verde },
  ];

  stats.forEach((s, i) => {
    const sx = MARGIN + 14 + i * statW;
    doc.font(FONT.normal).fontSize(7.5).fillColor(C.grisClaro)
      .text(s.label, sx, y + 28, { width: statW - 4 });
    doc.font(FONT.bold).fontSize(9.5).fillColor(s.color)
      .text(s.value, sx, y + 40, { width: statW - 4 });
  });

  return y + H;
};

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * @param {object}   opts
 * @param {object}   opts.persona      — { nombre, cedula, celular }
 * @param {string}   opts.subtitulo    — 'Cliente' | 'Prestatario' …
 * @param {Array}    opts.movimientos  — ya calculados por el service del módulo
 * @param {number}   opts.saldoFinal   — saldo acumulado final
 * @param {object}   opts.config       — config_negocio como objeto clave→valor
 * @param {string}   [opts.logoNegocio]
 * @param {object}   opts.tipoLabels   — tipo → { label, bg, text }
 * @param {string}   [opts.negocioNombre]
 * @returns {PDFDocument} stream ya finalizado (doc.end() incluido)
 */
const construirPdfEstadoCuenta = ({
  persona, subtitulo, movimientos, saldoFinal,
  config, logoNegocio, tipoLabels, negocioNombre,
}) => {
  const doc = new PDFDocument({
    size: 'A4', margin: 0, bufferPages: true,
    info: { Title: `Estado de cuenta — ${persona.nombre}`, Author: negocioNombre || 'Mi Negocio' },
  });

  let y = _encabezado(doc, config, logoNegocio);
  y += 16;
  y  = _infoPersona(doc, persona, subtitulo, saldoFinal, y);

  if (movimientos.length === 0) {
    doc.font(FONT.normal).fontSize(10).fillColor(C.grisClaro)
      .text('Sin movimientos registrados.', MARGIN, y + 20, { width: COL_WIDTH, align: 'center' });
  } else {
    y += 4;
    doc.font(FONT.bold).fontSize(9).fillColor(C.negro).text('Movimientos', MARGIN, y);
    y += 14;
    y  = _tabla(doc, movimientos, tipoLabels, y);
    y  = _resumen(doc, movimientos, saldoFinal, y);
  }

  const totalPages = doc.bufferedPageRange().count;
  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(i);
    hLine(doc, PAGE_H - 44, { color: C.grisBorde });
    doc.font(FONT.normal).fontSize(7.5).fillColor(C.grisClaro)
      .text(`Página ${i + 1} de ${totalPages}`, MARGIN, PAGE_H - 38, { width: COL_WIDTH, align: 'right' });
  }

  doc.end();
  return doc;
};

module.exports = { construirPdfEstadoCuenta };
