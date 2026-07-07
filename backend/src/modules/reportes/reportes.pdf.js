// src/modules/reportes/reportes.pdf.js
// ─────────────────────────────────────────────────────────────────────────────
// Genera el "Reporte de gestión" en PDF con la información que ya produce el
// programa (ventas, utilidad, costo de ventas, métodos de pago, inventario,
// cartera y libro auxiliar de facturas). Pensado para enviar al contador.
// NO calcula impuestos ni IVA: solo presenta los datos existentes.
// ─────────────────────────────────────────────────────────────────────────────

const PDFDocument = require('pdfkit');
const service     = require('./reportes.service');

// ─── Paleta (igual que facturas.pdf.js) ───────────────────────────────────────
const C = {
  headerBg:   '#111827',
  headerText: '#FFFFFF',
  headerSub:  '#9CA3AF',
  negro:      '#111827',
  grisOscuro: '#374151',
  gris:       '#6B7280',
  grisClaro:  '#9CA3AF',
  grisFondo:  '#F9FAFB',
  grisBorde:  '#E5E7EB',
  blanco:     '#FFFFFF',
  verde:      '#059669',
  verdeFondo: '#ECFDF5',
  rojo:       '#DC2626',
  azul:       '#2563EB',
  barPalette: ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#EF4444'],
};

const FONT = { normal: 'Helvetica', bold: 'Helvetica-Bold' };

const PAGE_W    = 595.28;
const PAGE_H    = 841.89;
const MARGIN    = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_Y  = PAGE_H - 36;
const MAX_Y     = FOOTER_Y - 14; // límite antes de saltar de página

// ─── Formato ──────────────────────────────────────────────────────────────────
const formatCOP = (v) => new Intl.NumberFormat('es-CO', {
  style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0,
}).format(Number(v || 0));

const formatPct = (v) => `${(Number(v) || 0).toFixed(1)}%`;

// Formato compacto para ejes de gráficas: $1.2M, $850k
const formatCompacto = (v) => {
  const n = Number(v) || 0;
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
};

// Parseo defensivo de timestamps de Postgres (sin zona → tratar como UTC)
const parseFecha = (fecha) => {
  if (!fecha) return null;
  if (fecha instanceof Date) return fecha;
  const s = String(fecha);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00-05:00`);
  if (s.includes('T') || s.includes('+')) return new Date(s);
  return new Date(`${s.replace(' ', 'T')}Z`);
};

const formatFechaCorta = (fecha) => {
  const d = parseFecha(fecha);
  if (!d || isNaN(d)) return '';
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(d);
};

const labelPeriodo = (periodo, unit) => {
  const d = parseFecha(periodo);
  if (!d || isNaN(d)) return String(periodo);
  if (unit === 'month') {
    return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', month: 'short', year: 'numeric' }).format(d);
  }
  return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short' }).format(d);
};

// ─── Primitivas de dibujo ──────────────────────────────────────────────────────
const rectFill = (doc, x, y, w, h, color, r = 6) => doc.roundedRect(x, y, w, h, r).fill(color);

const hLine = (doc, y, { x1 = MARGIN, x2 = PAGE_W - MARGIN, color = C.grisBorde, width = 0.5 } = {}) => {
  doc.moveTo(x1, y).lineTo(x2, y).strokeColor(color).lineWidth(width).stroke();
};

// Título de sección
const tituloSeccion = (doc, y, texto) => {
  doc.font(FONT.bold).fontSize(7).fillColor(C.grisClaro)
    .text(texto.toUpperCase(), MARGIN, y, { characterSpacing: 1.2, width: CONTENT_W });
  return y + 16;
};

// Fila etiqueta/valor
const fila = (doc, y, label, valor, { bold = false, valorColor = C.negro } = {}) => {
  doc.font(FONT.normal).fontSize(9).fillColor(C.gris)
    .text(label, MARGIN, y, { width: CONTENT_W * 0.6, lineBreak: false });
  doc.font(bold ? FONT.bold : FONT.normal).fontSize(9).fillColor(valorColor)
    .text(valor, MARGIN, y, { width: CONTENT_W, align: 'right', lineBreak: false });
  return y + 15;
};

// ─── Encabezado de página ──────────────────────────────────────────────────────
const dibujarLogo = (doc, logo, headerH) => {
  if (!logo) return 0;
  try {
    const buf = Buffer.from(String(logo).replace(/^data:image\/[a-z+]+;base64,/, ''), 'base64');
    if (!buf.length) return 0;
    const SIZE = 54;
    doc.image(buf, MARGIN, Math.round((headerH - SIZE) / 2), { fit: [SIZE, SIZE] });
    return SIZE + 12;
  } catch { return 0; }
};

const drawHeader = (doc, { negocio, sucursalNombre, desde, hasta, fechaGeneracion, logo }) => {
  const H = 116;
  rectFill(doc, 0, 0, PAGE_W, H, C.headerBg, 0);
  doc.rect(0, H - 3, PAGE_W, 3).fill(C.verde);

  const logoOffset = dibujarLogo(doc, logo, H);
  const textX = MARGIN + logoOffset;
  const textW = CONTENT_W * 0.55 - logoOffset;

  doc.font(FONT.bold).fontSize(20).fillColor(C.headerText)
    .text(negocio?.nombre || 'Mi Negocio', textX, 26, { width: textW });

  let yi = 54;
  [
    negocio?.nit       ? `NIT: ${negocio.nit}` : null,
    negocio?.direccion || null,
    negocio?.telefono  ? `Tel: ${negocio.telefono}` : null,
  ].filter(Boolean).forEach((linea) => {
    doc.font(FONT.normal).fontSize(8).fillColor(C.headerSub).text(linea, textX, yi, { width: textW });
    yi += 12;
  });

  // Lado derecho
  doc.font(FONT.bold).fontSize(15).fillColor(C.headerText)
    .text('REPORTE DE GESTIÓN', MARGIN, 26, { width: CONTENT_W, align: 'right' });
  doc.font(FONT.normal).fontSize(8).fillColor(C.headerSub)
    .text(`Sucursal: ${sucursalNombre || '—'}`, MARGIN, 50, { width: CONTENT_W, align: 'right' });
  doc.text(`Periodo: ${formatFechaCorta(desde)}  a  ${formatFechaCorta(hasta)}`, MARGIN, 62, { width: CONTENT_W, align: 'right' });
  doc.text(`Generado: ${fechaGeneracion}`, MARGIN, 74, { width: CONTENT_W, align: 'right' });

  return H + 18;
};

const drawFooters = (doc, negocioNombre, fechaGeneracion) => {
  const total = doc.bufferedPageRange().count;
  for (let i = 0; i < total; i++) {
    doc.switchToPage(i);
    hLine(doc, FOOTER_Y - 6);
    doc.font(FONT.normal).fontSize(7).fillColor(C.grisClaro)
      .text(`${negocioNombre || 'Mi Negocio'} — Generado el ${fechaGeneracion}`, MARGIN, FOOTER_Y, { width: CONTENT_W / 2, lineBreak: false });
    doc.text(`Página ${i + 1} de ${total}`, MARGIN, FOOTER_Y, { width: CONTENT_W, align: 'right', lineBreak: false });
  }
};

// ─── Salto de página ───────────────────────────────────────────────────────────
const ensureSpace = (doc, y, needed) => {
  if (y + needed <= MAX_Y) return y;
  doc.addPage();
  return MARGIN;
};

// ─── Tabla genérica ────────────────────────────────────────────────────────────
// columns: [{ label, frac, align, render(row) }]
const drawTable = (doc, y, columns, rows, { emptyMsg = 'Sin datos en el período' } = {}) => {
  const widths = columns.map((c) => c.frac * CONTENT_W);
  const xs = [];
  let acc = MARGIN;
  widths.forEach((w) => { xs.push(acc); acc += w; });

  const drawHeaderRow = (yy) => {
    rectFill(doc, MARGIN, yy - 2, CONTENT_W, 18, C.grisFondo, 4);
    columns.forEach((c, i) => {
      doc.font(FONT.bold).fontSize(7.5).fillColor(C.grisOscuro)
        .text(c.label.toUpperCase(), xs[i] + 4, yy + 3, { width: widths[i] - 8, align: c.align || 'left', lineBreak: false });
    });
    return yy + 20;
  };

  if (!rows.length) {
    doc.font(FONT.normal).fontSize(9).fillColor(C.grisClaro).text(emptyMsg, MARGIN, y);
    return y + 18;
  }

  y = ensureSpace(doc, y, 40);
  y = drawHeaderRow(y);

  rows.forEach((row, idx) => {
    if (y + 16 > MAX_Y) {
      doc.addPage();
      y = MARGIN;
      y = drawHeaderRow(y);
    }
    if (idx % 2 === 1) rectFill(doc, MARGIN, y - 1, CONTENT_W, 15, C.grisFondo, 0);
    columns.forEach((c, i) => {
      const val = c.render(row);
      doc.font(FONT.normal).fontSize(8).fillColor(val.color || C.grisOscuro)
        .text(val.text, xs[i] + 4, y + 2, { width: widths[i] - 8, align: c.align || 'left', lineBreak: false });
    });
    y += 15;
  });

  return y + 6;
};

// ─── Tarjetas KPI (fila de 3) ──────────────────────────────────────────────────
const drawKpis = (doc, y, kpis) => {
  const gap = 10;
  const cardW = (CONTENT_W - gap * (kpis.length - 1)) / kpis.length;
  const cardH = 52;
  y = ensureSpace(doc, y, cardH + 6);
  kpis.forEach((k, i) => {
    const x = MARGIN + i * (cardW + gap);
    rectFill(doc, x, y, cardW, cardH, k.fondo || C.grisFondo, 8);
    doc.font(FONT.normal).fontSize(7.5).fillColor(C.gris)
      .text(k.label.toUpperCase(), x + 10, y + 9, { width: cardW - 20, characterSpacing: 0.3 });
    doc.font(FONT.bold).fontSize(13).fillColor(k.color || C.negro)
      .text(k.valor, x + 10, y + 24, { width: cardW - 20, lineBreak: false });
  });
  return y + cardH + 14;
};

// ─── Leyenda ───────────────────────────────────────────────────────────────────
const drawLeyenda = (doc, y, items) => {
  let x = MARGIN;
  items.forEach((it) => {
    if (it.tipo === 'linea') {
      doc.moveTo(x, y + 4).lineTo(x + 14, y + 4).strokeColor(it.color).lineWidth(2).stroke();
      doc.circle(x + 7, y + 4, 2).fill(it.color);
    } else {
      rectFill(doc, x, y, 10, 8, it.color, 2);
    }
    doc.font(FONT.normal).fontSize(7.5).fillColor(C.gris)
      .text(it.label, x + 18, y, { lineBreak: false });
    x += 22 + doc.widthOfString(it.label) + 16;
  });
  return y + 16;
};

// ─── Gráfica de tendencia: barras (vendido) + línea (utilidad) ─────────────────
const drawTendenciaChart = (doc, y, serie, unit) => {
  const data = serie.length > 24 ? serie.slice(-24) : serie;
  if (!data.length) return y;

  const chartH   = 150;
  const padX     = 26;          // espacio para etiquetas eje X
  const axisW    = 42;          // espacio para eje Y
  y = ensureSpace(doc, y, chartH + 40);

  y = drawLeyenda(doc, y, [
    { tipo: 'barra', color: C.azul,  label: 'Total vendido' },
    { tipo: 'linea', color: C.verde, label: 'Utilidad' },
  ]);

  const plotX = MARGIN + axisW;
  const plotW = CONTENT_W - axisW;
  const plotH = chartH - padX;
  const baseY = y + plotH;
  const maxVal = Math.max(1, ...data.map((d) => Math.max(d.total_vendido, d.utilidad)));

  // Cuadrícula + etiquetas eje Y
  for (let g = 0; g <= 3; g++) {
    const gy = baseY - (plotH * g) / 3;
    hLine(doc, gy, { x1: plotX, x2: plotX + plotW, color: C.grisBorde, width: 0.4 });
    doc.font(FONT.normal).fontSize(6.5).fillColor(C.grisClaro)
      .text(formatCompacto((maxVal * g) / 3), MARGIN, gy - 4, { width: axisW - 6, align: 'right', lineBreak: false });
  }

  const slot     = plotW / data.length;
  const barW     = Math.min(slot * 0.55, 26);
  const labelEvery = Math.ceil(data.length / 12);
  const puntos   = [];

  data.forEach((d, i) => {
    const cx = plotX + slot * i + slot / 2;
    // Barra vendido
    const hV = (plotH * d.total_vendido) / maxVal;
    rectFill(doc, cx - barW / 2, baseY - hV, barW, hV, C.azul, 2);
    // Punto utilidad
    const yU = baseY - (plotH * Math.max(0, d.utilidad)) / maxVal;
    puntos.push({ x: cx, y: yU });
    // Etiqueta eje X
    if (i % labelEvery === 0) {
      doc.font(FONT.normal).fontSize(6.5).fillColor(C.grisClaro)
        .text(labelPeriodo(d.periodo, unit), cx - slot / 2, baseY + 6, { width: slot, align: 'center', lineBreak: false });
    }
  });

  // Línea de utilidad
  if (puntos.length > 1) {
    doc.moveTo(puntos[0].x, puntos[0].y);
    puntos.slice(1).forEach((p) => doc.lineTo(p.x, p.y));
    doc.strokeColor(C.verde).lineWidth(1.5).stroke();
  }
  puntos.forEach((p) => doc.circle(p.x, p.y, 2).fill(C.verde));

  let yEnd = baseY + 18;
  if (serie.length > data.length) {
    doc.font(FONT.normal).fontSize(7).fillColor(C.grisClaro)
      .text(`* La gráfica muestra los últimos ${data.length} periodos; la tabla incluye todos.`, MARGIN, yEnd);
    yEnd += 12;
  }
  return yEnd + 4;
};

// ─── Barras horizontales (composición, métodos, productos) ─────────────────────
const drawHBars = (doc, y, items, { labelKey, valueKey, emptyMsg = 'Sin datos' }) => {
  if (!items.length) {
    doc.font(FONT.normal).fontSize(9).fillColor(C.grisClaro).text(emptyMsg, MARGIN, y);
    return y + 18;
  }
  const total  = items.reduce((s, it) => s + Number(it[valueKey]), 0);
  const maxVal = Math.max(1, ...items.map((it) => Number(it[valueKey])));
  const labelW = CONTENT_W * 0.26;
  const valueW = CONTENT_W * 0.24;
  const barX   = MARGIN + labelW;
  const barMaxW = CONTENT_W - labelW - valueW;
  const rowH   = 18;

  items.forEach((it, i) => {
    y = ensureSpace(doc, y, rowH);
    const val = Number(it[valueKey]);
    const color = C.barPalette[i % C.barPalette.length];
    // Etiqueta
    doc.font(FONT.normal).fontSize(8).fillColor(C.grisOscuro)
      .text(it[labelKey], MARGIN, y + 2, { width: labelW - 6, lineBreak: false });
    // Pista + barra
    rectFill(doc, barX, y + 1, barMaxW, 11, C.grisFondo, 3);
    const w = Math.max(2, (barMaxW * val) / maxVal);
    rectFill(doc, barX, y + 1, w, 11, color, 3);
    // Valor + %
    const pct = total > 0 ? formatPct((val / total) * 100) : '';
    doc.font(FONT.bold).fontSize(8).fillColor(C.grisOscuro)
      .text(`${formatCOP(val)}  ${pct ? `· ${pct}` : ''}`, MARGIN + labelW + barMaxW, y + 2,
        { width: valueW, align: 'right', lineBreak: false });
    y += rowH;
  });
  return y + 6;
};

// ─────────────────────────────────────────────────────────────────────────────
// GENERADOR PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
const generarReporteContable = async ({ negocio, sucursalNombre, sucursalId, desde, hasta, agrupacion, logo, detalleFacturas = false }) => {
  // ── Recolectar datos (reusa los servicios existentes) ──────────────────────
  const [analisis, productos, inventario, ventas] = await Promise.all([
    service.getAnalisis(sucursalId, desde, hasta, agrupacion),
    service.getProductosTop(sucursalId, desde, hasta),
    service.getValorInventario(sucursalId),
    service.getVentasRango(sucursalId, desde, hasta),
  ]);

  const unit       = analisis.agrupacion;
  const resumen    = ventas.resumen;
  const facturas   = ventas.facturas || [];
  const creditos   = ventas.creditos;
  const prestamos  = ventas.prestamos;
  const servicios  = ventas.servicios;

  // Estado de resultados de ventas de contado (facturas activas)
  const activas = facturas.filter((f) => f.estado === 'Activa');
  const ventasContado = activas.reduce((s, f) => s + Number(f.total_venta), 0);
  const costoVentas   = activas.reduce(
    (s, f) => s + f.lineas.reduce((a, l) => a + (l.costo_total !== null ? l.costo_total : 0), 0), 0,
  );
  const utilidadBruta = activas.reduce((s, f) => s + (f.utilidad_neta || 0), 0);
  const margen = ventasContado > 0 ? (utilidadBruta / ventasContado) * 100 : 0;

  const fechaGeneracion = new Date().toLocaleString('es-CO', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota',
  });

  const doc = new PDFDocument({
    size: 'A4', bufferPages: true,
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    info: {
      Title:   `Reporte de gestión — ${negocio?.nombre || 'Negocio'}`,
      Author:  negocio?.nombre || 'Inventario',
      Subject: `Periodo ${formatFechaCorta(desde)} a ${formatFechaCorta(hasta)}`,
    },
  });

  let y = drawHeader(doc, { negocio, sucursalNombre, desde, hasta, fechaGeneracion, logo });

  // ── 1. KPIs principales ────────────────────────────────────────────────────
  y = drawKpis(doc, y, [
    { label: 'Total vendido', valor: formatCOP(resumen?.total_ventas || 0), fondo: '#EFF6FF', color: C.azul },
    { label: 'Utilidad bruta (contado)', valor: formatCOP(utilidadBruta), fondo: C.verdeFondo, color: C.verde },
    { label: 'Costo de ventas', valor: formatCOP(costoVentas), fondo: '#FFF7ED', color: '#C2410C' },
  ]);

  // ── 2. Estado de resultados resumido ───────────────────────────────────────
  y = tituloSeccion(doc, y, 'Resumen del periodo');
  y = fila(doc, y, 'Ventas de contado (facturado)', formatCOP(ventasContado));
  y = fila(doc, y, '(−) Costo de mercancía vendida', formatCOP(costoVentas), { valorColor: C.rojo });
  hLine(doc, y); y += 6;
  y = fila(doc, y, 'Utilidad bruta de ventas de contado', formatCOP(utilidadBruta), { bold: true, valorColor: C.verde });
  y = fila(doc, y, `Margen sobre ventas de contado`, formatPct(margen), { bold: true });
  // La retoma no reduce la utilidad (es un medio de pago / activo recibido);
  // se muestra solo como dato informativo.
  if ((resumen?.total_retomas || 0) > 0) {
    y = fila(doc, y, 'Retomas recibidas (informativo, no afecta la utilidad)', formatCOP(resumen.total_retomas), { valorColor: C.gris });
  }
  y += 4;
  y = fila(doc, y, 'Utilidad de créditos saldados', formatCOP(resumen?.utilidad_creditos_saldados || 0));
  y = fila(doc, y, 'Utilidad de servicios técnicos', formatCOP((servicios?.resumen?.utilidad_confirmada || 0) + (servicios?.resumen?.utilidad_garantias || 0)));
  y = fila(doc, y, 'Utilidad de préstamos saldados', formatCOP(prestamos?.resumen?.utilidad_confirmada || 0));
  y = fila(doc, y, `Facturas en el periodo`, `${resumen?.total_facturas || 0}  (${resumen?.facturas_activas || 0} contado · ${resumen?.facturas_credito || 0} crédito)`);
  y += 10;

  // ── 3. Tendencia por periodo (gráfica + tabla) ─────────────────────────────
  const unitLabel = unit === 'month' ? 'mes' : unit === 'week' ? 'semana' : 'día';
  y = ensureSpace(doc, y, 60);
  y = tituloSeccion(doc, y, `Comparativo por ${unitLabel}`);
  y = drawTendenciaChart(doc, y, analisis.serie, unit);
  y = drawTable(doc, y, [
    { label: 'Periodo',  frac: 0.24, render: (r) => ({ text: labelPeriodo(r.periodo, unit) }) },
    { label: 'Vendido',  frac: 0.22, align: 'right', render: (r) => ({ text: formatCOP(r.total_vendido) }) },
    { label: 'Utilidad', frac: 0.22, align: 'right', render: (r) => ({ text: formatCOP(r.utilidad), color: r.utilidad >= 0 ? C.verde : C.rojo }) },
    { label: 'Facturas', frac: 0.14, align: 'right', render: (r) => ({ text: String(r.num_facturas) }) },
    { label: 'Ticket prom.', frac: 0.18, align: 'right', render: (r) => ({ text: formatCOP(r.ticket_promedio) }) },
  ], analisis.serie);
  y += 8;

  // ── 4. Composición de ingresos (barras) ────────────────────────────────────
  y = ensureSpace(doc, y, 60);
  y = tituloSeccion(doc, y, 'Composición de ingresos');
  y = drawHBars(doc, y, analisis.composicion, {
    labelKey: 'fuente', valueKey: 'total', emptyMsg: 'Sin ingresos registrados en el período',
  });
  y += 8;

  // ── 5. Recaudo por método de pago (barras) ─────────────────────────────────
  y = ensureSpace(doc, y, 60);
  y = tituloSeccion(doc, y, 'Recaudo por método de pago');
  y = drawHBars(doc, y, analisis.metodos_pago, {
    labelKey: 'metodo', valueKey: 'total', emptyMsg: 'Sin pagos registrados en el período',
  });
  y += 8;

  // ── 6. Productos destacados (por utilidad) ─────────────────────────────────
  const prodPorUtilidad = [...productos]
    .filter((p) => p.utilidad !== null)
    .sort((a, b) => b.utilidad - a.utilidad)
    .slice(0, 15);
  y = ensureSpace(doc, y, 60);
  y = tituloSeccion(doc, y, 'Productos más rentables (top 15)');
  y = drawTable(doc, y, [
    { label: 'Producto', frac: 0.40, render: (r) => ({ text: r.nombre_producto }) },
    { label: 'Cant.',    frac: 0.12, align: 'right', render: (r) => ({ text: String(r.cantidad_vendida) }) },
    { label: 'Ventas',   frac: 0.20, align: 'right', render: (r) => ({ text: formatCOP(r.total_ventas) }) },
    { label: 'Utilidad', frac: 0.18, align: 'right', render: (r) => ({ text: formatCOP(r.utilidad), color: C.verde }) },
    { label: 'Margen',   frac: 0.10, align: 'right', render: (r) => ({ text: r.margen_porcentaje !== null ? formatPct(r.margen_porcentaje) : '—' }) },
  ], prodPorUtilidad, { emptyMsg: 'Sin productos con costo registrado' });
  y += 8;

  // ── 7. Inventario valorizado a la fecha ────────────────────────────────────
  y = ensureSpace(doc, y, 90);
  y = tituloSeccion(doc, y, 'Inventario disponible a la fecha');
  y = fila(doc, y, `Unidades en stock`, String(inventario.totales.unidades));
  y = fila(doc, y, 'Valor en costo', formatCOP(inventario.totales.costo_total), { bold: true });
  y = fila(doc, y, 'Valor en precio de venta', formatCOP(inventario.totales.precio_venta_total));
  y += 10;

  // ── 8. Cartera por cobrar ──────────────────────────────────────────────────
  y = ensureSpace(doc, y, 70);
  y = tituloSeccion(doc, y, 'Cartera por cobrar (a la fecha)');
  y = fila(doc, y, `Créditos activos (${creditos?.activos?.total || 0})`, formatCOP(creditos?.activos?.saldo_pendiente || 0), { valorColor: C.rojo });
  const saldoPrestamos = (prestamos?.activos || []).reduce((s, p) => s + (p.saldo_pendiente || 0), 0);
  y = fila(doc, y, `Préstamos activos (${prestamos?.activos?.length || 0})`, formatCOP(saldoPrestamos), { valorColor: C.rojo });
  hLine(doc, y); y += 6;
  y = fila(doc, y, 'Total por cobrar', formatCOP((creditos?.activos?.saldo_pendiente || 0) + saldoPrestamos), { bold: true, valorColor: C.rojo });
  y += 10;

  // ── 9. Libro auxiliar de facturas (opcional — solo si se pide el detalle) ───
  if (detalleFacturas) {
    doc.addPage();
    y = MARGIN;
    y = tituloSeccion(doc, y, `Libro auxiliar de facturas (${facturas.length})`);
    y = drawTable(doc, y, [
      { label: 'Fecha',     frac: 0.16, render: (r) => ({ text: formatFechaCorta(r.fecha) }) },
      { label: 'Factura',   frac: 0.13, render: (r) => ({ text: `#${String(r.id).padStart(6, '0')}` }) },
      { label: 'Cliente',   frac: 0.31, render: (r) => ({ text: r.nombre_cliente || '—' }) },
      { label: 'Documento', frac: 0.16, render: (r) => ({ text: r.cedula || '—' }) },
      { label: 'Estado',    frac: 0.10, render: (r) => ({ text: r.estado }) },
      { label: 'Total',     frac: 0.14, align: 'right', render: (r) => ({ text: formatCOP(r.total_venta) }) },
    ], facturas, { emptyMsg: 'Sin facturas en el período' });
  } else {
    y = ensureSpace(doc, y, 30);
    doc.font(FONT.normal).fontSize(7.5).fillColor(C.grisClaro)
      .text('El detalle factura por factura (libro auxiliar) se puede incluir activando la opción "Detalle de facturas" antes de exportar.',
        MARGIN, y, { width: CONTENT_W });
  }

  drawFooters(doc, negocio?.nombre, fechaGeneracion);
  doc.end();
  return doc;
};

module.exports = { generarReporteContable };
