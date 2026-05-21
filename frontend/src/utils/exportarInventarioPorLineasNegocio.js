import ExcelJS from 'exceljs';

// ── Colores fijos ─────────────────────────────────────────────────────────────
var A_VENDIDO  = 'FFFCA5A5'; // rojo  – siempre para vendidos
var A_HEADER   = 'FF1E40AF';
var A_BLANCO   = 'FFFFFFFF';
var A_BORDE    = 'FFD1D5DB';
var A_LEY_TIT  = 'FFE2E8F0';
var A_LEY_BG   = 'FFF1F5F9';
var A_TEXTO    = 'FF374151';

// ── Paleta por índice de sucursal [disponible, prestado] ──────────────────────
// Idx 0 = sucursal principal (más antigua por nombre)
// Idx 1 = segunda sucursal → naranja / morado
// Idx 2+ → colores adicionales
var PALETA = [
  ['FFFFFFFF', 'FFBFDBFE'], // blanco   / azul-200
  ['FFFED7AA', 'FFE9D5FF'], // naranja  / morado
  ['FFFEF08A', 'FFD9F99D'], // amarillo / lima
  ['FF99F6E4', 'FFBAE6FD'], // esmeralda/ cielo
  ['FFFECDD3', 'FFE0E7FF'], // rosa     / índigo
];

function coloresSucursal(idx) {
  return PALETA[Math.min(idx, PALETA.length - 1)];
}

function bgSerial(s, sucursalIdx) {
  if (s.vendido) return A_VENDIDO;
  var cols = coloresSucursal(sucursalIdx >= 0 ? sucursalIdx : 0);
  return s.prestado ? cols[1] : cols[0];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseLista(val) {
  if (!val) return [];
  try { var p = JSON.parse(val); return Array.isArray(p) ? p : []; }
  catch { return String(val).split(',').map(function(v) { return v.trim(); }).filter(Boolean); }
}
function fmtFecha(val) {
  if (!val) return '';
  var d = new Date(val);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function colW(col) {
  var m = {
    'Referencia': 28, 'Sucursal': 20, 'IMEI / Serial': 22,
    'Color': 14, 'Prestamista': 22, 'Fecha Entrada': 14, 'Cliente Origen': 22,
  };
  return m[col] !== undefined ? m[col] : Math.max(col.length + 4, 12);
}
function applyBorde(cell) {
  var b = { style: 'thin', color: { argb: A_BORDE } };
  cell.border = { top: b, bottom: b, left: b, right: b };
}
function applyHeader(cell) {
  cell.font      = { bold: true, name: 'Arial', size: 10, color: { argb: A_BLANCO } };
  cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: A_HEADER } };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  applyBorde(cell);
}
function applyCell(cell, bg) {
  cell.font      = { name: 'Arial', size: 9 };
  cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
  cell.alignment = { vertical: 'middle' };
  applyBorde(cell);
}
function hojaUnica(nombre, usadas) {
  var h = (nombre || 'Sin nombre').replace(/[\\/?*[\]:]/g, '').trim().slice(0, 31) || 'Sin nombre';
  if (usadas.has(h.toLowerCase())) {
    var i = 2;
    while (usadas.has((h.slice(0, 28) + ' ' + i).toLowerCase())) i++;
    h = h.slice(0, 28) + ' ' + i;
  }
  usadas.add(h.toLowerCase()); return h;
}
function hoy() {
  return new Date().toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
}
function descargar(buffer, nombre) {
  var blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a'); a.href = url; a.download = nombre; a.click();
  URL.revokeObjectURL(url);
}

// ── Leyenda dinámica por sucursales ───────────────────────────────────────────
function leyenda(ws, n, sucursalesList) {
  var lr = ws.getRow(1); lr.height = 18;
  var cc = 1;

  var c1 = lr.getCell(cc++); c1.value = 'Leyenda:';
  c1.font = { bold: true, name: 'Arial', size: 9, color: { argb: A_TEXTO } };
  c1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: A_LEY_TIT } };
  c1.alignment = { horizontal: 'left', vertical: 'middle' }; applyBorde(c1);

  // Vendido siempre rojo
  var cv = lr.getCell(cc++); cv.value = 'Vendido';
  cv.font = { name: 'Arial', size: 9, color: { argb: A_TEXTO } };
  cv.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: A_VENDIDO } };
  cv.alignment = { horizontal: 'center', vertical: 'middle' }; applyBorde(cv);

  // Una entrada por sucursal (disponible + prestado)
  for (var i = 0; i < sucursalesList.length; i++) {
    var cols  = coloresSucursal(i);
    var sName = sucursalesList[i] || ('Suc. ' + (i + 1));

    var cd = lr.getCell(cc++);
    cd.value = sName + ' – Disp.';
    cd.font = { name: 'Arial', size: 9, color: { argb: A_TEXTO } };
    cd.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cols[0] } };
    cd.alignment = { horizontal: 'center', vertical: 'middle' }; applyBorde(cd);

    var cp = lr.getCell(cc++);
    cp.value = sName + ' – Prest.';
    cp.font = { name: 'Arial', size: 9, color: { argb: A_TEXTO } };
    cp.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cols[1] } };
    cp.alignment = { horizontal: 'center', vertical: 'middle' }; applyBorde(cp);
  }

  // Rellenar celdas restantes
  for (var ei = cc; ei <= n; ei++) {
    var ec = lr.getCell(ei);
    ec.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: A_LEY_BG } };
    applyBorde(ec);
  }
}

// ── Exportación principal ─────────────────────────────────────────────────────
export async function exportarInventarioPorLineasNegocio(porLinea, configMap) {
  var cfg     = configMap || {};
  var colAct  = cfg.colores_serial_activo         === '1';
  var carAct  = cfg.caracteristicas_serial_activo === '1';
  var carList = carAct ? parseLista(cfg.caracteristicas_serial_lista) : [];

  // Construir lista ordenada de sucursales (orden alfabético para consistencia)
  var sucursalesSet = new Set();
  var lineasKeys = Object.keys(porLinea).sort(function(a, b) {
    if (a === 'Sin Línea') return 1; if (b === 'Sin Línea') return -1;
    return a.localeCompare(b, 'es');
  });
  for (var li = 0; li < lineasKeys.length; li++) {
    var sers = porLinea[lineasKeys[li]];
    for (var si = 0; si < sers.length; si++) {
      if (sers[si].sucursal_nombre) sucursalesSet.add(sers[si].sucursal_nombre);
    }
  }
  var sucursalesList = Array.from(sucursalesSet).sort(function(a, b) { return a.localeCompare(b, 'es'); });

  var wb     = new ExcelJS.Workbook();
  var usadas = new Set();

  for (var ki = 0; ki < lineasKeys.length; ki++) {
    var linea    = lineasKeys[ki];
    var seriales = porLinea[linea];
    var ws       = wb.addWorksheet(hojaUnica(linea, usadas));

    var cols = ['Referencia', 'Sucursal', 'IMEI / Serial'];
    if (colAct) cols.push('Color');
    for (var ci = 0; ci < carList.length; ci++) cols.push(carList[ci]);
    cols.push('Prestamista', 'Fecha Entrada', 'Cliente Origen');

    ws.columns = cols.map(function(c) { return { width: colW(c) }; });
    leyenda(ws, cols.length, sucursalesList);

    var hr = ws.getRow(2); hr.height = 22;
    for (var hi = 0; hi < cols.length; hi++) {
      applyHeader(hr.getCell(hi + 1));
      hr.getCell(hi + 1).value = cols[hi];
    }
    ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: cols.length } };

    var sorted = seriales.slice().sort(function(a, b) {
      var oa = a.vendido ? 2 : a.prestado ? 1 : 0;
      var ob = b.vendido ? 2 : b.prestado ? 1 : 0;
      if (oa !== ob) return oa - ob;
      return (a.sucursal_nombre || '').localeCompare(b.sucursal_nombre || '', 'es');
    });

    for (var ri = 0; ri < sorted.length; ri++) {
      var s           = sorted[ri];
      var sucursalIdx = sucursalesList.indexOf(s.sucursal_nombre || '');
      var bg          = bgSerial(s, sucursalIdx);
      var car         = s.caracteristicas || {};
      var dr          = ws.getRow(ri + 3);
      var cc2         = 1;

      var cRef  = dr.getCell(cc2++); cRef.value  = s.producto          || ''; applyCell(cRef, bg);
      var cSuc  = dr.getCell(cc2++); cSuc.value  = s.sucursal_nombre   || ''; applyCell(cSuc, bg);
      var cImei = dr.getCell(cc2++); cImei.value = s.imei              || ''; applyCell(cImei, bg);
      if (colAct) {
        var cClr = dr.getCell(cc2++); cClr.value = s.color || ''; applyCell(cClr, bg);
      }
      for (var cki = 0; cki < carList.length; cki++) {
        var ck = dr.getCell(cc2++); ck.value = car[carList[cki]] || ''; applyCell(ck, bg);
      }
      var cPrest = dr.getCell(cc2++); cPrest.value = s.prestamista            || ''; applyCell(cPrest, bg);
      var cFecha = dr.getCell(cc2++); cFecha.value = fmtFecha(s.fecha_entrada);       applyCell(cFecha, bg);
      var cOrig  = dr.getCell(cc2++); cOrig.value  = s.cliente_origen         || ''; applyCell(cOrig, bg);
    }
  }

  var buffer = await wb.xlsx.writeBuffer();
  descargar(buffer, 'inventario_lineas_' + hoy() + '.xlsx');
}
