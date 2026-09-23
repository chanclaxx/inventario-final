// ─────────────────────────────────────────────────────────────────────────────
// LISTAS DE PRECIOS — N precios de venta por producto y el vendedor elige cual
//
// Lógica pura, sin base de datos: lo que se prueba aquí es el parseo de la
// config, el saneado de lo que se escribe y la aritmética de qué precio le toca
// a cada ítem del carrito.
//
// Lo que protege, en orden de importancia:
//
//   1. QUE CON LA FEATURE APAGADA NO CAMBIE NADA. Los 28 negocios de producción
//      no la van a activar, y para ellos el carrito tiene que comportarse
//      exactamente igual que antes de que esto existiera. Es la sección 1 y es
//      la que hay que mirar primero.
//   2. Que un producto SIN precio en la lista elegida NUNCA salga en $0. Cae a
//      su precio de siempre y queda marcado. Una lista a medio llenar es el
//      estado normal durante las primeras semanas, y un $0 en el mostrador es
//      dinero regalado.
//   3. Que las REGLAS DE FORMA no se separen entre backend y frontend. Están
//      duplicadas a mano porque el frontend no puede importar del backend — es
//      exactamente la situación que ya se les fue de las manos con las dos
//      listas de módulos, y nadie se enteró hasta que un usuario perdió un
//      permiso en producción.
//
//   node scripts/pruebas-red-interna/45-listas-precios.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI  = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ  = path.resolve(AQUI, '../..');

const back = require(path.resolve(RAIZ, 'src/utils/listasPrecios.util.js'));
const front = await import(
  'file://' + path.resolve(RAIZ, '../frontend/src/utils/listasPrecios.js').replace(/\\/g, '/')
);

let fallos = 0, pasados = 0;
const check = (etiqueta, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (ok) { pasados++; console.log(`  ✓ ${etiqueta}`); }
  else {
    fallos++;
    console.log(`  ✗ ${etiqueta}\n      esperado ${JSON.stringify(esperado)}\n      real     ${JSON.stringify(real)}`);
  }
};
const checkTrue = (etiqueta, valor) => check(etiqueta, !!valor, true);
const lanza = (etiqueta, fn) => {
  try { fn(); fallos++; console.log(`  ✗ ${etiqueta} — no lanzó`); }
  catch { pasados++; console.log(`  ✓ ${etiqueta}`); }
};
const noLanza = (etiqueta, fn) => {
  try { fn(); pasados++; console.log(`  ✓ ${etiqueta}`); }
  catch (e) { fallos++; console.log(`  ✗ ${etiqueta} — lanzó: ${e.message || e}`); }
};
const seccion = (n, t) => console.log(`\n── ${n}. ${t} ${'─'.repeat(Math.max(0, 56 - t.length))}`);

const LISTAS = JSON.stringify([
  { id: 'pasamano', nombre: '1 Pasamano',    color: 'blue'   },
  { id: 'mayor',    nombre: 'Al por mayor',  color: 'green'  },
  { id: 'final',    nombre: 'Cliente final', color: 'purple' },
]);
const IDS = ['pasamano', 'mayor', 'final'];

// ─────────────────────────────────────────────────────────────────────────────
seccion(1, 'FEATURE APAGADA: NADA CAMBIA (protege a los 28 negocios)');

check('sin la clave en config, apagada',
  front.leerConfigListas({}).activo, false);
check('sin la clave, cero listas',
  front.leerConfigListas({}).listas, []);
check('config undefined tampoco rompe',
  front.leerConfigListas(undefined).activo, false);
check('encendida pero SIN listas configuradas → sigue apagada',
  front.leerConfigListas({ listas_precios_activo: '1' }).activo, false);
check('con listas pero el flag en 0 → apagada',
  front.leerConfigListas({ listas_precios_activo: '0', listas_precios_lista: LISTAS }).activo, false);
check('encendida y con listas → activa',
  front.leerConfigListas({ listas_precios_activo: '1', listas_precios_lista: LISTAS }).activo, true);

// Un ítem sin `precios` es TODO ítem de los negocios que no usan esto, y todo
// ítem que lleve días en localStorage.
check('un ítem sin precios conserva su precio de siempre',
  front.resolverPrecioItem({ precio: 12000 }, 'mayor'), { precio: 12000, deLista: false });
check('…y sin lista elegida, también',
  front.resolverPrecioItem({ precio: 12000, precios: { mayor: 9000 } }, null),
  { precio: 12000, deLista: false });

// ─────────────────────────────────────────────────────────────────────────────
seccion(2, 'NUNCA $0: el producto que la lista no menciona');

const ITEM = { precio: 12000, precios: { mayor: 9000 } };
check('en la lista que sí lo tiene, su precio',
  front.resolverPrecioItem(ITEM, 'mayor'), { precio: 9000, deLista: true });
check('en la que NO, cae al precio de siempre y se marca',
  front.resolverPrecioItem(ITEM, 'final'), { precio: 12000, deLista: false });
check('precioEnLista devuelve null, no 0',
  front.precioEnLista({ mayor: 9000 }, 'final'), null);
check('un cero guardado se trata como ausente',
  front.precioEnLista({ final: 0 }, 'final'), null);
check('un negativo también',
  front.precioEnLista({ final: -500 }, 'final'), null);
check('sin precios y sin precio base, 0 pero nunca NaN',
  front.resolverPrecioItem({}, 'mayor'), { precio: 0, deLista: false });

check('contarSinPrecio cuenta los que se van a cobrar al precio normal',
  front.contarSinPrecio(
    [{ precios: { mayor: 1 } }, { precios: { final: 1 } }, {}],
    'mayor'
  ), 2);
check('sin lista elegida no cuenta ninguno', front.contarSinPrecio([{}, {}], null), 0);

// ─────────────────────────────────────────────────────────────────────────────
seccion(3, 'HERENCIA: la talla hereda lo que no sobrescribe');

const PRODUCTO = { precios: { pasamano: 7000, mayor: 5800, final: 9000 } };
const TALLA    = { precios: { mayor: 5000 } };
const VARIANTE = { precios: { final: 9500 } };

check('la talla sobrescribe SOLO su clave y hereda las otras dos',
  front.preciosDeNodo(PRODUCTO, TALLA),
  { pasamano: 7000, mayor: 5000, final: 9000 });
check('y la variante encima de las dos',
  front.preciosDeNodo(PRODUCTO, TALLA, VARIANTE),
  { pasamano: 7000, mayor: 5000, final: 9500 });
check('un nivel sin precios no borra lo heredado',
  front.preciosDeNodo(PRODUCTO, {}, {}),
  { pasamano: 7000, mayor: 5800, final: 9000 });
check('sin ningún precio en ningún nivel, null (no {})',
  front.preciosDeNodo({}, {}, null), null);
// Este es el bug que la mezcla por clave existe para evitar: con un `||` sobre
// el objeto entero, la talla que solo tiene precio mayorista dejaría al
// vendedor sin los otros dos justo en esa talla.
checkTrue('la mezcla NO es "gana el objeto entero"',
  front.preciosDeNodo(PRODUCTO, TALLA).pasamano === 7000);

// ─────────────────────────────────────────────────────────────────────────────
seccion(4, 'LO QUE LLEGA DE LA BD Y DE localStorage');

// node-postgres no castea NUMERIC a number: "7000.00" viaja como STRING. Es el
// mismo detalle que convirtió un precio en 700.000 al limpiarlo a ciegas.
check('un NUMERIC como string se normaliza bien',
  front.normalizarPrecios({ mayor: '7000.00' }), { mayor: 7000 });
check('un jsonb que llega como texto se parsea',
  front.normalizarPrecios('{"mayor": 5800}'), { mayor: 5800 });
check('JSON corrupto degrada a null, no lanza',
  front.normalizarPrecios('{roto'), null);
check('un arreglo no es un mapa de precios',
  front.normalizarPrecios([1, 2, 3]), null);
check('null y undefined dan null',
  [front.normalizarPrecios(null), front.normalizarPrecios(undefined)], [null, null]);
check('se descarta lo que no es número', front.normalizarPrecios({ a: 'x', b: 100 }), { b: 100 });

// ─────────────────────────────────────────────────────────────────────────────
seccion(5, 'SANEADO AL ESCRIBIR (backend)');

check('solo se guardan las listas que existen hoy',
  back.sanearPrecios({ mayor: 5000, borrada: 999 }, IDS), { mayor: 5000 });
check('sin ninguna clave válida se guarda NULL, no {}',
  back.sanearPrecios({ borrada: 999 }, IDS), null);
check('un objeto vacío también es NULL', back.sanearPrecios({}, IDS), null);
check('los ceros y negativos se OMITEN, no se guardan',
  back.sanearPrecios({ mayor: 0, final: -1, pasamano: 7000 }, IDS), { pasamano: 7000 });
check('se redondea a peso', back.sanearPrecios({ mayor: 5000.6 }, IDS), { mayor: 5001 });
check('un precio absurdo se descarta', back.sanearPrecios({ mayor: 1e12 }, IDS), null);
check('acepta el mapa como string', back.sanearPrecios('{"mayor":5000}', IDS), { mayor: 5000 });
check('basura da null', back.sanearPrecios('{roto', IDS), null);

// ─────────────────────────────────────────────────────────────────────────────
seccion(6, 'VALIDACIÓN AL GUARDAR LA CONFIG');

noLanza('una lista bien formada pasa', () => back.validarListas(LISTAS));
lanza('JSON inválido',     () => back.validarListas('{roto'));
lanza('no es un arreglo',  () => back.validarListas('{"a":1}'));
lanza('sin nombre',        () => back.validarListas('[{"id":"a","nombre":"  "}]'));
lanza('sin id',            () => back.validarListas('[{"nombre":"Mayor"}]'));
lanza('ids repetidos',     () => back.validarListas('[{"id":"a","nombre":"X"},{"id":"a","nombre":"Y"}]'));
// Dos chips idénticos en el carrito: el vendedor no tiene forma de saber cuál toca.
lanza('nombres repetidos', () => back.validarListas('[{"id":"a","nombre":"Mayor"},{"id":"b","nombre":"mayor"}]'));
lanza('nombre larguísimo',
  () => back.validarListas(JSON.stringify([{ id: 'a', nombre: 'x'.repeat(back.MAX_NOMBRE + 1) }])));
lanza('más listas que el tope', () => back.validarListas(JSON.stringify(
  Array.from({ length: back.MAX_LISTAS + 1 }, (_, i) => ({ id: `l${i}`, nombre: `L${i}` }))
)));

// Al LEER, en cambio, nada puede lanzar: una config corrupta no puede tumbar el
// carrito de un mostrador a media venta.
check('parsear una config corrupta degrada a []', back.parsearListas('{roto'), []);
check('…y en el frontend igual',                  front.parsearListas('{roto'), []);
check('ids duplicados: gana el primero',
  back.parsearListas('[{"id":"a","nombre":"Uno"},{"id":"a","nombre":"Dos"}]').map((l) => l.nombre),
  ['Uno']);

// ─────────────────────────────────────────────────────────────────────────────
seccion(7, 'LAS DOS COPIAS DEL UTIL NO SE PUEDEN SEPARAR');

// El frontend no puede importar del backend, así que las reglas de forma están
// escritas dos veces. Esta sección es lo único que evita que se separen — es
// literalmente lo que ya pasó con las dos listas de módulos.
check('MAX_LISTAS coincide', front.MAX_LISTAS, back.MAX_LISTAS);
check('MAX_NOMBRE coincide', front.MAX_NOMBRE, back.MAX_NOMBRE);
check('MAX_PRECIO coincide', front.MAX_PRECIO, back.MAX_PRECIO);
check('los colores coinciden', front.COLORES, back.COLORES);

// Y no solo las constantes: las dos funciones de parseo tienen que dar lo mismo,
// porque una guarda y la otra pinta.
for (const caso of [
  LISTAS,
  '[]',
  '{roto',
  '[{"id":"a","nombre":"  espacios  "}]',
  '[{"nombre":"Sin id"}]',
  '[{"id":"a","nombre":"X","color":"inventado"}]',
  JSON.stringify(Array.from({ length: 25 }, (_, i) => ({ id: `l${i}`, nombre: `L${i}` }))),
]) {
  check(`parsear igual en los dos lados: ${caso.slice(0, 38)}`,
    front.parsearListas(caso), back.parsearListas(caso));
}

// ─────────────────────────────────────────────────────────────────────────────
seccion(8, 'EXCLUYENTE CON LAS TARIFAS (lo vigila saveConfig)');

const cfgSrc = readFileSync(path.resolve(RAIZ, 'src/modules/config/config.service.js'), 'utf8');
checkTrue('saveConfig rechaza encender listas con tarifas activas',
  /listas_precios_activo === '1'[\s\S]{0,200}tarifas_activo/.test(cfgSrc));
checkTrue('…y también al revés',
  /tarifas_activo === '1'[\s\S]{0,200}listas_precios_activo/.test(cfgSrc));
checkTrue('valida la lista con el MISMO util que la lee',
  /listasPrecios\.validarListas/.test(cfgSrc));

// ─────────────────────────────────────────────────────────────────────────────
seccion(9, 'LA COLUMNA ES OPCIONAL: sin migración, el inventario sigue igual');

const columnas = readFileSync(path.resolve(RAIZ, 'src/config/columnas.js'), 'utf8');
checkTrue('hay bandera propia para las listas de precios',
  /hayListasPrecios/.test(columnas));
// Se exigen las CUATRO tablas: con el producto y sin el atributo, un catálogo
// por variantes tendría precios arriba y ninguno en la talla, que es donde se
// vende de verdad.
checkTrue('se exigen las cuatro tablas',
  /TABLAS_LISTAS_PRECIOS[\s\S]{0,200}productos_cantidad[\s\S]{0,200}atributos_producto[\s\S]{0,200}variantes_atributo[\s\S]{0,200}productos_serial/.test(columnas));
checkTrue('arranca apagada', /let _listasPreciosDisponible = false/.test(columnas));

for (const [archivo, alias] of [
  ['src/modules/productos/productosCantidad.repository.js', 'pc'],
  ['src/modules/productos/productosSerial.repository.js',   'ps'],
  ['src/modules/variantes-producto/variantes-producto.repository.js', 'ap'],
]) {
  const src = readFileSync(path.resolve(RAIZ, archivo), 'utf8');
  checkTrue(`${archivo.split('/').pop()} solo pide la columna si existe`,
    /hayListasPrecios\(\)\s*\?/.test(src) && src.includes(`selPrecios('${alias}')`));
}

// El escaneo mete el nodo DERECHO al carrito, así que su SQL tiene que resolver
// la herencia — y con el `||` de jsonb, que mezcla clave por clave, no con un
// COALESCE que elegiría un objeto entero y tiraría los otros precios.
//
// La expresión vive en `utils/listasPreciosSql.util.js` desde sep-2026: la
// comparten el escaneo hacia el carrito y el DESPACHO de la red interna, que
// manda todo un envío al precio de una lista. Una segunda copia se habría
// separado, como ya pasó con las dos listas de módulos.
const sqlListas = readFileSync(path.resolve(RAIZ, 'src/utils/listasPreciosSql.util.js'), 'utf8');
checkTrue('el escaneo hereda con el || de jsonb, no con COALESCE del objeto',
  /COALESCE\(pc\.precios, '\{\}'::jsonb\) \|\| COALESCE\(ap\.precios/.test(sqlListas));
checkTrue('…y sin la columna no la nombra',
  /hayListasPrecios\(\)/.test(sqlListas) && /NULL::jsonb/.test(sqlListas));

const busqueda = readFileSync(path.resolve(RAIZ, 'src/modules/busqueda/busqueda.repository.js'), 'utf8');
checkTrue('el escaneo usa esa MISMA expresión, no una copia',
  /listasPreciosSql\.util/.test(busqueda));
checkTrue('las tres ramas del UNION traen la columna o ninguna',
  (busqueda.match(/selPreciosNodo\('/g) || []).length === 3);

// El despacho pide los mismos precios: sin ellos, mandar el envío al precio de
// «Al por mayor» obligaría a teclear línea por línea, que es lo que se quitó.
const redRepo = readFileSync(path.resolve(RAIZ, 'src/modules/red-interna/redInterna.repository.js'), 'utf8');
checkTrue('el despacho lee los precios con la misma expresión',
  /listasPreciosSql\.util/.test(redRepo) && (redRepo.match(/selPreciosNodo\('/g) || []).length >= 6);

// La red interna: el local nace con los precios de la bodega como punto de
// partida. Si este INSERT nombrara la columna sin la guarda, lo que se caería no
// sería una pantalla nueva sino DESPACHAR, que ya está en producción.
const refs = readFileSync(path.resolve(RAIZ, 'src/modules/red-interna/redInterna.referencias.js'), 'utf8');
checkTrue('la red interna copia los precios al crear la referencia del local',
  /COL_PRECIOS\(\)/.test(refs) && /origen\.precios/.test(refs));
checkTrue('…y solo si la columna existe',
  /hayListasPrecios\(\) \? ', precios' : ''/.test(refs));

// ─────────────────────────────────────────────────────────────────────────────
seccion(10, 'EL PERMISO: por defecto, solo el administrador');

const roleSrc = readFileSync(path.resolve(RAIZ, 'src/middlewares/role.middleware.js'), 'utf8');
checkTrue('existe el middleware', /requirePermisoPreciosLista/.test(roleSrc));
checkTrue('admin_negocio pasa siempre',
  /requirePermisoPreciosLista[\s\S]{0,400}rol === 'admin_negocio'\) return next\(\)/.test(roleSrc));
// La clave nueva, no la columna entera: un `=== true` sobre
// `permisos_edicion_productos` le quitaría a todo el mundo lo que ya tenía.
checkTrue('mira SU clave, no la columna entera',
  /puede_editar_precios_lista === true/.test(roleSrc));
// Y no se cuelga de la casilla «Precio», que viene encendida por defecto: eso le
// habría dado los precios de lista a todos los supervisores el día del despliegue.
checkTrue('NO se cuelga de campos.includes("precio")',
  !/requirePermisoPreciosLista[\s\S]{0,500}campos/.test(roleSrc));

const rutas = readFileSync(path.resolve(RAIZ, 'src/modules/listas-precios/listasPrecios.routes.js'), 'utf8');
checkTrue('escribir exige el permiso', /put\('\/nodos',\s*requirePermisoPreciosLista/.test(rutas));
// Leer NO: son precios de VENTA y el vendedor tiene que verlos para cobrarlos.
checkTrue('leer va con el inventario, no con el permiso de escritura',
  /get\('\/producto\/:productoId',\s*requireNivel\('vendedor'\)/.test(rutas));

// ─────────────────────────────────────────────────────────────────────────────
seccion(11, 'EL CASO REAL DEL CLIENTE (su catálogo, sus tres listas)');

// Fila real de su Excel: correa con costo 4.600 y tres precios curados a mano.
// El punto de la sección: una tarifa porcentual NO puede reproducir esto —el
// markup de las tres columnas es 52%, 26% y 96%— y además hay productos sin
// costo, a los que una tarifa no podría ponerles precio ninguno.
const CORREA = { precio: 9000, precios: { pasamano: 7000, mayor: 5800, final: 9000 } };
check('pasamano',      front.resolverPrecioItem(CORREA, 'pasamano'), { precio: 7000, deLista: true });
check('al por mayor',  front.resolverPrecioItem(CORREA, 'mayor'),    { precio: 5800, deLista: true });
check('cliente final', front.resolverPrecioItem(CORREA, 'final'),    { precio: 9000, deLista: true });

// Un producto SIN costo registrado (106 de sus 473) sí puede tener precio aquí.
const SIN_COSTO = { precio: 4000, costo: null, precios: { mayor: 3100 } };
check('un producto sin costo también tiene precio de lista',
  front.resolverPrecioItem(SIN_COSTO, 'mayor'), { precio: 3100, deLista: true });

// Y el negocio puede vender por debajo del costo si así lo decide: la lista no
// mira el costo para nada, así que no hay nada que "corregir" en silencio.
const BAJO_COSTO = { precio: 10000, costo: 12000, precios: { mayor: 9000 } };
check('la lista no corrige un precio por debajo del costo',
  front.resolverPrecioItem(BAJO_COSTO, 'mayor').precio, 9000);

// ─────────────────────────────────────────────────────────────────────────────
seccion(12, 'EXCEL: leer un precio como lo escribe la gente');

const excel = require(path.resolve(RAIZ, 'src/modules/listas-precios/listasPrecios.excel.js'));

check('un número llano',            excel.leerPrecio(12500),          12500);
check('con punto de miles',         excel.leerPrecio('12.500'),       12500);
check('con signo y espacio',        excel.leerPrecio('$ 12.500'),     12500);
check('con decimales por coma',     excel.leerPrecio('12500,40'),     12500);
check('con miles Y decimales',      excel.leerPrecio('1.250.000,40'), 1250000);
// Se redondea al peso, como todo el sistema: medio peso sube.
check('medio peso sube',            excel.leerPrecio('1.250.000,50'), 1250001);
// Vacío y cero son LO MISMO: "sin precio en esta lista". Un producto a $0 en el
// mostrador es siempre un error de captura, nunca una decisión.
check('vacío es null',              excel.leerPrecio(''),   null);
check('cero también es null',       excel.leerPrecio(0),    null);
check('null es null',               excel.leerPrecio(null), null);
// `undefined` = "hay algo escrito que no entiendo". Se reporta, no se adivina.
check('texto se reporta',           excel.leerPrecio('barato'), undefined);
check('negativo se reporta',        excel.leerPrecio(-500),     undefined);
check('absurdo se reporta',         excel.leerPrecio(1e12),     undefined);

// ─────────────────────────────────────────────────────────────────────────────
seccion(13, 'EXCEL: el token hace EXACTO el viaje de vuelta');

check('token de producto',  excel.leerToken('p123'), { nivel: 'producto', id: 123 });
check('token de atributo',  excel.leerToken('a45'),  { nivel: 'atributo', id: 45  });
check('token de variante',  excel.leerToken('V9'),   { nivel: 'variante', id: 9   });
check('token de serial',    excel.leerToken('s7'),   { nivel: 'serial',   id: 7   });
check('vacío no es token',  excel.leerToken(''),     null);
check('basura no es token', excel.leerToken('x12'),  null);
check('sin número tampoco', excel.leerToken('p'),    null);

// ─────────────────────────────────────────────────────────────────────────────
seccion(14, 'EXCEL: comparar precios sin que el orden de claves mienta');

// EL FALLO QUE CAZÓ ESTA PRUEBA. Postgres devuelve un jsonb con SUS claves en SU
// orden (por longitud y luego bytes: {final, mayor, pasamano}) mientras que el
// mapa nuevo se arma en el orden en que el negocio configuró las listas
// ({pasamano, mayor, final}). Comparando con JSON.stringify a secas, el informe
// decía «438 cambios» sobre un archivo con CUATRO precios tocados — y de paso
// habría reescrito 1.300 filas que nadie pidió tocar.
const DESDE_PG    = { final: 9000, mayor: 5800, pasamano: 7000 };
const DESDE_EXCEL = { pasamano: 7000, mayor: 5800, final: 9000 };
checkTrue('mismo contenido en otro orden = SIN cambio',
  excel.canonico(DESDE_PG) === excel.canonico(DESDE_EXCEL));
checkTrue('…y con JSON.stringify a secas habría dicho que cambió',
  JSON.stringify(DESDE_PG) !== JSON.stringify(DESDE_EXCEL));
checkTrue('un precio distinto SÍ es un cambio',
  excel.canonico({ mayor: 5800 }) !== excel.canonico({ mayor: 5900 }));
checkTrue('una lista de más SÍ es un cambio',
  excel.canonico({ mayor: 5800 }) !== excel.canonico({ mayor: 5800, final: 9000 }));
check('null y undefined se comparan sin reventar',
  [excel.canonico(null), excel.canonico(undefined)], ['null', 'null']);
// Un NUMERIC de Postgres llega como string: "5800" y 5800 son el mismo precio.
checkTrue('string y número son el mismo precio',
  excel.canonico({ mayor: '5800' }) === excel.canonico({ mayor: 5800 }));

// ─────────────────────────────────────────────────────────────────────────────
seccion(15, 'EXCEL: las columnas fijas son un contrato entre las dos puntas');

const plantilla = require(path.resolve(RAIZ, 'src/modules/listas-precios/listasPrecios.plantilla.js'));
check('las columnas fijas, en orden',
  plantilla.COLUMNAS_FIJAS, ['ID', 'Producto', 'Variante', 'Nivel', 'Código', 'Precio actual']);
// «Detalle» es como se llamaba «Variante» hasta sep-2026. El lector tiene que
// seguir aceptándola: la gente guarda los archivos que bajó, y si su propia
// columna saliera como «se ignora» el informe estaría acusando al usuario de un
// cambio que hicimos nosotros.
checkTrue('el lector sigue aceptando el nombre viejo de la columna',
  plantilla.COLUMNAS_CONOCIDAS.includes('Detalle')
  && plantilla.COLUMNAS_FIJAS.every((c) => plantilla.COLUMNAS_CONOCIDAS.includes(c)));
// El lector las IMPORTA del generador en vez de repetirlas: copiadas, un archivo
// se descargaría bien y no se podría volver a subir.
const excelSrc = readFileSync(path.resolve(RAIZ, 'src/modules/listas-precios/listasPrecios.excel.js'), 'utf8');
checkTrue('el lector importa las columnas del generador',
  excelSrc.includes("COLUMNAS_CONOCIDAS } = require('./listasPrecios.plantilla')"));
checkTrue('…y lee la columna de variante con los dos nombres',
  /fila\.Variante \?\? fila\.Detalle/.test(excelSrc));

// Las tallas entran por defecto: es lo que se reportó desde producción («la
// plantilla descarga los productos pero no las variantes»).
const repoSrc = readFileSync(path.resolve(RAIZ, 'src/modules/listas-precios/listasPrecios.repository.js'), 'utf8');
checkTrue('la plantilla trae las tallas por defecto',
  /incluirVariantes = true/.test(repoSrc));
checkTrue('…y las referencias con IMEI también',
  /FROM productos_serial ps/.test(repoSrc));

const svcSrc = readFileSync(path.resolve(RAIZ, 'src/modules/listas-precios/listasPrecios.service.js'), 'utf8');
// Analizar y aplicar salen de la MISMA resolución: un validador paralelo se
// desincroniza del importador y acaba mintiendo (la regla de importacion/).
checkTrue('analizar y aplicar comparten la resolución',
  /const analizarExcel[\s\S]{0,200}_resolverArchivo/.test(svcSrc)
  && /const importarExcel[\s\S]{0,200}_resolverArchivo/.test(svcSrc));
checkTrue('aplicar va en UNA transacción',
  /importarExcel[\s\S]{0,700}BEGIN[\s\S]{0,700}COMMIT/.test(svcSrc));
// Quién puede escribir qué sucursal lo decide el service, no la pantalla.
checkTrue('el alcance por sucursal se acota en el backend',
  svcSrc.includes('_sucursalesPermitidas') && svcSrc.includes('No tienes acceso a las sucursales'));

const rutasSrc = readFileSync(path.resolve(RAIZ, 'src/modules/listas-precios/listasPrecios.routes.js'), 'utf8');
for (const ruta of ['plantilla', 'analizar', 'importar']) {
  checkTrue(`/${ruta} exige el permiso de precios`,
    new RegExp(`'/${ruta}',\\s*requirePermisoPreciosLista`).test(rutasSrc));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(64)}`);
console.log(fallos === 0
  ? `✅ TODO BIEN — ${pasados} verificaciones`
  : `❌ ${fallos} FALLARON de ${pasados + fallos}`);
process.exit(fallos === 0 ? 0 : 1);
