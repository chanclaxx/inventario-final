import * as XLSX from 'xlsx';

// ─── Paleta ───────────────────────────────────────────────────────────────────
const COLOR = {
  header:     '1E40AF',
  blanco:     'FFFFFF',
  disponible: 'FFFFFF',
  prestado:   'BFDBFE',  // azul claro
  vendido:    'DCFCE7',  // verde claro
  borde:      'D1D5DB',
  leyenda_bg: 'F1F5F9',
  leyenda_tit:'E2E8F0',
};

function borde() {
  const lado = { style: 'thin', color: { rgb: COLOR.borde } };
  return { top: lado, bottom: lado, left: lado, right: lado };
}

function sHeader() {
  return {
    font:      { bold: true, name: 'Arial', sz: 10, color: { rgb: COLOR.blanco } },
    fill:      { patternType: 'solid', fgColor: { rgb: COLOR.header } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border:    borde(),
  };
}

function sCelda(bg) {
  return {
    font:      { name: 'Arial', sz: 9 },
    fill:      { patternType: 'solid', fgColor: { rgb: bg } },
    alignment: { vertical: 'center' },
    border:    borde(),
  };
}

function sCeldaNum(bg) {
  return {
    ...sCelda(bg),
    alignment: { horizontal: 'right', vertical: 'center' },
    numFmt: '#,##0',
  };
}

function fmtFecha(val) {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function sanitizarNombreHoja(nombre) {
  return (nombre || 'Sin nombre')
    .replace(/[\\/?*[\]:]/g, '')
    .trim()
    .slice(0, 31) || 'Sin nombre';
}

function enc(r, c) {
  return XLSX.utils.encode_cell({ r, c });
}

function bgSerial(s) {
  if (s.vendido)  return COLOR.vendido;
  if (s.prestado) return COLOR.prestado;
  return COLOR.disponible;
}

function estadoSerial(s) {
  if (s.vendido)  return 'Vendido';
  if (s.prestado) return 'Prestado';
  return 'Disponible';
}

function parseLista(val) {
  if (!val) return [];
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return val.split(',').map((v) => v.trim()).filter(Boolean);
  }
}

function colWidth(col) {
  const map = {
    'IMEI / Serial': 22, 'Referencia': 28, 'Nombre': 28,
    'Estado': 12, 'Color': 14, 'Prestamista': 22,
    'Fecha Entrada': 14, 'Fecha Salida': 14,
    'Cliente Venta': 22, 'Cédula Venta': 14,
    'Cliente Origen': 22, 'Proveedor': 20,
    'Costo Compra': 14, 'Precio Costo': 14, 'Precio Venta': 14,
    'Stock': 10, 'Stock Mínimo': 12, 'Unidad Medida': 14,
  };
  return { wch: map[col] ?? Math.max(col.length + 4, 12) };
}

// ─── Fila de leyenda (row 0) ──────────────────────────────────────────────────
function agregarLeyenda(ws, numCols) {
  const sLeyTit = {
    font:      { bold: true, name: 'Arial', sz: 9, color: { rgb: '374151' } },
    fill:      { patternType: 'solid', fgColor: { rgb: COLOR.leyenda_tit } },
    alignment: { horizontal: 'left', vertical: 'center' },
    border:    borde(),
  };
  const sLeyItem = (bg) => ({
    font:      { name: 'Arial', sz: 9, color: { rgb: '374151' } },
    fill:      { patternType: 'solid', fgColor: { rgb: bg } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border:    borde(),
  });
  const sLeyVacio = {
    fill:   { patternType: 'solid', fgColor: { rgb: COLOR.leyenda_bg } },
    border: borde(),
  };

  ws[enc(0, 0)] = { t: 's', v: 'Leyenda de colores:', s: sLeyTit };
  ws[enc(0, 1)] = { t: 's', v: 'Disponible',  s: sLeyItem(COLOR.disponible) };
  ws[enc(0, 2)] = { t: 's', v: 'Prestado',    s: sLeyItem(COLOR.prestado) };
  ws[enc(0, 3)] = { t: 's', v: 'Vendido',     s: sLeyItem(COLOR.vendido) };
  for (let c = 4; c < numCols; c++) {
    ws[enc(0, c)] = { t: 's', v: '', s: sLeyVacio };
  }
}

// ─── Hoja por producto ────────────────────────────────────────────────────────
function construirHojaProducto(seriales, coloresActivo, caracteristicasLista) {
  const ws   = {};
  const cols = ['IMEI / Serial', 'Estado'];
  if (coloresActivo) cols.push('Color');
  for (const c of caracteristicasLista) cols.push(c);
  cols.push('Prestamista', 'Fecha Entrada', 'Fecha Salida',
            'Cliente Venta', 'Cédula Venta', 'Cliente Origen',
            'Proveedor', 'Costo Compra', 'Precio Venta');

  agregarLeyenda(ws, cols.length);

  cols.forEach((h, c) => { ws[enc(1, c)] = { t: 's', v: h, s: sHeader() }; });

  ws['!autofilter'] = {
    ref: XLSX.utils.encode_range({ s: { r: 1, c: 0 }, e: { r: 1, c: cols.length - 1 } }),
  };

  seriales.forEach((s, idx) => {
    const r  = idx + 2;
    const bg = bgSerial(s);
    const car = s.caracteristicas || {};

    let c = 0;
    ws[enc(r, c++)] = { t: 's', v: s.imei || '',              s: sCelda(bg) };
    ws[enc(r, c++)] = { t: 's', v: estadoSerial(s),           s: sCelda(bg) };
    if (coloresActivo) {
      ws[enc(r, c++)] = { t: 's', v: s.color || '',           s: sCelda(bg) };
    }
    for (const nombre of caracteristicasLista) {
      ws[enc(r, c++)] = { t: 's', v: car[nombre] || '',       s: sCelda(bg) };
    }
    ws[enc(r, c++)] = { t: 's', v: s.prestamista || '',       s: sCelda(bg) };
    ws[enc(r, c++)] = { t: 's', v: fmtFecha(s.fecha_entrada), s: sCelda(bg) };
    ws[enc(r, c++)] = { t: 's', v: fmtFecha(s.fecha_salida),  s: sCelda(bg) };
    ws[enc(r, c++)] = { t: 's', v: s.cliente_venta || '',     s: sCelda(bg) };
    ws[enc(r, c++)] = { t: 's', v: s.cedula_cliente_venta || '', s: sCelda(bg) };
    ws[enc(r, c++)] = { t: 's', v: s.cliente_origen || '',    s: sCelda(bg) };
    ws[enc(r, c++)] = { t: 's', v: s.proveedor || '',         s: sCelda(bg) };
    ws[enc(r, c++)] = { t: 'n', v: Number(s.costo_compra) || 0, s: sCeldaNum(bg) };
    ws[enc(r, c++)] = { t: 'n', v: Number(s.precio_venta) || 0, s: sCeldaNum(bg) };
  });

  const totalFilas = seriales.length + 2;
  ws['!ref']  = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalFilas - 1, c: cols.length - 1 } });
  ws['!cols'] = cols.map(colWidth);
  ws['!rows'] = [{ hpt: 18 }, { hpt: 22 }];
  return ws;
}

// ─── Hoja por cantidad ────────────────────────────────────────────────────────
function construirHojaCantidad(cantidad) {
  const ws   = {};
  const cols = ['Nombre', 'Stock', 'Stock Mínimo', 'Unidad Medida', 'Proveedor', 'Cliente Origen'];
  const bg   = COLOR.disponible;

  cols.forEach((h, c) => { ws[enc(0, c)] = { t: 's', v: h, s: sHeader() }; });

  cantidad.forEach((p, idx) => {
    const r = idx + 1;
    ws[enc(r, 0)] = { t: 's', v: p.nombre || '',          s: sCelda(bg) };
    ws[enc(r, 1)] = { t: 'n', v: Number(p.stock) || 0,    s: sCeldaNum(bg) };
    ws[enc(r, 2)] = { t: 'n', v: Number(p.stock_minimo) || 0, s: sCeldaNum(bg) };
    ws[enc(r, 3)] = { t: 's', v: p.unidad_medida || '',   s: sCelda(bg) };
    ws[enc(r, 4)] = { t: 's', v: p.proveedor || '',        s: sCelda(bg) };
    ws[enc(r, 5)] = { t: 's', v: p.cliente_origen || '',  s: sCelda(bg) };
  });

  ws['!ref']  = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: cantidad.length, c: cols.length - 1 } });
  ws['!cols'] = cols.map(colWidth);
  return ws;
}

// ─── Hoja por línea ───────────────────────────────────────────────────────────
function construirHojaLinea(seriales, coloresActivo, caracteristicasLista, opciones) {
  const { incluirCosto, incluirPrecio, incluirProveedor } = opciones;
  const ws   = {};
  const cols = ['Referencia', 'IMEI / Serial'];
  if (coloresActivo) cols.push('Color');
  for (const c of caracteristicasLista) cols.push(c);
  if (incluirCosto)      cols.push('Precio Costo');
  if (incluirPrecio)     cols.push('Precio Venta');
  if (incluirProveedor)  cols.push('Proveedor');

  agregarLeyenda(ws, cols.length);

  cols.forEach((h, c) => { ws[enc(1, c)] = { t: 's', v: h, s: sHeader() }; });

  ws['!autofilter'] = {
    ref: XLSX.utils.encode_range({ s: { r: 1, c: 0 }, e: { r: 1, c: cols.length - 1 } }),
  };

  // Ordenar: disponibles primero, luego prestados, luego vendidos
  const sorted = [...seriales].sort((a, b) => {
    const ord = (s) => (s.vendido ? 2 : s.prestado ? 1 : 0);
    return ord(a) - ord(b);
  });

  sorted.forEach((s, idx) => {
    const r   = idx + 2;
    const bg  = bgSerial(s);
    const car = s.caracteristicas || {};

    let c = 0;
    ws[enc(r, c++)] = { t: 's', v: s.producto || '',          s: sCelda(bg) };
    ws[enc(r, c++)] = { t: 's', v: s.imei || '',              s: sCelda(bg) };
    if (coloresActivo) {
      ws[enc(r, c++)] = { t: 's', v: s.color || '',           s: sCelda(bg) };
    }
    for (const nombre of caracteristicasLista) {
      ws[enc(r, c++)] = { t: 's', v: car[nombre] || '',       s: sCelda(bg) };
    }
    if (incluirCosto) {
      ws[enc(r, c++)] = { t: 'n', v: Number(s.costo_compra) || 0, s: sCeldaNum(bg) };
    }
    if (incluirPrecio) {
      ws[enc(r, c++)] = { t: 'n', v: Number(s.precio_venta) || 0, s: sCeldaNum(bg) };
    }
    if (incluirProveedor) {
      ws[enc(r, c++)] = { t: 's', v: s.proveedor || '',       s: sCelda(bg) };
    }
  });

  const totalFilas = sorted.length + 2;
  ws['!ref']  = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalFilas - 1, c: cols.length - 1 } });
  ws['!cols'] = cols.map(colWidth);
  ws['!rows'] = [{ hpt: 18 }, { hpt: 22 }];
  return ws;
}

// ─── Helpers para nombres de hoja únicos ─────────────────────────────────────
function nombreHojaUnico(nombre, usadas) {
  let hoja = sanitizarNombreHoja(nombre);
  if (usadas.has(hoja.toLowerCase())) {
    let i = 2;
    while (usadas.has(`${hoja.slice(0, 28)} ${i}`.toLowerCase())) i++;
    hoja = `${hoja.slice(0, 28)} ${i}`;
  }
  usadas.add(hoja.toLowerCase());
  return hoja;
}

function fechaHoy() {
  return new Date()
    .toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })
    .replace(/\//g, '-');
}

// ─── Export principal: por productos ─────────────────────────────────────────
export function exportarInventarioExcel(porProducto, cantidad, configMap = {}) {
  const coloresActivo         = configMap.colores_serial_activo === '1';
  const caracteristicasActivo = configMap.caracteristicas_serial_activo === '1';
  const caracteristicasLista  = caracteristicasActivo
    ? parseLista(configMap.caracteristicas_serial_lista)
    : [];

  const wb        = XLSX.utils.book_new();
  const usadas    = new Set();

  Object.entries(porProducto)
    .sort(([a], [b]) => a.localeCompare(b, 'es'))
    .forEach(([producto, seriales]) => {
      const hoja = nombreHojaUnico(producto, usadas);
      XLSX.utils.book_append_sheet(
        wb,
        construirHojaProducto(seriales, coloresActivo, caracteristicasLista),
        hoja,
      );
    });

  if (cantidad?.length) {
    XLSX.utils.book_append_sheet(wb, construirHojaCantidad(cantidad), 'Por Cantidad');
  }

  XLSX.writeFile(wb, `inventario_${fechaHoy()}.xlsx`, { cellStyles: true });
}

// ─── Export alternativo: por líneas ──────────────────────────────────────────
export function exportarInventarioPorLineas(porLinea, configMap = {}, opciones = {}) {
  const {
    incluirCosto     = true,
    incluirPrecio    = true,
    incluirProveedor = true,
  } = opciones;

  const coloresActivo         = configMap.colores_serial_activo === '1';
  const caracteristicasActivo = configMap.caracteristicas_serial_activo === '1';
  const caracteristicasLista  = caracteristicasActivo
    ? parseLista(configMap.caracteristicas_serial_lista)
    : [];

  const wb     = XLSX.utils.book_new();
  const usadas = new Set();

  // Líneas ordenadas alfabéticamente; "Sin Línea" al final
  const lineas = Object.keys(porLinea).sort((a, b) => {
    if (a === 'Sin Línea') return 1;
    if (b === 'Sin Línea') return -1;
    return a.localeCompare(b, 'es');
  });

  for (const linea of lineas) {
    const hoja = nombreHojaUnico(linea, usadas);
    XLSX.utils.book_append_sheet(
      wb,
      construirHojaLinea(
        porLinea[linea],
        coloresActivo,
        caracteristicasLista,
        { incluirCosto, incluirPrecio, incluirProveedor },
      ),
      hoja,
    );
  }

  XLSX.writeFile(wb, `inventario_lineas_${fechaHoy()}.xlsx`, { cellStyles: true });
}
