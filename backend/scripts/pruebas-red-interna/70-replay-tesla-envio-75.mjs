// ─────────────────────────────────────────────────────────────────────────────
// REPETICIÓN DEL CASO REAL — Tesla, envío #75 a BUNNY MOBILE (29-sep-2026).
//
// Base AISLADA (PGlite en memoria, se destruye al terminar): no toca la base de
// producción. Lo único que viene de producción son la CONFIGURACIÓN de Tesla y
// las cifras de los productos, copiadas a mano (leídas en solo lectura):
//   · config: red interna + bodega, variantes, código único con patrón,
//     costos solo admin, listas de precios, precio mínimo APAGADO, mora de
//     envíos con plazo «PLAZO» en 0 (solo aviso), lista de valores [Bunny];
//   · las cuatro sedes con sus nombres;
//   · ML ORIGINALES APPLE LIGTHNING: bodega 60 uds a $12.000 / $14.400, código
//     AUD-ML-SIN-046 y la talla «SIN MARCA» DESACTIVADA (importación del
//     6-sep); en los locales la talla seguía activa (Bunny 0, sede 48 con 6);
//   · COMPLETO 17 PRO METAL: eliminado en la bodega y eliminado en Bunny con
//     50 uds adentro (23-sep) — el mismo caso, dormido.
//   · los triggers de reserva en tránsito y el índice único (nombre, sucursal)
//     que tiene producción.
//
// Lo que pasó en producción, en orden: #74 sale sin talla hacia un producto
// con talla → Bunny lo ve en 0 → el admin lo elimina con las 10 adentro → +10
// en bodega → #75 → «Ya existe un registro con ese valor único».
//
// La suite repite ese día con el código de hoy y comprueba que cada eslabón de
// la cadena ahora está cortado, y que los caminos por los que se podía volver a
// llegar al mismo estado (frontend viejo, estado roto heredado, el otro
// producto dormido) terminan coherentes.
// Contra el código anterior tiene que FALLAR (la sección 3 revienta con el
// 23505 de producción): si no fallara, no estaría reproduciendo nada.
// ─────────────────────────────────────────────────────────────────────────────
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');
const FRONT = path.resolve(RAIZ, '../frontend/src');
const migracion = (m) => {
  for (const dir of [path.join(RAIZ, 'migrations'), path.join(RAIZ, '../migrations')]) {
    const f = path.join(dir, `${m}.sql`);
    if (existsSync(f)) return readFileSync(f, 'utf8');
  }
  throw new Error(`No encuentro la migración ${m}`);
};

const db = new PGlite();
await db.exec(readFileSync(path.join(AQUI, 'esquema.sql'), 'utf8'));
await db.exec(readFileSync(path.join(AQUI, 'esquema-completo.sql'), 'utf8'));
for (const m of [
  '20260725_red_interna', '20260726_red_interna_v2', '20260822_red_interna_envios',
  '20260823_red_interna_control', '20260823_red_interna_cargos_pagables',
  '20260823_remision_variantes', '20260823_lotes_cantidad',
  '20260824_costo_origen_remision', '20260823_valor_acreditado',
  '20260904_pedidos_internos', '20260912_listas_precios',
  '20260925_mora_envios', '20260926_reserva_transito',
]) {
  await db.exec(migracion(m));
}
await db.exec(`
  CREATE TABLE IF NOT EXISTS auditoria (
    id SERIAL PRIMARY KEY, negocio_id INT, usuario_id INT, fecha TIMESTAMP DEFAULT NOW(),
    accion TEXT, tabla TEXT, registro_id INT, detalle JSONB
  );
  CREATE UNIQUE INDEX productos_cantidad_nombre_sucursal_id_key ON productos_cantidad (nombre, sucursal_id);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_productos_cantidad_codigo ON productos_cantidad (sucursal_id, codigo)
    WHERE codigo IS NOT NULL AND activo;
`);

const conectar = (t) => ({ query: (s, p) => t.query(s, p ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

const columnas  = require(path.join(RAIZ, 'src/config/columnas.js'));
const logWarn = console.warn; console.warn = () => {};
await columnas.detectarColumnas();
console.warn = logWarn;
const red       = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));
const redRepo   = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.repository.js'));
const mw        = require(path.join(RAIZ, 'src/middlewares/redInterna.middleware.js'));
const prodCtrl  = require(path.join(RAIZ, 'src/modules/productos/productosCantidad.controller.js'));
const { errorHandler } = require(path.join(RAIZ, 'src/middlewares/error.middleware.js'));

let fallos = 0, pasados = 0;
function ok(nombre, cond, detalle = '') {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos++;
}
const seccion = (t) => console.log(`\n═══ ${t} ═══`);
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const falla = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const uno = async (sql, p) => (await q(sql, p))[0];

/** Pasa por el controlador y el middleware de error, como una petición HTTP. */
const http = async (ctrl, req) => {
  let status = 200, body = null;
  const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
  const log = console.error; console.error = () => {};
  await ctrl(req, res, (err) => errorHandler(err, { method: 'X', url: '/x' }, res, () => {}));
  console.error = log;
  return { status, body };
};

// ── Tesla, tal cual está configurado en producción ──────────────────────────
// Sedes: 1 = BODEGA LAS AMERICAS (40), 2 = TESLA SMARTPHONESHOP (48),
// 3 = BUNNY MOBILE (49), 4 = Sucursal Camilo (50). Usuarios: 1 = Admin (63),
// 2 = BunnyMobile (83).
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Tesla SmartPhone Shop');
  INSERT INTO sucursales (negocio_id, nombre) VALUES
    (1,'BODEGA LAS AMERICAS'),(1,'TESLA SMARTPHONESHOP'),(1,'BUNNY MOBILE'),(1,'Sucursal Camilo');
  INSERT INTO usuarios (nombre) VALUES ('Admin Tesla SmartPhone Shop'),('BunnyMobile');
  INSERT INTO config_negocio VALUES
    (1,'red_interna_activa','1'),(1,'red_interna_bodega_id','1'),
    (1,'variantes_activo','1'),(1,'codigo_producto_activo','1'),(1,'codigo_auto_formato','patron'),
    (1,'costos_solo_admin','1'),(1,'listas_precios_activo','1'),(1,'precio_minimo_activo','0'),
    (1,'red_interna_mora_activa','1'),
    (1,'red_interna_mora_lista','[{"id":"plazo","nombre":"PLAZO","tipo":"mensual","valor":0,"dias_gracia":0,"tope_pct":null,"color":"amber"}]'),
    (1,'red_interna_valores_usuarios','[2]');
  INSERT INTO lineas_producto (negocio_id, nombre) VALUES (1,'AUDIO'),(1,'PROTECTORES');
`);

const ML = 'ML ORIGINALES APPLE LIGTHNING';
const COD = 'AUD-ML-SIN-046', COD_TALLA = 'AUD-MLO-SIN-001';
/** El producto en las 4 sedes como estaba ANTES del #74. Devuelve los ids. */
const sembrarML = async () => {
  await q(`DELETE FROM atributos_producto WHERE producto_id IN (SELECT id FROM productos_cantidad WHERE nombre=$1)`, [ML]);
  await q(`DELETE FROM productos_cantidad WHERE nombre=$1`, [ML]);
  const ids = {};
  for (const [suc, stock, costo, precio] of [[1, 60, 12000, 14400], [2, 6, 12000, null], [3, 0, null, null], [4, 0, null, null]]) {
    const [p] = await q(`INSERT INTO productos_cantidad (sucursal_id, nombre, stock, costo_unitario, precio, linea_id, codigo)
                         VALUES ($1,$2,$3,$4,$5,1,$6) RETURNING id`, [suc, ML, stock, costo, precio, COD]);
    // La talla: desactivada en la bodega (importación del 6-sep), activa en los locales.
    const [a] = await q(`INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock, activo, codigo)
                         VALUES ($1,$2,'SIN MARCA',$3,$4,$5) RETURNING id`, [p.id, suc, suc === 2 ? 6 : 0, suc !== 1, COD_TALLA]);
    ids[suc] = { p: p.id, talla: a.id };
  }
  return ids;
};

const armar = async () => {
  mw.invalidarCache(1);
  const cfg = await mw.getConfigRed(1);
  return {
    bodega: { user: { id: 1, negocio_id: 1, rol: 'admin_negocio' }, sucursal_id: 1, esBodega: true, red: cfg },
    bunny:  { user: { id: 2, negocio_id: 1, rol: 'supervisor' },   sucursal_id: 3, esBodega: false, red: cfg },
  };
};
const R = await armar();
const despachar = (productoId, cantidad) => red.despachar(R.bodega, {
  sucursal_destino_id: 3, lineas: [{ tipo: 'cantidad', producto_id: productoId, cantidad, valor_interno: 14400 }],
});
const stock = async (id) => Number((await uno('SELECT stock FROM productos_cantidad WHERE id=$1', [id])).stock);
const activosEnBunny = async (nombre) =>
  Number((await uno(`SELECT count(*)::int n FROM productos_cantidad WHERE sucursal_id=3 AND nombre=$1 AND activo`, [nombre])).n);
// Lo que Bunny debe por envíos: el cargo se DERIVA de las líneas recibidas
// (cantidad recibida − devuelta, a su valor interno), en remisiones vivas.
const deuda = async () => Number((await uno(`
  SELECT COALESCE(SUM((COALESCE(lr.cantidad_recibida, lr.cantidad) - COALESCE(lr.cantidad_devuelta, 0)) * lr.valor_interno), 0) AS d
  FROM lineas_remision lr JOIN remisiones r ON r.id = lr.remision_id
  WHERE r.sucursal_destino_id = 3 AND r.tipo = 'entrega' AND r.estado <> 'Anulada' AND lr.estado_linea = 'Recibida'`)).d);

ok('la configuración real carga: confirmar recepción encendido', R.bodega.red.confirmar_recepcion !== false);

// ═════════════════════════════════════════════════════════════════════════════
seccion('1. El #74 del 29-sep: sale SIN talla hacia un Bunny CON talla → se frena en la bodega');
let ids = await sembrarML();
{
  const err = await falla(() => despachar(ids[1].p, 10));
  ok('★ el despacho se rechaza antes de salir (VARIANTES_DISTINTAS)', err?.code === 'VARIANTES_DISTINTAS', err?.message);
  ok('el mensaje nombra BUNNY MOBILE, el producto y la talla',
    /BUNNY MOBILE/.test(err?.message) && err?.message.includes(ML) && /SIN MARCA/.test(err?.message));
  ok('nada queda en camino ni reservado', (await q(`SELECT 1 FROM remisiones WHERE estado='En transito'`)).length === 0);
  ok('la bodega sigue en 60', (await stock(ids[1].p)) === 60);
}

seccion('2. Se iguala el catálogo (lo que dice el mensaje) y el #74 entra limpio');
{
  // Lo que hizo la corrección en producción: el producto sin talla en los locales.
  await q(`UPDATE atributos_producto SET activo = false WHERE producto_id = ANY($1)`, [[ids[2].p, ids[3].p, ids[4].p]]);
  const r74 = await despachar(ids[1].p, 10);
  ok('el #74 sale', r74.estado === 'En transito', `#${r74.numero}`);
  await red.recibir(R.bunny, Number(r74.id));
  ok('Bunny: 10 en el producto, SIN talla que diga 0',
    (await stock(ids[3].p)) === 10 && (await q(`SELECT 1 FROM atributos_producto WHERE producto_id=$1 AND activo`, [ids[3].p])).length === 0);
  ok('bodega 50', (await stock(ids[1].p)) === 50);
  ok('Bunny debe el #74: $144.000', Number(await deuda()) === 144000, `deuda ${await deuda()}`);
}

seccion('3. ★ Aun así el admin elimina el producto en Bunny y reenvía (#75)');
{
  // Frontend VIEJO (sin `forzar`): ya no se puede esconder stock.
  const viejo = await http(prodCtrl.eliminarProducto,
    { user: { id: 1, negocio_id: 1, rol: 'admin_negocio' }, params: { id: String(ids[3].p) }, body: {} });
  ok('frontend viejo: 409 PRODUCTO_CON_STOCK y el producto sigue', viejo.status === 409
    && viejo.body?.code === 'PRODUCTO_CON_STOCK' && (await activosEnBunny(ML)) === 1, viejo.body?.error);

  // Frontend nuevo: el modal ya mostró «tiene 10 unidades» y el PIN confirma.
  const nuevo = await http(prodCtrl.eliminarProducto,
    { user: { id: 1, negocio_id: 1, rol: 'admin_negocio' }, params: { id: String(ids[3].p) }, body: { forzar: true } });
  ok('frontend nuevo: se elimina', nuevo.status === 200 && (await activosEnBunny(ML)) === 0, nuevo.body?.error);
  ok('las 10 NO quedan escondidas: stock 0 y −10 en el historial',
    (await stock(ids[3].p)) === 0
    && Number((await uno(`SELECT SUM(cantidad)::int s FROM historial_stock_cantidad WHERE producto_id=$1 AND tipo='ajuste'`, [ids[3].p])).s) === -10);
  const [aud] = await q(`SELECT detalle FROM auditoria WHERE accion='Producto cantidad eliminado' ORDER BY id DESC LIMIT 1`);
  ok('la auditoría dice con cuánto stock se eliminó', Number(aud?.detalle?.stock) === 10, JSON.stringify(aud?.detalle));

  // +10 en la bodega (como a las 19:08) y el #75.
  await q(`UPDATE productos_cantidad SET stock = stock + 10 WHERE id=$1`, [ids[1].p]);
  const r75 = await despachar(ids[1].p, 10);
  const err = await falla(() => red.recibir(R.bunny, Number(r75.id)));
  ok('★ el #75 SE RECIBE (en producción: «valor único»)', err === null, err?.message || err?.code);
  ok('no nace un duplicado: UNA fila con ese nombre en Bunny',
    Number((await uno(`SELECT count(*)::int n FROM productos_cantidad WHERE sucursal_id=3 AND nombre=$1`, [ML])).n) === 1);
  ok('es la MISMA fila, reactivada, con su código', (await activosEnBunny(ML)) === 1
    && (await uno('SELECT codigo FROM productos_cantidad WHERE id=$1', [ids[3].p])).codigo === COD);
  ok('Bunny = 10 (las del #75), bodega = 50', (await stock(ids[3].p)) === 10 && (await stock(ids[1].p)) === 50);
  ok('la cuenta dice lo que pasó: dos envíos recibidos, $288.000', Number(await deuda()) === 288000, `deuda ${await deuda()}`);
  ok('nada queda en camino', (await q(`SELECT 1 FROM remisiones WHERE estado='En transito'`)).length === 0);
}

seccion('4. El estado roto HEREDADO (eliminado con stock antes del arreglo, como el 4075 real)');
{
  ids = await sembrarML();
  await q(`UPDATE atributos_producto SET activo = false WHERE producto_id = ANY($1)`, [[ids[2].p, ids[3].p, ids[4].p]]);
  // Tal cual quedó producción a las 19:06: inactivo con 10 adentro.
  await q(`UPDATE productos_cantidad SET stock = 10, activo = false, costo_unitario = 14400 WHERE id=$1`, [ids[3].p]);
  const r = await despachar(ids[1].p, 10);
  const err = await falla(() => red.recibir(R.bunny, Number(r.id)));
  ok('★ se recibe sin 23505', err === null, err?.message);
  ok('queda 10, no 20: lo que se eliminó no revive', (await stock(ids[3].p)) === 10);
  const h = await q(`SELECT cantidad, notas FROM historial_stock_cantidad WHERE producto_id=$1 AND tipo='ajuste'`, [ids[3].p]);
  ok('y el descarte queda escrito', h.length === 1 && Number(h[0].cantidad) === -10, h[0]?.notas);
}

seccion('5. El otro caso dormido de Tesla: COMPLETO 17 PRO METAL (eliminado en Bunny con 50)');
{
  const [b] = await q(`INSERT INTO productos_cantidad (sucursal_id, nombre, stock, costo_unitario, precio, linea_id, codigo, activo)
                       VALUES (1,'COMPLETO 17 PRO METAL',0,4000,5000,2,'PRO-COM--002',false) RETURNING id`);
  const [bu] = await q(`INSERT INTO productos_cantidad (sucursal_id, nombre, stock, costo_unitario, linea_id, codigo, activo)
                        VALUES (3,'COMPLETO 17 PRO METAL',50,4000,2,'PRO-COM--002',false) RETURNING id`);
  // El día que la bodega lo restaure y lo mande…
  await q(`UPDATE productos_cantidad SET activo = true, stock = 20 WHERE id=$1`, [b.id]);
  const r = await red.despachar(R.bodega, {
    sucursal_destino_id: 3, lineas: [{ tipo: 'cantidad', producto_id: b.id, cantidad: 5, valor_interno: 5000 }],
  });
  const err = await falla(() => red.recibir(R.bunny, Number(r.id)));
  ok('★ se recibe (con el código viejo, el mismo «valor único»)', err === null, err?.message);
  ok('Bunny: la misma fila reactivada con 5 (las 50 del 23-sep no reviven)',
    (await stock(bu.id)) === 5 && (await activosEnBunny('COMPLETO 17 PRO METAL')) === 1);
}

seccion('6. El error de producción, si alguna otra puerta llegara a él, ya dice qué choca');
{
  const err = await falla(() => q(`INSERT INTO productos_cantidad (sucursal_id, nombre) VALUES (3,$1)`, [ML]));
  let body = null;
  const res = { status() { return this; }, json(b) { body = b; return this; } };
  const log = console.error; console.error = () => {};
  errorHandler(err, { method: 'X', url: '/x' }, res, () => {});
  console.error = log;
  ok('el 23505 real de Postgres sale con el nombre del producto', body?.error?.includes(`"${ML}"`), body?.error);
}

seccion('7. Después de la corrección: la sede 48 sigue reconociendo su lote del envío #1');
{
  ids = await sembrarML();
  // El #1: 6 uds recibidas en la sede 48 (hoy apunta al producto sin talla).
  const [rem] = await q(`INSERT INTO remisiones (negocio_id, numero, tipo, sucursal_origen_id, sucursal_destino_id, estado, fecha_emision)
                         VALUES (1, 1, 'entrega', 1, 2, 'Recibida', now() - interval '21 days') RETURNING id`);
  await q(`INSERT INTO lineas_remision (remision_id, tipo, producto_origen_id, producto_destino_id, atributo_destino_id,
                                        cantidad, cantidad_recibida, valor_interno, estado_linea, nombre_producto)
           VALUES ($1,'cantidad',$2,$3,NULL,6,6,12000,'Recibida',$4)`, [rem.id, ids[1].p, ids[2].p, ML]);
  await q(`UPDATE atributos_producto SET activo = false WHERE producto_id=$1`, [ids[2].p]);
  const lotes = await redRepo.getLotesPendientes(null, {
    negocioId: 1, sucursalLocalId: 2, nodo: { productoId: ids[2].p, atributoId: null, varianteId: null },
  });
  ok('el lote FIFO del #1 sigue vivo en el nodo sin talla: 6 a $12.000',
    lotes.length === 1 && Number(lotes[0].pendiente) === 6 && Number(lotes[0].valor_interno) === 12000, JSON.stringify(lotes));
  const r = await red.despachar(R.bodega, {
    sucursal_destino_id: 2, lineas: [{ tipo: 'cantidad', producto_id: ids[1].p, cantidad: 4, valor_interno: 14400 }],
  });
  const e = await falla(() => red.recibir({ ...R.bunny, sucursal_id: 2 }, Number(r.id)));
  ok('un envío nuevo a la sede 48 entra sin choque de tallas', e === null, e?.message);
  ok('sede 48 = 6 + 4', (await stock(ids[2].p)) === 10);
}

seccion('8. La pantalla manda la confirmación que el backend exige');
{
  const api = readFileSync(path.join(FRONT, 'api/productos.api.js'), 'utf8');
  const modal = readFileSync(path.join(FRONT, 'pages/inventario/ModalEliminarProducto.jsx'), 'utf8');
  ok('la API de eliminar cantidad envía `forzar`', /eliminarProductoCantidad\s*=\s*\(id, forzar = false\)[^\n]*data: \{ forzar \}/.test(api));
  ok('el modal la pasa cuando hay stock', /eliminarProductoCantidad\(id, forzar\)/.test(modal) && /mutation\.mutate\(tieneStock\)/.test(modal));
}

console.log(`\n${pasados} pasaron, ${fallos} fallaron`);
process.exit(fallos ? 1 : 0);
