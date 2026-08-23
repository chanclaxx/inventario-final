// ─────────────────────────────────────────────────────────────────────────────
// EL BACKFILL DEL CAMBIO DE MODELO
//
// Los negocios que ya venían operando tienen envíos y pagos hechos con la regla
// vieja (el local solo debía lo vendido). El backfill imputa esos pagos a los
// envíos con la regla nueva, en orden cronológico y FIFO.
//
// Lo que se verifica aquí:
//   • que corra de verdad contra un Postgres real (es un DO en plpgsql)
//   • que reparta el pago del envío más viejo al más nuevo
//   • que lo que sobre quede sin imputar y se lea como saldo a favor
//   • que sea IDEMPOTENTE: correrlo dos veces no duplica ni un peso
//   • que un negocio SIN la red interna activa no se toque
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

const conectar = (t) => ({ query: (s, p) => t.query(s, p ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

const service = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));

let fallos = 0, pasados = 0;
const q = async (s, p = []) => (await db.query(s, p)).rows;
const money = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('es-CO');
function ok(nombre, cond, detalle = '') {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos++;
}

// ── Un negocio operando con la regla vieja, y otro que no usa la red ─────────
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Con red'), ('Sin red');
  INSERT INTO sucursales (negocio_id, nombre) VALUES
    (1,'Bodega'),(1,'Centro'),      -- 1, 2
    (2,'Bodega B'),(2,'Local B');   -- 3, 4
  INSERT INTO usuarios (nombre) VALUES ('Admin');
  INSERT INTO config_negocio VALUES (1,'red_interna_activa','1'),(1,'red_interna_bodega_id','1');
  -- El negocio 2 tiene remisiones pero NUNCA activó la feature.

  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id)
    VALUES ('iPhone','Apple','128', 2000000, 1), ('Otro','X','Y', 100000, 3);
  INSERT INTO seriales (producto_id, imei, costo_compra) VALUES
    (1,'A1', 1000000), (1,'A2', 1000000), (1,'A3', 1000000), (2,'B1', 50000);
`);

// Tres envíos al local 2, en fechas distintas, y dos pagos del modelo viejo.
const crearEnvio = async (numero, dias, seriales) => {
  const r = (await q(`
    INSERT INTO remisiones (negocio_id, numero, tipo, sucursal_origen_id,
      sucursal_destino_id, estado, fecha_emision, fecha_recepcion)
    VALUES (1, $1, 'entrega', 1, 2, 'Recibida',
            NOW() - ($2 || ' days')::interval, NOW() - ($2 || ' days')::interval)
    RETURNING id`, [numero, String(dias)]))[0].id;
  for (const [serialId, valor] of seriales) {
    await q(`
      INSERT INTO lineas_remision (remision_id, tipo, serial_id, imei, valor_interno,
        estado_linea, remision_tipo)
      VALUES ($1, 'serial', $2, 'X', $3, 'Recibida', 'entrega')`, [r, serialId, valor]);
  }
  return r;
};

const e1 = await crearEnvio(1, 30, [[1, 1000000]]);                  // $1.000.000
const e2 = await crearEnvio(2, 20, [[2, 1000000], [3, 1000000]]);    // $2.000.000
const e3 = await crearEnvio(3, 10, [[null, 500000]]);                // $500.000

// Pagos hechos bajo la regla vieja: dos remesas confirmadas y un gasto.
await db.exec(`
  INSERT INTO remesas (negocio_id, numero, sucursal_origen_id, sucursal_destino_id,
    valor, estado, fecha_envio, fecha_recepcion)
  VALUES (1, 1, 2, 1, 1200000, 'Recibida', NOW() - INTERVAL '25 days', NOW() - INTERVAL '25 days'),
         (1, 2, 2, 1,  900000, 'Recibida', NOW() - INTERVAL '15 days', NOW() - INTERVAL '15 days'),
         -- Anulada: no debe imputarse nada
         (1, 3, 2, 1,  500000, 'Anulada',  NOW() - INTERVAL '14 days', NULL);
  INSERT INTO movimientos_cuenta_interna (negocio_id, sucursal_id, tipo, valor, concepto, fecha)
  VALUES (1, 2, 'GastoAutorizado', 300000, 'Domicilio', NOW() - INTERVAL '12 days');

  -- El negocio SIN la red activa: mismo tipo de datos, no se debe tocar.
  INSERT INTO remisiones (negocio_id, numero, tipo, sucursal_origen_id,
    sucursal_destino_id, estado, fecha_emision, fecha_recepcion)
  VALUES (2, 1, 'entrega', 3, 4, 'Recibida', NOW(), NOW());
  INSERT INTO lineas_remision (remision_id, tipo, serial_id, imei, valor_interno,
    estado_linea, remision_tipo)
  VALUES ((SELECT id FROM remisiones WHERE negocio_id = 2), 'serial', 4, 'B1', 50000,
          'Recibida', 'entrega');
`);

console.log('\n═══ 1. El backfill corre contra Postgres real ═══');
const BACKFILL = readFileSync(
  path.join(RAIZ, '../migrations/20260822_red_interna_envios_backfill.sql'), 'utf8');
let corrio = true;
try { await db.exec(BACKFILL); } catch (e) { corrio = false; console.log('   ', e.message); }
ok('★ El bloque plpgsql se ejecuta sin error', corrio);

console.log('\n═══ 2. Reparte del envío más viejo al más nuevo ═══');
// Total pagado = 1.200.000 + 900.000 + 300.000 = 2.400.000 (la anulada no cuenta).
// Envíos: e1 $1.000.000 → e2 $2.000.000 → e3 $500.000.
// FIFO: e1 completo (1.000.000) y 1.400.000 sobre e2.
const abonos = await q(`
  SELECT remision_id, origen, SUM(valor)::numeric AS total
  FROM abonos_remision WHERE negocio_id = 1
  GROUP BY remision_id, origen ORDER BY remision_id, origen`);
const porEnvio = (id) => abonos.filter((a) => Number(a.remision_id) === Number(id))
  .reduce((s, a) => s + Number(a.total), 0);

ok('★ El envío 1 quedó pagado completo', porEnvio(e1) === 1000000, money(porEnvio(e1)));
ok('★ El envío 2 recibió el resto', porEnvio(e2) === 1400000, money(porEnvio(e2)));
ok('★ El envío 3 no recibió nada: no alcanzó', porEnvio(e3) === 0, money(porEnvio(e3)));
ok('  la remesa ANULADA no se imputó',
   abonos.reduce((s, a) => s + Number(a.total), 0) === 2400000);
ok('★ El gasto autorizado entró con su propio origen',
   abonos.some((a) => a.origen === 'gasto'),
   abonos.map((a) => a.origen).join(', '));

console.log('\n═══ 3. La cuenta que ve el usuario queda coherente ═══');
const red = { activa:true, bodega_id:1, confirmar_recepcion:true, confirmar_remesa:true,
              ocultar_costos:false };
const centro = { user:{id:1,negocio_id:1,rol:'supervisor'}, sucursal_id:2, esBodega:false, red };
const cuenta = await service.getEstadoCuenta(centro, 2);
const t = cuenta.totales;

ok('★ La deuda es todo lo entregado menos lo pagado',
   Number(t.deuda_total) === 3500000 - 2400000, money(t.deuda_total));
ok('  sin saldo a favor: todo el dinero encontró envío',
   Number(t.saldo_a_favor) === 0);
const suma = cuenta.envios.reduce((s, e) => s + Number(e.saldo), 0);
ok('★★ Σ saldo por envío = deuda total', Math.abs(suma - Number(t.deuda_total)) < 1,
   `${money(suma)} vs ${money(t.deuda_total)}`);

console.log('\n═══ 4. Es idempotente ═══');
await db.exec(BACKFILL);
const abonos2 = await q(`SELECT COALESCE(SUM(valor),0)::numeric AS total FROM abonos_remision WHERE negocio_id = 1`);
ok('★ Correrlo dos veces no duplica ni un peso',
   Number(abonos2[0].total) === 2400000, money(abonos2[0].total));

console.log('\n═══ 5. Un negocio sin la red activa no se toca ═══');
const otros = await q(`SELECT COUNT(*)::int AS n FROM abonos_remision WHERE negocio_id = 2`);
ok('★ Cero filas para el negocio que nunca activó la feature', otros[0].n === 0);

console.log('\n═══ 6. Lo que sobre queda a favor, no imputado ═══');
// Se agrega un pago mucho mayor que la deuda restante ($1.100.000).
await db.exec(`
  INSERT INTO remesas (negocio_id, numero, sucursal_origen_id, sucursal_destino_id,
    valor, estado, fecha_envio, fecha_recepcion)
  VALUES (1, 4, 2, 1, 3000000, 'Recibida', NOW(), NOW());
  DELETE FROM abonos_remision WHERE negocio_id = 1;
`);
await db.exec(BACKFILL);
const cuenta2 = await service.getEstadoCuenta(centro, 2);
ok('★ La deuda queda en cero', Number(cuenta2.totales.deuda_total) === 0,
   money(cuenta2.totales.deuda_total));
ok('★ Y el sobrante se lee como saldo a favor',
   Number(cuenta2.totales.saldo_a_favor) === 2400000 + 3000000 - 3500000,
   money(cuenta2.totales.saldo_a_favor));
ok('  sin que la bodega le quede debiendo plata',
   Number(cuenta2.totales.saldo_por_liquidar) === 0);

// ═════════════════════════════════════════════════════════════════════════════
// 7. LO QUE DE VERDAD CORRE EN PRODUCCIÓN
//
// Los archivos de `/migrations` son la referencia legible, pero quien crea las
// tablas en Railway es `src/config/migrations.js`, que replica ese SQL inline.
// Escribir el .sql y olvidar el runner deja el despliegue con el código nuevo
// contra una base vieja: toda lectura de la cuenta revienta con
// `relation "abonos_remision" does not exist`. Ya pasó una vez.
//
// Esta sección extrae el SQL del runner y lo corre contra una base limpia.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 7. El runner de arranque crea lo mismo que el .sql ═══');

const runner = readFileSync(path.join(RAIZ, 'src/config/migrations.js'), 'utf8');
const marca  = '// v3 — EL ENVÍO ES LA DEUDA';
ok('★ El runner incluye la migración v3', runner.includes(marca),
   marca);

const bloqueV3 = runner.slice(runner.indexOf(marca));
const sqlV3 = [...bloqueV3.matchAll(/await pool\.query\(`([\s\S]*?)`\);/g)]
  .slice(0, 2)
  .map((m) => m[1]);
ok('  y trae sus dos sentencias (tabla + backfill)', sqlV3.length === 2);

// Base virgen con solo lo que el runner necesita para llegar hasta la v3.
const db2 = new PGlite();
await db2.exec(readFileSync(path.join(AQUI, 'esquema.sql'), 'utf8'));
await db2.exec(readFileSync(path.join(AQUI, 'esquema-completo.sql'), 'utf8'));
await db2.exec(readFileSync(path.join(RAIZ, '../migrations/20260725_red_interna.sql'), 'utf8'));
await db2.exec(readFileSync(path.join(RAIZ, '../migrations/20260726_red_interna_v2.sql'), 'utf8'));

let runnerOk = true, runnerErr = '';
try {
  for (const sql of sqlV3) await db2.exec(sql);
} catch (e) { runnerOk = false; runnerErr = e.message; }
ok('★★ El SQL del runner corre sin error', runnerOk, runnerErr);

const tabla = (await db2.query(`SELECT to_regclass('public.abonos_remision') AS t`)).rows[0].t;
ok('★★ Y deja creada `abonos_remision`', tabla !== null, String(tabla));

// Las columnas que el repositorio consulta tienen que existir todas: si el
// runner se quedara corto contra el .sql, aquí se ve.
const cols = (await db2.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'abonos_remision' ORDER BY column_name`)).rows.map((r) => r.column_name);
const esperadas = ['anulado', 'fecha', 'id', 'movimiento_id', 'negocio_id', 'notas',
                   'origen', 'remesa_id', 'remision_id', 'sucursal_id', 'usuario_id', 'valor'];
ok('★★ Con las mismas columnas que el .sql',
   esperadas.every((c) => cols.includes(c)),
   `${cols.length} columnas`);

// Y es re-ejecutable: el arranque corre las migraciones en CADA despliegue.
let reejecutable = true;
try {
  for (const sql of sqlV3) await db2.exec(sql);
} catch (e) { reejecutable = false; runnerErr = e.message; }
ok('★★ Re-ejecutable: el arranque lo corre en cada despliegue', reejecutable, runnerErr);

console.log(`\n${'─'.repeat(60)}`);
console.log(`  ${pasados} pasaron · ${fallos} fallaron`);
console.log('─'.repeat(60));
process.exit(fallos ? 1 : 0);
