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
//
// «Línea» (sep-2026) es de REFERENCIA, como «Nivel» y «Código»: el importador
// no la lee —a qué nodo va una fila lo decide el ID—, así que moverla de
// línea en el Excel no mueve el producto de línea en el programa.
const COLUMNAS_FIJAS = ['ID', 'Línea', 'Producto', 'Variante', 'Nivel', 'Código', 'Precio actual'];
const COLUMNAS_CONOCIDAS = [...COLUMNAS_FIJAS, 'Detalle'];
const COL = Object.fromEntries(COLUMNAS_FIJAS.map((n, i) => [n, i]));

// ── Agrupado por LÍNEA (pedido del usuario, 29-sep-2026) ────────────────────
// «Que se vea clasificado por las líneas del programa: el iPhone 11 dentro de
// iPhones.» El repositorio ya entrega los nodos ordenados por línea; aquí cada
// línea abre con una fila de ENCABEZADO y sus filas quedan agrupadas con el
// esquema de Excel (el botón +/− a la izquierda), así que se puede plegar
// «Accesorios» y trabajar solo en «iPhones».
// Dos cosas que NO se usan, a propósito: los colores (el `xlsx` del backend es
// la edición comunitaria y descarta los estilos al escribir: un encabezado que
// solo se distinguiera por el relleno saldría como una fila más) y las celdas
// combinadas (rompen el filtro y el ordenar de Excel). El encabezado se
// reconoce por el texto: el nombre en MAYÚSCULAS y «Línea» en la columna Nivel.
// El importador se lo salta por eso mismo —sin ID y con Nivel «Línea»—, así que
// subir el archivo recién bajado sigue sin cambiar ni una fila.
const NIVEL_LINEA = 'Línea';
const SIN_LINEA   = 'Sin línea';

const esRaiz = (nodo) => nodo.nivel === 'producto' || nodo.nivel === 'serial';

/** Parte los nodos (ya ordenados por línea) en grupos contiguos. */
function agruparPorLinea(nodos) {
  const grupos = [];
  for (const nodo of nodos) {
    const clave = nodo.linea_id ?? null;
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.clave === clave) ultimo.nodos.push(nodo);
    else grupos.push({ clave, nombre: nodo.linea || SIN_LINEA, nodos: [nodo] });
  }
  return grupos;
}

// Una talla se ve como lo que es: DEBAJO de su producto y sangrada. Con 2.000
// filas, el archivo tiene que dejar ver de un vistazo dónde empieza y dónde
// termina cada producto — si no, tarifar una talla es buscarla.
const SANGRIA = { producto: '', serial: '', atributo: '    ', variante: '        ' };

function hojaSucursal(nodos, listas, { soloListas = false } = {}) {
  const ws = {};
  const encabezados = [...COLUMNAS_FIJAS, ...listas.map((l) => l.nombre)];
  const filasInfo = [{}];   // !rows: la cabecera va sin nivel de esquema

  encabezados.forEach((texto, c) => {
    const esLista = c >= COLUMNAS_FIJAS.length;
    put(ws, 0, c, 's', texto, sCabecera(esLista ? C.precioFondo : C.fijoFondo));
  });

  let r = 1;
  for (const grupo of agruparPorLinea(nodos)) {
    // ── Encabezado de la línea ───────────────────────────────────────────
    const productos = grupo.nodos.filter(esRaiz).length;
    const sLinea = { font: { bold: true, sz: 11, color: { rgb: C.blanco } },
                     fill: { fgColor: { rgb: C.headerFondo } } };
    put(ws, r, COL['Línea'], 's', grupo.nombre, sLinea);
    put(ws, r, COL.Producto, 's', String(grupo.nombre).toUpperCase(), sLinea);
    put(ws, r, COL.Variante, 's', `${productos} producto${productos === 1 ? '' : 's'}`, sLinea);
    put(ws, r, COL.Nivel,    's', NIVEL_LINEA, sLinea);
    filasInfo[r] = {};
    r++;

    for (const nodo of grupo.nodos) {
      const esProducto = esRaiz(nodo);
      // Las filas de talla van con fondo suave y el nombre del producto en gris:
      // lo que hay que leer en ellas es la variante, no repetir el producto.
      const fondo = esProducto ? C.blanco : C.grisSuave;
      const estilo = esProducto
        ? { ...sTexto(fondo), font: { sz: 10, bold: true, color: { rgb: '111827' } } }
        : sTexto(fondo);

      put(ws, r, COL.ID,       's', nodo.token,        sTexto(fondo));
      // La línea se repite en CADA fila: es lo que deja filtrar por línea con
      // el filtro de Excel, y lo que sigue diciendo de dónde es la fila si
      // alguien la copia a otra parte.
      put(ws, r, COL['Línea'], 's', grupo.nombre,      sTexto(fondo));
      put(ws, r, COL.Producto, 's', nodo.nombre ?? '', estilo);
      // Un producto con tallas NO se tarifa solo con su fila: lo que se vende es
      // la talla. Se dice aquí, en la fila, y no solo en las instrucciones.
      const variante = nodo.detalle
        ? `${SANGRIA[nodo.nivel] || ''}${nodo.detalle}`
        : (nodo.tiene_hijos ? '(y todas sus variantes, abajo)' : '');
      put(ws, r, COL.Variante,  's', variante, sTexto(fondo));
      put(ws, r, COL.Nivel,     's', nodo.nivel_etiqueta ?? '', sTexto(fondo));
      put(ws, r, COL['Código'], 's', nodo.codigo ?? '', sTexto(fondo));
      // El precio de siempre viaja como REFERENCIA, no se importa: es lo que se
      // cobra cuando la lista elegida no menciona el producto, y verlo al lado
      // es lo que deja decidir si hace falta tarifarlo.
      // En una sede que vende SOLO con listas (opt-in por sede) el precio de
      // siempre de un producto por cantidad no se usa: mostrarlo aquí haría
      // creer que sigue siendo el respaldo. Los equipos con IMEI sí lo conservan.
      const precio = soloListas && nodo.nivel !== 'serial' ? NaN : Number(nodo.precio);
      if (Number.isFinite(precio) && precio > 0) put(ws, r, COL['Precio actual'], 'n', precio, sTexto(fondo));
      else put(ws, r, COL['Precio actual'], 's', '', sTexto(fondo));

      // Sin precio en esa lista NO se escribe la celda: una celda de texto vacío
      // es, para Excel, una celda CON contenido — se cuenta al filtrar, estorba al
      // arrastrar un precio hacia abajo y al pegar una columna entera. Vacía de
      // verdad es lo que significa «esta fila hereda».
      listas.forEach((l, k) => {
        const v = Number(nodo.precios?.[l.id]);
        if (Number.isFinite(v) && v > 0) put(ws, r, COLUMNAS_FIJAS.length + k, 'n', v);
      });
      filasInfo[r] = { level: 1 };
      r++;
    }
  }

  const ref = XLSX.utils.encode_range(
    { s: { r: 0, c: 0 }, e: { r: r - 1, c: encabezados.length - 1 } });
  ws['!ref']  = ref;
  ws['!cols'] = [
    { wch: 10 }, { wch: 18 }, { wch: 40 }, { wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    ...listas.map(() => ({ wch: 16 })),
  ];
  // El esquema de Excel: cada línea se pliega desde SU encabezado, que va
  // arriba de sus filas (por defecto Excel pone el botón debajo del grupo).
  ws['!rows']    = filasInfo;
  ws['!outline'] = { above: true };
  // Congelar la cabecera: con 450 filas, perder de vista qué columna es cuál es
  // la forma más fácil de escribir el precio mayorista en la columna del final.
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  // Y el filtro de Excel, que es como se tarifa de verdad: «todas las tallas de
  // las correas», «solo lo que no tiene precio mayorista», «solo los iPhones».
  ws['!autofilter'] = { ref };
  return ws;
}

function hojaInstrucciones(listas, sucursales, { soloListas = [], principal = '' } = {}) {
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
  normal('· Los productos vienen AGRUPADOS POR LÍNEA, como en el programa: cada línea');
  normal('  empieza con una fila en MAYÚSCULAS (Nivel "Línea") y con el botón − de la');
  normal('  izquierda se pliega. Esas filas no llevan precio y no se importan. La columna');
  normal('  "Línea" sirve para filtrar; cambiarla aquí NO cambia la línea del producto.');
  normal('· Cada producto trae DEBAJO sus tallas y colores, sangrados. La columna "Nivel"');
  normal('  dice qué es cada fila: Producto, Talla, Color… o Referencia (equipos con IMEI).');
  normal('· El precio que pongas en el PRODUCTO vale para todas sus tallas. Escribe en la');
  normal('  fila de una talla solo si ESA talla vale distinto: la de abajo manda.');
  normal('· Una casilla VACÍA significa "sin precio propio": esa fila hereda el precio del');
  normal('  producto y, si tampoco lo tiene, se vende a su precio de siempre (la columna');
  normal('  "Precio actual"). Nunca en $0.');
  normal('· Escribir 0 es lo mismo que dejarla vacía. Un producto a $0 siempre es un error.');
  normal('· "Línea", "Precio actual", "Código", "Nivel" y "Variante" son de referencia: aunque');
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
  if (soloListas.length) {
    titulo('SEDES QUE VENDEN SOLO CON LISTAS');
    normal('');
    soloListas.forEach((s) => normal(`· ${s.nombre}`));
    normal('');
    normal('En estas sedes los productos por cantidad NO usan el "Precio actual" (va vacío):');
    normal(`sin lista elegida se cobra «${principal}», y lo que tampoco tenga precio ahí hay`);
    normal('que escribirlo al vender. Los equipos con IMEI siguen con su precio de siempre.');
    normal('');
  }
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
function generarPlantillaBuffer(datos, listas, { principal = null } = {}) {
  const wb = XLSX.utils.book_new();
  // `soloListas` en una sede (opt-in, ausente = como siempre) cambia DOS cosas
  // de su hoja y ninguna de las demás: «Precio actual» vacío en los productos
  // por cantidad, y un bloque en las instrucciones que lo explica.
  const nombrePrincipal = listas.find((l) => l.id === principal)?.nombre || '';
  XLSX.utils.book_append_sheet(wb, hojaInstrucciones(listas, datos.map((d) => d.sucursal), {
    soloListas: nombrePrincipal ? datos.filter((d) => d.soloListas).map((d) => d.sucursal) : [],
    principal:  nombrePrincipal,
  }), 'Instrucciones');

  const usados = new Set(['instrucciones']);
  for (const { sucursal, nodos, soloListas } of datos) {
    XLSX.utils.book_append_sheet(
      wb, hojaSucursal(nodos, listas, { soloListas: !!soloListas && !!nombrePrincipal }),
      nombreHoja(sucursal.nombre, usados));
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
}

module.exports = { generarPlantillaBuffer, COLUMNAS_FIJAS, COLUMNAS_CONOCIDAS, NIVEL_LINEA };
