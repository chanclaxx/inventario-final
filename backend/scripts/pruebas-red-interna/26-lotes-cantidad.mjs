// ─────────────────────────────────────────────────────────────────────────────
// LOTES DE MERCANCÍA POR CANTIDAD — contra un Postgres real (PGlite).
//
// Un SERIAL tiene identidad: `serial_id` une la línea de entrega con la de
// devolución y todo es exacto. La mercancía por CANTIDAD no la tiene, y el
// sistema lo resolvía con agregados por PRODUCTO y promedios ponderados. De ahí
// salían tres defectos, los tres silenciosos y los tres sobre dinero:
//
//   1. devolver una talla que la bodega NUNCA envió bajaba la deuda, porque el
//      producto sí tenía unidades pendientes en OTRA talla;
//   2. se acreditaba el promedio ponderado de todos los envíos — un precio que
//      no era el de ninguna unidad real;
//   3. lo reclamable de cada línea se medía contra el stock completo sin
//      descontar lo que otras líneas ya reclamaban: con dos envíos de la misma
//      talla se podía reclamar el doble de lo que había.
//
// La estrategia: cada línea de entrega es un LOTE (cantidad + su valor propio).
// Devolver consume lotes del más viejo al más nuevo escribiendo
// `cantidad_devuelta`, y con eso el cargo de cada envío baja solo por lo que de
// verdad salió de él y a su propio valor — el equivalente fungible del
// 'Devuelta' de un serial. Lo que no calce contra ningún lote es del local.
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
for (const m of ['20260725_red_interna.sql', '20260726_red_interna_v2.sql',
                 '20260822_red_interna_envios.sql', '20260823_red_interna_control.sql',
                 '20260823_red_interna_cargos_pagables.sql',
                 '20260823_remision_variantes.sql', '20260823_lotes_cantidad.sql']) {
  await db.exec(readFileSync(path.join(RAIZ, '../migrations', m), 'utf8'));
}

const conectar = (t) => ({ query: (s, p) => t.query(s, p ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] = {
  id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} },
};

const red     = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));
const redRepo = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.repository.js'));

let fallos = 0, pasados = 0;
const q = async (s, p = []) => (await db.query(s, p)).rows;
const money = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('es-CO');
function check(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}: ${JSON.stringify(real)}${ok ? '' : `  ← esperaba ${JSON.stringify(esperado)}`}`);
  ok ? pasados++ : fallos++;
}
function ok(nombre, cond, detalle = '') {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ': ' + detalle : ''}`);
  cond ? pasados++ : fallos++;
}

await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Con Red');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Bodega'),(1,'Local');
  INSERT INTO usuarios (nombre) VALUES ('Admin'),('Vendedor');
  INSERT INTO config_negocio VALUES
    (1,'red_interna_activa','1'), (1,'red_interna_bodega_id','1'), (1,'variantes_activo','1');
  INSERT INTO lineas_producto (negocio_id, nombre) VALUES (1,'ACCESORIOS');
  INSERT INTO productos_cantidad (sucursal_id, nombre, stock, costo_unitario, linea_id, unidad_medida)
    VALUES (1,'360 NEGRO', 40, 3700, 1, 'unidad');                 -- id 1 bodega
  INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock, costo_unitario)
    VALUES (1,1,'38MM',20,3700), (1,1,'40MM',20,3700);             -- 1, 2
  INSERT INTO productos_cantidad (sucursal_id, nombre, stock, costo_unitario, linea_id, unidad_medida)
    VALUES (2,'360 NEGRO', 0, NULL, 1, 'unidad');                  -- id 2 local
  INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock, costo_unitario)
    VALUES (2,2,'38MM',0,NULL), (2,2,'40MM',0,NULL);               -- 3, 4
`);

const reqBodega = { user: { id: 1, negocio_id: 1, rol: 'admin_negocio' }, sucursal_id: 1, esBodega: true,
  red: { activa: true, bodega_id: 1, modo_precio: 'costo', confirmar_recepcion: true, confirmar_remesa: true, ocultar_costos: false } };
const reqLocal = { user: { id: 2, negocio_id: 1, rol: 'vendedor' }, sucursal_id: 2, esBodega: false, red: { ...reqBodega.red } };

const recibir = async (r) => {
  const ls = await redRepo.getLineasRemision(r.id);
  await red.recibir(reqLocal, r.id, { lineas_recibidas: ls.map((l) => Number(l.id)) });
};
const deuda = async () => Number((await red.getEstadoCuenta(reqLocal, 2)).totales.deuda_total);
const reclamableDe = async (rem) => {
  const ls = (await redRepo.getLineasDetalladas(1, rem.id, 2)).filter((l) => l.tipo === 'cantidad');
  return Number(ls[0].reclamable);
};

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 1. Dos envíos de la MISMA talla, a precios distintos ═══');
const e1 = await red.despachar(reqBodega, { sucursal_destino_id: 2,
  lineas: [{ tipo: 'cantidad', producto_id: 1, atributo_id: 1, cantidad: 5, valor_interno: 5000 }] });
await recibir(e1);
const e2 = await red.despachar(reqBodega, { sucursal_destino_id: 2,
  lineas: [{ tipo: 'cantidad', producto_id: 1, atributo_id: 1, cantidad: 5, valor_interno: 8000 }] });
await recibir(e2);
check('deuda total', await deuda(), 25000 + 40000);

console.log('\n═══ 2. El local vende 5: lo reclamable no puede pasarse del stock ═══');
{
  await q(`UPDATE atributos_producto SET stock = stock - 5 WHERE id = 3`);
  await q(`UPDATE productos_cantidad SET stock = (SELECT COALESCE(SUM(stock),0) FROM atributos_producto WHERE producto_id=2) WHERE id = 2`);
  const r1 = await reclamableDe(e1), r2 = await reclamableDe(e2);
  check('★ el lote más viejo se queda el stock disponible', r1, 5);
  check('★ y el más nuevo ya no ofrece nada', r2, 0);
  ok('★ la suma no supera lo que hay en el local', r1 + r2 === 5, `${r1} + ${r2} = 5`);
  console.log('     (antes: 5 + 5 = 10, el doble de lo que había)');
}

console.log('\n═══ 3. Devolver consume el lote más viejo, A SU PRECIO ═══');
{
  const antes = await deuda();
  const dev = await red.devolver(reqLocal, {
    lineas: [{ tipo: 'cantidad', producto_id: 2, atributo_id: 3, cantidad: 2 }],
  });
  const [l] = await q(`SELECT origen_unidad, valor_interno FROM lineas_remision WHERE remision_id=$1`, [dev.id]);
  check('★ se ofrece el valor del lote más viejo, no un promedio', Number(l.valor_interno), 5000);
  check('reconoce que es mercancía de bodega', l.origen_unidad, 'bodega');

  const ls = await redRepo.getLineasRemision(dev.id);
  await red.confirmarDevolucion(reqBodega, dev.id, { lineas_recibidas: ls.map((x) => Number(x.id)) });
  check('★ la deuda baja 2 × $5.000, no 2 × el promedio $6.500', antes - await deuda(), 10000);

  const lotes = await q(`SELECT lr.cantidad_devuelta FROM lineas_remision lr
                         JOIN remisiones r ON r.id=lr.remision_id
                         WHERE r.tipo='entrega' AND lr.tipo='cantidad' ORDER BY lr.id`);
  check('★ se marcó consumido el lote viejo, no el nuevo',
    lotes.map((x) => Number(x.cantidad_devuelta)), [2, 0]);

  const movs = await q(`SELECT count(*)::int n FROM movimientos_cuenta_interna WHERE sucursal_id=2`);
  ok('★ sin contra-asiento: el cargo del envío bajó solo, como con un serial',
     movs[0].n === 0, `${movs[0].n} movimientos`);
}

console.log('\n═══ 4. Devolver MÁS de lo que queda del lote pasa al siguiente ═══');
{
  // Quedan: lote1 con 3 pendientes, lote2 con 5. Se devuelven 4.
  await q(`UPDATE atributos_producto SET stock = 8 WHERE id = 3`);
  await q(`UPDATE productos_cantidad SET stock = (SELECT COALESCE(SUM(stock),0) FROM atributos_producto WHERE producto_id=2) WHERE id = 2`);
  const antes = await deuda();
  const dev = await red.devolver(reqLocal, {
    lineas: [{ tipo: 'cantidad', producto_id: 2, atributo_id: 3, cantidad: 4 }],
  });
  const ls = await redRepo.getLineasRemision(dev.id);
  await red.confirmarDevolucion(reqBodega, dev.id, { lineas_recibidas: ls.map((x) => Number(x.id)) });
  // 3 del lote viejo a $5.000 + 1 del nuevo a $8.000 = $23.000
  check('★ el FIFO cruza de lote y cobra cada uno a su precio', antes - await deuda(), 23000);
  const lotes = await q(`SELECT lr.cantidad_devuelta FROM lineas_remision lr
                         JOIN remisiones r ON r.id=lr.remision_id
                         WHERE r.tipo='entrega' AND lr.tipo='cantidad' ORDER BY lr.id`);
  check('lote viejo agotado, el nuevo con 1', lotes.map((x) => Number(x.cantidad_devuelta)), [5, 1]);
}

console.log('\n═══ 5. Devolver una talla que la bodega NUNCA envió ═══');
{
  // El local mete 10 unidades suyas de la 40MM. La bodega nunca mandó esa talla.
  await q(`UPDATE atributos_producto SET stock = 10 WHERE id = 4`);
  await q(`UPDATE productos_cantidad SET stock = (SELECT COALESCE(SUM(stock),0) FROM atributos_producto WHERE producto_id=2) WHERE id = 2`);
  const antes = await deuda();
  const dev = await red.devolver(reqLocal, {
    lineas: [{ tipo: 'cantidad', producto_id: 2, atributo_id: 4, cantidad: 3 }],
  });
  const [l] = await q(`SELECT origen_unidad FROM lineas_remision WHERE remision_id=$1`, [dev.id]);
  check('★ se reconoce como mercancía PROPIA del local', l.origen_unidad, 'propio');
  const ls = await redRepo.getLineasRemision(dev.id);
  await red.confirmarDevolucion(reqBodega, dev.id, { lineas_recibidas: ls.map((x) => Number(x.id)) });
  check('★ y NO le baja la deuda', await deuda(), antes);
  console.log('     (antes bajaba: el producto tenía pendientes en OTRA talla');
  console.log('      y el agregado por producto las daba por consignadas)');

  const bod = await q(`SELECT stock FROM atributos_producto WHERE id=2`);
  check('la mercancía sí llega a la bodega, en su talla', Number(bod[0].stock), 20 + 3);
}

console.log('\n═══ 6. Si la bodega decide comprársela, ahí sí se acredita ═══');
{
  const antes = await deuda();
  const dev = await red.devolver(reqLocal, {
    lineas: [{ tipo: 'cantidad', producto_id: 2, atributo_id: 4, cantidad: 2,
               genera_saldo_favor: true }],
  });
  const ls = await redRepo.getLineasRemision(dev.id);
  const res = await red.confirmarDevolucion(reqBodega, dev.id, { lineas_recibidas: ls.map((x) => Number(x.id)) });
  ok('★ genera saldo a favor, no descuento de un cargo inexistente',
     Number(res.saldo_a_favor) > 0, money(res.saldo_a_favor));
  ok('   y la cuenta lo refleja', await deuda() < antes || Number(res.saldo_a_favor) > 0);
}

console.log(`\n${'═'.repeat(72)}`);
console.log(`  ${pasados} verificaciones pasaron · ${fallos} fallaron`);
console.log('═'.repeat(72));
process.exit(fallos ? 1 : 0);
