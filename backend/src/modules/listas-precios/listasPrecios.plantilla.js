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

// Las cuatro columnas fijas van SIEMPRE en este orden y con estos nombres: son
// el contrato que lee el importador. Cambiar uno aquí sin cambiarlo allá deja
// un archivo que se descarga bien y no se puede volver a subir.
const COLUMNAS_FIJAS = ['ID', 'Producto', 'Detalle', 'Código', 'Precio actual'];

function hojaSucursal(nodos, listas) {
  const ws = {};
  const encabezados = [...COLUMNAS_FIJAS, ...listas.map((l) => l.nombre)];

  encabezados.forEach((texto, c) => {
    const esLista = c >= COLUMNAS_FIJAS.length;
    put(ws, 0, c, 's', texto, sCabecera(esLista ? C.precioFondo : C.fijoFondo));
  });

  nodos.forEach((nodo, i) => {
    const r = i + 1;
    // Las filas de talla van con fondo suave: con 2.000 líneas hay que poder
    // ver de un vistazo dónde empieza y termina cada producto.
    const fondo = nodo.nivel === 'producto' ? C.blanco : C.grisSuave;

    put(ws, r, 0, 's', nodo.token,             sTexto(fondo));
    put(ws, r, 1, 's', nodo.nombre  ?? '',      sTexto(fondo));
    put(ws, r, 2, 's', nodo.detalle ?? '',      sTexto(fondo));
    put(ws, r, 3, 's', nodo.codigo  ?? '',      sTexto(fondo));
    // El precio de siempre viaja como REFERENCIA, no se importa: es lo que se
    // cobra cuando la lista elegida no menciona el producto, y verlo al lado
    // es lo que deja decidir si hace falta tarifarlo.
    const precio = Number(nodo.precio);
    if (Number.isFinite(precio) && precio > 0) put(ws, r, 4, 'n', precio, sTexto(fondo));
    else put(ws, r, 4, 's', '', sTexto(fondo));

    listas.forEach((l, k) => {
      const v = nodo.precios?.[l.id];
      const c = COLUMNAS_FIJAS.length + k;
      if (Number.isFinite(Number(v)) && Number(v) > 0) put(ws, r, c, 'n', Number(v));
      else put(ws, r, c, 's', '');
    });
  });

  ws['!ref']  = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: nodos.length, c: encabezados.length - 1 } });
  ws['!cols'] = [
    { wch: 10 }, { wch: 42 }, { wch: 22 }, { wch: 14 }, { wch: 14 },
    ...listas.map(() => ({ wch: 16 })),
  ];
  // Congelar la cabecera: con 450 filas, perder de vista qué columna es cuál es
  // la forma más fácil de escribir el precio mayorista en la columna del final.
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
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
  normal('· Una casilla VACÍA significa "sin precio en esa lista": ese producto se venderá');
  normal('  a su precio de siempre (la columna gris "Precio actual"), nunca en $0.');
  normal('· Escribir 0 es lo mismo que dejarla vacía. Un producto a $0 siempre es un error.');
  normal('· "Precio actual" y "Código" son solo de referencia: aunque los cambies, no se importan.');
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

module.exports = { generarPlantillaBuffer, COLUMNAS_FIJAS };
