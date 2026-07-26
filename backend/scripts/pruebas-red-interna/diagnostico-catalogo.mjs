// ─────────────────────────────────────────────────────────────────────────────
// DIAGNÓSTICO DEL CATÁLOGO — 100% SOLO LECTURA
//
// Se conecta a la base configurada en .env y reporta qué referencias parecen
// duplicadas HOY. No inserta, no actualiza, no borra: la conexión se abre en
// modo READ ONLY y cualquier intento de escritura fallaría a nivel de Postgres.
//
// Uso:
//   node scripts/pruebas-red-interna/diagnostico-catalogo.mjs <negocio_id>
//
// El negocio_id es OBLIGATORIO: así nunca se recorre información de otros
// clientes por accidente.
// ─────────────────────────────────────────────────────────────────────────────
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');

require('dotenv').config({ path: path.join(RAIZ, '.env') });
const { Pool } = require('pg');

const negocioId = Number(process.argv[2]);
if (!Number.isInteger(negocioId) || negocioId <= 0) {
  console.error('Falta el negocio_id.  Uso: node diagnostico-catalogo.mjs <negocio_id>');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

const NORM = (col) => `
  regexp_replace(trim(translate(lower(COALESCE(${col}, '')),
    'áàäâãéèëêíìïîóòöôõúùüûñç-_', 'aaaaaeeeeiiiiooooouuuunc  ')),
    '[[:space:]]+', ' ', 'g')`;

const client = await pool.connect();
try {
  // Candado duro: la sesión completa queda en solo lectura.
  await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');

  const negocio = (await client.query(
    `SELECT id, nombre FROM negocios WHERE id = $1`, [negocioId])).rows[0];
  if (!negocio) { console.error(`No existe el negocio ${negocioId}`); process.exit(1); }

  const sucs = (await client.query(
    `SELECT id, nombre, activa FROM sucursales WHERE negocio_id = $1 ORDER BY id`,
    [negocioId])).rows;

  console.log(`\n${'═'.repeat(64)}`);
  console.log(`DIAGNÓSTICO — negocio #${negocio.id} "${negocio.nombre}"  (SOLO LECTURA)`);
  console.log('═'.repeat(64));
  console.log(`\nSucursales: ${sucs.map((s) => `${s.nombre}${s.activa ? '' : ' (inactiva)'}`).join(' · ')}`);

  const totales = (await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM productos_cantidad pc JOIN sucursales su ON su.id=pc.sucursal_id
       WHERE su.negocio_id=$1 AND pc.activo) AS cantidad,
      (SELECT COUNT(*)::int FROM productos_serial ps JOIN sucursales su ON su.id=ps.sucursal_id
       WHERE su.negocio_id=$1) AS serial,
      (SELECT COUNT(*)::int FROM productos_cantidad pc JOIN sucursales su ON su.id=pc.sucursal_id
       WHERE su.negocio_id=$1 AND pc.activo AND pc.codigo IS NOT NULL) AS con_codigo
  `, [negocioId])).rows[0];
  console.log(`Referencias: ${totales.cantidad} de cantidad (${totales.con_codigo} con código) · ${totales.serial} seriales`);

  // ── 1. Mismo código, nombres distintos ─────────────────────────────────────
  const porCodigo = (await client.query(`
    SELECT pc.codigo, COUNT(*)::int AS filas,
           STRING_AGG(DISTINCT pc.nombre, ' | ') AS nombres
    FROM productos_cantidad pc
    JOIN sucursales su ON su.id = pc.sucursal_id
    WHERE su.negocio_id = $1 AND pc.activo AND pc.codigo IS NOT NULL
    GROUP BY pc.codigo
    HAVING COUNT(DISTINCT ${NORM('pc.nombre')}) > 1
    ORDER BY pc.codigo LIMIT 40
  `, [negocioId])).rows;

  console.log(`\n── 1. Mismo CÓDIGO con nombres distintos ── ${porCodigo.length} caso(s)`);
  if (!porCodigo.length) console.log('   ✓ ninguno');
  for (const r of porCodigo) console.log(`   ⚠ ${r.codigo}: ${r.nombres}`);

  // ── 2. Mismo nombre repetido en UNA sucursal ───────────────────────────────
  const repetidos = (await client.query(`
    SELECT su.nombre AS sucursal, ${NORM('pc.nombre')} AS nombre, COUNT(*)::int AS filas,
           SUM(pc.stock)::int AS stock_total,
           STRING_AGG(pc.id::text, ',') AS ids
    FROM productos_cantidad pc
    JOIN sucursales su ON su.id = pc.sucursal_id
    WHERE su.negocio_id = $1 AND pc.activo
    GROUP BY su.nombre, ${NORM('pc.nombre')}
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC LIMIT 40
  `, [negocioId])).rows;

  console.log(`\n── 2. Mismo producto repetido DENTRO de una sucursal ── ${repetidos.length} caso(s)`);
  if (!repetidos.length) console.log('   ✓ ninguno');
  for (const r of repetidos)
    console.log(`   ⚠ [${r.sucursal}] "${r.nombre}" ×${r.filas} (ids ${r.ids}, stock ${r.stock_total})`);

  // ── 3. Referencias mudas: sin código teniéndolo en otra sucursal ───────────
  const mudos = (await client.query(`
    SELECT su.nombre AS sucursal, pc.nombre, pc.stock,
           (SELECT o.codigo FROM productos_cantidad o
            JOIN sucursales so ON so.id = o.sucursal_id
            WHERE so.negocio_id = $1 AND o.activo AND o.codigo IS NOT NULL
              AND ${NORM('o.nombre')} = ${NORM('pc.nombre')}
            ORDER BY o.id LIMIT 1) AS codigo_esperado
    FROM productos_cantidad pc
    JOIN sucursales su ON su.id = pc.sucursal_id
    WHERE su.negocio_id = $1 AND pc.activo AND pc.codigo IS NULL
      AND EXISTS (SELECT 1 FROM productos_cantidad o
                  JOIN sucursales so ON so.id = o.sucursal_id
                  WHERE so.negocio_id = $1 AND o.activo AND o.codigo IS NOT NULL
                    AND ${NORM('o.nombre')} = ${NORM('pc.nombre')})
    ORDER BY pc.nombre LIMIT 40
  `, [negocioId])).rows;

  console.log(`\n── 3. Sin código aunque el negocio SÍ lo tiene ── ${mudos.length} caso(s)`);
  console.log('   (el lector no las encuentra en esa sucursal)');
  if (!mudos.length) console.log('   ✓ ninguno');
  for (const r of mudos)
    console.log(`   ⚠ [${r.sucursal}] "${r.nombre}" stock ${r.stock} → debería ser ${r.codigo_esperado}`);

  // ── 4. Seriales: mismo nombre con marca/modelo distintos entre sucursales ──
  const serialDisperso = (await client.query(`
    SELECT ${NORM('ps.nombre')} AS nombre, COUNT(DISTINCT ps.sucursal_id)::int AS sucursales,
           COUNT(DISTINCT (${NORM('ps.marca')} || '|' || ${NORM('ps.modelo')}))::int AS variantes,
           STRING_AGG(DISTINCT COALESCE(ps.marca,'—') || ' / ' || COALESCE(ps.modelo,'—'), ' · ') AS detalle
    FROM productos_serial ps
    JOIN sucursales su ON su.id = ps.sucursal_id
    WHERE su.negocio_id = $1
    GROUP BY ${NORM('ps.nombre')}
    HAVING COUNT(DISTINCT (${NORM('ps.marca')} || '|' || ${NORM('ps.modelo')})) > 1
       AND COUNT(DISTINCT ps.sucursal_id) > 1
    ORDER BY 3 DESC LIMIT 30
  `, [negocioId])).rows;

  console.log(`\n── 4. Seriales con el mismo nombre pero marca/modelo distintos ── ${serialDisperso.length} caso(s)`);
  console.log('   (al despachar habría que confirmar a cuál va)');
  if (!serialDisperso.length) console.log('   ✓ ninguno');
  for (const r of serialDisperso)
    console.log(`   ⚠ "${r.nombre}" en ${r.sucursales} sucursales · ${r.variantes} variantes: ${r.detalle}`);

  const total = porCodigo.length + repetidos.length + mudos.length + serialDisperso.length;
  console.log(`\n${'═'.repeat(64)}`);
  console.log(total === 0
    ? 'CATÁLOGO LIMPIO — no hay referencias duplicadas ni mudas.'
    : `${total} punto(s) a revisar. Ninguno se corrige solo: requieren decisión humana.`);
  console.log('Ningún dato fue modificado (sesión READ ONLY).');
  console.log('═'.repeat(64));
} finally {
  client.release();
  await pool.end();
}
