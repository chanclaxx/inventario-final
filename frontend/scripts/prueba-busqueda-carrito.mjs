// ─────────────────────────────────────────────────────────────────────────────
// Buscar dentro del carrito — lógica pura, se prueba en node sin navegador.
//
// Lo que protege, en orden de importancia:
//
//   1. Que SIN búsqueda no cambie NADA. El caso normal —los 28 negocios, que no
//      están buscando nada— tiene que devolver el mismo arreglo, la misma
//      referencia, sin recorrer ni copiar. Es la sección 1 y es la que hay que
//      mirar primero.
//   2. Que un ítem viejo de `localStorage` —sin `codigo`, sin `color`, sin
//      `caracteristicas`— NO reviente. Después de desplegar, todo carrito a
//      medio armar es exactamente eso.
//   3. Que se encuentre por lo que distingue dos líneas del mismo producto: la
//      talla y el color. Con variantes activas «Camiseta Nike» aparece cinco
//      veces y el nombre no alcanza.
//
//   node scripts/prueba-busqueda-carrito.mjs
// ─────────────────────────────────────────────────────────────────────────────
import {
  normalizar, textoBuscableItem, terminosDeBusqueda, filtrarCarrito,
  MINIMO_PARA_BUSCAR,
} from '../src/utils/carritoBusqueda.js';

let fallos = 0, pasados = 0;
const check = (etiqueta, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (ok) { pasados++; console.log(`  ✅ ${etiqueta}`); }
  else {
    fallos++;
    console.log(`  ❌ ${etiqueta}\n       esperado: ${JSON.stringify(esperado)}\n       real:     ${JSON.stringify(real)}`);
  }
};
const checkTrue = (etiqueta, valor) => check(etiqueta, !!valor, true);
const seccion = (n, t) => console.log(`\n── ${n}. ${t} ${'─'.repeat(Math.max(0, 58 - t.length))}`);

// ── Un carrito de mostrador ──────────────────────────────────────────────────
const CARRITO = [
  // Producto simple, sin variantes.
  { key: 'cant-1', tipo: 'cantidad', nombre: 'Cargador 25W', producto_id: 1,
    codigo: '000123', stock: 40, cantidad: 2 },
  // Mismo producto, dos tallas: lo único que las distingue es el chip.
  { key: 'cant-7-a-3', tipo: 'cantidad', nombre: 'Camiseta Nike', producto_id: 7,
    atributo_id: 3, atributo_label: 'Talla: M', codigo: '000450', stock: 5, cantidad: 1 },
  { key: 'cant-7-a-4', tipo: 'cantidad', nombre: 'Camiseta Nike', producto_id: 7,
    atributo_id: 4, atributo_label: 'Talla: L', codigo: '000451', stock: 3, cantidad: 1 },
  // Variante dentro de una talla.
  { key: 'cant-7-v-9', tipo: 'cantidad', nombre: 'Camiseta Nike', producto_id: 7,
    atributo_id: 4, variante_id: 9, atributo_label: 'Talla: L',
    variante_label: 'Color: Verde', codigo: '000452', stock: 2, cantidad: 1 },
  // Serial con color y características de la unidad.
  { key: '350977', tipo: 'serial', nombre: 'iPhone 11 Pro', imei: '350977112233445',
    serial_id: 88, marca: 'Apple', modelo: '11 Pro', color: 'Gris espacial',
    caracteristicas: { RAM: '4GB', Almacenamiento: '256GB' }, cantidad: 1 },
  // Ítem viejo de localStorage: solo lo que existía antes de esta feature.
  { key: 'cant-99', tipo: 'cantidad', nombre: 'Audífonos rosados', producto_id: 99,
    stock: 10, cantidad: 1 },
];

const claves = (lista) => lista.map((i) => i.key);

// ─────────────────────────────────────────────────────────────────────────────
seccion(1, 'SIN BÚSQUEDA NO CAMBIA NADA (lo que protege a los 28 negocios)');

check('consulta vacía devuelve todo',        claves(filtrarCarrito(CARRITO, '')), claves(CARRITO));
checkTrue('…y es EL MISMO arreglo, no una copia', filtrarCarrito(CARRITO, '') === CARRITO);
checkTrue('solo espacios tampoco filtra',    filtrarCarrito(CARRITO, '   ') === CARRITO);
checkTrue('null/undefined tampoco filtran',  filtrarCarrito(CARRITO, null) === CARRITO
                                          && filtrarCarrito(CARRITO, undefined) === CARRITO);
check('el mínimo para que aparezca la barra es 6', MINIMO_PARA_BUSCAR, 6);

// ─────────────────────────────────────────────────────────────────────────────
seccion(2, 'ÍTEMS VIEJOS DE localStorage: no revientan');

const VIEJO = CARRITO[5];
check('sin codigo/color/caracteristicas se indexa igual', textoBuscableItem(VIEJO), 'audifonos rosados');
check('…y se encuentra por su nombre',      claves(filtrarCarrito(CARRITO, 'rosados')), ['cant-99']);
check('un ítem nulo no tumba la pantalla',  textoBuscableItem(null), '');
check('un ítem vacío tampoco',              textoBuscableItem({}), '');
checkTrue('un carrito con huecos se filtra sin lanzar',
  filtrarCarrito([...CARRITO, null, undefined], 'nike').length === 3);

// ─────────────────────────────────────────────────────────────────────────────
seccion(3, 'TILDES Y MAYÚSCULAS: nadie las escribe en el mostrador');

check('normaliza tildes y mayúsculas', normalizar('  AudÍFonos  '), 'audifonos');
check('«audifonos» encuentra «Audífonos»', claves(filtrarCarrito(CARRITO, 'audifonos')), ['cant-99']);
check('«AUDÍFONOS» también',               claves(filtrarCarrito(CARRITO, 'AUDÍFONOS')), ['cant-99']);
check('la ñ NO es una tilde y se conserva', normalizar('Niño'), 'niño');

// ─────────────────────────────────────────────────────────────────────────────
seccion(4, 'LA TALLA Y EL COLOR: lo único que distingue dos líneas iguales');

check('el nombre solo trae las tres camisetas',
  claves(filtrarCarrito(CARRITO, 'camiseta')), ['cant-7-a-3', 'cant-7-a-4', 'cant-7-v-9']);
check('con la talla baja a dos',
  claves(filtrarCarrito(CARRITO, 'talla: l')), ['cant-7-a-4', 'cant-7-v-9']);
check('con el color llega a una sola',
  claves(filtrarCarrito(CARRITO, 'verde')), ['cant-7-v-9']);
check('la talla M no arrastra la L',
  claves(filtrarCarrito(CARRITO, 'talla: m')), ['cant-7-a-3']);
// El defecto que cazó esta prueba: partiendo «Talla: M» en «talla» y «m», una
// «m» suelta está dentro de «ca-m-iseta» y la búsqueda devolvía las cinco
// líneas. Por eso un término tiene que EMPEZAR una palabra del producto.
check('una letra suelta no se cuela dentro de otra palabra',
  claves(filtrarCarrito(CARRITO, 'm')), ['cant-7-a-3']);
check('los dos puntos dan igual: «talla m» es lo mismo que «talla: m»',
  claves(filtrarCarrito(CARRITO, 'talla m')), claves(filtrarCarrito(CARRITO, 'talla: m')));
check('desde 3 letras sí vale en medio de una palabra (los últimos dígitos del IMEI)',
  claves(filtrarCarrito(CARRITO, '3445')), ['350977']);

// ─────────────────────────────────────────────────────────────────────────────
seccion(5, 'VARIAS PALABRAS: todas, en cualquier orden y en cualquier campo');

check('«nike verde» cruza nombre y variante',
  claves(filtrarCarrito(CARRITO, 'nike verde')), ['cant-7-v-9']);
check('el orden da igual',
  claves(filtrarCarrito(CARRITO, 'verde nike')), ['cant-7-v-9']);
check('un término que no está deja la lista vacía',
  claves(filtrarCarrito(CARRITO, 'nike adidas')), []);
check('espacios de sobra entre términos',
  claves(filtrarCarrito(CARRITO, '  nike    verde  ')), ['cant-7-v-9']);
check('la consulta se parte en términos', terminosDeBusqueda(' Nike   Verde '), ['nike', 'verde']);

// ─────────────────────────────────────────────────────────────────────────────
seccion(6, 'EL SERIAL: IMEI, marca, modelo, color y características');

const SERIAL = CARRITO[4];
check('por IMEI completo',      claves(filtrarCarrito(CARRITO, '350977112233445')), ['350977']);
check('por un pedazo del IMEI', claves(filtrarCarrito(CARRITO, '112233')),          ['350977']);
check('por marca',              claves(filtrarCarrito(CARRITO, 'apple')),           ['350977']);
check('por color de la unidad', claves(filtrarCarrito(CARRITO, 'gris')),            ['350977']);
check('por el VALOR de una característica', claves(filtrarCarrito(CARRITO, '256gb')), ['350977']);
check('por la CLAVE de una característica (no me acuerdo de cuánta RAM)',
  claves(filtrarCarrito(CARRITO, 'ram')), ['350977']);
checkTrue('el texto indexado incluye clave y valor',
  textoBuscableItem(SERIAL).includes('almacenamiento 256gb'));

// ─────────────────────────────────────────────────────────────────────────────
seccion(7, 'EL CÓDIGO DE LA ETIQUETA: lo que está impreso en la caja');

check('por código exacto', claves(filtrarCarrito(CARRITO, '000452')), ['cant-7-v-9']);
check('el código del atributo no arrastra al del producto',
  claves(filtrarCarrito(CARRITO, '000450')), ['cant-7-a-3']);

// ─────────────────────────────────────────────────────────────────────────────
seccion(8, 'NO SE INDEXA LO QUE NO SE VE');

// El precio, el costo y el stock NO entran: buscar «40» tiene que traer lo que
// diga 40 en su nombre o su código, no todo lo que valga $40.000 ni todo lo que
// tenga 40 unidades. Y el COSTO, además, es el dato que `costos_solo_admin`
// existe para esconder: indexarlo lo dejaría adivinable desde el buscador.
const conPrecio = { key: 'x', nombre: 'Funda', precio: 40000, precioFinal: 40000,
                    costo: 12000, stock: 40, cantidad: 1 };
check('ni precio, ni costo, ni stock', textoBuscableItem(conPrecio), 'funda');
check('la key interna tampoco',        textoBuscableItem({ key: 'cant-7-v-9', nombre: 'Funda' }), 'funda');

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(64)}`);
console.log(fallos === 0
  ? `✅ TODO BIEN — ${pasados} verificaciones`
  : `❌ ${fallos} FALLARON de ${pasados + fallos}`);
process.exit(fallos === 0 ? 0 : 1);
