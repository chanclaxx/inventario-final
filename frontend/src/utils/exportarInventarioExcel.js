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
function colW(col) {
  var m = { 'IMEI / Serial': 22, 'Estado': 12, 'Color': 14, 'Prestamista': 22,
            'Fecha Entrada': 14, 'Fecha Salida': 14, 'Cliente Venta': 22,
            'Cédula Venta': 14, 'Cliente Origen': 22,
            'Nombre': 28, 'Stock': 10, 'Stock Mínimo': 12, 'Unidad Medida': 14 };
  return m[col] !== undefined ? m[col] : Math.max(col.length + 4, 12);
}
function bgSerial(s) {
  if (s.vendido)  return A_VENDIDO;
  if (s.prestado) return A_PRESTADO;
  return A_DISPONIBLE;
}
function estadoSerial(s) {
  if (s.vendido)  return 'Vendido';
  if (s.prestado) return 'Prestado';
  return 'Disponible';
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
function applyCellNum(cell, bg) {
  cell.font      = { name: 'Arial', size: 9 };
  cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
  cell.alignment = { horizontal: 'right', vertical: 'middle' };
  cell.numFmt    = '#,##0';
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

export async function exportarInventarioExcel(porProducto, cantidad, configMap) {
  var cfg     = configMap || {};
  var colAct  = cfg.colores_serial_activo         === '1';
  var carAct  = cfg.caracteristicas_serial_activo === '1';
  var codAct  = cfg.codigo_producto_activo        === '1';
  var carList = carAct ? parseLista(cfg.caracteristicas_serial_lista) : [];

  var wb     = new ExcelJS.Workbook();
  var usadas = new Set();

  // ── Hojas por producto ──
  var nombres = Object.keys(porProducto).sort(function(a, b) { return a.localeCompare(b, 'es'); });
  for (var i = 0; i < nombres.length; i++) {
    var nombre   = nombres[i];
    var seriales = porProducto[nombre];
    var ws       = wb.addWorksheet(hojaUnica(nombre, usadas));

    var cols = ['IMEI / Serial', 'Estado'];
    if (colAct) cols.push('Color');
    for (var ci = 0; ci < carList.length; ci++) cols.push(carList[ci]);
    cols.push('Prestamista', 'Fecha Entrada', 'Fecha Salida', 'Cliente Venta', 'Cédula Venta', 'Cliente Origen');

    ws.columns = cols.map(function(c) { return { width: colW(c) }; });
    leyenda(ws, cols.length);

    var hr = ws.getRow(2); hr.height = 22;
    for (var hi = 0; hi < cols.length; hi++) {
      var hc = hr.getCell(hi + 1); hc.value = cols[hi]; applyHeader(hc);
    }
    ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: cols.length } };

    for (var ri = 0; ri < seriales.length; ri++) {
      var s   = seriales[ri];
      var bg  = bgSerial(s);
      var car = s.caracteristicas || {};
      var dr  = ws.getRow(ri + 3);
      var cc  = 1;

      var c1 = dr.getCell(cc++); c1.value = s.imei || '';          applyCell(c1, bg);
      var c2 = dr.getCell(cc++); c2.value = estadoSerial(s);       applyCell(c2, bg);
      if (colAct) { var c3 = dr.getCell(cc++); c3.value = s.color || ''; applyCell(c3, bg); }
      for (var ki = 0; ki < carList.length; ki++) {
        var ck = dr.getCell(cc++); ck.value = car[carList[ki]] || ''; applyCell(ck, bg);
      }
      var cp = dr.getCell(cc++); cp.value = s.prestamista             || ''; applyCell(cp, bg);
      var cf = dr.getCell(cc++); cf.value = fmtFecha(s.fecha_entrada);        applyCell(cf, bg);
      var cs = dr.getCell(cc++); cs.value = fmtFecha(s.fecha_salida);         applyCell(cs, bg);
      var cv = dr.getCell(cc++); cv.value = s.cliente_venta            || ''; applyCell(cv, bg);
      var ce = dr.getCell(cc++); ce.value = s.cedula_cliente_venta     || ''; applyCell(ce, bg);
      var co = dr.getCell(cc++); co.value = s.cliente_origen           || ''; applyCell(co, bg);
    }
  }

  // ── Hoja Por Cantidad ──
  if (cantidad && cantidad.length) {
    var wsCant   = wb.addWorksheet('Por Cantidad');
    var cantCols = ['Nombre'];
    if (codAct) cantCols.push('Código');
    cantCols.push('Stock', 'Stock Mínimo', 'Unidad Medida', 'Cliente Origen');
    wsCant.columns = cantCols.map(function(c) { return { width: colW(c) }; });

    var cantHr = wsCant.getRow(1);
    for (var chi = 0; chi < cantCols.length; chi++) {
      var chc = cantHr.getCell(chi + 1); chc.value = cantCols[chi]; applyHeader(chc);
    }

    var bgCant = A_DISPONIBLE;
    for (var cri = 0; cri < cantidad.length; cri++) {
      var p   = cantidad[cri];
      var cdr = wsCant.getRow(cri + 2);
      var ccn = 1;
      var ca0 = cdr.getCell(ccn++); ca0.value = p.nombre               || ''; applyCell(ca0, bgCant);
      if (codAct) {
        // Texto explícito: preserva ceros a la izquierda de códigos EAN/UPC
        var cak = cdr.getCell(ccn++); cak.value = p.codigo != null ? String(p.codigo) : ''; applyCell(cak, bgCant);
      }
      var ca1 = cdr.getCell(ccn++); ca1.value = Number(p.stock)        || 0;  applyCellNum(ca1, bgCant);
      var ca2 = cdr.getCell(ccn++); ca2.value = Number(p.stock_minimo) || 0;  applyCellNum(ca2, bgCant);
      var ca3 = cdr.getCell(ccn++); ca3.value = p.unidad_medida        || ''; applyCell(ca3, bgCant);
      var ca4 = cdr.getCell(ccn++); ca4.value = p.cliente_origen       || ''; applyCell(ca4, bgCant);
    }
  }

  var buffer = await wb.xlsx.writeBuffer();
  descargar(buffer, 'inventario_' + hoy() + '.xlsx');
}
