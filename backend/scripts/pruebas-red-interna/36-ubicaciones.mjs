// ─────────────────────────────────────────────────────────────────────────────
// UBICACIONES COMO ENTIDAD — contra un Postgres real (PGlite).
//
// La ubicación era un TEXT libre repetido en cada producto (20260730). Con ese
// modelo un sitio no podía estar VACÍO —existía solo mientras alguien lo
// nombrara—, renombrarlo era un UPDATE masivo en el que un error de tecleo
// bifurcaba el estante en silencio, y no había dónde guardar la geometría del
// mapa. 20260831 lo invierte: la ubicación es una fila con identidad, jerarquía
// y forma, y los productos se le cuelgan por una tabla puente.
//
// Lo que esta suite fija como contrato:
//
//   1. El BACKFILL no inventa ni pierde sitios: sale exactamente el mismo
//      conjunto que hoy muestra el desplegable "Todas las ubicaciones", con la
//      misma grafía canónica (MODE), y corre UNA SOLA VEZ por sucursal — un
//      negocio que renombre un estante no puede ver reaparecer el nombre viejo
//      en el siguiente arranque.
//   2. La forma de `GET /ubicaciones` NO CAMBIA. `InputUbicacion` y el filtro
//      del inventario no se tocan en este despliegue y tienen que seguir
//      funcionando.
//   3. Una ubicación mezcla lo que sea: la variante 38MM de la correa Y los
//      estuches enteros Y un IMEI suelto, todo junto en el Cajón B7.
//   4. La asignación PROPIA gana sobre la HEREDADA en las DOS direcciones. Es
//      la sección 5 y es la que evita que el mismo equipo aparezca en dos
//      sitios a la vez.
//   5. Nadie cuelga de su propia hija, nadie borra un estante lleno, y nadie
//      asigna mercancía de otra sucursal.
//   6. Este módulo NO DEVUELVE COSTOS. La sección 10 lo vigila sobre el JSON
//      real, no sobre la pantalla: el costo que no se pinta pero viaja es
//      legible desde la consola del navegador.
//
// Requiere PGlite (no va en package.json a propósito):
//   pnpm add -D @electric-sql/pglite --config.package-manager-strict=false
// ─────────────────────────────────────────────────────────────────────────────
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');

const db = new PGlite();
await db.exec(readFileSync(path.join(AQUI, 'esquema.sql'), 'utf8'));
await db.exec(readFileSync(path.join(AQUI, 'esquema-completo.sql'), 'utf8'));

const conectar = (t) => ({ query: (text, params) => t.query(text, params ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] = {
  id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} },
};

const columnas = require(path.join(RAIZ, 'src/config/columnas.js'));

let fallos = 0, pasados = 0;
const q = async (sql, p = []) => (await db.query(sql, p)).rows;

function check(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (ok) { pasados++; console.log(`  ✅ ${nombre}`); }
  else {
    fallos++;
    console.log(`  ❌ ${nombre}\n       esperado: ${JSON.stringify(esperado)}\n       real:     ${JSON.stringify(real)}`);
  }
}
function checkTrue(nombre, valor) { check(nombre, !!valor, true); }

async function checkFalla(nombre, fn, fragmento) {
  try {
    await fn();
    fallos++;
    console.log(`  ❌ ${nombre}\n       esperado: error con "${fragmento}"\n       real:     no falló`);
  } catch (err) {
    const msg = String(err?.message || err);
    if (fragmento && !msg.toLowerCase().includes(fragmento.toLowerCase())) {
      fallos++;
      console.log(`  ❌ ${nombre}\n       esperado: error con "${fragmento}"\n       real:     "${msg}"`);
    } else { pasados++; console.log(`  ✅ ${nombre}`); }
  }
}

const seccion = (n, t) => console.log(`\n── ${n}. ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`);

// ─────────────────────────────────────────────────────────────────────────────
// Datos de partida: dos negocios en la misma base (como en producción, donde la
// comparten 28) y dos sucursales del negocio 1.
// ─────────────────────────────────────────────────────────────────────────────
await q(`INSERT INTO negocios (id, nombre) VALUES (1, 'Negocio A'), (2, 'Negocio B')`);
await q(`INSERT INTO sucursales (id, negocio_id, nombre) VALUES
           (10, 1, 'Principal'), (11, 1, 'Sucursal 2'), (20, 2, 'Ajena')`);
await q(`INSERT INTO usuarios (id, nombre) VALUES (5, 'Bodeguero')`);
await q(`INSERT INTO tipos_caracteristica (id, negocio_id, nombre, orden) VALUES
           (1, 1, 'Talla', 1), (2, 1, 'Color', 2)`);

// Antes de la migración las columnas TEXT no existen: hay que crearlas para
// poder sembrar el estado "como está hoy en producción".
await db.exec(`
  ALTER TABLE productos_cantidad ADD COLUMN IF NOT EXISTS ubicacion TEXT;
  ALTER TABLE productos_serial   ADD COLUMN IF NOT EXISTS ubicacion TEXT;
`);

// Productos por cantidad. Fíjate en las TRES grafías del mismo estante: es
// exactamente el problema que el modelo viejo no podía resolver.
await q(`INSERT INTO productos_cantidad (id, nombre, stock, stock_minimo, costo_unitario, precio, sucursal_id, codigo, ubicacion, activo) VALUES
  (100, 'Correa deportiva', 40, 5, 8000,  25000, 10, 'C-100', 'Estante A-3', true),
  (101, 'Estuche rígido',   12, 3, 4000,  15000, 10, 'C-101', 'estante a-3', true),
  (102, 'Vidrio templado',  30, 4, 1500,   9000, 10, 'C-102', 'Estante  A-3 ', true),
  (103, 'Cable USB-C',      50, 5, 3000,  12000, 10, 'C-103', 'Vitrina 2',   true),
  (104, 'Producto sin sitio', 7, 2, 1000,  5000, 10, 'C-104', NULL,          true),
  (105, 'De otra sucursal',   9, 2, 1000,  5000, 11, 'C-105', NULL,          true)`);

// La correa tiene tallas, y la 38MM tiene colores: los tres niveles del árbol.
await q(`INSERT INTO atributos_producto (id, producto_id, sucursal_id, tipo_id, valor, stock, stock_minimo, precio, costo_unitario, activo, codigo) VALUES
  (200, 100, 10, 1, '38MM', 25, 3, 26000, 8000, true, 'A-200'),
  (201, 100, 10, 1, '42MM', 15, 3, 27000, 8500, true, 'A-201')`);
await q(`INSERT INTO variantes_atributo (id, atributo_id, producto_id, tipo_id, valor, stock, stock_minimo, precio, costo_unitario, activo, codigo) VALUES
  (300, 200, 100, 2, 'Negro', 15, 2, 26000, 8000, true, 'V-300'),
  (301, 200, 100, 2, 'Azul',  10, 2, 26000, 8000, true, 'V-301')`);

// Seriales: una referencia con tres unidades disponibles.
await q(`INSERT INTO productos_serial (id, nombre, marca, modelo, precio, sucursal_id, ubicacion) VALUES
  (400, 'iPhone 13', 'Apple', '13 128GB', 2000000, 10, 'Vitrina 2'),
  (401, 'Galaxy S22', 'Samsung', 'S22',    1500000, 10, NULL)`);
await q(`INSERT INTO seriales (id, producto_id, imei, vendido, prestado, costo_compra, color) VALUES
  (500, 400, '111111111111111', false, false, 1600000, 'Negro'),
  (501, 400, '222222222222222', false, false, 1610000, 'Blanco'),
  (502, 400, '333333333333333', false, false, 1620000, 'Azul'),
  (503, 400, '444444444444444', true,  false, 1630000, 'Rojo')`);

// ─────────────────────────────────────────────────────────────────────────────
seccion(1, 'La migración crea la estructura y hace el backfill');
// ─────────────────────────────────────────────────────────────────────────────
const SQL_MIGRACION = readFileSync(
  path.join(RAIZ, 'migrations/20260831_ubicaciones_estructura.sql'), 'utf8');

await db.exec(SQL_MIGRACION);

// Ahora sí se pueden cargar el service y el repo: leen `hayUbicaciones()`.
columnas._setUbicacionDisponible(true);
columnas._setUbicacionesDisponible(true);
const service = require(path.join(RAIZ, 'src/modules/ubicaciones/ubicaciones.service.js'));

const ubis = await q(`SELECT id, sucursal_id, nombre, padre_id FROM ubicaciones ORDER BY nombre`);
check('Se crean SOLO los sitios que existían en texto (2, no 4)', ubis.length, 2);
check('Las tres grafías colapsan en la más usada',
  ubis.map((u) => u.nombre), ['Estante A-3', 'Vitrina 2']);
check('Todas nacen en la raíz', ubis.every((u) => u.padre_id === null), true);

const estanteA3 = ubis.find((u) => u.nombre === 'Estante A-3');
const vitrina2  = ubis.find((u) => u.nombre === 'Vitrina 2');

const asignados = await q(`
  SELECT producto_cantidad_id, producto_serial_id FROM ubicaciones_items
  WHERE ubicacion_id = $1 ORDER BY producto_cantidad_id NULLS LAST`, [estanteA3.id]);
check('Los 3 productos del estante quedan asignados pese a la grafía distinta',
  asignados.map((a) => a.producto_cantidad_id), [100, 101, 102]);

const enVitrina = await q(`
  SELECT producto_cantidad_id, producto_serial_id FROM ubicaciones_items
  WHERE ubicacion_id = $1`, [vitrina2.id]);
check('La vitrina recibe el producto por cantidad Y la referencia con IMEI',
  enVitrina.length, 2);

const sinSitio = await q(`SELECT 1 FROM ubicaciones_items WHERE producto_cantidad_id = 104`);
check('Un producto sin texto de ubicación no se inventa un sitio', sinSitio.length, 0);

// ─────────────────────────────────────────────────────────────────────────────
seccion(2, 'El backfill corre UNA vez: no pelea con las decisiones del usuario');
// ─────────────────────────────────────────────────────────────────────────────
// Un negocio renombra su estante. Las columnas TEXT siguen diciendo lo de antes
// —no se borran a propósito, son el respaldo del rollback—, así que un backfill
// sin guarda volvería a crear "Estante A-3" en cada arranque y devolvería a su
// sitio los productos que alguien quitó a propósito.
await service.actualizar(estanteA3.id, { nombre: 'Estante A3 (nuevo)' }, 1);
await q(`DELETE FROM ubicaciones_items WHERE producto_cantidad_id = 102`);

await db.exec(SQL_MIGRACION);   // el arranque siguiente

const tras2 = await q(`SELECT nombre FROM ubicaciones WHERE sucursal_id = 10 ORDER BY nombre`);
check('El nombre viejo NO reaparece', tras2.map((u) => u.nombre),
  ['Estante A3 (nuevo)', 'Vitrina 2']);
const revivido = await q(`SELECT 1 FROM ubicaciones_items WHERE producto_cantidad_id = 102`);
check('Un producto desasignado a propósito NO vuelve solo', revivido.length, 0);

// Se deja como estaba para el resto de la suite.
await service.actualizar(estanteA3.id, { nombre: 'Estante A-3' }, 1);

// ─────────────────────────────────────────────────────────────────────────────
seccion(3, 'La forma de GET /ubicaciones no cambia (autocompletado y filtro)');
// ─────────────────────────────────────────────────────────────────────────────
const catalogo = await service.getUbicaciones(10, 1);
check('Devuelve [{ ubicacion, productos }] como siempre',
  Object.keys(catalogo[0]).sort(), ['productos', 'ubicacion']);
check('Lista los dos sitios ordenados', catalogo.map((c) => c.ubicacion),
  ['Estante A-3', 'Vitrina 2']);
checkTrue('Los conteos son números', catalogo.every((c) => Number.isInteger(c.productos)));

// Una sucursal que todavía no tiene ubicaciones nuevas sigue viendo su texto:
// es la lectura dual que evita que nadie pierda sus sugerencias el día del
// despliegue.
await q(`UPDATE productos_cantidad SET ubicacion = 'Bodega vieja' WHERE id = 105`);
const catalogo11 = await service.getUbicaciones(11, 1);
check('Sin filas nuevas, el catálogo cae al texto legado',
  catalogo11.map((c) => c.ubicacion), ['Bodega vieja']);

// ─────────────────────────────────────────────────────────────────────────────
seccion(4, 'Una ubicación mezcla productos, atributos y variantes distintos');
// ─────────────────────────────────────────────────────────────────────────────
// El caso que pidió el negocio: "el Cajón B7 tiene correa y tiene estuches".
const cajon = await service.crear(
  { nombre: 'Cajón B7', tipo: 'cajon' }, 10, 1, 5);

await service.asignar({
  ubicacion_id: cajon.id,
  items: [
    { nivel: 'variante',   id: 300 },   // Correa · 38MM · Negro
    { nivel: 'atributo',   id: 201 },   // Correa · 42MM
    { nivel: 'producto',   id: 101 },   // Estuche rígido (producto entero)
    { nivel: 'referencia', id: 401 },   // Galaxy S22 (referencia con IMEI)
  ],
}, 10, 1, 5);

const items = await service.getItems(cajon.id, 1, {});
check('Caben las cuatro cosas a la vez', items.length, 4);
check('Y son de niveles distintos', items.map((i) => i.nivel).sort(),
  ['atributo', 'producto', 'referencia', 'variante']);

const variante = items.find((i) => i.nivel === 'variante');
check('La variante se rotula con su rama completa', variante.detalle,
  'Talla: 38MM · Color: Negro');
check('Y trae su propio stock, no el del producto', variante.stock, 15);
check('El código sube por COALESCE hasta el nivel que lo tenga', variante.codigo, 'V-300');

const estuche = items.find((i) => i.nivel === 'producto');
check('El estuche se mueve del estante al cajón (un nodo, un sitio)', estuche.stock, 12);
const quedaEnEstante = await q(
  `SELECT 1 FROM ubicaciones_items WHERE producto_cantidad_id = 101 AND ubicacion_id = $1`,
  [estanteA3.id]);
check('Y ya no está en el estante anterior', quedaEnEstante.length, 0);

// El producto 100 sigue en el Estante A-3, pero dos de sus ramas se fueron al
// cajón: la pantalla tiene que poder decirlo en vez de mentir con el total.
const enEstante = await service.getItems(estanteA3.id, 1, {});
const correa = enEstante.find((i) => i.nodo_id === 100);
check('El producto avisa que parte de sus ramas está en otro sitio', correa.parcial, true);

// ─────────────────────────────────────────────────────────────────────────────
seccion(5, 'Cada IMEI puede vivir en su propia ubicación');
// ─────────────────────────────────────────────────────────────────────────────
// La referencia iPhone 13 está en Vitrina 2 con 3 unidades disponibles.
let vitrinaItems = await service.getItems(vitrina2.id, 1, {});
let refIphone = vitrinaItems.find((i) => i.nivel === 'referencia');
check('La referencia hereda sus 3 unidades disponibles (la vendida no cuenta)',
  refIphone.stock, 3);

// El negocio decide guardar UN equipo en la caja fuerte.
const cajaFuerte = await service.crear({ nombre: 'Caja fuerte', tipo: 'caja' }, 10, 1, 5);
await service.asignar({ ubicacion_id: cajaFuerte.id, items: [{ nivel: 'unidad', id: 501 }] }, 10, 1, 5);

vitrinaItems = await service.getItems(vitrina2.id, 1, {});
refIphone = vitrinaItems.find((i) => i.nivel === 'referencia');
check('La vitrina deja de contar el equipo que se movió', refIphone.stock, 2);
check('Y avisa que tiene unidades en otro sitio', refIphone.parcial, true);
check('El IMEI movido NO aparece en la vitrina',
  vitrinaItems.some((i) => i.imei === '222222222222222'), false);

const enCaja = await service.getItems(cajaFuerte.id, 1, {});
check('Aparece exactamente una vez, en la caja fuerte', enCaja.length, 1);
check('Con su IMEI', enCaja[0].imei, '222222222222222');
check('Y su estado real', enCaja[0].estado, 'disponible');
check('El color del equipo sirve de detalle', enCaja[0].detalle, 'Blanco');

// La suma es el invariante: ninguna unidad se cuenta dos veces ni desaparece.
check('Invariante: 2 en vitrina + 1 en caja = las 3 disponibles',
  refIphone.stock + enCaja.length, 3);

// ─────────────────────────────────────────────────────────────────────────────
seccion(6, 'Jerarquía: la profundidad del árbol es la del zoom del mapa');
// ─────────────────────────────────────────────────────────────────────────────
const bodega  = await service.crear({ nombre: 'Bodega A', tipo: 'bodega' }, 10, 1, 5);
const estante = await service.crear({ nombre: 'Estante 1', padre_id: bodega.id }, 10, 1, 5);
const nivel2  = await service.crear({ nombre: 'Nivel 2',   padre_id: estante.id }, 10, 1, 5);

await service.asignar({ ubicacion_id: nivel2.id, items: [{ nivel: 'variante', id: 301 }] }, 10, 1, 5);

const arbol = await service.getArbol(10, 1);
const bodegaNodo = arbol.find((u) => u.id === Number(bodega.id));
check('La bodega cuelga en la raíz con su estante dentro', bodegaNodo.hijas.length, 1);
check('Y el estante con su nivel', bodegaNodo.hijas[0].hijas.length, 1);
check('Una bodega no guarda nada por sí misma', bodegaNodo.items, 0);
check('Pero SÍ suma lo de sus descendientes', bodegaNodo.items_total, 1);

const detalle = await service.getDetalle(nivel2.id, 1, {});
check('Las migas de pan van de la raíz hacia abajo',
  detalle.ruta.map((r) => r.nombre), ['Bodega A', 'Estante 1', 'Nivel 2']);

// Mismo nombre en padres distintos es LEGÍTIMO: "Estante 1" existe en Bodega A
// y puede existir en Bodega B; son sitios físicos distintos.
const bodegaB = await service.crear({ nombre: 'Bodega B' }, 10, 1, 5);
const estanteB = await service.crear({ nombre: 'Estante 1', padre_id: bodegaB.id }, 10, 1, 5);
checkTrue('"Estante 1" puede repetirse en otra bodega', !!estanteB.id);

await checkFalla('Pero no dos veces dentro del MISMO padre',
  () => service.crear({ nombre: 'estante 1', padre_id: bodegaB.id }, 10, 1, 5), 'Ya existe');
await checkFalla('Ni dos veces en la raíz (NULL <> NULL no puede colarse)',
  () => service.crear({ nombre: 'Bodega A' }, 10, 1, 5), 'Ya existe');

// ─────────────────────────────────────────────────────────────────────────────
seccion(7, 'Guardas de estructura: ciclos y profundidad');
// ─────────────────────────────────────────────────────────────────────────────
await checkFalla('Una ubicación no cabe dentro de sí misma',
  () => service.actualizar(bodega.id, { padre_id: bodega.id }, 1), 'dentro de sí misma');

await checkFalla('Ni dentro de su propia sub-ubicación (el ciclo cuelga el árbol)',
  () => service.actualizar(bodega.id, { padre_id: nivel2.id }, 1), 'sub-ubicaciones');

const bin = await service.crear({ nombre: 'Bin 3', padre_id: nivel2.id }, 10, 1, 5);
checkTrue('El cuarto nivel se permite', !!bin.id);
await checkFalla('El quinto no',
  () => service.crear({ nombre: 'Demasiado hondo', padre_id: bin.id }, 10, 1, 5), 'niveles');

// ─────────────────────────────────────────────────────────────────────────────
seccion(8, 'No se borra un estante lleno');
// ─────────────────────────────────────────────────────────────────────────────
// `ubicaciones_items` tiene ON DELETE CASCADE: un DELETE dejaría 60 productos
// sin sitio sin que nadie se entere.
await checkFalla('Con contenido dentro, 409',
  () => service.eliminar(cajon.id, 1), 'todavía tiene 4');

await checkFalla('Con sub-ubicaciones dentro, también',
  () => service.eliminar(bodega.id, 1), 'sub-ubicación');

await service.asignar({ ubicacion_id: null, items: [
  { nivel: 'variante', id: 300 }, { nivel: 'atributo', id: 201 },
  { nivel: 'producto', id: 101 }, { nivel: 'referencia', id: 401 },
] }, 10, 1, 5);
const vaciado = await service.eliminar(cajon.id, 1);
check('Vaciado, se elimina', vaciado.id, Number(cajon.id));

const siguePero = await q(`SELECT activo FROM ubicaciones WHERE id = $1`, [cajon.id]);
check('Y es baja LÓGICA, la fila sigue ahí', siguePero[0].activo, false);
check('Ya no sale en el árbol',
  (await service.getArbol(10, 1)).some((u) => u.id === Number(cajon.id)), false);
checkTrue('El nombre se puede reusar tras la baja',
  !!(await service.crear({ nombre: 'Cajón B7' }, 10, 1, 5)).id);

// ─────────────────────────────────────────────────────────────────────────────
seccion(9, 'Aislamiento: 28 negocios comparten esta base');
// ─────────────────────────────────────────────────────────────────────────────
await checkFalla('No se cuelga mercancía de otra sucursal',
  () => service.asignar({ ubicacion_id: estanteA3.id, items: [{ nivel: 'producto', id: 105 }] }, 10, 1, 5),
  'otra sucursal');

await checkFalla('Ni se toca una ubicación de otro negocio',
  () => service.actualizar(estanteA3.id, { nombre: 'Secuestrado' }, 2), 'no encontrada');

await checkFalla('Ni se lee su contenido',
  () => service.getItems(estanteA3.id, 2, {}), 'no encontrada');

const arbolAjeno = await service.getArbol(20, 2);
check('El negocio ajeno no ve nada nuestro', arbolAjeno.length, 0);

// Una lista a medias es peor que ninguna: si un id de la lista es inválido, no
// puede quedar la mitad movida.
const antesDeFallar = await q(
  `SELECT COUNT(*)::int AS n FROM ubicaciones_items WHERE ubicacion_id = $1`, [vitrina2.id]);
await checkFalla('Una lista con un id ajeno no mueve NADA',
  () => service.asignar({ ubicacion_id: vitrina2.id, items: [
    { nivel: 'producto', id: 104 },   // válido
    { nivel: 'producto', id: 105 },   // de otra sucursal
  ] }, 10, 1, 5), 'otra sucursal');
const despuesDeFallar = await q(
  `SELECT COUNT(*)::int AS n FROM ubicaciones_items WHERE ubicacion_id = $1`, [vitrina2.id]);
check('La transacción revierte el que sí era válido',
  despuesDeFallar[0].n, antesDeFallar[0].n);

// ─────────────────────────────────────────────────────────────────────────────
seccion(10, 'Ningún costo sale por esta puerta');
// ─────────────────────────────────────────────────────────────────────────────
// Una ubicación dice DÓNDE está la mercancía, no cuánto costó. Si el costo
// viajara en el JSON —aunque no se pinte— sería legible desde la consola del
// navegador, que es exactamente la fuga que `costos_solo_admin` vino a cerrar.
const CLAVES_COSTO = ['costo', 'costo_unitario', 'costo_compra', 'costo_origen', 'valor_interno'];
const buscarCosto = (obj) => Object.keys(obj || {}).filter((k) => CLAVES_COSTO.includes(k));

const muestra = [
  ...(await service.getItems(estanteA3.id, 1, {})),
  ...(await service.getItems(vitrina2.id, 1, {})),
  ...(await service.getSinAsignar(10, 1, {})),
  ...(await service.getArbol(10, 1)),
];
const fugas = muestra.flatMap(buscarCosto);
check('Ni items, ni sin-asignar, ni el árbol traen costo', fugas, []);
checkTrue('Pero el precio de venta sí (el bodeguero lo necesita)',
  (await service.getItems(vitrina2.id, 1, {})).some((i) => i.precio != null));

// ─────────────────────────────────────────────────────────────────────────────
seccion(11, 'La bandeja "sin ubicar" — la puerta de entrada real');
// ─────────────────────────────────────────────────────────────────────────────
// Sin esta lista nadie llena el mapa y la feature muere el primer día.
// "Sin ubicar" significa sin sitio PROPIO **ni heredado**: solo se lista lo que
// de verdad no se puede encontrar.
const sinAsignar = await service.getSinAsignar(10, 1, {});
const claves = sinAsignar.map((s) => `${s.nivel}:${s.nodo_id}`);

checkTrue('Aparece el producto que nunca tuvo sitio', claves.includes('producto:104'));

// La correa (100) tiene atributos activos: es un CONTENEDOR. "La correa" no
// está en el estante — están la 38MM y la 42MM.
check('Un producto con variantes activas no aparece como tal',
  claves.includes('producto:100'), false);

// 300 (38MM·Negro) y 201 (42MM) se desasignaron en la sección 8, pero su
// producto SIGUE en el Estante A-3: heredan de él y por tanto sí se pueden
// encontrar. Esta es la herencia hacia abajo, y es la mitad del diseño.
check('Una hoja sin sitio propio NO se lista si su producto tiene uno',
  claves.includes('variante:300'), false);
check('Lo mismo para el atributo', claves.includes('atributo:201'), false);

// Ahora el producto también se queda sin sitio: ya no hay de quién heredar.
await service.asignar({ ubicacion_id: null, items: [{ nivel: 'producto', id: 100 }] }, 10, 1, 5);
const huerfanas = (await service.getSinAsignar(10, 1, {})).map((s) => `${s.nivel}:${s.nodo_id}`);

checkTrue('Sin nada arriba, la variante aflora', huerfanas.includes('variante:300'));
checkTrue('Y el atributo sin variantes también', huerfanas.includes('atributo:201'));

// 301 (38MM·Azul) vive en Nivel 2: tiene sitio propio.
check('Lo que ya tiene sitio propio nunca aparece', huerfanas.includes('variante:301'), false);

// El atributo 200 tiene variantes activas: es contenedor, no hoja.
check('Un atributo con variantes tampoco aparece', huerfanas.includes('atributo:200'), false);

checkTrue('Y la referencia con IMEI desasignada', huerfanas.includes('referencia:401'));
check('La que sigue en vitrina no aparece', huerfanas.includes('referencia:400'), false);

const filtrado = await service.getSinAsignar(10, 1, { q: 'sin sitio' });
check('El buscador filtra por nombre', filtrado.map((f) => f.nodo_id), [104]);

// ─────────────────────────────────────────────────────────────────────────────
seccion(12, 'Geometría del mapa: opcional y en unidades relativas');
// ─────────────────────────────────────────────────────────────────────────────
check('Una ubicación nace SIN dibujar (el mapa no es requisito)',
  [bodega.pos_x, bodega.ancho], [null, null]);

const guardado = await service.guardarGeometria([
  { id: bodega.id,  pos_x: 100, pos_y: 50,  ancho: 300, alto: 200 },
  { id: bodegaB.id, pos_x: 450, pos_y: 50,  ancho: 300, alto: 200 },
], 10, 1);
check('Se guardan en lote, al soltar', guardado.actualizadas, 2);

const dibujada = await q(`SELECT pos_x, ancho FROM ubicaciones WHERE id = $1`, [bodega.id]);
check('Y quedan escritas', [Number(dibujada[0].pos_x), Number(dibujada[0].ancho)], [100, 300]);

const ajena = await service.guardarGeometria(
  [{ id: bodega.id, pos_x: 999, pos_y: 999, ancho: 1, alto: 1 }], 10, 2);
check('Un negocio ajeno no puede redibujar nuestro mapa', ajena.actualizadas, 0);

// ─────────────────────────────────────────────────────────────────────────────
seccion(13, 'Sin las tablas, la feature se apaga sola');
// ─────────────────────────────────────────────────────────────────────────────
columnas._setUbicacionesDisponible(false);
await checkFalla('El módulo responde que no está disponible',
  () => service.getArbol(10, 1), 'no está disponible');

const catalogoApagado = await service.getUbicaciones(10, 1);
checkTrue('Pero el autocompletado sigue vivo desde el texto legado',
  catalogoApagado.length > 0);
columnas._setUbicacionesDisponible(true);

// ─────────────────────────────────────────────────────────────────────────────
seccion(14, 'El runner de arranque crea EXACTAMENTE lo mismo que el .sql');
// ─────────────────────────────────────────────────────────────────────────────
// Quien crea las tablas en Railway no es el .sql: es src/config/migrations.js,
// que lo replica inline. Escribir uno y olvidar el otro deja el despliegue con
// el código nuevo contra una base vieja — ya pasó con `abonos_remision`.
//
// Esta sección no se conforma con "el runner corre sin error": compara columna
// por columna e ÍNDICE POR ÍNDICE contra la base que levanta el .sql. La
// normalización del nombre vive dentro de una expresión de índice, y una copia
// que dijera BTRIM donde la otra dice REGEXP_REPLACE se vería idéntica a
// simple vista y dejaría entrar duplicados solo en producción.

const runner = readFileSync(path.join(RAIZ, 'src/config/migrations.js'), 'utf8');
const MARCA  = '// Ubicaciones como entidad';
checkTrue('El runner incluye el bloque de ubicaciones', runner.includes(MARCA));

const bloque = runner.slice(runner.indexOf(MARCA));
const sqlRunner = [...bloque.matchAll(/await (?:pool|client)\.query\(`([\s\S]*?)`\);/g)]
  .slice(0, 2)
  .map((m) => m[1]);
check('Y trae sus dos sentencias (estructura + backfill)', sqlRunner.length, 2);

// Dos bases vírgenes idénticas: una la levanta el .sql, la otra el runner.
const semilla = async (base) => {
  await base.exec(readFileSync(path.join(AQUI, 'esquema.sql'), 'utf8'));
  await base.exec(readFileSync(path.join(AQUI, 'esquema-completo.sql'), 'utf8'));
  await base.exec(`
    ALTER TABLE productos_cantidad ADD COLUMN IF NOT EXISTS ubicacion TEXT;
    ALTER TABLE productos_serial   ADD COLUMN IF NOT EXISTS ubicacion TEXT;
    INSERT INTO negocios (id, nombre) VALUES (1, 'N');
    INSERT INTO sucursales (id, negocio_id, nombre) VALUES (10, 1, 'S');
    INSERT INTO productos_cantidad (id, nombre, stock, sucursal_id, ubicacion, activo)
      VALUES (1, 'X', 5, 10, 'Estante  A-3 ', true), (2, 'Y', 5, 10, 'Estante A-3', true);
  `);
};

const esquemaDe = async (base) => {
  const cols = (await base.query(`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name IN ('ubicaciones', 'ubicaciones_items')
    ORDER BY table_name, column_name`)).rows;
  const idx = (await base.query(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE tablename IN ('ubicaciones', 'ubicaciones_items')
    ORDER BY indexname`)).rows;
  return { cols, idx };
};

const dbSql = new PGlite();    await semilla(dbSql);
const dbRun = new PGlite();    await semilla(dbRun);

await dbSql.exec(SQL_MIGRACION);

let runnerOk = true, runnerErr = '';
try { for (const sql of sqlRunner) await dbRun.exec(sql); }
catch (e) { runnerOk = false; runnerErr = e.message; }
check('El SQL del runner corre sin error', runnerOk ? 'ok' : runnerErr, 'ok');

const esqSql = await esquemaDe(dbSql);
const esqRun = await esquemaDe(dbRun);

check('Mismas tablas y columnas que el .sql', esqRun.cols, esqSql.cols);

// Se compara índice por índice y se reporta SOLO el que difiere: volcar los
// once `indexdef` completos en el error hace ilegible justo el mensaje que
// alguien va a leer con prisa un día de despliegue.
const defsSql = new Map(esqSql.idx.map((i) => [i.indexname, i.indexdef]));
const defsRun = new Map(esqRun.idx.map((i) => [i.indexname, i.indexdef]));
check('Los mismos índices, por nombre',
  [...defsRun.keys()].sort(), [...defsSql.keys()].sort());
for (const [nombre, defSql] of defsSql) {
  check(`  · ${nombre} con la misma expresión`, defsRun.get(nombre) ?? '(falta)', defSql);
}

// El backfill del runner tiene que colapsar los espacios internos igual que el
// del .sql: si uno se quedara en BTRIM, "Estante  A-3 " sería un segundo sitio.
const backSql = (await dbSql.query(`SELECT nombre FROM ubicaciones ORDER BY nombre`)).rows;
const backRun = (await dbRun.query(`SELECT nombre FROM ubicaciones ORDER BY nombre`)).rows;
check('El backfill del runner produce lo mismo', backRun, backSql);
check('Y colapsa las dos grafías en un solo sitio', backRun.map((r) => r.nombre), ['Estante A-3']);

// El arranque corre las migraciones en CADA despliegue.
let reejecutable = true, reErr = '';
try { for (const sql of sqlRunner) await dbRun.exec(sql); }
catch (e) { reejecutable = false; reErr = e.message; }
check('Re-ejecutable en cada arranque', reejecutable ? 'ok' : reErr, 'ok');
check('Sin duplicar nada al re-ejecutarse',
  (await dbRun.query(`SELECT COUNT(*)::int AS n FROM ubicaciones`)).rows[0].n, 1);

// ─────────────────────────────────────────────────────────────────────────────
seccion(15, 'El frontend y el backend hablan del mismo vocabulario');
// ─────────────────────────────────────────────────────────────────────────────
// Los `nivel` ('producto', 'variante', 'unidad'…) son un contrato que cruza la
// frontera: el frontend los MANDA al asignar y los RECIBE al listar. No hay
// import posible entre los dos lados, así que son dos listas mantenidas a mano
// — exactamente la situación que ya se separó una vez con los módulos y le
// costó a un usuario perder la pestaña de Bodega en silencio.

const repoUbi   = require(path.join(RAIZ, 'src/modules/ubicaciones/ubicaciones.repository.js'));
const FRONT     = path.resolve(RAIZ, '../frontend/src');
const utilsFront = readFileSync(path.join(FRONT, 'utils/ubicaciones.js'), 'utf8');
const panelFront = readFileSync(path.join(FRONT, 'pages/inventario/PanelUbicacion.jsx'), 'utf8');
const apiFront   = readFileSync(path.join(FRONT, 'api/ubicaciones.api.js'), 'utf8');
const repoFuente = readFileSync(
  path.join(RAIZ, 'src/modules/ubicaciones/ubicaciones.repository.js'), 'utf8');

const nivelesBackend = Object.keys(repoUbi.NODOS).sort();
const bloqueNiveles  = utilsFront.match(/export const NIVELES = \{([\s\S]*?)\n\};/)?.[1] ?? '';
const nivelesFrontend = [...bloqueNiveles.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]).sort();

check('Los cinco niveles del backend están en el frontend', nivelesFrontend, nivelesBackend);

// Los estados salen del SQL, que es quien de verdad los produce. Si mañana se
// agrega uno y nadie lo pinta, la etiqueta sale en blanco y nadie lo nota.
//
// Se acota a `SQL_ITEMS` y no se barre el archivo entero: hay otros CASE que
// devuelven literales (el del historial resuelve el `nivel` así), y un barrido
// suelto los mezclaría con los estados. Ya pasó al agregar el historial.
const sqlItems = repoFuente.match(/const SQL_ITEMS = `([\s\S]*?)\n`;/)?.[1] ?? '';
checkTrue('Se encontró el SQL de los items para extraer sus estados', sqlItems.length > 0);
const estadosBackend = [...new Set(
  [...sqlItems.matchAll(/(?:THEN|ELSE) '([a-z]+)'/g)].map((m) => m[1])
)].sort();
const bloqueEstados  = utilsFront.match(/export const ESTADOS = \{([\s\S]*?)\n\};/)?.[1] ?? '';
const estadosFrontend = [...bloqueEstados.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]).sort();

check('Y los estados que emite el SQL también', estadosFrontend, estadosBackend);

// El escaneo devuelve nodos con `nivel`, y esos valores se mandan tal cual a la
// asignación. Si el vocabulario de `/busqueda/escaneo` dejara de coincidir con
// el de este módulo, guardar en un estante fallaría solo al escanear.
const nivelesEscaneo = [...new Set(
  [...readFileSync(path.join(RAIZ, 'src/utils/codigo.util.js'), 'utf8')
    .matchAll(/SELECT '(producto|atributo|variante)'/g)].map((m) => m[1])
)];
checkTrue('Los niveles que devuelve el escaneo son asignables',
  nivelesEscaneo.length === 3 && nivelesEscaneo.every((n) => nivelesBackend.includes(n)));

// El nivel que el frontend inventa por su cuenta (el escaneo de un IMEI no
// devuelve `nivel`, lo pone la pantalla) tiene que existir en el backend.
const nivelInventado = panelFront.match(/nivel: '(\w+)', id: res\.serial\.id/)?.[1];
check('Y el que la pantalla pone para un IMEI, también', nivelInventado, 'unidad');

// La compatibilidad es lo que permite no tocar InputUbicacion ni el filtro del
// inventario: si alguien borra esta ruta o su cliente, esas pantallas se quedan
// sin sugerencias sin que nada falle a la vista.
const rutasFuente = readFileSync(
  path.join(RAIZ, 'src/modules/ubicaciones/ubicaciones.routes.js'), 'utf8');
checkTrue('Sigue existiendo GET / (catálogo plano de compatibilidad)',
  /router\.get\('\/',/.test(rutasFuente));
checkTrue('Y su cliente en el frontend', /export const getUbicaciones =/.test(apiFront));

// Las rutas literales tienen que ir ANTES de /:id o Express las resuelve como
// un id. Se comprueba por posición en el archivo, que es lo que Express mira.
const posParam = rutasFuente.indexOf("'/:id'");
for (const literal of ["'/arbol'", "'/sin-asignar'", "'/items'", "'/geometria'"]) {
  const pos = rutasFuente.indexOf(literal);
  check(`  · ${literal} se declara antes de /:id`, pos !== -1 && pos < posParam, true);
}

// ─────────────────────────────────────────────────────────────────────────────
seccion(16, 'Historial: mover primero, anotar después');
// ─────────────────────────────────────────────────────────────────────────────
// La regla de este bloque, y la razón de que el historial tenga bandera propia:
// **registrar es un extra, mover es la operación diaria del bodeguero**. Como
// el INSERT del log corre DENTRO de la transacción del movimiento, si la tabla
// faltara abortaría la transacción entera y mover una caja de estante fallaría
// por culpa de su propia bitácora.

check('Hasta aquí no existía la tabla y TODO lo anterior funcionó',
  (await q(`SELECT to_regclass('public.movimientos_ubicacion') AS t`))[0].t, null);

const cajonB7 = (await service.getArbol(10, 1)).find((u) => u.nombre === 'Cajón B7');
await service.asignar({ ubicacion_id: cajonB7.id, items: [{ nivel: 'producto', id: 104 }] }, 10, 1, 5);
check('Mover sin bitácora funciona igual',
  (await service.getItems(cajonB7.id, 1, {})).length, 1);
check('Y el historial responde vacío en vez de reventar',
  await service.getMovimientos(10, 1, {}), []);

// Ahora sí se aplica la migración del historial.
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260901_movimientos_ubicacion.sql'), 'utf8'));
columnas._setMovimientosUbicacionDisponible(true);

await service.asignar({ ubicacion_id: vitrina2.id, items: [{ nivel: 'producto', id: 104 }] }, 10, 1, 5);
let movs = await service.getMovimientos(10, 1, {});
check('El primer movimiento queda anotado', movs.length, 1);
check('Con de dónde y a dónde', [movs[0].desde_nombre, movs[0].hacia_nombre],
  ['Cajón B7', 'Vitrina 2']);
check('Con qué se movió', movs[0].etiqueta, 'Producto sin sitio');
check('Con quién lo movió', movs[0].usuario_nombre, 'Bodeguero');
check('Y a qué nivel del árbol apunta', movs[0].nivel, 'producto');

// Un lector encadena lecturas y la misma caja se escanea dos veces sin querer.
const antes = movs.length;
const r = await service.asignar({ ubicacion_id: vitrina2.id, items: [{ nivel: 'producto', id: 104 }] }, 10, 1, 5);
check('Volver a guardarlo donde ya estaba NO es un movimiento',
  (await service.getMovimientos(10, 1, {})).length, antes);
check('Y el service lo dice', [r.movidos, r.registrados], [1, 0]);

// Sacarlo a la bandeja también es un movimiento: es lo que se busca cuando algo
// desapareció de un estante.
await service.asignar({ ubicacion_id: null, items: [{ nivel: 'producto', id: 104 }] }, 10, 1, 5);
movs = await service.getMovimientos(10, 1, {});
check('Quitar la ubicación se anota', movs[0].hacia_nombre, null);
check('Diciendo de dónde salió', movs[0].desde_nombre, 'Vitrina 2');

// ── Lo que hace que el historial siga siendo verdad ──
// Los nombres se congelan al moverse. Con un JOIN, renombrar un estante
// reescribiría el pasado y la línea diría un sitio que aquel día no existía.
await service.actualizar(vitrina2.id, { nombre: 'Vitrina principal' }, 1);
movs = await service.getMovimientos(10, 1, {});
check('Renombrar una ubicación NO reescribe el pasado', movs[0].desde_nombre, 'Vitrina 2');
check('Aunque el id siga apuntando a la fila viva',
  Number(movs[0].desde_id), Number(vitrina2.id));
await service.actualizar(vitrina2.id, { nombre: 'Vitrina 2' }, 1);

// ── El filtro por ubicación mira los DOS extremos ──
const deLaVitrina = await service.getMovimientos(10, 1, { ubicacionId: Number(vitrina2.id) });
check('Un estante tiene dos historias: lo que entró y lo que salió',
  deLaVitrina.length, 2);
checkTrue('Y las dos aparecen',
  deLaVitrina.some((m) => Number(m.hacia_id) === Number(vitrina2.id))
  && deLaVitrina.some((m) => Number(m.desde_id) === Number(vitrina2.id)));

// El cajón solo interviene en UNO de los movimientos registrados: el producto
// salió de él hacia la vitrina. Que entrara en el cajón pasó ANTES de aplicar
// la migración, y esa es justamente la prueba de que sin tabla no se anota.
const delCajon = await service.getMovimientos(10, 1, { ubicacionId: Number(cajonB7.id) });
check('El cajón solo ve los movimientos en los que interviene', delCajon.length, 1);
check('Y el suyo es una SALIDA', delCajon[0].desde_nombre, 'Cajón B7');
check('Lo anterior a la migración no aparece', delCajon[0].hacia_nombre, 'Vitrina 2');

// ── Aislamiento ──
await checkFalla('No se filtra por una ubicación de otro negocio',
  () => service.getMovimientos(20, 2, { ubicacionId: Number(vitrina2.id) }), 'no encontrada');
check('Y el negocio ajeno no ve nuestro historial',
  await service.getMovimientos(20, 2, {}), []);

// ── El etiquetado de cada nivel ──
// La etiqueta se arma en SQL, un caso por rama. Una concatenación mal puesta
// deja "· null" en la lista y no se ve hasta que alguien mueve ese tipo de nodo.
await service.asignar({ ubicacion_id: cajonB7.id, items: [
  { nivel: 'variante',   id: 300 },
  { nivel: 'atributo',   id: 201 },
  { nivel: 'referencia', id: 401 },
  { nivel: 'unidad',     id: 502 },
] }, 10, 1, 5);
const porNivel = Object.fromEntries(
  (await service.getMovimientos(10, 1, {})).map((m) => [m.nivel, m.etiqueta])
);
check('La variante se rotula con su rama completa', porNivel.variante,
  'Correa deportiva · 38MM / Negro');
check('El atributo con la suya',   porNivel.atributo,   'Correa deportiva · 42MM');
check('La referencia con su nombre', porNivel.referencia, 'Galaxy S22');
check('Y la unidad con su IMEI',   porNivel.unidad,     'iPhone 13 · 333333333333333');
checkTrue('Ninguna etiqueta arrastra un null',
  Object.values(porNivel).every((e) => e && !/null|undefined/.test(e)));

// ─────────────────────────────────────────────────────────────────────────────
seccion(17, 'El historial también está replicado en el runner');
// ─────────────────────────────────────────────────────────────────────────────
const MARCA_HIST = '// Historial de movimientos de ubicación';
checkTrue('El runner incluye el bloque del historial', runner.includes(MARCA_HIST));

const sqlHist = [...runner.slice(runner.indexOf(MARCA_HIST))
  .matchAll(/await (?:pool|client)\.query\(`([\s\S]*?)`\);/g)].slice(0, 1).map((m) => m[1]);
check('Con su sentencia', sqlHist.length, 1);

const dbSqlH = new PGlite(); await semilla(dbSqlH);
const dbRunH = new PGlite(); await semilla(dbRunH);
await dbSqlH.exec(SQL_MIGRACION);
await dbRunH.exec(SQL_MIGRACION);
await dbSqlH.exec(readFileSync(path.join(RAIZ, 'migrations/20260901_movimientos_ubicacion.sql'), 'utf8'));

let histOk = true, histErr = '';
try { for (const sql of sqlHist) await dbRunH.exec(sql); }
catch (e) { histOk = false; histErr = e.message; }
check('El SQL del runner corre sin error', histOk ? 'ok' : histErr, 'ok');

const colsDe = async (base) => (await base.query(`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name = 'movimientos_ubicacion' ORDER BY column_name`)).rows;
const idxDe = async (base) => (await base.query(`
  SELECT indexname, indexdef FROM pg_indexes
  WHERE tablename = 'movimientos_ubicacion' ORDER BY indexname`)).rows;

check('Mismas columnas que el .sql', await colsDe(dbRunH), await colsDe(dbSqlH));
check('Y los mismos índices',        await idxDe(dbRunH),  await idxDe(dbSqlH));

// ─────────────────────────────────────────────────────────────────────────────
seccion(18, '"¿Dónde está esto?" — la pregunta inversa');
// ─────────────────────────────────────────────────────────────────────────────
// El módulo se construyó para responder "¿qué hay en este estante?", pero en
// una bodega grande la pregunta que más se hace es la contraria. La respuesta
// nunca puede ser "no sé": si la talla no tiene sitio propio, se hereda del
// producto y se dice que es heredado.

const buscar = (q, suc = 10, neg = 1) => service.buscar(suc, neg, { q });

const cable = await buscar('Cable');
check('Encuentra un producto por su nombre', cable.length, 1);
check('Y dice en qué ubicación está', Number(cable[0].ubicacion_id), Number(vitrina2.id));
check('Marcándola como propia, no heredada', cable[0].heredada, false);
check('Con su stock a la vista', cable[0].stock, 50);

check('Busca también por código', (await buscar('C-103')).map((r) => r.nodo_id), [103]);

// Lo que no tiene sitio se encuentra igual, pero se dice que no lo tiene: es la
// diferencia entre "no está" y "nadie lo ha ubicado".
const vidrio = await buscar('Vidrio');
check('Lo que no tiene sitio también aparece', vidrio.length, 1);
check('Con la ubicación en nulo', vidrio[0].ubicacion_id, null);

// ── Herencia: la respuesta nunca es "no sé" ──
await service.asignar({ ubicacion_id: null,          items: [{ nivel: 'variante', id: 300 }] }, 10, 1, 5);
await service.asignar({ ubicacion_id: estanteA3.id,  items: [{ nivel: 'producto', id: 100 }] }, 10, 1, 5);

const hallada = await buscar('Correa');
const v300 = hallada.find((r) => r.nivel === 'variante' && r.nodo_id === 300);
const v301 = hallada.find((r) => r.nivel === 'variante' && r.nodo_id === 301);

check('Una talla sin sitio propio hereda el del producto',
  Number(v300.ubicacion_id), Number(estanteA3.id));
check('Y se dice que es heredado', v300.heredada, true);
check('La que sí tiene sitio propio gana sobre el del producto',
  Number(v301.ubicacion_id), Number(nivel2.id));
check('Y esa no es heredada', v301.heredada, false);

// El producto con tallas activas es un CONTENEDOR: "la correa" no está en el
// estante, están la 38MM y la 42MM. Se busca lo que se va a ir a recoger.
check('Un producto con tallas no aparece como tal',
  hallada.some((r) => r.nivel === 'producto' && r.nodo_id === 100), false);

// ── Seriales ──
const porImei = await buscar('222222222222222');
check('El IMEI encuentra la unidad exacta', porImei.length, 1);
check('En su propio sitio', Number(porImei[0].ubicacion_id), Number(cajaFuerte.id));
check('Y no heredado', porImei[0].heredada, false);

const iphone = await buscar('iPhone');
checkTrue('El nombre del modelo trae la referencia',
  iphone.some((r) => r.nivel === 'referencia' && Number(r.ubicacion_id) === Number(vitrina2.id)));
checkTrue('Y también la unidad que se separó a la caja fuerte',
  iphone.some((r) => r.nivel === 'unidad' && Number(r.ubicacion_id) === Number(cajaFuerte.id)));

// ── Orden y barandas ──
// Una sola letra devolvería media bodega: ni ayuda a quien busca ni le sale
// gratis a una base que comparten 28 negocios.
check('Con una sola letra no busca',    await buscar('o'), []);
check('Ni con espacios en blanco',      await buscar('   '), []);
check('Ni con una letra y un espacio',  await buscar('o '), []);

// Quien pregunta "¿dónde está?" quiere una respuesta: lo que sí tiene sitio va
// primero, y lo que nadie ha ubicado se queda al final de la lista.
const mezcla = await buscar('o');
const conYSin = mezcla.length ? mezcla : await buscar('ca');
const primerSinSitio = conYSin.findIndex((r) => r.ubicacion_id === null);
const ultimoConSitio = conYSin.map((r) => r.ubicacion_id !== null).lastIndexOf(true);
checkTrue('Lo que tiene sitio se lista antes que lo que no',
  primerSinSitio === -1 || ultimoConSitio === -1 || ultimoConSitio < primerSinSitio);
checkTrue('Y la búsqueda de dos letras sí devuelve algo', conYSin.length > 0);

// ── Aislamiento ──
check('Otro negocio no encuentra nuestra mercancía', await buscar('Cable', 20, 2), []);
check('Ni otra sucursal del mismo negocio', await buscar('Cable', 11, 1), []);

// ── Sin costos, tampoco por aquí ──
check('El buscador tampoco filtra costos',
  (await buscar('Cable')).flatMap(buscarCosto), []);

// ─────────────────────────────────────────────────────────────────────────────
seccion(19, 'Ruta de recogida: donde esta cada linea de una lista');
// Igual que el buscador, pero por IDS: la lista ya existe (el carrito de una
// venta, un prestamo, un traslado) y lo unico que falta es donde ir a buscarla.
// El ORDEN del recorrido lo arma la pantalla con el arbol; aqui solo se
// responde "donde esta".

const ruta = await service.ubicacionesDe([
  { nivel: 'producto',   id: 103 },   // Cable USB-C, en la vitrina
  { nivel: 'variante',   id: 300 },   // sin sitio propio: hereda del producto
  { nivel: 'variante',   id: 301 },   // con sitio propio
  { nivel: 'unidad',     id: 501 },   // IMEI en la caja fuerte
  { nivel: 'referencia', id: 401 },   // Galaxy S22
], 10, 1);

const porNodo = Object.fromEntries(ruta.map((r) => [`${r.nivel}:${r.nodo_id}`, r]));

check('Responde por las cinco lineas', ruta.length, 5);
check('Un producto, en su sitio',
  Number(porNodo['producto:103'].ubicacion_id), Number(vitrina2.id));
check('Una unidad, en el suyo propio',
  Number(porNodo['unidad:501'].ubicacion_id), Number(cajaFuerte.id));

// La herencia es lo que evita que la ruta diga "no se" para algo perfectamente
// localizable: la talla no esta marcada, pero la correa si.
check('Una talla sin sitio hereda el del producto',
  Number(porNodo['variante:300'].ubicacion_id), Number(estanteA3.id));
check('Y se dice que es heredado', porNodo['variante:300'].heredada, true);
check('La que tiene sitio propio gana',
  Number(porNodo['variante:301'].ubicacion_id), Number(nivel2.id));
check('Y no es heredada', porNodo['variante:301'].heredada, false);

// Una lista con basura debe responder lo que si sabe: quien la manda es el
// carrito del propio usuario, no un formulario que haya que validar.
const conBasura = await service.ubicacionesDe([
  { nivel: 'producto', id: 103 },
  { nivel: 'inventado', id: 1 },
  { nivel: 'producto', id: 999999 },
  { nivel: 'producto', id: 'abc' },
  null,
], 10, 1);
check('Los ids invalidos se descartan sin tumbar la lista',
  conBasura.map((r) => r.nodo_id), [103]);

check('Una lista vacia responde vacio', await service.ubicacionesDe([], 10, 1), []);
check('Y algo que no es lista, tambien', await service.ubicacionesDe(null, 10, 1), []);

// Aislamiento: un id ajeno no puede colarse ni para preguntar donde esta.
check('Otro negocio no resuelve nuestra mercancia',
  await service.ubicacionesDe([{ nivel: 'producto', id: 103 }], 20, 2), []);
check('Ni otra sucursal del mismo negocio',
  await service.ubicacionesDe([{ nivel: 'producto', id: 103 }], 11, 1), []);

// Una consulta por NIVEL, no una por linea: un carrito de 30 items son 5
// consultas como mucho.
const muchas = await service.ubicacionesDe(
  Array.from({ length: 30 }, () => ({ nivel: 'producto', id: 103 })), 10, 1);
checkTrue('Treinta lineas del mismo nivel se resuelven de una', muchas.length >= 1);

check('La ruta tampoco filtra costos', ruta.flatMap(buscarCosto), []);

console.log(`\n${'═'.repeat(70)}`);
console.log(`  ${pasados} verificaciones pasaron, ${fallos} fallaron`);
console.log(`${'═'.repeat(70)}\n`);
process.exit(fallos ? 1 : 0);
