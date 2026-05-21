import ExcelJS from 'exceljs';

var A_DISPONIBLE = 'FFFFFFFF';
var A_PRESTADO   = 'FFBFDBFE';
var A_VENDIDO    = 'FFDCFCE7';
var A_HEADER     = 'FF1E40AF';
var A_BLANCO     = 'FFFFFFFF';
var A_BORDE      = 'FFD1D5DB';
var A_LEY_TIT    = 'FFE2E8F0';
var A_LEY_BG     = 'FFF1F5F9';
var A_TEXTO      = 'FF374151';

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
function bgSerial(s) {
  if (s.vendido)  return A_VENDIDO;
  if (s.prestado) return A_PRESTADO;
  return A_DISPONIBLE;
}
function colW(col) {
  var m = { 'Referencia': 28, 'IMEI / Serial': 22, 'Color': 14, 'Prestamista': 22, 'Fecha Entrada': 14, 'Cliente Origen': 22 };
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
function leyenda(ws, n) {
  var lr = ws.getRow(1); lr.height = 18;
  var c1 = lr.getCell(1); c1.value = 'Leyenda:';
  c1.font = { bold: true, name: 'Arial', size: 9, color: { argb: A_TEXTO } };
  c1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: A_LEY_TIT } };
  c1.alignment = { horizontal: 'left', vertical: 'middle' }; applyBorde(c1);
  var inds = [['Disponible', A_DISPONIBLE], ['Prestado', A_PRESTADO], ['Vendido', A_VENDIDO]];
  for (var i = 0; i < inds.length; i++) {
    var ci = lr.getCell(i + 2); ci.value = inds[i][0];
    ci.font = { name: 'Arial', size: 9, color: { argb: A_TEXTO } };
    ci.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: inds[i][1] } };
    ci.alignment = { horizontal: 'center', vertical: 'middle' }; applyBorde(ci);
  }
  for (var ei = 5; ei <= n; ei++) {
    var ec = lr.getCell(ei);
    ec.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: A_LEY_BG } };
    applyBorde(ec);
  }
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

export async function exportarInventarioPorLineas(porLinea, configMap) {
  var cfg     = configMap || {};
  var colAct  = cfg.colores_serial_activo         === '1';
  var carAct  = cfg.caracteristicas_serial_activo === '1';
  var carList = carAct ? parseLista(cfg.caracteristicas_serial_lista) : [];

  var wb     = new ExcelJS.Workbook();
  var usadas = new Set();

  var lineas = Object.keys(porLinea).sort(function(a, b) {
    if (a === 'Sin Línea') return 1; if (b === 'Sin Línea') return -1;
    return a.localeCompare(b, 'es');
  });

  for (var i = 0; i < lineas.length; i++) {
    var linea    = lineas[i];
    var seriales = porLinea[linea];
    var ws       = wb.addWorksheet(hojaUnica(linea, usadas));

    var cols = ['Referencia', 'IMEI / Serial'];
    if (colAct) cols.push('Color');
    for (var ci = 0; ci < carList.length; ci++) cols.push(carList[ci]);
    cols.push('Prestamista', 'Fecha Entrada', 'Cliente Origen');

    ws.columns = cols.map(function(c) { return { width: colW(c) }; });
    leyenda(ws, cols.length);

    var hr = ws.getRow(2); hr.height = 22;
    for (var hi = 0; hi < cols.length; hi++) {
      var hc = hr.getCell(hi + 1); hc.value = cols[hi]; applyHeader(hc);
    }
    ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: cols.length } };

    var sorted = seriales.slice().sort(function(a, b) {
      var oa = a.vendido ? 2 : a.prestado ? 1 : 0;
      var ob = b.vendido ? 2 : b.prestado ? 1 : 0;
      return oa - ob;
    });

    for (var ri = 0; ri < sorted.length; ri++) {
      var s   = sorted[ri];
      var bg  = bgSerial(s);
      var car = s.caracteristicas || {};
      var dr  = ws.getRow(ri + 3);
      var cc  = 1;

      var refCell  = dr.getCell(cc++); refCell.value  = s.producto || ''; applyCell(refCell, bg);
      var imeiCell = dr.getCell(cc++); imeiCell.value = s.imei     || ''; applyCell(imeiCell, bg);
      if (colAct) { var clrCell = dr.getCell(cc++); clrCell.value = s.color || ''; applyCell(clrCell, bg); }
      for (var ki = 0; ki < carList.length; ki++) {
        var ck = dr.getCell(cc++); ck.value = car[carList[ki]] || ''; applyCell(ck, bg);
      }
      var cpCell = dr.getCell(cc++); cpCell.value = s.prestamista            || ''; applyCell(cpCell, bg);
      var cfCell = dr.getCell(cc++); cfCell.value = fmtFecha(s.fecha_entrada);       applyCell(cfCell, bg);
      var coCell = dr.getCell(cc++); coCell.value = s.cliente_origen         || ''; applyCell(coCell, bg);
    }
  }

  var buffer = await wb.xlsx.writeBuffer();
  descargar(buffer, 'inventario_lineas_' + hoy() + '.xlsx');
}
