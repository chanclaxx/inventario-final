// Exporta la cuenta completa de un acreedor en Excel.
// Hojas: Resumen · Estado de cuenta · Cargos
import * as XLSX from 'xlsx';

// ─── Paleta ───────────────────────────────────────────────────────────────────
const C = {
  headerOscuro:   '1E3A8A',
  headerGris:     '374151',
  seccion:        'EFF6FF',
  totalFondo:     'DBEAFE',
  totalTexto:     '1E3A8A',
  blanco:         'FFFFFF',
  borde:          'CBD5E1',

  cargo_bg:       'FFEDD5',   // naranja — deuda nueva
  cargo_tx:       'C2410C',
  compra_bg:      'EDE9FE',   // lila — compra
  compra_tx:      '5B21B6',
  abono_bg:       'D1FAE5',   // verde — pago
  abono_tx:       '065F46',
  saldoFavor_bg:  'CCFBF1',   // teal — pago adelantado
  saldoFavor_tx:  '0F766E',

  pendiente_bg:   'FEE2E2',
  parcial_bg:     'FEF3C7',
  saldada_bg:     'DCFCE7',

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
const sH = (bg = C.headerOscuro) => ({
  font:      { bold: true, name: 'Calibri', sz: 10, color: { rgb: C.blanco } },
  fill:      { patternType: 'solid', fgColor: { rgb: bg } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border:    borde(),
});
const sC = (bg, align = 'left') => ({
  font:      { name: 'Calibri', sz: 9, color: { rgb: C.gris600 } },
  fill:      { patternType: 'solid', fgColor: { rgb: bg } },
  alignment: { horizontal: align, vertical: 'center', wrapText: true },
  border:    borde(),
});
const sN = (bg) => ({ ...sC(bg, 'right'), numFmt: '[$COP-240C] #,##0' });
const sNat = (bg) => ({ ...sC(bg, 'right'), numFmt: '#,##0' });
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
const sSeccion = () => ({
  font:      { bold: true, name: 'Calibri', sz: 11, color: { rgb: C.totalTexto } },
  fill:      { patternType: 'solid', fgColor: { rgb: C.seccion } },
  alignment: { horizontal: 'left', vertical: 'center' },
  border:    borde(C.headerOscuro),
});
const sLabel = () => ({
  font:      { bold: true, name: 'Calibri', sz: 9, color: { rgb: C.gris600 } },
  fill:      { patternType: 'solid', fgColor: { rgb: C.blanco } },
  alignment: { horizontal: 'left', vertical: 'center' },
  border:    borde(),
});
const sValor = (color = C.headerOscuro) => ({
  font:      { bold: true, name: 'Calibri', sz: 10, color: { rgb: color } },
  fill:      { patternType: 'solid', fgColor: { rgb: C.blanco } },
  alignment: { horizontal: 'right', vertical: 'center' },
  border:    borde(),
});
const sMoneda = (color = C.headerOscuro) => ({ ...sValor(color), numFmt: '[$COP-240C] #,##0' });
const sLeyenda = (bg) => ({
  font:      { name: 'Calibri', sz: 9, color: { rgb: C.gris600 } },
  fill:      { patternType: 'solid', fgColor: { rgb: bg } },
  alignment: { horizontal: 'center', vertical: 'center' },
  border:    borde(),
});

// ─── Tipo de movimiento ───────────────────────────────────────────────────────
function metaMovimiento(m) {
  if (m.tipo === 'Cargo') {
    return m.compra_id
      ? { bg: C.compra_bg, label: '🛒 Compra' }
      : { bg: C.cargo_bg,  label: '📥 Cargo' };
  }
  return m.cargo_id
    ? { bg: C.abono_bg,      label: '💵 Abono' }
    : { bg: C.saldoFavor_bg, label: '🏦 Pago adelantado' };
}

// ─── Fechas ───────────────────────────────────────────────────────────────────
function fmtFecha(val) {
  if (!val) return '';
  const raw = typeof val === 'string' && !val.includes('T') && !val.includes('+')
    ? new Date(val.replace(' ', 'T') + 'Z')
    : new Date(val);
  if (isNaN(raw)) return '';
  return raw.toLocaleDateString('es-CO', {
    timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric',
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
function headers(ws, cols, row, bg) {
  cols.forEach((h, c) => put(ws, row, c, 's', h, sH(bg)));
}
function seal(ws, lastRow, lastCol) {
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: lastCol } });
}
function freeze(ws, row = 1, col = 0) {
  ws['!freeze'] = { xSplit: col, ySplit: row, topLeftCell: XLSX.utils.encode_cell({ r: row, c: col }) };
}

// ─── Hoja 1: Resumen ──────────────────────────────────────────────────────────
function hojaResumen({ nombre, cedula, telefono, esProveedor, movimientos, cargos, saldoAFavor }) {
  const ws = {};
  let r = 0;

  const totalCargos = movimientos.filter((m) => m.tipo === 'Cargo').reduce((s, m) => s + Number(m.valor || 0), 0);
  const totalAbonos = movimientos.filter((m) => m.tipo === 'Abono').reduce((s, m) => s + Number(m.valor || 0), 0);
  const pendientes  = cargos.filter((c) => c.estado_pago !== 'Saldada');
  const saldadas    = cargos.filter((c) => c.estado_pago === 'Saldada');
  const deudaTotal  = pendientes.reduce((s, c) => s + Number(c.saldo_pendiente || 0), 0);

  put(ws, r, 0, 's', `CUENTA POR PAGAR — ${nombre}`, sSeccion()); r++;
  put(ws, r, 0, 's', `${esProveedor ? 'Proveedor' : 'Acreedor'}  ·  Generado el ${hoy()}`, sC(C.blanco)); r += 2;

  put(ws, r, 0, 's', '👤  DATOS DEL ACREEDOR', sSeccion()); r++;
  [
    ['Nombre', 's', nombre, C.gris600],
    ['Tipo', 's', esProveedor ? 'Proveedor' : 'Acreedor', C.headerOscuro],
    ...(cedula   ? [['CC / NIT',  's', cedula,   C.gris600]] : []),
    ...(telefono ? [['Teléfono', 's', telefono, C.gris600]] : []),
  ].forEach(([label, t, v, color]) => {
    put(ws, r, 0, 's', label, sLabel());
    put(ws, r, 1, t,   v,     sValor(color));
    r++;
  });
  r++;

  put(ws, r, 0, 's', '💳  ESTADO DE LA CUENTA', sSeccion()); r++;
  [
    ['Deuda total',          'n', deudaTotal,         deudaTotal  > 0 ? 'DC2626' : '16A34A', true ],
    ['Saldo a favor',        'n', saldoAFavor,        saldoAFavor > 0 ? '0F766E' : C.gris600, true ],
    ['Total cargado',        'n', totalCargos,        C.headerOscuro, true ],
    ['Total pagado',         'n', totalAbonos,        '16A34A',       true ],
    ['Cargos pendientes',    'n', pendientes.length,  'DC2626',       false],
    ['Cargos saldados',      'n', saldadas.length,    '16A34A',       false],
    ['Movimientos totales',  'n', movimientos.length, C.gris600,      false],
  ].forEach(([label, t, v, color, esMoneda]) => {
    put(ws, r, 0, 's', label, sLabel());
    put(ws, r, 1, t,   v,     esMoneda ? sMoneda(color) : sValor(color));
    r++;
  });
  r++;

  put(ws, r, 0, 's', '🎨  LEYENDA DEL ESTADO DE CUENTA', sSeccion()); r++;
  [
    [C.cargo_bg,      'Cargo — deuda registrada manualmente'],
    [C.compra_bg,     'Compra — deuda generada por una compra'],
    [C.abono_bg,      'Abono — pago aplicado a un cargo'],
    [C.saldoFavor_bg, 'Pago adelantado — genera saldo a favor'],
  ].forEach(([bg, desc]) => {
    put(ws, r, 0, 's', ' ', sLeyenda(bg));
    put(ws, r, 1, 's', desc, sC(C.blanco));
    r++;
  });

  seal(ws, r, 1);
  ws['!cols'] = [{ wch: 30 }, { wch: 32 }];
  return ws;
}

// ─── Hoja 2: Estado de cuenta ─────────────────────────────────────────────────
const COLS_EC = ['#', 'Fecha', 'Tipo', 'Justificación', 'Cargo (+)', 'Abono (−)', 'Saldo deuda', 'Método'];
const ANCH_EC = [5,   14,      20,     46,               16,          16,           16,            16];

function hojaCuenta(movimientos) {
  const ws = {};
  headers(ws, COLS_EC, 0, C.headerOscuro);

  let sumaCargos = 0;
  let sumaAbonos = 0;

  movimientos.forEach((m, i) => {
    const row = i + 1;
    const meta = metaMovimiento(m);
    const bg = meta.bg;
    const esCargo = m.tipo === 'Cargo';
    const valor = Number(m.valor || 0);
    if (esCargo) sumaCargos += valor; else sumaAbonos += valor;

    const desc = m.descripcion
      || (m.compra_id ? `Compra #${String(m.compra_numero ?? m.compra_id).padStart(5, '0')}` : meta.label);

    put(ws, row, 0, 'n', i + 1,            sNat(bg));
    put(ws, row, 1, 's', fmtFecha(m.fecha), sC(bg));
    put(ws, row, 2, 's', meta.label,        sC(bg));
    put(ws, row, 3, 's', desc,              sC(bg));
    if (esCargo) put(ws, row, 4, 'n', valor, sN(bg)); else put(ws, row, 4, 's', '', sC(bg));
    if (!esCargo) put(ws, row, 5, 'n', valor, sN(bg)); else put(ws, row, 5, 's', '', sC(bg));
    put(ws, row, 6, 'n', Number(m.saldo_despues || 0), sN(Number(m.saldo_despues) > 0 ? C.pendiente_bg : C.saldada_bg));
    put(ws, row, 7, 's', m.metodo || '', sC(bg));
  });

  const rTot = movimientos.length + 1;
  for (let c = 0; c <= 2; c++) put(ws, rTot, c, 's', '', sTotalLabel());
  put(ws, rTot, 3, 's', `TOTALES (${movimientos.length} mov.)`, sTotalLabel());
  put(ws, rTot, 4, 'n', sumaCargos, sTotal());
  put(ws, rTot, 5, 'n', sumaAbonos, sTotal());
  put(ws, rTot, 6, 'n', Math.max(sumaCargos - sumaAbonos, 0), sTotal());
  put(ws, rTot, 7, 's', '', sTotalLabel());

  seal(ws, rTot, COLS_EC.length - 1);
  ws['!cols'] = ANCH_EC.map((wch) => ({ wch }));
  freeze(ws);
  return ws;
}

// ─── Hoja 3: Cargos ───────────────────────────────────────────────────────────
const COLS_CG = ['#', 'Fecha', 'Descripción', 'N° Compra', 'Valor', 'Abonado', 'Pendiente', 'Estado'];
const ANCH_CG = [5,   14,      44,             12,          16,      16,         16,          12];

function hojaCargos(cargos) {
  const ws = {};
  headers(ws, COLS_CG, 0, C.headerGris);

  let totV = 0, totA = 0, totP = 0;
  cargos.forEach((c, i) => {
    const row = i + 1;
    const bg = c.estado_pago === 'Saldada' ? C.saldada_bg
             : c.estado_pago === 'Parcial' ? C.parcial_bg
             : C.pendiente_bg;
    const valor = Number(c.valor_original || 0);
    const abonado = Number(c.total_abonado || 0);
    const pend = Number(c.saldo_pendiente || 0);
    totV += valor; totA += abonado; totP += pend;

    put(ws, row, 0, 'n', i + 1, sNat(bg));
    put(ws, row, 1, 's', fmtFecha(c.fecha), sC(bg));
    put(ws, row, 2, 's', c.descripcion || (c.compra_id ? `Compra #${String(c.compra_numero ?? c.compra_id).padStart(5, '0')}` : 'Cargo'), sC(bg));
    put(ws, row, 3, 's', c.compra_id ? `#${String(c.compra_numero ?? c.compra_id).padStart(5, '0')}` : '', sC(bg, 'center'));
    put(ws, row, 4, 'n', valor, sN(bg));
    put(ws, row, 5, 'n', abonado, sN(bg));
    put(ws, row, 6, 'n', pend, sN(bg));
    put(ws, row, 7, 's', c.estado_pago || '', sC(bg, 'center'));
  });

  const rTot = cargos.length + 1;
  for (let c = 0; c <= 2; c++) put(ws, rTot, c, 's', c === 2 ? `TOTAL (${cargos.length})` : '', sTotalLabel());
  put(ws, rTot, 3, 's', '', sTotalLabel());
  put(ws, rTot, 4, 'n', totV, sTotal());
  put(ws, rTot, 5, 'n', totA, sTotal());
  put(ws, rTot, 6, 'n', totP, sTotal());
  put(ws, rTot, 7, 's', '', sTotalLabel());

  seal(ws, rTot, COLS_CG.length - 1);
  ws['!cols'] = ANCH_CG.map((wch) => ({ wch }));
  freeze(ws);
  return ws;
}

// ─── Export principal ─────────────────────────────────────────────────────────
/**
 * @param {object} opts
 * @param {string} opts.nombre
 * @param {string} [opts.cedula]
 * @param {string} [opts.telefono]
 * @param {boolean} [opts.esProveedor]
 * @param {Array}  opts.movimientos  — getHistorialAcreedor()
 * @param {Array}  [opts.cargos]     — getComprasConSaldo()
 * @param {number} [opts.saldoAFavor]
 */
export function exportarCuentaAcreedorExcel({ nombre, cedula, telefono, esProveedor = false, movimientos = [], cargos = [], saldoAFavor = 0 }) {
  if (!movimientos.length && !cargos.length) return;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, hojaResumen({ nombre, cedula, telefono, esProveedor, movimientos, cargos, saldoAFavor }), 'Resumen');
  if (movimientos.length > 0) XLSX.utils.book_append_sheet(wb, hojaCuenta(movimientos), 'Estado de cuenta');
  if (cargos.length > 0)      XLSX.utils.book_append_sheet(wb, hojaCargos(cargos), 'Cargos');

  const nombreSanitizado = (nombre || 'acreedor').replace(/[\\/?*[\]:]/g, '').trim().slice(0, 35) || 'acreedor';
  const fecha = new Date()
    .toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric' })
    .replace(/\//g, '-');

  XLSX.writeFile(wb, `cuenta_${nombreSanitizado}_${fecha}.xlsx`, { cellStyles: true });
}
