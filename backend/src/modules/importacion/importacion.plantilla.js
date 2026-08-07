const XLSX = require('xlsx');
const { nombreColumnaCaracteristica } = require('./importacion.informe');

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
function hojaSerial(nombreProducto, coloresActivo, coloresLista, caracteristicasActivo, caracteristicasLista, lineas = [], ubicacionActiva = false) {
  const ws = {};

  // ── Columnas dinámicas ────────────────────────────────────────────────────
  // La CLAVE (fila 1) debe normalizarse (lowercase + spaces→_) al valor que
  // el service leerá desde fila.*. El normalizer hace: trim().toLowerCase().replace(/\s+/g,'_')
  const columnas = [];

  columnas.push(
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
  );

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
      // Una característica puede llamarse igual que una columna fija — pasa de
      // verdad: hay negocios con la característica «Color» Y los colores de
      // serial activos. Dos columnas con la misma clave hacen que Excel las
      // colapse y el dato se pierda sin que nadie lo note, así que la
      // característica se desambigua. El importador entiende las dos formas.
      columnas.push({
        clave: nombreColumnaCaracteristica(nombre, coloresActivo),
        desc:  `Característica: ${nombre}`,
        bg:    C.caracterFondo,
        num:   false,
      });
    }
  }

  if (ubicacionActiva) {
    // Es de la REFERENCIA, no de cada IMEI: basta ponerla en una fila de la hoja.
    columnas.push({
      clave: 'Ubicacion',
      desc:  'Opcional · Dónde está guardado (ej: Estante A-3). Aplica a todo el producto',
      bg:    C.headerFondo,
      num:   false,
    });
  }

  columnas.push(
    { clave: 'Precio',         desc: 'Opcional · Precio de venta (COP)',                  bg: C.precioFondo,  num: true },
    { clave: 'Costo Compra',   desc: 'Opcional · Costo de adquisición (COP). Sin él, la venta no muestra utilidad', bg: C.headerFondo,  num: true },
    { clave: 'Cliente Origen', desc: 'Opcional · Nombre del cliente si es retoma',        bg: C.headerFondo,  num: false },
    { clave: 'Nota',           desc: 'Opcional · Observación libre de esta unidad',       bg: C.headerFondo,  num: false },
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
    if (clave === 'Nota')          return { wch: 30 };
    return { wch: 18 };
  });
  ws['!rows'] = [{ hpt: 20 }, { hpt: 22 }, { hpt: 30 }];

  return ws;
}

// ─── Hoja cantidad ────────────────────────────────────────────────────────────
function hojaCantidad(variantesActivo = false, lineas = [], codigoActivo = false, ubicacionActiva = false) {
  const columnas = [
    { clave: 'Nombre *',       desc: 'Requerido · Nombre del producto',                             bg: C.requerido,         num: false, wch: 30 },
  ];

  if (codigoActivo) {
    columnas.push({
      clave: 'Codigo',
      desc:  'Opcional · Código único / de barras (escríbelo como TEXTO, no número)',
      bg:    C.headerFondo,
      num:   false,
      wch:   18,
    });
  }

  if (ubicacionActiva) {
    columnas.push({
      clave: 'Ubicacion',
      desc:  'Opcional · Dónde está guardado (ej: Estante A-3, Vitrina 2)',
      bg:    C.headerFondo,
      num:   false,
      wch:   20,
    });
  }

  columnas.push(
    {
      clave: 'Linea',
      desc:  lineas.length > 0
        ? `Opcional · Categoría (${lineas.slice(0, 5).map(l => l.nombre).join(', ')}${lineas.length > 5 ? '…' : ''})`
        : 'Opcional · Línea o categoría del producto (escribe el nombre)',
      bg:    C.lineaFondo,
      num:   false,
      wch:   22,
    },
  );

  if (variantesActivo) {
    columnas.push(
      { clave: 'Atributo', desc: 'Opcional · Valor del atributo (ej: M, L, XL, Rojo)',             bg: C.varianteFondo,     num: false, wch: 18 },
      { clave: 'Variante', desc: 'Opcional · Sub-variante dentro del atributo (ej: Oscuro, Claro)', bg: C.subvarianteFondo,  num: false, wch: 18 },
    );
  }

  columnas.push(
    { clave: 'Stock',          desc: 'Cantidad (se SUMA al existente, 0 si es nuevo)',              bg: C.cantidadFondo,     num: true,  wch: 10 },
    { clave: 'Stock Minimo',   desc: 'Alerta de stock bajo (toma el mayor)',                        bg: C.cantidadFondo,     num: true,  wch: 14 },
    {
      clave: 'Costo Unitario',
      desc:  variantesActivo
        ? 'Costo de compra por unidad (COP). Si la fila tiene Atributo/Variante, es el costo DE ESA variante'
        : 'Costo de compra por unidad (COP). Sin él, la venta no muestra utilidad',
      bg: C.headerFondo, num: true, wch: 16,
    },
    { clave: 'Precio Venta',   desc: 'Precio de venta al público (COP)',                            bg: C.precioFondo,       num: true,  wch: 14 },
    { clave: 'Unidad Medida',  desc: 'Ej: unidad, caja, kg, litro (defecto: unidad)',              bg: C.headerFondo,       num: false, wch: 16 },
    { clave: 'Proveedor',      desc: 'Opcional · Nombre del proveedor habitual',                    bg: C.headerFondo,       num: false, wch: 20 },
    { clave: 'Cliente Origen', desc: 'Opcional · Solo si proviene de un cliente',                   bg: C.headerFondo,       num: false, wch: 22 },
    { clave: 'Nota',           desc: 'Opcional · Observación libre del producto',                   bg: C.headerFondo,       num: false, wch: 30 },
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
  const codigoActivo          = config.codigo_producto_activo === '1';
  const ubicacionActiva       = config.ubicacion_activa === '1';
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
  linea('ANTES DE IMPORTAR VAS A VER UN RESUMEN', C.headerFondo, true, 10);
  linea('Al subir el archivo, el sistema primero te MUESTRA qué va a pasar (cuántos productos');
  linea('nuevos, a cuáles se les suma stock, qué filas tienen problema) sin guardar nada.');
  linea('Revisa ese resumen, corrige el Excel si hace falta, y recién ahí confirmas.');
  linea('Nada se escribe hasta que le des a Confirmar.');
  linea('');
  linea('CÓMO USAR ESTA PLANTILLA', C.headerFondo, true, 10);
  linea('1. Cada hoja con nombre de producto = seriales de ese producto.');
  linea('   • Renombra la hoja "Ejemplo Producto" con el nombre real del producto.');
  linea('   • Puedes agregar más hojas para más productos (una hoja por producto).');
  linea('');
  linea('2. La hoja "Productos Cantidad" es para productos SIN serial (accesorios, cajas…).');
  linea('');
  linea('3. No borres ni muevas las primeras 3 filas de cada hoja.');
  linea('   • Fila 1: Título (informativa)');
  linea('   • Fila 2: Nombres de campo (¡NO modificar!)');
  linea('   • Fila 3: Descripción de cada columna (informativa)');
  linea('   • Fila 4 en adelante: tus datos');
  linea('');
  linea('4. Columna IMEI *  es obligatoria en hojas de serial.');
  linea('   Columna Nombre * es obligatoria en la hoja de cantidad.');
  linea('   Las hojas que no tengan columna IMEI se ignoran (puedes dejar tus apuntes ahí).');
  linea('');
  linea('LO QUE DEBES SABER', C.headerFondo, true, 10);
  linea('• El Stock se SUMA al que ya tenga el producto. Si subes el mismo archivo dos veces,');
  linea('  el stock queda doble. El resumen previo te avisa a qué productos se les va a sumar.');
  linea('• Escribe los nombres SIEMPRE igual. "iPhone 13" y "iphone 13 " (con espacio al final)');
  linea('  quedan como dos productos distintos. El resumen te avisa si detecta parecidos.');
  linea('• Un IMEI no puede estar en dos sedes. Si ya existe en otra sucursal, esa fila no se');
  linea('  importa y te lo dice: para mover un equipo de sede se usa un traslado.');
  linea('• Las unidades ya vendidas o prestadas nunca se modifican.');
  linea('• El costo es opcional. Sin costo, esa venta no mostrará utilidad en los reportes.');
  linea('• Mira la hoja "Referencia": tiene las líneas y proveedores que ya existen, para que');
  linea('  los escribas igual y no se creen duplicados por un typo.');
  linea('');

  if (coloresActivo || caracteristicasActivo || variantesActivo || codigoActivo || ubicacionActiva) {
    linea('CONFIGURACIÓN ACTIVA EN TU NEGOCIO', C.headerFondo, true, 10);
    if (coloresActivo) {
      linea(`✅  Colores de serial ACTIVOS — Colores válidos: ${coloresLista.join(', ') || 'ninguno configurado'}`);
    }
    if (caracteristicasActivo) {
      linea(`✅  Características ACTIVAS — Campos: ${caracteristicasLista.join(', ') || 'ninguno configurado'}`);
    }
    if (codigoActivo) {
      linea('✅  Código único de producto ACTIVO — La hoja "Productos Cantidad" incluye la columna Codigo.');
      linea('   • Escribe el código como TEXTO (formato de celda Texto) para no perder ceros a la izquierda.');
      linea('   • Un código debe apuntar a UN solo producto dentro del negocio.');
    }
    if (ubicacionActiva) {
      linea('✅  Ubicación en bodega ACTIVA — Ambas hojas incluyen la columna Ubicacion.');
      linea('   • Escribe dónde está guardado: "Estante A-3", "Vitrina 2", "Bodega fondo".');
      linea('   • En hojas de serial la ubicación es del PRODUCTO completo, no de cada IMEI:');
      linea('     basta llenarla en una fila; si hay varias, se usa la primera que tenga valor.');
      linea('   • Si dejas la columna vacía NO se borra la ubicación que ya tenga el producto.');
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

// ─── Hoja de referencia ───────────────────────────────────────────────────────
// Los valores que YA existen en el negocio. Sin esto el usuario escribe
// "Accesorios" donde la línea se llama "ACCESORIOS", y aunque la búsqueda es
// insensible a mayúsculas, un typo real ("Acesorios") crea una línea nueva sin
// que nadie se entere. Aquí los ve y los copia.
function hojaReferencia(config, lineas = [], proveedores = []) {
  const ws = {};
  let r = 0;

  const titulo = (texto) => {
    put(ws, r, 0, 's', texto, sT(C.headerFondo, C.blanco, 10));
    put(ws, r, 1, 's', '',    sT(C.headerFondo, C.blanco, 10));
    r++;
  };
  const item = (a, b = '') => {
    put(ws, r, 0, 's', a, sCelda(C.datoFondo));
    put(ws, r, 1, 's', b, sCelda(C.datoFondo));
    r++;
  };
  const vacio = () => { r++; };

  put(ws, r, 0, 's', '📚  VALORES QUE YA EXISTEN EN TU NEGOCIO', sT(C.tituloFondo, C.blanco, 12));
  put(ws, r, 1, 's', '', sT(C.tituloFondo, C.blanco, 12));
  r++;
  vacio();

  titulo('LÍNEAS / CATEGORÍAS');
  if (lineas.length) lineas.forEach((l) => item(l.nombre));
  else item('(ninguna creada todavía)');
  vacio();

  titulo('PROVEEDORES');
  if (proveedores.length) proveedores.slice(0, 200).forEach((p) => item(p.nombre));
  else item('(ninguno creado todavía)');
  vacio();

  const coloresLista = _parseLista(config.colores_serial_lista);
  if (config.colores_serial_activo === '1') {
    titulo('COLORES DE SERIAL');
    if (coloresLista.length) coloresLista.forEach((c) => item(c));
    else item('(ninguno configurado en Ajustes)');
    vacio();
  }

  const caracteristicasLista = _parseLista(config.caracteristicas_serial_lista);
  if (config.caracteristicas_serial_activo === '1') {
    titulo('CARACTERÍSTICAS DE SERIAL');
    if (caracteristicasLista.length) {
      caracteristicasLista.forEach((c) => item(c, 'Es una columna en las hojas de seriales'));
    } else item('(ninguna configurada en Ajustes)');
    vacio();
  }

  if (config.tarifas_activo === '1') {
    const tarifas = _parseLista(config.tarifas_lista);
    titulo('TARIFAS (precio calculado desde el costo)');
    if (tarifas.length) {
      tarifas.forEach((t) => item(t?.nombre ?? '', `+${t?.porcentaje ?? 0}% sobre el costo`));
      item('', 'Un producto SIN costo no se puede cotizar por tarifa.');
    } else item('(ninguna configurada en Ajustes)');
    vacio();
  }

  ws['!ref']  = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(r, 1), c: 1 } });
  ws['!cols'] = [{ wch: 40 }, { wch: 50 }];
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
function generarPlantillaBuffer(config = {}, lineas = [], proveedores = []) {
  const coloresActivo         = config.colores_serial_activo === '1';
  const caracteristicasActivo = config.caracteristicas_serial_activo === '1';
  const variantesActivo       = config.variantes_activo === '1';
  const codigoActivo          = config.codigo_producto_activo === '1';
  const ubicacionActiva       = config.ubicacion_activa === '1';
  const coloresLista          = _parseLista(config.colores_serial_lista);
  const caracteristicasLista  = _parseLista(config.caracteristicas_serial_lista);

  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, hojaInstrucciones(config), 'Instrucciones');

  XLSX.utils.book_append_sheet(
    wb,
    hojaSerial('Ejemplo Producto', coloresActivo, coloresLista, caracteristicasActivo, caracteristicasLista, lineas, ubicacionActiva),
    'Ejemplo Producto'
  );

  XLSX.utils.book_append_sheet(wb, hojaCantidad(variantesActivo, lineas, codigoActivo, ubicacionActiva), 'Productos Cantidad');

  XLSX.utils.book_append_sheet(wb, hojaReferencia(config, lineas, proveedores), 'Referencia');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
}

module.exports = { generarPlantillaBuffer };
