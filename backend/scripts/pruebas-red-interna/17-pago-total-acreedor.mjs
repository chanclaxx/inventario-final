// ─────────────────────────────────────────────────────────────────────────────
// PAGO TOTAL A UN ACREEDOR — se reparte igual, se ve como uno solo
//
// La mejora es de LECTURA: internamente el pago se sigue repartiendo entre los
// cargos abiertos (una fila de Abono por cargo), pero el estado de cuenta lo
// muestra como el único movimiento que hizo el usuario. Esta suite verifica que
// esa presentación no toque un solo peso de la contabilidad:
//
//   • un pago de $10.000.000 aparece como UN movimiento en el estado de cuenta
//   • por dentro sigue repartido, cargo por cargo, en movimientos_acreedor
//   • el saldo final es idéntico al que daba la consulta anterior
//   • los abonos parciales normales siguen viéndose uno por uno
//   • borrar una porción (p. ej. al anular una compra) reduce el pago mostrado
//     y el saldo sigue cuadrando: el total se DERIVA, no está guardado
//   • el orden cronológico no cambia
// ─────────────────────────────────────────────────────────────────────────────
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');

const db = new PGlite();

// Esquema mínimo: solo lo que tocan las consultas bajo prueba.
await db.exec(`
  CREATE TABLE negocios   (id SERIAL PRIMARY KEY, nombre TEXT);
  CREATE TABLE sucursales (id SERIAL PRIMARY KEY, negocio_id INT, nombre TEXT);
  CREATE TABLE usuarios   (id SERIAL PRIMARY KEY, nombre TEXT);
  CREATE TABLE proveedores(id SERIAL PRIMARY KEY, nombre TEXT, tipo TEXT, activo BOOLEAN DEFAULT TRUE);
  CREATE TABLE compras    (id SERIAL PRIMARY KEY, numero INT, sucursal_id INT, total NUMERIC);
  CREATE TABLE acreedores (
    id SERIAL PRIMARY KEY, negocio_id INT, nombre TEXT, cedula TEXT,
    telefono TEXT, proveedor_id INT
  );
  CREATE TABLE movimientos_acreedor (
    id SERIAL PRIMARY KEY, acreedor_id INT, usuario_id INT, tipo TEXT,
    valor NUMERIC DEFAULT 0, descripcion TEXT, firma TEXT,
    fecha TIMESTAMP DEFAULT NOW(), compra_id INT, cargo_id INT,
    registrar_en_caja BOOLEAN DEFAULT TRUE, metodo TEXT, sucursal_id INT,
    mov_dinero_id BIGINT
  );
`);

// La migración de la mejora, tal cual se aplica en producción.
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260805_pago_total_acreedor.sql'), 'utf8'));

const conectar = (t) => ({ query: (s, p) => t.query(s, p ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

const repo = require(path.join(RAIZ, 'src/modules/acreedores/acreedores.repository.js'));

let fallos = 0, pasados = 0;
const money = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('es-CO');
function ok(nombre, cond, detalle = '') {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos++;
}

// Saldo calculado como lo hacía la consulta ANTERIOR (sobre las filas crudas).
// Es el patrón de referencia: la mejora no puede moverlo ni un peso.
async function saldoCrudo(acreedorId) {
  const { rows } = await db.query(`
    SELECT COALESCE(SUM(CASE WHEN tipo = 'Cargo' THEN valor ELSE -valor END), 0) AS saldo
    FROM movimientos_acreedor WHERE acreedor_id = $1
  `, [acreedorId]);
  return Number(rows[0].saldo);
}

await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Test');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1, 'Principal');
  INSERT INTO usuarios (nombre) VALUES ('Admin');
  INSERT INTO proveedores (nombre, tipo) VALUES ('Distribuidora', 'proveedor');
  INSERT INTO acreedores (negocio_id, nombre, cedula, proveedor_id)
    VALUES (1, 'Distribuidora', '900123456', 1);

  INSERT INTO compras (numero, sucursal_id, total) VALUES (1, 1, 4000000), (2, 1, 3500000), (3, 1, 5000000);
`);

// Tres compras a crédito → tres cargos, fechas separadas para fijar el orden FIFO.
await db.exec(`
  INSERT INTO movimientos_acreedor (acreedor_id, tipo, valor, descripcion, compra_id, fecha, sucursal_id) VALUES
    (1, 'Cargo', 4000000, 'Compra a crédito', 1, '2026-07-01 09:00:00', 1),
    (1, 'Cargo', 3500000, 'Compra a crédito', 2, '2026-07-05 09:00:00', 1),
    (1, 'Cargo', 5000000, 'Compra a crédito', 3, '2026-07-10 09:00:00', 1);
`);

console.log('\n═══ 1. Punto de partida: tres cargos, sin pagos ═══');
let movs = await repo.getMovimientos(1, 1);
ok('el extracto muestra los 3 cargos', movs.length === 3, `${movs.length} movimientos`);
ok('deuda total 12.500.000', Number(movs.at(-1).saldo_despues) === 12500000, money(movs.at(-1).saldo_despues));

console.log('\n═══ 2. Abono parcial normal a un solo cargo ═══');
await db.query(`
  INSERT INTO movimientos_acreedor (acreedor_id, tipo, valor, descripcion, cargo_id, metodo, fecha, sucursal_id)
  VALUES (1, 'Abono', 500000, 'Abono parcial', 1, 'Efectivo', '2026-07-12 09:00:00', 1)
`);
movs = await repo.getMovimientos(1, 1);
const parcial = movs.find((m) => m.descripcion === 'Abono parcial');
ok('el abono parcial se ve como un movimiento propio', !!parcial);
ok('NO se marca como pago total', parcial && parcial.es_pago_total === false);
ok('conserva su cargo vinculado', parcial && Number(parcial.cargo_id) === 1);
ok('saldo tras el parcial: 12.000.000', Number(movs.at(-1).saldo_despues) === 12000000, money(movs.at(-1).saldo_despues));

console.log('\n═══ 3. Pago total de $10.000.000 ═══');
const res = await repo.registrarAbonoTotal(1, 1, {
  valor: 10000000, metodo: 'Transferencia', registrar_en_caja: true, usuario_id: 1, sucursal_id: 1,
});
ok('el pago se repartió entre 3 cargos', res.distribucion.length === 3,
  res.distribucion.map((d) => `#${d.cargo_id}:${money(d.valor)}`).join(' · '));
ok('aplicó los 10.000.000 completos', Number(res.total_aplicado) === 10000000, money(res.total_aplicado));

const { rows: crudas } = await db.query(
  `SELECT valor, cargo_id, pago_total_id FROM movimientos_acreedor
   WHERE descripcion = 'Pago total distribuido' ORDER BY id`);
ok('POR DENTRO siguen siendo 3 filas de Abono', crudas.length === 3);
ok('el reparto es FIFO: 3.500.000 / 3.500.000 / 3.000.000',
  crudas.map((r) => Number(r.valor)).join(',') === '3500000,3500000,3000000',
  crudas.map((r) => money(r.valor)).join(' · '));
ok('cada fila apunta a su cargo', crudas.every((r) => r.cargo_id != null));
ok('las 3 comparten la misma marca de pago',
  new Set(crudas.map((r) => String(r.pago_total_id))).size === 1);

console.log('\n═══ 4. El estado de cuenta lo muestra como UN movimiento ═══');
movs = await repo.getMovimientos(1, 1);
const pagos = movs.filter((m) => m.es_pago_total);
ok('aparece una sola línea de pago total', pagos.length === 1, `${pagos.length} líneas`);
ok('por el valor que registró el usuario: 10.000.000',
  pagos.length === 1 && Number(pagos[0].valor) === 10000000, pagos[0] && money(pagos[0].valor));
ok('etiquetado como pago total de 3 cargos',
  pagos.length === 1 && pagos[0].descripcion === 'Pago total — 3 cargos', pagos[0]?.descripcion);
ok('conserva el método de pago', pagos[0]?.metodo === 'Transferencia', pagos[0]?.metodo);
ok('trae el reparto adentro para poder desplegarlo',
  Array.isArray(pagos[0]?.detalle) && pagos[0].detalle.length === 3);
ok('el reparto suma exactamente el pago',
  pagos[0].detalle.reduce((s, d) => s + Number(d.valor), 0) === 10000000);
ok('cada porción sabe a qué compra se aplicó',
  pagos[0].detalle.every((d) => d.cargo_compra_numero != null),
  pagos[0].detalle.map((d) => `#${d.cargo_compra_numero}:${money(d.valor)}`).join(' · '));
ok('el abono parcial anterior sigue suelto, sin absorberse',
  movs.filter((m) => m.descripcion === 'Abono parcial').length === 1);
ok('el extracto son 5 líneas (3 cargos + parcial + pago total)', movs.length === 5, `${movs.length}`);

console.log('\n═══ 5. Los saldos no se movieron ═══');
const saldoRef = await saldoCrudo(1);
ok('saldo del extracto = saldo crudo de la tabla',
  Number(movs.at(-1).saldo_despues) === saldoRef,
  `${money(movs.at(-1).saldo_despues)} vs ${money(saldoRef)}`);
ok('deuda restante 2.000.000', saldoRef === 2000000, money(saldoRef));
ok('el saldo corrido es monótono en el tiempo',
  movs.every((m, i) => i === 0 || new Date(m.fecha) >= new Date(movs[i - 1].fecha)));
ok('saldo_antes del pago total = saldo_despues del movimiento anterior',
  Number(pagos[0].saldo_antes) === Number(movs[movs.indexOf(pagos[0]) - 1].saldo_despues));

console.log('\n═══ 6. Cargos y caja siguen viendo el reparto real ═══');
const cargos = await repo.getComprasConSaldo(1, 1);
ok('la compra #1 quedó saldada (500.000 + 3.500.000)',
  Number(cargos.find((c) => c.compra_id === 1).saldo_pendiente) === 0);
ok('la compra #2 quedó saldada',
  Number(cargos.find((c) => c.compra_id === 2).saldo_pendiente) === 0);
ok('la compra #3 debe 2.000.000',
  Number(cargos.find((c) => c.compra_id === 3).saldo_pendiente) === 2000000,
  money(cargos.find((c) => c.compra_id === 3).saldo_pendiente));
const abonosC3 = await repo.getAbonosPorCargo(1, 1, 3);
ok('el historial del cargo #3 ve su porción, no el pago entero',
  abonosC3.length === 1 && Number(abonosC3[0].valor) === 3000000, money(abonosC3[0]?.valor));

console.log('\n═══ 7. Anular una porción: el pago mostrado se ajusta solo ═══');
// Es lo que pasa al cancelar una compra: se borran los abonos de ese cargo.
await db.query(`DELETE FROM movimientos_acreedor WHERE cargo_id = 3 AND descripcion = 'Pago total distribuido'`);
movs = await repo.getMovimientos(1, 1);
const pagoTrasBorrar = movs.find((m) => m.es_pago_total);
ok('el pago mostrado bajó a 7.000.000 (no quedó un total inflado)',
  Number(pagoTrasBorrar.valor) === 7000000, money(pagoTrasBorrar.valor));
ok('ahora dice 2 cargos', pagoTrasBorrar.descripcion === 'Pago total — 2 cargos', pagoTrasBorrar.descripcion);
const saldoRef2 = await saldoCrudo(1);
ok('el saldo del extracto sigue cuadrando con la tabla',
  Number(movs.at(-1).saldo_despues) === saldoRef2,
  `${money(movs.at(-1).saldo_despues)} vs ${money(saldoRef2)}`);
ok('deuda de vuelta a 5.000.000', saldoRef2 === 5000000, money(saldoRef2));

console.log('\n═══ 8. Un pago total que cae en un solo cargo ═══');
await db.exec(`
  INSERT INTO acreedores (negocio_id, nombre, cedula) VALUES (1, 'Ferretería', '111');
  INSERT INTO movimientos_acreedor (acreedor_id, tipo, valor, descripcion, fecha, sucursal_id)
    VALUES (2, 'Cargo', 800000, 'Cargo manual', '2026-07-02 09:00:00', 1);
`);
await repo.registrarAbonoTotal(1, 2, {
  valor: 800000, metodo: 'Efectivo', registrar_en_caja: true, usuario_id: 1, sucursal_id: 1,
});
const movs2 = await repo.getMovimientos(1, 2);
const pago2 = movs2.find((m) => m.es_pago_total);
ok('se rotula "Pago total", sin contador', pago2?.descripcion === 'Pago total', pago2?.descripcion);
ok('no se confunde con un pago adelantado (cargo_id nulo)', pago2?.es_pago_total === true);
ok('la cuenta queda en cero', Number(movs2.at(-1).saldo_despues) === 0, money(movs2.at(-1).saldo_despues));

console.log('\n═══ 9. Pagos totales de dos acreedores no se mezclan ═══');
ok('el acreedor 1 solo ve su pago', movs.filter((m) => m.es_pago_total).length === 1);
ok('el acreedor 2 solo ve el suyo', movs2.filter((m) => m.es_pago_total).length === 1);
ok('el pago del acreedor 2 vale 800.000',
  Number(movs2.find((m) => m.es_pago_total).valor) === 800000);

console.log('\n═══ 10. Backfill: los pagos viejos también se agrupan ═══');
// Filas como las que dejaba la versión anterior: sin pago_total_id.
await db.exec(`
  INSERT INTO acreedores (negocio_id, nombre, cedula) VALUES (1, 'Antiguo', '222');
  INSERT INTO movimientos_acreedor (acreedor_id, tipo, valor, descripcion, fecha, sucursal_id) VALUES
    (3, 'Cargo', 600000, 'Cargo A', '2026-06-01 09:00:00', 1),
    (3, 'Cargo', 400000, 'Cargo B', '2026-06-02 09:00:00', 1);
  INSERT INTO movimientos_acreedor (acreedor_id, tipo, valor, descripcion, cargo_id, metodo, fecha, sucursal_id) VALUES
    (3, 'Abono', 600000, 'Pago total distribuido', 8, 'Efectivo', '2026-06-10 10:00:00', 1),
    (3, 'Abono', 400000, 'Pago total distribuido', 9, 'Efectivo', '2026-06-10 10:00:00', 1);
`);
const antesBackfill = await repo.getMovimientos(1, 3);
ok('sin marca se ven repartidos (comportamiento anterior intacto)',
  antesBackfill.filter((m) => m.es_pago_total).length === 0 && antesBackfill.length === 4);

await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260805_pago_total_acreedor.sql'), 'utf8'));
const trasBackfill = await repo.getMovimientos(1, 3);
const pagoViejo = trasBackfill.find((m) => m.es_pago_total);
ok('tras el backfill se agrupan en uno solo', !!pagoViejo && trasBackfill.length === 3);
ok('por 1.000.000', pagoViejo && Number(pagoViejo.valor) === 1000000, money(pagoViejo?.valor));
ok('la cuenta sigue en cero', Number(trasBackfill.at(-1).saldo_despues) === 0);
ok('la migración es idempotente: no re-agrupa lo ya agrupado',
  (await repo.getMovimientos(1, 1)).filter((m) => m.es_pago_total).length === 1);

console.log(`\n${fallos === 0 ? '✅' : '❌'} ${pasados} pasadas, ${fallos} fallidas\n`);
process.exit(fallos === 0 ? 0 : 1);
