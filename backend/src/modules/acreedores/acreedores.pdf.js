// src/modules/acreedores/acreedores.pdf.js
// Genera el estado de cuenta de un acreedor en PDF usando PDFKit.

const PDFDocument = require('pdfkit');

// ─── Paleta ──────────────────────────────────────────────────────────────────
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
  verdeBorde:   '#A7F3D0',
  rojo:         '#DC2626',
  rojoFondo:    '#FEF2F2',
  rojoBorde:    '#FECACA',
  naranja:      '#D97706',
  naranjaFondo: '#FFFBEB',
  naranjaBorde: '#FDE68A',
  morado:       '#7C3AED',
  moradoFondo:  '#F5F3FF',
  teal:         '#0D9488',
};

const FONT   = { normal: 'Helvetica', bold: 'Helvetica-Bold' };
const PAGE_W = 595.28;
const MARGIN = 48;
const CW     = PAGE_W - MARGIN * 2;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCOP(v) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(Number(v || 0));
}

function formatFecha(f) {
  if (!f) return '';
  return new Date(f).toLocaleDateString('es-CO', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function formatFechaHora(f) {
  if (!f) return '';
  return new Date(f).toLocaleString('es-CO', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function rectFill(doc, x, y, w, h, color, r = 5) {
  doc.roundedRect(x, y, w, h, r).fill(color);
}

function rectStroke(doc, x, y, w, h, color, r = 5, lw = 0.5) {
  doc.roundedRect(x, y, w, h, r).strokeColor(color).lineWidth(lw).stroke();
}

function hLine(doc, y, x1 = MARGIN, x2 = PAGE_W - MARGIN, color = C.grisBorde) {
  doc.moveTo(x1, y).lineTo(x2, y).strokeColor(color).lineWidth(0.5).stroke();
}

// Devuelve la etiqueta de tipo igual que el frontend
function resolverTipoLabel(mov) {
  if (mov.tipo === 'Cargo') return mov.compra_id ? 'Compra'          : 'Cargo';
  if (mov.tipo === 'Abono') return mov.cargo_id  ? 'Abono'           : 'Pago adelantado';
  return 'Abono';
}

// ─── Helper: logo en cabecera ─────────────────────────────────────────────────

function dibujarLogoHeader(doc, config, headerH) {
  const raw = config?.logo_negocio;
  if (!raw) return 0;
  try {
    const base64 = raw.replace(/^data:image\/[a-z+]+;base64,/, '');
    const buf = Buffer.from(base64, 'base64');
    if (!buf.length) return 0;
    const LOGO_MAX = 55;
    const logoY = Math.round((headerH - LOGO_MAX) / 2);
    doc.image(buf, MARGIN, logoY, { fit: [LOGO_MAX, LOGO_MAX], align: 'center', valign: 'center' });
    return LOGO_MAX + 10;
  } catch {
    return 0;
  }
}

// ─── Secciones ───────────────────────────────────────────────────────────────

function dibujarEncabezado(doc, config, acreedor, titulo = 'ESTADO DE CUENTA') {
  const nombreNegocio = config.nombre_negocio || 'Mi Negocio';

  // Determinar si el nombre es muy largo (ANTES de dibujar)
  const testWidth = CW * 0.45;
  const altNombreTest = doc.heightOfString(nombreNegocio, { width: testWidth, fontSize: 18 });
  const nombreMuyLargo = altNombreTest > 32;

  let HEADER_H = 110;
  let logoOffset = 0;

  // Calcular height primero
  if (nombreMuyLargo) {
    logoOffset = config?.logo_negocio ? 65 : 0;
    const altNombre = doc.heightOfString(nombreNegocio, { width: CW * 0.60 - logoOffset, fontSize: 16 });
    HEADER_H = Math.max(110, altNombre + 50);
  }

  // ─── DIBUJAR FONDO PRIMERO ─────────────────────────────────────────────────
  rectFill(doc, 0, 0, PAGE_W, HEADER_H, C.headerBg, 0);

  // ─── LUEGO DIBUJAR EL LOGO ENCIMA ──────────────────────────────────────────
  logoOffset = dibujarLogoHeader(doc, config, HEADER_H);

  // Calcular posiciones considerando logo
  let leftX, leftW, rightX, rightW;

  if (nombreMuyLargo) {
    // LAYOUT ALTERNATIVO: Nombre y datos ocupan 60% izquierda (considerando logo)
    leftX = MARGIN + logoOffset;
    leftW = CW * 0.60 - logoOffset;
    rightX = MARGIN + CW * 0.60 + 12;
    rightW = PAGE_W - rightX - MARGIN;
  } else {
    // LAYOUT NORMAL: Distribución 48-48 (considerando logo)
    leftX = MARGIN + logoOffset;
    leftW = CW * 0.48 - logoOffset;
    rightX = leftX + leftW + 12;
    rightW = PAGE_W - rightX - MARGIN;
  }

  const fontSizeNombre = nombreMuyLargo ? 16 : 18;
  const altNombre = doc.heightOfString(nombreNegocio, { width: leftW, fontSize: fontSizeNombre });

  doc.font(FONT.bold).fontSize(fontSizeNombre).fillColor(C.headerText)
    .text(nombreNegocio, leftX, 22, { width: leftW, lineBreak: true });

  const sub = [config.direccion, config.telefono_negocio].filter(Boolean).join('  ·  ');
  if (sub) {
    doc.font(FONT.normal).fontSize(8).fillColor(C.headerSub)
      .text(sub, leftX, 22 + altNombre + 4, { width: leftW });
  }

  doc.font(FONT.bold).fontSize(11).fillColor(C.headerText)
    .text(titulo, rightX, 22, { width: rightW, align: 'right' });

  doc.font(FONT.normal).fontSize(8).fillColor(C.headerSub)
    .text(`Generado: ${formatFechaHora(new Date())}`, rightX, 38, { width: rightW, align: 'right' });

  return HEADER_H;
}

function dibujarInfoAcreedor(doc, acreedor, saldoFinal, saldoAFavor, y) {
  const H = 76;
  rectFill(doc, MARGIN, y, CW, H, C.grisFondo);
  rectStroke(doc, MARGIN, y, CW, H, C.grisBorde);

  const avSize = 40;
  const avX = MARGIN + 14;
  const avY = y + (H - avSize) / 2;
  const avColor = saldoFinal > 0 ? '#FEE2E2' : '#D1FAE5';
  const avTextColor = saldoFinal > 0 ? C.rojo : C.verde;
  rectFill(doc, avX, avY, avSize, avSize, avColor, 10);
  doc.font(FONT.bold).fontSize(14).fillColor(avTextColor)
    .text((acreedor.nombre || '?').slice(0, 2).toUpperCase(), avX, avY + 12, { width: avSize, align: 'center' });

  const dataX = avX + avSize + 12;
  doc.font(FONT.bold).fontSize(11).fillColor(C.negro)
    .text(acreedor.nombre || '', dataX, y + 14, { width: 200 });
  doc.font(FONT.normal).fontSize(8).fillColor(C.gris)
    .text(`CC / NIT: ${acreedor.cedula || '—'}`, dataX, y + 30);
  if (acreedor.telefono) {
    doc.font(FONT.normal).fontSize(8).fillColor(C.gris)
      .text(`Tel: ${acreedor.telefono}`, dataX, y + 42);
  }

  const saldoX = PAGE_W - MARGIN - 14;
  if (saldoAFavor > 0) {
    doc.font(FONT.normal).fontSize(7.5).fillColor(C.verde)
      .text('Saldo a favor', saldoX - 90, y + 12, { width: 90, align: 'right' });
    doc.font(FONT.bold).fontSize(11).fillColor(C.verde)
      .text(formatCOP(saldoAFavor), saldoX - 90, y + 24, { width: 90, align: 'right' });
  }
  if (saldoFinal > 0) {
    doc.font(FONT.normal).fontSize(7.5).fillColor(C.gris)
      .text('Deuda total', saldoX - 90, saldoAFavor > 0 ? y + 46 : y + 22, { width: 90, align: 'right' });
    doc.font(FONT.bold).fontSize(12).fillColor(C.rojo)
      .text(formatCOP(saldoFinal), saldoX - 90, saldoAFavor > 0 ? y + 57 : y + 33, { width: 90, align: 'right' });
  }
  if (saldoFinal <= 0 && saldoAFavor === 0) {
    const bW = 58; const bX = saldoX - bW; const bY = y + (H - 22) / 2;
    rectFill(doc, bX, bY, bW, 22, C.verdeFondo, 11);
    rectStroke(doc, bX, bY, bW, 22, C.verdeBorde, 11);
    doc.font(FONT.bold).fontSize(8).fillColor(C.verde)
      .text('✓ Al día', bX, bY + 6.5, { width: bW, align: 'center' });
  }

  return y + H + 12;
}

// ─── Tabla principal: 5 columnas igual que la cuadrícula ─────────────────────

function dibujarTabla(doc, movimientos, startY) {
  // Fecha(62) + Justificación(197) + −(76) + +(76) + Saldo(88) = 499 = CW
  const cols = [
    { label: 'Fecha',         x: MARGIN,       w: 62,  align: 'left'  },
    { label: 'Justificación', x: MARGIN + 62,  w: 197, align: 'left'  },
    { label: '−',             x: MARGIN + 259, w: 76,  align: 'right' },
    { label: '+',             x: MARGIN + 335, w: 76,  align: 'right' },
    { label: 'Saldo',         x: MARGIN + 411, w: 88,  align: 'right' },
  ];

  const ROW_H      = 24;
  const HEAD_H     = 26;
  const PAGE_BOTTOM = 841.89 - 60;
  let y = startY;

  const dibujarCabecera = (yy) => {
    rectFill(doc, MARGIN, yy, CW, HEAD_H, C.negro, 6);
    cols.forEach((col) => {
      const isNeg = col.label === '−';
      const isPos = col.label === '+';
      const color = isNeg ? C.verde : isPos ? C.naranja : C.blanco;
      doc.font(FONT.bold).fontSize(8).fillColor(color)
        .text(col.label, col.x + 4, yy + 9, { width: col.w - 8, align: col.align });
    });
    return yy + HEAD_H;
  };

  y = dibujarCabecera(y);

  movimientos.forEach((mov, i) => {
    if (y + ROW_H > PAGE_BOTTOM) {
      doc.addPage();
      y = MARGIN;
      y = dibujarCabecera(y);
    }

    const rowBg = i % 2 === 0 ? C.blanco : C.grisFondo;
    rectFill(doc, MARGIN, y, CW, ROW_H, rowBg, 0);

    const esCargo = mov.tipo === 'Cargo';
    const saldo   = Number(mov.saldo_despues);
    const tipoLabel = resolverTipoLabel(mov);

    // Fecha
    doc.font(FONT.normal).fontSize(7.5).fillColor(C.grisClaro)
      .text(formatFecha(mov.fecha), cols[0].x + 4, y + 8, { width: cols[0].w - 8, align: 'left' });

    // Justificación: badge + descripción
    const badgeColors = {
      'Cargo':          { bg: C.naranjaFondo, text: C.naranja },
      'Compra':         { bg: C.moradoFondo,  text: C.morado  },
      'Abono':          { bg: C.verdeFondo,   text: C.verde   },
      'Pago adelantado':{ bg: '#F0FDFA',      text: C.teal    },
    };
    const bc = badgeColors[tipoLabel] || badgeColors['Abono'];
    const badgeW = 46; const badgeH = 13;
    rectFill(doc, cols[1].x + 4, y + (ROW_H - badgeH) / 2, badgeW, badgeH, bc.bg, 6);
    doc.font(FONT.bold).fontSize(6.5).fillColor(bc.text)
      .text(tipoLabel, cols[1].x + 4, y + (ROW_H - badgeH) / 2 + 3.5, { width: badgeW, align: 'center' });

    const desc = mov.descripcion
      || (mov.compra_id ? `Compra #${String(mov.compra_numero ?? mov.compra_id).padStart(5, '0')}` : tipoLabel);
    doc.font(FONT.normal).fontSize(8).fillColor(C.negro)
      .text(desc, cols[1].x + badgeW + 8, y + 8,
        { width: cols[1].w - badgeW - 12, align: 'left', ellipsis: true, height: ROW_H - 10 });

    // − (abonos)
    if (!esCargo) {
      doc.font(FONT.normal).fontSize(8).fillColor(C.verde)
        .text(formatCOP(mov.valor), cols[2].x + 4, y + 8, { width: cols[2].w - 8, align: 'right' });
    } else {
      doc.font(FONT.normal).fontSize(8).fillColor(C.grisBorde)
        .text('—', cols[2].x + 4, y + 8, { width: cols[2].w - 8, align: 'right' });
    }

    // + (cargos)
    if (esCargo) {
      doc.font(FONT.normal).fontSize(8).fillColor(C.naranja)
        .text(formatCOP(mov.valor), cols[3].x + 4, y + 8, { width: cols[3].w - 8, align: 'right' });
    } else {
      doc.font(FONT.normal).fontSize(8).fillColor(C.grisBorde)
        .text('—', cols[3].x + 4, y + 8, { width: cols[3].w - 8, align: 'right' });
    }

    // Saldo
    const saldoColor = saldo > 0 ? C.rojo : C.verde;
    doc.font(FONT.bold).fontSize(8).fillColor(saldoColor)
      .text(formatCOP(saldo), cols[4].x + 4, y + 8, { width: cols[4].w - 8, align: 'right' });

    hLine(doc, y + ROW_H, MARGIN, PAGE_W - MARGIN, C.grisBorde);
    y += ROW_H;
  });

  rectStroke(doc, MARGIN, startY, CW, y - startY, C.grisBorde, 6);
  return y;
}

function dibujarResumen(doc, movimientos, saldoFinal, saldoAFavor, y) {
  const totalCargos  = movimientos.filter((m) => m.tipo === 'Cargo').reduce((s, m) => s + Number(m.valor), 0);
  const totalAbonos  = movimientos.filter((m) => m.tipo === 'Abono').reduce((s, m) => s + Number(m.valor), 0);
  const nCargos      = movimientos.filter((m) => m.tipo === 'Cargo').length;
  const nAbonos      = movimientos.filter((m) => m.tipo === 'Abono').length;

  y += 16;
  const H = 68;
  rectFill(doc, MARGIN, y, CW, H, C.grisFondo);
  rectStroke(doc, MARGIN, y, CW, H, C.grisBorde);

  doc.font(FONT.bold).fontSize(9).fillColor(C.negro)
    .text('Resumen', MARGIN + 14, y + 10);

  const statW = (CW - 28) / 4;
  const stats = [
    { label: 'Total movimientos', value: String(movimientos.length),  color: C.negro   },
    { label: `Cargos (${nCargos})`, value: formatCOP(totalCargos),   color: C.naranja  },
    { label: `Abonos (${nAbonos})`, value: formatCOP(totalAbonos),   color: C.verde    },
    { label: 'Saldo final',        value: formatCOP(saldoFinal),     color: saldoFinal > 0 ? C.rojo : C.verde },
  ];

  stats.forEach((s, i) => {
    const sx = MARGIN + 14 + i * statW;
    doc.font(FONT.normal).fontSize(7.5).fillColor(C.grisClaro)
      .text(s.label, sx, y + 28, { width: statW - 4 });
    doc.font(FONT.bold).fontSize(9.5).fillColor(s.color)
      .text(s.value, sx, y + 41, { width: statW - 4 });
  });

  return y + H;
}

function dibujarPiePagina(doc) {
  const range = doc.bufferedPageRange ? doc.bufferedPageRange() : { start: 0, count: 1 };
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font(FONT.normal).fontSize(7.5).fillColor(C.grisClaro)
      .text(`Página ${i + 1} de ${range.count}`, MARGIN, 841.89 - 38, { width: CW, align: 'right' });
    hLine(doc, 841.89 - 44, MARGIN, PAGE_W - MARGIN, C.grisBorde);
  }
}

// ─── Función principal ───────────────────────────────────────────────────────

function generarPdfCuentaAcreedor({ acreedor, movimientos, saldoAFavor, config, res }) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });

  res.setHeader('Content-Type', 'application/pdf');
  const nombre = (acreedor.nombre || 'acreedor').replace(/\s+/g, '_').toLowerCase();
  res.setHeader('Content-Disposition', `attachment; filename="cuenta_${nombre}.pdf"`);
  doc.pipe(res);

  const saldoFinal = movimientos.length > 0
    ? Number(movimientos[movimientos.length - 1].saldo_despues)
    : 0;

  let y = dibujarEncabezado(doc, config, acreedor);

  y += 16;
  y = dibujarInfoAcreedor(doc, acreedor, saldoFinal, Number(saldoAFavor || 0), y);

  if (movimientos.length === 0) {
    doc.font(FONT.normal).fontSize(10).fillColor(C.grisClaro)
      .text('No hay movimientos registrados para este acreedor.', MARGIN, y + 20, { width: CW, align: 'center' });
  } else {
    y += 4;
    doc.font(FONT.bold).fontSize(9).fillColor(C.negro)
      .text('Movimientos', MARGIN, y);
    y += 14;
    y = dibujarTabla(doc, movimientos, y);
    y = dibujarResumen(doc, movimientos, saldoFinal, Number(saldoAFavor || 0), y);
  }

  dibujarPiePagina(doc);
  doc.end();
}

// ─── Formato 2: Resumen de deuda (cargos pendientes) ─────────────────────────

function dibujarTablaCargos(doc, cargos, startY) {
  // Fecha(60) + Descripción(195) + Valor(84) + Abonado(84) + Pendiente(76) = 499 = CW
  const cols = [
    { label: 'Fecha',       x: MARGIN,       w: 60,  align: 'left'  },
    { label: 'Descripción', x: MARGIN + 60,  w: 195, align: 'left'  },
    { label: 'Valor',       x: MARGIN + 255, w: 84,  align: 'right' },
    { label: 'Abonado',     x: MARGIN + 339, w: 84,  align: 'right' },
    { label: 'Pendiente',   x: MARGIN + 423, w: 76,  align: 'right' },
  ];
  const ROW_H = 22, HEAD_H = 24, PAGE_BOTTOM = 841.89 - 60;
  let y = startY;

  const cabecera = (yy) => {
    rectFill(doc, MARGIN, yy, CW, HEAD_H, C.negro, 6);
    cols.forEach((col) => {
      doc.font(FONT.bold).fontSize(8).fillColor(C.blanco)
        .text(col.label, col.x + 4, yy + 8, { width: col.w - 8, align: col.align });
    });
    return yy + HEAD_H;
  };
  y = cabecera(y);

  cargos.forEach((c, i) => {
    if (y + ROW_H > PAGE_BOTTOM) { doc.addPage(); y = cabecera(MARGIN); }
    rectFill(doc, MARGIN, y, CW, ROW_H, i % 2 === 0 ? C.blanco : C.grisFondo, 0);

    const desc = c.descripcion
      || (c.compra_id ? `Compra #${String(c.compra_numero ?? c.compra_id).padStart(5, '0')}` : 'Cargo');

    doc.font(FONT.normal).fontSize(7.5).fillColor(C.grisClaro)
      .text(formatFecha(c.fecha), cols[0].x + 4, y + 7, { width: cols[0].w - 8 });
    doc.font(FONT.normal).fontSize(8).fillColor(C.negro)
      .text(desc, cols[1].x + 4, y + 7, { width: cols[1].w - 8, ellipsis: true, height: ROW_H - 8 });
    doc.font(FONT.normal).fontSize(8).fillColor(C.gris)
      .text(formatCOP(c.valor_original), cols[2].x + 4, y + 7, { width: cols[2].w - 8, align: 'right' });
    doc.font(FONT.normal).fontSize(8).fillColor(C.verde)
      .text(formatCOP(c.total_abonado), cols[3].x + 4, y + 7, { width: cols[3].w - 8, align: 'right' });
    doc.font(FONT.bold).fontSize(8).fillColor(C.rojo)
      .text(formatCOP(c.saldo_pendiente), cols[4].x + 4, y + 7, { width: cols[4].w - 8, align: 'right' });

    hLine(doc, y + ROW_H, MARGIN, PAGE_W - MARGIN, C.grisBorde);
    y += ROW_H;
  });

  rectStroke(doc, MARGIN, startY, CW, y - startY, C.grisBorde, 6);
  return y;
}

function generarPdfResumenDeuda({ acreedor, cargos, saldoAFavor, config, res }) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  const nombre = (acreedor.nombre || 'acreedor').replace(/\s+/g, '_').toLowerCase();
  res.setHeader('Content-Disposition', `attachment; filename="deuda_${nombre}.pdf"`);
  doc.pipe(res);

  const pendientes = cargos.filter((c) => Number(c.saldo_pendiente) > 0);
  const saldoTotal = pendientes.reduce((s, c) => s + Number(c.saldo_pendiente), 0);

  let y = dibujarEncabezado(doc, config, acreedor, 'RESUMEN DE DEUDA');
  y += 16;
  y = dibujarInfoAcreedor(doc, acreedor, saldoTotal, Number(saldoAFavor || 0), y);

  if (pendientes.length === 0) {
    doc.font(FONT.normal).fontSize(10).fillColor(C.grisClaro)
      .text('Este acreedor no tiene cargos pendientes. ✓', MARGIN, y + 20, { width: CW, align: 'center' });
  } else {
    y += 4;
    doc.font(FONT.bold).fontSize(9).fillColor(C.negro)
      .text(`Cargos pendientes (${pendientes.length})`, MARGIN, y);
    y += 14;
    y = dibujarTablaCargos(doc, pendientes, y);

    // Total
    y += 14;
    const H = 40;
    rectFill(doc, MARGIN, y, CW, H, C.grisFondo);
    rectStroke(doc, MARGIN, y, CW, H, C.grisBorde);
    doc.font(FONT.bold).fontSize(9).fillColor(C.negro)
      .text('Deuda total pendiente', MARGIN + 14, y + 14);
    doc.font(FONT.bold).fontSize(13).fillColor(C.rojo)
      .text(formatCOP(saldoTotal), PAGE_W - MARGIN - 160, y + 11, { width: 146, align: 'right' });
  }

  dibujarPiePagina(doc);
  doc.end();
}

module.exports = { generarPdfCuentaAcreedor, generarPdfResumenDeuda };
