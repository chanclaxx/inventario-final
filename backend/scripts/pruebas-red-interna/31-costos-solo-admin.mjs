// ─────────────────────────────────────────────────────────────────────────────
// OCULTAR LOS COSTOS A QUIEN NO ES ADMINISTRADOR
//
// El costo de compra no se pintaba en las tarjetas del inventario, pero SÍ
// viajaba en el JSON: `GET /productos-cantidad` mandaba `costo_unitario` y
// `proveedor_nombre`, el listado de seriales mandaba `SELECT s.*` entero, el
// árbol de variantes mandaba el costo de los tres niveles, y la procedencia
// mandaba proveedor y precio de cada lote. Cualquiera con la consola del
// navegador abierta los veía.
//
// Lo que esta prueba cuida, en orden de importancia:
//
//   1. QUE NO SE DAÑE NADIE. La base la comparten 28 negocios que hoy operan
//      con los costos a la vista. Con el candado apagado —el default, y lo que
//      tienen todos— la respuesta tiene que salir BYTE POR BYTE igual que
//      antes. La sección 1 falla si alguien invierte el default.
//   2. Que con el candado puesto el costo no viaje, ni siquiera anidado dentro
//      de las variantes de un atributo.
//   3. Que la excepción por usuario siga funcionando: quien tiene concedido el
//      campo «Costo» en Ajustes → Usuarios lo sigue viendo.
//   4. Que las puertas que YA estaban cerradas (búsqueda por IMEI, exportación)
//      no se hayan aflojado de paso — el helper solo puede quitar.
//
// No necesita base de datos: el recorte es una función pura sobre el objeto de
// respuesta, y el permiso se decide con el JWT más una clave de configuración.
//
//   node scripts/pruebas-red-interna/31-costos-solo-admin.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');

let fallos = 0, pasados = 0;
const checkEq = (etiqueta, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (ok) { pasados++; console.log(`  ✓ ${etiqueta}`); }
  else    { fallos++;  console.log(`  ✗ ${etiqueta}\n      dio      ${JSON.stringify(real)}\n      esperaba ${JSON.stringify(esperado)}`); }
};

const costos = require(path.join(RAIZ, 'src/utils/costos.util'));

// ── Usuarios de prueba ──────────────────────────────────────────────────────
const admin      = { rol: 'admin_negocio', negocio_id: 1 };
const supervisor = { rol: 'supervisor', negocio_id: 1, permisos_edicion_productos: { puede_editar: true, campos: ['nombre', 'precio'] } };
const vendedor   = { rol: 'vendedor',   negocio_id: 1, permisos_edicion_productos: null };
// A este el negocio le concedió el campo «Costo» a propósito.
const comprador  = { rol: 'supervisor', negocio_id: 1, permisos_edicion_productos: { puede_editar: true, campos: ['nombre', 'precio', 'costo'] } };

const APAGADO = {};                            // como está hoy todo negocio
const PUESTO  = { costos_solo_admin: '1' };

const ver = (user, cfg) => costos.puedeVerCostosCon(user, cfg);

// ── Respuestas de ejemplo, con la forma real de cada endpoint ───────────────
const productoCantidad = () => ({
  id: 7, nombre: 'Cargador tipo C', stock: 40, precio: '25000.00',
  costo_unitario: '14500.00', proveedor_id: 3, proveedor_nombre: 'Distribuidora Sur',
  linea_nombre: 'Accesorios', stock_bajo: false,
});

const serial = () => ({
  id: 91, imei: '350000000000001', vendido: false, precio: '1800000.00',
  costo_compra: '1450000.00', proveedor_id: 3, color: 'Negro',
});

// El árbol es el caso difícil: el costo vive en los TRES niveles y las
// variantes van ANIDADAS dentro de cada atributo.
const arbol = () => ([{
  id: 11, valor: '38MM', stock: 12, precio: null, costo_unitario: '9000.00',
  variantes: [
    { id: 21, valor: 'Negro', stock: 7, costo_unitario: '9200.00' },
    { id: 22, valor: 'Blanco', stock: 5, costo_unitario: null },
  ],
}]);

console.log('\n1. Candado APAGADO — el default: nada cambia para los 28 negocios');
checkEq('★ supervisor ve costos',            ver(supervisor, APAGADO), true);
checkEq('★ vendedor ve costos',              ver(vendedor,   APAGADO), true);
checkEq('admin ve costos',                   ver(admin,      APAGADO), true);
// La composición real que corre en el controlador: si puede ver, no se toca.
const comoEnElControlador = (user, cfg, dato, opciones) =>
  (costos.puedeVerCostosCon(user, cfg) ? dato : costos.recortar(dato, opciones));
checkEq('★ la respuesta del inventario sale intacta',
  comoEnElControlador(vendedor, APAGADO, productoCantidad()), productoCantidad());
checkEq('★ el árbol de variantes sale intacto',
  comoEnElControlador(supervisor, APAGADO, arbol(), { anidados: ['variantes'] }), arbol());
checkEq('★ el serial sale intacto',
  comoEnElControlador(vendedor, APAGADO, serial()), serial());
// La clave puesta en '0' explícito es lo mismo que ausente.
checkEq('la clave en "0" es igual a ausente', ver(vendedor, { costos_solo_admin: '0' }), true);
// Y un valor basura tampoco enciende nada por accidente.
checkEq('un valor inesperado no enciende el candado', ver(vendedor, { costos_solo_admin: 'true' }), true);

console.log('\n2. Candado PUESTO — quién ve y quién no');
checkEq('admin sigue viendo',                       ver(admin,      PUESTO), true);
checkEq('★ supervisor deja de ver',                 ver(supervisor, PUESTO), false);
checkEq('★ vendedor deja de ver',                   ver(vendedor,   PUESTO), false);
checkEq('★ quien tiene concedido el campo Costo sí ve', ver(comprador, PUESTO), true);
checkEq('sin usuario, no',                          ver(undefined,  PUESTO), false);
// Un usuario con permiso de edición pero sin el campo costo no cuela.
checkEq('permiso de edición no basta',
  ver({ rol: 'vendedor', negocio_id: 1, permisos_edicion_productos: { puede_editar: true, campos: [] } }, PUESTO), false);

console.log('\n3. El recorte: lista de inventario');
const cant = costos.recortar(productoCantidad());
checkEq('★ el costo se va',        cant.costo_unitario, null);
checkEq('★ el proveedor se va',    cant.proveedor_nombre, null);
checkEq('el id del proveedor también', cant.proveedor_id, null);
checkEq('★ el PRECIO DE VENTA se queda', cant.precio, '25000.00');
checkEq('el stock se queda',       cant.stock, 40);
checkEq('el nombre se queda',      cant.nombre, 'Cargador tipo C');
checkEq('la línea se queda',       cant.linea_nombre, 'Accesorios');
// Las claves siguen existiendo: se anulan, no se borran. Si desaparecieran,
// cualquier destructuración del frontend rompería en vez de mostrar vacío.
checkEq('★ la clave existe, en null', 'costo_unitario' in cant, true);

console.log('\n4. El recorte: seriales (el SELECT s.* que lo arrastraba todo)');
const s = costos.recortar(serial());
checkEq('★ costo_compra se va',    s.costo_compra, null);
checkEq('proveedor_id se va',      s.proveedor_id, null);
checkEq('el IMEI se queda',        s.imei, '350000000000001');
checkEq('el precio de venta se queda', s.precio, '1800000.00');
checkEq('el color se queda',       s.color, 'Negro');

console.log('\n5. El recorte: árbol de variantes (costo anidado en tres niveles)');
const a = costos.recortar(arbol(), { anidados: ['variantes'] });
checkEq('★ el costo del atributo se va',   a[0].costo_unitario, null);
checkEq('★ el de la variante ANIDADA también', a[0].variantes[0].costo_unitario, null);
checkEq('la segunda variante sigue en null',   a[0].variantes[1].costo_unitario, null);
checkEq('el stock del atributo se queda',  a[0].stock, 12);
checkEq('★ el stock de la variante se queda', a[0].variantes[0].stock, 7);
checkEq('el valor de la variante se queda', a[0].variantes[0].valor, 'Negro');
// Sin `anidados` el nivel de abajo se escaparía: es el error que ya se cometió
// dos veces en este repositorio (código escaneable y remisiones por variante).
const aSinAnidar = costos.recortar(arbol());
checkEq('★ sin `anidados`, la variante SE ESCAPA (por eso la opción existe)',
  aSinAnidar[0].variantes[0].costo_unitario, '9200.00');

console.log('\n6. Nada de lo que ya estaba cerrado se aflojó');
// La búsqueda por IMEI y la exportación son admin-only pase lo que pase. Si
// alguien las pasara por el helper, con el candado APAGADO —el default— le
// abriría los costos a los supervisores de los 28 negocios de golpe.
const busqueda = require(path.join(RAIZ, 'src/modules/busqueda/busqueda.service'));
const exportSvc = require(path.join(RAIZ, 'src/modules/inventario/inventario.export.service'));
const fuenteBusqueda = busqueda.buscarPorIMEI.toString();
checkEq('★ la búsqueda por IMEI sigue decidiendo por rol admin',
  /_esAdmin|admin_negocio/.test(fuenteBusqueda), true);
checkEq('la búsqueda NO pasó a usar el helper permisivo',
  /puedeVerCostos/.test(fuenteBusqueda), false);
checkEq('el módulo de exportación sigue cargando', typeof exportSvc, 'object');

console.log('\n7. El helper no revienta con entradas raras');
checkEq('null pasa de largo',            costos.recortar(null), null);
checkEq('array vacío',                   costos.recortar([]), []);
checkEq('objeto sin claves de costo',    costos.recortar({ a: 1 }), { a: 1 });
checkEq('anidado ausente no estorba',    costos.recortar({ a: 1 }, { anidados: ['variantes'] }), { a: 1 });
checkEq('se puede conservar el proveedor',
  costos.recortar({ costo_unitario: 5, proveedor_nombre: 'X' }, { proveedor: false }),
  { costo_unitario: null, proveedor_nombre: 'X' });

console.log('\n' + '─'.repeat(62));
if (fallos) { console.log(`✗ ${fallos} FALLO(S) de ${fallos + pasados}`); process.exit(1); }
console.log(`✓ TODO OK — ${pasados} verificaciones`);
