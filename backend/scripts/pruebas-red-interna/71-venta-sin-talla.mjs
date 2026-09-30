// ─────────────────────────────────────────────────────────────────────────────
// VENDER O PRESTAR SIN TALLA UN PRODUCTO QUE TIENE TALLAS — PGlite.
//
// Tesla, 24–26 sep-2026: facturas #172 y #199 y préstamos #262–#265 de Bunny
// salieron del PRODUCTO sin decir la talla. Bajó el total y ninguna talla, y la
// siguiente sincronización revivió lo vendido (CASE LUJO VX0197: 2 unidades
// fantasma). Tres capas, tres arreglos:
//   · backend: `exigirVarianteSiTiene` rechaza la línea (400 VARIANTE_REQUERIDA);
//   · pantalla: si el árbol no carga, se dice y se ofrece reintentar, nunca
//     «no tiene atributos» con el botón del producto entero;
//   · límite de peticiones: por USUARIO con sesión, no por IP del local.
//
// LA SECCIÓN 1 ES LA QUE HAY QUE MIRAR PRIMERO: la mayoría de los negocios NO
// usa tallas, y para ellos vender y prestar tiene que seguir exactamente igual.
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
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260730_mora_credito.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260804_interes_corriente.sql'), 'utf8'));
await db.exec(`
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS celular   TEXT;
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS email     TEXT;
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS direccion TEXT;
  ALTER TABLE prestamos ADD COLUMN IF NOT EXISTS atributo_label TEXT;
  ALTER TABLE prestamos ADD COLUMN IF NOT EXISTS variante_label TEXT;
  -- Lo que el fixture no trae y cancelar una factura lee (copiado de la suite 10, que ya cancela facturas).
  ALTER TABLE aperturas_caja ADD COLUMN IF NOT EXISTS usuario_id     INTEGER;
  ALTER TABLE aperturas_caja ADD COLUMN IF NOT EXISTS monto_inicial  NUMERIC DEFAULT 0;
  ALTER TABLE aperturas_caja ADD COLUMN IF NOT EXISTS monto_cierre   NUMERIC;
  ALTER TABLE aperturas_caja ADD COLUMN IF NOT EXISTS resumen_cierre JSONB;
  -- Tablas que el resumen de caja consulta y que el esquema de pruebas no trae.
  -- Se crean VACÍAS: solo hacen falta para que los JOIN no revienten.
  CREATE TABLE IF NOT EXISTS lineas_compra (
    id SERIAL PRIMARY KEY, compra_id INT, producto_id INT, imei TEXT,
    nombre_producto TEXT,
    cantidad INT DEFAULT 1, precio_unitario NUMERIC DEFAULT 0, precio_usd NUMERIC
  );
  CREATE TABLE IF NOT EXISTS movimientos_acreedor (
    id SERIAL PRIMARY KEY, acreedor_id INT, sucursal_id INT, tipo TEXT,
    valor NUMERIC DEFAULT 0, metodo TEXT, fecha TIMESTAMP DEFAULT NOW(),
    descripcion TEXT, cargo_id INT, compra_id INT,
    registrar_en_caja BOOLEAN DEFAULT TRUE, mov_dinero_id BIGINT, usuario_id INT
  );
  CREATE TABLE IF NOT EXISTS acreedores (
    id SERIAL PRIMARY KEY, negocio_id INT, nombre TEXT, proveedor_id INT
  );
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS registrar_en_caja BOOLEAN DEFAULT TRUE;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS numero_factura    TEXT;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS metodo            TEXT;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS usuario_id        INT;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS factura_id        INT;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS estado            TEXT DEFAULT 'Activa';
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS total             NUMERIC DEFAULT 0;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS proveedor_id      INT;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS fecha             TIMESTAMP DEFAULT NOW();
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS celular       TEXT;
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS email         TEXT;
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS direccion     TEXT;
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS saldo_a_favor NUMERIC DEFAULT 0;
  ALTER TABLE abonos_totales     ADD COLUMN IF NOT EXISTS usuario_id INTEGER;
  ALTER TABLE domiciliarios      ADD COLUMN IF NOT EXISTS telefono   TEXT;
  ALTER TABLE entregas_domicilio ADD COLUMN IF NOT EXISTS negocio_id INT;
  ALTER TABLE entregas_domicilio ADD COLUMN IF NOT EXISTS usuario_id INT;
  ALTER TABLE entregas_domicilio ADD COLUMN IF NOT EXISTS fecha_entrega     TIMESTAMP;
  ALTER TABLE entregas_domicilio ADD COLUMN IF NOT EXISTS direccion_entrega TEXT;
  ALTER TABLE entregas_domicilio ADD COLUMN IF NOT EXISTS notas             TEXT;
  CREATE TABLE IF NOT EXISTS auditoria (
    id SERIAL PRIMARY KEY, negocio_id INT, usuario_id INT, fecha TIMESTAMP DEFAULT NOW(),
    accion VARCHAR, tabla VARCHAR, registro_id INT, detalle TEXT
  );
`);

// Contador de consultas del util (sección 1: cuánto le cuesta a un negocio sin tallas).
let consultasUtil = 0;
const conectar = (t) => ({
  query: async (text, params) => {
    if (String(text).includes("clave = 'variantes_activo' LIMIT 1")) consultasUtil++;
    const r = await t.query(text, params ?? []);
    return { ...r, rowCount: r.rowCount ?? r.affectedRows ?? (r.rows?.length ?? 0) };
  },
});
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

const facturas  = require(path.join(RAIZ, 'src/modules/facturas/facturas.service.js'));
const prestamos = require(path.join(RAIZ, 'src/modules/prestamos/prestamos.service.js'));

let fallos = 0, pasados = 0;
const ok = (nombre, cond, detalle = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos++;
};
const seccion = (t) => console.log(`\n═══ ${t} ═══`);
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const falla = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const stock = async (tabla, id) => Number((await q(`SELECT stock FROM ${tabla} WHERE id=$1`, [id]))[0].stock);

// Negocio 1: SIN la clave de variantes (como la mayoría). Negocio 2: variantes
// encendidas (como Tesla). Negocio 3: variantes APAGADAS pero con tallas viejas.
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Sin tallas'),('Con tallas'),('Tallas apagadas');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Tienda'),(2,'Bodega'),(3,'Local');
  INSERT INTO usuarios (nombre) VALUES ('U1'),('U2'),('U3');
  INSERT INTO config_negocio VALUES (2,'variantes_activo','1'),(3,'variantes_activo','0');

  -- 1: vidrio plano en el negocio sin tallas
  INSERT INTO productos_cantidad (nombre, stock, costo_unitario, precio, sucursal_id) VALUES ('Vidrio', 50, 1000, 5000, 1);
  -- 2: cable plano en el negocio CON tallas (no todo producto tiene tallas)
  INSERT INTO productos_cantidad (nombre, stock, costo_unitario, precio, sucursal_id) VALUES ('Cable', 30, 2000, 8000, 2);
  -- 3: AIRPODS con una talla (el caso de la factura #199)
  INSERT INTO productos_cantidad (nombre, stock, costo_unitario, precio, sucursal_id) VALUES ('AIRPODS PRO 3 GENERICOS', 20, 50000, 70000, 2);
  INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock) VALUES (3, 2, 'BLANCO', 20);          -- atr 1
  -- 4: case con tallas, y una talla con colores
  INSERT INTO productos_cantidad (nombre, stock, costo_unitario, precio, sucursal_id) VALUES ('CASE LUJO VX98', 10, 4000, 10000, 2);
  INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock) VALUES (4, 2, 'IPHONE 16', 6),        -- atr 2
                                                                                 (4, 2, 'IPHONE 15 PRO MAX', 4); -- atr 3
  INSERT INTO variantes_atributo (atributo_id, valor, stock) VALUES (3, 'NEGRO', 3), (3, 'ROJO', 1);           -- var 1, 2
  -- 5: negocio con variantes APAGADAS pero con una talla vieja activa
  INSERT INTO productos_cantidad (nombre, stock, costo_unitario, precio, sucursal_id) VALUES ('Estuche', 12, 3000, 9000, 3);
  INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock) VALUES (5, 3, 'ROSADO', 12);          -- atr 4
`);

const vender = (negocio, sucursal, lineas) => facturas.crearFactura({
  negocio_id: negocio, sucursal_id: sucursal, usuario_id: negocio,
  nombre_cliente: 'Cliente', cedula: '123', celular: '300',
  lineas, pagos: [{ metodo: 'Efectivo', valor: 1 }],
});
const prestar = (negocio, sucursal, item) => prestamos.crearPrestamo({
  sucursal_id: sucursal, usuario_id: negocio, negocio_id: negocio,
  prestatario: 'Ana', cedula: '999', telefono: '300', valor_prestamo: 10000, cantidad_prestada: 1, ...item,
});
const prestarLote = (negocio, sucursal, items) => prestamos.crearPrestamos({
  sucursal_id: sucursal, usuario_id: negocio, negocio_id: negocio,
  prestatario: 'Ana', cedula: '999', telefono: '300', items,
});
const linea = (producto_id, nombre, extra = {}) =>
  ({ nombre_producto: nombre, producto_id, cantidad: 1, precio: 10000, ...extra });

// ═════════════════════════════════════════════════════════════════════════════
seccion('1. ★ Negocios SIN tallas: vender y prestar sigue EXACTAMENTE igual');
{
  consultasUtil = 0;
  const e1 = await falla(() => vender(1, 1, [linea(1, 'Vidrio', { cantidad: 2 })]));
  ok('negocio sin la clave de variantes: la venta pasa', e1 === null, e1?.message);
  ok('…y descuenta del producto como siempre (50 → 48)', (await stock('productos_cantidad', 1)) === 48);
  const e2 = await falla(() => prestar(1, 1, { producto_id: 1, nombre_producto: 'Vidrio' }));
  ok('el préstamo pasa', e2 === null, e2?.message);
  const e3 = await falla(() => prestarLote(1, 1, [
    { producto_id: 1, nombre_producto: 'Vidrio', cantidad_prestada: 1, valor_prestamo: 5000 },
    { producto_id: 1, nombre_producto: 'Vidrio', cantidad_prestada: 2, valor_prestamo: 5000 },
  ]));
  ok('el lote de préstamos pasa', e3 === null, e3?.message);
  ok('stock 48 − 1 − 3 = 44', (await stock('productos_cantidad', 1)) === 44);
  ok('costo para ese negocio: UNA consulta corta por línea, y nunca un error', consultasUtil === 4, `${consultasUtil} consultas`);

  const e4 = await falla(() => vender(2, 2, [linea(2, 'Cable')]));
  ok('negocio CON tallas, producto SIN tallas: pasa', e4 === null, e4?.message);

  const e5 = await falla(() => vender(3, 3, [linea(5, 'Estuche')]));
  ok('negocio con variantes APAGADAS y tallas viejas: vende como antes', e5 === null, e5?.message);
  const e6 = await falla(() => prestar(3, 3, { producto_id: 5, nombre_producto: 'Estuche' }));
  ok('…y presta como antes', e6 === null, e6?.message);
}

seccion('2. ★ El caso de Tesla: sin talla sobre un producto con tallas se RECHAZA');
{
  const antes = { p: await stock('productos_cantidad', 3), a: await stock('atributos_producto', 1) };
  const [{ n: facturasAntes }] = await q(`SELECT count(*)::int n FROM facturas`);
  const e = await falla(() => vender(2, 2, [linea(2, 'Cable'), linea(3, 'AIRPODS PRO 3 GENERICOS')]));
  ok('★ factura #199: rechazada con VARIANTE_REQUERIDA', e?.code === 'VARIANTE_REQUERIDA' && e?.status === 400, e?.message);
  ok('el mensaje nombra el producto y sus tallas', /AIRPODS PRO 3 GENERICOS/.test(e?.message) && /BLANCO/.test(e?.message));
  const [{ n: facturasDespues }] = await q(`SELECT count(*)::int n FROM facturas`);
  ok('no queda factura a medias (tampoco la línea buena)', facturasDespues === facturasAntes);
  ok('ni stock movido', (await stock('productos_cantidad', 3)) === antes.p && (await stock('atributos_producto', 1)) === antes.a
    && (await stock('productos_cantidad', 2)) === 29);

  const ep = await falla(() => prestar(2, 2, { producto_id: 4, nombre_producto: 'CASE LUJO VX98' }));
  ok('★ préstamo #265: rechazado', ep?.code === 'VARIANTE_REQUERIDA', ep?.message);
  const el = await falla(() => prestarLote(2, 2, [
    { producto_id: 4, nombre_producto: 'CASE LUJO VX98', atributo_id: 2, cantidad_prestada: 1, valor_prestamo: 10000 },
    { producto_id: 4, nombre_producto: 'CASE LUJO VX98', cantidad_prestada: 1, valor_prestamo: 10000 },
  ]));
  ok('★ el lote de Bunny (19:10): rechazado entero', el?.code === 'VARIANTE_REQUERIDA', el?.message);
  ok('el lote no prestó ni el ítem bueno', (await stock('atributos_producto', 2)) === 6);
}

seccion('3. Con la talla (o el color) correcto, todo sigue funcionando');
{
  const e = await falla(() => vender(2, 2, [linea(3, 'AIRPODS PRO 3 GENERICOS', { atributo_id: 1 })]));
  ok('venta con talla pasa', e === null, e?.message);
  ok('baja la talla Y el total (20 → 19 en los dos)',
    (await stock('atributos_producto', 1)) === 19 && (await stock('productos_cantidad', 3)) === 19);

  const ec = await falla(() => vender(2, 2, [linea(4, 'CASE LUJO VX98', { atributo_id: 3 })]));
  ok('talla CON colores sin elegir color: rechazada', ec?.code === 'VARIANTE_REQUERIDA', ec?.message);
  ok('el mensaje habla de sub-variantes y nombra los colores', /sub-variantes/.test(ec?.message) && /NEGRO/.test(ec?.message));
  const ev = await falla(() => vender(2, 2, [linea(4, 'CASE LUJO VX98', { atributo_id: 3, variante_id: 1 })]));
  ok('con el color pasa', ev === null, ev?.message);
  ok('NEGRO 3 → 2, la talla 4 → 3, el producto 10 → 9',
    (await stock('variantes_atributo', 1)) === 2 && (await stock('atributos_producto', 3)) === 3
    && (await stock('productos_cantidad', 4)) === 9);
  const ep = await falla(() => prestar(2, 2, { producto_id: 4, nombre_producto: 'CASE LUJO VX98', atributo_id: 2 }));
  ok('préstamo con talla pasa', ep === null, ep?.message);
}

seccion('4. Las líneas VIEJAS sin talla se siguen pudiendo cancelar y devolver');
{
  // Se crean como pasaron en producción: con variantes apagadas un momento.
  await q(`UPDATE config_negocio SET valor='0' WHERE negocio_id=2 AND clave='variantes_activo'`);
  const f = await vender(2, 2, [linea(3, 'AIRPODS PRO 3 GENERICOS')]);
  const p = await prestar(2, 2, { producto_id: 3, nombre_producto: 'AIRPODS PRO 3 GENERICOS' });
  await q(`UPDATE config_negocio SET valor='1' WHERE negocio_id=2 AND clave='variantes_activo'`);
  const antes = await stock('productos_cantidad', 3);
  const facturaId = f?.id ?? f?.factura?.id;
  const ec = await falla(() => facturas.cancelarFactura(2, facturaId));
  ok('cancelar la factura vieja sin talla funciona', ec === null, ec?.message);
  const prestamoId = p?.id ?? p?.prestamo?.id;
  const ed = await falla(() => prestamos.devolverPrestamo(2, prestamoId));
  ok('devolver el préstamo viejo sin talla funciona', ed === null, ed?.message);
  ok('las dos unidades vuelven al total (lo mismo que hacía antes)', (await stock('productos_cantidad', 3)) === antes + 2);
}

seccion('5. Límite de peticiones: por USUARIO con sesión, por IP sin ella');
{
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-prueba';
  const jwt = require('jsonwebtoken');
  const express = require('express');
  const { limiteGlobal, POR_USUARIO, POR_IP } = require(path.join(RAIZ, 'src/middlewares/rateLimit.middleware.js'));
  const app = express();
  app.use('/api/', limiteGlobal);
  app.get('/api/x', (req, res) => res.json({ ok: true }));
  app.get('/api/health', (req, res) => res.json({ ok: true }));
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const url = `http://127.0.0.1:${srv.address().port}`;
  const pedir = async (n, headers = {}, ruta = '/api/x') => {
    const codigos = [];
    for (let i = 0; i < n; i++) codigos.push((await fetch(url + ruta, { headers })).status);
    return codigos;
  };
  const token = (id, negocio = 33) => `Bearer ${jwt.sign({ id, negocio_id: negocio, rol: 'vendedor' }, process.env.JWT_SECRET)}`;

  const a = await pedir(POR_IP + 1, { authorization: token(83) });
  const b = await pedir(POR_IP + 1, { authorization: token(84) });
  ok(`★ dos usuarios del MISMO local (misma IP) pasan de ${POR_IP} cada uno sin 429`,
    a.every((c) => c === 200) && b.every((c) => c === 200), `${a.filter((c) => c === 429).length}/${b.filter((c) => c === 429).length} rechazos`);
  const resto = await pedir(POR_USUARIO - (POR_IP + 1) + 1, { authorization: token(83) });
  ok(`un usuario sí tiene tope: la petición ${POR_USUARIO + 1} recibe 429`, resto.at(-1) === 429 && resto.at(-2) === 200);

  const sin = await pedir(POR_IP + 1);
  ok(`sin sesión sigue por IP con el tope de siempre (${POR_IP})`, sin.at(-1) === 429 && sin.at(-2) === 200);
  const falso = await pedir(1, { authorization: `Bearer ${jwt.sign({ id: 999 }, 'otra-clave')}` });
  ok('un token FALSO no abre una cuenta nueva: cae a la IP (ya agotada)', falso[0] === 429);
  const salud = await pedir(3, {}, '/api/health');
  ok('/health nunca se limita', salud.every((c) => c === 200));
  srv.close();
}

seccion('6. La pantalla: árbol que no cargó ≠ producto sin variantes');
{
  for (const f of ['VistaVariantesProducto.jsx', 'VistaArbolProducto.jsx']) {
    const src = readFileSync(path.join(FRONT, 'pages/inventario', f), 'utf8');
    const iError = src.indexOf(') : arbolNoCargo ? (');
    const iVacio = Math.max(src.indexOf(') : arbol.length === 0 ? ('), src.indexOf(') : !tieneAtributos ? ('));
    ok(`${f}: el error se decide ANTES que «sin variantes»`, iError > 0 && iVacio > iError);
    ok(`${f}: solo cuenta como error si no hay tallas en caché`, /arbolNoCargo = isError && arbol\.length === 0/.test(src));
  }
  const err = readFileSync(path.join(FRONT, 'pages/inventario/ErrorArbolVariantes.jsx'), 'utf8');
  ok('la pantalla de error NO ofrece agregar al carrito, solo reintentar',
    !/agregarItem|ShoppingCart/.test(err) && /Reintentar/.test(err));
}

console.log(`\n${pasados} pasaron, ${fallos} fallaron`);
process.exit(fallos ? 1 : 0);
