import * as XLSX from 'xlsx';
import { getCompraById } from '../api/compras.api';

// ─── Paleta ───────────────────────────────────────────────────────────────────
const C = {
  // Encabezados
  headerAzul:    '1E3A8A',   // azul oscuro — encabezados de columna
  headerGris:    '374151',   // gris oscuro — encabezados de sección en Resumen
  // Filas de datos
  blanco:        'FFFFFF',
  grisPar:       'F8FAFC',   // alterno par (Líneas)
  // Estado compra
  completada:    'D1FAE5',   // verde claro
  pendiente:     'FEF9C3',   // amarillo claro
  cancelada:     'FEE2E2',   // rojo claro
  // Movimiento
  cargo:         'FEE2E2',
  abono:         'D1FAE5',
  // Totales
  totalFondo:    'DBEAFE',   // azul pastel
  totalTexto:    '1E3A8A',
  // Resumen sección
  seccion:       'EFF6FF',
  // Borde
  borde:         'CBD5E1',
  bordeGrupo:    '93C5FD',   // azul para separar grupos
  // Texto
  blanco100:     'FFFFFF',
  gris600:       '4B5563',
  gris400:       '9CA3AF',
};

// ─── Helpers de estilo ────────────────────────────────────────────────────────
function b(color = C.borde) {
  const l = { style: 'thin', color: { rgb: color } };
  return { top: l, bottom: l, left: l, right: l };
}

function bGrueso(color = C.bordeGrupo) {
  const l = { style: 'medium', color: { rgb: color } };
  return { top: l, bottom: l, left: l, right: l };
}

const sH = (bg = C.headerAzul) => ({
  font:      { bold: true, name: 'Calibri', sz: 10, color: { rgb: C.blanco100 } },
  fill:      { patternType: 'solid', fgColor: { rgb: bg } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border:    b(),
});

const sC = (bg, right = false) => ({
  font:      { name: 'Calibri', sz: 9, color: { rgb: C.gris600 } },
  fill:      { patternType: 'solid', fgColor: { rgb: bg } },
  alignment: { horizontal: right ? 'right' : 'left', vertical: 'center', wrapText: true },
  border:    b(),
});

const sN = (bg) => ({
  ...sC(bg, true),
  numFmt: '[$COP-240C] #,##0',
});

const sNat = (bg) => ({
  ...sC(bg, true),
  numFmt: '#,##0',
});

const sTotal = () => ({
  font:      { bold: true, name: 'Calibri', sz: 10, color: { rgb: C.totalTexto } },
  fill:      { patternType: 'solid', fgColor: { rgb: C.totalFondo } },
  alignment: { horizontal: 'right', vertical: 'center' },
  border:    bGrueso(C.headerAzul),
  numFmt:    '[$COP-240C] #,##0',
});

const sTotalLabel = () => ({
  font:      { bold: true, name: 'Calibri', sz: 10, color: { rgb: C.totalTexto } },
  fill:      { patternType: 'solid', fgColor: { rgb: C.totalFondo } },
  alignment: { horizontal: 'left', vertical: 'center' },
  border:    bGrueso(C.headerAzul),
});

const sSeccion = () => ({
  font:      { bold: true, name: 'Calibri', sz: 11, color: { rgb: C.totalTexto } },
  fill:      { patternType: 'solid', fgColor: { rgb: C.seccion } },
  alignment: { horizontal: 'left', vertical: 'center' },
  border:    b(C.bordeGrupo),
});

const sLabel = () => ({
  font:      { bold: true, name: 'Calibri', sz: 9, color: { rgb: C.gris600 } },
  fill:      { patternType: 'solid', fgColor: { rgb: C.blanco } },
  alignment: { horizontal: 'left', vertical: 'center' },
  border:    b(),
});

const sValor = (color) => ({
  font:      { bold: true, name: 'Calibri', sz: 10, color: { rgb: color || C.headerAzul } },
  fill:      { patternType: 'solid', fgColor: { rgb: C.blanco } },
  alignment: { horizontal: 'left', vertical: 'center' },
  border:    b(),
});

const sMoneda = (color) => ({
  font:      { bold: true, name: 'Calibri', sz: 10, color: { rgb: color || C.headerAzul } },
  fill:      { patternType: 'solid', fgColor: { rgb: C.blanco } },
  alignment: { horizontal: 'right', vertical: 'center' },
  numFmt:    '[$COP-240C] #,##0',
  border:    b(),
});

const sLeyenda = (bg) => ({
  font:      { name: 'Calibri', sz: 9, color: { rgb: C.gris600 } },
  fill:      { patternType: 'solid', fgColor: { rgb: bg } },
  alignment: { horizontal: 'center', vertical: 'center' },
  border:    b(),
});

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

function headers(ws, cols, row = 0, bgOverride) {
  cols.forEach((h, c) => put(ws, row, c, 's', h, sH(bgOverride)));
}

function seal(ws, lastRow, lastCol) {
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: lastCol } });
}

function freeze(ws, row = 1, col = 0) {
  ws['!freeze'] = { xSplit: col, ySplit: row, topLeftCell: XLSX.utils.encode_cell({ r: row, c: col }) };
}

function bgCompra(estado) {
  if (estado === 'Completada') return C.completada;
  if (estado === 'Pendiente')  return C.pendiente;
  if (estado === 'Cancelada')  return C.cancelada;
  return C.blanco;
}

// ─── Hoja: Resumen ────────────────────────────────────────────────────────────
function hojaResumen(nombre, compras, movimientos) {
  const ws   = {};
  let r = 0;

  const totalComprado  = compras.reduce((s, c) => s + Number(c.total || 0), 0);
  const completadas    = compras.filter((c) => c.estado === 'Completada').length;
  const pendientes     = compras.filter((c) => c.estado === 'Pendiente').length;
  const canceladas     = compras.filter((c) => c.estado === 'Cancelada').length;
  const totalCredito   = compras.filter((c) => ['Credito','Fiado'].includes(c.metodo))
                                .reduce((s, c) => s + Number(c.total || 0), 0);
  const totalContado   = totalComprado - totalCredito;

  const cargos   = movimientos.filter((m) => m.tipo === 'Cargo');
  const abonos   = movimientos.filter((m) => m.tipo === 'Abono');
  const sumCargos = cargos.reduce((s, m) => s + Number(m.valor || 0), 0);
  const sumAbonos = abonos.reduce((s, m) => s + Number(m.valor || 0), 0);
  const saldoFinal = sumCargos - sumAbonos;

  // Título
  put(ws, r, 0, 's', `Estado de Cuenta — ${nombre}`, sSeccion()); r++;
  put(ws, r, 0, 's', `Generado el ${hoy()}`, sC(C.blanco)); r += 2;

  // ── Sección Compras ──
  if (compras.length > 0) {
    put(ws, r, 0, 's', '📦  COMPRAS', sSeccion()); r++;
    const filas = [
      ['Total de compras',             'n', compras.length,  C.gris600,    false],
      ['Total invertido',              'n', totalComprado,   C.headerAzul, true ],
      ['  · Completadas',              'n', completadas,     '16A34A',     false],
      ['  · Pendientes',               'n', pendientes,      'CA8A04',     false],
      ['  · Canceladas',               'n', canceladas,      'DC2626',     false],
      ['Pagado a crédito',             'n', totalCredito,    'D97706',     true ],
      ['Pagado de contado',            'n', totalContado,    '16A34A',     true ],
    ];
    filas.forEach(([label, t, v, color, esMoneda]) => {
      put(ws, r, 0, 's', label,  sLabel());
      put(ws, r, 1, t,   v,      esMoneda ? sMoneda(color) : sValor(color));
      r++;
    });
    r++;
  }

  // ── Sección Cuenta corriente ──
  if (movimientos.length > 0) {
    put(ws, r, 0, 's', '💳  CUENTA CORRIENTE', sSeccion()); r++;
    const filasMov = [
      ['Total movimientos',  'n', movimientos.length, C.gris600,   false],
      ['Total cargos (#)',   'n', cargos.length,      'DC2626',     false],
      ['Total abonos (#)',   'n', abonos.length,       '16A34A',    false],
      ['Suma de cargos',     'n', sumCargos,           'DC2626',    true ],
      ['Suma de abonos',     'n', sumAbonos,           '16A34A',    true ],
      ['Saldo pendiente',    'n', saldoFinal,          saldoFinal > 0 ? 'DC2626' : '16A34A', true],
    ];
    filasMov.forEach(([label, t, v, color, esMoneda]) => {
      put(ws, r, 0, 's', label, sLabel());
      put(ws, r, 1, t,   v,     esMoneda ? sMoneda(color) : sValor(color));
      r++;
    });
    r++;
  }

  // ── Leyenda ──
  put(ws, r, 0, 's', '🎨  LEYENDA DE COLORES', sSeccion()); r++;
  const leyenda = [
    [C.completada, 'Compra Completada'],
    [C.pendiente,  'Compra Pendiente'],
    [C.cancelada,  'Compra Cancelada / Cargo'],
    [C.abono,      'Abono / Pago'],
    [C.totalFondo, 'Fila de Totales'],
  ];
  leyenda.forEach(([bg, texto]) => {
    put(ws, r, 0, 's', '  ', sLeyenda(bg));
    put(ws, r, 1, 's', texto, sC(C.blanco));
    r++;
  });

  seal(ws, r, 1);
  ws['!cols'] = [{ wch: 30 }, { wch: 22 }];
  ws['!rows'] = [{ hpt: 22 }];
  return ws;
}

// ─── Hoja: Compras ────────────────────────────────────────────────────────────
const COLS_COMPRAS  = ['#', 'ID', 'Fecha', 'N° Factura Proveedor', 'Estado',
  'Método de Pago', 'Afectó Caja', 'Total', 'Sucursal', 'Registrado por', 'Notas'];
const ANCHOS_COMPRAS = [5, 8, 14, 24, 14, 20, 12, 18, 20, 20, 40];

function hojaCompras(compras) {
  const ws = {};
  headers(ws, COLS_COMPRAS);

  let totalGral = 0;
  compras.forEach((c, i) => {
    const r   = i + 1;
    const bg  = bgCompra(c.estado);
    const esC = ['Credito', 'Fiado'].includes(c.metodo);
    const tot = Number(c.total) || 0;
    totalGral += tot;
    put(ws, r,  0, 'n', i + 1,          sNat(bg));
    put(ws, r,  1, 'n', c.id,           sNat(bg));
    put(ws, r,  2, 's', fmtFecha(c.fecha), sC(bg));
    put(ws, r,  3, 's', c.numero_factura || '', sC(bg));
    put(ws, r,  4, 's', c.estado || '',  sC(bg));
    put(ws, r,  5, 's', esC ? `${c.metodo} — Crédito` : (c.metodo || 'Contado'), sC(bg));
    put(ws, r,  6, 's', c.registrar_en_caja === false ? 'No' : 'Sí', sC(bg));
    put(ws, r,  7, 'n', tot,             sN(bg));
    put(ws, r,  8, 's', c.sucursal_nombre || '', sC(bg));
    put(ws, r,  9, 's', c.usuario_nombre || '',  sC(bg));
    put(ws, r, 10, 's', c.notas || '',   sC(bg));
  });

  // Fila de total
  const rTot = compras.length + 1;
  put(ws, rTot, 0, 's', '',                     sTotalLabel());
  put(ws, rTot, 1, 's', '',                     sTotalLabel());
  put(ws, rTot, 2, 's', '',                     sTotalLabel());
  put(ws, rTot, 3, 's', '',                     sTotalLabel());
  put(ws, rTot, 4, 's', '',                     sTotalLabel());
  put(ws, rTot, 5, 's', '',                     sTotalLabel());
  put(ws, rTot, 6, 's', `TOTAL (${compras.length} compras)`, sTotalLabel());
  put(ws, rTot, 7, 'n', totalGral,              sTotal());
  put(ws, rTot, 8, 's', '',                     sTotalLabel());
  put(ws, rTot, 9, 's', '',                     sTotalLabel());
  put(ws, rTot,10, 's', '',                     sTotalLabel());

  seal(ws, rTot, COLS_COMPRAS.length - 1);
  ws['!cols'] = ANCHOS_COMPRAS.map((wch) => ({ wch }));
  freeze(ws);
  return ws;
}

// ─── Hoja: Líneas de compra ───────────────────────────────────────────────────
const COLS_LINEAS  = ['#', 'Compra ID', 'Fecha', 'N° Factura', 'Proveedor',
  'Producto', 'IMEI / Serial', 'Cantidad', 'Precio Unit.', 'Subtotal',
  'Precio USD', 'Factor Conv.', 'Valor Traída'];
const ANCHOS_LINEAS = [5, 10, 14, 22, 24, 32, 24, 10, 16, 16, 13, 13, 15];

function hojaLineas(comprasDetalle) {
  const ws   = {};
  headers(ws, COLS_LINEAS);
  let r = 1;
  let lineaNum = 0;

  comprasDetalle.forEach((compra) => {
    const lineas = compra?.lineas || [];
    if (lineas.length === 0) return;
    // Fila de grupo (cabecera de la compra)
    const grupoLabel = `▶  Compra #${compra.numero ?? compra.id}  ·  ${fmtFecha(compra.fecha)}  ·  ${compra.numero_factura || 'Sin factura'}  ·  ${compra.proveedor_nombre || ''}`;
    COLS_LINEAS.forEach((_, c) => put(ws, r, c, 's', c === 0 ? grupoLabel : '', sH(C.headerGris)));
    r++;

    let subtotalCompra = 0;
    lineas.forEach((l) => {
      lineaNum++;
      const subtotal = (Number(l.cantidad) || 0) * (Number(l.precio_unitario) || 0);
      subtotalCompra += subtotal;
      const bg = lineaNum % 2 === 0 ? C.grisPar : C.blanco;

      put(ws, r,  0, 'n', lineaNum,                    sNat(bg));
      put(ws, r,  1, 'n', compra.id,                   sNat(bg));
      put(ws, r,  2, 's', fmtFecha(compra.fecha),      sC(bg));
      put(ws, r,  3, 's', compra.numero_factura || '',  sC(bg));
      put(ws, r,  4, 's', compra.proveedor_nombre || '', sC(bg));
      put(ws, r,  5, 's', l.nombre_producto || '',      sC(bg));
      put(ws, r,  6, 's', l.imei || '',                 sC(bg));
      put(ws, r,  7, 'n', Number(l.cantidad)         || 0, sNat(bg));
      put(ws, r,  8, 'n', Number(l.precio_unitario)  || 0, sN(bg));
      put(ws, r,  9, 'n', subtotal,                    sN(bg));
      put(ws, r, 10, 'n', Number(l.precio_usd)        || 0, sNat(bg));
      put(ws, r, 11, 'n', Number(l.factor_conversion) || 0, sNat(bg));
      put(ws, r, 12, 'n', Number(l.valor_traida)      || 0, sN(bg));
      r++;
    });

    // Subtotal por compra
    COLS_LINEAS.forEach((_, c) => {
      if (c === 8) put(ws, r, c, 's', `Subtotal compra #${compra.id}`, sTotalLabel());
      else if (c === 9) put(ws, r, c, 'n', subtotalCompra, sTotal());
      else put(ws, r, c, 's', '', sTotalLabel());
    });
    r++;
  });

  seal(ws, r, COLS_LINEAS.length - 1);
  ws['!cols'] = ANCHOS_LINEAS.map((wch) => ({ wch }));
  freeze(ws);
  return ws;
}

// ─── Hoja: Cuenta corriente ───────────────────────────────────────────────────
const COLS_MOVS  = ['#', 'ID', 'Fecha', 'Tipo', 'Descripción', 'Valor',
  'Saldo Anterior', 'Saldo Nuevo', 'Compra ID', 'Cargo Referenciado', 'Método'];
const ANCHOS_MOVS = [5, 8, 14, 10, 42, 18, 18, 18, 11, 38, 16];

function hojaMovimientos(movimientos) {
  const ws = {};
  headers(ws, COLS_MOVS);

  let sumCargos = 0;
  let sumAbonos = 0;

  movimientos.forEach((m, i) => {
    const r  = i + 1;
    const bg = m.tipo === 'Cargo' ? C.cargo : C.abono;
    const v  = Number(m.valor) || 0;
    if (m.tipo === 'Cargo') sumCargos += v; else sumAbonos += v;

    put(ws, r,  0, 'n', i + 1,                     sNat(bg));
    put(ws, r,  1, 'n', m.id,                       sNat(bg));
    put(ws, r,  2, 's', fmtFecha(m.fecha),          sC(bg));
    put(ws, r,  3, 's', m.tipo || '',               sC(bg));
    put(ws, r,  4, 's', m.descripcion || '',        sC(bg));
    put(ws, r,  5, 'n', v,                          sN(bg));
    put(ws, r,  6, 'n', Number(m.saldo_antes)   || 0, sN(bg));
    put(ws, r,  7, 'n', Number(m.saldo_despues) || 0, sN(bg));
    put(ws, r,  8, m.compra_id ? 'n' : 's', m.compra_id || '', m.compra_id ? sNat(bg) : sC(bg));
    put(ws, r,  9, 's', m.cargo_descripcion || (m.cargo_id ? `Cargo #${m.cargo_id}` : ''), sC(bg));
    put(ws, r, 10, 's', m.metodo || '',             sC(bg));
  });

  // Fila de totales
  const rTot = movimientos.length + 1;
  const saldo = sumCargos - sumAbonos;
  const colLabels = ['', '', '', '', 'TOTALES →', sumCargos, sumAbonos, saldo, '', '', ''];
  colLabels.forEach((v, c) => {
    if (c === 5 || c === 6 || c === 7) put(ws, rTot, c, 'n', v, sTotal());
    else put(ws, rTot, c, 's', v, sTotalLabel());
  });

  // Fila de descripción de totales
  const rDesc = rTot + 1;
  put(ws, rDesc, 4, 's', '↑ Cargos totales', sTotalLabel());
  put(ws, rDesc, 5, 's', '', sTotalLabel());
  put(ws, rDesc, 6, 's', '↑ Abonos totales', sTotalLabel());
  put(ws, rDesc, 7, 's', '↑ Saldo pendiente', sTotalLabel());

  seal(ws, rDesc, COLS_MOVS.length - 1);
  ws['!cols'] = ANCHOS_MOVS.map((wch) => ({ wch }));
  freeze(ws);
  return ws;
}

// ─── Export principal ─────────────────────────────────────────────────────────
/**
 * @param {object}   opts
 * @param {string}   opts.nombre      - Nombre del proveedor / acreedor
 * @param {Array}    opts.compras     - Lista de compras pre-cargadas (puede ser [])
 * @param {number[]} opts.compraIds   - IDs a buscar cuando no hay lista pre-cargada
 * @param {Array}    opts.movimientos - Movimientos de cuenta corriente (puede ser [])
 */
export async function exportarCuentaExcel({ nombre = 'reporte', compras = [], compraIds = [], movimientos = [] }) {
  const wb = XLSX.utils.book_new();

  // Resolver compras: pre-cargadas o buscar por ID
  let comprasDetalle = [];
  let comprasHeader  = compras;

  const idsAFetch = compras.length > 0
    ? compras.map((c) => c.id)
    : compraIds.filter(Boolean);

  if (idsAFetch.length > 0) {
    try {
      comprasDetalle = await Promise.all(
        idsAFetch.map((id) => getCompraById(id).then((r) => r.data.data))
      );
      if (comprasHeader.length === 0) comprasHeader = comprasDetalle;
    } catch {
      comprasDetalle = [];
    }
  }

  // Hoja 0: Resumen (siempre)
  XLSX.utils.book_append_sheet(wb, hojaResumen(nombre, comprasHeader, movimientos), 'Resumen');

  // Hoja 1: Compras
  if (comprasHeader.length > 0) {
    XLSX.utils.book_append_sheet(wb, hojaCompras(comprasHeader), 'Compras');
  }

  // Hoja 2: Líneas de productos
  if (comprasDetalle.some((c) => c?.lineas?.length > 0)) {
    XLSX.utils.book_append_sheet(wb, hojaLineas(comprasDetalle), 'Líneas de Compra');
  }

  // Hoja 3: Cuenta Corriente
  if (movimientos.length > 0) {
    XLSX.utils.book_append_sheet(wb, hojaMovimientos(movimientos), 'Cuenta Corriente');
  }

  const nombreSanitizado = nombre.replace(/[\\/?*[\]:]/g, '').trim().slice(0, 40) || 'reporte';
  const fecha = new Date().toLocaleDateString('es-CO', {
    timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric',
  }).replace(/\//g, '-');

  XLSX.writeFile(wb, `${nombreSanitizado}_${fecha}.xlsx`, { cellStyles: true });
}
