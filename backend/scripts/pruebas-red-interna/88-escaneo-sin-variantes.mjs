// ─────────────────────────────────────────────────────────────────────────────
// ESCANEAR UN PRODUCTO SIN TALLAS con «Variantes» encendida
//
// Reportado el 30-oct-2026: con `variantes_activo` el escáner del carrito
// rechazaba el código de CUALQUIER producto («se vende por variantes»), aunque
// ese producto no tuviera ni una talla. El backend ahora dice en `tiene_hijos`
// si el nodo escaneado es un contenedor, y `nodoPideVariante` decide.
//
//   1. ★ El backend marca bien cada nivel (producto, talla, color).
//   2. ★ La decisión del escáner: sin tallas se agrega, con tallas se pide.
//   3. Lo que ya funcionaba sigue igual (feature apagada, backend viejo).
//   4. El hook y el carrito usan la función (no una copia).
// ─────────────────────────────────────────────────────────────────────────────
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');
const FRONT = path.resolve(RAIZ, '../frontend/src');

const db = new PGlite();
await db.exec(readFileSync(path.join(AQUI, 'esquema.sql'), 'utf8'));
await db.exec(readFileSync(path.join(AQUI, 'esquema-completo.sql'), 'utf8'));
const conectar = (t) => ({ query: (s, p) => t.query(s, p ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

const busqueda = require(path.join(RAIZ, 'src/modules/busqueda/busqueda.service.js'));
const front = await import('file:///' + path.join(FRONT, 'utils/codigoEscaneado.js').replace(/\\/g, '/'));

let ok = 0; const fallos = [];
const check = (nombre, cond, detalle = '') => {
  if (cond) { ok++; console.log(`  ✓ ${nombre}`); }
  else { fallos.push(nombre); console.log(`  ✗ ${nombre}${detalle ? ` — ${detalle}` : ''}`); }
};
const q = async (s, p = []) => (await db.query(s, p)).rows;

await q(`INSERT INTO negocios (id, nombre) VALUES (1, 'Tesla')`);
await q(`INSERT INTO sucursales (id, negocio_id, nombre) VALUES (1, 1, 'Tienda')`);
await q(`INSERT INTO productos_cantidad (id, sucursal_id, nombre, stock, codigo, activo) VALUES
  (1, 1, 'Cargador 20W',  12, 'CAR20', true),
  (2, 1, 'Correa Watch',  10, 'COR',   true),
  (3, 1, 'Funda',          4, 'FUN',   true),
  (4, 1, 'Vidrio',         3, 'VID',   true)`);
// Correa: tallas sin colores. Funda: una talla con colores. Vidrio: su única
// talla está DESACTIVADA (no cuenta como contenedor).
await q(`INSERT INTO atributos_producto (id, producto_id, sucursal_id, valor, stock, codigo, activo) VALUES
  (1, 2, 1, '38MM', 6, 'COR38', true),
  (2, 2, 1, '42MM', 4, 'COR42', true),
  (3, 3, 1, 'iPhone 13', 4, 'FUN13', true),
  (4, 4, 1, 'Vieja', 0, 'VIDV', false)`);
await q(`INSERT INTO variantes_atributo (id, atributo_id, valor, stock, codigo, activo) VALUES
  (1, 3, 'Negro', 3, 'FUN13N', true), (2, 3, 'Rojo', 1, 'FUN13R', true)`);

const nodo = async (codigo) => (await busqueda.escanear(codigo, 1, 1, 'vendedor'))?.nodos?.[0];

console.log('\n1. ★ El backend marca bien cada nivel');
const car = await nodo('CAR20');
check('★ producto SIN tallas → tiene_hijos = false', car?.tiene_hijos === false, JSON.stringify(car?.tiene_hijos));
check('  producto CON tallas → true', (await nodo('COR'))?.tiene_hijos === true);
check('  producto con su única talla desactivada → false', (await nodo('VID'))?.tiene_hijos === false);
check('  talla SIN colores → false', (await nodo('COR38'))?.tiene_hijos === false);
check('  talla CON colores → true', (await nodo('FUN13'))?.tiene_hijos === true);
check('  color → false', (await nodo('FUN13N'))?.tiene_hijos === false);
check('  el resto de la respuesta no cambió (stock y nivel)', car.stock === 12 && car.nivel === 'producto' && car.atributo_id === null);

console.log('\n2. ★ La decisión del escáner con «Variantes» encendida');
const pide = (n) => front.nodoPideVariante(n, true);
check('★★ el cargador (sin tallas) se AGREGA — el bug reportado', pide(car) === false);
check('  la correa (con tallas) pide la talla', pide(await nodo('COR')) === true);
check('  la talla 38MM (sin colores) se agrega', pide(await nodo('COR38')) === false);
check('★ la talla de la funda (con colores) pide el color', pide(await nodo('FUN13')) === true);
check('  el color se agrega', pide(await nodo('FUN13N')) === false);
check('  el vidrio (talla desactivada) se agrega', pide(await nodo('VID')) === false);

console.log('\n3. Lo que ya funcionaba sigue igual');
const pideOff = (n) => front.nodoPideVariante(n, false);
check('  feature apagada: ningún producto pide talla', pideOff(car) === false && pideOff(await nodo('COR')) === false);
check('  un backend viejo (sin tiene_hijos) conserva la regla de siempre',
  front.nodoPideVariante({ nivel: 'producto', id: 1 }, true) === true
  && front.nodoPideVariante({ nivel: 'atributo', id: 2, atributo_id: 1 }, true) === false);
check('  sin nodo no revienta', front.nodoPideVariante(null, true) === false);

console.log('\n4. El hook usa la función, no una copia');
const hook = readFileSync(path.join(FRONT, 'hooks/useEscanerCarrito.js'), 'utf8');
check('  el código de producto pasa por nodoPideVariante', /if \(nodoPideVariante\(nodo, variantesActivo\)\)/.test(hook));
check('  la talla con colores también', /nodo\.atributo_id && nodoPideVariante\(nodo, variantesActivo\)/.test(hook));
check('  ya no rechaza por la sola feature', !/if \(variantesActivo\) \{/.test(hook));
check('  el atajo local va al servidor cuando no sabe si hay tallas',
  /variantesActivo && local\.tiene_hijos === undefined/.test(hook));

console.log(`\n${ok} verificaciones pasaron · ${fallos.length} fallaron`);
if (fallos.length) { console.log('Fallaron:\n  - ' + fallos.join('\n  - ')); process.exit(1); }
