// ─────────────────────────────────────────────────────────────────────────────
// REMISIÓN DE UN PRODUCTO POR VARIANTES — contra un Postgres real (PGlite).
//
// La red interna se escribió cuando el stock de un producto por cantidad vivía
// en `productos_cantidad.stock`. La feature "Variantes" lo bajó a
// `atributos_producto` / `variantes_atributo` y convirtió el del producto en un
// DERIVADO. La red interna no se enteró y seguía moviendo el nivel de arriba.
//
// En un catálogo por variantes —como el de este cliente, 255 de 334 productos—
// eso producía cuatro daños, todos silenciosos:
//   1. no se podía decir QUÉ talla se despachaba;
//   2. tras recibir, el producto decía 5 unidades y sus variantes sumaban 0;
//   3. el costo (el valor interno) se escribía en el producto y no en la
//      variante, así que la tarifa del local se quedaba sin base;
//   4. y el primer ajuste sobre CUALQUIER variante de ese producto disparaba
//      `sincronizarStockProducto`, que recalcula producto = Σ variantes y
//      BORRABA lo recibido — mientras el local seguía debiendo la mercancía.
//
// Esta suite recorre el día completo (despacho → recepción → tarifa → ajuste →
// devolución) y fija el contrato: **el stock se mueve en la hoja y el producto
// se recalcula**.
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
                 '20260823_remision_variantes.sql', '20260823_lotes_cantidad.sql', '20260823_valor_acreditado.sql']) {
  await db.exec(readFileSync(path.join(RAIZ, '../migrations', m), 'utf8'));
}

const conectar = (t) => ({ query: (text, params) => t.query(text, params ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] = {
  id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} },
};

const red       = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));
const redRepo   = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.repository.js'));
const variantes = require(path.join(RAIZ, 'src/modules/variantes-producto/variantes-producto.service.js'));

let fallos = 0, pasados = 0;
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const money = (n) => (n == null ? 'null' : '$' + Math.round(Number(n)).toLocaleString('es-CO'));
function check(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}: ${JSON.stringify(real)}${ok ? '' : `  ← esperaba ${JSON.stringify(esperado)}`}`);
  ok ? pasados++ : fallos++;
}
function ok(nombre, cond, detalle = '') {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ': ' + detalle : ''}`);
  cond ? pasados++ : fallos++;
}

// Invariante del árbol de cantidad: el producto es la suma de sus hojas.
const cuadra = async (productoId) => {
  const [p] = await q(`SELECT stock FROM productos_cantidad WHERE id=$1`, [productoId]);
  const [s] = await q(`SELECT COALESCE(SUM(stock),0)::int AS s FROM atributos_producto
                       WHERE producto_id=$1 AND activo`, [productoId]);
  return { producto: Number(p.stock), suma: Number(s.s), ok: Number(p.stock) === Number(s.s) };
};

// ── Configuración como la del cliente: casi todo activo, catálogo por variantes ──
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Con Red');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Bodega'),(1,'Local');
  INSERT INTO usuarios (nombre) VALUES ('Admin'),('Vendedor');
  INSERT INTO config_negocio VALUES
    (1,'red_interna_activa','1'), (1,'red_interna_bodega_id','1'),
    (1,'variantes_activo','1'),   (1,'codigo_producto_activo','1'),
    (1,'tarifas_activo','1'),
    (1,'tarifas_lista','[{"id":"frecuente","nombre":"Frecuente","porcentaje":2}]');
  INSERT INTO lineas_producto (negocio_id, nombre) VALUES (1,'ACCESORIOS');

  -- Bodega: el stock vive en las variantes (15 + 19 = 34)
  INSERT INTO productos_cantidad (sucursal_id, nombre, stock, costo_unitario, linea_id, unidad_medida)
    VALUES (1,'360 NEGRO', 34, 3700, 1, 'unidad');                 -- id 1
  INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock, costo_unitario, codigo)
    VALUES (1,1,'38MM',15,3700,'ACC-38M-001'),                     -- id 1
           (1,1,'40MM',19,3700,'ACC-40M-002');                     -- id 2

  -- Un producto SIN variantes, para comprobar que ese camino no cambió
  INSERT INTO productos_cantidad (sucursal_id, nombre, stock, costo_unitario, linea_id, unidad_medida)
    VALUES (1,'CABLE SUELTO', 10, 2000, 1, 'unidad');              -- id 2

  -- Local: catálogo replicado, sin stock ni costo
  INSERT INTO productos_cantidad (sucursal_id, nombre, stock, costo_unitario, linea_id, unidad_medida)
    VALUES (2,'360 NEGRO', 0, NULL, 1, 'unidad'),                  -- id 3
           (2,'CABLE SUELTO', 0, NULL, 1, 'unidad');               -- id 4
  INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock, costo_unitario, codigo)
    VALUES (3,2,'38MM',0,NULL,'ACC-38M-001'),                      -- id 3
           (3,2,'40MM',0,NULL,'ACC-40M-002');                      -- id 4
`);

const reqBodega = {
  user: { id: 1, negocio_id: 1, rol: 'admin_negocio' }, sucursal_id: 1, esBodega: true,
  red: { activa: true, bodega_id: 1, modo_precio: 'costo', confirmar_recepcion: true,
         confirmar_remesa: true, ocultar_costos: true },
};
const reqLocal = {
  user: { id: 2, negocio_id: 1, rol: 'vendedor' }, sucursal_id: 2, esBodega: false,
  red: { ...reqBodega.red },
};

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 1. Despachar sin decir la talla se RECHAZA ═══');
// Antes se aceptaba en silencio y de ahí salía todo el descuadre.
try {
  await red.despachar(reqBodega, {
    sucursal_destino_id: 2,
    lineas: [{ tipo: 'cantidad', producto_id: 1, cantidad: 5, valor_interno: 5000 }],
  });
  ok('★ pide elegir la variante', false, 'dejó despachar sin variante');
} catch (e) {
  ok('★ pide elegir la variante', e.codigo === 'VARIANTE_REQUERIDA', e.message);
}

console.log('\n═══ 2. Un producto SIN variantes se sigue despachando igual ═══');
{
  const r = await red.despachar(reqBodega, {
    sucursal_destino_id: 2,
    lineas: [{ tipo: 'cantidad', producto_id: 2, cantidad: 2, valor_interno: 2500 }],
  });
  check('valor de la remisión', Number(r.valor_total), 5000);
  const ls = await redRepo.getLineasRemision(r.id);
  await red.recibir(reqLocal, r.id, { lineas_recibidas: ls.map((l) => Number(l.id)) });
  const [bod] = await q(`SELECT stock FROM productos_cantidad WHERE id=2`);
  const [loc] = await q(`SELECT stock, costo_unitario FROM productos_cantidad WHERE id=4`);
  check('la bodega bajó a 8', Number(bod.stock), 8);
  check('el local subió a 2', Number(loc.stock), 2);
  check('y con el valor interno como costo', Number(loc.costo_unitario), 2500);
}

console.log('\n═══ 3. Despachar 5 unidades de la talla 38MM ═══');
const remision = await red.despachar(reqBodega, {
  sucursal_destino_id: 2,
  lineas: [{ tipo: 'cantidad', producto_id: 1, atributo_id: 1, cantidad: 5, valor_interno: 5000 }],
});
{
  const [l] = await q(`SELECT * FROM lineas_remision WHERE remision_id=$1`, [remision.id]);
  check('★ la línea guarda la variante de origen', Number(l.atributo_origen_id), 1);
  check('y el nombre la muestra', l.nombre_producto, '360 NEGRO / 38MM');
}

console.log('\n═══ 4. El local recibe: el stock se mueve en la VARIANTE ═══');
{
  const ls = await redRepo.getLineasRemision(remision.id);
  await red.recibir(reqLocal, remision.id, { lineas_recibidas: ls.map((l) => Number(l.id)) });

  const bod = await q(`SELECT valor, stock FROM atributos_producto WHERE producto_id=1 ORDER BY valor`);
  check('★ la bodega descontó de la 38MM (15→10), la 40MM intacta',
    bod.map((a) => [a.valor, Number(a.stock)]), [['38MM', 10], ['40MM', 19]]);

  const loc = await q(`SELECT valor, stock, costo_unitario FROM atributos_producto WHERE producto_id=3 ORDER BY valor`);
  check('★ el local recibió en la 38MM, la 40MM sigue en 0',
    loc.map((a) => [a.valor, Number(a.stock)]), [['38MM', 5], ['40MM', 0]]);

  const cb = await cuadra(1), cl = await cuadra(3);
  ok('★ la bodega cuadra: producto = Σ variantes', cb.ok, `${cb.producto} = ${cb.suma}`);
  ok('★ el local cuadra:  producto = Σ variantes', cl.ok, `${cl.producto} = ${cl.suma}`);

  const [l] = await q(`SELECT atributo_destino_id FROM lineas_remision WHERE remision_id=$1`, [remision.id]);
  check('la línea anotó a qué variante llegó', Number(l.atributo_destino_id), 3);
}

console.log('\n═══ 5. Base de la tarifa en el local = valor interno ═══');
{
  const [v] = await q(`SELECT costo_unitario FROM atributos_producto WHERE id=3`);
  check('★ la VARIANTE del local quedó con el valor interno', Number(v.costo_unitario), 5000);
  ok('   (con la tarifa del 2% el precio sale solo: ' + money(5000 * 1.02) + ')', true);
  const [b] = await q(`SELECT costo_unitario FROM atributos_producto WHERE id=1`);
  check('la variante de la BODEGA conserva su costo', Number(b.costo_unitario), 3700);
}

console.log('\n═══ 6. Ajustar una variante ya NO borra lo recibido ═══');
{
  const antes = await cuadra(3);
  await variantes.ajustarStockAtributo(1, 4, 3, {});   // +3 en la 40MM del local
  const desp = await cuadra(3);
  check('★ el producto pasó de 5 a 8 (5 recibidas + 3 nuevas)', desp.producto, 8);
  ok('★ y sigue cuadrando', desp.ok, `${desp.producto} = ${desp.suma}`);
  ok('   antes de este arreglo aquí se perdían las 5 recibidas', antes.producto === 5);
}

console.log('\n═══ 7. Trazabilidad: el historial dice qué variante se movió ═══');
{
  const h = await q(`SELECT producto_id, sucursal_id, cantidad, atributo_id
                     FROM historial_stock_cantidad WHERE tipo='traslado' AND producto_id IN (1,3)
                     ORDER BY id`);
  check('★ salida de la bodega marcada con su variante', [Number(h[0].cantidad), Number(h[0].atributo_id)], [-5, 1]);
  check('★ entrada al local marcada con la suya',        [Number(h[1].cantidad), Number(h[1].atributo_id)], [5, 3]);
}

console.log('\n═══ 8. El local devuelve 2 unidades de esa misma talla ═══');
{
  const dev = await red.devolver(reqLocal, {
    lineas: [{ tipo: 'cantidad', producto_id: 3, atributo_id: 3, cantidad: 2 }],
  });
  const ls = await redRepo.getLineasRemision(dev.id);
  check('la devolución nace con su variante', Number(ls[0].atributo_origen_id), 3);
  await red.confirmarDevolucion(reqBodega, dev.id, { lineas_recibidas: ls.map((l) => Number(l.id)) });

  const loc = await q(`SELECT valor, stock FROM atributos_producto WHERE producto_id=3 ORDER BY valor`);
  check('★ el local bajó la 38MM de 5 a 3', loc.map((a) => [a.valor, Number(a.stock)]), [['38MM', 3], ['40MM', 3]]);
  const bod = await q(`SELECT valor, stock FROM atributos_producto WHERE producto_id=1 ORDER BY valor`);
  check('★ la bodega recuperó en la 38MM (10→12)', bod.map((a) => [a.valor, Number(a.stock)]), [['38MM', 12], ['40MM', 19]]);

  const cb = await cuadra(1), cl = await cuadra(3);
  ok('★ las dos siguen cuadrando', cb.ok && cl.ok, `bodega ${cb.producto}=${cb.suma} · local ${cl.producto}=${cl.suma}`);
}


console.log('\n═══ 9. La vía del CARRITO conserva la talla ═══');
{
  // El carrito manda producto + atributo; `resolverItems` debe devolver el NODO,
  // no el producto pelado. Si se pierde aquí, el despacho vuelve a pedir la talla
  // (VARIANTE_REQUERIDA) y el modal la muestra sin variante — que es justo lo que
  // se reportó desde producción.
  const r = await red.resolverItems(reqBodega, [
    { tipo: 'cantidad', producto_id: 1, atributo_id: 2, cantidad: 4, nombre: '360 NEGRO' },
  ]);
  const it = r.items[0];
  check('★ conserva el atributo que venía del carrito', Number(it?.atributo_id), 2);
  check('★ y lo muestra en el nombre', it?.nombre, '360 NEGRO / 40MM');
  check('  con la talla también aparte, para pintarla como etiqueta', it?.variante_label, '40MM');
  check('★ y el stock de ESA talla, no el del producto', Number(it?.stock), 19);

  // Sin talla, un producto por variantes se descarta con un motivo legible en
  // vez de dejar que reviente más adelante.
  const r2 = await red.resolverItems(reqBodega, [
    { tipo: 'cantidad', producto_id: 1, cantidad: 1, nombre: '360 NEGRO' },
  ]);
  ok('★ sin talla lo descarta con un motivo claro, no revienta',
     r2.items.length === 0 && /variantes/.test(r2.descartados[0]?.motivo || ''),
     r2.descartados[0]?.motivo);
}
console.log(`\n${'═'.repeat(72)}`);
console.log(`  ${pasados} verificaciones pasaron · ${fallos} fallaron`);
console.log('═'.repeat(72));
process.exit(fallos ? 1 : 0);
