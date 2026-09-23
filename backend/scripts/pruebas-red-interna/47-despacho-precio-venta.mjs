// ─────────────────────────────────────────────────────────────────────────────
// EL DESPACHO PREGRABA EL PRECIO DE VENTA — contra un Postgres real (PGlite).
//
// Decisión del negocio (sep-2026): al despachar de la bodega a un local, el
// valor de cada línea sale pregrabado con el PRECIO DE VENTA de la bodega, y
// sigue siendo editable. Antes salía el costo.
//
// Contrato que fija esta suite:
//   1. La búsqueda del despacho (escáner, lista de accesorios y carrito) trae
//      `precio_venta` resuelto HACIA ARRIBA: variante > atributo > producto, y
//      en un serial el precio de la unidad gana sobre el de la referencia.
//   2. `valor_interno` sigue siendo el COSTO. Vercel y Railway se despliegan por
//      separado: un frontend viejo contra este backend despacha igual que antes.
//   3. La pantalla (`conValorInicial`, extraída del .jsx real) elige el precio
//      de venta, cae al costo cuando no hay precio, y congela el costo para el
//      aviso de dedazo.
//   4. EL PRECIO DEL CARRITO MANDA (sep-2026): si en el carrito se tocó «Al por
//      mayor», el envío entero sale a ese precio sin teclear línea por línea.
//      Y con las listas activas el modal puede cambiar TODO el envío de lista
//      de un toque, porque cada línea ya viaja con sus `precios`.
//
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

const db = new PGlite();
await db.exec(readFileSync(path.join(AQUI, 'esquema.sql'), 'utf8'));
await db.exec(readFileSync(path.join(AQUI, 'esquema-completo.sql'), 'utf8'));
for (const m of [
  '20260725_red_interna.sql', '20260726_red_interna_v2.sql', '20260822_red_interna_envios.sql',
  '20260823_red_interna_control.sql', '20260823_red_interna_cargos_pagables.sql',
  '20260823_remision_variantes.sql', '20260823_lotes_cantidad.sql',
  '20260824_costo_origen_remision.sql', '20260823_valor_acreditado.sql',
]) {
  await db.exec(readFileSync(path.join(RAIZ, '../migrations', m), 'utf8'));
}

const conectar = (t) => ({ query: (s, p) => t.query(s, p ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

// Las listas de precios: la MISMA migración que corre en producción.
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260912_listas_precios.sql'), 'utf8'));
require(path.join(RAIZ, 'src/config/columnas.js'))._setListasPreciosDisponible(true);

const service = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));

let fallos = 0, pasados = 0;
function ok(nombre, cond, detalle = '') {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos++;
}
const seccion = (t) => console.log(`\n── ${t}`);

await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Test');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Bodega'),(1,'Centro');
  INSERT INTO usuarios (nombre) VALUES ('U');
  INSERT INTO config_negocio VALUES
    (1,'red_interna_activa','1'),(1,'red_interna_bodega_id','1'),(1,'codigo_producto_activo','1');
  INSERT INTO lineas_producto (negocio_id, nombre) VALUES (1,'Accesorios'),(1,'Celulares');

  -- 1) Accesorio plano con precio y costo
  INSERT INTO productos_cantidad (nombre, stock, costo_unitario, precio, sucursal_id, linea_id, codigo)
    VALUES ('Cable USB-C', 40, 5000, 15000, 1, 1, 'CAB-1');
  -- 2) Accesorio SIN precio de venta: tiene que caer al costo
  INSERT INTO productos_cantidad (nombre, stock, costo_unitario, precio, sucursal_id, linea_id, codigo)
    VALUES ('Protector', 10, 3000, NULL, 1, 1, 'PRO-1');
  -- 3) Correa con tallas: 38MM hereda el precio del producto, 42MM tiene el suyo
  INSERT INTO productos_cantidad (nombre, stock, costo_unitario, precio, sucursal_id, linea_id)
    VALUES ('Correa', 0, 20000, 60000, 1, 1);
  INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock, costo_unitario, precio, codigo)
    VALUES (3, 1, '38MM', 5, NULL, NULL, 'COR-38'),
           (3, 1, '42MM', 5, 22000, 70000, 'COR-42');
  -- 4) Audífonos con color bajo el atributo: la variante Blanco tiene precio propio
  INSERT INTO productos_cantidad (nombre, stock, costo_unitario, precio, sucursal_id, linea_id)
    VALUES ('Audífonos', 0, 30000, 90000, 1, 1);
  INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock, costo_unitario, precio)
    VALUES (4, 1, 'BT', 0, NULL, 95000);
  INSERT INTO variantes_atributo (atributo_id, producto_id, valor, stock, costo_unitario, precio, codigo)
    VALUES (3, 4, 'Blanco', 4, NULL, 99000, 'AUD-BLA'),
           (3, 4, 'Negro',  4, NULL, NULL,  'AUD-NEG');

  -- Listas de precios: «mayor» y «final», con la herencia por niveles que el
  -- despacho tiene que respetar (la talla sobrescribe una y conserva la otra).
  UPDATE productos_cantidad SET precios = '{"mayor":12000,"final":18000}' WHERE codigo = 'CAB-1';
  UPDATE productos_cantidad SET precios = '{"mayor":50000,"final":80000}' WHERE nombre = 'Correa';
  UPDATE atributos_producto  SET precios = '{"mayor":65000}'              WHERE codigo = 'COR-42';

  -- 5) Equipos: uno con precio propio, otro que hereda, otro sin precio ni costo
  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id, linea_id)
    VALUES ('iPhone 13','Apple','128GB', 2600000, 1, 2),
           ('Moto G','Motorola','64GB', NULL, 1, 2);
  -- Los precios de un equipo viven en la REFERENCIA, no en la unidad.
  UPDATE productos_serial SET precios = '{"mayor":2400000}' WHERE nombre = 'iPhone 13';
  INSERT INTO seriales (producto_id, imei, costo_compra, precio) VALUES
    (1, 'IMEI-PROPIO',   2000000, 2450000),
    (1, 'IMEI-HEREDA',   2000000, NULL),
    (2, 'IMEI-SINNADA',  NULL,    NULL);
`);

const bodega = { user: { id: 1, negocio_id: 1, rol: 'admin_negocio' }, sucursal_id: 1, esBodega: true,
  red: { activa: true, bodega_id: 1, confirmar_recepcion: true, confirmar_remesa: true } };

// ── La función REAL de la pantalla, extraída del .jsx ────────────────────────
// Un respaldo copiado a mano se separa del original sin que nadie lo note.
const jsx = readFileSync(path.join(RAIZ, '../frontend/src/pages/red-interna/ModalDespachar.jsx'), 'utf8');
const trozo = (re, nombre) => {
  const m = jsx.match(re);
  if (!m) { console.error(`✗ No se encontró ${nombre} en ModalDespachar.jsx`); process.exit(1); }
  return m[0];
};
const fuentes = [
  trozo(/const conValorInicial = \(item, lista = null\) => \{[\s\S]*?\n\};/, 'conValorInicial'),
  trozo(/const valorSegunLista = \(item, lista\) => \{[\s\S]*?\n\};/, 'valorSegunLista'),
  trozo(/const sinPrecioEnLista = \(items, lista\) => \([\s\S]*?\n\);/, 'sinPrecioEnLista'),
].join('\n');
// `precioEnLista` es del util compartido del frontend: se importa de verdad, no
// se reescribe, o la prueba mediría una copia que puede separarse.
const { precioEnLista } = await import(
  'file://' + path.resolve(RAIZ, '../frontend/src/utils/listasPrecios.js').replace(/\\/g, '/'));
const [conValorInicial, valorSegunLista, sinPrecioEnLista] = new Function('precioEnLista',
  `${fuentes}; return [conValorInicial, valorSegunLista, sinPrecioEnLista];`)(precioEnLista);

// Cómo re-precifica el modal al cambiar de lista (la misma expresión de
// `aplicarLista`, que vive dentro del componente y no se puede extraer).
const aplicarLista = (items, lista) => items.map((i) => {
  const valor = valorSegunLista(i, lista) || Number(i.costo_real || 0);
  return { ...i, valor_interno: valor, sin_costo: valor === 0 };
});

// ─────────────────────────────────────────────────────────────────────────────
seccion('1. Escáner: el precio sale resuelto hacia arriba y el costo no cambia');
{
  const cable = await service.buscarParaDespacho(bodega, 'CAB-1');
  ok('producto plano trae su precio', cable.precio_venta === 15000, `precio=${cable.precio_venta}`);
  ok('valor_interno sigue siendo el costo (frontend viejo)', cable.valor_interno === 5000);

  const c38 = await service.buscarParaDespacho(bodega, 'COR-38');
  ok('atributo sin precio hereda el del producto', c38.precio_venta === 60000, `precio=${c38.precio_venta}`);
  ok('…y hereda también el costo', c38.valor_interno === 20000);

  const c42 = await service.buscarParaDespacho(bodega, 'COR-42');
  ok('atributo con precio propio usa el suyo', c42.precio_venta === 70000, `precio=${c42.precio_venta}`);

  const bla = await service.buscarParaDespacho(bodega, 'AUD-BLA');
  ok('variante con precio propio usa el suyo', bla.precio_venta === 99000, `precio=${bla.precio_venta}`);
  const neg = await service.buscarParaDespacho(bodega, 'AUD-NEG');
  ok('variante sin precio hereda el del ATRIBUTO, no el del producto', neg.precio_venta === 95000,
    `precio=${neg.precio_venta}`);

  const pro = await service.buscarParaDespacho(bodega, 'PRO-1');
  ok('sin precio de venta llega en 0 (la pantalla cae al costo)', pro.precio_venta === 0);

  const propio = await service.buscarParaDespacho(bodega, 'IMEI-PROPIO');
  ok('serial: el precio de la unidad gana sobre la referencia', propio.precio_venta === 2450000,
    `precio=${propio.precio_venta}`);
  ok('serial: valor_interno sigue siendo costo_compra', propio.valor_interno === 2000000);
  const hereda = await service.buscarParaDespacho(bodega, 'IMEI-HEREDA');
  ok('serial sin precio propio hereda el de la referencia', hereda.precio_venta === 2600000);
}

seccion('2. Lista de accesorios y carrito traen el mismo precio que el escáner');
{
  const lista = await service.catalogoCantidad(bodega, '');
  const por = (n) => lista.find((x) => x.nombre === n);
  ok('lista: producto plano', por('Cable USB-C')?.precio_venta === 15000);
  ok('lista: talla heredada', por('Correa / 38MM')?.precio_venta === 60000);
  ok('lista: variante propia', por('Audífonos / BT / Blanco')?.precio_venta === 99000);

  const { items, descartados } = await service.resolverItems(bodega, [
    { tipo: 'serial',   serial_id: 1, precio: 2500000 },
    { tipo: 'cantidad', producto_id: 3, atributo_id: 2, cantidad: 2 },
    { tipo: 'cantidad', producto_id: 4, atributo_id: 3, variante_id: 2, cantidad: 1 },
  ]);
  ok('carrito: nada descartado', descartados.length === 0, JSON.stringify(descartados));
  ok('carrito: serial con su precio', items[0]?.precio_venta === 2450000);
  ok('carrito: el precio del carrito sigue llegando aparte', items[0]?.precio_carrito === 2500000);
  ok('carrito: talla con su precio', items[1]?.precio_venta === 70000);
  ok('carrito: variante heredada del atributo', items[2]?.precio_venta === 95000);
}

seccion('3. La pantalla pregraba el precio y cae al costo');
{
  const cable = conValorInicial(await service.buscarParaDespacho(bodega, 'CAB-1'));
  ok('valor pregrabado = precio de venta', cable.valor_interno === 15000);
  ok('costo_real congelado con el COSTO (aviso de dedazo)', cable.costo_real === 5000);
  ok('no se marca en $0', cable.sin_costo === false);

  const pro = conValorInicial(await service.buscarParaDespacho(bodega, 'PRO-1'));
  ok('sin precio: pregraba el costo, como antes', pro.valor_interno === 3000);

  const nada = conValorInicial(await service.buscarParaDespacho(bodega, 'IMEI-SINNADA'));
  ok('sin precio ni costo: sale en 0 y se marca', nada.valor_interno === 0 && nada.sin_costo === true);

  const dosVeces = conValorInicial(cable);
  ok('aplicarla dos veces no convierte el precio en costo', dosVeces.costo_real === 5000
    && dosVeces.valor_interno === 15000);

  const viejo = conValorInicial({ tipo: 'cantidad', valor_interno: 8000, sin_costo: false });
  ok('backend viejo (sin precio_venta): queda el costo', viejo.valor_interno === 8000 && viejo.costo_real === 8000);
}

seccion('4. Despachar con el valor pregrabado lo guarda en la línea');
{
  const cable = conValorInicial(await service.buscarParaDespacho(bodega, 'CAB-1'));
  const r = await service.despachar(bodega, {
    sucursal_destino_id: 2,
    lineas: [{ tipo: 'cantidad', producto_id: cable.producto_id, cantidad: 2, valor_interno: cable.valor_interno }],
  });
  const remisionId = r?.id ?? r?.remision?.id ?? r?.remision_id;
  const { rows } = await db.query(
    'SELECT valor_interno, costo_origen FROM lineas_remision WHERE remision_id = $1', [remisionId]);
  ok('la línea sale al precio de venta', Number(rows[0]?.valor_interno) === 15000,
    `valor=${rows[0]?.valor_interno}`);
  ok('el costo de la bodega se sigue congelando aparte', Number(rows[0]?.costo_origen) === 5000,
    `costo_origen=${rows[0]?.costo_origen}`);
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('5. EL PRECIO DEL CARRITO MANDA (no hay que teclear línea por línea)');
{
  const cable = await service.buscarParaDespacho(bodega, 'CAB-1');

  // Lo que el carrito ya decidió —una lista, una tarifa o un precio a mano—
  // sale tal cual: es el punto de la feature.
  const delCarrito = conValorInicial({ ...cable, precio_carrito: 12000 });
  ok('★ sale al precio con el que venía del carrito', delCarrito.valor_interno === 12000,
    `valor=${delCarrito.valor_interno}`);
  ok('…y el costo se sigue congelando aparte', delCarrito.costo_real === 5000);

  // Sin carrito (escáner o accesorios dentro del modal) manda el de la bodega.
  ok('sin precio del carrito manda el de la bodega',
    conValorInicial(cable).valor_interno === 15000);

  // Un precio del carrito en 0 no puede regalar la mercancía al local: cae al
  // precio de la bodega, como cualquier línea sin precio. (El carrito ya no
  // manda el 0 de un obsequio, pero la pantalla no depende de eso.)
  ok('un precio del carrito en 0 cae al de la bodega',
    conValorInicial({ ...cable, precio_carrito: 0 }).valor_interno === 15000);
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('6. Las líneas traen los precios de las listas (y se heredan)');
{
  const cable = await service.buscarParaDespacho(bodega, 'CAB-1');
  ok('el producto trae su mapa de precios', cable.precios?.mayor === 12000,
    JSON.stringify(cable.precios));

  // Herencia CLAVE POR CLAVE: la talla pone lo suyo y conserva lo del producto.
  const c42 = await service.buscarParaDespacho(bodega, 'COR-42');
  ok('la talla sobrescribe su lista', c42.precios?.mayor === 65000, JSON.stringify(c42.precios));
  ok('…y conserva la otra lista del producto', c42.precios?.final === 80000);

  const c38 = await service.buscarParaDespacho(bodega, 'COR-38');
  ok('la talla sin precios propios hereda los del producto',
    c38.precios?.mayor === 50000 && c38.precios?.final === 80000, JSON.stringify(c38.precios));

  const propio = await service.buscarParaDespacho(bodega, 'IMEI-PROPIO');
  ok('un equipo trae los precios de su REFERENCIA', propio.precios?.mayor === 2400000,
    JSON.stringify(propio.precios));

  // El camino del carrito (resolverItemsCarrito) también los trae.
  const delCarrito = await service.resolverItems(bodega, [
    { tipo: 'cantidad', producto_id: 1, cantidad: 1 },
  ]);
  ok('los ítems traídos del carrito también', delCarrito.items[0]?.precios?.mayor === 12000);
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('7. Una lista re-precifica TODO el envío de un toque');
{
  const MAYOR = { id: 'mayor', nombre: 'Al por mayor' };
  const base = [
    conValorInicial(await service.buscarParaDespacho(bodega, 'CAB-1')),
    conValorInicial(await service.buscarParaDespacho(bodega, 'COR-42')),
    conValorInicial(await service.buscarParaDespacho(bodega, 'PRO-1')),   // sin precio ni lista
  ];
  ok('antes: cada uno a su precio de venta',
    base[0].valor_interno === 15000 && base[1].valor_interno === 70000);

  const conMayor = aplicarLista(base, MAYOR);
  ok('★ con «Al por mayor» todas las líneas cambian a la vez',
    conMayor[0].valor_interno === 12000 && conMayor[1].valor_interno === 65000,
    `${conMayor[0].valor_interno} / ${conMayor[1].valor_interno}`);
  ok('lo que no está en la lista NO queda en $0: cae al precio de la bodega',
    conMayor[2].valor_interno === 3000, `valor=${conMayor[2].valor_interno}`);
  ok('…y se avisa cuántos quedaron fuera', sinPrecioEnLista(base, MAYOR) === 1,
    `${sinPrecioEnLista(base, MAYOR)}`);
  ok('el costo sigue congelado aparte', conMayor[0].costo_real === 5000);

  // Quitar la lista devuelve a cada línea el precio con el que llegó.
  const sinLista = aplicarLista(conMayor, null);
  ok('quitar la lista vuelve al precio de siempre',
    sinLista[0].valor_interno === 15000 && sinLista[1].valor_interno === 70000);

  // Lo que venía del carrito manda sobre el precio de la bodega al quitar la lista.
  const delCarrito = aplicarLista(
    [conValorInicial({ ...(await service.buscarParaDespacho(bodega, 'CAB-1')), precio_carrito: 13500 })],
    null);
  ok('…y si venía del carrito, ese es el que vuelve', delCarrito[0].valor_interno === 13500);

  // Y despachar con eso deja el valor en la línea de la remisión.
  const r = await service.despachar(bodega, {
    sucursal_destino_id: 2,
    lineas: [{ tipo: 'cantidad', producto_id: conMayor[0].producto_id, cantidad: 1,
               valor_interno: conMayor[0].valor_interno }],
  });
  const remisionId = r?.id ?? r?.remision?.id ?? r?.remision_id;
  const { rows } = await db.query(
    'SELECT valor_interno FROM lineas_remision WHERE remision_id = $1', [remisionId]);
  ok('el envío queda al precio de la lista', Number(rows[0]?.valor_interno) === 12000,
    `valor=${rows[0]?.valor_interno}`);
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('8. SIN la migración de listas, el despacho no cambia');
{
  const columnas = require(path.join(RAIZ, 'src/config/columnas.js'));
  columnas._setListasPreciosDisponible(false);
  const cable = await service.buscarParaDespacho(bodega, 'CAB-1');
  ok('la línea llega sin precios y no revienta', cable.precios === null,
    JSON.stringify(cable.precios));
  ok('y sigue pregrabando el precio de venta de siempre',
    conValorInicial(cable).valor_interno === 15000);
  columnas._setListasPreciosDisponible(true);
}

console.log(`\n${'═'.repeat(60)}\n  ${pasados} verificaciones pasaron · ${fallos} fallaron\n${'═'.repeat(60)}`);
process.exit(fallos ? 1 : 0);
