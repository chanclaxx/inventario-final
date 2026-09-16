// ─────────────────────────────────────────────────────────────────────────────
// STOCK COMPROMETIDO EN ENVÍOS SIN RECIBIR — contra un Postgres real (PGlite).
//
// Reportado desde producción (Tesla, sep-2026): el envío #21 de la bodega a
// BUNNY MOBILE (111 líneas) no se dejaba recibir. «Recibí todo» tardaba y
// terminaba en «No se pudo recibir el envío», sin motivo.
//
// Dos defectos, uno encima del otro:
//   1. DESPACHAR no descuenta stock (la mercancía es de la bodega hasta que el
//      local confirma) y validaba solo contra `stock`. La bodega tenía 7 cases
//      VX09 / IPHONE 14 PRO MAX, mandó 7 en el #20 y, antes de que el local lo
//      recibiera, 1 más en el #21. El #20 entró; el #21 quedó imposible.
//   2. RECIBIR validaba el stock sobre la marcha, a ~25 consultas por línea. La
//      línea mala era la 75: la petición pasaba del corte de 30 s del navegador
//      antes de llegar al error, y la pantalla no tenía qué mostrar.
//
// Contrato que fija esta suite:
//   · despachar resta lo que ya va en envíos sin recibir del MISMO nodo;
//   · anular o recibir un envío libera lo que tenía comprometido;
//   · recibir revisa TODO antes de mover nada, nombra todas las líneas que
//     fallan y responde sin recorrer las anteriores;
//   · desmarcar la línea mala deja recibir el resto;
//   · la devolución del local tiene la misma baranda.
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
const FRONT = path.resolve(RAIZ, '../frontend/src');

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

// Contador de consultas: la sección 6 mide cuánto trabajo hace una recepción
// que va a fallar antes de responder.
let consultas = 0;
const conectar = (t) => ({ query: (s, p) => { consultas++; return t.query(s, p ?? []); } });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

const red     = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));
const redRepo = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.repository.js'));

let fallos = 0, pasados = 0;
function ok(nombre, cond, detalle = '') {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos++;
}
const seccion = (t) => console.log(`\n═══ ${t} ═══`);
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const stockAtr = async (id) => Number((await q('SELECT stock FROM atributos_producto WHERE id=$1', [id]))[0].stock);
const falla = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

// ── El montaje de Tesla: bodega + local, catálogo por variantes ─────────────
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Tesla');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'BODEGA'),(1,'BUNNY MOBILE');
  INSERT INTO usuarios (nombre) VALUES ('Bodeguero'),('Vendedor');
  INSERT INTO config_negocio VALUES
    (1,'red_interna_activa','1'),(1,'red_interna_bodega_id','1'),(1,'variantes_activo','1');
  INSERT INTO lineas_producto (negocio_id, nombre) VALUES (1,'ESTUCHES');

  -- id 1: el case, con el stock en las tallas
  INSERT INTO productos_cantidad (sucursal_id, nombre, stock, costo_unitario, linea_id, unidad_medida)
    VALUES (1,'CASE LUJO VX09', 17, 9000, 1, 'unidad');
  INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock, costo_unitario)
    VALUES (1,1,'IPHONE 14 PRO MAX', 7, 9000),     -- id 1: el nodo del reporte
           (1,1,'IPHONE 15', 10, 9000);            -- id 2
  -- id 2: producto SIN variantes
  INSERT INTO productos_cantidad (sucursal_id, nombre, stock, costo_unitario, linea_id, unidad_medida)
    VALUES (1,'CABLE SUELTO', 5, 2000, 1, 'unidad');
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
const lineaCase = (cantidad, atributo_id = 1) =>
  ({ tipo: 'cantidad', producto_id: 1, atributo_id, cantidad, valor_interno: 11000 });

// ═════════════════════════════════════════════════════════════════════════════
seccion('1. El caso del reporte: 7 en camino, despachar 1 más se RECHAZA');
const e20 = await red.despachar(reqBodega, { sucursal_destino_id: 2, lineas: [lineaCase(7)] });
ok('el primer envío (7 de 7) sale', e20.estado === 'En transito', `#${e20.numero}`);
ok('despachar no bajó el stock (sigue en 7)', (await stockAtr(1)) === 7);
{
  const err = await falla(() => red.despachar(reqBodega, { sucursal_destino_id: 2, lineas: [lineaCase(1)] }));
  ok('★ el segundo envío (1 más) se rechaza', err?.code === 'STOCK_COMPROMETIDO', err?.message);
  ok('el mensaje nombra el envío que lo tiene', String(err?.message).includes(`#${e20.numero}`));
  ok('el mensaje dice cuántos quedan libres', String(err?.message).includes('quedan 0'));
  const [n] = await q(`SELECT count(*)::int n FROM remisiones`);
  ok('el rechazo no deja remisión a medias', n.n === 1, `${n.n} remisión(es)`);
}

seccion('2. Lo LIBRE sí se despacha, y otra talla no se contamina');
{
  // 10 de IPHONE 15 sin nada en camino: salen 4, y luego caben 6, no 7.
  const r = await red.despachar(reqBodega, { sucursal_destino_id: 2, lineas: [lineaCase(4, 2)] });
  ok('4 de 10 salen', r.estado === 'En transito');
  const err7 = await falla(() => red.despachar(reqBodega, { sucursal_destino_id: 2, lineas: [lineaCase(7, 2)] }));
  ok('pedir 7 con 6 libres se rechaza', err7?.code === 'STOCK_COMPROMETIDO', err7?.message);
  const r6 = await falla(() => red.despachar(reqBodega, { sucursal_destino_id: 2, lineas: [lineaCase(6, 2)] }));
  ok('★ pedir exactamente los 6 libres pasa', r6 === null, r6?.message);
  // Anular los dos de IPHONE 15 para que no estorben después.
  for (const x of await q(`SELECT DISTINCT r.id FROM remisiones r JOIN lineas_remision l ON l.remision_id=r.id
                           WHERE l.atributo_origen_id=2 AND r.estado='En transito'`)) {
    await red.anularRemision(reqBodega, Number(x.id));
  }
}

seccion('3. Dos líneas del MISMO nodo en un despacho se suman');
{
  const err = await falla(() => red.despachar(reqBodega, {
    sucursal_destino_id: 2, lineas: [lineaCase(6, 2), lineaCase(6, 2)],
  }));
  ok('6 + 6 con 10 en stock se rechaza', err?.code === 'STOCK_COMPROMETIDO', err?.message);
  ok('dice que es este mismo envío', String(err?.message).includes('este mismo envío'));
}

seccion('4. Anular libera lo comprometido');
{
  const tmp = await red.despachar(reqBodega, { sucursal_destino_id: 2, lineas: [lineaCase(10, 2)] });
  const antes = await falla(() => red.despachar(reqBodega, { sucursal_destino_id: 2, lineas: [lineaCase(1, 2)] }));
  ok('con los 10 en camino no sale ni 1', antes?.code === 'STOCK_COMPROMETIDO');
  await red.anularRemision(reqBodega, Number(tmp.id));
  const despues = await falla(() => red.despachar(reqBodega, { sucursal_destino_id: 2, lineas: [lineaCase(1, 2)] }));
  ok('★ anulado el envío, vuelve a salir', despues === null, despues?.message);
}

seccion('5. Recibir libera lo comprometido y el mensaje de siempre no cambia');
{
  await red.recibir(reqLocal, Number(e20.id), {});
  ok('el #20 entró: la bodega queda en 0', (await stockAtr(1)) === 0);
  const err = await falla(() => red.despachar(reqBodega, { sucursal_destino_id: 2, lineas: [lineaCase(1)] }));
  ok('sin stock responde el mensaje de siempre', /Hay 0, pides 1/.test(String(err?.message)) && !err?.code, err?.message);
}

seccion('6. La recepción imposible responde AL INSTANTE y nombra la línea');
// Se reproduce el estado que ya existe en producción: un envío en tránsito
// cuya línea número 75 ya no tiene stock en la bodega.
{
  await db.exec(`
    INSERT INTO productos_cantidad (sucursal_id, nombre, stock, costo_unitario, linea_id, unidad_medida)
      SELECT 1, 'RELLENO ' || g, 5, 1000, 1, 'unidad' FROM generate_series(1, 74) g;
  `);
  const relleno = await q(`SELECT id FROM productos_cantidad WHERE nombre LIKE 'RELLENO %' ORDER BY id`);
  // Al despachar el case todavía tiene stock (se sube a 1 y se vuelve a 0
  // después, que es lo que hizo el #20 en la vida real).
  await db.exec(`UPDATE atributos_producto SET stock = 1 WHERE id = 1`);
  const e21 = await red.despachar(reqBodega, {
    sucursal_destino_id: 2,
    lineas: [
      ...relleno.map((p) => ({ tipo: 'cantidad', producto_id: Number(p.id), cantidad: 1, valor_interno: 1500 })),
      lineaCase(1),
    ],
  });
  await db.exec(`UPDATE atributos_producto SET stock = 0 WHERE id = 1`);
  const lineas = await redRepo.getLineasRemision(Number(e21.id));
  ok('el envío tiene 75 líneas y la mala es la última', lineas.length === 75
    && Number(lineas.at(-1).atributo_origen_id) === 1);

  consultas = 0;
  const err = await falla(() => red.recibir(reqLocal, Number(e21.id), {}));
  const hechas = consultas;
  ok('★ se rechaza con su código', err?.code === 'STOCK_ORIGEN_INSUFICIENTE', err?.message);
  ok('★ antes de recorrer las 74 líneas buenas', hechas < 15, `${hechas} consultas (sin la revisión previa eran ~1.200)`);
  ok('el mensaje nombra el producto', String(err?.message).includes('CASE LUJO VX09 / IPHONE 14 PRO MAX'));
  ok('el mensaje dice qué hacer', String(err?.message).includes('Revisar'));
  const mala = Number(lineas.at(-1).id);
  ok('detalle trae el id de la línea para desmarcarla', err?.detalle?.[0]?.lineas?.includes(mala));
  const [e] = await q(`SELECT estado FROM remisiones WHERE id=$1`, [e21.id]);
  ok('el envío sigue en tránsito', e.estado === 'En transito');
  const [t] = await q(`SELECT count(*)::int n FROM traslados WHERE notas = $1`, [`Remisión #${e21.numero}`]);
  ok('no quedó traslado', t.n === 0);

  seccion('7. Desmarcar la línea mala deja recibir el resto');
  const ids = lineas.slice(0, -1).map((l) => Number(l.id));
  const res = await red.recibir(reqLocal, Number(e21.id), { lineas_recibidas: ids });
  ok('★ se recibe como Parcial', res.estado === 'Parcial', res.estado);
  ok('entran las 74 buenas', res.recibidas === 74 && res.faltantes === 1);
  const [lm] = await q(`SELECT estado_linea FROM lineas_remision WHERE id=$1`, [mala]);
  ok('la mala queda como no llegada', lm.estado_linea === 'Faltante');
  ok('la bodega no queda en negativo', (await stockAtr(1)) === 0);
  const [rl] = await q(`SELECT stock FROM productos_cantidad WHERE sucursal_id=1 AND nombre='RELLENO 1'`);
  ok('el relleno sí salió de la bodega', Number(rl.stock) === 4);

  seccion('8. Un segundo clic sobre un envío ya recibido no mueve nada');
  const otra = await falla(() => red.recibir(reqLocal, Number(e21.id), { lineas_recibidas: ids }));
  ok('responde que ya está recibido', otra?.status === 409 && /Parcial/.test(otra?.message), otra?.message);
  const [rl2] = await q(`SELECT stock FROM productos_cantidad WHERE sucursal_id=1 AND nombre='RELLENO 1'`);
  ok('el stock no se movió dos veces', Number(rl2.stock) === 4);
}

seccion('9. Producto SIN variantes: misma regla, mismo camino');
{
  const r = await red.despachar(reqBodega, {
    sucursal_destino_id: 2, lineas: [{ tipo: 'cantidad', producto_id: 2, cantidad: 5, valor_interno: 2500 }],
  });
  const err = await falla(() => red.despachar(reqBodega, {
    sucursal_destino_id: 2, lineas: [{ tipo: 'cantidad', producto_id: 2, cantidad: 1, valor_interno: 2500 }],
  }));
  ok('5 en camino de 5: no sale otro', err?.code === 'STOCK_COMPROMETIDO', err?.message);
  const rec = await falla(() => red.recibir(reqLocal, Number(r.id), {}));
  ok('y el primero se recibe normal', rec === null, rec?.message);
}

seccion('10. La devolución del local tiene la misma baranda');
{
  // El local tiene 7 cases (del #20). Devuelve 7 y, sin que la bodega confirme, 1 más.
  const [nodoLocal] = await q(`SELECT ap.id, ap.producto_id, ap.stock FROM atributos_producto ap
                               WHERE ap.sucursal_id=2 AND ap.valor='IPHONE 14 PRO MAX'`);
  ok('el local tiene los 7', Number(nodoLocal.stock) === 7);
  const linea = (cantidad) => ({ tipo: 'cantidad', producto_id: Number(nodoLocal.producto_id),
                                 atributo_id: Number(nodoLocal.id), cantidad, origen_unidad: 'bodega' });
  await red.devolver(reqLocal, { lineas: [linea(7)] });
  const err = await falla(() => red.devolver(reqLocal, { lineas: [linea(1)] }));
  ok('★ devolver 1 más con 7 en camino se rechaza', err?.code === 'STOCK_COMPROMETIDO', err?.message);
}

seccion('11. Contratos con la pantalla');
{
  const api   = readFileSync(path.join(FRONT, 'api/redInterna.api.js'), 'utf8');
  const modal = readFileSync(path.join(FRONT, 'pages/red-interna/ModalRecibir.jsx'), 'utf8');
  const local = readFileSync(path.join(FRONT, 'pages/red-interna/CuentaLocal.jsx'), 'utf8');
  const servicio = readFileSync(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'), 'utf8');
  const tope = api.match(/recibirRemision[\s\S]*?timeout:\s*(\d+)/);
  ok('recibir lleva tope propio de más de 30 s', tope && Number(tope[1]) > 30000, tope?.[1]);
  ok('el código que lee el modal es el que lanza el backend',
    modal.includes("'STOCK_ORIGEN_INSUFICIENTE'") && servicio.includes("code: 'STOCK_ORIGEN_INSUFICIENTE'"));
  ok('el modal lee las líneas de `detalle`', /detalle[\s\S]{0,80}lineas/.test(modal));
  ok('«Recibí todo» ya no dice «no se pudo» cuando no hubo respuesta',
    local.includes('mensajeErrorRecepcion') && modal.includes('mensajeErrorRecepcion'));
  ok('el modal ya no promete «no es una deuda»', !modal.includes('no es una deuda'));
}

console.log(`\n${fallos ? '✗' : '✓'} ${pasados} pasadas, ${fallos} fallidas`);
process.exit(fallos ? 1 : 0);
