// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTO ELIMINADO EN EL LOCAL Y VARIANTES DISTINTAS ENTRE SEDES — PGlite.
//
// Reportado desde producción (Tesla, 29-sep-2026): el envío #75 de la bodega a
// BUNNY MOBILE (10 × ML ORIGINALES APPLE LIGTHNING) no se dejaba recibir:
// «Ya existe un registro con ese valor único».
//
// La cadena:
//   1. En la importación del 6-sep a la bodega se le quitó la talla «SIN MARCA»
//      y a los locales no. El envío #74 llegó SIN talla a un producto que en
//      Bunny sí tenía: el producto decía 10 y su talla 0.
//   2. El admin, viendo la talla en 0, ELIMINÓ el producto en Bunny (baja
//      lógica, con las 10 unidades adentro) y volvió a despachar.
//   3. La recepción busca el destino solo entre productos ACTIVOS, no lo
//      encontró e intentó crearlo: el índice (nombre, sucursal_id) no es
//      parcial, cuenta al eliminado, y la base respondió 23505.
//
// Contrato que fija esta suite:
//   · sin nada eliminado, recibir crea la referencia como siempre (sección 1);
//   · un producto eliminado con el mismo nombre se REACTIVA, sin revivir el
//     stock que tenía al eliminarse (queda su renglón en el historial);
//   · un destino elegido que ya está eliminado no recibe stock a escondidas;
//   · variantes distintas entre sedes se rechazan con un mensaje que dice qué
//     igualar, al despachar y al recibir, en las dos direcciones;
//   · eliminar un producto con stock exige confirmarlo y deja historial;
//   · el 23505 del catálogo dice qué producto choca.
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
// Los índices de PRODUCCIÓN que el fixture no trae. El primero es el que
// explotó: (nombre, sucursal_id) SIN filtro de activo. El del código sí es
// parcial, y por eso el código nunca chocó.
await db.exec(`
  CREATE UNIQUE INDEX productos_cantidad_nombre_sucursal_id_key ON productos_cantidad (nombre, sucursal_id);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_productos_cantidad_codigo ON productos_cantidad (sucursal_id, codigo)
    WHERE codigo IS NOT NULL AND activo;
`);

const conectar = (t) => ({ query: (s, p) => t.query(s, p ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

const red       = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));
const productos = require(path.join(RAIZ, 'src/modules/productos/productosCantidad.service.js'));
const { errorHandler } = require(path.join(RAIZ, 'src/middlewares/error.middleware.js'));

let fallos = 0, pasados = 0;
function ok(nombre, cond, detalle = '') {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos++;
}
const seccion = (t) => console.log(`\n═══ ${t} ═══`);
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const falla = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const prod = async (id) => (await q('SELECT * FROM productos_cantidad WHERE id=$1', [id]))[0];
const enLocal = async (nombre) =>
  q('SELECT * FROM productos_cantidad WHERE sucursal_id=2 AND nombre=$1 ORDER BY id', [nombre]);

// ── Bodega + Bunny, catálogo por variantes ──────────────────────────────────
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Tesla');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'BODEGA'),(1,'BUNNY MOBILE');
  INSERT INTO usuarios (nombre) VALUES ('Admin'),('Bunny');
  INSERT INTO config_negocio VALUES
    (1,'red_interna_activa','1'),(1,'red_interna_bodega_id','1'),(1,'variantes_activo','1');
  INSERT INTO lineas_producto (negocio_id, nombre) VALUES (1,'AUDIO');
`);

const reqBodega = {
  user: { id: 1, negocio_id: 1, rol: 'admin_negocio' }, sucursal_id: 1, esBodega: true,
  red: { activa: true, bodega_id: 1, modo_precio: 'costo', confirmar_recepcion: true,
         confirmar_remesa: true, ocultar_costos: true },
};
const reqLocal = {
  user: { id: 2, negocio_id: 1, rol: 'supervisor' }, sucursal_id: 2, esBodega: false,
  red: { ...reqBodega.red },
};

/** Crea un producto en la bodega (plano, o con tallas {valor: stock}). */
const enBodega = async (nombre, { stock = 0, codigo = null, tallas = null } = {}) => {
  const total = tallas ? Object.values(tallas).reduce((s, x) => s + x, 0) : stock;
  const [p] = await q(`INSERT INTO productos_cantidad (sucursal_id, nombre, stock, costo_unitario, precio, linea_id, codigo)
                       VALUES (1,$1,$2,12000,14400,1,$3) RETURNING id`, [nombre, total, codigo]);
  const ids = {};
  for (const [valor, s] of Object.entries(tallas || {})) {
    const [a] = await q(`INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock, costo_unitario)
                         VALUES ($1,1,$2,$3,12000) RETURNING id`, [p.id, valor, s]);
    ids[valor] = a.id;
  }
  return { id: p.id, tallas: ids };
};
const despachar = (productoId, cantidad, extra = {}) => red.despachar(reqBodega, {
  sucursal_destino_id: 2,
  lineas: [{ tipo: 'cantidad', producto_id: productoId, cantidad, valor_interno: 14400, ...extra }],
});
const recibir = (remisionId) => red.recibir(reqLocal, remisionId, {});

// ═════════════════════════════════════════════════════════════════════════════
seccion('1. Sin nada eliminado: recibir crea la referencia como siempre');
{
  const b = await enBodega('CABLE NUEVO', { stock: 20, codigo: 'AUD-CAB-001' });
  const r = await despachar(b.id, 5);
  await recibir(Number(r.id));
  const locales = await enLocal('CABLE NUEVO');
  ok('nace UNA referencia en el local', locales.length === 1);
  ok('activa, con 5 uds y el código de la bodega',
    locales[0]?.activo && Number(locales[0].stock) === 5 && locales[0].codigo === 'AUD-CAB-001');
}

seccion('2. ★ El caso #75: el producto se eliminó en el local con stock adentro');
let bunny;
{
  const b = await enBodega('ML ORIGINALES APPLE LIGTHNING', { stock: 60, codigo: 'AUD-ML-SIN-046' });
  // Envío #74: llega bien.
  const r74 = await despachar(b.id, 10);
  await recibir(Number(r74.id));
  [bunny] = await enLocal('ML ORIGINALES APPLE LIGTHNING');
  ok('el #74 entró: 10 uds en el local', Number(bunny.stock) === 10);
  // El admin lo elimina "a la antigua": baja lógica con el stock adentro.
  await q('UPDATE productos_cantidad SET activo = false WHERE id = $1', [bunny.id]);

  const r75 = await despachar(b.id, 10);
  const err = await falla(() => recibir(Number(r75.id)));
  ok('★ el #75 se recibe (antes: 23505 «valor único»)', err === null, err?.message || err?.code);
  const filas = await enLocal('ML ORIGINALES APPLE LIGTHNING');
  ok('no nace una fila nueva: se reactiva la misma', filas.length === 1 && filas[0].id === bunny.id);
  const p = await prod(bunny.id);
  ok('queda activo', p.activo === true);
  ok('stock = los 10 del #75 (los 10 viejos NO reviven)', Number(p.stock) === 10, `stock ${p.stock}`);
  ok('conserva su código', p.codigo === 'AUD-ML-SIN-046');
  const hist = await q(`SELECT cantidad, notas FROM historial_stock_cantidad WHERE producto_id=$1 AND tipo='ajuste'`, [bunny.id]);
  ok('lo descartado queda en el historial (−10)',
    hist.length === 1 && Number(hist[0].cantidad) === -10 && /eliminarse/.test(hist[0].notas), JSON.stringify(hist));
  const [l] = await q('SELECT producto_destino_id, estado_linea FROM lineas_remision WHERE remision_id=$1', [r75.id]);
  ok('la línea apunta al producto reactivado', Number(l.producto_destino_id) === bunny.id && l.estado_linea === 'Recibida');
}

seccion('3. Eliminado SIN stock: se reactiva y no escribe historial de más');
{
  const b = await enBodega('VIDRIO 9D', { stock: 30 });
  const r1 = await despachar(b.id, 3);
  await recibir(Number(r1.id));
  const [loc] = await enLocal('VIDRIO 9D');
  await q('UPDATE productos_cantidad SET stock = 0, activo = false WHERE id = $1', [loc.id]);
  const r2 = await despachar(b.id, 4);
  const err = await falla(() => recibir(Number(r2.id)));
  ok('se recibe', err === null, err?.message);
  const p = await prod(loc.id);
  ok('reactivado con 4', p.activo && Number(p.stock) === 4);
  const [h] = await q(`SELECT count(*)::int n FROM historial_stock_cantidad WHERE producto_id=$1 AND tipo='ajuste'`, [loc.id]);
  ok('sin renglón de descarte (no había nada que descartar)', h.n === 0);
}

seccion('4. El código del eliminado ya lo usa otro producto: se suelta al reactivar');
{
  const b = await enBodega('FUNDA X', { stock: 10, codigo: 'EST-FUN-001' });
  // En el local: la funda eliminada con el código, y OTRO producto activo con ese código.
  await q(`INSERT INTO productos_cantidad (sucursal_id, nombre, stock, linea_id, codigo, activo)
           VALUES (2,'FUNDA X',0,1,'EST-FUN-001',false), (2,'FUNDA X RENOMBRADA',0,1,'EST-FUN-001',true)`);
  // El resolvedor encuentra al activo por CÓDIGO: para forzar el camino de
  // reactivación se quita ese código del activo y se le pone otro que choca.
  await q(`UPDATE productos_cantidad SET codigo='OTRO-1' WHERE nombre='FUNDA X RENOMBRADA'`);
  await q(`UPDATE productos_cantidad SET codigo='OTRO-1' WHERE sucursal_id=2 AND nombre='FUNDA X'`);
  const r = await despachar(b.id, 2);
  const err = await falla(() => recibir(Number(r.id)));
  ok('se recibe sin chocar con el índice del código', err === null, err?.message);
  const [f] = await enLocal('FUNDA X');
  ok('reactivada; soltó el código ocupado y tomó el de la bodega', f.activo && f.codigo === 'EST-FUN-001', f.codigo);
}

seccion('5. Un destino ELEGIDO que está eliminado no recibe stock a escondidas');
{
  const b = await enBodega('CARGADOR 20W', { stock: 10 });
  const [loc] = await q(`INSERT INTO productos_cantidad (sucursal_id, nombre, stock, linea_id, activo)
                         VALUES (2,'CARGADOR VIEJO',0,1,false) RETURNING id`);
  const err = await falla(() => despachar(b.id, 1, { producto_destino_id: loc.id }));
  ok('despachar hacia un producto eliminado se rechaza', err?.status === 400 && /eliminada/.test(err.message), err?.message);

  // Elegido activo al despachar y eliminado ANTES de recibir.
  await q('UPDATE productos_cantidad SET activo = true WHERE id=$1', [loc.id]);
  const r = await despachar(b.id, 1, { producto_destino_id: loc.id });
  await q('UPDATE productos_cantidad SET activo = false WHERE id=$1', [loc.id]);
  await recibir(Number(r.id));
  const viejo = await prod(loc.id);
  ok('el eliminado sigue en 0 (no se escondió nada ahí)', Number(viejo.stock) === 0 && viejo.activo === false);
  const [nuevo] = await enLocal('CARGADOR 20W');
  ok('la unidad llegó a una referencia visible', nuevo?.activo && Number(nuevo.stock) === 1);
}

seccion('6. Sin talla en la bodega, CON talla en el local: se rechaza');
{
  const b = await enBodega('AUDIFONOS PLANOS', { stock: 20, codigo: 'AUD-PLA-001' });
  const [loc] = await q(`INSERT INTO productos_cantidad (sucursal_id, nombre, stock, linea_id, codigo)
                         VALUES (2,'AUDIFONOS PLANOS',0,1,'AUD-PLA-001') RETURNING id`);
  await q(`INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock) VALUES ($1,2,'SIN MARCA',0)`, [loc.id]);

  const err = await falla(() => despachar(b.id, 5));
  ok('★ el despacho se rechaza antes de salir', err?.code === 'VARIANTES_DISTINTAS', err?.message);
  ok('el mensaje nombra la sede, el producto y la talla',
    /BUNNY MOBILE/.test(err?.message) && /AUDIFONOS PLANOS/.test(err?.message) && /SIN MARCA/.test(err?.message));
  const [n] = await q(`SELECT count(*)::int n FROM remisiones WHERE estado='En transito'`);
  ok('no deja un envío a medias', n.n === 0, `${n.n} en tránsito`);

  // Un envío que ya iba en camino antes de que el local creara la talla: la
  // recepción tiene la misma baranda y no mueve nada.
  await q(`UPDATE atributos_producto SET activo = false WHERE producto_id=$1`, [loc.id]);
  const r = await despachar(b.id, 5);
  await q(`UPDATE atributos_producto SET activo = true WHERE producto_id=$1`, [loc.id]);
  const e2 = await falla(() => recibir(Number(r.id)));
  ok('★ la recepción también se rechaza', e2?.code === 'VARIANTES_DISTINTAS', e2?.message);
  ok('nada se movió: bodega 20, local 0',
    Number((await prod(b.id)).stock) === 20 && Number((await prod(loc.id)).stock) === 0);
}

seccion('7. CON talla en la bodega, sin talla pero CON stock en el local: se rechaza');
{
  const b = await enBodega('CORREA', { tallas: { '38MM': 10 } });
  const [loc] = await q(`INSERT INTO productos_cantidad (sucursal_id, nombre, stock, linea_id)
                         VALUES (2,'CORREA',5,1) RETURNING id`);
  const err = await falla(() => despachar(b.id, 3, { atributo_id: b.tallas['38MM'] }));
  ok('★ se rechaza: crear la talla borraría las 5 que ya hay', err?.code === 'VARIANTES_DISTINTAS', err?.message);
  ok('el mensaje dice cuántas se perderían', /5 uds/.test(err?.message));

  // Con el local en 0, crear la primera talla no pierde nada: pasa.
  await q('UPDATE productos_cantidad SET stock = 0 WHERE id=$1', [loc.id]);
  const r = await despachar(b.id, 3, { atributo_id: b.tallas['38MM'] });
  const e2 = await falla(() => recibir(Number(r.id)));
  ok('con el local en 0 se recibe y nace la talla', e2 === null, e2?.message);
  const [a] = await q(`SELECT stock FROM atributos_producto WHERE producto_id=$1 AND valor='38MM'`, [loc.id]);
  ok('la talla quedó con 3 y el producto también', Number(a?.stock) === 3 && Number((await prod(loc.id)).stock) === 3);

  // Una talla NUEVA al lado de otras que ya existen tampoco rompe nada.
  const [a2] = await q(`INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock, costo_unitario)
                        VALUES ($1,1,'42MM',4,12000) RETURNING id`, [b.id]);
  await q('UPDATE productos_cantidad SET stock = stock + 4 WHERE id=$1', [b.id]);
  const r2 = await despachar(b.id, 2, { atributo_id: a2.id });
  const e3 = await falla(() => recibir(Number(r2.id)));
  ok('una talla nueva junto a las existentes pasa', e3 === null, e3?.message);
  ok('producto del local = 3 + 2', Number((await prod(loc.id)).stock) === 5);
}

seccion('8. Un nivel más abajo: talla sin colores con stock, llega un color');
{
  const b = await enBodega('ESTUCHE', { tallas: { 'IPHONE 15': 6 } });
  const [v] = await q(`INSERT INTO variantes_atributo (atributo_id, valor, stock, costo_unitario)
                       VALUES ($1,'NEGRO',6,12000) RETURNING id`, [b.tallas['IPHONE 15']]);
  const [loc] = await q(`INSERT INTO productos_cantidad (sucursal_id, nombre, stock, linea_id)
                         VALUES (2,'ESTUCHE',4,1) RETURNING id`);
  await q(`INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock) VALUES ($1,2,'IPHONE 15',4)`, [loc.id]);
  const err = await falla(() => despachar(b.id, 2, { atributo_id: b.tallas['IPHONE 15'], variante_id: v.id }));
  ok('★ se rechaza: el color nuevo borraría las 4 de la talla', err?.code === 'VARIANTES_DISTINTAS', err?.message);
}

seccion('9. Eliminar un producto con stock exige confirmarlo y deja historial');
{
  const [p] = await q(`INSERT INTO productos_cantidad (sucursal_id, nombre, stock, costo_unitario, linea_id)
                       VALUES (2,'PARA BORRAR',7,1000,1) RETURNING id`);
  const err = await falla(() => productos.eliminarProducto(1, p.id));
  ok('sin confirmar: 409 PRODUCTO_CON_STOCK', err?.status === 409 && err?.code === 'PRODUCTO_CON_STOCK', err?.message);
  ok('y no lo eliminó', (await prod(p.id)).activo === true);

  await productos.eliminarProducto(1, p.id, { forzar: true });
  const d = await prod(p.id);
  ok('confirmado: inactivo y en 0', d.activo === false && Number(d.stock) === 0);
  const hist = await q(`SELECT cantidad FROM historial_stock_cantidad WHERE producto_id=$1`, [p.id]);
  ok('el historial dice cuántas salieron (−7)', hist.length === 1 && Number(hist[0].cantidad) === -7);

  const [z] = await q(`INSERT INTO productos_cantidad (sucursal_id, nombre, stock, linea_id)
                       VALUES (2,'VACIO',0,1) RETURNING id`);
  await productos.eliminarProducto(1, z.id);
  ok('sin stock se elimina como siempre, sin confirmar', (await prod(z.id)).activo === false);
}

seccion('10. El 23505 del catálogo dice qué choca');
{
  const responder = (err) => {
    let out = null;
    const res = { status() { return this; }, json(b) { out = b; return this; } };
    const log = console.error; console.error = () => {};
    errorHandler(err, { method: 'POST', url: '/x' }, res, () => {});
    console.error = log;
    return out?.error;
  };
  const m1 = responder({
    code: '23505', constraint: 'productos_cantidad_nombre_sucursal_id_key',
    detail: 'Key (nombre, sucursal_id)=(ML ORIGINALES APPLE LIGTHNING, 49) already exists.',
  });
  ok('nombra el producto y explica el eliminado',
    /"ML ORIGINALES APPLE LIGTHNING"/.test(m1) && /eliminado/.test(m1), m1);
  const m2 = responder({
    code: '23505', constraint: 'productos_cantidad_nombre_sucursal_id_key',
    detail: 'Key (nombre, sucursal_id)=(CABLE 1, 2 Y 3, 49) already exists.',
  });
  ok('un nombre con comas sale entero', /"CABLE 1, 2 Y 3"/.test(m2), m2);
  const m3 = responder({
    code: '23505', constraint: 'uq_productos_cantidad_codigo',
    detail: 'Key (sucursal_id, codigo)=(49, AUD-ML-SIN-046) already exists.',
  });
  ok('el código duplicado nombra el código', /"AUD-ML-SIN-046"/.test(m3), m3);
  const m4 = responder({ code: '23505', constraint: 'otra_cosa', detail: 'x' });
  ok('lo demás conserva el mensaje de siempre', m4 === 'Ya existe un registro con ese valor único');
}

console.log(`\n${pasados} pasaron, ${fallos} fallaron`);
process.exit(fallos ? 1 : 0);
