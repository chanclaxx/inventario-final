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
// ─── Columnas de características ─────────────────────────────────────────────
//
// Salen de la UNIÓN de dos fuentes: la lista que el negocio configuró en Ajustes
// y las claves que de verdad traen los seriales exportados.
//
// Solo con la lista se pierden en silencio las características de una
// configuración anterior y las que entraron por importación — que es justo lo
// que uno busca cuando exporta para hacer seguimiento. Solo con los datos, el
// orden de las columnas cambiaría entre un export y el siguiente.
//
// Con la opción apagada devuelve la lista tal cual: el Excel sale idéntico al
// de siempre.
function clavesCaracteristicas(lista, seriales, incluirTodas) {
  var claves = (lista || []).slice();
  if (!incluirTodas) return claves;

  var vistas = {};
  for (var i = 0; i < claves.length; i++) vistas[claves[i]] = true;

  for (var j = 0; j < (seriales || []).length; j++) {
    var car = seriales[j].caracteristicas;
    if (!car || typeof car !== 'object') continue;
    var ks = Object.keys(car);
    for (var k = 0; k < ks.length; k++) {
      var clave = ks[k];
      if (vistas[clave]) continue;
      var val = car[clave];
      if (val === null || val === undefined || String(val).trim() === '') continue;
      vistas[clave] = true;
      claves.push(clave);
    }
  }
  return claves;
}

/** ¿Alguna unidad de la lista tiene color registrado? */
function hayColor(seriales) {
  for (var i = 0; i < (seriales || []).length; i++) {
    if (seriales[i].color && String(seriales[i].color).trim()) return true;
  }
  return false;
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
            'Nombre': 28, 'Stock': 10, 'Stock Mínimo': 12, 'Unidad Medida': 14,
            'Ubicación': 20, 'Producto': 32, 'Tipo': 12,
            'Cantidad esperada': 18, 'Contado': 12, 'Diferencia': 12,
            'Característica': 20, 'Valor': 18, 'Sub-característica': 20,
            'Sub-valor': 18, 'Precio': 14, 'Código': 16 };
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

export async function exportarInventarioExcel(porProducto, cantidad, configMap, opciones) {
  var cfg     = configMap || {};
  var opts    = opciones  || {};
  // Opción del modal, apagada por defecto: con ella el Excel trae TODAS las
  // características de cada unidad y una hoja con el desglose por variante.
  var todoCar = opts.caracteristicas === true;
  var colAct  = cfg.colores_serial_activo         === '1';
  var carAct  = cfg.caracteristicas_serial_activo === '1';
  var codAct  = cfg.codigo_producto_activo        === '1';
  var ubiAct  = cfg.ubicacion_activa              === '1';
  var carList = carAct ? parseLista(cfg.caracteristicas_serial_lista) : [];

  var wb     = new ExcelJS.Workbook();
  var usadas = new Set();

  // ── Hojas por producto ──
  var nombres = Object.keys(porProducto).sort(function(a, b) { return a.localeCompare(b, 'es'); });
  for (var i = 0; i < nombres.length; i++) {
    var nombre   = nombres[i];
    var seriales = porProducto[nombre];
    var ws       = wb.addWorksheet(hojaUnica(nombre, usadas));

    // Con la opción encendida, las columnas se calculan por HOJA: cada producto
    // muestra las características que sus propias unidades tienen, en vez de
    // arrastrar columnas vacías de otros productos.
    var carHoja = clavesCaracteristicas(carList, seriales, todoCar);
    var verColor = colAct || (todoCar && hayColor(seriales));

    var cols = ['IMEI / Serial', 'Estado'];
    if (verColor) cols.push('Color');
    for (var ci = 0; ci < carHoja.length; ci++) cols.push(carHoja[ci]);
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
      if (verColor) { var c3 = dr.getCell(cc++); c3.value = s.color || ''; applyCell(c3, bg); }
      for (var ki = 0; ki < carHoja.length; ki++) {
        var ck = dr.getCell(cc++); ck.value = car[carHoja[ki]] || ''; applyCell(ck, bg);
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
    if (ubiAct) cantCols.push('Ubicación');
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
      if (ubiAct) {
        var cau = cdr.getCell(ccn++); cau.value = p.ubicacion || ''; applyCell(cau, bgCant);
      }
      var ca1 = cdr.getCell(ccn++); ca1.value = Number(p.stock)        || 0;  applyCellNum(ca1, bgCant);
      var ca2 = cdr.getCell(ccn++); ca2.value = Number(p.stock_minimo) || 0;  applyCellNum(ca2, bgCant);
      var ca3 = cdr.getCell(ccn++); ca3.value = p.unidad_medida        || ''; applyCell(ca3, bgCant);
      var ca4 = cdr.getCell(ccn++); ca4.value = p.cliente_origen       || ''; applyCell(ca4, bgCant);
    }
  }

  // ── Hoja Ubicaciones (planilla de conteo físico) ──
  // Es la razón de ser de la feature: el bodeguero la imprime, recorre estante
  // por estante y anota lo que encuentra. "Contado" va en blanco a propósito y
  // "Diferencia" es una fórmula, para que al digitar salte solo lo que no cuadra.
  // ── Hoja Características (desglose del árbol de variantes) ──
  // La hoja "Por Cantidad" muestra el producto con su stock TOTAL: un producto
  // con 30 tallas sale en una sola fila y no dice cuántas hay de cada una. Esta
  // hoja lo abre, una fila por nodo hoja. Va aparte y no dentro de la anterior
  // para no cambiarle la forma a quien ya la usa.
  if (todoCar) hojaCaracteristicas(wb, cantidad, codAct);

  if (ubiAct) hojaUbicaciones(wb, porProducto, cantidad);

  var buffer = await wb.xlsx.writeBuffer();
  descargar(buffer, 'inventario_' + hoy() + '.xlsx');
}

// ─── Hoja de características de los productos por cantidad ──────────────────
//
// Una fila por nodo HOJA del árbol: si el atributo tiene sub-variantes se
// listan ellas, si no, el atributo. Es el nivel donde vive el stock de verdad
// (el del producto es la suma), así que es el único que sirve para seguimiento.
function hojaCaracteristicas(wb, cantidad, codAct) {
  var filas = [];
  for (var i = 0; i < (cantidad || []).length; i++) {
    var p    = cantidad[i];
    var atrs = p.atributos || [];
    for (var a = 0; a < atrs.length; a++) {
      var at = atrs[a];
      var vs = at.variantes || [];
      if (vs.length) {
        for (var v = 0; v < vs.length; v++) {
          filas.push({
            producto: p.nombre || '', car: at.tipo_nombre || '', valor: at.valor || '',
            subCar: vs[v].tipo_nombre || '', subValor: vs[v].valor || '',
            stock: vs[v].stock, stockMin: vs[v].stock_minimo,
            precio: vs[v].precio != null ? vs[v].precio : at.precio,
            codigo: vs[v].codigo || at.codigo || '',
          });
        }
      } else {
        filas.push({
          producto: p.nombre || '', car: at.tipo_nombre || '', valor: at.valor || '',
          subCar: '', subValor: '',
          stock: at.stock, stockMin: at.stock_minimo,
          precio: at.precio, codigo: at.codigo || '',
        });
      }
    }
  }
  // Sin variantes en ninguna parte, una hoja vacía solo estorba.
  if (!filas.length) return;

  // Se agrupa por producto y NADA MÁS. El orden de las características dentro
  // de cada uno ya viene resuelto por el backend (por el orden del tipo, no
  // alfabético): reordenar aquí por valor pondría las tallas como L, M, S, XL.
  // El sort de JS es estable, así que ese orden se conserva.
  filas.sort(function(x, y) { return x.producto.localeCompare(y.producto, 'es'); });

  var ws   = wb.addWorksheet('Características');
  var cols = ['Producto', 'Característica', 'Valor', 'Sub-característica', 'Sub-valor',
              'Stock', 'Stock Mínimo', 'Precio'];
  if (codAct) cols.push('Código');
  ws.columns = cols.map(function(c) { return { width: colW(c) }; });

  var hr = ws.getRow(1); hr.height = 22;
  for (var hi = 0; hi < cols.length; hi++) {
    var hc = hr.getCell(hi + 1); hc.value = cols[hi]; applyHeader(hc);
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };

  for (var f = 0; f < filas.length; f++) {
    var fila = filas[f];
    var dr   = ws.getRow(f + 2);
    var n    = 1;
    var q1 = dr.getCell(n++); q1.value = fila.producto; applyCell(q1, A_DISPONIBLE);
    var q2 = dr.getCell(n++); q2.value = fila.car;      applyCell(q2, A_DISPONIBLE);
    var q3 = dr.getCell(n++); q3.value = fila.valor;    applyCell(q3, A_DISPONIBLE);
    var q4 = dr.getCell(n++); q4.value = fila.subCar;   applyCell(q4, A_DISPONIBLE);
    var q5 = dr.getCell(n++); q5.value = fila.subValor; applyCell(q5, A_DISPONIBLE);
    var q6 = dr.getCell(n++); q6.value = Number(fila.stock)    || 0; applyCellNum(q6, A_DISPONIBLE);
    var q7 = dr.getCell(n++); q7.value = Number(fila.stockMin) || 0; applyCellNum(q7, A_DISPONIBLE);
    var q8 = dr.getCell(n++);
    if (fila.precio != null && fila.precio !== '') { q8.value = Number(fila.precio) || 0; applyCellNum(q8, A_DISPONIBLE); }
    else { q8.value = ''; applyCell(q8, A_DISPONIBLE); }
    if (codAct) {
      // Texto explícito: preserva ceros a la izquierda de códigos EAN/UPC
      var q9 = dr.getCell(n++); q9.value = fila.codigo ? String(fila.codigo) : ''; applyCell(q9, A_DISPONIBLE);
    }
  }
}

// ─── Planilla de conteo por ubicación ────────────────────────────────────────

function hojaUbicaciones(wb, porProducto, cantidad) {
  var filas = [];

  // Productos por cantidad: la cantidad esperada es su stock.
  for (var i = 0; i < (cantidad || []).length; i++) {
    var p = cantidad[i];
    if (!p.ubicacion || !String(p.ubicacion).trim()) continue;
    filas.push({
      ubicacion: String(p.ubicacion).trim(),
      producto:  p.nombre || '',
      tipo:      'Cantidad',
      esperada:  Number(p.stock) || 0,
    });
  }

  // Seriales: la ubicación es de la referencia, así que se agrupa por producto
  // y se cuentan las unidades que deberían estar físicamente ahí — las vendidas
  // y las prestadas no están en el estante, así que no se cuentan.
  var nombres = Object.keys(porProducto || {});
  for (var j = 0; j < nombres.length; j++) {
    var seriales = porProducto[nombres[j]] || [];
    var ubic = '';
    var disponibles = 0;
    for (var k = 0; k < seriales.length; k++) {
      var s = seriales[k];
      if (!ubic && s.ubicacion) ubic = String(s.ubicacion).trim();
      if (!s.vendido && !s.prestado) disponibles++;
    }
    if (!ubic) continue;
    filas.push({
      ubicacion: ubic,
      producto:  nombres[j],
      tipo:      'Serial',
      esperada:  disponibles,
    });
  }

  if (!filas.length) return;

  filas.sort(function(a, b) {
    var u = a.ubicacion.localeCompare(b.ubicacion, 'es');
    return u !== 0 ? u : a.producto.localeCompare(b.producto, 'es');
  });

  var ws   = wb.addWorksheet('Ubicaciones');
  var cols = ['Ubicación', 'Producto', 'Tipo', 'Cantidad esperada', 'Contado', 'Diferencia'];
  ws.columns = cols.map(function(c) { return { width: colW(c) }; });

  var hr = ws.getRow(1); hr.height = 22;
  for (var h = 0; h < cols.length; h++) {
    var hc = hr.getCell(h + 1); hc.value = cols[h]; applyHeader(hc);
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };

  for (var r = 0; r < filas.length; r++) {
    var f  = filas[r];
    var nf = r + 2;
    var dr = ws.getRow(nf);

    var c1 = dr.getCell(1); c1.value = f.ubicacion; applyCell(c1, A_DISPONIBLE);
    var c2 = dr.getCell(2); c2.value = f.producto;  applyCell(c2, A_DISPONIBLE);
    var c3 = dr.getCell(3); c3.value = f.tipo;      applyCell(c3, A_DISPONIBLE);
    var c4 = dr.getCell(4); c4.value = f.esperada;  applyCellNum(c4, A_DISPONIBLE);
    var c5 = dr.getCell(5); c5.value = null;        applyCellNum(c5, A_LEY_BG);
    // Vacía mientras no se anote nada, para que la columna no se llene de ceros
    // antes del conteo.
    var c6 = dr.getCell(6);
    c6.value = { formula: 'IF(E' + nf + '="","",E' + nf + '-D' + nf + ')' };
    applyCellNum(c6, A_DISPONIBLE);
  }

  ws.views = [{ state: 'frozen', ySplit: 1 }];
}
