// ─────────────────────────────────────────────────────────────────────────────
// TABLAS PARA ASESORÍA (7-oct-2026) — Reportes → Análisis
//
// Las tablas con las que un asesor comercial revisa el negocio: proveedores,
// precios de compra, productos, líneas, compras contra ventas, clientes,
// cartera y equipos quietos, más los HALLAZGOS que el programa saca de ellas y
// el Excel que las exporta.
//
//   · Sección 1  — coherencia: el inventario, la deuda y las ventas dan lo
//                  mismo que las pantallas que ya existían.
//   · Sección 2  — productos: utilidad solo de lo que tiene costo, y cada señal
//                  (No rota, Agotado, Pérdida, Margen bajo, Sin costo…).
//   · Sección 3  — variantes y líneas.
//   · Sección 4  — proveedores: lo comprado, lo devuelto, lo cancelado, la
//                  deuda y qué pasó con sus equipos.
//   · Sección 5  — el mismo producto según el proveedor.
//   · Sección 6  — clientes y cartera.
//   · Sección 7  — equipos en inventario por antigüedad.
//   · Sección 8  — alcance: varias sedes suman por NOMBRE; otro negocio no entra.
//   · Sección 9  — los hallazgos.
//   · Sección 10 — ★ el contrato con la pantalla: cada columna que pinta el
//                  frontend existe en lo que manda el backend.
//   · Sección 11 — el Excel, generado de verdad y releído.
//   · Sección 12 — estática: solo lectura, solo admin, sin costos copiados.
//
// Requiere PGlite (no va en package.json a propósito):
//   npm install --no-save @electric-sql/pglite
// ─────────────────────────────────────────────────────────────────────────────
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');
const FRONT = path.resolve(RAIZ, '../frontend');
const leer = (...p) => readFileSync(path.join(...p), 'utf8');

const db = new PGlite();
await db.exec(leer(AQUI, 'esquema.sql'));
await db.exec(leer(AQUI, 'esquema-completo.sql'));
for (const m of ['20260725_red_interna', '20260726_red_interna_v2', '20260822_red_interna_envios',
  '20260823_red_interna_control', '20260823_red_interna_cargos_pagables', '20260823_remision_variantes',
  '20260823_lotes_cantidad', '20260824_costo_origen_remision', '20260823_valor_acreditado']) {
  await db.exec(leer(RAIZ, `../migrations/${m}.sql`));
}
// Lo que las consultas de este reporte tocan y los fixtures (escritos a mano
// para otras suites) no traen. Los nombres y tipos son los de producción.
await db.exec(`
  ALTER TABLE proveedores      ADD COLUMN IF NOT EXISTS garantia_dias_default INT;
  ALTER TABLE compras          ADD COLUMN IF NOT EXISTS es_entrada BOOLEAN DEFAULT FALSE;
  ALTER TABLE lineas_compra    ADD COLUMN IF NOT EXISTS subtotal NUMERIC;
  ALTER TABLE facturas         ADD COLUMN IF NOT EXISTS celular TEXT;
  ALTER TABLE facturas         ADD COLUMN IF NOT EXISTS cliente_id INT;
  ALTER TABLE lineas_factura   ADD COLUMN IF NOT EXISTS obsequio BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE productos_serial ADD COLUMN IF NOT EXISTS linea_id INT;
  ALTER TABLE productos_serial ADD COLUMN IF NOT EXISTS precio NUMERIC;
  ALTER TABLE productos_serial ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT TRUE;
  ALTER TABLE seriales         ADD COLUMN IF NOT EXISTS fecha_entrada DATE;
  ALTER TABLE seriales         ADD COLUMN IF NOT EXISTS creado_en TIMESTAMP DEFAULT NOW();
  ALTER TABLE creditos         ADD COLUMN IF NOT EXISTS cliente_id INT;
  ALTER TABLE creditos         ADD COLUMN IF NOT EXISTS fecha_limite DATE;
  ALTER TABLE creditos         ADD COLUMN IF NOT EXISTS creado_en TIMESTAMP DEFAULT NOW();
  ALTER TABLE prestamos        ADD COLUMN IF NOT EXISTS cliente_id INT;
  ALTER TABLE prestamos        ADD COLUMN IF NOT EXISTS prestatario_id INT;
  ALTER TABLE prestamos        ADD COLUMN IF NOT EXISTS empleado_id INT;
  ALTER TABLE prestamos        ADD COLUMN IF NOT EXISTS telefono TEXT;
  ALTER TABLE prestamos        ADD COLUMN IF NOT EXISTS fecha_limite DATE;
  CREATE TABLE IF NOT EXISTS acreedores (
    id SERIAL PRIMARY KEY, negocio_id INT, nombre TEXT, cedula TEXT, telefono TEXT, proveedor_id INT);
  CREATE TABLE IF NOT EXISTS movimientos_acreedor (
    id SERIAL PRIMARY KEY, acreedor_id INT, usuario_id INT, tipo TEXT, valor NUMERIC DEFAULT 0,
    descripcion TEXT, fecha TIMESTAMP DEFAULT NOW(), fecha_vencimiento DATE,
    compra_id INT, cargo_id INT, sucursal_id INT, metodo TEXT, registrar_en_caja BOOLEAN DEFAULT TRUE);
  CREATE TABLE IF NOT EXISTS novedades_proveedor (
    id SERIAL PRIMARY KEY, negocio_id INT, proveedor_id INT, tipo TEXT, fecha TIMESTAMP DEFAULT NOW());
`);

const conectar = (t) => ({ query: (s, p) => t.query(s, p ?? []) });
const escrituras = [];
const pool = {
  query: (s, p) => {
    if (/^\s*(insert|update|delete|alter|drop|truncate|create)\b/i.test(String(s))) escrituras.push(String(s).slice(0, 60));
    return db.query(s, p ?? []);
  },
  connect: async () => ({ ...conectar(db), release() {} }),
};
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

const columnas = require(path.join(RAIZ, 'src/config/columnas.js'));
columnas._setObsequiosDisponible(true);
const asesor     = require(path.join(RAIZ, 'src/modules/reportes/asesor.service.js'));
const reportes   = require(path.join(RAIZ, 'src/modules/reportes/reportes.service.js'));
const acreedores = require(path.join(RAIZ, 'src/modules/acreedores/acreedores.repository.js'));

let pasados = 0; const fallos = [];
const ok = (nombre, cond, detalle = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle !== '' ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos.push(nombre);
};
const es = (nombre, real, esperado) => ok(nombre, JSON.stringify(real) === JSON.stringify(esperado),
  JSON.stringify(real) === JSON.stringify(esperado) ? '' : `${JSON.stringify(real)} ← esperaba ${JSON.stringify(esperado)}`);
const seccion = (t) => console.log(`\n═══ ${t} ═══`);
const q = async (s, p) => (await db.query(s, p ?? [])).rows;
const uno = async (s, p) => (await q(s, p))[0];
const lanza = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

// ── Escenario ────────────────────────────────────────────────────────────────
// Todo va fechado respecto de HOY (la cartera y la antigüedad se miden a hoy).
const { hoy } = await uno(`SELECT to_char((NOW() AT TIME ZONE 'America/Bogota')::date, 'YYYY-MM-DD') AS hoy`);
const haceDias = (n) => new Date(Date.parse(`${hoy}T12:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
const DESDE = haceDias(59), HASTA = hoy;          // 60 días
const ts = (n) => `${haceDias(n)} 10:30:00`;

await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Mío'), ('Ajeno');
  INSERT INTO sucursales (negocio_id, nombre, activa) VALUES (1,'Centro',TRUE), (1,'Norte',TRUE), (2,'De otro',TRUE);
  INSERT INTO usuarios (nombre) VALUES ('Admin');
  INSERT INTO lineas_producto (negocio_id, nombre) VALUES (1,'Estuches'), (1,'Telefonos');
  INSERT INTO clientes (negocio_id, nombre, cedula) VALUES (1,'Ana','111'), (1,'Beto','222'), (1,'Carla','333');
`);
const prov = async (neg, nombre) => (await uno(
  `INSERT INTO proveedores (negocio_id, nombre, tipo, activo) VALUES ($1,$2,'proveedor',TRUE) RETURNING id`, [neg, nombre])).id;
const A = await prov(1, 'Barato SAS'), B = await prov(1, 'Caro Ltda'), C = await prov(1, 'Equipos Buenos'),
  D = await prov(1, 'Equipos Quietos'), Z = await prov(2, 'Proveedor ajeno');

const cant = async (suc, nombre, linea, stock, costo, precio) => (await uno(
  `INSERT INTO productos_cantidad (nombre, sucursal_id, linea_id, stock, costo_unitario, precio, activo)
   VALUES ($1,$2,$3,$4,$5,$6,TRUE) RETURNING id`, [nombre, suc, linea, stock, costo, precio])).id;
const P_A      = await cant(1, 'Estuche A',      1, 100, 3500, 8000);
const P_QUIETO = await cant(1, 'Estuche Quieto', 1, 50,  4000, 9000);
const P_NUEVO  = await cant(1, 'Estuche Nuevo',  1, 30,  2000, 6000);
const P_CABLE  = await cant(1, 'Cable',       null, 0,   6000, 10000);
const P_BARATO = await cant(1, 'Barato',         1, 5,   1500, 1000);
const P_SINC   = await cant(1, 'SinCosto',       1, 2,   null, 5000);
const P_FLOJO  = await cant(1, 'Flojo',          1, 20,  1500, 2000);
const P_FUNDA  = await cant(1, 'Funda',          1, 10,  null, 3000);     // con tallas: su stock es la suma
const P_A_NORTE = await cant(2, 'Estuche A',     1, 40,  3500, 8000);
await cant(3, 'Estuche A', null, 999, 1, 2);                               // del otro negocio
const atr = async (prod, suc, valor, stock, costo) => (await uno(
  `INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock, costo_unitario, activo)
   VALUES ($1,$2,$3,$4,$5,TRUE) RETURNING id`, [prod, suc, valor, stock, costo])).id;
const AT_S = await atr(P_FUNDA, 1, 'S', 10, 1000);
const AT_M = await atr(P_FUNDA, 1, 'M', 0, 1000);

const { id: PS } = await uno(
  `INSERT INTO productos_serial (nombre, sucursal_id, linea_id, precio, activo) VALUES ('iPhone X', 1, 2, 2000000, TRUE) RETURNING id`);
const serial = (imei, costo, vendido, entrada) => q(
  `INSERT INTO seriales (producto_id, imei, costo_compra, vendido, prestado, fecha_entrada) VALUES ($1,$2,$3,$4,FALSE,$5)`,
  [PS, imei, costo, vendido, entrada]);
await serial('111', 1500000, true, haceDias(45));
for (const i of ['222', '223', '224', '225', '226']) await serial(i, 1600000, false, haceDias(40));
await serial('333', 1000000, false, haceDias(100));                        // el viejo, sin compra registrada

// Compras
const compra = async (suc, proveedor, dias, metodo, estado, lineas) => {
  const { id } = await uno(
    `INSERT INTO compras (numero, sucursal_id, proveedor_id, usuario_id, total, estado, metodo, fecha)
     VALUES (1,$1,$2,1,0,$3,$4,$5) RETURNING id`, [suc, proveedor, estado, metodo, ts(dias)]);
  for (const l of lineas) {
    await q(`INSERT INTO lineas_compra (compra_id, producto_id, nombre_producto, imei, cantidad, cantidad_devuelta, precio_unitario)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, l.p ?? null, l.n, l.imei ?? null, l.c ?? 1, l.dev ?? 0, l.precio]);
  }
  return id;
};
await compra(1, A, 40, 'Efectivo', 'Completada', [{ p: P_A, n: 'Estuche A', c: 200, precio: 3500 }]);
await compra(1, B, 38, 'Credito',  'Completada', [{ p: P_A, n: 'Estuche A', c: 100, dev: 10, precio: 5500 }]);
await compra(1, A, 3,  'Efectivo', 'Completada', [{ p: P_NUEVO, n: 'Estuche Nuevo', c: 30, precio: 2000 }]);
await compra(1, C, 45, 'Efectivo', 'Completada', [{ n: 'iPhone X', imei: '111', precio: 1500000 }]);
await compra(1, D, 40, 'Efectivo', 'Completada', ['222', '223', '224', '225', '226'].map((imei) => ({ n: 'iPhone X', imei, precio: 1600000 })));
await compra(1, A, 20, 'Efectivo', 'Cancelada',  [{ p: P_A, n: 'Estuche A', c: 999, precio: 1 }]);
await compra(3, Z, 10, 'Efectivo', 'Completada', [{ n: 'Estuche A', c: 5000, precio: 9 }]);     // otro negocio

// Ventas
const factura = async (suc, dias, estado, cliente, lineas) => {
  const { id } = await uno(
    `INSERT INTO facturas (sucursal_id, usuario_id, nombre_cliente, cedula, celular, fecha, estado)
     VALUES ($1,1,$2,$3,$4,$5,$6) RETURNING id`, [suc, cliente.n, cliente.c, cliente.t ?? null, ts(dias), estado]);
  for (const l of lineas) {
    // `subtotal` es una columna generada (cantidad × precio): no se inserta.
    await q(`INSERT INTO lineas_factura (factura_id, nombre_producto, imei, cantidad, cantidad_devuelta, precio, producto_id, atributo_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, l.n, l.imei ?? null, l.c ?? 1, l.dev ?? 0, l.precio, l.p ?? null, l.a ?? null]);
  }
  return id;
};
const ANA = { n: 'Ana', c: '111', t: '300' }, BETO = { n: 'Beto', c: '222' }, GEN = { n: 'Cliente Generico', c: '0000' };
await factura(1, 30, 'Activa', ANA, [{ p: P_A, n: 'Estuche A (viejo nombre)', c: 100, precio: 8000 }]);
await factura(1, 20, 'Activa', ANA, [
  { p: P_A, n: 'Estuche A', c: 50, precio: 8000 },
  { p: P_CABLE, n: 'Cable', c: 22, dev: 2, precio: 10000 },                 // 2 devueltas: cuentan 20
]);
await factura(1, 15, 'Activa', GEN, [
  { p: P_BARATO, n: 'Barato', c: 10, precio: 1000 },
  { p: P_SINC, n: 'SinCosto', c: 4, precio: 5000 },
  { p: P_FUNDA, a: AT_M, n: 'Funda (M)', c: 5, precio: 3000 },
  { p: P_FLOJO, n: 'Flojo', c: 10, precio: 2000 },
]);
const F_CREDITO = await factura(1, 35, 'Credito', BETO, [{ n: 'iPhone X', imei: '111', precio: 1900000 }]);
await factura(1, 12, 'Cancelada', ANA, [{ p: P_A, n: 'Estuche A', c: 99, precio: 8000 }]);
await factura(2, 10, 'Activa', GEN, [{ p: P_A_NORTE, n: 'Estuche A', c: 10, precio: 8000 }]);
await factura(3, 10, 'Activa', { n: 'Intruso', c: '999' }, [{ n: 'Estuche A', c: 7777, precio: 8000 }]);

// Cartera
await q(`INSERT INTO creditos (factura_id, cliente_id, sucursal_id, valor_total, total_abonado, estado, creado_en, fecha_limite)
         VALUES ($1, 2, 1, 500000, 100000, 'Activo', $2, $3)`, [F_CREDITO, ts(70), haceDias(40)]);
const prestamo = (suc, nombre, cedula, cliente, valor, abonado, estado, dias) => q(
  `INSERT INTO prestamos (sucursal_id, usuario_id, prestatario, cedula, cliente_id, nombre_producto, cantidad_prestada, valor_prestamo, total_abonado, estado, fecha)
   VALUES ($1,1,$2,$3,$4,'Algo',1,$5,$6,$7,$8)`, [suc, nombre, cedula, cliente, valor, abonado, estado, ts(dias)]);
await prestamo(1, 'Carla', '333', 3, 200000, 0, 'Activo', 10);
await prestamo(1, 'Carla', '333', 3, 900000, 900000, 'Saldado', 50);
await prestamo(1, 'Ajuste de deuda', 'AJUSTE', null, 5000000, 0, 'Activo', 5);
await prestamo(3, 'Del otro', '999', null, 7000000, 0, 'Activo', 5);

// Deuda con proveedores
const acr = async (neg, nombre, proveedor) => (await uno(
  `INSERT INTO acreedores (negocio_id, nombre, proveedor_id) VALUES ($1,$2,$3) RETURNING id`, [neg, nombre, proveedor])).id;
const ACR_A = await acr(1, 'Barato SAS', A), ACR_B = await acr(1, 'Caro Ltda', B), ACR_Z = await acr(2, 'Ajeno', Z);
const { id: CARGO_A } = await uno(
  `INSERT INTO movimientos_acreedor (acreedor_id, tipo, valor, fecha_vencimiento) VALUES ($1,'Cargo',700000,$2) RETURNING id`, [ACR_A, haceDias(5)]);
await q(`INSERT INTO movimientos_acreedor (acreedor_id, tipo, valor, cargo_id) VALUES ($1,'Abono',200000,$2)`, [ACR_A, CARGO_A]);
await q(`INSERT INTO movimientos_acreedor (acreedor_id, tipo, valor) VALUES ($1,'Cargo',100000)`, [ACR_B]);
await q(`INSERT INTO movimientos_acreedor (acreedor_id, tipo, valor) VALUES ($1,'Cargo',9999999)`, [ACR_Z]);
await q(`INSERT INTO novedades_proveedor (negocio_id, proveedor_id, tipo, fecha) VALUES (1,$1,'sustitucion',$2), (1,$1,'exceso',$2)`, [B, ts(30)]);

escrituras.length = 0;
const d = await asesor.getAnalisisAsesor(1, { sucursalIds: [1], desde: DESDE, hasta: HASTA });
const prod = (nombre) => d.productos.find((p) => p.nombre === nombre);
const pv   = (id) => d.proveedores.find((p) => p.proveedor_id === id);

// ═════════════════════════════════════════════════════════════════════════════
seccion('1. Coherencia con las pantallas que ya existían');
{
  const inv = await reportes.getValorInventario(1);
  es('★ Σ stock en costo de Productos == «Costo total inventario» de la pestaña', d.resumen.inventario, inv.totales.costo_total);
  es('…y da lo esperado', d.resumen.inventario, 9657500);
  es('las unidades también', d.resumen.inventario_unidades, inv.totales.unidades);
  const deuda = await acreedores.findTotalesDeuda(1);
  es('★ la deuda con proveedores es la de Acreedores', d.resumen.deuda_proveedores, deuda.deuda_proveedores);
  es('…600.000, de ellos 500.000 vencidos', [d.resumen.deuda_proveedores, d.resumen.deuda_proveedores_vencida], [600000, 500000]);
  es('★ Σ ventas de Productos == ventas del resumen (dos consultas, un total)',
    d.productos.reduce((s, p) => s + p.ventas, 0), d.resumen.ventas);
  es('ventas del período: 3.365.000 (sin la cancelada y sin lo devuelto)', d.resumen.ventas, 3365000);
  es('utilidad SOLO de lo que tiene costo: 1.165.000', d.resumen.utilidad, 1165000);
  es('lo vendido sin costo se cuenta aparte (4 uds, 20.000)', [d.resumen.unidades_sin_costo, d.resumen.ventas - d.resumen.ventas_con_costo], [4, 20000]);
  const top = await reportes.getProductosTop(1, DESDE, HASTA);
  const cable = top.find((t) => t.nombre_producto === 'Cable');
  es('un producto da lo mismo que en la pestaña Productos', [prod('Cable').vendidas, prod('Cable').ventas, prod('Cable').utilidad],
    [cable.cantidad_vendida, cable.total_ventas, cable.utilidad]);
  es('facturas (la cancelada no cuenta)', d.resumen.facturas, 4);
  es('lo vendido a crédito', [d.resumen.ventas_credito, d.resumen.ventas_credito_pct], [1900000, 56.5]);
  ok('★ no escribe NADA en la base', escrituras.length === 0, escrituras.join(' | '));
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('2. Productos');
{
  const a = prod('Estuche A');
  es('★ agrupa por el producto de HOY: un nombre viejo en la venta no lo parte', [a.vendidas, a.ventas], [150, 1200000]);
  es('utilidad y margen', [a.utilidad, a.margen_pct], [675000, 56.3]);
  es('stock, valor y cobertura (150 uds en 60 días → 40 días)', [a.stock, a.valor_stock, a.cobertura_dias], [100, 350000, 40]);
  es('comprado neto (200 + 90) a 2 proveedores', [a.comprado_unidades, a.proveedores], [290, 2]);
  es('línea y clase', [a.linea, a.clase], ['Estuches', 'A']);
  es('sin señales: es el producto sano', a.senales, []);

  es('«No rota»: stock y ni una venta', prod('Estuche Quieto').senales, ['sin_rotacion']);
  es('★ lo comprado hace 3 días NO se acusa de no rotar', prod('Estuche Nuevo').senales, ['recien_comprado']);
  es('«Agotado»: se vendió y no queda', prod('Cable').senales, ['agotado']);
  es('…con las devueltas restadas (22 − 2)', [prod('Cable').vendidas, prod('Cable').devueltas], [20, 2]);
  ok('«Pérdida»: vendido por debajo del costo', prod('Barato').senales.includes('perdida') && prod('Barato').utilidad === -5000);
  es('★ sin costo: NO suma utilidad (null, no cero ni todo el precio)', [prod('SinCosto').utilidad, prod('SinCosto').margen_pct], [null, null]);
  ok('…y lleva la señal', prod('SinCosto').senales.includes('sin_costo'));
  const flojo = prod('Flojo');
  ok('★ «Margen bajo» contra SU línea: 25 % donde la línea deja 55 %',
    flojo.senales.includes('margen_bajo') && flojo.margen_pct === 25 && flojo.margen_linea_pct > 50, `${flojo.margen_pct} vs ${flojo.margen_linea_pct}`);
  const iph = prod('iPhone X');
  es('equipo con IMEI: vendido 1, quedan 6 por 9.000.000', [iph.tipo, iph.vendidas, iph.stock, iph.valor_stock], ['serial', 1, 6, 9000000]);
  es('…y su utilidad contra el costo de ESA unidad', iph.utilidad, 400000);
  ok('«Sobrestock»: 6 equipos al ritmo de 1 cada 60 días', iph.senales.includes('sobrestock'));
  ok('el producto de otra sede con el mismo nombre no se sumó', a.stock === 100);
  ok('ordenados por utilidad', d.productos[0].nombre === 'Estuche A' && d.productos[1].nombre === 'iPhone X');
  ok('la participación de la utilidad suma 100 entre los que dejan',
    Math.abs(d.productos.reduce((s, p) => s + (p.participacion_utilidad_pct || 0), 0) - 100) < 0.5);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('3. Variantes y líneas');
{
  es('las dos tallas de la Funda', d.variantes.map((v) => `${v.nombre}/${v.variante}`).sort(), ['Funda/M', 'Funda/S']);
  const m = d.variantes.find((v) => v.variante === 'M'), s = d.variantes.find((v) => v.variante === 'S');
  es('la M se vendió y se agotó', [m.vendidas, m.stock, m.senales], [5, 0, ['agotado']]);
  es('la S está quieta', [s.vendidas, s.stock, s.senales], [0, 10, ['sin_rotacion']]);
  es('el producto suma sus tallas', [prod('Funda').vendidas, prod('Funda').stock, prod('Funda').utilidad], [5, 10, 10000]);
  ok('la variante hereda la línea de su producto', m.linea === 'Estuches');

  const est = d.lineas.find((l) => l.linea === 'Estuches'), tel = d.lineas.find((l) => l.linea === 'Telefonos');
  es('línea Estuches: productos, vendidas y ventas', [est.productos, est.vendidas, est.ventas], [7, 179, 1265000]);
  es('…lo que tiene quieto', [est.productos_sin_rotacion, est.valor_sin_rotacion], [1, 200000]);
  es('línea Telefonos', [tel.ventas, tel.utilidad, tel.valor_stock], [1900000, 400000, 9000000]);
  ok('lo que no tiene línea va a «Sin línea»', d.lineas.some((l) => l.linea === 'Sin línea' && l.ventas === 200000));
  ok('los % de ventas de las líneas suman 100', Math.abs(d.lineas.reduce((x, l) => x + l.participacion_ventas_pct, 0) - 100) < 0.5);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('4. Proveedores');
{
  es('cuatro proveedores (el del otro negocio no)', d.proveedores.map((p) => p.proveedor).sort(), ['Barato SAS', 'Caro Ltda', 'Equipos Buenos', 'Equipos Quietos']);
  const a = pv(A), b = pv(B), c = pv(C), x = pv(D);
  es('A: 2 compras vivas y 1 cancelada que no suma', [a.compras, a.compras_canceladas, a.valor, a.unidades], [2, 1, 760000, 230]);
  es('B: lo devuelto se resta y se cuenta', [b.unidades, b.valor, b.unidades_devueltas, b.valor_devuelto, b.devuelto_pct], [90, 495000, 10, 55000, 10]);
  ok('B: señal de devoluciones (10 % > 5 %)', b.senales.includes('devoluciones'));
  es('B: compró a crédito y tuvo 2 novedades', [b.compras_credito, b.novedades], [1, 2]);
  es('total comprado y participación', [d.resumen.comprado, x.participacion_pct], [10755000, 74.4]);
  ok('D concentra las compras', x.senales.includes('concentracion'));
  es('★ C: su equipo se vendió en 10 días dejando 400.000', [c.equipos, c.equipos_vendidos, c.equipos_vendidos_pct, c.dias_para_vender, c.equipos_utilidad], [1, 1, 100, 10, 400000]);
  es('…margen de sus equipos', c.equipos_margen_pct, 21.1);
  es('★ D: 5 equipos, ninguno vendido, 8.000.000 quietos hace 40 días', [x.equipos, x.equipos_vendidos, x.equipos_sin_vender, x.valor_sin_vender, x.dias_sin_vender], [5, 0, 5, 8000000, 40]);
  ok('…y lleva la señal', x.senales.includes('equipos_no_rotan'));
  ok('C no la lleva (un solo equipo no alcanza para opinar)', !c.senales.includes('equipos_no_rotan'));
  es('la deuda de hoy: A 500.000 vencidos, B 100.000 al día', [a.deuda, a.deuda_vencida, b.deuda, b.deuda_vencida], [500000, 500000, 100000, 0]);
  ok('A lleva «Deuda vencida»; B no', a.senales.includes('deuda_vencida') && !b.senales.includes('deuda_vencida'));
  es('B sale más caro en 1 producto, 180.000 de diferencia', [b.productos_comparables, b.productos_mas_caro, b.sobrecosto], [1, 1, 180000]);
  ok('A no es «más caro» en nada', a.productos_mas_caro === 0 && !a.senales.includes('mas_caro'));
  ok('ordenados por lo comprado', d.proveedores[0].proveedor_id === D);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('5. El mismo producto, según el proveedor');
{
  const filas = d.precios_compra.filter((f) => f.producto === 'Estuche A');
  es('Estuche A: dos proveedores, comparables', [filas.length, filas.every((f) => f.comparable)], [2, true]);
  const caro = filas.find((f) => f.proveedor_id === B), barato = filas.find((f) => f.proveedor_id === A);
  es('★ B: 5.500 contra 3.500 de A = 57,1 % más, 180.000 en 90 uds',
    [caro.precio_promedio, caro.mejor_precio, caro.mejor_proveedor, caro.diferencia_pct, caro.sobrecosto, caro.unidades],
    [5500, 3500, 'Barato SAS', 57.1, 180000, 90]);
  es('señales: más caro / mejor precio', [caro.senales, barato.senales], [['mas_caro'], ['mejor_precio']]);
  es('el más barato no tiene diferencia', [barato.diferencia_pct, barato.sobrecosto], [0, 0]);
  const nuevo = d.precios_compra.find((f) => f.producto === 'Estuche Nuevo');
  es('con un solo proveedor no hay comparación', [nuevo.comparable, nuevo.mejor_precio, nuevo.senales], [false, null, []]);
  const iph = d.precios_compra.filter((f) => f.producto === 'iPhone X');
  es('el iPhone, a C y a D: 1.600.000 contra 1.500.000', iph.map((f) => f.precio_promedio).sort(), [1500000, 1600000]);
  ok('el más caro de todos va primero', d.precios_compra[0].sobrecosto === 500000 && d.precios_compra[0].proveedor_id === D);
  ok('la compra cancelada (a $1) no contaminó el precio', barato.precio_min === 3500);
  // El promedio ponderado, sobre la función pura.
  const p = asesor._armarPrecios([
    { tipo: 'cantidad', nombre: 'X', nodo: null, proveedor_id: 1, proveedor: 'Uno', compras: 4, unidades: 530, valor: 3 * 10 * 5000 + 500 * 3500, precio_min: 3500, precio_max: 5000, precio_primero: 5000, precio_ultimo: 3500, ultima_compra: hoy },
    { tipo: 'cantidad', nombre: 'X', nodo: null, proveedor_id: 2, proveedor: 'Dos', compras: 1, unidades: 10, valor: 30000, precio_min: 3000, precio_max: 3000, precio_primero: 3000, precio_ultimo: 3000, ultima_compra: hoy },
  ]);
  const unoP = p.find((f) => f.proveedor_id === 1);
  ok('★ el promedio va ponderado por unidades (3.585, no 4.625)', Math.round(unoP.precio_promedio) === 3585, String(unoP.precio_promedio));
  es('y el cambio de precio del mismo proveedor (5.000 → 3.500)', unoP.variacion_pct, -30);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('6. Clientes y cartera');
{
  const cl = d.clientes;
  es('tres claves de cliente', cl.filas.map((c) => c.cliente).sort(), ['Ana', 'Beto', 'Cliente Generico']);
  const ana = cl.filas.find((c) => c.cliente === 'Ana');
  es('Ana: 2 facturas en 2 días, volvió', [ana.facturas, ana.dias_de_compra, ana.total, ana.senales], [2, 2, 1400000, ['recurrente']]);
  ok('★ el cliente genérico no es un cliente', cl.filas.find((c) => c.cedula === '0000').senales[0] === 'generico'
    && cl.resumen.clientes === 2 && cl.resumen.recurrentes === 1);
  es('lo vendido sin identificar', [cl.resumen.ventas_sin_identificar, cl.resumen.ventas_sin_identificar_pct], [65000, 1.9]);
  ok('reconoce los genéricos por cédula y por nombre', asesor._esGenerico({ cedula: '0000' }) && asesor._esGenerico({ nombre: 'Consumidor final' })
    && asesor._esGenerico({ cedula: '222222222222' }) && !asesor._esGenerico({ nombre: 'Genaro', cedula: '1020' }));

  const ca = d.cartera;
  es('por cobrar: el crédito de Beto y el préstamo de Carla', [ca.resumen.por_cobrar, ca.resumen.documentos, ca.resumen.deudores], [600000, 2, 2]);
  es('…el ajuste, el saldado y el del otro negocio no', [ca.resumen.en_creditos, ca.resumen.en_prestamos], [400000, 200000]);
  es('por antigüedad', ca.antiguedad.map((t) => t.saldo), [200000, 0, 400000, 0]);
  ok('el tramo viejo lleva la señal', ca.antiguedad[2].senales[0] === 'cartera_vieja' && ca.antiguedad[0].senales.length === 0);
  const beto = ca.deudores.find((p) => p.cliente === 'Beto');
  es('Beto: 400.000, vencido hace 40 días, debe desde hace 70', [beto.saldo, beto.saldo_vencido, beto.dias_vencido, beto.dias_mas_antiguo], [400000, 400000, 40, 70]);
  es('…con sus dos señales', beto.senales, ['vencido', 'cartera_vieja']);
  const carla = ca.deudores.find((p) => p.cliente === 'Carla');
  es('Carla: sin fecha límite no hay vencido', [carla.saldo, carla.saldo_vencido, carla.dias_vencido, carla.senales], [200000, 0, null, []]);
  es('vencido y viejo del resumen', [ca.resumen.vencido, ca.resumen.vencido_pct, ca.resumen.viejo, ca.resumen.sin_plazo], [400000, 66.7, 400000, 1]);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('7. Equipos en inventario');
{
  es('un solo modelo', d.equipos_stock.map((e) => e.producto), ['iPhone X']);
  const e = d.equipos_stock[0];
  es('6 disponibles por 9.000.000 (el vendido no)', [e.unidades, e.valor], [6, 9000000]);
  es('por tramos: 5 de 40 días y 1 de 100', [e.d_0_30, e.d_31_60, e.d_61_90, e.d_mas_90], [0, 5, 0, 1]);
  es('el quieto: 1 unidad por 1.000.000, 100 días', [e.unidades_viejas, e.valor_viejo, e.dias_max, e.senales], [1, 1000000, 100, ['equipo_viejo']]);
  es('días en promedio (5×40 + 100) / 6', e.dias_promedio, 50);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('8. Alcance');
{
  const n = await asesor.getAnalisisAsesor(1, { sucursalIds: [1, 2], desde: DESDE, hasta: HASTA, todoElNegocio: true });
  const a = n.productos.find((p) => p.nombre === 'Estuche A');
  es('★ con dos sedes, el mismo producto suma en UNA fila (por nombre)', [n.productos.filter((p) => p.nombre === 'Estuche A').length, a.vendidas, a.stock], [1, 160, 140]);
  es('ventas del negocio', n.resumen.ventas, 3445000);
  es('la tabla por sede', n.sedes.map((s) => [s.sede, s.ventas]), [['Centro', 3365000], ['Norte', 80000]]);
  es('en una sola sede la tabla trae solo esa', d.sedes.length, 1);
  es('el alcance lo dice', [n.alcance.todo_el_negocio, n.alcance.sedes.map((s) => s.nombre), n.alcance.dias], [true, ['Centro', 'Norte'], 60]);
  ok('la deuda con proveedores NO cambia con el alcance (es del negocio)', n.resumen.deuda_proveedores === d.resumen.deuda_proveedores);

  const ajeno = await lanza(() => asesor.getAnalisisAsesor(1, { sucursalIds: [1, 3], desde: DESDE, hasta: HASTA }));
  ok('★ una sede de OTRO negocio en la lista: 403, no sus datos', ajeno?.status === 403);
  ok('sin sedes: 400', (await lanza(() => asesor.getAnalisisAsesor(1, { sucursalIds: [], desde: DESDE, hasta: HASTA })))?.status === 400);
  const json = JSON.stringify(d);
  ok('nada del otro negocio se coló (ni 7777 uds, ni su proveedor, ni su deuda)',
    !json.includes('7777') && !json.includes('Proveedor ajeno') && !json.includes('9999999') && !json.includes('Intruso'));

  const vacio = await asesor.getAnalisisAsesor(1, { sucursalIds: [1], desde: '2020-01-01', hasta: '2020-01-31' });
  ok('un período sin movimiento no revienta', vacio.resumen.ventas === 0 && vacio.resumen.utilidad === null && vacio.proveedores.length === 0);
  ok('…y el inventario y la cartera (que son a hoy) siguen ahí', vacio.resumen.inventario === 9657500 && vacio.cartera.resumen.por_cobrar === 600000);
  ok('…sin acusar de «agotado» a nada', !vacio.productos.some((p) => p.senales.includes('agotado')));

  columnas._setObsequiosDisponible(false);
  const sinObs = await asesor.getAnalisisAsesor(1, { sucursalIds: [1], desde: DESDE, hasta: HASTA });
  columnas._setObsequiosDisponible(true);
  ok('sin la columna de obsequios da las mismas cifras', sinObs.resumen.ventas === d.resumen.ventas && sinObs.resumen.utilidad === d.resumen.utilidad);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('9. Hallazgos');
{
  const h = d.hallazgos;
  const con = (texto) => h.find((x) => x.titulo.includes(texto) || x.detalle.includes(texto));
  ok('van ordenados: alertas, para revisar, datos',
    h.map((x) => x.nivel).join(',') === [...h].sort((a, b) => ({ alerta: 0, atencion: 1, dato: 2 }[a.nivel] - { alerta: 0, atencion: 1, dato: 2 }[b.nivel])).map((x) => x.nivel).join(','));
  const precio = con('según a quién se lo compraste');
  ok('★ el mismo artículo más caro: 180.000, con el caso', precio?.nivel === 'alerta' && precio.titulo.includes('$180.000')
    && precio.detalle.includes('Caro Ltda') && precio.detalle.includes('Barato SAS'), precio?.titulo);
  const equipo = con('mismo modelo de equipo');
  ok('★ en equipos NO se llama sobrecosto: es «para revisar» y explica por qué', equipo?.nivel === 'atencion' && equipo.detalle.includes('estado de cada unidad'));
  ok('los equipos que no se venden', con('Los equipos de Equipos Quietos no se están vendiendo')?.nivel === 'alerta');
  ok('la deuda vencida con proveedores', con('$500.000 vencidos con 1 proveedor')?.nivel === 'alerta');
  ok('las devoluciones', Boolean(con('A Caro Ltda le devolviste el 10 %')));
  ok('la concentración', Boolean(con('Equipos Quietos concentra el 74.4 %')));
  ok('lo que no rota, con su valor', con('1 producto tiene stock y no vendió ni una unidad')?.detalle.includes('$200.000'));
  ok('lo agotado', con('1 producto que se vende está agotado')?.detalle.includes('Cable'));
  ok('lo vendido por debajo del costo', con('se vendió por debajo del costo')?.detalle.includes('Barato'));
  ok('lo que no tiene costo', Boolean(con('4 unidades vendidas no tienen costo')));
  ok('se compró mucho más de lo que se vendió', con('Compraste')?.tabla === 'meses');
  ok('la cartera vieja y la vencida', Boolean(con('más de 60 días')) && Boolean(con('ya pasaron de su fecha límite')));
  ok('el equipo quieto', Boolean(con('1 equipo lleva más de 60 días')));
  ok('lo vendido a crédito', Boolean(con('56.5 % de lo vendido fue a crédito')));
  const tablas = new Set(['proveedores', 'precios_compra', 'productos', 'variantes', 'lineas', 'meses', 'sedes', 'ventas_dia',
    'ventas_hora', 'clientes', 'cartera_antiguedad', 'cartera_deudores', 'equipos_stock']);
  ok('cada hallazgo apunta a una tabla que existe', h.every((x) => tablas.has(x.tabla)), h.filter((x) => !tablas.has(x.tabla)).map((x) => x.tabla).join(','));
  ok('ninguno trae «undefined», «null» ni «NaN» en el texto', !h.some((x) => /undefined|null|NaN/.test(x.titulo + x.detalle)),
    h.filter((x) => /undefined|null|NaN/.test(x.titulo + x.detalle)).map((x) => x.titulo).join(' | '));
  const sinNada = await asesor.getAnalisisAsesor(2, { sucursalIds: [3], desde: '2020-01-01', hasta: '2020-01-31' });
  ok('sin datos, los hallazgos no inventan', !sinNada.hallazgos.some((x) => /undefined|NaN/.test(x.titulo + x.detalle)));
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('10. ★ El contrato con la pantalla');
const defs = await import(pathToFileURL(path.join(FRONT, 'src/pages/reportes/asesor/tablasAsesor.js')).href);
{
  const n = await asesor.getAnalisisAsesor(1, { sucursalIds: [1, 2], desde: DESDE, hasta: HASTA, todoElNegocio: true });
  const faltan = [];
  for (const t of defs.TABLAS) {
    const filas = (t.filasExcel || t.filas)(n);
    if (!filas.length) { faltan.push(`${t.id}: sin filas en el escenario`); continue; }
    for (const col of t.columnas) if (!(col.clave in filas[0])) faltan.push(`${t.id}.${col.clave}`);
  }
  ok('★ cada columna de cada tabla existe en lo que manda el backend', faltan.length === 0, faltan.join(', '));
  es('trece tablas', defs.TABLAS.length, 13);
  ok('cada hallazgo lleva a una tabla definida', n.hallazgos.every((h) => defs.tablaPorId(h.tabla)));
  const senalesUsadas = new Set(defs.TABLAS.flatMap((t) => t.filas(n).flatMap((f) => f.senales || [])));
  ok('★ toda señal que manda el backend tiene texto y explicación en la pantalla',
    [...senalesUsadas].every((s) => defs.SENALES[s]), [...senalesUsadas].filter((s) => !defs.SENALES[s]).join(','));
  ok('…y la explicación se arma con los umbrales del backend (sin «undefined»)',
    Object.values(defs.SENALES).every((s) => !/undefined|NaN/.test(s.ayuda(n.umbrales))));
  ok('los indicadores existen en el resumen', defs.INDICADORES.every((i) => i.clave in n.resumen));
  ok('cada tabla es de un grupo que existe', defs.TABLAS.every((t) => defs.GRUPOS.some((g) => g.id === t.grupo)));
  ok('nombres de hoja válidos para Excel (31 caracteres, sin : \\ / ? * [ ])',
    defs.TABLAS.every((t) => t.hoja.length <= 31 && !/[:\\/?*[\]]/.test(t.hoja)) && new Set(defs.TABLAS.map((t) => t.hoja)).size === defs.TABLAS.length);

  // Ordenar y buscar, las funciones puras de la pantalla.
  const tp = defs.tablaPorId('productos');
  const cols = defs.columnasDePantalla(tp);
  const porMargen = defs.ordenarFilas(n.productos, { clave: 'margen_pct', desc: false }, cols);
  ok('★ al ordenar, lo que no tiene dato va al FINAL en los dos sentidos',
    porMargen.at(-1).margen_pct === null && defs.ordenarFilas(n.productos, { clave: 'margen_pct', desc: true }, cols).at(-1).margen_pct === null
    && porMargen[0].nombre === 'Barato');
  es('buscar sin tildes y por palabras', defs.buscarFilas(n.productos, 'estuche quiéto', cols).map((p) => p.nombre), ['Estuche Quieto']);
  es('contar señales para los filtros', defs.contarSenales(n.productos).find((s) => s.clave === 'sin_rotacion').cuantas, 1);
  es('formato de celdas', [defs.formatearCelda(1200000, 'moneda'), defs.formatearCelda(null, 'moneda'), defs.formatearCelda(56.3, 'pct'),
    defs.formatearCelda(40, 'dias'), defs.formatearCelda(['agotado', 'perdida'], 'senales')],
  ['$1.200.000', '—', '56,3 %', '40 d', 'Agotado, Pérdida']);
  ok('en pantalla, la tabla de precios solo trae los comparables; el Excel, todos',
    defs.tablaPorId('precios_compra').filas(n).every((f) => f.comparable)
    && defs.tablaPorId('precios_compra').filasExcel(n).some((f) => !f.comparable));
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('11. El Excel, generado de verdad y releído');
{
  const n = await asesor.getAnalisisAsesor(1, { sucursalIds: [1, 2], desde: DESDE, hasta: HASTA, todoElNegocio: true });
  const excel = await import(pathToFileURL(path.join(FRONT, 'src/utils/exportarAnalisisAsesorExcel.js')).href);
  const X = createRequire(path.join(FRONT, 'package.json'))('xlsx');
  const buf = X.write(excel.construirLibroAsesor(n, { negocio: 'Mío' }), { type: 'buffer', bookType: 'xlsx' });
  const wb = X.read(buf, { type: 'buffer', cellNF: true });
  const celda = (hoja, r, c) => wb.Sheets[hoja][X.utils.encode_cell({ r, c })];

  es('la primera hoja es el Resumen', wb.SheetNames[0], 'Resumen');
  es('…y hay una por tabla con datos (13)', wb.SheetNames.length, 14);
  ok('el nombre del archivo dice el período y el alcance',
    excel.nombreArchivoAsesor(n) === `analisis-asesoria_${DESDE}_a_${HASTA}_negocio.xlsx`);

  const tp = defs.tablaPorId('productos');
  es('la cabecera de Productos son TODAS sus columnas (también las de solo Excel)',
    tp.columnas.map((_, c) => celda('Productos', 4, c)?.v), tp.columnas.map((col) => col.titulo));
  ok('…más que las de la pantalla', tp.columnas.length > defs.columnasDePantalla(tp).length);
  const iNombre = 0, iVentas = tp.columnas.findIndex((x) => x.clave === 'ventas'), iMargen = tp.columnas.findIndex((x) => x.clave === 'margen_pct'),
    iSen = tp.columnas.findIndex((x) => x.clave === 'senales'), iUtil = tp.columnas.findIndex((x) => x.clave === 'utilidad');
  const filaDe = (nombre) => { for (let r = 5; r < 60; r++) if (celda('Productos', r, iNombre)?.v === nombre) return r; return -1; };
  const rA = filaDe('Estuche A');
  ok('★ los números van como NÚMEROS con formato, no como texto',
    celda('Productos', rA, iVentas).t === 'n' && celda('Productos', rA, iVentas).v === 1280000 && /#,##0/.test(celda('Productos', rA, iVentas).z),
    JSON.stringify(celda('Productos', rA, iVentas)));
  ok('el margen, como número con su %', celda('Productos', rA, iMargen).t === 'n' && celda('Productos', rA, iMargen).z.includes('%'));
  ok('★ lo que no tiene dato va VACÍO (no «0» ni «—»)', (celda('Productos', filaDe('SinCosto'), iUtil)?.v ?? '') === '');
  es('las señales, en texto', celda('Productos', filaDe('Estuche Quieto'), iSen).v, 'No rota');
  ok('la pérdida va en negativo', celda('Productos', filaDe('Barato'), iUtil).v === -5000);
  ok('cada hoja de tabla trae filtro en su cabecera', wb.SheetNames.slice(1).every((h) => /^A5:/.test(wb.Sheets[h]['!autofilter']?.ref || '')));
  ok('la hoja de precios trae también los de un solo proveedor',
    X.utils.sheet_to_json(wb.Sheets['Precios de compra'], { header: 1 }).some((f) => f[0] === 'Estuche Nuevo'));

  const resumen = X.utils.sheet_to_json(wb.Sheets.Resumen, { header: 1 }).map((f) => f.join(' | '));
  ok('el Resumen dice el período, las sedes y el negocio', resumen[0].includes('Mío') && resumen[1].includes(DESDE) && resumen[2].includes('Centro, Norte'));
  ok('…los indicadores', resumen.some((f) => f.startsWith('Vendido | 3445000')));
  ok('…los hallazgos con su hoja', resumen.some((f) => f.startsWith('Alerta | Precios de compra | El mismo artículo')));
  ok('…cómo leer las señales, con los umbrales', resumen.some((f) => f.includes('No rota')) && resumen.some((f) => f.includes('más de 60 días')));
  ok('…y la advertencia de qué utilidad es', resumen.some((f) => f.includes('No es la utilidad cobrada')));

  const unaSede = X.read(X.write(excel.construirLibroAsesor(d), { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  ok('★ con una sola sede no hay hoja «Sedes» (no se exportan hojas vacías)', !unaSede.SheetNames.includes('Sedes') && unaSede.SheetNames.length === 13);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('12. Estática');
{
  const svc = leer(RAIZ, 'src/modules/reportes/asesor.service.js');
  const sinComentarios = svc.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  ok('★ el servicio no escribe: ni INSERT, ni UPDATE, ni DELETE', !/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i.test(sinComentarios));
  ok('★ el costo de lo vendido es el de reportes.service, importado', /SQL_COSTO_LINEA \} = reportes\._sql/.test(svc)
    && !/costo_unitario FROM variantes_atributo v WHERE v\.id = l\.variante_id/.test(svc));
  ok('el valor del equipo en un local sale del mismo fragmento que la pestaña Inventario', (svc.match(/costoRed\.sqlValorInternoEnStock\(/g) || []).length === 2);
  ok('la deuda sale de acreedores', svc.includes('acreedoresRepo.findSaldosPorProveedor(negocioId)'));
  ok('toda consulta de ventas lleva el filtro de sede, fecha y no cancelada', (svc.match(/WHERE \$\{FILTRO_VENTA\}/g) || []).length === 4);
  ok('toda consulta de compras lleva el suyo', (svc.match(/\$\{FILTRO_COMPRA\}/g) || []).length === 4);
  ok('las sedes se validan contra el negocio dentro del servicio', /WHERE negocio_id = \$1 AND id = ANY\(\$2::int\[\]\)/.test(svc));

  const rutas = leer(RAIZ, 'src/modules/reportes/reportes.routes.js');
  const linea = rutas.slice(rutas.indexOf("'/analisis/asesor'"), rutas.indexOf('ctrl.getAnalisisAsesor'));
  ok('★ la ruta es solo de admin_negocio (son costos y márgenes)', /requireNivel\('admin_negocio'\)/.test(linea) && /requireModulo\('reportes'\)/.test(linea));
  ok('…y valida el rango y el alcance', linea.includes('validarRango') && linea.includes("isIn(['sede', 'negocio'])"));
  const ctrl = leer(RAIZ, 'src/modules/reportes/reportes.controller.js');
  const cuerpo = ctrl.slice(ctrl.indexOf('const getAnalisisAsesor'), ctrl.indexOf('module.exports'));
  ok('el controlador no acepta ids de sede del cliente', !/req\.(query|body)\.sucursal/.test(cuerpo) && cuerpo.includes('req.user.negocio_id'));

  const panel = leer(FRONT, 'src/pages/reportes/PanelAsesor.jsx');
  ok('la pantalla no calcula: ninguna suma ni resta propia', !/\.reduce\(/.test(panel));
  ok('…y no usa useEffect', !/useEffect\(/.test(panel) && !/import \{[^}]*useEffect/.test(panel));
  ok('el Excel sale de la misma definición que la pantalla',
    leer(FRONT, 'src/utils/exportarAnalisisAsesorExcel.js').includes("from '../pages/reportes/asesor/tablasAsesor.js'")
    && panel.includes("from './asesor/tablasAsesor'"));
  ok('Análisis ofrece las dos vistas', leer(FRONT, 'src/pages/reportes/PanelAnalisis.jsx').includes("label: 'Tablas para asesoría'"));
  ok('una mutación refresca también estas tablas', leer(FRONT, 'src/api/reportes.api.js').includes("'analisis-asesor',"));
}

console.log(`\n${'─'.repeat(60)}\n${pasados} verificaciones pasaron, ${fallos.length} fallaron`);
if (fallos.length) { fallos.forEach((f) => console.log(`  ✗ ${f}`)); process.exit(1); }
process.exit(0);
