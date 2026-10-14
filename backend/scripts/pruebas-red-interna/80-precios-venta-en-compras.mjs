// ─────────────────────────────────────────────────────────────────────────────
// PRECIOS DE VENTA AL COMPRAR (14-oct-2026)
//
// Con las listas de precios encendidas, las pantallas donde entra mercancía
// —compra a proveedor, pedido (orden de compra), recepción de una orden, y
// agregar stock / compra a cliente desde Inventario— muestran los precios de
// venta de lo que se compra y dejan corregirlos o ponerlos. Leer es
// `GET /listas-precios/compra`; escribir sigue siendo `PUT /listas-precios/nodos`
// con su permiso, ANTES de registrar la compra.
//
//   · Sección 1 — la lectura: los nodos de los productos pedidos, con su precio
//                 normal y el padre de cada variante; nada de otro negocio.
//   · Sección 2 — ★ qué filas se pintan y qué se hereda (la lógica del navegador).
//   · Sección 3 — ★ qué se guarda: solo lo tocado, con el mapa COMPLETO; lo que
//                 se quitó de la compra no; una casilla vaciada se quita.
//   · Sección 4 — ida y vuelta contra la base: guardar lo armado y releerlo.
//   · Sección 5 — estática: las seis pantallas guardan los precios ANTES de
//                 registrar, la sección no pinta nada sin listas, y los permisos.
//
//   node scripts/pruebas-red-interna/80-precios-venta-en-compras.mjs
// Requiere PGlite (no va en package.json a propósito):
//   npm install --no-save @electric-sql/pglite
// ─────────────────────────────────────────────────────────────────────────────
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');
const FRONT = path.resolve(RAIZ, '../frontend/src');
const leer = (...p) => readFileSync(path.join(...p), 'utf8');

const db = new PGlite();
await db.exec(leer(AQUI, 'esquema.sql'));
await db.exec(leer(AQUI, 'esquema-completo.sql'));
await db.exec(leer(RAIZ, 'migrations/20260912_listas_precios.sql'));

const conectar = (t) => ({
  query: async (text, params) => {
    const r = await t.query(text, params ?? []);
    return { ...r, rowCount: r.rowCount ?? r.affectedRows ?? (r.rows?.length ?? 0) };
  },
});
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };
const columnas = require(path.join(RAIZ, 'src/config/columnas.js'));
columnas._setListasPreciosDisponible(true);

const svc = require(path.join(RAIZ, 'src/modules/listas-precios/listasPrecios.service.js'));
const pc  = await import('file://' + path.join(FRONT, 'utils/preciosCompra.js').replace(/\\/g, '/'));

let fallos = 0, pasados = 0;
const ok = (nombre, cond, detalle = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos++;
};
const seccion = (t) => console.log(`\n── ${t}`);

const LISTAS = [
  { id: 'mayor', nombre: 'Al por mayor', color: 'green' },
  { id: 'final', nombre: 'Cliente final', color: 'blue' },
];

await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Test'), ('Otro');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Principal'), (2,'Ajena');
  INSERT INTO usuarios (nombre) VALUES ('Admin');
  INSERT INTO config_negocio VALUES
    (1,'listas_precios_activo','1'),
    (1,'listas_precios_lista','${JSON.stringify(LISTAS).replace(/'/g, "''")}');
  INSERT INTO tipos_caracteristica (negocio_id, nombre, orden) VALUES (1,'Talla',1), (1,'Color',2);

  -- 1: Correa con dos tallas; la 38MM con dos colores.
  INSERT INTO productos_cantidad (nombre, stock, precio, precios, sucursal_id)
    VALUES ('Correa', 0, 60000, '{"mayor":50000,"final":65000}', 1);
  INSERT INTO atributos_producto (producto_id, sucursal_id, tipo_id, valor, stock, precio, precios)
    VALUES (1, 1, 1, '42MM', 5, 70000, '{"final":75000}'),
           (1, 1, 1, '38MM', 0, NULL,  NULL);
  INSERT INTO variantes_atributo (atributo_id, producto_id, tipo_id, valor, stock, precio, precios)
    VALUES (2, 1, 2, 'Negro', 2, NULL, '{"mayor":48000}'),
           (2, 1, 2, 'Café',  3, NULL, NULL);
  -- 2: un cable plano sin ningún precio de lista.
  INSERT INTO productos_cantidad (nombre, stock, precio, sucursal_id) VALUES ('Cable', 10, 15000, 1);
  -- 3: un producto de OTRO negocio.
  INSERT INTO productos_cantidad (nombre, stock, precio, precios, sucursal_id)
    VALUES ('Ajeno', 1, 1000, '{"mayor":900}', 2);
  -- Referencias con IMEI: 1 del negocio, 2 de otro.
  INSERT INTO productos_serial (nombre, marca, modelo, precio, precios, sucursal_id)
    VALUES ('iPhone 13','Apple','128GB', 2600000, '{"final":2700000}', 1),
           ('iPhone ajeno','Apple','64GB', 1, NULL, 2);
`);

// ─────────────────────────────────────────────────────────────────────────────
seccion('1. La lectura');
let DATOS;
{
  DATOS = await svc.getPreciosParaCompra({ cantidad: '1,2,3', serial: '1,2' }, 1);
  const claves = DATOS.map((d) => `${d.nivel}:${d.id}`).sort();
  ok('trae producto, tallas, colores y la referencia con IMEI',
    ['atributo:1', 'atributo:2', 'producto:1', 'producto:2', 'serial:1', 'variante:1', 'variante:2']
      .every((k) => claves.includes(k)), claves.join(' '));
  ok('★ nada de otro negocio (producto 3 ni referencia 2)',
    !claves.includes('producto:3') && !claves.includes('serial:2'));
  const negro = DATOS.find((d) => d.nivel === 'variante' && d.id === 1);
  ok('la variante dice de qué talla cuelga y de qué producto', negro.atributo_id === 2 && negro.producto_id === 1);
  ok('…con su etiqueta legible', negro.etiqueta === 'Color: Negro', negro.etiqueta);
  const correa = DATOS.find((d) => d.nivel === 'producto' && d.id === 1);
  ok('trae el precio normal y el mapa de listas', Number(correa.precio) === 60000 && correa.precios.mayor === 50000);

  ok('sin productos responde vacío', (await svc.getPreciosParaCompra({}, 1)).length === 0);
  ok('ids basura se ignoran', (await svc.getPreciosParaCompra({ cantidad: 'x,-1,0', serial: '' }, 1)).length === 0);
  let tope = null;
  try { await svc.getPreciosParaCompra({ cantidad: Array.from({ length: 201 }, (_, i) => i + 1) }, 1); }
  catch (e) { tope = e.status; }
  ok('más de 200 productos → 400', tope === 400);

  columnas._setListasPreciosDisponible(false);
  let sinInfra = null;
  try { await svc.getPreciosParaCompra({ cantidad: '1' }, 1); } catch (e) { sinInfra = e.status; }
  ok('sin la migración de listas no consulta nada (error controlado)', sinInfra != null && sinInfra !== 500, String(sinInfra));
  columnas._setListasPreciosDisponible(true);
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('2. Qué se pinta y qué se hereda');
const LINEAS = [
  { tipo: 'cantidad', producto_id: 1, variante_id: 1 },     // Correa 38MM Negro
  { tipo: 'cantidad', producto_id: 1, atributo_id: 1 },     // Correa 42MM
  { tipo: 'cantidad', producto_id: 1, variante_id: 1 },     // repetida
  { tipo: 'cantidad', producto_id: 2 },                     // Cable
  { tipo: 'serial',   producto_id: 1 },                     // iPhone
  { tipo: 'cantidad', producto_id: 3 },                     // ajeno: no vuelve
];
{
  const prods = pc.productosDeLineas(LINEAS);
  ok('pide cada producto una vez', JSON.stringify(prods) === JSON.stringify({ cantidad: [1, 2, 3], serial: [1] }),
    JSON.stringify(prods));

  const grupos = pc.armarGrupos(LINEAS, DATOS);
  ok('un grupo por producto, en el orden de la compra; el ajeno no sale',
    grupos.map((g) => g.clave).join(' ') === 'producto:1 producto:2 serial:1', grupos.map((g) => g.clave).join(' '));
  const correa = grupos[0];
  ok('★ el producto primero y debajo SOLO lo que se compra, sin repetir',
    correa.filas.map((f) => f.clave).join(' ') === 'producto:1 variante:1 atributo:1',
    correa.filas.map((f) => f.clave).join(' '));
  const negro = correa.filas[1];
  ok('el color hereda de la talla y del producto', negro.cadena.map((n) => `${n.nivel}:${n.id}`).join(' ') === 'producto:1 atributo:2');

  ok('una casilla con precio propio muestra el suyo', pc.valorEnLista(negro, 'mayor', {}) === 48000);
  ok('una vacía muestra vacío…', pc.valorEnLista(negro, 'final', {}) === '');
  ok('…y hereda del producto', pc.heredadoEnLista(negro.cadena, 'final', {}) === 65000);
  const cambios = { 'producto:1': { nivel: 'producto', id: 1, base: { mayor: 50000, final: 65000 }, valores: { final: '70000' } } };
  ok('★ escribir el precio del producto se ve al instante como herencia', pc.heredadoEnLista(negro.cadena, 'final', cambios) === 70000);
  ok('la casilla editada se marca', pc.casillaCambiada(correa.filas[0], 'final', cambios));
  ok('la no tocada no', !pc.casillaCambiada(correa.filas[0], 'mayor', cambios));
  ok('el cable no tiene nada que heredar', pc.heredadoEnLista(grupos[1].filas[0].cadena, 'mayor', {}) === null);
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('3. Qué se guarda');
{
  const vig = pc.clavesVigentes(LINEAS);
  const cambios = {
    // Producto: cambia «final», conserva «mayor».
    'producto:1': { nivel: 'producto', id: 1, base: { mayor: 50000, final: 65000 }, valores: { final: '70000' } },
    // Color Negro: vacía «mayor» a propósito → se quita.
    'variante:1': { nivel: 'variante', id: 1, base: { mayor: 48000 }, valores: { mayor: '' } },
    // Cable: se escribe y se deja igual al guardado (nada).
    'producto:2': { nivel: 'producto', id: 2, base: null, valores: { mayor: '' } },
    // iPhone: precio nuevo en «mayor».
    'serial:1':   { nivel: 'serial', id: 1, base: { final: 2700000 }, valores: { mayor: '2500000' } },
    // Una talla que ya NO está en la compra.
    'atributo:2': { nivel: 'atributo', id: 2, base: null, valores: { mayor: '1' } },
    // Una lista que no existe.
    'atributo:1': { nivel: 'atributo', id: 1, base: { final: 75000 }, valores: { fantasma: '5' } },
  };
  const nodos = pc.nodosAGuardar(cambios, LISTAS, vig);
  const por = Object.fromEntries(nodos.map((n) => [`${n.nivel}:${n.id}`, n.precios]));
  ok('★ el producto viaja con el mapa COMPLETO (lo no tocado se conserva)',
    JSON.stringify(por['producto:1']) === JSON.stringify({ mayor: 50000, final: 70000 }), JSON.stringify(por['producto:1']));
  ok('★ vaciar una casilla la quita', por['variante:1'] && Object.keys(por['variante:1']).length === 0);
  ok('lo que quedó igual no viaja', !('producto:2' in por));
  ok('la referencia con IMEI viaja con las dos listas',
    JSON.stringify(por['serial:1']) === JSON.stringify({ final: 2700000, mayor: 2500000 }));
  ok('★ lo que se quitó de la compra NO se guarda', !('atributo:2' in por));
  ok('una lista que no existe no cambia nada', !('atributo:1' in por));
  ok('sin `vigentes` se guarda todo lo tocado', pc.nodosAGuardar(cambios, LISTAS).some((n) => n.nivel === 'atributo' && n.id === 2));
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('4. Ida y vuelta contra la base');
{
  const cambios = {
    'producto:1': { nivel: 'producto', id: 1, base: DATOS.find((d) => d.nivel === 'producto' && d.id === 1).precios, valores: { final: '70000' } },
    'producto:2': { nivel: 'producto', id: 2, base: null, valores: { mayor: '12000', final: '18000' } },
    'variante:1': { nivel: 'variante', id: 1, base: { mayor: 48000 }, valores: { mayor: '' } },
  };
  const nodos = pc.nodosAGuardar(cambios, LISTAS, pc.clavesVigentes(LINEAS));
  const r = await svc.guardarPrecios(nodos, 1);
  ok('el mismo PUT de siempre lo acepta', r.guardados === 3 && !(r.no_encontrados || []).length, JSON.stringify(r));

  const despues = await svc.getPreciosParaCompra({ cantidad: '1,2' }, 1);
  const de = (nivel, id) => despues.find((d) => d.nivel === nivel && d.id === id)?.precios ?? null;
  ok('★ el producto quedó con «final» nuevo y «mayor» intacto',
    de('producto', 1)?.mayor === 50000 && de('producto', 1)?.final === 70000, JSON.stringify(de('producto', 1)));
  ok('el cable quedó con sus dos precios', de('producto', 2)?.mayor === 12000 && de('producto', 2)?.final === 18000);
  ok('el color vaciado quedó sin precio propio (hereda)', de('variante', 1) === null, JSON.stringify(de('variante', 1)));
  ok('lo que no se tocó no cambió', de('atributo', 1)?.final === 75000);

  // Un nodo de otro negocio no se escribe aunque alguien lo mande.
  const ajeno = await svc.guardarPrecios([{ nivel: 'producto', id: 3, precios: { mayor: 1 } }], 1);
  const [{ precios: p3 }] = (await db.query('SELECT precios FROM productos_cantidad WHERE id = 3')).rows;
  ok('★ un producto de otro negocio no se toca', p3.mayor === 900 && (ajeno.no_encontrados || []).length === 1);
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('5. Estática');
{
  const rutas = leer(RAIZ, 'src/modules/listas-precios/listasPrecios.routes.js');
  ok('la lectura va por GET /compra con nivel vendedor', /router\.get\('\/compra', requireNivel\('vendedor'\)/.test(rutas));
  ok('escribir sigue exigiendo el permiso de listas', /router\.put\('\/nodos', requirePermisoPreciosLista/.test(rutas));

  // Las seis pantallas: usan la sección y guardan los precios ANTES de registrar.
  const pantallas = [
    ['pages/proveedores/ModalCompra.jsx',  /await precios\.guardar\(lineasPrecios\);\s*return crearCompra\(payload\)/],
    ['pages/proveedores/ModalOrden.jsx',   /await precios\.guardar\(lineasPrecios\);\s*return editando/],
    ['pages/proveedores/ModalRecibir.jsx', /await precios\.guardar\(lineasPrecios\);\s*return registrarRecepcion\(\)/],
  ];
  for (const [archivo, re] of pantallas) {
    const src = leer(FRONT, archivo);
    ok(`${archivo.split('/').pop()}: pinta la sección`, src.includes('<PreciosVentaCompra'));
    ok(`${archivo.split('/').pop()}: guarda los precios ANTES de registrar`, re.test(src));
  }
  const agregar = leer(FRONT, 'pages/inventario/ModalAgregarProducto.jsx');
  ok('Inventario: la sección en los tres pasos (cliente, IMEI, cantidad)', (agregar.match(/<PreciosVentaCompra /g) || []).length === 3);
  ok('Inventario: los cuatro registros guardan precios primero',
    (agregar.match(/mutationFn: async \(\) => \{\s*await precios\.guardar\(lineasPrecios\);/g) || []).length === 4);

  const comp = leer(FRONT, 'components/ui/PreciosVentaCompra.jsx');
  ok('sin listas activas la sección no pinta nada', /if \(!ctl\.activo \|\| !hayAlgo\) return null;/.test(comp));
  ok('sin permiso, solo lectura', /if \(!puedeEditar\)/.test(comp));
  const hook = leer(FRONT, 'hooks/usePreciosCompra.js');
  ok('sin listas o sin permiso, guardar no manda nada', /activo && puedeEditar\s*\?\s*nodosAGuardar/.test(hook));
  ok('guarda por el mismo endpoint del editor de listas', hook.includes('guardarPreciosNodos(nodos)'));
  const entrada = leer(FRONT, 'pages/entradas/VistaEntrada.jsx');
  ok('la Entrada de bodega NO lo ofrece (el bodeguero recibe sin precios)', !entrada.includes('PreciosVentaCompra'));
}

console.log(`\n${'─'.repeat(60)}\n${pasados} verificaciones pasaron, ${fallos} fallaron`);
process.exit(fallos ? 1 : 0);
