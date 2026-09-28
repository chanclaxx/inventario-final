// ─────────────────────────────────────────────────────────────────────────────
// QUIÉN VE EL PRECIO DE LOS DESPACHOS — una lista de usuarios, no el candado de
// costos (Tesla, 28-sep-2026: «Bunny Mobile ve el precio del despacho, pero
// solo ciertos usuarios»).
//
// Antes la única forma de mostrárselo a un supervisor del local era concederle
// el campo «Costo»: le abría TODOS los costos del sistema, le dejaba editarlos
// y le mandaba en cada IMEI el `costo_compra` de la BODEGA. Ahora:
//   red_interna_valores_usuarios ausente → solo admin (decisión del negocio)
//   en la lista → ve el valor de cada línea del envío y el costo del inventario
//                 de SU local (que es ese precio). Nada más.
//
//   · Sección 1 — sin lista: nadie del local ve el precio de cada línea, con
//                 o sin candado; la CUENTA (cargo, saldo) sí.
//   · Sección 2 — con lista: el autorizado lo ve (detalle, estado de cuenta,
//                 PDF); el otro supervisor del MISMO local, no; nadie del local
//                 ve lo que a la bodega le costó.
//   · Sección 3 — inventario del local: el autorizado ve el costo (que es el
//                 precio del despacho) pero no el proveedor; los demás nada.
//   · Sección 4 — la fuga del IMEI: el `costo_compra` de la BODEGA ya no
//                 viaja a nadie del local, ni en el listado ni en el escáner,
//                 con el candado apagado incluido. El admin lo sigue viendo.
//   · Sección 5 — alcance: la lista no abre la bodega ni otro local.
//   · Sección 6 — Ajustes valida los ids como los del PIN.
//   · Sección 7 — la pantalla dice lo mismo que el backend (estática).
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
for (const m of ['20260725_red_interna', '20260726_red_interna_v2', '20260822_red_interna_envios',
  '20260823_red_interna_control', '20260823_red_interna_cargos_pagables', '20260823_remision_variantes',
  '20260823_lotes_cantidad', '20260824_costo_origen_remision', '20260823_valor_acreditado']) {
  await db.exec(readFileSync(path.join(RAIZ, `../migrations/${m}.sql`), 'utf8'));
}
await db.exec(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS negocio_id INT;`);

const conectar = (t) => ({ query: (s, p) => t.query(s, p ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

// Instrumentación mínima de PDFKit: el texto que de verdad se pinta.
const PDFDocument = require(path.join(RAIZ, 'node_modules/pdfkit'));
let textos = null;
const origFragment = PDFDocument.prototype._fragment;
PDFDocument.prototype._fragment = function (t, ...r) {
  if (textos) textos.push(String(t ?? ''));
  return origFragment.call(this, t, ...r);
};

const service  = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));
const repo     = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.repository.js'));
const pdf      = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.pdf.js'));
const redMw    = require(path.join(RAIZ, 'src/middlewares/redInterna.middleware.js'));
const costos   = require(path.join(RAIZ, 'src/utils/costos.util.js'));
const ctrlCant = require(path.join(RAIZ, 'src/modules/productos/productosCantidad.controller.js'));
const ctrlSer  = require(path.join(RAIZ, 'src/modules/productos/productosSerial.controller.js'));
const ctrlBus  = require(path.join(RAIZ, 'src/modules/busqueda/busqueda.controller.js'));

let pasados = 0; const fallos = [];
const money = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP',
  minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(n || 0));
const ok = (nombre, cond, detalle = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos.push(nombre);
};
const seccion = (t) => console.log(`\n═══ ${t} ═══`);

const leerPdf = async (generar) => {
  textos = [];
  const salida = await generar();
  const doc = salida.doc || salida;
  doc.on('data', () => {});
  await new Promise((r) => doc.on('end', r));
  const t = textos.join(' | ');
  textos = null;
  return t;
};

/** Llama un controlador Express y devuelve lo que respondió. */
const llamar = (fn, req) => new Promise((resolve, reject) => {
  const res = {
    statusCode: 200,
    status(c) { this.statusCode = c; return this; },
    json(body) { resolve({ status: this.statusCode, body }); },
  };
  fn(req, res, (err) => (err ? reject(err) : resolve({ status: 500, body: null })));

});

// ── Escenario: el de Tesla ──────────────────────────────────────────────────
// Bodega (1) surte a Bunny (2) y a Tesla Shop (3). El iPhone le costó a la
// bodega $1.000.000 y se despacha a $1.300.000; el cargador, $30.000 → $45.000.
// Montos distintos a propósito: así se sabe cuál de los dos se filtró.
const COSTO_BODEGA = 1000000; const PRECIO_DESPACHO = 1300000;
const COSTO_CARG   = 30000;   const PRECIO_CARG     = 45000;
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Tesla');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Bodega'),(1,'Bunny Mobile'),(1,'Tesla Shop');
  INSERT INTO usuarios (nombre, negocio_id) VALUES
    ('Admin',1),('BunnyMobile',1),('Otro supervisor Bunny',1),('Vendedor Bunny',1),
    ('Bodeguero',1),('Supervisor Tesla Shop',1);
  INSERT INTO negocios (nombre) VALUES ('Otro negocio');
  INSERT INTO usuarios (nombre, negocio_id) VALUES ('De otro negocio', 2);
  INSERT INTO config_negocio VALUES (1,'red_interna_activa','1'),(1,'red_interna_bodega_id','1'),
                                    (1,'costos_solo_admin','1');
  INSERT INTO lineas_producto (negocio_id, nombre) VALUES (1,'Celulares'),(1,'Accesorios');
  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id, linea_id)
    VALUES ('iPhone 13','Apple','128GB', 2600000, 1, 1);
  INSERT INTO seriales (producto_id, imei, costo_compra, proveedor_id) VALUES
    (1,'IMEI-111', ${COSTO_BODEGA}, 7), (1,'IMEI-222', ${COSTO_BODEGA}, 7);
  INSERT INTO productos_cantidad (nombre, codigo, precio, costo_unitario, stock, sucursal_id, linea_id)
    VALUES ('Cargador 20W','CARG20', 60000, ${COSTO_CARG}, 50, 1, 2);
  INSERT INTO cuentas_dinero (negocio_id, sucursal_id, nombre, tipo, metodos_pago)
    VALUES (1,1,'Efectivo','efectivo',ARRAY['Efectivo']), (1,2,'Efectivo','efectivo',ARRAY['Efectivo']),
           (1,3,'Efectivo','efectivo',ARRAY['Efectivo']);
  INSERT INTO aperturas_caja (sucursal_id) VALUES (1),(2),(3);
`);

const U = {
  admin:      { id: 1, negocio_id: 1, rol: 'admin_negocio', sucursal_id: null },
  bunny:      { id: 2, negocio_id: 1, rol: 'supervisor',    sucursal_id: 2 },
  otroBunny:  { id: 3, negocio_id: 1, rol: 'supervisor',    sucursal_id: 2 },
  vendeBunny: { id: 4, negocio_id: 1, rol: 'vendedor',      sucursal_id: 2 },
  bodeguero:  { id: 5, negocio_id: 1, rol: 'supervisor',    sucursal_id: 1 },
  teslaShop:  { id: 6, negocio_id: 1, rol: 'supervisor',    sucursal_id: 3 },
};

/** Cambia la config y arma los req como los arma el middleware de verdad. */
const configurar = async ({ lista, soloAdmin = '1' }) => {
  await db.query(`DELETE FROM config_negocio WHERE negocio_id = 1
                  AND clave IN ('red_interna_valores_usuarios','costos_solo_admin')`);
  if (lista !== undefined) {
    await db.query(`INSERT INTO config_negocio VALUES (1,'red_interna_valores_usuarios',$1)`, [JSON.stringify(lista)]);
  }
  await db.query(`INSERT INTO config_negocio VALUES (1,'costos_solo_admin',$1)`, [soloAdmin]);
  redMw.invalidarCache(); costos.invalidarCache();
};
const reqDe = async (user, sucursalId = user.sucursal_id ?? 1) => {
  const red = await redMw.getConfigRed(1);
  return { user, sucursal_id: sucursalId, esBodega: Number(sucursalId) === 1, red,
           params: {}, query: {} };
};

// Un envío a Bunny con un iPhone y 4 cargadores, recibido.
const admin = await reqDe(U.admin, 1);
const envio = await service.despachar(admin, {
  sucursal_destino_id: 2,
  lineas: [
    { tipo: 'serial', serial_id: 1, valor_interno: PRECIO_DESPACHO },
    { tipo: 'cantidad', producto_id: 1, cantidad: 4, valor_interno: PRECIO_CARG },
  ],
});
{
  const lineas = await repo.getLineasRemision(envio.id);
  await service.recibir(await reqDe(U.bunny), envio.id, {
    lineas_recibidas: lineas.map((l) => Number(l.id)),
    cantidades: Object.fromEntries(lineas.filter((l) => l.tipo === 'cantidad').map((l) => [l.id, l.cantidad])),
  });
}
const CARGO = PRECIO_DESPACHO + 4 * PRECIO_CARG;
const { rows: [prodSerialBunny] } = await db.query(
  `SELECT ps.id FROM seriales s JOIN productos_serial ps ON ps.id = s.producto_id WHERE s.imei = 'IMEI-111'`);
const { rows: [prodCantBunny] } = await db.query(
  `SELECT id FROM productos_cantidad WHERE sucursal_id = 2 AND nombre = 'Cargador 20W'`);

const precioLinea = (det) => det.lineas.find((l) => l.imei === 'IMEI-111')?.valor_interno;

// ═════════════════════════════════════════════════════════════════════════════
seccion('1. Sin lista: solo el admin ve el precio de cada línea');
for (const soloAdmin of ['1', '0']) {
  await configurar({ soloAdmin });
  const tag = soloAdmin === '1' ? 'candado puesto' : 'candado APAGADO';
  const detAdmin = await service.getRemision(await reqDe(U.admin, 2), envio.id);
  ok(`[${tag}] el admin ve el precio de la línea`, Number(precioLinea(detAdmin)) === PRECIO_DESPACHO);
  for (const [n, u] of [['BunnyMobile', U.bunny], ['vendedor', U.vendeBunny], ['bodeguero', U.bodeguero]]) {
    const det = await service.getRemision(await reqDe(u), envio.id);
    ok(`[${tag}] ${n} NO ve el precio de la línea`, precioLinea(det) == null && det.costos_ocultos === true);
  }
  const det = await service.getRemision(await reqDe(U.bunny), envio.id);
  ok(`[${tag}]   pero sí la cuenta del envío`, det.resumen.cargo === CARGO && det.resumen.saldo === CARGO,
    money(det.resumen.cargo));
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('2. Con lista: el autorizado ve el precio del despacho, y solo eso');
await configurar({ lista: [U.bunny.id, U.vendeBunny.id] });
{
  const reqBunny = await reqDe(U.bunny);
  const det = await service.getRemision(reqBunny, envio.id);
  ok('BunnyMobile ve el precio de cada línea', Number(precioLinea(det)) === PRECIO_DESPACHO && !det.costos_ocultos);
  ok('  pero NO lo que a la bodega le costó', det.lineas.every((l) => l.costo_origen == null && l.costo_real == null));
  const detV = await service.getRemision(await reqDe(U.vendeBunny), envio.id);
  ok('un vendedor también se puede autorizar', Number(precioLinea(detV)) === PRECIO_DESPACHO);
  const detO = await service.getRemision(await reqDe(U.otroBunny), envio.id);
  ok('el otro supervisor del MISMO local no, si no está en la lista', precioLinea(detO) == null);

  const cuenta = await service.getEstadoCuenta(reqBunny, 2);
  const lineaCuenta = cuenta.envios.flatMap((e) => e.lineas || []).find((l) => l.imei === 'IMEI-111');
  ok('estado de cuenta: la línea con su precio', Number(lineaCuenta?.valor_interno) === PRECIO_DESPACHO);
  const cuentaO = await service.getEstadoCuenta(await reqDe(U.otroBunny), 2);
  ok('  y para el no autorizado, recortada', cuentaO.costos_ocultos === true
    && cuentaO.envios.flatMap((e) => e.lineas || []).every((l) => l.valor_interno == null));

  const tBunny = await leerPdf(() => pdf.generarPdfEnvio(reqBunny, envio.id));
  const reqOtro = await reqDe(U.otroBunny);
  const tOtro  = await leerPdf(() => pdf.generarPdfEnvio(reqOtro, envio.id));
  ok('PDF del autorizado: con el precio de la línea', tBunny.includes(money(PRECIO_DESPACHO)));
  ok('PDF del no autorizado: sin él, pero con el cargo',
    !tOtro.includes(money(PRECIO_DESPACHO)) && tOtro.includes(money(CARGO)));
  ok('ningún PDF del local muestra el costo de la bodega',
    ![tBunny, tOtro].some((t) => t.includes(money(COSTO_BODEGA))));
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('3. Inventario del local: el costo ES el precio del despacho');
{
  const cant = async (u) => (await llamar(ctrlCant.getProductos, { ...(await reqDe(u)) })).body.data.items
    .find((p) => p.nombre === 'Cargador 20W');
  const pBunny = await cant(U.bunny);
  ok('BunnyMobile ve el costo del cargador = precio del despacho', Number(pBunny.costo_unitario) === PRECIO_CARG,
    String(pBunny.costo_unitario));
  ok('  pero no el proveedor', pBunny.proveedor_id == null);
  ok('el no autorizado no ve el costo', (await cant(U.otroBunny)).costo_unitario == null);

  const porId = async (u) => (await llamar(ctrlCant.getProductoById,
    { ...(await reqDe(u)), params: { id: prodCantBunny.id } })).body.data;
  ok('el detalle de un producto, igual', Number((await porId(U.bunny)).costo_unitario) === PRECIO_CARG
    && (await porId(U.otroBunny)).costo_unitario == null);

  const ser = async (u) => (await llamar(ctrlSer.getSeriales,
    { ...(await reqDe(u)), params: { id: prodSerialBunny.id } })).body.data.find((s) => s.imei === 'IMEI-111');
  const sBunny = await ser(U.bunny);
  ok('el IMEI: BunnyMobile ve como costo el precio del despacho', Number(sBunny.costo_compra) === PRECIO_DESPACHO,
    String(sBunny.costo_compra));
  const sOtro = await ser(U.otroBunny);
  ok('el no autorizado: ni costo ni valor interno', sOtro.costo_compra == null && sOtro.costo_tarifa == null);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('4. El costo de la BODEGA ya no viaja a nadie del local');
{
  const ser = async (u) => (await llamar(ctrlSer.getSeriales,
    { ...(await reqDe(u)), params: { id: prodSerialBunny.id } })).body.data.find((s) => s.imei === 'IMEI-111');
  const esc = async (u) => (await llamar(ctrlBus.escanear,
    { ...(await reqDe(u)), params: { codigo: 'IMEI-111' } })).body.data.serial;

  // Con el candado APAGADO todo supervisor ve costos: antes veía el de la bodega.
  await configurar({ soloAdmin: '0' });
  const s = await ser(U.otroBunny);
  ok('candado apagado: el supervisor ve el precio del despacho, no el de la bodega',
    Number(s.costo_compra) === PRECIO_DESPACHO, String(s.costo_compra));
  ok('  y no el proveedor de la bodega', s.proveedor_id == null);
  const e = await esc(U.vendeBunny);
  ok('el escáner del carrito, igual', Number(e.costo_compra) === PRECIO_DESPACHO, String(e.costo_compra));
  ok('  y la tarifa sigue teniendo su base', Number(e.costo_tarifa) === PRECIO_DESPACHO);

  const sAdmin = await ser(U.admin);
  ok('el admin sigue viendo el costo real (el de la bodega)', Number(sAdmin.costo_compra) === COSTO_BODEGA);

  await configurar({ soloAdmin: '1' });
  const e2 = await esc(U.otroBunny);
  ok('candado puesto: el escáner ya no manda ningún costo', e2.costo_compra == null && e2.costo_tarifa == null);

  // Un equipo PROPIO del local (no vino de la bodega) conserva su costo.
  const { rows: [propio] } = await db.query(
    `INSERT INTO seriales (producto_id, imei, costo_compra) VALUES ($1,'IMEI-PROPIO', 800000) RETURNING id`,
    [prodSerialBunny.id]);
  await configurar({ soloAdmin: '0' });
  const lista = (await llamar(ctrlSer.getSeriales,
    { ...(await reqDe(U.otroBunny)), params: { id: prodSerialBunny.id } })).body.data;
  ok('un equipo propio del local conserva su costo de compra',
    Number(lista.find((x) => x.id === propio.id).costo_compra) === 800000);
  await db.query('DELETE FROM seriales WHERE id = $1', [propio.id]);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('5. Alcance: su local y nada más');
await configurar({ lista: [U.bunny.id, U.bodeguero.id, U.teslaShop.id] });
{
  // BunnyMobile pidiendo el inventario de la bodega (sucursal 1).
  const r = await llamar(ctrlCant.getProductos, { ...(await reqDe(U.bunny)), sucursal_id: 1 });
  ok('la lista no le abre el costo de la BODEGA', r.body.data.items.every((p) => p.costo_unitario == null));
  const rId = await llamar(ctrlCant.getProductoById, { ...(await reqDe(U.bunny)), params: { id: 1 } });
  ok('  ni por el detalle del producto', rId.body.data.costo_unitario == null);
  // El supervisor de otro local, autorizado en SU local, pidiendo el de Bunny.
  const rOtro = await llamar(ctrlCant.getProductoById, { ...(await reqDe(U.teslaShop)), params: { id: prodCantBunny.id } });
  ok('ni el inventario de otro local', rOtro.body.data.costo_unitario == null);
  // El bodeguero en la lista ve los valores de los envíos, pero no el costo de la bodega.
  const r2 = await llamar(ctrlCant.getProductos, { ...(await reqDe(U.bodeguero)) });
  ok('el bodeguero autorizado no ve el costo de su inventario (la bodega no es un local)',
    r2.body.data.items.every((p) => p.costo_unitario == null));
  ok('costos.veValoresDeLocal: bodega = no', !(await costos.veValoresDeLocal(U.bodeguero, 1)));
  ok('costos.veValoresDeLocal: su local = sí', await costos.veValoresDeLocal(U.bunny, 2));
  ok('costos.veValoresDeLocal: otro local = no', !(await costos.veValoresDeLocal(U.bunny, 3)));
}
// Red interna apagada: la lista no abre nada.
await db.query(`UPDATE config_negocio SET valor = '0' WHERE negocio_id = 1 AND clave = 'red_interna_activa'`);
redMw.invalidarCache();
ok('sin red interna la lista no abre nada', !(await costos.veValoresDeLocal(U.bunny, 2)));
await db.query(`UPDATE config_negocio SET valor = '1' WHERE negocio_id = 1 AND clave = 'red_interna_activa'`);
redMw.invalidarCache();

// ═════════════════════════════════════════════════════════════════════════════
seccion('6. Ajustes valida la lista como la del PIN');
{
  let configService = null;
  try { configService = require(path.join(RAIZ, 'src/modules/config/config.service.js')); }
  catch (e) { ok('config.service carga en el fixture', false, e.message); }
  if (configService) {
    await configService.saveConfig(1, { red_interna_valores_usuarios: JSON.stringify([4, 2, 2]) });
    const { rows: [g] } = await db.query(
      `SELECT valor FROM config_negocio WHERE negocio_id = 1 AND clave = 'red_interna_valores_usuarios'`);
    ok('guarda los ids sin repetir y ordenados', g?.valor === '[2,4]', g?.valor);
    const cfg = await redMw.getConfigRed(1);
    ok('  y la red lo lee al instante (se invalida el caché)', JSON.stringify(cfg.valores_usuarios) === '[2,4]');
    const rechaza = async (nombre, valor) => {
      try { await configService.saveConfig(1, { red_interna_valores_usuarios: valor }); ok(nombre, false, 'no falló'); }
      catch (e) { ok(nombre, e.status === 400 && /precio de los despachos/.test(e.message), e.message); }
    };
    await rechaza('rechaza un usuario de otro negocio', JSON.stringify([2, 7]));
    await rechaza('rechaza algo que no es una lista', '{"a":1}');
    await rechaza('rechaza ids inválidos', JSON.stringify([0, -3]));
  }
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('7. La pantalla promete lo mismo que el backend');
{
  const hook = readFileSync(path.join(FRONT, 'hooks/usePuedeVerCostos.js'), 'utf8');
  const cfg  = readFileSync(path.join(FRONT, 'pages/configuracion/RedInternaConfig.jsx'), 'utf8');
  const mw   = readFileSync(path.join(RAIZ, 'src/middlewares/redInterna.middleware.js'), 'utf8');
  const clave = 'red_interna_valores_usuarios';
  ok('backend, hook y Ajustes usan la MISMA clave', hook.includes(clave) && cfg.includes(clave) && mw.includes(clave));
  ok('el hook excluye la bodega y exige su local', /sucursalId === bodegaId/.test(hook) && hook.includes('usuario?.sucursal_id'));
  ok('Ajustes ya no ofrece el interruptor viejo', !cfg.includes("set('red_interna_ocultar_costos'"));
  const cp = readFileSync(path.join(FRONT, 'pages/configuracion/ConfigPage.jsx'), 'utf8');
  ok('el PIN y la red comparten el mismo selector', cp.includes('<UsuariosAutorizados') && cfg.includes('<UsuariosAutorizados'));
  for (const f of ['ModalEditarSerial.jsx', 'ModalEditarProductoCantidad.jsx']) {
    const src = readFileSync(path.join(FRONT, 'pages/inventario', f), 'utf8');
    ok(`${f}: el costo de solo lectura exige no poder editarlo`, src.includes("!tiene('costo') && puedeVerCostoInv"));
  }
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('8. De paso: el listado de productos y el guardado sin permiso');
await configurar({ soloAdmin: '1' });
{
  // `findAll` responde { modo, items } y el recorte solo miraba el primer
  // nivel: con el candado puesto, el costo de cada producto viajaba entero.
  const r = await llamar(ctrlCant.getProductos, { ...(await reqDe(U.bodeguero)) });
  ok('★ candado puesto: el listado ya no manda el costo de cada producto',
    r.body.data.items.length > 0 && r.body.data.items.every((p) => p.costo_unitario == null && p.proveedor_id == null));
  const rA = await llamar(ctrlCant.getProductos, { ...(await reqDe(U.admin, 1)) });
  ok('  el admin lo sigue recibiendo', Number(rA.body.data.items[0].costo_unitario) === COSTO_CARG);

  // Quien no ve el costo recibe null; si su pantalla lo devuelve así, guardar
  // el stock mínimo NO puede borrar el costo.
  const editar = async (u, body) => llamar(ctrlCant.actualizarProducto, {
    ...(await reqDe(u)), params: { id: prodCantBunny.id },
    body: { nombre: 'Cargador 20W', unidad_medida: 'unidad', stock_minimo: 3, precio: 60000, linea_id: 2, ...body },
  });
  const costoEnBD = async () => Number((await db.query(
    'SELECT costo_unitario FROM productos_cantidad WHERE id = $1', [prodCantBunny.id])).rows[0].costo_unitario);
  const rE = await editar(U.otroBunny, { costo_unitario: null, proveedor_id: null });
  ok('★ un supervisor sin permiso edita y el costo NO se borra', await costoEnBD() === PRECIO_CARG, String(await costoEnBD()));
  ok('  y la respuesta tampoco se lo manda', rE.body.data.costo_unitario == null);
  await editar(U.otroBunny, { costo_unitario: 1 });
  ok('  ni lo puede cambiar mandándolo a propósito', await costoEnBD() === PRECIO_CARG);
  await editar(U.admin, {});
  ok('el admin sin mandar costo: no se toca', await costoEnBD() === PRECIO_CARG);
  await editar(U.admin, { costo_unitario: 47000 });
  ok('el admin mandándolo: se guarda', await costoEnBD() === 47000);
  await editar(U.admin, { costo_unitario: PRECIO_CARG });
  const src = readFileSync(path.join(FRONT, 'pages/inventario/ModalEditarProductoCantidad.jsx'), 'utf8');
  ok('el modal solo manda costo y proveedor si los puede editar',
    src.includes("...(tiene('costo')     ? { costo_unitario") && src.includes("...(tiene('proveedor') ? { proveedor_id"));
}

console.log(`\n${pasados} pasaron, ${fallos.length} fallaron`);
if (fallos.length) { console.log('Fallaron:\n  - ' + fallos.join('\n  - ')); process.exit(1); }
