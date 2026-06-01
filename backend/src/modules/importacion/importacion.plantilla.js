const XLSX = require('xlsx');

// ─── Paleta ───────────────────────────────────────────────────────────────────
const C = {
  tituloFondo:      '1E3A8A',
  headerFondo:      '1D4ED8',
  descFondo:        'DBEAFE',
  descTexto:        '1E40AF',
  requerido:        'DC2626',
  colorFondo:       'BE185D',
  caracterFondo:    '6D28D9',
  precioFondo:      '065F46',
  cantidadFondo:    '0369A1',
  varianteFondo:    '0F766E',  // teal para columna Atributo
  subvarianteFondo: '115E59',  // teal oscuro para columna Variante
  lineaFondo:       'D97706',  // amber para columna Línea
  datoFondo:        'F8FAFC',
  datoFondoAlt:     'EFF6FF',
  borde:            'CBD5E1',
  blanco:           'FFFFFF',
  gris:             '6B7280',
};

function bl() {
  const l = { style: 'thin', color: { rgb: C.borde } };
  return { top: l, bottom: l, left: l, right: l };
}

const sT = (bg, textColor = C.blanco, sz = 10) => ({
  font:      { bold: true, name: 'Calibri', sz, color: { rgb: textColor } },
  fill:      { patternType: 'solid', fgColor: { rgb: bg } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border:    bl(),
});

const sD = (bg = C.descFondo) => ({
  font:      { name: 'Calibri', sz: 8, italic: true, color: { rgb: C.descTexto } },
  fill:      { patternType: 'solid', fgColor: { rgb: bg } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border:    bl(),
});

const sCelda = (bg = C.datoFondo) => ({
  font:      { name: 'Calibri', sz: 9, color: { rgb: '111827' } },
  fill:      { patternType: 'solid', fgColor: { rgb: bg } },
  alignment: { horizontal: 'left', vertical: 'center' },
  border:    bl(),
});

const sCeldaNum = (bg = C.datoFondo) => ({
  ...sCelda(bg),
  alignment: { horizontal: 'right', vertical: 'center' },
  numFmt:    '#,##0.00',
});

function put(ws, r, c, t, v, s) {
  ws[XLSX.utils.encode_cell({ r, c })] = { t, v: v ?? '', s };
}

function seal(ws, filas, cols) {
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filas, c: cols - 1 } });
}

function freeze(ws) {
  ws['!freeze'] = { xSplit: 0, ySplit: 3 };
}

const NUM_FILAS_DATOS = 200;

// ─── Hoja serial ─────────────────────────────────────────────────────────────
// Estructura: fila 0 = título, fila 1 = claves (usadas como headers por sheet_to_json),
//             fila 2 = descripciones (slice(1) la descarta), filas 3+ = datos vacíos
function hojaSerial(nombreProducto, coloresActivo, coloresLista, caracteristicasActivo, caracteristicasLista, lineas = []) {
  const ws = {};

  // ── Columnas dinámicas ────────────────────────────────────────────────────
  // La CLAVE (fila 1) debe normalizarse (lowercase + spaces→_) al valor que
  // el service leerá desde fila.*. El normalizer hace: trim().toLowerCase().replace(/\s+/g,'_')
  const columnas = [
    { clave: 'IMEI *',         desc: 'Requerido · Número único de serie',                 bg: C.requerido,  num: false },
    { clave: 'Fecha Entrada',  desc: 'Opcional · dd/mm/aaaa (deja vacío = hoy)',          bg: C.headerFondo, num: false },
    { clave: 'Proveedor',      desc: 'Opcional · Nombre del proveedor',                   bg: C.headerFondo, num: false },
    { clave: 'Marca',          desc: 'Opcional · Ej: Apple, Samsung',                     bg: C.headerFondo, num: false },
    { clave: 'Modelo',         desc: 'Opcional · Ej: 128GB / Pro Max',                   bg: C.headerFondo, num: false },
    {
      clave: 'Linea',
      desc:  lineas.length > 0
        ? `Opcional · Categoría del producto (${lineas.slice(0, 5).map(l => l.nombre).join(', ')}${lineas.length > 5 ? '…' : ''})`
        : 'Opcional · Categoría o línea del producto (escribe el nombre)',
      bg:    C.lineaFondo,
      num:   false,
    },
  ];

  if (coloresActivo) {
    const opciones = coloresLista.length > 0
      ? `Válidos: ${coloresLista.slice(0, 8).join(', ')}`
      : 'Configura colores en Ajustes';
    columnas.push({
      clave: 'Color',
      desc:  opciones,
      bg:    C.colorFondo,
      num:   false,
    });
  }

  if (caracteristicasActivo && caracteristicasLista.length > 0) {
    for (const nombre of caracteristicasLista) {
      columnas.push({
        clave: nombre,
        desc:  `Característica: ${nombre}`,
        bg:    C.caracterFondo,
        num:   false,
      });
    }
  }

  columnas.push(
    { clave: 'Precio',         desc: 'Opcional · Precio de venta (COP)',                  bg: C.precioFondo,  num: true },
    { clave: 'Costo Compra',   desc: 'Opcional · Costo al que fue adquirido (COP)',       bg: C.headerFondo,  num: true },
    { clave: 'Cliente Origen', desc: 'Opcional · Nombre del cliente si es retoma',        bg: C.headerFondo,  num: false },
  );

  const numCols = columnas.length;

  // Fila 0: Título del producto (celda fusionada visualmente)
  columnas.forEach((_, c) => {
    put(ws, 0, c, 's', c === 0 ? `📦  ${nombreProducto} — Hoja de Seriales` : '', sT(C.tituloFondo, C.blanco, 11));
  });

  // Fila 1: Claves (usadas por sheet_to_json como headers de columna)
  columnas.forEach(({ clave, bg }, c) => {
    put(ws, 1, c, 's', clave, sT(bg, C.blanco, 9));
  });

  // Fila 2: Descripciones (descartada por .slice(1))
  columnas.forEach(({ desc, bg }, c) => {
    put(ws, 2, c, 's', desc, sD(C.descFondo));
  });

  // Filas 3+: datos vacíos
  for (let r = 3; r < 3 + NUM_FILAS_DATOS; r++) {
    const alterno = r % 2 === 0 ? C.datoFondo : C.datoFondoAlt;
    columnas.forEach(({ num }, c) => {
      put(ws, r, c, 's', '', num ? sCeldaNum(alterno) : sCelda(alterno));
    });
  }

  // Validación de color como lista desplegable
  if (coloresActivo && coloresLista.length > 0) {
    const colIdx = columnas.findIndex((col) => col.clave === 'Color');
    if (colIdx >= 0) {
      const colLetter = XLSX.utils.encode_col(colIdx);
      const formula   = `"${coloresLista.slice(0, 30).join(',')}"`;
      ws['!dataValidation'] = ws['!dataValidation'] || [];
      ws['!dataValidation'].push({
        sqref: `${colLetter}4:${colLetter}${3 + NUM_FILAS_DATOS}`,
        type: 'list',
        formula1: formula,
        showDropDown: false,
        showErrorMessage: true,
        errorTitle: 'Color inválido',
        error: `Selecciona un color de la lista: ${coloresLista.join(', ')}`,
      });
    }
  }

  // Dropdown de líneas (sugerido, permite texto libre para crear líneas nuevas)
  if (lineas.length > 0) {
    const linIdx = columnas.findIndex((col) => col.clave === 'Linea');
    if (linIdx >= 0) {
      const colLetter = XLSX.utils.encode_col(linIdx);
      const listaStr  = _listaDropdown(lineas.map((l) => l.nombre));
      ws['!dataValidation'] = ws['!dataValidation'] || [];
      ws['!dataValidation'].push({
        sqref:            `${colLetter}4:${colLetter}${3 + NUM_FILAS_DATOS}`,
        type:             'list',
        formula1:         `"${listaStr}"`,
        showDropDown:     false,
        showErrorMessage: false,
      });
    }
  }

  seal(ws, 3 + NUM_FILAS_DATOS - 1, numCols);
  freeze(ws);
  ws['!cols'] = columnas.map(({ clave }) => {
    if (clave.includes('IMEI'))   return { wch: 22 };
    if (clave === 'Fecha Entrada') return { wch: 16 };
    if (clave === 'Color')         return { wch: 16 };
    if (clave === 'Linea')         return { wch: 22 };
    if (clave === 'Precio' || clave === 'Costo Compra') return { wch: 16 };
    if (clave === 'Cliente Origen') return { wch: 22 };
    return { wch: 18 };
  });
  ws['!rows'] = [{ hpt: 20 }, { hpt: 22 }, { hpt: 30 }];

  return ws;
}

// ─── Hoja cantidad ────────────────────────────────────────────────────────────
function hojaCantidad(variantesActivo = false, lineas = []) {
  const columnas = [
    { clave: 'Nombre *',       desc: 'Requerido · Nombre del producto',                             bg: C.requerido,         num: false, wch: 30 },
    {
      clave: 'Linea',
      desc:  lineas.length > 0
        ? `Opcional · Categoría (${lineas.slice(0, 5).map(l => l.nombre).join(', ')}${lineas.length > 5 ? '…' : ''})`
        : 'Opcional · Línea o categoría del producto (escribe el nombre)',
      bg:    C.lineaFondo,
      num:   false,
      wch:   22,
    },
  ];

  if (variantesActivo) {
    columnas.push(
      { clave: 'Atributo', desc: 'Opcional · Valor del atributo (ej: M, L, XL, Rojo)',             bg: C.varianteFondo,     num: false, wch: 18 },
      { clave: 'Variante', desc: 'Opcional · Sub-variante dentro del atributo (ej: Oscuro, Claro)', bg: C.subvarianteFondo,  num: false, wch: 18 },
    );
  }

  columnas.push(
    { clave: 'Stock',          desc: 'Cantidad (se suma al existente, 0 si es nuevo)',              bg: C.cantidadFondo,     num: true,  wch: 10 },
    { clave: 'Stock Minimo',   desc: 'Alerta de stock bajo (toma el mayor)',                        bg: C.cantidadFondo,     num: true,  wch: 14 },
    { clave: 'Costo Unitario', desc: 'Costo de compra por unidad (COP)',                            bg: C.headerFondo,       num: true,  wch: 16 },
    { clave: 'Precio Venta',   desc: 'Precio de venta al público (COP)',                            bg: C.precioFondo,       num: true,  wch: 14 },
    { clave: 'Unidad Medida',  desc: 'Ej: unidad, caja, kg, litro (defecto: unidad)',              bg: C.headerFondo,       num: false, wch: 16 },
    { clave: 'Proveedor',      desc: 'Opcional · Nombre del proveedor habitual',                    bg: C.headerFondo,       num: false, wch: 20 },
    { clave: 'Cliente Origen', desc: 'Opcional · Solo si proviene de un cliente',                   bg: C.headerFondo,       num: false, wch: 22 },
  );

  const ws      = {};
  const numCols = columnas.length;

  const titulo = variantesActivo
    ? '📦  Productos por Cantidad · Con Variantes'
    : '📦  Productos por Cantidad — Sin serial';

  columnas.forEach((_, c) => {
    put(ws, 0, c, 's', c === 0 ? titulo : '', sT(C.cantidadFondo, C.blanco, 11));
  });
  columnas.forEach(({ clave, bg }, c) => {
    put(ws, 1, c, 's', clave, sT(bg, C.blanco, 9));
  });
  columnas.forEach(({ desc }, c) => {
    put(ws, 2, c, 's', desc, sD());
  });

  for (let r = 3; r < 3 + NUM_FILAS_DATOS; r++) {
    const alterno = r % 2 === 0 ? C.datoFondo : C.datoFondoAlt;
    columnas.forEach(({ num }, c) => {
      put(ws, r, c, 's', '', num ? sCeldaNum(alterno) : sCelda(alterno));
    });
  }

  // Dropdown de líneas en hoja cantidad
  if (lineas.length > 0) {
    const linIdx = columnas.findIndex((col) => col.clave === 'Linea');
    if (linIdx >= 0) {
      const colLetter = XLSX.utils.encode_col(linIdx);
      const listaStr  = _listaDropdown(lineas.map((l) => l.nombre));
      ws['!dataValidation'] = ws['!dataValidation'] || [];
      ws['!dataValidation'].push({
        sqref:            `${colLetter}4:${colLetter}${3 + NUM_FILAS_DATOS}`,
        type:             'list',
        formula1:         `"${listaStr}"`,
        showDropDown:     false,
        showErrorMessage: false,
      });
    }
  }

  seal(ws, 3 + NUM_FILAS_DATOS - 1, numCols);
  freeze(ws);
  ws['!cols'] = columnas.map(({ wch }) => ({ wch }));
  ws['!rows'] = [{ hpt: 20 }, { hpt: 22 }, { hpt: 30 }];
  return ws;
}

// ─── Hoja instrucciones ───────────────────────────────────────────────────────
function hojaInstrucciones(config) {
  const coloresActivo         = config.colores_serial_activo === '1';
  const caracteristicasActivo = config.caracteristicas_serial_activo === '1';
  const variantesActivo       = config.variantes_activo === '1';
  const coloresLista          = _parseLista(config.colores_serial_lista);
  const caracteristicasLista  = _parseLista(config.caracteristicas_serial_lista);

  const ws   = {};
  let r = 0;

  const linea = (texto, bg = C.blanco, bold = false, sz = 10) => {
    put(ws, r, 0, 's', texto, {
      font:      { name: 'Calibri', sz, bold, color: { rgb: '111827' } },
      fill:      { patternType: 'solid', fgColor: { rgb: bg } },
      alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
      border:    bl(),
    });
    r++;
  };

  linea('📋  INSTRUCCIONES DE IMPORTACIÓN', C.tituloFondo, true, 13);
  linea('');
  linea('CÓMO USAR ESTA PLANTILLA', C.headerFondo, true, 10);
  linea('1. Cada hoja con nombre de producto = seriales de ese producto.');
  linea('   • Renombra la hoja de ejemplo con el nombre real del producto.');
  linea('   • Puedes agregar más hojas para más productos (una hoja por producto).');
  linea('   • La hoja "Productos Cantidad" es para productos SIN serial (cajas, accesorios, etc.).');
  linea('');
  linea('2. No borres ni muevas las primeras 3 filas de cada hoja.');
  linea('   • Fila 1: Título (informativa)');
  linea('   • Fila 2: Nombres de campo (¡NO modificar!)');
  linea('   • Fila 3: Descripción de cada columna (informativa)');
  linea('   • Fila 4 en adelante: tus datos');
  linea('');
  linea('3. Columna IMEI *  es obligatoria en hojas de serial.');
  linea('   Columna Nombre * es obligatoria en la hoja de cantidad.');
  linea('');

  if (coloresActivo || caracteristicasActivo || variantesActivo) {
    linea('CONFIGURACIÓN ACTIVA EN TU NEGOCIO', C.headerFondo, true, 10);
    if (coloresActivo) {
      linea(`✅  Colores de serial ACTIVOS — Colores válidos: ${coloresLista.join(', ') || 'ninguno configurado'}`);
    }
    if (caracteristicasActivo) {
      linea(`✅  Características ACTIVAS — Campos: ${caracteristicasLista.join(', ') || 'ninguno configurado'}`);
    }
    if (variantesActivo) {
      linea('✅  Variantes ACTIVAS — La hoja "Productos Cantidad" incluye columnas Atributo y Variante.');
      linea('   • Deja Atributo y Variante en blanco → stock va directo al producto (sin variantes).');
      linea('   • Llena Atributo, deja Variante en blanco → stock va al atributo (nivel 1).');
      linea('   • Llena ambos → stock va a la variante (nivel 2) y se sincroniza en cascada.');
      linea('   Ejemplo: Nombre=Camiseta | Atributo=Talla M | Variante=Rojo | Stock=5');
    }
    linea('');
  }

  linea('LEYENDA DE COLORES DE COLUMNA', C.headerFondo, true, 10);
  const leyenda = [
    [C.requerido,         'Columna OBLIGATORIA'],
    [C.headerFondo,       'Columna opcional estándar'],
    [C.lineaFondo,        'Columna de Línea/categoría (desplegable si hay líneas creadas, o escribe el nombre)'],
    [C.colorFondo,        'Columna de color (activa según tu configuración)'],
    [C.caracterFondo,     'Columna de característica (activa según tu configuración)'],
    [C.precioFondo,       'Columna de precio'],
    [C.cantidadFondo,     'Columna numérica de stock'],
    [C.varianteFondo,     'Columna de Atributo (variantes activas)'],
    [C.subvarianteFondo,  'Columna de Variante / sub-variante'],
  ];
  leyenda.forEach(([bg, texto]) => {
    put(ws, r, 0, 's', '  ', sT(bg, C.blanco, 9));
    r++;
    // Can't easily put two columns in same row in this simple builder
    // The text is just above each color block
  });
  // Reset and do it properly
  r -= leyenda.length;
  leyenda.forEach(([bg, texto]) => {
    put(ws, r, 0, 's', '', sT(bg, C.blanco, 9));
    put(ws, r, 1, 's', `  ${texto}`, {
      font:      { name: 'Calibri', sz: 9, color: { rgb: '111827' } },
      fill:      { patternType: 'solid', fgColor: { rgb: C.blanco } },
      alignment: { horizontal: 'left', vertical: 'center' },
      border:    bl(),
    });
    r++;
  });

  ws['!ref']  = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: r, c: 1 } });
  ws['!cols'] = [{ wch: 4 }, { wch: 70 }];
  return ws;
}

function _parseLista(valor) {
  try { return JSON.parse(valor || '[]'); }
  catch { return []; }
}

// Construye la cadena para formula1 del dropdown de Excel (máx ~250 chars)
function _listaDropdown(nombres, maxLen = 250) {
  const result = [];
  let len = 0;
  for (const n of nombres) {
    const sep  = result.length === 0 ? '' : ',';
    const part = `${sep}${n}`;
    if (len + part.length > maxLen) break;
    result.push(n);
    len += part.length;
  }
  return result.join(',');
}

// ─── Export principal ─────────────────────────────────────────────────────────
function generarPlantillaBuffer(config = {}, lineas = []) {
  const coloresActivo         = config.colores_serial_activo === '1';
  const caracteristicasActivo = config.caracteristicas_serial_activo === '1';
  const variantesActivo       = config.variantes_activo === '1';
  const coloresLista          = _parseLista(config.colores_serial_lista);
  const caracteristicasLista  = _parseLista(config.caracteristicas_serial_lista);

  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, hojaInstrucciones(config), 'Instrucciones');

  XLSX.utils.book_append_sheet(
    wb,
    hojaSerial('Ejemplo Producto', coloresActivo, coloresLista, caracteristicasActivo, caracteristicasLista, lineas),
    'Ejemplo Producto'
  );

  XLSX.utils.book_append_sheet(wb, hojaCantidad(variantesActivo, lineas), 'Productos Cantidad');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
}

module.exports = { generarPlantillaBuffer };
