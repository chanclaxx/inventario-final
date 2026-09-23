const XLSX = require('xlsx');

// ─────────────────────────────────────────────────────────────────────────────
// LA PLANTILLA DE PRECIOS ES EL EXPORT — el mismo archivo en los dos sentidos.
//
// No hay un "exportar precios" y aparte un "importar precios" con una plantilla
// vacía que el usuario tenga que rellenar a mano. Se descarga lo que HAY hoy,
// se edita en Excel y se vuelve a subir. Eso es lo que convierte mantener 450
// productos × 3 listas × 3 locales en algo que se hace un martes por la tarde,
// que era justo el pedido: "de fácil edición".
//
// ── Una hoja por sucursal ───────────────────────────────────────────────────
// Los precios son POR SUCURSAL (cada sede tiene su fila y su precio), así que
// una sola hoja con 1.350 filas obligaría a filtrar para trabajar. Una hoja por
// local se edita igual que se piensa: "los de Bunny". Y como el libro trae las
// tres, se bajan, se editan y se suben de una sola vez.
//
// ── El token es lo que hace EXACTO el viaje de vuelta ───────────────────────
// La primera columna lleva `p123` / `a456` / `v789`. Al reimportar no hay que
// adivinar a qué fila corresponde cada línea: no se compara por nombre, no se
// normaliza, no se falla por una mayúscula. Es justo el problema que tuvo la
// importación de inventario —14 filas que chocaban solo por MAYÚSCULAS— y aquí
// no puede pasar porque no hay conjetura que hacer.
//
// Si alguien borra el token o agrega una fila a mano, el importador cae al
// nombre. Eso SÍ es una conjetura, y por eso se reporta como aviso en vez de
// aplicarse en silencio.
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  headerFondo: '1D4ED8',
  precioFondo: '047857',
  fijoFondo:   '6B7280',
  blanco:      'FFFFFF',
  grisSuave:   'F3F4F6',
};

const sCabecera = (fondo) => ({
  font:      { bold: true, sz: 10, color: { rgb: C.blanco } },
  fill:      { fgColor: { rgb: fondo } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
});

const sTexto = (fondo) => ({
  font: { sz: 10, color: { rgb: '374151' } },
  fill: { fgColor: { rgb: fondo } },
});

const put = (ws, r, c, tipo, valor, estilo) => {
  const ref = XLSX.utils.encode_cell({ r, c });
  ws[ref] = { t: tipo, v: valor };
  if (estilo) ws[ref].s = estilo;
};

/** Nombre de hoja válido para Excel: 31 caracteres y sin los que rompen. */
const nombreHoja = (nombre, usados) => {
  let base = String(nombre || 'Sucursal').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 28) || 'Sucursal';
  let final = base;
  let n = 2;
  while (usados.has(final.toLowerCase())) final = `${base} ${n++}`.slice(0, 31);
  usados.add(final.toLowerCase());
  return final;
};

// Las columnas fijas van SIEMPRE en este orden y con estos nombres: son el
// contrato que lee el importador. Cambiar uno aquí sin cambiarlo allá deja un
// archivo que se descarga bien y no se puede volver a subir.
//
// «Variante» se llamaba «Detalle» hasta sep-2026: con las tallas dentro del
// archivo, «Detalle» no decía qué era esa fila. El importador sigue aceptando
// las dos —un archivo bajado antes tiene que poder subirse igual— y por eso
// `COLUMNAS_CONOCIDAS` lleva las dos, o la vieja saldría como «columna que no
// es ninguna de tus listas y se ignora».
const COLUMNAS_FIJAS = ['ID', 'Producto', 'Variante', 'Nivel', 'Código', 'Precio actual'];
const COLUMNAS_CONOCIDAS = [...COLUMNAS_FIJAS, 'Detalle'];

// Una talla se ve como lo que es: DEBAJO de su producto y sangrada. Con 2.000
// filas, el archivo tiene que dejar ver de un vistazo dónde empieza y dónde
// termina cada producto — si no, tarifar una talla es buscarla.
const SANGRIA = { producto: '', serial: '', atributo: '    ', variante: '        ' };

function hojaSucursal(nodos, listas) {
  const ws = {};
  const encabezados = [...COLUMNAS_FIJAS, ...listas.map((l) => l.nombre)];

  encabezados.forEach((texto, c) => {
    const esLista = c >= COLUMNAS_FIJAS.length;
    put(ws, 0, c, 's', texto, sCabecera(esLista ? C.precioFondo : C.fijoFondo));
  });

  nodos.forEach((nodo, i) => {
    const r = i + 1;
    const esProducto = nodo.nivel === 'producto' || nodo.nivel === 'serial';
    // Las filas de talla van con fondo suave y el nombre del producto en gris:
    // lo que hay que leer en ellas es la variante, no repetir el producto.
    const fondo = esProducto ? C.blanco : C.grisSuave;
    const estilo = esProducto
      ? { ...sTexto(fondo), font: { sz: 10, bold: true, color: { rgb: '111827' } } }
      : sTexto(fondo);

    put(ws, r, 0, 's', nodo.token,        sTexto(fondo));
    put(ws, r, 1, 's', nodo.nombre ?? '', estilo);
    // Un producto con tallas NO se tarifa solo con su fila: lo que se vende es
    // la talla. Se dice aquí, en la fila, y no solo en las instrucciones.
    const variante = nodo.detalle
      ? `${SANGRIA[nodo.nivel] || ''}${nodo.detalle}`
      : (nodo.tiene_hijos ? '(y todas sus variantes, abajo)' : '');
    put(ws, r, 2, 's', variante, sTexto(fondo));
    put(ws, r, 3, 's', nodo.nivel_etiqueta ?? '', sTexto(fondo));
    put(ws, r, 4, 's', nodo.codigo ?? '', sTexto(fondo));
    // El precio de siempre viaja como REFERENCIA, no se importa: es lo que se
    // cobra cuando la lista elegida no menciona el producto, y verlo al lado
    // es lo que deja decidir si hace falta tarifarlo.
    const precio = Number(nodo.precio);
    if (Number.isFinite(precio) && precio > 0) put(ws, r, 5, 'n', precio, sTexto(fondo));
    else put(ws, r, 5, 's', '', sTexto(fondo));

    // Sin precio en esa lista NO se escribe la celda: una celda de texto vacío
    // es, para Excel, una celda CON contenido — se cuenta al filtrar, estorba al
    // arrastrar un precio hacia abajo y al pegar una columna entera. Vacía de
    // verdad es lo que significa «esta fila hereda».
    listas.forEach((l, k) => {
      const v = Number(nodo.precios?.[l.id]);
      if (Number.isFinite(v) && v > 0) put(ws, r, COLUMNAS_FIJAS.length + k, 'n', v);
    });
  });

  const ref = XLSX.utils.encode_range(
    { s: { r: 0, c: 0 }, e: { r: nodos.length, c: encabezados.length - 1 } });
  ws['!ref']  = ref;
  ws['!cols'] = [
    { wch: 10 }, { wch: 40 }, { wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    ...listas.map(() => ({ wch: 16 })),
  ];
  // Congelar la cabecera: con 450 filas, perder de vista qué columna es cuál es
  // la forma más fácil de escribir el precio mayorista en la columna del final.
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  // Y el filtro de Excel, que es como se tarifa de verdad: «todas las tallas de
  // las correas», «solo lo que no tiene precio mayorista».
  ws['!autofilter'] = { ref };
  return ws;
}

function hojaInstrucciones(listas, sucursales) {
  const ws = {};
  let r = 0;
  const linea = (texto, estilo) => { put(ws, r, 0, 's', texto, estilo); r++; };
  const titulo = (t) => linea(t, { font: { bold: true, sz: 11, color: { rgb: C.blanco } },
                                   fill: { fgColor: { rgb: C.headerFondo } } });
  const normal = (t) => linea(t, { font: { sz: 10, color: { rgb: '374151' } } });

  titulo('PRECIOS POR LISTA — CÓMO USAR ESTE ARCHIVO');
  normal('');
  normal('1. Este archivo YA trae los precios que tienes hoy. No empiezas de cero.');
  normal('2. Escribe o corrige los precios en las columnas verdes. Una por cada lista.');
  normal('3. Guárdalo y vuelve a subirlo desde Inventario → Precios por lista.');
  normal('4. Antes de aplicar nada vas a ver un resumen de lo que va a cambiar.');
  normal('');
  titulo('LO QUE DEBES SABER');
  normal('');
  normal('· NO borres la columna ID: es lo que identifica cada producto sin equivocarse.');
  normal('  Si la borras, se busca por nombre y eso sí puede fallar con nombres parecidos.');
  normal('· Cada producto trae DEBAJO sus tallas y colores, sangrados. La columna "Nivel"');
  normal('  dice qué es cada fila: Producto, Talla, Color… o Referencia (equipos con IMEI).');
  normal('· El precio que pongas en el PRODUCTO vale para todas sus tallas. Escribe en la');
  normal('  fila de una talla solo si ESA talla vale distinto: la de abajo manda.');
  normal('· Una casilla VACÍA significa "sin precio propio": esa fila hereda el precio del');
  normal('  producto y, si tampoco lo tiene, se vende a su precio de siempre (la columna');
  normal('  "Precio actual"). Nunca en $0.');
  normal('· Escribir 0 es lo mismo que dejarla vacía. Un producto a $0 siempre es un error.');
  normal('· "Precio actual", "Código", "Nivel" y "Variante" son solo de referencia: aunque');
  normal('  los cambies, no se importan.');
  normal('· Puedes usar el filtro de Excel de la fila 1 para trabajar por producto o por');
  normal('  talla sin perderte entre miles de filas.');
  normal('· Este archivo NO toca costos, stock ni ningún otro dato. Solo precios de venta.');
  normal('· Los productos que borres de una hoja se quedan como están. Para quitarle el');
  normal('  precio a uno, deja sus casillas verdes vacías.');
  normal('');
  titulo('TUS LISTAS DE PRECIOS');
  normal('');
  listas.forEach((l) => normal(`· ${l.nombre}`));
  normal('');
  titulo('HOJAS DE ESTE ARCHIVO (una por sucursal)');
  normal('');
  sucursales.forEach((s) => normal(`· ${s.nombre}`));
  normal('');
  normal('Cada sucursal tiene sus propios precios. Si quieres que sean iguales en todas,');
  normal('copia y pega la columna de una hoja a la otra.');

  ws['!ref']  = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: r - 1, c: 0 } });
  ws['!cols'] = [{ wch: 96 }];
  return ws;
}

/**
 * El libro completo: instrucciones + una hoja por sucursal, ya con los precios
 * de hoy escritos.
 *
 * `datos` = [{ sucursal: {id, nombre}, nodos: [...] }]
 */
function generarPlantillaBuffer(datos, listas) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb, hojaInstrucciones(listas, datos.map((d) => d.sucursal)), 'Instrucciones');

  const usados = new Set(['instrucciones']);
  for (const { sucursal, nodos } of datos) {
    XLSX.utils.book_append_sheet(wb, hojaSucursal(nodos, listas), nombreHoja(sucursal.nombre, usados));
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
}

module.exports = { generarPlantillaBuffer, COLUMNAS_FIJAS, COLUMNAS_CONOCIDAS };
