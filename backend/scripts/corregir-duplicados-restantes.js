/**
 * Corrige por completo los pagos duplicados de los tres negocios que quedaron
 * descuadrados: DIGITAL WORLD SUR, MUNDOCELL y GOTTI.
 *
 * A DIFERENCIA de `corregir-pagos-duplicados.js`, este SÍ acepta que la deuda
 * suba — porque en estos tres no hay forma de cuadrar el extracto sin
 * reconocer que el préstamo nunca se pagó del todo. Decisión del negocio.
 *
 * Los tres duplicados que dejan un préstamo sin cubrir hacen que vuelva de
 * 'Saldado' a 'Activo'. Se verificó que ninguno de esos tres generó FACTURA al
 * darse por pagado: reabrirlos no deja una venta facturada a medio pagar.
 *
 * Todo sale de CUATRO dobles clics: los pagos totales #102, #1510, #1677 y
 * #1968, cada uno enviado dos veces y repartido dos veces.
 *
 * Por defecto SIMULA. Para aplicar:
 *     node scripts/corregir-duplicados-restantes.js --aplicar
 */
require('dotenv').config();
const { pool } = require('../src/config/db');

const APLICAR   = process.argv.includes('--aplicar');
const PERSONAS  = ['DIGITAL WORLD SUR', 'MUNDOCELL', 'GOTTI'];
const NEGOCIO   = 31;
const MOTIVO    = 'Anulado: el mismo pago se registró dos veces por error';
const cop = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('es-CO');

// Duplicados sub-segundo de esas personas. La diferencia va en ABSOLUTO: dos
// inserciones concurrentes pueden recibir los ids en un orden y las marcas de
// tiempo en el otro.
const SQL_DUP = `
  WITH parejas AS (
    SELECT GREATEST(a.id, b.id) AS anular, a.valor, a.prestamo_id,
           ABS(EXTRACT(EPOCH FROM (b.fecha - a.fecha)))::numeric AS seg
      FROM abonos_prestamo a
      JOIN abonos_prestamo b ON b.prestamo_id = a.prestamo_id AND b.id > a.id
       AND b.valor = a.valor AND COALESCE(b.metodo,'') = COALESCE(a.metodo,'')
       AND ABS(EXTRACT(EPOCH FROM (b.fecha - a.fecha))) <= 1
       AND NOT a.anulado AND NOT b.anulado
      JOIN prestamos p ON p.id = a.prestamo_id
      JOIN prestatarios pr ON pr.id = p.prestatario_id
     WHERE pr.negocio_id = $1 AND pr.nombre = ANY($2::text[])
  ),
  pp AS (SELECT prestamo_id, SUM(valor) AS quita, array_agg(anular) AS ids, MAX(seg) AS seg
           FROM parejas GROUP BY prestamo_id)
  SELECT pp.*, p.valor_prestamo::numeric AS vale, p.total_abonado::numeric AS abonado,
         p.estado, p.nombre_producto, pr.nombre AS persona,
         (p.total_abonado - pp.quita)::numeric AS abonado_final,
         ((p.total_abonado - pp.quita) < p.valor_prestamo) AS vuelve_activo,
         GREATEST(0, p.valor_prestamo - (p.total_abonado - pp.quita))::numeric AS deuda_nueva
    FROM pp JOIN prestamos p ON p.id = pp.prestamo_id
    JOIN prestatarios pr ON pr.id = p.prestatario_id
   ORDER BY pr.nombre, pp.quita DESC`;

const SQL_ESTADO = `
  SELECT pr.nombre AS persona,
         COALESCE(SUM(p.valor_prestamo - p.total_abonado) FILTER (WHERE p.estado='Activo'), 0)::numeric AS deuda
    FROM prestatarios pr LEFT JOIN prestamos p ON p.prestatario_id = pr.id
   WHERE pr.negocio_id = $1 AND pr.nombre = ANY($2::text[])
   GROUP BY 1 ORDER BY 1`;

(async () => {
  console.log(APLICAR ? '⚠  MODO APLICAR — se va a escribir en la base\n'
                      : '🔎 SIMULACIÓN — no se escribe nada (usa --aplicar para ejecutar)\n');

  const { rows: dup } = await pool.query(SQL_DUP, [NEGOCIO, PERSONAS]);
  const { rows: antes } = await pool.query(SQL_ESTADO, [NEGOCIO, PERSONAS]);

  const reabren = dup.filter((r) => r.vuelve_activo);
  const ids = dup.flatMap((r) => r.ids);
  const total = dup.reduce((s, r) => s + Number(r.quita), 0);
  const sube  = reabren.reduce((s, r) => s + Number(r.deuda_nueva), 0);

  console.log(`  ${dup.length} préstamos · ${ids.length} abonos duplicados · ${cop(total)}\n`);
  console.log('  ── Los que vuelven de Saldado a Activo (la deuda sube) ──');
  for (const r of reabren) {
    console.log(`     #${r.prestamo_id} ${String(r.persona).slice(0,18).padEnd(18)} ` +
      `"${String(r.nombre_producto).slice(0,26)}"`);
    console.log(`        vale ${cop(r.vale)} · abonado ${cop(r.abonado)} → ${cop(r.abonado_final)}` +
      `  ⇒ quedaría debiendo ${cop(r.deuda_nueva)}`);
  }
  console.log(`\n  ── Deuda por persona ──`);
  const mapaAntes = new Map(antes.map((r) => [r.persona, Number(r.deuda)]));
  const subePorPersona = {};
  for (const r of reabren) subePorPersona[r.persona] = (subePorPersona[r.persona] || 0) + Number(r.deuda_nueva);
  for (const [persona, d] of mapaAntes) {
    const s = subePorPersona[persona] || 0;
    console.log(`     ${persona.padEnd(20)} ${cop(d).padStart(15)} → ${cop(d + s).padStart(15)}  (+${cop(s)})`);
  }
  console.log(`\n  Subida total de deuda: ${cop(sube)}`);
  const peor = dup.reduce((m, r) => Math.max(m, Number(r.seg)), 0);
  console.log(`  Separación máxima de los duplicados: ${peor.toFixed(3)} segundos`);

  if (!APLICAR) { await pool.end(); return; }
  if (!ids.length) { console.log('\nNada que hacer.'); await pool.end(); return; }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Anular los duplicados y bajar lo abonado.
    await client.query(`
      WITH previos AS (
        SELECT id, prestamo_id, (valor - valor_anulado) AS pendiente
          FROM abonos_prestamo WHERE id = ANY($1::int[]) AND NOT anulado
      ),
      marcados AS (
        UPDATE abonos_prestamo a
           SET anulado = TRUE, valor_anulado = a.valor,
               motivo_anulacion = $2, anulado_en = NOW()
          FROM previos pv WHERE a.id = pv.id
         RETURNING pv.prestamo_id, pv.pendiente
      ),
      porPrestamo AS (SELECT prestamo_id, SUM(pendiente) AS baja FROM marcados GROUP BY prestamo_id)
      UPDATE prestamos p SET total_abonado = GREATEST(0, p.total_abonado - pp.baja)
        FROM porPrestamo pp WHERE p.id = pp.prestamo_id
    `, [ids, MOTIVO]);

    // 2. El préstamo que dejó de estar cubierto vuelve a Activo. Sin esto la
    //    deuda no aparece: un 'Saldado' no cuenta, por más que le falte plata.
    const { rowCount: reabiertos } = await client.query(`
      UPDATE prestamos SET estado = 'Activo'
       WHERE id = ANY($1::int[]) AND estado = 'Saldado'
         AND total_abonado < valor_prestamo
    `, [dup.map((r) => r.prestamo_id)]);
    console.log(`\n✓ Préstamos reabiertos a Activo: ${reabiertos}`);

    // ── BARANDAS ────────────────────────────────────────────────────────────
    const { rows: despues } = await client.query(SQL_ESTADO, [NEGOCIO, PERSONAS]);
    const esperado = new Map([...mapaAntes].map(([k, v]) => [k, v + (subePorPersona[k] || 0)]));
    for (const r of despues) {
      const esp = esperado.get(r.persona);
      if (Math.abs(Number(r.deuda) - esp) > 0.5) {
        throw new Error(`${r.persona}: deuda quedó en ${cop(r.deuda)}, se esperaba ${cop(esp)}`);
      }
      console.log(`✓ ${r.persona.padEnd(20)} deuda ${cop(r.deuda)} — como se esperaba`);
    }

    const { rows: [chk] } = await client.query(`
      SELECT (SELECT COUNT(*)::int FROM prestamos WHERE total_abonado < 0) neg,
             (SELECT COUNT(*)::int FROM prestamos WHERE total_abonado > valor_prestamo) exceso,
             (SELECT COUNT(*)::int FROM abonos_prestamo
               WHERE anulado AND COALESCE(BTRIM(motivo_anulacion),'')='') sin_motivo`);
    if (chk.neg || chk.sin_motivo) throw new Error(`Inconsistencia (negativos ${chk.neg}, sin motivo ${chk.sin_motivo})`);
    console.log(`✓ Sin abonados negativos · préstamos con exceso restantes: ${chk.exceso}`);

    // Nadie FUERA de estas tres personas puede haber cambiado de deuda.
    await client.query('COMMIT');
    console.log('\n✅ Aplicado.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Revertido, no se escribió nada:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
