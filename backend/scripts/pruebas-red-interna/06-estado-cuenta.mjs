// ─────────────────────────────────────────────────────────────────────────────
// ESTADO DE CUENTA DEL LOCAL (extracto tipo bancario)
//
// Verifica que el extracto cuente la historia completa y cuadre:
//   • cargos cuando el local vende, abonos cuando la bodega recibe la remesa
//   • saldo corrido coherente con el saldo del panel
//   • mercancía rastreable con búsqueda y filtros
//   • los documentos de respaldo (envíos y remesas)
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
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260725_red_interna.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260726_red_interna_v2.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260822_red_interna_envios.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260823_red_interna_control.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260823_red_interna_cargos_pagables.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260823_remision_variantes.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260823_lotes_cantidad.sql'), 'utf8'));

const conectar = (t) => ({ query: (s, p) => t.query(s, p ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

const service = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));
const repo    = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.repository.js'));

let fallos = 0, pasados = 0;
const money = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('es-CO');
function ok(nombre, cond, detalle = '') {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos++;
}

await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Test');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Bodega'),(1,'Centro');
  INSERT INTO usuarios (nombre) VALUES ('Admin'),('Vendedor');
  INSERT INTO config_negocio VALUES (1,'red_interna_activa','1'),(1,'red_interna_bodega_id','1');
  INSERT INTO lineas_producto (negocio_id, nombre) VALUES (1,'Celulares');

  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id, linea_id)
    VALUES ('iPhone 13','Apple','128GB', 2600000, 1, 1);
  INSERT INTO seriales (producto_id, imei, costo_compra) VALUES
    (1,'AAA111', 1800000), (1,'AAA222', 1850000), (1,'AAA333', 1900000);

  INSERT INTO cuentas_dinero (negocio_id, sucursal_id, nombre, tipo, metodos_pago)
    VALUES (1,1,'Efectivo','efectivo',ARRAY['Efectivo']),(1,2,'Efectivo','efectivo',ARRAY['Efectivo']);
`);

const bodega = { user:{id:1,negocio_id:1,rol:'admin_negocio'}, sucursal_id:1, esBodega:true,
  red:{activa:true,bodega_id:1,confirmar_recepcion:true,confirmar_remesa:true} };
const centro = { user:{id:2,negocio_id:1,rol:'supervisor'}, sucursal_id:2, esBodega:false, red:{...bodega.red} };

// Despachar 3 equipos y recibirlos
const r1 = await service.despachar(bodega, {
  sucursal_destino_id: 2,
  lineas: [1,2,3].map((id) => ({ tipo: 'serial', serial_id: id })),
  notas: 'Primer envío',
});
const l1 = await repo.getLineasRemision(r1.id);
await service.recibir(centro, r1.id, { lineas_recibidas: l1.map((x) => Number(x.id)) });

console.log('\n═══ 1. Recién recibido: el envío YA es el cargo ═══');
let cuenta = await service.getEstadoCuenta(centro, 2);
ok('Trae el nombre de la sucursal', cuenta.sucursal.nombre === 'Centro');
ok('★ La deuda nace con el envío, sin vender nada',
   Number(cuenta.totales.saldo_por_liquidar) === 5550000,
   money(cuenta.totales.saldo_por_liquidar));
const infoEnvio = cuenta.extracto.filter((e) => e.origen === 'remision');
ok('★ El envío es EL cargo del extracto', infoEnvio.length === 1 && infoEnvio[0].clase === 'cargo');
ok('  por el valor completo de lo recibido',
   Number(infoEnvio[0].valor) === 5550000, money(infoEnvio[0].valor));
ok('★ La mercancía lista los 3 equipos', cuenta.mercancia.total === 3);
ok('  todos en consignación', cuenta.conteo_estados['En consignacion'] === 3);

console.log('\n═══ 2. El local vende dos equipos ═══');
await db.exec(`
  INSERT INTO facturas (numero, sucursal_id, nombre_cliente, estado, fecha)
    VALUES (1, 2, 'Ana Pérez',  'Activa', NOW() + INTERVAL '1 minute'),
           (2, 2, 'Luis Gómez', 'Activa', NOW() + INTERVAL '2 minutes');
  INSERT INTO lineas_factura (factura_id, nombre_producto, imei, cantidad, precio)
    VALUES (1, 'iPhone 13', 'AAA111', 1, 2600000),
           (2, 'iPhone 13', 'AAA222', 1, 2650000);
  UPDATE seriales SET vendido = TRUE WHERE imei IN ('AAA111','AAA222');
`);

cuenta = await service.getEstadoCuenta(centro, 2);
// Las ventas siguen en el extracto, pero como INFORMATIVO: le cuentan al local
// de dónde va a salir la plata, no le generan deuda nueva.
const ventas = cuenta.extracto.filter((e) => e.origen === 'venta');
ok('★ Dos ventas anotadas', ventas.length === 2);
ok('  y ninguna mueve el saldo',
   ventas.every((v) => v.clase === 'info' && Number(v.valor) === 0));
ok('★ Cada venta trae el cliente', ventas.every((v) => !!v.tercero),
   ventas.map((v) => v.tercero).join(', '));
ok('★ Y el número de factura', ventas.every((v) => v.documento != null));
ok('★ La deuda no se movió: sigue siendo la del envío',
   Number(cuenta.totales.saldo_por_liquidar) === 5550000,
   money(cuenta.totales.saldo_por_liquidar));
ok('  lo que cambió es el informativo de lo vendido',
   Number(cuenta.totales.vendido_valor) === 3650000,
   money(cuenta.totales.vendido_valor));

console.log('\n═══ 3. El local remite $2.000.000 y la bodega confirma ═══');
const rem = await service.enviarRemesa(centro, { valor: 2000000, notas: 'Va con Pedro' });
cuenta = await service.getEstadoCuenta(centro, 2);
ok('★ En tránsito todavía NO aparece como abono',
   cuenta.extracto.filter((e) => e.origen === 'remesa').length === 0);
ok('  pero sí en la pestaña de remesas', cuenta.remesas.length === 1);
ok('  marcada como en tránsito', cuenta.remesas[0].estado === 'En transito');

await service.confirmarRemesa(bodega, rem.id);
cuenta = await service.getEstadoCuenta(centro, 2);
const abonos = cuenta.extracto.filter((e) => e.origen === 'remesa');
ok('★ Confirmada, ya es un abono en el extracto', abonos.length === 1);
ok('  con signo negativo', Number(abonos[0].valor) === -2000000, money(abonos[0].valor));
ok('★ Saldo baja a 3.550.000',
   Number(cuenta.totales.saldo_por_liquidar) === 5550000 - 2000000,
   money(cuenta.totales.saldo_por_liquidar));

console.log('\n═══ 4. Gasto por cuenta de bodega: lo aprueba la bodega ═══');
// El local pagó algo con plata de la bodega. La plata YA salió de su caja, pero
// la deuda no baja hasta que la bodega lo acepte: antes bajaba sola y un local
// podía rebajarse la deuda sin que nadie se enterara.
const gastoMov = await service.registrarGastoAutorizado(centro, {
  valor: 150000, concepto: 'Domicilio urgente',
});
ok('★ Nace por aprobar', gastoMov.estado === 'Por aprobar', gastoMov.estado);
cuenta = await service.getEstadoCuenta(centro, 2);
ok('★★ Y el saldo NO baja todavía',
   Number(cuenta.totales.saldo_por_liquidar) === 5550000 - 2000000,
   money(cuenta.totales.saldo_por_liquidar));

const bandeja = await service.getPanelBodega(bodega);
ok('★ Le aparece a la bodega en su bandeja',
   (bandeja.gastos_por_aprobar || []).some((g) => g.id === gastoMov.id),
   `${(bandeja.gastos_por_aprobar || []).length} por aprobar`);

await service.decidirGasto(bodega, gastoMov.id, { aprobar: true });
cuenta = await service.getEstadoCuenta(centro, 2);
const gasto = cuenta.extracto.find((e) => e.origen === 'gasto');
ok('★ Aprobado, ya aparece como abono', gasto && Number(gasto.valor) === -150000, money(gasto?.valor));
ok('  con su concepto', /Domicilio urgente/.test(gasto.concepto), gasto.concepto);
ok('★ Saldo baja a 3.400.000',
   Number(cuenta.totales.saldo_por_liquidar) === 5550000 - 2000000 - 150000,
   money(cuenta.totales.saldo_por_liquidar));

console.log('\n═══ 5. ★ El saldo corrido del extracto cuadra con el panel ═══');
// El extracto viene del más reciente al más viejo; el saldo del primero es el
// acumulado total, que debe coincidir con el saldo por liquidar.
const conValor = cuenta.extracto.filter((e) => e.clase !== 'info');
const saldoFinal = conValor.length
  ? Number(cuenta.extracto[0].saldo)
  : 0;
const sumaMovs = cuenta.extracto.reduce((s, e) => s + Number(e.valor), 0);
ok('★ La suma de los movimientos = saldo por liquidar',
   Math.abs(sumaMovs - Number(cuenta.totales.saldo_por_liquidar)) < 1,
   `${money(sumaMovs)} vs ${money(cuenta.totales.saldo_por_liquidar)}`);
ok('  el saldo corrido está calculado', Number.isFinite(saldoFinal));

console.log('\n═══ 6. Búsqueda y filtros en la mercancía ═══');
const porImei = await service.getEstadoCuenta(centro, 2, { q: 'AAA333' });
ok('★ Buscar por IMEI encuentra 1', porImei.mercancia.total === 1,
   porImei.mercancia.items[0]?.imei);

const porCliente = await service.getEstadoCuenta(centro, 2, { q: 'ana' });
ok('★ Buscar por cliente encuentra su venta', porCliente.mercancia.total === 1,
   porCliente.mercancia.items[0]?.nombre_cliente);

const soloVendidos = await service.getEstadoCuenta(centro, 2, { estado: 'Por liquidar' });
ok('★ Filtrar por "Por liquidar" trae 2', soloVendidos.mercancia.total === 2);
ok('  y suma su liquidable', Number(soloVendidos.mercancia.liquidable_total) === 3650000,
   money(soloVendidos.mercancia.liquidable_total));

const enVitrina = await service.getEstadoCuenta(centro, 2, { estado: 'En consignacion' });
ok('★ Filtrar por "En consignación" trae 1', enVitrina.mercancia.total === 1);
ok('  que no genera deuda', Number(enVitrina.mercancia.liquidable_total) === 0);

const sinResultados = await service.getEstadoCuenta(centro, 2, { q: 'zzzzz' });
ok('★ Una búsqueda sin resultados devuelve vacío, no error',
   sinResultados.mercancia.total === 0);

console.log('\n═══ 7. Cada unidad trae su trazabilidad completa ═══');
const u = soloVendidos.mercancia.items[0];
ok('Nombre del producto', !!u.nombre_producto);
ok('IMEI',                !!u.imei);
ok('Envío de origen',     u.remision_numero != null || u.remision_id != null);
ok('Fecha de recepción',  !!u.fecha_recepcion);
ok('Factura de venta',    u.factura_numero != null);
ok('Cliente',             !!u.nombre_cliente);
ok('Estado legible',      !!u.etiqueta_estado, u.etiqueta_estado);
ok('Valor y liquidable',  u.valor_interno > 0 && u.liquidable > 0);

console.log('\n═══ 8. Permisos: un local no ve la cuenta de otro ═══');
let bloqueado = false;
try { await service.getEstadoCuenta(centro, 1); } catch (e) { bloqueado = e.status === 403; }
ok('★ Rechazado', bloqueado);
const desdeBodega = await service.getEstadoCuenta(bodega, 2);
ok('★ La bodega sí puede ver la de cualquiera', desdeBodega.sucursal.id === 2);

console.log('\n═══ 9. Rango de fechas ═══');
const futuro = await service.getEstadoCuenta(centro, 2, { desde: '2099-01-01' });
ok('★ Un rango sin datos devuelve extracto vacío', futuro.extracto.length === 0);
ok('  pero los totales siguen siendo los reales (no dependen del filtro)',
   Number(futuro.totales.saldo_por_liquidar) === 5550000 - 2000000 - 150000,
   money(futuro.totales.saldo_por_liquidar));

console.log('\n═══ 10. Recepción confirmada TARDE: la venta intermedia sí cuenta ═══');
// Caso real: la mercancía llega el lunes y se vende, pero el local confirma la
// recepción el miércoles. El piso del cruce es la fecha de DESPACHO, no la de
// recepción, así que esa venta no se pierde.
// Los ids se resuelven en vivo: la recepción de las secciones anteriores ya
// creó filas de productos_serial en Centro, así que asumirlos sería frágil.
const prodGalaxy = (await db.query(`
  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id, linea_id)
  VALUES ('Galaxy A54','Samsung','256GB', 1200000, 1, 1) RETURNING id`)).rows[0].id;
const serialGalaxy = (await db.query(
  `INSERT INTO seriales (producto_id, imei, costo_compra) VALUES ($1,'BBB999', 900000) RETURNING id`,
  [prodGalaxy])).rows[0].id;

const rTarde = await service.despachar(bodega, {
  sucursal_destino_id: 2, lineas: [{ tipo: 'serial', serial_id: serialGalaxy }],
});
// El despacho se fecha hace 3 días; la venta, hace 2; la recepción, ahora.
await db.exec(`UPDATE remisiones SET fecha_emision = NOW() - INTERVAL '3 days' WHERE id = ${rTarde.id}`);
await db.exec(`
  INSERT INTO facturas (numero, sucursal_id, nombre_cliente, estado, fecha)
    VALUES (3, 2, 'Cliente Tardío', 'Activa', NOW() - INTERVAL '2 days');
  INSERT INTO lineas_factura (factura_id, nombre_producto, imei, cantidad, precio)
    VALUES (3, 'Galaxy A54', 'BBB999', 1, 1400000);
`);
const lTarde = await repo.getLineasRemision(rTarde.id);
await service.recibir(centro, rTarde.id, { lineas_recibidas: lTarde.map((x) => Number(x.id)) });
await db.exec(`UPDATE seriales SET vendido = TRUE WHERE imei = 'BBB999'`);

const cuentaTarde = await service.getEstadoCuenta(centro, 2);
// El cruce venta↔unidad ya no decide la deuda, pero sigue decidiendo el ESTADO
// que ve el local, y su piso sigue siendo la fecha de DESPACHO: si se usara la
// de recepción, esta venta se perdería y el equipo saldría "sin ubicar".
const ventaTardia = cuentaTarde.extracto.find((e) => e.referencia === 'BBB999');
ok('★ La venta anterior a la confirmación SÍ se reconoce',
   !!ventaTardia && ventaTardia.origen === 'venta');
const galaxy = cuentaTarde.mercancia.items.find((u) => u.imei === 'BBB999');
ok('  y el equipo queda "Por liquidar", no "Sin ubicar"',
   galaxy?.estado_unidad === 'Por liquidar', galaxy?.etiqueta_estado);
ok('★ La deuda sube por el ENVÍO nuevo, no por la venta',
   Number(cuentaTarde.totales.saldo_por_liquidar) === 5550000 - 2000000 - 150000 + 900000,
   money(cuentaTarde.totales.saldo_por_liquidar));

console.log(`\n${'═'.repeat(62)}`);
console.log(`RESULTADO: ${pasados} pasaron, ${fallos} fallaron`);
console.log('═'.repeat(62));
process.exit(fallos ? 1 : 0);
