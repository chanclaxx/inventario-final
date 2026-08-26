// Estilos y hoja "Estado de cuenta" compartidos por los exportadores de cartera
// (préstamos y facturas a crédito). Un solo formato para las dos exportaciones.
import * as XLSX from 'xlsx';

// ─── Paleta ───────────────────────────────────────────────────────────────────
export const C = {
  headerOscuro: '1E3A8A',   // azul oscuro
  headerGris:   '374151',
  seccion:      'EFF6FF',
  totalFondo:   'DBEAFE',
  totalTexto:   '1E3A8A',
  blanco:       'FFFFFF',
  blancoAlt:    'F8FAFC',
  borde:        'CBD5E1',
  gris600:      '4B5563',

  // Estados de documento
  activo_bg:    'FFFFFF',
  saldado_bg:   'DCFCE7',
  devuelto_bg:  'F3F4F6',
};

// ─── Helpers de estilo ────────────────────────────────────────────────────────

export function borde(color = C.borde) {
  const l = { style: 'thin', color: { rgb: color } };
  return { top: l, bottom: l, left: l, right: l };
}

export function bordeGrueso(color = C.headerOscuro) {
  const l = { style: 'medium', color: { rgb: color } };
  return { top: l, bottom: l, left: l, right: l };
}

/** Encabezado de columna — fondo oscuro, texto blanco, centrado. */
export const sH = (bg = C.headerOscuro) => ({
  font:      { bold: true, name: 'Calibri', sz: 10, color: { rgb: C.blanco } },
  fill:      { patternType: 'solid', fgColor: { rgb: bg } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border:    borde(),
});

/** Celda de dato. */
export const sC = (bg, align = 'left') => ({
  font:      { name: 'Calibri', sz: 9, color: { rgb: C.gris600 } },
  fill:      { patternType: 'solid', fgColor: { rgb: bg } },
  alignment: { horizontal: align, vertical: 'center', wrapText: true },
  border:    borde(),
});

/** Celda numérica con formato COP. */
export const sN = (bg) => ({ ...sC(bg, 'right'), numFmt: '[$COP-240C] #,##0' });

/** Celda numérica sin prefijo (enteros). */
export const sNat = (bg) => ({ ...sC(bg, 'right'), numFmt: '#,##0' });

/** Fila de totales. */
export const sTotal = () => ({
  font:      { bold: true, name: 'Calibri', sz: 10, color: { rgb: C.totalTexto } },
  fill:      { patternType: 'solid', fgColor: { rgb: C.totalFondo } },
  alignment: { horizontal: 'right', vertical: 'center' },
  border:    bordeGrueso(),
  numFmt:    '[$COP-240C] #,##0',
});
export const sTotalLabel = () => ({
  font:      { bold: true, name: 'Calibri', sz: 10, color: { rgb: C.totalTexto } },
  fill:      { patternType: 'solid', fgColor: { rgb: C.totalFondo } },
  alignment: { horizontal: 'left', vertical: 'center' },
  border:    bordeGrueso(),
});

/** Título de sección dentro de una hoja. */
export const sSeccion = () => ({
  font:      { bold: true, name: 'Calibri', sz: 11, color: { rgb: C.totalTexto } },
  fill:      { patternType: 'solid', fgColor: { rgb: C.seccion } },
  alignment: { horizontal: 'left', vertical: 'center' },
  border:    borde(C.headerOscuro),
});

/** Etiqueta de fila (columna izquierda de un bloque de dos columnas). */
export const sLabel = () => ({
  font:      { bold: true, name: 'Calibri', sz: 9, color: { rgb: C.gris600 } },
  fill:      { patternType: 'solid', fgColor: { rgb: C.blanco } },
  alignment: { horizontal: 'left', vertical: 'center' },
  border:    borde(),
});

export const sValor = (color = C.headerOscuro) => ({
  font:      { bold: true, name: 'Calibri', sz: 10, color: { rgb: color } },
  fill:      { patternType: 'solid', fgColor: { rgb: C.blanco } },
  alignment: { horizontal: 'right', vertical: 'center' },
  border:    borde(),
});

export const sMoneda = (color = C.headerOscuro) => ({
  ...sValor(color), numFmt: '[$COP-240C] #,##0',
});

/** Badge de leyenda. */
export const sLeyenda = (bg) => ({
  font:      { name: 'Calibri', sz: 9, color: { rgb: C.gris600 } },
  fill:      { patternType: 'solid', fgColor: { rgb: bg } },
  alignment: { horizontal: 'center', vertical: 'center' },
  border:    borde(),
});

// ─── Fechas ───────────────────────────────────────────────────────────────────

export function fmtFecha(val) {
  if (!val) return '';
  const raw = typeof val === 'string' && !val.includes('T') && !val.includes('+')
    ? new Date(val.replace(' ', 'T') + 'Z')
    : new Date(val);
  if (isNaN(raw)) return '';
  return raw.toLocaleDateString('es-CO', {
    timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

export function hoy() {
  return new Date().toLocaleDateString('es-CO', {
    timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

// ─── Primitivas de hoja ───────────────────────────────────────────────────────

export function put(ws, r, c, t, v, s) {
  ws[XLSX.utils.encode_cell({ r, c })] = { t, v: v ?? '', s };
}

export function headers(ws, cols, row = 0, bg) {
  cols.forEach((h, c) => put(ws, row, c, 's', h, sH(bg)));
}

export function seal(ws, lastRow, lastCol) {
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: lastCol } });
}

export function freeze(ws, row = 1, col = 0) {
  ws['!freeze'] = { xSplit: col, ySplit: row, topLeftCell: XLSX.utils.encode_cell({ r: row, c: col }) };
}

/** Nombre de archivo seguro para Excel a partir del nombre de la persona. */
export function nombreArchivo(prefijo, nombre) {
  const limpio = String(nombre || '').replace(/[\\/?*[\]:]/g, '').trim().slice(0, 35) || 'cuenta';
  const fecha  = hoy().replace(/\//g, '-');
  return `${prefijo}_${limpio}_${fecha}.xlsx`;
}

// ─── Hoja "Estado de cuenta" ──────────────────────────────────────────────────

const COLS_EC = ['#', 'Fecha', 'Tipo', 'Concepto', 'Cargo (deuda)', 'Abono (pago)', 'Saldo deuda'];
const ANCH_EC = [5,   14,      22,     52,          18,              18,             18];

/**
 * Vuelca los movimientos tal como se ven en pantalla.
 *
 * El SALDO FINAL no se recalcula sumando cargos − abonos: se toma del último
 * movimiento que participa del acumulado, porque los informativos (mora,
 * compras de artículo, documentos anulados) no afectan la deuda. Sumarlos daría
 * un total distinto al de la pantalla y al del PDF.
 *
 * @param {Array}  movimientos — salida de getEstadoCuenta (ya trae `saldo`)
 * @param {object} tipoMeta    — tipo → { bg, tx, label, desc }
 */
export function hojaEstadoCuenta(movimientos, tipoMeta) {
  const ws = {};
  headers(ws, COLS_EC, 0, C.headerOscuro);

  const fallback = Object.values(tipoMeta)[0];
  let sumaCargos = 0;
  let sumaAbonos = 0;

  movimientos.forEach((m, i) => {
    const r    = i + 1;
    const meta = tipoMeta[m.tipo] || fallback;
    const bg   = meta.bg;

    const cargo = Number(m.cargo || 0);
    const abono = Number(m.abono || 0);
    // Lo ANULADO se ve en su fila —con el motivo— pero no entra en el total de
    // la columna: si entrara, la fila de TOTALES diria que el cliente abono mas
    // de lo que realmente cuenta y no cuadraria contra la columna de saldo.
    // `anulado_total` cubre el abono anulado entero y `valor_anulado` la parte
    // de un pago total repartido que dejo de contar.
    const sinContar = m.anulado_total === true
      ? abono
      : Math.min(abono, Number(m.valor_anulado || 0));
    sumaCargos += cargo;
    sumaAbonos += abono - sinContar;

    put(ws, r, 0, 'n', i + 1,            sNat(bg));
    put(ws, r, 1, 's', fmtFecha(m.fecha), sC(bg));
    put(ws, r, 2, 's', meta.label,        sC(bg));
    // La descripción libre del movimiento (hoy la del pago total) va pegada al
    // concepto: la hoja tiene una sola columna de justificación.
    const partes = [m.concepto || ''];
    if (m.descripcion) partes.push(m.descripcion);
    // El motivo de la anulacion va en la misma columna: la hoja no tiene una
    // propia y sin el queda una fila que no suma y no dice por que.
    if (m.anulado || m.anulado_total || Number(m.valor_anulado || 0) > 0) {
      partes.push(`ANULADO — ${m.motivo_anulacion || 'sin motivo registrado'}`);
    }
    const justificacion = partes.filter(Boolean).join(' · ');
    put(ws, r, 3, 's', justificacion,     sC(bg));

    if (cargo > 0) put(ws, r, 4, 'n', cargo, sN(bg));
    else           put(ws, r, 4, 's', '',    sC(bg));

    if (abono > 0) put(ws, r, 5, 'n', abono, sN(bg));
    else           put(ws, r, 5, 's', '',    sC(bg));

    if (m.saldo != null) put(ws, r, 6, 'n', Number(m.saldo), sN(Number(m.saldo) > 0 ? 'FEE2E2' : 'D1FAE5'));
    else                 put(ws, r, 6, 's', '—',             sC(bg, 'center'));
  });

  const rTot = movimientos.length + 1;
  put(ws, rTot, 0, 's', '', sTotalLabel());
  put(ws, rTot, 1, 's', '', sTotalLabel());
  put(ws, rTot, 2, 's', '', sTotalLabel());
  put(ws, rTot, 3, 's', `TOTALES (${movimientos.length} movimientos)`, sTotalLabel());
  put(ws, rTot, 4, 'n', sumaCargos, sTotal());
  put(ws, rTot, 5, 'n', sumaAbonos, sTotal());
  put(ws, rTot, 6, 'n', saldoFinalDe(movimientos), sTotal());

  seal(ws, rTot, COLS_EC.length - 1);
  ws['!cols'] = ANCH_EC.map((wch) => ({ wch }));
  freeze(ws);
  return ws;
}

/** Saldo que muestra la pantalla: el del último movimiento con acumulado. */
export function saldoFinalDe(movimientos) {
  const conSaldo = movimientos.filter((m) => m.saldo != null);
  return conSaldo.length ? Number(conSaldo[conSaldo.length - 1].saldo) : 0;
}
