// src/modules/acreedores/acreedores.pdf.js
// Genera el estado de cuenta de un acreedor en PDF usando PDFKit.

const PDFDocument = require('pdfkit');

// ─── Paleta ──────────────────────────────────────────────────────────────────
const C = {
  headerBg:    '#111827',
  headerText:  '#FFFFFF',
  headerSub:   '#9CA3AF',
  negro:       '#111827',
  grisOscuro:  '#374151',
  gris:        '#6B7280',
  grisClaro:   '#9CA3AF',
  grisFondo:   '#F9FAFB',
  grisBorde:   '#E5E7EB',
  blanco:      '#FFFFFF',
  verde:       '#059669',
  verdeFondo:  '#ECFDF5',
  verdeBorde:  '#A7F3D0',
  rojo:        '#DC2626',
  rojoFondo:   '#FEF2F2',
  rojoBorde:   '#FECACA',
  naranja:     '#D97706',
  naranjaFondo:'#FFFBEB',
  naranjaBorde:'#FDE68A',
  azul:        '#2563EB',
  azulFondo:   '#EFF6FF',
  azulBorde:   '#BFDBFE',
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
    year: 'numeric', month: '2-digit', day: '2-digit',
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

// Texto con alineación, retorna alto de caja
function texto(doc, x, y, w, str, { font = FONT.normal, size = 9, color = C.negro, align = 'left', lineGap = 2 } = {}) {
  doc.font(font).fontSize(size).fillColor(color);
  doc.text(String(str ?? ''), x, y, { width: w, align, lineGap });
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

function dibujarEncabezado(doc, config, acreedor, saldoTotal, saldoAFavor) {
  const HEADER_H = 110;
  // Fondo oscuro
  rectFill(doc, 0, 0, PAGE_W, HEADER_H, C.headerBg, 0);

  // Logo (opcional)
  const logoOffset = dibujarLogoHeader(doc, config, HEADER_H);
  const textX = MARGIN + logoOffset;
  const textW = CW - logoOffset;

  // Nombre del negocio
  doc.font(FONT.bold).fontSize(18).fillColor(C.headerText)
    .text(config.nombre_negocio || 'Mi Negocio', textX, 22, { width: textW });

  // Subtítulo
  const sub = [config.direccion, config.telefono_negocio].filter(Boolean).join('  ·  ');
  if (sub) {
    doc.font(FONT.normal).fontSize(8).fillColor(C.headerSub)
      .text(sub, textX, 44, { width: textW });
  }

  // Título del documento
  doc.font(FONT.bold).fontSize(11).fillColor(C.headerText)
    .text('ESTADO DE CUENTA', PAGE_W - MARGIN - 150, 22, { width: 150, align: 'right' });

  doc.font(FONT.normal).fontSize(8).fillColor(C.headerSub)
    .text(`Generado: ${formatFechaHora(new Date())}`, PAGE_W - MARGIN - 150, 38, { width: 150, align: 'right' });

  return 110;
}

function dibujarInfoAcreedor(doc, acreedor, saldoTotal, saldoAFavor, y) {
  const H = 76;
  rectFill(doc, MARGIN, y, CW, H, C.grisFondo);
  rectStroke(doc, MARGIN, y, CW, H, C.grisBorde);

  // Avatar
  const avSize = 40;
  const avX = MARGIN + 14;
  const avY = y + (H - avSize) / 2;
  const avColor = saldoTotal > 0 ? '#FEE2E2' : '#D1FAE5';
  const avTextColor = saldoTotal > 0 ? C.rojo : C.verde;
  rectFill(doc, avX, avY, avSize, avSize, avColor, 10);
  doc.font(FONT.bold).fontSize(14).fillColor(avTextColor)
    .text((acreedor.nombre || '?').slice(0, 2).toUpperCase(), avX, avY + 12, { width: avSize, align: 'center' });

  // Datos del acreedor
  const dataX = avX + avSize + 12;
  doc.font(FONT.bold).fontSize(11).fillColor(C.negro)
    .text(acreedor.nombre || '', dataX, y + 14, { width: 200 });
  doc.font(FONT.normal).fontSize(8).fillColor(C.gris)
    .text(`CC / NIT: ${acreedor.cedula || '—'}`, dataX, y + 30);
  if (acreedor.telefono) {
    doc.font(FONT.normal).fontSize(8).fillColor(C.gris)
      .text(`Tel: ${acreedor.telefono}`, dataX, y + 42);
  }

  // Saldos a la derecha
  const saldoX = PAGE_W - MARGIN - 14;
  if (saldoAFavor > 0) {
    doc.font(FONT.normal).fontSize(7.5).fillColor(C.verde)
      .text('Saldo a favor', saldoX - 90, y + 12, { width: 90, align: 'right' });
    doc.font(FONT.bold).fontSize(11).fillColor(C.verde)
      .text(formatCOP(saldoAFavor), saldoX - 90, y + 24, { width: 90, align: 'right' });
  }
  if (saldoTotal > 0) {
    doc.font(FONT.normal).fontSize(7.5).fillColor(C.gris)
      .text('Deuda total', saldoX - 90, saldoAFavor > 0 ? y + 46 : y + 22, { width: 90, align: 'right' });
    doc.font(FONT.bold).fontSize(12).fillColor(C.rojo)
      .text(formatCOP(saldoTotal), saldoX - 90, saldoAFavor > 0 ? y + 57 : y + 33, { width: 90, align: 'right' });
  }
  if (saldoTotal === 0 && saldoAFavor === 0) {
    // Badge "Al día"
    const bW = 58; const bX = saldoX - bW; const bY = y + (H - 22) / 2;
    rectFill(doc, bX, bY, bW, 22, C.verdeFondo, 11);
    rectStroke(doc, bX, bY, bW, 22, C.verdeBorde, 11);
    doc.font(FONT.bold).fontSize(8).fillColor(C.verde)
      .text('✓ Al día', bX, bY + 6.5, { width: bW, align: 'center' });
  }

  return y + H + 12;
}

function dibujarTabla(doc, cargos, startY) {
  // Cabeceras de tabla
  const cols = [
    { label: 'Fecha',        x: MARGIN,          w: 68  },
    { label: 'Descripción',  x: MARGIN + 68,     w: 148 },
    { label: 'Original',     x: MARGIN + 216,    w: 76  },
    { label: 'Abonado',      x: MARGIN + 292,    w: 76  },
    { label: 'Pendiente',    x: MARGIN + 368,    w: 76  },
    { label: 'Estado',       x: MARGIN + 444,    w: 55  },
  ];

  const ROW_H  = 26;
  const HEAD_H = 26;
  let y = startY;

  const PAGE_BOTTOM = 841.89 - 60;

  const dibujarCabecera = (yy) => {
    rectFill(doc, MARGIN, yy, CW, HEAD_H, C.negro, 6);
    for (const col of cols) {
      doc.font(FONT.bold).fontSize(7.5).fillColor(C.blanco)
        .text(col.label, col.x + 4, yy + 8.5, { width: col.w - 8, align: col.label === 'Descripción' ? 'left' : 'right' });
    }
    return yy + HEAD_H;
  };

  y = dibujarCabecera(y);

  const estadoCfg = {
    Saldada:   { bg: C.verdeFondo,   border: C.verdeBorde,   text: C.verde   },
    Parcial:   { bg: C.naranjaFondo, border: C.naranjaBorde, text: C.naranja },
    Pendiente: { bg: C.rojoFondo,    border: C.rojoBorde,    text: C.rojo    },
  };

  cargos.forEach((cargo, i) => {
    if (y + ROW_H > PAGE_BOTTOM) {
      doc.addPage();
      y = MARGIN;
      y = dibujarCabecera(y);
    }

    const rowBg = i % 2 === 0 ? C.blanco : C.grisFondo;
    rectFill(doc, MARGIN, y, CW, ROW_H, rowBg, 0);

    // Fecha
    doc.font(FONT.normal).fontSize(8).fillColor(C.grisOscuro)
      .text(formatFecha(cargo.fecha), cols[0].x + 4, y + 9, { width: cols[0].w - 8, align: 'right' });

    // Descripción (con truncado)
    const desc = cargo.descripcion
      ? cargo.descripcion
      : cargo.compra_id ? `Compra #${String(cargo.compra_id).padStart(5, '0')}` : '—';
    doc.font(FONT.normal).fontSize(8).fillColor(C.negro)
      .text(desc, cols[1].x + 4, y + 9, { width: cols[1].w - 8, align: 'left', ellipsis: true, height: ROW_H - 10 });

    // Valores
    doc.font(FONT.normal).fontSize(8).fillColor(C.grisOscuro)
      .text(formatCOP(cargo.valor_original), cols[2].x + 4, y + 9, { width: cols[2].w - 8, align: 'right' });

    doc.font(FONT.normal).fontSize(8).fillColor(C.verde)
      .text(formatCOP(cargo.total_abonado), cols[3].x + 4, y + 9, { width: cols[3].w - 8, align: 'right' });

    const pendienteColor = Number(cargo.saldo_pendiente) > 0 ? C.rojo : C.verde;
    doc.font(FONT.bold).fontSize(8).fillColor(pendienteColor)
      .text(formatCOP(cargo.saldo_pendiente), cols[4].x + 4, y + 9, { width: cols[4].w - 8, align: 'right' });

    // Badge estado
    const cfg = estadoCfg[cargo.estado_pago] || estadoCfg.Pendiente;
    const bW = 46; const bH = 16;
    const bX = cols[5].x + (cols[5].w - bW) / 2;
    const bY = y + (ROW_H - bH) / 2;
    rectFill(doc, bX, bY, bW, bH, cfg.bg, 8);
    rectStroke(doc, bX, bY, bW, bH, cfg.border, 8);
    doc.font(FONT.bold).fontSize(7).fillColor(cfg.text)
      .text(cargo.estado_pago, bX, bY + 4.5, { width: bW, align: 'center' });

    // Separador inferior
    hLine(doc, y + ROW_H, MARGIN, PAGE_W - MARGIN, C.grisBorde);
    y += ROW_H;
  });

  // Borde redondeado alrededor de la tabla
  rectStroke(doc, MARGIN, startY, CW, y - startY, C.grisBorde, 6);

  return y;
}

function dibujarResumen(doc, cargos, saldoTotal, saldoAFavor, y) {
  const pendientes = cargos.filter((c) => c.estado_pago === 'Pendiente').length;
  const parciales  = cargos.filter((c) => c.estado_pago === 'Parcial').length;
  const saldadas   = cargos.filter((c) => c.estado_pago === 'Saldada').length;
  const totalOriginal = cargos.reduce((s, c) => s + Number(c.valor_original), 0);
  const totalAbonado  = cargos.reduce((s, c) => s + Number(c.total_abonado), 0);

  y += 16;
  const H = 72;
  rectFill(doc, MARGIN, y, CW, H, C.grisFondo);
  rectStroke(doc, MARGIN, y, CW, H, C.grisBorde);

  // Título
  doc.font(FONT.bold).fontSize(9).fillColor(C.negro)
    .text('Resumen', MARGIN + 14, y + 10);

  // Stats
  const statW = (CW - 28) / 5;
  const stats = [
    { label: 'Total cargos',    value: String(cargos.length),       color: C.negro   },
    { label: 'Pendientes',      value: String(pendientes),           color: C.rojo    },
    { label: 'Parciales',       value: String(parciales),            color: C.naranja },
    { label: 'Saldadas',        value: String(saldadas),             color: C.verde   },
    { label: 'Valor total',     value: formatCOP(totalOriginal),     color: C.negro   },
  ];

  stats.forEach((s, i) => {
    const sx = MARGIN + 14 + i * statW;
    doc.font(FONT.normal).fontSize(7.5).fillColor(C.grisClaro)
      .text(s.label, sx, y + 30, { width: statW - 4 });
    doc.font(FONT.bold).fontSize(9.5).fillColor(s.color)
      .text(s.value, sx, y + 43, { width: statW - 4 });
  });

  return y + H;
}

function dibujarPiePagina(doc) {
  const pageCount = doc.bufferedPageRange
    ? doc.bufferedPageRange().count
    : 1;
  const range = doc.bufferedPageRange ? doc.bufferedPageRange() : { start: 0, count: 1 };

  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const pageNum = i + 1;
    doc.font(FONT.normal).fontSize(7.5).fillColor(C.grisClaro)
      .text(`Página ${pageNum} de ${range.count}`, MARGIN, 841.89 - 38, { width: CW, align: 'right' });
    hLine(doc, 841.89 - 44, MARGIN, PAGE_W - MARGIN, C.grisBorde);
  }
}

// ─── Función principal ───────────────────────────────────────────────────────

function generarPdfCuentaAcreedor({ acreedor, cargos, saldoAFavor, config, res }) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });

  res.setHeader('Content-Type', 'application/pdf');
  const nombre = (acreedor.nombre || 'acreedor').replace(/\s+/g, '_').toLowerCase();
  res.setHeader('Content-Disposition', `attachment; filename="cuenta_${nombre}.pdf"`);
  doc.pipe(res);

  const saldoTotal = cargos
    .filter((c) => c.estado_pago !== 'Saldada')
    .reduce((s, c) => s + Number(c.saldo_pendiente), 0);

  let y = dibujarEncabezado(doc, config, acreedor, saldoTotal, saldoAFavor);

  y += 16;
  y = dibujarInfoAcreedor(doc, acreedor, saldoTotal, saldoAFavor, y);

  if (cargos.length === 0) {
    doc.font(FONT.normal).fontSize(10).fillColor(C.grisClaro)
      .text('No hay cargos registrados para este acreedor.', MARGIN, y + 20, { width: CW, align: 'center' });
  } else {
    y += 4;
    doc.font(FONT.bold).fontSize(9).fillColor(C.negro).text('Detalle de cargos', MARGIN, y);
    y += 14;
    y = dibujarTabla(doc, cargos, y);
    y = dibujarResumen(doc, cargos, saldoTotal, saldoAFavor, y);
  }

  dibujarPiePagina(doc);

  doc.end();
}

module.exports = { generarPdfCuentaAcreedor };
