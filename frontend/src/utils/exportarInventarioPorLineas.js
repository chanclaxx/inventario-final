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
  return { font: { bold: true, name: 'Arial', sz: 10, color: { rgb: C_BLANCO } }, fill: { patternType: 'solid', fgColor: { rgb: C_HEADER } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: borde() };
}
function sCelda(bg) {
  return { font: { name: 'Arial', sz: 9 }, fill: { patternType: 'solid', fgColor: { rgb: bg } }, alignment: { vertical: 'center' }, border: borde() };
}
function sCeldaNum(bg) {
  return { font: { name: 'Arial', sz: 9 }, fill: { patternType: 'solid', fgColor: { rgb: bg } }, alignment: { horizontal: 'right', vertical: 'center' }, numFmt: '#,##0', border: borde() };
}
function enc(r, c) { return XLSX.utils.encode_cell({ r: r, c: c }); }
function parseLista(val) {
  if (!val) return [];
  try { var p = JSON.parse(val); return Array.isArray(p) ? p : []; } catch (e) { return String(val).split(',').map(function(v) { return v.trim(); }).filter(Boolean); }
}
function colW(col) {
  var m = { 'Referencia': 28, 'IMEI / Serial': 22, 'Color': 14, 'Precio Costo': 14, 'Precio Venta': 14, 'Proveedor': 20 };
  return { wch: m[col] !== undefined ? m[col] : Math.max(col.length + 4, 12) };
}
function bgSerial(s) {
  if (s.vendido) return C_VENDIDO;
  if (s.prestado) return C_PRESTADO;
  return C_DISPONIBLE;
}
function leyenda(ws, n) {
  var sT = { font: { bold: true, name: 'Arial', sz: 9, color: { rgb: '374151' } }, fill: { patternType: 'solid', fgColor: { rgb: C_LEY_TIT } }, alignment: { horizontal: 'left', vertical: 'center' }, border: borde() };
  var sV = { fill: { patternType: 'solid', fgColor: { rgb: C_LEY_BG } }, border: borde() };
  function sI(bg) { return { font: { name: 'Arial', sz: 9, color: { rgb: '374151' } }, fill: { patternType: 'solid', fgColor: { rgb: bg } }, alignment: { horizontal: 'center', vertical: 'center' }, border: borde() }; }
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

export function exportarInventarioPorLineas(porLinea, configMap, opciones) {
  var cfg = configMap || {};
  var opc = opciones || {};
  var incluirCosto     = opc.incluirCosto     !== false;
  var incluirPrecio    = opc.incluirPrecio    !== false;
  var incluirProveedor = opc.incluirProveedor !== false;

  var colAct  = cfg.colores_serial_activo === '1';
  var carAct  = cfg.caracteristicas_serial_activo === '1';
  var carList = carAct ? parseLista(cfg.caracteristicas_serial_lista) : [];

  var wb = XLSX.utils.book_new();
  var usadas = new Set();

  var construirHoja = function(seriales) {
    var ws = {}; var cols = ['Referencia','IMEI / Serial'];
    if (colAct) cols.push('Color');
    for (var ci=0;ci<carList.length;ci++) cols.push(carList[ci]);
    if (incluirCosto)     cols.push('Precio Costo');
    if (incluirPrecio)    cols.push('Precio Venta');
    if (incluirProveedor) cols.push('Proveedor');
    leyenda(ws, cols.length);
    for (var hi=0;hi<cols.length;hi++) ws[enc(1,hi)]={t:'s',v:cols[hi],s:sHeader()};
    ws['!autofilter']={ref:XLSX.utils.encode_range({s:{r:1,c:0},e:{r:1,c:cols.length-1}})};
    var sorted = seriales.slice().sort(function(a,b) {
      var oa=a.vendido?2:a.prestado?1:0; var ob=b.vendido?2:b.prestado?1:0; return oa-ob;
    });
    for (var ri=0;ri<sorted.length;ri++) {
      var s=sorted[ri]; var r=ri+2; var bg=bgSerial(s); var car=s.caracteristicas||{}; var c=0;
      ws[enc(r,c++)]={t:'s',v:s.producto||'',s:sCelda(bg)};
      ws[enc(r,c++)]={t:'s',v:s.imei||'',s:sCelda(bg)};
      if (colAct) ws[enc(r,c++)]={t:'s',v:s.color||'',s:sCelda(bg)};
      for (var ki=0;ki<carList.length;ki++) ws[enc(r,c++)]={t:'s',v:car[carList[ki]]||'',s:sCelda(bg)};
      if (incluirCosto)     ws[enc(r,c++)]={t:'n',v:Number(s.costo_compra)||0,s:sCeldaNum(bg)};
      if (incluirPrecio)    ws[enc(r,c++)]={t:'n',v:Number(s.precio_venta)||0,s:sCeldaNum(bg)};
      if (incluirProveedor) ws[enc(r,c++)]={t:'s',v:s.proveedor||'',s:sCelda(bg)};
    }
    var tf=sorted.length+2;
    ws['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:tf-1,c:cols.length-1}});
    ws['!cols']=cols.map(colW); ws['!rows']=[{hpt:18},{hpt:22}]; return ws;
  };

  var lineas = Object.keys(porLinea).sort(function(a,b) {
    if (a==='Sin Línea') return 1; if (b==='Sin Línea') return -1; return a.localeCompare(b,'es');
  });
  for (var i=0;i<lineas.length;i++) XLSX.utils.book_append_sheet(wb, construirHoja(porLinea[lineas[i]]), hojaUnica(lineas[i],usadas));
  XLSX.writeFile(wb, 'inventario_lineas_'+hoy()+'.xlsx', {cellStyles:true});
}
