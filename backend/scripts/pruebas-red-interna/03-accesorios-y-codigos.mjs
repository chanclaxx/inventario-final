// ─────────────────────────────────────────────────────────────────────────────
// Despacho de PRODUCTOS DE CANTIDAD (accesorios) y CÓDIGO ÚNICO.
//
// Cubre lo que faltaba del flujo: escanear por código, buscar accesorios sin
// código, resolver los ítems del carrito de inventario al costo, y que la
// liquidación de accesorios (anclada en el stock) cuadre.
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
// El cruce de 'a quien se presto' toca prestamos/prestatarios, que viven aqui.
await db.exec(readFileSync(path.join(AQUI, 'esquema-completo.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260725_red_interna.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260726_red_interna_v2.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260822_red_interna_envios.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260823_red_interna_control.sql'), 'utf8'));

const conectar = (t) => ({ query: (s, p) => t.query(s, p ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id:'db', filename:'db', loaded:true, exports:{ pool, connectDB: async()=>{} } };

const service = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));
const repo    = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.repository.js'));

let fallos = 0, pasados = 0;
const q = async (s, p=[]) => (await db.query(s, p)).rows;
const money = (n) => '$' + Math.round(Number(n)).toLocaleString('es-CO');
function ok(nombre, cond, detalle='') {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos++;
}
function check(nombre, real, esperado) {
  const bien = Math.abs(Number(real) - Number(esperado)) < 1;
  console.log(`  ${bien ? '✓' : '✗'} ${nombre}: ${money(real)}${bien ? '' : ` ← esperaba ${money(esperado)}`}`);
  bien ? pasados++ : fallos++;
}

await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Test');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Bodega'),(1,'Centro');
  INSERT INTO usuarios (nombre) VALUES ('U');
  INSERT INTO config_negocio VALUES
    (1,'red_interna_activa','1'),(1,'red_interna_bodega_id','1'),
    (1,'codigo_producto_activo','1');
  INSERT INTO lineas_producto (negocio_id, nombre) VALUES (1,'Accesorios');

  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id)
    VALUES ('iPhone 13','Apple','128GB', 2600000, 1);
  INSERT INTO seriales (producto_id, imei, costo_compra) VALUES (1,'350000000000001',1800000);

  -- Accesorios en la bodega: uno con código, uno sin código, uno sin stock
  INSERT INTO productos_cantidad (nombre, stock, costo_unitario, precio, sucursal_id, linea_id, codigo)
    VALUES ('Cargador tipo C', 100, 8000, 20000, 1, 1, 'ACC-001'),
           ('Vidrio templado',  50, 3000, 12000, 1, 1, NULL),
           ('Cable HDMI',        0, 5000, 15000, 1, 1, 'ACC-999');
  INSERT INTO cuentas_dinero (negocio_id, sucursal_id, nombre, tipo, metodos_pago)
    VALUES (1,1,'Efectivo','efectivo',ARRAY['Efectivo']),(1,2,'Efectivo','efectivo',ARRAY['Efectivo']);
`);

const bodega = { user:{id:1,negocio_id:1,rol:'admin_negocio'}, sucursal_id:1, esBodega:true,
  red:{activa:true,bodega_id:1,confirmar_recepcion:true,confirmar_remesa:true, ocultar_costos: false } };
const centro = { user:{id:1,negocio_id:1,rol:'vendedor'}, sucursal_id:2, esBodega:false, red:{...bodega.red} };

console.log('\n═══ 1. El escáner acepta IMEI Y código en el mismo campo ═══');
const porImei = await service.buscarParaDespacho(bodega, '350000000000001');
ok('IMEI → devuelve un serial', porImei.tipo === 'serial', porImei.nombre);
check('  valorizado al costo del equipo', porImei.valor_interno, 1800000);

const porCodigo = await service.buscarParaDespacho(bodega, 'ACC-001');
ok('★ Código → devuelve un accesorio', porCodigo.tipo === 'cantidad', porCodigo.nombre);
check('  valorizado al costo unitario', porCodigo.valor_interno, 8000);
ok('  informa el stock disponible', porCodigo.stock === 100);

const enMinuscula = await service.buscarParaDespacho(bodega, 'acc-001');
ok('★ El código no distingue mayúsculas', enMinuscula.producto_id === porCodigo.producto_id);

let sinStock = false;
try { await service.buscarParaDespacho(bodega, 'ACC-999'); }
catch (e) { sinStock = e.status === 409; }
ok('★ Un accesorio sin stock se rechaza con mensaje claro', sinStock);

let noExiste = false;
try { await service.buscarParaDespacho(bodega, 'NO-EXISTE'); }
catch (e) { noExiste = e.status === 404; }
ok('Código inexistente → 404', noExiste);

console.log('\n═══ 2. Catálogo de accesorios (los que no tienen código) ═══');
const catalogo = await service.catalogoCantidad(bodega, '');
ok('★ Lista solo accesorios CON stock', catalogo.length === 2,
   catalogo.map(c=>c.nombre).join(', '));
ok('  el de stock 0 queda fuera', !catalogo.some((c) => c.nombre === 'Cable HDMI'));
const filtrado = await service.catalogoCantidad(bodega, 'vidrio');
ok('★ Busca por nombre', filtrado.length === 1 && filtrado[0].nombre === 'Vidrio templado');
const porCod = await service.catalogoCantidad(bodega, 'ACC-0');
ok('★ Busca también por código', porCod.length === 1 && porCod[0].codigo === 'ACC-001');

console.log('\n═══ 3. Resolver ítems del carrito (van al COSTO, no al precio) ═══');
const resuelto = await service.resolverItems(bodega, [
  { tipo:'serial',   serial_id: 1,   nombre: 'iPhone' },
  { tipo:'cantidad', producto_id: 1, cantidad: 10 },
  { tipo:'cantidad', producto_id: 3, cantidad: 5, nombre: 'Cable HDMI' }, // sin stock
  { tipo:'cantidad', producto_id: 999, nombre: 'Fantasma' },              // no existe
]);
ok('★ Resuelve los válidos', resuelto.items.length === 2);
ok('★ Descarta los que no se pueden', resuelto.descartados.length === 2,
   resuelto.descartados.map(d=>`${d.nombre}: ${d.motivo}`).join(' · '));
check('  el equipo va al costo (no al precio de venta $2.600.000)',
      resuelto.items.find(i=>i.tipo==='serial').valor_interno, 1800000);
check('  el accesorio va al costo (no a los $20.000 de venta)',
      resuelto.items.find(i=>i.tipo==='cantidad').valor_interno, 8000);

const recorte = await service.resolverItems(bodega, [
  { tipo:'cantidad', producto_id: 2, cantidad: 500 },  // pide más del stock (50)
]);
ok('★ Recorta al stock disponible en vez de fallar', recorte.items[0].cantidad === 50);

console.log('\n═══ 4. Despachar equipo + accesorios juntos ═══');
const rem = await service.despachar(bodega, {
  sucursal_destino_id: 2,
  lineas: [
    { tipo:'serial',   serial_id: 1 },
    { tipo:'cantidad', producto_id: 1, cantidad: 10 },  // cargadores
    { tipo:'cantidad', producto_id: 2, cantidad: 20 },  // vidrios
  ],
});
check('★ Total = 1.800.000 + 10×8.000 + 20×3.000',
      rem.valor_total, 1800000 + 80000 + 60000);

const stockAntes = await q(`SELECT id, stock FROM productos_cantidad WHERE sucursal_id=1 ORDER BY id`);
ok('★ El stock de la bodega NO se movió al despachar',
   stockAntes[0].stock === 100 && stockAntes[1].stock === 50);

console.log('\n═══ 5. Recibir con faltante parcial de accesorios ═══');
const lineas = await repo.getLineasRemision(rem.id);
const lineaCargador = lineas.find((l) => l.nombre_producto === 'Cargador tipo C');
const lineaVidrio   = lineas.find((l) => l.nombre_producto === 'Vidrio templado');
const lineaEquipo   = lineas.find((l) => l.tipo === 'serial');

// Llegaron 7 de los 10 cargadores; los vidrios completos; el equipo sí.
await service.recibir(centro, rem.id, {
  lineas_recibidas: [Number(lineaEquipo.id), Number(lineaCargador.id), Number(lineaVidrio.id)],
  cantidades: { [lineaCargador.id]: 7 },
});

const stocks = await q(`SELECT sucursal_id, nombre, stock, costo_unitario
                        FROM productos_cantidad ORDER BY sucursal_id, nombre`);
const bod = (n) => stocks.find(s => s.sucursal_id===1 && s.nombre===n);
const loc = (n) => stocks.find(s => s.sucursal_id===2 && s.nombre===n);
ok('★ Solo salieron 7 cargadores de la bodega', bod('Cargador tipo C').stock === 93,
   `quedan ${bod('Cargador tipo C').stock}`);
ok('★ Llegaron 7 al local', loc('Cargador tipo C').stock === 7);
ok('  los vidrios llegaron completos', loc('Vidrio templado').stock === 20);
check('★ El costo del accesorio viajó correcto al local', loc('Cargador tipo C').costo_unitario, 8000);

console.log('\n═══ 6. Los accesorios se deben desde que llegan ═══');
// Antes la deuda por accesorios se ESTIMABA contra el stock del local
// (entregado − devuelto − stock), y por eso bajaba sola si el local le compraba
// el mismo accesorio a otro proveedor. Ahora vale cantidad_recibida × valor.
let est = await service.getPanelLocal(centro);
const deudaInicial = Number(est.totales.deuda_total);
// Ojo: llegaron 7 de los 10 cargadores. Lo Faltante nunca carga.
check('★ La deuda incluye los accesorios desde la entrega, sin vender nada',
      deudaInicial, 1800000 + 7 * 8000 + 20 * 3000);
const cant = est.cantidad_consignada;
ok('Los accesorios aparecen en consignación', cant.length === 2);

console.log('\n   … el local vende 3 cargadores (el stock baja de 7 a 4)');
await db.exec(`UPDATE productos_cantidad SET stock = 4
               WHERE sucursal_id = 2 AND nombre = 'Cargador tipo C'`);
est = await service.getPanelLocal(centro);
check('★ Venderlos no cambia nada: ya los debía', est.totales.deuda_total, deudaInicial);

console.log('\n   … el local le compra 30 cargadores a OTRO proveedor');
await db.exec(`UPDATE productos_cantidad SET stock = stock + 30
               WHERE sucursal_id = 2 AND nombre = 'Cargador tipo C'`);
est = await service.getPanelLocal(centro);
check('★ Y comprarle a otro proveedor tampoco: antes esto BAJABA la deuda',
      est.totales.deuda_total, deudaInicial);
await db.exec(`UPDATE productos_cantidad SET stock = stock - 30
               WHERE sucursal_id = 2 AND nombre = 'Cargador tipo C'`);

console.log('\n   … y vende el iPhone de contado');
await db.exec(`
  INSERT INTO facturas (numero, sucursal_id, nombre_cliente, estado, fecha)
    VALUES (1, 2, 'Cliente', 'Activa', NOW());
  INSERT INTO lineas_factura (factura_id, nombre_producto, imei, cantidad, precio)
    VALUES (1, 'iPhone 13', '350000000000001', 1, 2600000);
  UPDATE seriales SET vendido = TRUE WHERE id = 1;
`);
est = await service.getPanelLocal(centro);
check('★ Vender el equipo tampoco la mueve', est.totales.deuda_total, deudaInicial);

console.log('\n═══ 7. Devolver accesorios de bodega SÍ baja la deuda ═══');
const vidrioLocal = (await q(
  `SELECT id FROM productos_cantidad WHERE sucursal_id = 2 AND nombre = 'Vidrio templado'`
))[0].id;
// La devolución nace en tránsito; la bodega la confirma y ahí se mueve.
const devolVidrio = await service.devolver({...centro, user:{...centro.user, rol:'supervisor'}}, {
  lineas: [{ tipo:'cantidad', producto_id: vidrioLocal, cantidad: 20 }],
});
ok('★ La devolución nace en tránsito', devolVidrio.estado === 'En transito');
const lVidrio = await repo.getLineasRemision(devolVidrio.id);
await service.confirmarDevolucion(bodega, devolVidrio.id, {
  lineas_recibidas: lVidrio.map((x) => Number(x.id)),
});
const stocks2 = await q(`SELECT sucursal_id, nombre, stock FROM productos_cantidad
                         WHERE nombre='Vidrio templado' ORDER BY sucursal_id`);
ok('★ Los vidrios volvieron a la bodega',
   Number(stocks2.find(s=>s.sucursal_id===1).stock) === 50 &&
   Number(stocks2.find(s=>s.sucursal_id===2).stock) === 0);
est = await service.getPanelLocal(centro);
// El accesorio no tiene línea de entrega propia que marcar 'Devuelta', así que
// se le acredita: 20 vidrios × $3.000 = $60.000. Sin esto el local devolvería
// la mercancía y la seguiría debiendo.
check('★ Devolverlos le acredita lo que le cobraron por ellos',
      est.totales.deuda_total, deudaInicial - 20 * 3000);

console.log('\n═══ 8. Un local NO puede despachar (solo la bodega) ═══');
let soloBodega = false;
try { await service.buscarParaDespacho(centro, 'ACC-001'); }
catch (e) { soloBodega = e.status === 403; }
ok('★ buscarParaDespacho bloqueado para un local', soloBodega);
let soloBodega2 = false;
try { await service.resolverItems(centro, [{ tipo:'cantidad', producto_id:1 }]); }
catch (e) { soloBodega2 = e.status === 403; }
ok('★ resolverItems bloqueado para un local', soloBodega2);

console.log(`\n${'═'.repeat(60)}`);
console.log(`RESULTADO: ${pasados} pasaron, ${fallos} fallaron`);
console.log('═'.repeat(60));
process.exit(fallos ? 1 : 0);
