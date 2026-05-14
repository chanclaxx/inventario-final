// Exporta la cartera completa de un prestatario o cliente en Excel.
// Hojas: Resumen · Estado de cuenta · Préstamos
import * as XLSX from 'xlsx';

// ─── Paleta ───────────────────────────────────────────────────────────────────
const C = {
  // Encabezados / estructura
  headerOscuro:   '1E3A8A',   // azul oscuro
  headerGris:     '374151',
  seccion:        'EFF6FF',
  totalFondo:     'DBEAFE',
  totalTexto:     '1E3A8A',
  blanco:         'FFFFFF',
  blancoAlt:      'F8FAFC',
  borde:          'CBD5E1',

  // Tipos de movimiento — fondo / texto
  prestamo_bg:    'FFEDD5',   // naranja claro — cargo / deuda nueva
  prestamo_tx:    'C2410C',
  abono_bg:       'D1FAE5',   // verde claro   — pago en efectivo
  abono_tx:       '065F46',
  pagoProd_bg:    'DBEAFE',   // azul claro    — pago con producto
  pagoProd_tx:    '1E40AF',
  saldoApl_bg:    'CCFBF1',   // teal          — saldo a favor aplicado
  saldoApl_tx:    '0F766E',
  compraDirect_bg:'EDE9FE',   // lila          — compra de artículo → saldo
  compraDirect_tx:'5B21B6',

  // Estados de préstamo
  activo_bg:      'FFFFFF',
  saldado_bg:     'DCFCE7',
  devuelto_bg:    'F3F4F6',

  gris600:        '4B5563',
};

// ─── Helpers de estilo ────────────────────────────────────────────────────────

function borde(color = C.borde) {
  const l = { style: 'thin', color: { rgb: color } };
  return { top: l, bottom: l, left: l, right: l };
}

function bordeGrueso(color = C.headerOscuro) {
  const l = { style: 'medium', color: { rgb: color } };
  return { top: l, bottom: l, left: l, right: l };
}

// Encabezado de columna — fondo oscuro, texto blanco, centrado
const sH = (bg = C.headerOscuro) => ({
  font:      { bold: true, name: 'Calibri', sz: 10, color: { rgb: C.blanco } },
  fill:      { patternType: 'solid', fgColor: { rgb: bg } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border:    borde(),
});

// Celda de dato — izquierda, tamaño estándar
const sC = (bg, align = 'left') => ({
  font:      { name: 'Calibri', sz: 9, color: { rgb: C.gris600 } },
  fill:      { patternType: 'solid', fgColor: { rgb: bg } },
  alignment: { horizontal: align, vertical: 'center', wrapText: true },
  border:    borde(),
});

// Celda numérica con formato COP
const sN = (bg) => ({
  ...sC(bg, 'right'),
  numFmt: '[$COP-240C] #,##0',
});

// Celda numérica sin prefijo (enteros)
const sNat = (bg) => ({
  ...sC(bg, 'right'),
  numFmt: '#,##0',
});

// Fila de totales
const sTotal = () => ({
  font:      { bold: true, name: 'Calibri', sz: 10, color: { rgb: C.totalTexto } },
  fill:      { patternType: 'solid', fgColor: { rgb: C.totalFondo } },
  alignment: { horizontal: 'right', vertical: 'center' },
  border:    bordeGrueso(),
  numFmt:    '[$COP-240C] #,##0',
});
const sTotalLabel = () => ({
  font:      { bold: true, name: 'Calibri', sz: 10, color: { rgb: C.totalTexto } },
  fill:      { patternType: 'solid', fgColor: { rgb: C.totalFondo } },
  alignment: { horizontal: 'left', vertical: 'center' },
  border:    bordeGrueso(),
});

// Sección / título dentro de hoja
const sSeccion = () => ({
  font:      { bold: true, name: 'Calibri', sz: 11, color: { rgb: C.totalTexto } },
  fill:      { patternType: 'solid', fgColor: { rgb: C.seccion } },
  alignment: { horizontal: 'left', vertical: 'center' },
  border:    borde(C.headerOscuro),
});

// Etiqueta de fila (lado izquierdo de dos columnas)
const sLabel = () => ({
  font:      { bold: true, name: 'Calibri', sz: 9, color: { rgb: C.gris600 } },
  fill:      { patternType: 'solid', fgColor: { rgb: C.blanco } },
  alignment: { horizontal: 'left', vertical: 'center' },
  border:    borde(),
});

// Valor de etiqueta (lado derecho de dos columnas)
const sValor = (color = C.headerOscuro) => ({
  font:      { bold: true, name: 'Calibri', sz: 10, color: { rgb: color } },
  fill:      { patternType: 'solid', fgColor: { rgb: C.blanco } },
  alignment: { horizontal: 'right', vertical: 'center' },
  border:    borde(),
});
const sMoneda = (color = C.headerOscuro) => ({
  ...sValor(color),
  numFmt: '[$COP-240C] #,##0',
});

// Badge de leyenda
const sLeyenda = (bg) => ({
  font:      { name: 'Calibri', sz: 9, color: { rgb: C.gris600 } },
  fill:      { patternType: 'solid', fgColor: { rgb: bg } },
  alignment: { horizontal: 'center', vertical: 'center' },
  border:    borde(),
});

// ─── Paleta por tipo de movimiento ───────────────────────────────────────────

const TIPO_META = {
  prestamo:      { bg: C.prestamo_bg,    tx: C.prestamo_tx,    label: '📤 Préstamo',            desc: 'Entrega de artículo (genera deuda)'       },
  abono:         { bg: C.abono_bg,       tx: C.abono_tx,       label: '💵 Abono',               desc: 'Pago en efectivo / transferencia / tarjeta' },
  pago_producto: { bg: C.pagoProd_bg,    tx: C.pagoProd_tx,    label: '🔄 Pago en producto',    desc: 'Entrega de artículo como pago'             },
  saldo_aplicado:{ bg: C.saldoApl_bg,   tx: C.saldoApl_tx,    label: '🏦 Saldo aplicado',      desc: 'Saldo a favor utilizado para pagar'        },
  compra_directa:{ bg: C.compraDirect_bg, tx: C.compraDirect_tx, label: '🛍️ Compra de artículo', desc: 'Artículo comprado → genera saldo a favor'  },
};

// ─── Fecha helpers ────────────────────────────────────────────────────────────

function fmtFecha(val) {
  if (!val) return '';
  const raw = typeof val === 'string' && !val.includes('T') && !val.includes('+')
    ? new Date(val.replace(' ', 'T') + 'Z')
    : new Date(val);
  if (isNaN(raw)) return '';
  return raw.toLocaleDateString('es-CO', {
    timeZone: 'America/Bogota',
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function hoy() {
  return new Date().toLocaleDateString('es-CO', {
    timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

// ─── Primitivas ───────────────────────────────────────────────────────────────

function put(ws, r, c, t, v, s) {
  ws[XLSX.utils.encode_cell({ r, c })] = { t, v: v ?? '', s };
}

function headers(ws, cols, row = 0, bg) {
  cols.forEach((h, c) => put(ws, row, c, 's', h, sH(bg)));
}

function seal(ws, lastRow, lastCol) {
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: lastCol } });
}

function freeze(ws, row = 1, col = 0) {
  ws['!freeze'] = { xSplit: col, ySplit: row, topLeftCell: XLSX.utils.encode_cell({ r: row, c: col }) };
}

// ─── Hoja 1: Resumen ──────────────────────────────────────────────────────────

function hojaResumen({ nombre, tipo, cedula, telefono, prestamos, movimientos, saldoAFavor }) {
  const ws = {};
  let r = 0;

  // Métricas calculadas
  const activos      = prestamos.filter((p) => p.estado === 'Activo');
  const cerrados     = prestamos.filter((p) => p.estado !== 'Activo');
  const deudaTotal   = activos.reduce((s, p) => s + (Number(p.valor_prestamo) - Number(p.total_abonado)), 0);
  const cargos  = movimientos.filter((m) => m.tipo === 'prestamo');
  const abonos  = movimientos.filter((m) => m.tipo !== 'prestamo' && m.tipo !== 'compra_directa');
  const compras = movimientos.filter((m) => m.tipo === 'compra_directa');
  const sumaCargos = cargos.reduce((s, m) => s + Number(m.cargo  || 0), 0);
  const sumaAbonos = abonos.reduce((s, m) => s + Number(m.abono  || 0), 0);
  const sumaCompras = compras.reduce((s, m) => s + Number(m.abono || 0), 0);

  const tipoLabel = tipo === 'prestatario' || tipo === 'companero' ? 'Compañero' : 'Cliente';

  // Título
  put(ws, r, 0, 's', `CARTERA — ${nombre}`, sSeccion()); r++;
  put(ws, r, 0, 's', `${tipoLabel}  ·  Generado el ${hoy()}`, sC(C.blanco)); r += 2;

  // ── Datos de la persona ──
  put(ws, r, 0, 's', '👤  DATOS DE LA PERSONA', sSeccion()); r++;
  [
    ['Nombre completo', 's', nombre,    C.gris600,      false],
    ['Tipo',           's', tipoLabel,  C.headerOscuro, false],
    ...(cedula   ? [['Cédula / CC', 's', cedula,   C.gris600, false]] : []),
    ...(telefono ? [['Teléfono',    's', telefono, C.gris600, false]] : []),
  ].forEach(([label, t, v, color]) => {
    put(ws, r, 0, 's', label, sLabel());
    put(ws, r, 1, t,   v,     sValor(color));
    r++;
  });
  r++;

  // ── Estado de la cuenta ──
  put(ws, r, 0, 's', '💳  ESTADO DE LA CUENTA', sSeccion()); r++;
  [
    ['Deuda activa',          'n', deudaTotal,    deudaTotal  > 0 ? 'DC2626' : '16A34A', true ],
    ['Saldo a favor',         'n', saldoAFavor,   saldoAFavor > 0 ? '0F766E' : C.gris600, true ],
    ['Total préstamos',       'n', sumaCargos,    C.headerOscuro, true ],
    ['Total pagado',          'n', sumaAbonos,    '16A34A',       true ],
    ['Compras de artículos',  'n', sumaCompras,   '5B21B6',       true ],
    ['Préstamos activos',     'n', activos.length,  'DC2626',     false],
    ['Préstamos cerrados',    'n', cerrados.length, '16A34A',     false],
    ['Movimientos totales',   'n', movimientos.length, C.gris600, false],
  ].forEach(([label, t, v, color, esMoneda]) => {
    put(ws, r, 0, 's', label, sLabel());
    put(ws, r, 1, t,   v,     esMoneda ? sMoneda(color) : sValor(color));
    r++;
  });
  r++;

  // ── Leyenda de colores ──
  put(ws, r, 0, 's', '🎨  LEYENDA DE COLORES DEL ESTADO DE CUENTA', sSeccion()); r++;
  Object.values(TIPO_META).forEach(({ bg, label, desc }) => {
    put(ws, r, 0, 's', label, sLeyenda(bg));
    put(ws, r, 1, 's', desc,  sC(C.blanco));
    r++;
  });
  // Estado de préstamos
  r++;
  put(ws, r, 0, 's', '📋  LEYENDA DE ESTADOS DE PRÉSTAMO', sSeccion()); r++;
  [
    [C.activo_bg,   'Activo   — préstamo vigente con saldo pendiente'],
    [C.saldado_bg,  'Saldado  — préstamo pagado completamente'],
    [C.devuelto_bg, 'Devuelto — artículo devuelto sin completar pago'],
  ].forEach(([bg, desc]) => {
    put(ws, r, 0, 's', ' ', sLeyenda(bg));
    put(ws, r, 1, 's', desc, sC(C.blanco));
    r++;
  });

  seal(ws, r, 1);
  ws['!cols'] = [{ wch: 32 }, { wch: 30 }];
  return ws;
}

// ─── Hoja 2: Estado de cuenta ─────────────────────────────────────────────────

const COLS_EC = ['#', 'Fecha', 'Tipo', 'Concepto', 'Cargo (deuda)', 'Abono (pago)', 'Saldo deuda'];
const ANCH_EC = [5,   14,      22,     52,          18,              18,             18];

function hojaCuenta(movimientos) {
  const ws = {};
  headers(ws, COLS_EC, 0, C.headerOscuro);

  let sumaCargos = 0;
  let sumaAbonos = 0;

  movimientos.forEach((m, i) => {
    const r   = i + 1;
    const meta = TIPO_META[m.tipo] || TIPO_META.abono;
    const bg   = meta.bg;

    const cargo = Number(m.cargo || 0);
    const abono = Number(m.abono || 0);
    sumaCargos += cargo;
    sumaAbonos += abono;

    put(ws, r, 0, 'n', i + 1,          sNat(bg));
    put(ws, r, 1, 's', fmtFecha(m.fecha), sC(bg));
    put(ws, r, 2, 's', meta.label,      sC(bg));
    put(ws, r, 3, 's', m.concepto || '', sC(bg));

    if (cargo > 0) put(ws, r, 4, 'n', cargo, sN(bg));
    else           put(ws, r, 4, 's', '',     sC(bg));

    if (abono > 0) put(ws, r, 5, 'n', abono, sN(bg));
    else           put(ws, r, 5, 's', '',     sC(bg));

    // Saldo acumulado de deuda (null para compras directas)
    if (m.saldo != null) put(ws, r, 6, 'n', Number(m.saldo), sN(Number(m.saldo) > 0 ? 'FEE2E2' : 'D1FAE5'));
    else                 put(ws, r, 6, 's', '—',              sC(bg, 'center'));
  });

  // Fila de totales
  const rTot = movimientos.length + 1;
  put(ws, rTot, 0, 's', '',                      sTotalLabel());
  put(ws, rTot, 1, 's', '',                      sTotalLabel());
  put(ws, rTot, 2, 's', '',                      sTotalLabel());
  put(ws, rTot, 3, 's', `TOTALES (${movimientos.length} movimientos)`, sTotalLabel());
  put(ws, rTot, 4, 'n', sumaCargos,              sTotal());
  put(ws, rTot, 5, 'n', sumaAbonos,              sTotal());
  const saldoFinal = sumaCargos - sumaAbonos;
  put(ws, rTot, 6, 'n', saldoFinal > 0 ? saldoFinal : 0, sTotal());

  seal(ws, rTot, COLS_EC.length - 1);
  ws['!cols'] = ANCH_EC.map((wch) => ({ wch }));
  freeze(ws);
  return ws;
}

// ─── Hoja 3: Préstamos ────────────────────────────────────────────────────────

const COLS_P = ['#', 'ID', 'Fecha', 'Producto', 'IMEI / Serial', 'Cant.', 'Valor préstamo', 'Total abonado', 'Saldo pendiente', 'Estado'];
const ANCH_P = [5,   8,    14,      34,          22,              7,       17,                17,              17,                12];

function hojaPrestamos(prestamos) {
  const ws = {};
  headers(ws, COLS_P, 0, C.headerGris);

  let totalValor = 0, totalAbonado = 0, totalPendiente = 0;

  prestamos.forEach((p, i) => {
    const r  = i + 1;
    const bg = p.estado === 'Saldado'  ? C.saldado_bg
             : p.estado === 'Devuelto' ? C.devuelto_bg
             : C.activo_bg;

    const saldo = Number(p.valor_prestamo) - Number(p.total_abonado);
    totalValor     += Number(p.valor_prestamo) || 0;
    totalAbonado   += Number(p.total_abonado)  || 0;
    totalPendiente += Math.max(saldo, 0);

    put(ws, r, 0, 'n', i + 1,                       sNat(bg));
    put(ws, r, 1, 'n', p.id,                         sNat(bg));
    put(ws, r, 2, 's', fmtFecha(p.fecha),            sC(bg));
    put(ws, r, 3, 's', p.nombre_producto || '',      sC(bg));
    put(ws, r, 4, 's', p.imei || '',                 sC(bg));
    put(ws, r, 5, 'n', p.imei ? 1 : (Number(p.cantidad_prestada) || 1), sNat(bg));
    put(ws, r, 6, 'n', Number(p.valor_prestamo) || 0, sN(bg));
    put(ws, r, 7, 'n', Number(p.total_abonado)  || 0, sN(bg));
    put(ws, r, 8, 'n', Math.max(saldo, 0),            sN(bg));
    put(ws, r, 9, 's', p.estado || '',               sC(bg));
  });

  // Totales
  const rTot = prestamos.length + 1;
  const blancos = [0,1,2,3,4,5];
  blancos.forEach((c) => put(ws, rTot, c, 's', c === 5 ? `TOTAL (${prestamos.length})` : '', sTotalLabel()));
  put(ws, rTot, 6, 'n', totalValor,     sTotal());
  put(ws, rTot, 7, 'n', totalAbonado,   sTotal());
  put(ws, rTot, 8, 'n', totalPendiente, sTotal());
  put(ws, rTot, 9, 's', '',             sTotalLabel());

  seal(ws, rTot, COLS_P.length - 1);
  ws['!cols'] = ANCH_P.map((wch) => ({ wch }));
  freeze(ws);
  return ws;
}

// ─── Export principal ─────────────────────────────────────────────────────────

/**
 * @param {object}  opts
 * @param {string}  opts.nombre       — Nombre del prestatario / cliente
 * @param {string}  opts.tipo         — 'prestatario' | 'cliente' | 'companero'
 * @param {string}  [opts.cedula]     — Cédula (opcional)
 * @param {string}  [opts.telefono]   — Teléfono (opcional)
 * @param {Array}   opts.prestamos    — Todos los préstamos de la persona
 * @param {Array}   opts.movimientos  — Resultado de getEstadoCuenta()
 * @param {number}  opts.saldoAFavor  — Saldo a favor actual
 */
export function exportarCarteraPersonaExcel({ nombre, tipo, cedula, telefono, prestamos = [], movimientos = [], saldoAFavor = 0 }) {
  if (!prestamos.length && !movimientos.length) return;

  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    hojaResumen({ nombre, tipo, cedula, telefono, prestamos, movimientos, saldoAFavor }),
    'Resumen',
  );

  if (movimientos.length > 0) {
    XLSX.utils.book_append_sheet(wb, hojaCuenta(movimientos), 'Estado de cuenta');
  }

  if (prestamos.length > 0) {
    XLSX.utils.book_append_sheet(wb, hojaPrestamos(prestamos), 'Préstamos');
  }

  const nombreSanitizado = nombre.replace(/[\\/?*[\]:]/g, '').trim().slice(0, 35) || 'cartera';
  const fecha = new Date()
    .toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric' })
    .replace(/\//g, '-');

  XLSX.writeFile(wb, `cartera_${nombreSanitizado}_${fecha}.xlsx`, { cellStyles: true });
}
