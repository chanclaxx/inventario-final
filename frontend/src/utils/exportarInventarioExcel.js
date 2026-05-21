import * as XLSX from 'xlsx';

var C_DISPONIBLE = 'FFFFFF';
var C_PRESTADO   = 'BFDBFE';
var C_VENDIDO    = 'DCFCE7';
var C_HEADER     = '1E40AF';
var C_BLANCO     = 'FFFFFF';
var C_BORDE      = 'D1D5DB';
var C_LEY_TIT    = 'E2E8F0';
var C_LEY_BG     = 'F1F5F9';

function borde() {
  var l = { style: 'thin', color: { rgb: C_BORDE } };
  return { top: l, bottom: l, left: l, right: l };
}
function sHeader() {
  return { font: { bold: true, name: 'Arial', sz: 10, color: { rgb: C_BLANCO } }, fill: { patternType: 'solid', fgColor: { rgb: C_HEADER }, bgColor: { indexed: 64 } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: borde() };
}
function sCelda(bg) {
  return { font: { name: 'Arial', sz: 9 }, fill: { patternType: 'solid', fgColor: { rgb: bg }, bgColor: { indexed: 64 } }, alignment: { vertical: 'center' }, border: borde() };
}
function sCeldaNum(bg) {
  return { font: { name: 'Arial', sz: 9 }, fill: { patternType: 'solid', fgColor: { rgb: bg }, bgColor: { indexed: 64 } }, alignment: { horizontal: 'right', vertical: 'center' }, numFmt: '#,##0', border: borde() };
}
function enc(r, c) { return XLSX.utils.encode_cell({ r: r, c: c }); }
function fmtFecha(val) {
  if (!val) return '';
  var d = new Date(val);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function parseLista(val) {
  if (!val) return [];
  try { var p = JSON.parse(val); return Array.isArray(p) ? p : []; } catch (e) { return String(val).split(',').map(function(v) { return v.trim(); }).filter(Boolean); }
}
function colW(col) {
  var m = { 'IMEI / Serial': 22, 'Estado': 12, 'Color': 14, 'Prestamista': 22, 'Fecha Entrada': 14, 'Fecha Salida': 14, 'Cliente Venta': 22, 'Cédula Venta': 14, 'Cliente Origen': 22, 'Proveedor': 20, 'Costo Compra': 14, 'Precio Venta': 14, 'Nombre': 28, 'Stock': 10, 'Stock Mínimo': 12, 'Unidad Medida': 14 };
  return { wch: m[col] !== undefined ? m[col] : Math.max(col.length + 4, 12) };
}
function bgSerial(s) {
  if (s.vendido) return C_VENDIDO;
  if (s.prestado) return C_PRESTADO;
  return C_DISPONIBLE;
}
function estadoSerial(s) {
  if (s.vendido) return 'Vendido';
  if (s.prestado) return 'Prestado';
  return 'Disponible';
}
function leyenda(ws, n) {
  var sT = { font: { bold: true, name: 'Arial', sz: 9, color: { rgb: '374151' } }, fill: { patternType: 'solid', fgColor: { rgb: C_LEY_TIT }, bgColor: { indexed: 64 } }, alignment: { horizontal: 'left', vertical: 'center' }, border: borde() };
  var sV = { fill: { patternType: 'solid', fgColor: { rgb: C_LEY_BG }, bgColor: { indexed: 64 } }, border: borde() };
  function sI(bg) { return { font: { name: 'Arial', sz: 9, color: { rgb: '374151' } }, fill: { patternType: 'solid', fgColor: { rgb: bg }, bgColor: { indexed: 64 } }, alignment: { horizontal: 'center', vertical: 'center' }, border: borde() }; }
  ws[enc(0,0)] = { t:'s', v:'Leyenda:', s:sT };
  ws[enc(0,1)] = { t:'s', v:'Disponible', s:sI(C_DISPONIBLE) };
  ws[enc(0,2)] = { t:'s', v:'Prestado',   s:sI(C_PRESTADO) };
  ws[enc(0,3)] = { t:'s', v:'Vendido',    s:sI(C_VENDIDO) };
  for (var c=4; c<n; c++) ws[enc(0,c)] = { t:'s', v:'', s:sV };
}
function hojaUnica(nombre, usadas) {
  var h = (nombre||'Sin nombre').replace(/[\\/?*[\]:]/g,'').trim().slice(0,31)||'Sin nombre';
  if (usadas.has(h.toLowerCase())) { var i=2; while(usadas.has((h.slice(0,28)+' '+i).toLowerCase())) i++; h=h.slice(0,28)+' '+i; }
  usadas.add(h.toLowerCase()); return h;
}
function hoy() { return new Date().toLocaleDateString('es-CO',{day:'2-digit',month:'2-digit',year:'numeric'}).replace(/\//g,'-'); }

export function exportarInventarioExcel(porProducto, cantidad, configMap) {
  var cfg = configMap || {};
  var colAct = cfg.colores_serial_activo === '1';
  var carAct = cfg.caracteristicas_serial_activo === '1';
  var carList = carAct ? parseLista(cfg.caracteristicas_serial_lista) : [];
  var wb = XLSX.utils.book_new();
  var usadas = new Set();

  var construirSerial = function(seriales) {
    var ws = {}; var cols = ['IMEI / Serial','Estado'];
    if (colAct) cols.push('Color');
    for (var ci=0;ci<carList.length;ci++) cols.push(carList[ci]);
    cols.push('Prestamista','Fecha Entrada','Fecha Salida','Cliente Venta','Cédula Venta','Cliente Origen');
    leyenda(ws, cols.length);
    for (var hi=0;hi<cols.length;hi++) ws[enc(1,hi)]={t:'s',v:cols[hi],s:sHeader()};
    ws['!autofilter']={ref:XLSX.utils.encode_range({s:{r:1,c:0},e:{r:1,c:cols.length-1}})};
    for (var ri=0;ri<seriales.length;ri++) {
      var s=seriales[ri]; var r=ri+2; var bg=bgSerial(s); var car=s.caracteristicas||{}; var c=0;
      ws[enc(r,c++)]={t:'s',v:s.imei||'',s:sCelda(bg)};
      ws[enc(r,c++)]={t:'s',v:estadoSerial(s),s:sCelda(bg)};
      if (colAct) ws[enc(r,c++)]={t:'s',v:s.color||'',s:sCelda(bg)};
      for (var ki=0;ki<carList.length;ki++) ws[enc(r,c++)]={t:'s',v:car[carList[ki]]||'',s:sCelda(bg)};
      ws[enc(r,c++)]={t:'s',v:s.prestamista||'',s:sCelda(bg)};
      ws[enc(r,c++)]={t:'s',v:fmtFecha(s.fecha_entrada),s:sCelda(bg)};
      ws[enc(r,c++)]={t:'s',v:fmtFecha(s.fecha_salida),s:sCelda(bg)};
      ws[enc(r,c++)]={t:'s',v:s.cliente_venta||'',s:sCelda(bg)};
      ws[enc(r,c++)]={t:'s',v:s.cedula_cliente_venta||'',s:sCelda(bg)};
      ws[enc(r,c++)]={t:'s',v:s.cliente_origen||'',s:sCelda(bg)};
    }
    var tf=seriales.length+2;
    ws['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:tf-1,c:cols.length-1}});
    ws['!cols']=cols.map(colW); ws['!rows']=[{hpt:18},{hpt:22}]; return ws;
  };

  var construirCantidad = function(cant) {
    var ws={}; var cols=['Nombre','Stock','Stock Mínimo','Unidad Medida','Cliente Origen']; var bg=C_DISPONIBLE;
    for (var hi=0;hi<cols.length;hi++) ws[enc(0,hi)]={t:'s',v:cols[hi],s:sHeader()};
    for (var ri=0;ri<cant.length;ri++) {
      var p=cant[ri]; var row=ri+1;
      ws[enc(row,0)]={t:'s',v:p.nombre||'',s:sCelda(bg)};
      ws[enc(row,1)]={t:'n',v:Number(p.stock)||0,s:sCeldaNum(bg)};
      ws[enc(row,2)]={t:'n',v:Number(p.stock_minimo)||0,s:sCeldaNum(bg)};
      ws[enc(row,3)]={t:'s',v:p.unidad_medida||'',s:sCelda(bg)};
      ws[enc(row,4)]={t:'s',v:p.cliente_origen||'',s:sCelda(bg)};
    }
    ws['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:cant.length,c:cols.length-1}});
    ws['!cols']=cols.map(colW); return ws;
  };

  var nombres = Object.keys(porProducto).sort(function(a,b){return a.localeCompare(b,'es');});
  for (var i=0;i<nombres.length;i++) XLSX.utils.book_append_sheet(wb, construirSerial(porProducto[nombres[i]]), hojaUnica(nombres[i],usadas));
  if (cantidad&&cantidad.length) XLSX.utils.book_append_sheet(wb, construirCantidad(cantidad), 'Por Cantidad');
  XLSX.writeFile(wb, 'inventario_'+hoy()+'.xlsx', {cellStyles:true});
}
