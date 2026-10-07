// ─────────────────────────────────────────────────────────────────────────────
// INVENTARIO MENOS DEUDA CON PROVEEDORES (6-oct-2026)
//
// Reportes → Inventario y el PDF de gestión dicen cuánto vale el inventario en
// costo menos lo que se le debe a los proveedores. Se mide a nivel de NEGOCIO:
// el inventario de todas las sedes activas menos la deuda completa, porque la
// cuenta con un proveedor no tiene sede.
//
//   · Sección 1 — lo de siempre no cambió: `getValorInventario` da lo mismo.
//   · Sección 2 — una sede: inventario de la pestaña − deuda = neto.
//   · Sección 3 — la deuda es la MISMA suma de la lista de Acreedores.
//   · Sección 4 — qué no se resta y qué no se suma (saldo a favor, otros
//                 acreedores, proveedor inactivo, otro negocio).
//   · Sección 5 — varias sedes: se suman todas; la inactiva no, salvo la elegida.
//   · Sección 6 — se mueve solo: pagar baja la deuda, vender baja el inventario.
//   · Sección 7 — el PDF imprime las mismas cifras; sin negocio, sale como antes.
//   · Sección 8 — estática: pantalla, controlador y una sola definición.
//
// Requiere PGlite (no va en package.json a propósito):
//   npm install --no-save @electric-sql/pglite
// ─────────────────────────────────────────────────────────────────────────────
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Writable } from 'node:stream';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');
const FRONT = path.resolve(RAIZ, '../frontend/src');
const leer = (...p) => readFileSync(path.join(...p), 'utf8');

const db = new PGlite();
await db.exec(leer(AQUI, 'esquema.sql'));
await db.exec(leer(AQUI, 'esquema-completo.sql'));
for (const m of ['20260725_red_interna', '20260726_red_interna_v2', '20260822_red_interna_envios',
  '20260823_red_interna_control', '20260823_red_interna_cargos_pagables', '20260823_remision_variantes',
  '20260823_lotes_cantidad', '20260824_costo_origen_remision', '20260823_valor_acreditado']) {
  await db.exec(leer(RAIZ, `../migrations/${m}.sql`));
}
// Las cuentas por pagar, con las columnas que tocan las consultas de la lista.
await db.exec(`
  CREATE TABLE IF NOT EXISTS acreedores (
    id SERIAL PRIMARY KEY, negocio_id INT, nombre TEXT, cedula TEXT, telefono TEXT, proveedor_id INT);
  CREATE TABLE IF NOT EXISTS movimientos_acreedor (
    id SERIAL PRIMARY KEY, acreedor_id INT, usuario_id INT, tipo TEXT, valor NUMERIC DEFAULT 0,
    descripcion TEXT, fecha TIMESTAMP DEFAULT NOW(), fecha_vencimiento DATE,
    compra_id INT, cargo_id INT, sucursal_id INT, metodo TEXT, registrar_en_caja BOOLEAN DEFAULT TRUE);
`);

const conectar = (t) => ({ query: (s, p) => t.query(s, p ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

const reportes   = require(path.join(RAIZ, 'src/modules/reportes/reportes.service.js'));
const acreedores = require(path.join(RAIZ, 'src/modules/acreedores/acreedores.repository.js'));

let pasados = 0; const fallos = [];
const ok = (nombre, cond, detalle = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos.push(nombre);
};
const seccion = (t) => console.log(`\n═══ ${t} ═══`);
const q = async (s, p) => (await db.query(s, p ?? [])).rows;

// ── Escenario ────────────────────────────────────────────────────────────────
// Negocio 1 «Uno»: una sola sede (1).
// Negocio 2 «Varias»: sedes 2 y 3 activas, 4 inactiva.
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Uno'), ('Varias');
  INSERT INTO sucursales (negocio_id, nombre, activa) VALUES
    (1,'Principal',TRUE), (2,'Centro',TRUE), (2,'Norte',TRUE), (2,'Cerrada',FALSE);
  INSERT INTO usuarios (nombre) VALUES ('Admin');
`);
const serial = async (suc, nombre, precio, costos) => {
  const [{ id }] = await q(
    `INSERT INTO productos_serial (nombre, sucursal_id, precio, activo) VALUES ($1,$2,$3,TRUE) RETURNING id`,
    [nombre, suc, precio]);
  for (const [i, c] of costos.entries()) {
    await q(`INSERT INTO seriales (producto_id, imei, costo_compra, vendido, prestado) VALUES ($1,$2,$3,FALSE,FALSE)`,
      [id, `${suc}${id}${String(i).padStart(10, '0')}`, c]);
  }
  return id;
};
const cantidad = async (suc, nombre, stock, costo, precio) => (await q(
  `INSERT INTO productos_cantidad (nombre, sucursal_id, stock, costo_unitario, precio, activo)
   VALUES ($1,$2,$3,$4,$5,TRUE) RETURNING id`, [nombre, suc, stock, costo, precio]))[0].id;

// Sede 1: 2 equipos (600 + 400 mil) + 10 cargadores a 20 mil = 1.200.000,
// y un equipo y 3 fundas SIN costo.
await serial(1, 'iPhone 11', 1000000, [600000, 400000, null]);
const CARG = await cantidad(1, 'Cargador 20W', 10, 20000, 45000);
await cantidad(1, 'Funda', 3, null, 15000);
// Negocio 2: Centro 5.000.000, Norte 1.500.000, Cerrada 900.000.
await serial(2, 'Galaxy S24', 3500000, [2500000, 2500000]);
await cantidad(3, 'Audífonos', 50, 30000, 60000);
await cantidad(4, 'Vidrio', 90, 10000, 20000);

const proveedor = async (neg, nombre, { activo = true, tipo = 'proveedor' } = {}) => {
  const [{ id }] = await q(`INSERT INTO proveedores (negocio_id, nombre, tipo, activo) VALUES ($1,$2,$3,$4) RETURNING id`,
    [neg, nombre, tipo, activo]);
  return (await q(`INSERT INTO acreedores (negocio_id, nombre, proveedor_id) VALUES ($1,$2,$3) RETURNING id`,
    [neg, nombre, id]))[0].id;
};
const cargo = async (acr, valor) => (await q(
  `INSERT INTO movimientos_acreedor (acreedor_id, tipo, valor) VALUES ($1,'Cargo',$2) RETURNING id`, [acr, valor]))[0].id;
const abono = (acr, valor, cargoId = null) => q(
  `INSERT INTO movimientos_acreedor (acreedor_id, tipo, valor, cargo_id) VALUES ($1,'Abono',$2,$3)`, [acr, valor, cargoId]);

// ═════════════════════════════════════════════════════════════════════════════
seccion('1. Lo de siempre no cambió');
const VALOR_1 = await reportes.getValorInventario(1);
{
  ok('el inventario de la sede 1 en costo: 1.200.000', VALOR_1.totales.costo_total === 1200000, String(VALOR_1.totales.costo_total));
  ok('trae la lista de lo que no tiene costo (2 filas)', VALOR_1.sin_costo_items.length === 2);
  ok('no trae el bloque nuevo: lo agrega el controlador, no esta función', !('menos_deuda' in VALOR_1));
  const soloTotales = await reportes.getValorInventario(1, { soloTotales: true });
  ok('con soloTotales las cifras son las mismas',
    JSON.stringify(soloTotales.totales) === JSON.stringify(VALOR_1.totales)
    && JSON.stringify(soloTotales.serial) === JSON.stringify(VALOR_1.serial)
    && JSON.stringify(soloTotales.cantidad) === JSON.stringify(VALOR_1.cantidad));
  ok('…y solo se ahorra la lista', soloTotales.sin_costo_items.length === 0);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('2. Una sede: inventario − deuda = neto');
let A1, A2;
{
  const sinDeuda = await reportes.getInventarioMenosDeuda(1, 1, VALOR_1);
  ok('sin deudas: el neto ES el inventario', sinDeuda.neto === 1200000 && sinDeuda.deuda_proveedores === 0
    && sinDeuda.proveedores_con_deuda === 0);
  ok('el inventario es el «Costo total inventario» de la pestaña', sinDeuda.inventario_costo === VALOR_1.totales.costo_total);
  ok('una sola sede en el desglose', sinDeuda.sedes.length === 1 && sinDeuda.sedes[0].nombre === 'Principal');
  ok('dice cuántas unidades sin costo no suman (1 equipo + 3 fundas)', sinDeuda.unidades_sin_costo === 4);

  A1 = await proveedor(1, 'Distribuidora A');
  A2 = await proveedor(1, 'Importadora B');
  const c1 = await cargo(A1, 500000);
  await abono(A1, 200000, c1);           // debe 300.000
  await cargo(A2, 150000);               // debe 150.000
  const r = await reportes.getInventarioMenosDeuda(1, 1, VALOR_1);
  ok('deuda con proveedores: 450.000, de 2', r.deuda_proveedores === 450000 && r.proveedores_con_deuda === 2,
    `${r.deuda_proveedores} · ${r.proveedores_con_deuda}`);
  ok('neto: 1.200.000 − 450.000 = 750.000', r.neto === 750000, String(r.neto));
  ok('la identidad: neto = inventario − deuda', r.neto === r.inventario_costo - r.deuda_proveedores);
  const sinPasarValor = await reportes.getInventarioMenosDeuda(1, 1);
  ok('sin pasarle el inventario ya calculado da lo mismo', sinPasarValor.neto === r.neto
    && sinPasarValor.inventario_costo === r.inventario_costo && sinPasarValor.unidades_sin_costo === 4);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('3. La deuda es la misma suma de la lista de Acreedores');
{
  const lista = await acreedores.findAll(1, null);
  const sumaLista = lista.filter((a) => a.proveedor_id != null)
    .reduce((s, a) => s + Math.max(0, Number(a.saldo)), 0);
  const tot = await acreedores.findTotalesDeuda(1);
  ok('Σ saldo positivo de la lista == deuda del reporte', sumaLista === tot.deuda_proveedores && sumaLista === 450000,
    `${sumaLista} vs ${tot.deuda_proveedores}`);
  const repo = leer(RAIZ, 'src/modules/acreedores/acreedores.repository.js');
  const expr = "COALESCE(SUM(CASE WHEN m.tipo = 'Cargo' THEN m.valor ELSE -m.valor END), 0) AS saldo";
  ok('usa la MISMA expresión de saldo que la lista', repo.split(expr).length - 1 >= 4);
  ok('…y el mismo filtro de proveedores activos',
    repo.split('AND (a.proveedor_id IS NULL OR p.activo = TRUE)').length - 1 === 2);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('4. Qué no se resta y qué no se suma');
{
  // Saldo a favor con un proveedor: no le paga la deuda a otro.
  const A3 = await proveedor(1, 'Con anticipo');
  await abono(A3, 80000);                 // anticipo sin cargo: saldo −80.000
  let r = await reportes.getInventarioMenosDeuda(1, 1, VALOR_1);
  ok('un saldo a favor NO baja la deuda con los otros', r.deuda_proveedores === 450000 && r.neto === 750000);
  ok('…va aparte', r.saldo_a_favor === 80000);

  // Un anticipo SÍ baja la deuda con ESE proveedor.
  await abono(A2, 50000);                 // B debía 150.000 → 100.000
  r = await reportes.getInventarioMenosDeuda(1, 1, VALOR_1);
  ok('un abono libre baja la deuda de su propio proveedor', r.deuda_proveedores === 400000 && r.neto === 800000,
    String(r.deuda_proveedores));

  // Un acreedor que no es proveedor.
  const [{ id: otro }] = await q(`INSERT INTO acreedores (negocio_id, nombre) VALUES (1, 'Préstamo de un socio') RETURNING id`);
  await cargo(otro, 2000000);
  r = await reportes.getInventarioMenosDeuda(1, 1, VALOR_1);
  ok('un acreedor que NO es proveedor no se resta', r.deuda_proveedores === 400000 && r.neto === 800000);
  ok('…y se informa aparte', r.deuda_otros === 2000000);

  // Un proveedor desactivado no sale en la lista: tampoco aquí.
  const inactivo = await proveedor(1, 'Proveedor de baja', { activo: false });
  await cargo(inactivo, 999000);
  r = await reportes.getInventarioMenosDeuda(1, 1, VALOR_1);
  ok('un proveedor desactivado no cuenta (igual que en la lista)', r.deuda_proveedores === 400000);

  // Un proveedor de cruce es un proveedor.
  const cruce = await proveedor(1, 'Local vecino', { tipo: 'cruce' });
  await cargo(cruce, 100000);
  r = await reportes.getInventarioMenosDeuda(1, 1, VALOR_1);
  ok('un proveedor de cruce sí cuenta', r.deuda_proveedores === 500000 && r.proveedores_con_deuda === 3 && r.neto === 700000);

  // La deuda de otro negocio.
  const ajeno = await proveedor(2, 'Proveedor del otro negocio');
  await cargo(ajeno, 4000000);
  r = await reportes.getInventarioMenosDeuda(1, 1, VALOR_1);
  ok('la deuda de OTRO negocio no entra', r.deuda_proveedores === 500000 && r.neto === 700000);

  // Deber más de lo que hay.
  const grande = await cargo(A1, 5000000);
  r = await reportes.getInventarioMenosDeuda(1, 1, VALOR_1);
  ok('si se debe más de lo que hay, el neto sale NEGATIVO (no se recorta a 0)', r.neto === 1200000 - 5500000, String(r.neto));
  await q('DELETE FROM movimientos_acreedor WHERE id = $1', [grande]);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('5. Varias sedes: la deuda es del negocio, el inventario también');
{
  const centro = await reportes.getValorInventario(2);
  const r = await reportes.getInventarioMenosDeuda(2, 2, centro);
  ok('suma las sedes ACTIVAS: 5.000.000 + 1.500.000', r.inventario_costo === 6500000, String(r.inventario_costo));
  ok('la sede inactiva no entra', r.sedes.length === 2 && !r.sedes.some((s) => s.nombre === 'Cerrada'));
  ok('el desglose dice cuánto pone cada sede',
    r.sedes.find((s) => s.nombre === 'Centro').costo_total === 5000000
    && r.sedes.find((s) => s.nombre === 'Norte').costo_total === 1500000
    && r.sedes.find((s) => s.nombre === 'Norte').unidades === 50);
  ok('resta TODA la deuda del negocio: 6.500.000 − 4.000.000', r.deuda_proveedores === 4000000 && r.neto === 2500000);

  const norte = await reportes.getValorInventario(3);
  const desdeNorte = await reportes.getInventarioMenosDeuda(2, 3, norte);
  ok('★ desde cualquier sede el número es el MISMO', desdeNorte.neto === r.neto
    && desdeNorte.inventario_costo === r.inventario_costo);
  ok('★ no es «el inventario de esta sede menos toda la deuda»',
    desdeNorte.neto !== norte.totales.costo_total - desdeNorte.deuda_proveedores);

  const cerrada = await reportes.getValorInventario(4);
  const desdeCerrada = await reportes.getInventarioMenosDeuda(2, 4, cerrada);
  ok('si la sede elegida es la inactiva, sí se cuenta (se está mirando)',
    desdeCerrada.sedes.length === 3 && desdeCerrada.inventario_costo === 7400000);

  const sinSede = await reportes.getInventarioMenosDeuda(2, null);
  ok('sin sede elegida: las activas', sinSede.inventario_costo === 6500000 && sinSede.neto === 2500000);
  const una = await reportes.getInventarioMenosDeuda(1, 1, VALOR_1);
  ok('el inventario del negocio 2 no se cuela en el negocio 1', una.inventario_costo === 1200000 && una.sedes.length === 1);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('6. Se mueve solo');
{
  const antes = await reportes.getInventarioMenosDeuda(1, 1);
  await abono(A1, 100000);
  const pago = await reportes.getInventarioMenosDeuda(1, 1);
  ok('pagarle al proveedor baja la deuda y SUBE el neto en lo mismo',
    pago.deuda_proveedores === antes.deuda_proveedores - 100000 && pago.neto === antes.neto + 100000);

  await q('UPDATE productos_cantidad SET stock = stock - 4 WHERE id = $1', [CARG]);   // se vendieron 4 cargadores
  const venta = await reportes.getInventarioMenosDeuda(1, 1);
  ok('vender baja el inventario y el neto (4 × 20.000)',
    venta.inventario_costo === pago.inventario_costo - 80000 && venta.neto === pago.neto - 80000);

  await cargo(A2, 300000);                // una compra a crédito
  await q('UPDATE productos_cantidad SET stock = stock + 15 WHERE id = $1', [CARG]);  // …que trajo 15 a 20.000
  const compra = await reportes.getInventarioMenosDeuda(1, 1);
  ok('comprar a crédito sube inventario y deuda: el neto no se mueve',
    compra.inventario_costo === venta.inventario_costo + 300000
    && compra.deuda_proveedores === venta.deuda_proveedores + 300000 && compra.neto === venta.neto);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('7. El PDF de gestión imprime las mismas cifras');
{
  const PDFDocument = require(path.join(RAIZ, 'node_modules/pdfkit'));
  let textos = null;
  const orig = PDFDocument.prototype._fragment;
  PDFDocument.prototype._fragment = function (t, ...r) { if (textos) textos.push(String(t ?? '')); return orig.call(this, t, ...r); };
  const pdf = require(path.join(RAIZ, 'src/modules/reportes/reportes.pdf.js'));
  const render = async (extra) => {
    textos = [];
    const doc = await pdf.generarReporteContable({
      negocio: { nombre: 'Varias' }, sucursalNombre: 'Centro', sucursalId: 2,
      desde: '2026-10-01', hasta: '2026-10-06', agrupacion: 'dia', logo: null, ...extra,
    });
    await new Promise((res, rej) => {
      doc.on('error', rej);
      doc.pipe(new Writable({ write(_c, _e, cb) { cb(); }, final(cb) { cb(); res(); } }));
    });
    const out = textos.join(' ').replace(/\s+/g, ' ');
    textos = null;
    return out;
  };
  const norm = (s) => s.replace(/[  ]/g, ' ');

  let con;
  try { con = norm(await render({ negocioId: 2 })); } catch (e) { con = `ERROR ${e.message}`; }
  ok('el PDF se genera', !con.startsWith('ERROR'), con.slice(0, 160));
  ok('imprime la fila del neto', con.includes('Inventario menos deuda con proveedores'));
  ok('…con el inventario de las 2 sedes', /Inventario en costo de las 2 sedes del negocio/.test(con) && /6\.500\.000/.test(con));
  ok('…la deuda de todo el negocio', /\(-\) Deuda con proveedores \(todo el negocio\) · 1 con saldo/.test(con) && /4\.000\.000/.test(con));
  ok('…y el mismo neto que la pantalla: 2.500.000', /2\.500\.000/.test(con));
  ok('la sección de inventario de siempre sigue ahí', con.includes('Valor en costo') && con.includes('Valor en precio de venta'));

  let sin;
  try { sin = norm(await render({})); } catch (e) { sin = `ERROR ${e.message}`; }
  ok('sin negocioId (llamada antigua): el PDF sale como antes, sin la fila',
    !sin.startsWith('ERROR') && !sin.includes('Inventario menos deuda') && sin.includes('Valor en costo'));
  PDFDocument.prototype._fragment = orig;
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('8. Estática');
{
  const ctrl = leer(RAIZ, 'src/modules/reportes/reportes.controller.js');
  ok('el controlador lo manda dentro de la respuesta del inventario',
    /data\.menos_deuda = await service\.getInventarioMenosDeuda\(req\.user\.negocio_id, req\.sucursal_id, data\)/.test(ctrl));
  ok('…y si fallara, la pestaña sigue (try/catch con null)', /data\.menos_deuda = null/.test(ctrl));
  ok('el PDF recibe el negocio de la sesión', /negocioId:\s+req\.user\.negocio_id/.test(ctrl));
  const rutas = leer(RAIZ, 'src/modules/reportes/reportes.routes.js');
  ok('la ruta sigue siendo solo del admin (son costos)',
    /'\/inventario\/valor'.*requireNivel\('admin_negocio'\)/.test(rutas));

  const svc = leer(RAIZ, 'src/modules/reportes/reportes.service.js');
  const cuerpo = svc.slice(svc.indexOf('const getInventarioMenosDeuda'), svc.indexOf('// ─── getValorInventario'));
  ok('no calcula la deuda por su cuenta: la pide a acreedores', cuerpo.includes('acreedoresRepo.findTotalesDeuda(negocioId)')
    && !/movimientos_acreedor/.test(cuerpo.replace(/\/\/.*$/gm, '')));
  ok('no calcula el inventario por su cuenta: usa getValorInventario', cuerpo.includes('getValorInventario(sede.id'));

  const pant = leer(FRONT, 'pages/reportes/ReportesPage.jsx');
  ok('la pestaña Inventario pinta el bloque', pant.includes('<InventarioMenosDeuda datos={data.menos_deuda} />'));
  const comp = pant.slice(pant.indexOf('const InventarioMenosDeuda'), pant.indexOf('const PanelInventario'));
  ok('la pantalla solo PINTA: ninguna resta ni suma propia', !/reduce\(|\s-\s+datos\.|datos\.\w+\s+-\s/.test(comp));
  ok('sin el bloque (backend anterior) no pinta nada', /if \(!datos\) return null;/.test(comp));
  ok('usa las claves que manda el backend', ['inventario_costo', 'deuda_proveedores', 'neto', 'proveedores_con_deuda',
    'unidades_sin_costo', 'deuda_otros', 'saldo_a_favor', 'valorado_por_despacho', 'sedes']
    .every((k) => comp.includes(`datos.${k}`)));
}

console.log(`\n${'─'.repeat(60)}\n${pasados} verificaciones pasaron, ${fallos.length} fallaron`);
if (fallos.length) { fallos.forEach((f) => console.log(`  ✗ ${f}`)); process.exit(1); }
process.exit(0);
