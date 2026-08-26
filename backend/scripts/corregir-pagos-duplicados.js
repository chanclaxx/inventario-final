/**
 * Marca como anulados los PAGOS DUPLICADOS que se pueden corregir sin subirle
 * la deuda a nadie.
 *
 * EL PROBLEMA
 * Un doble clic en "guardar" registraba el mismo pago dos veces. El préstamo
 * quedaba con el doble de abonado y el estado de cuenta restaba plata que nunca
 * entró — a algunos clientes su extracto les daba NEGATIVO, como si el negocio
 * les debiera.
 *
 * EL CRITERIO — deliberadamente estrecho, porque el riesgo es anularle a un
 * cliente un pago que sí hizo:
 *
 *   1. La pareja tiene que estar separada por MENOS DE UN SEGUNDO. Hay 154
 *      parejas de pagos iguales al mismo préstamo separadas por más de 5
 *      minutos: los clientes SÍ pagan dos veces lo mismo. Lo que no puede hacer
 *      un humano es registrarlo dos veces en 136 milésimas. Una ventana más
 *      ancha (probé con 2 minutos) marca como duplicados pagos reales.
 *
 *   2. Al quitar el duplicado, el préstamo tiene que SEGUIR CUBIERTO. Si dejara
 *      de estarlo, la persona pasaría a deber más — y la decisión del negocio
 *      fue que la deuda no se mueve.
 *
 *   3. La persona tiene que quedar con el extracto EXACTAMENTE igual a su
 *      deuda. A quien le quedaran duplicados sin corregir se queda sin tocar:
 *      media corrección confunde más que ninguna.
 *
 * NO cambia `valor_prestamo`, ni el estado, ni la caja (que lee las filas de
 * abono, no la marca). Sí baja `total_abonado` al valor real — y con él la
 * utilidad reportada de esos préstamos, que estaba inflada por el mismo motivo.
 *
 * Por defecto SIMULA. Para aplicar:
 *     node scripts/corregir-pagos-duplicados.js --aplicar
 */
require('dotenv').config();
const { pool } = require('../src/config/db');

const APLICAR = process.argv.includes('--aplicar');
const cop = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('es-CO');
const MOTIVO = 'Anulado: el mismo pago se registró dos veces por error';

/** Duplicados sub-segundo, con el dato de si el préstamo sigue cubierto. */
const SQL_CANDIDATOS = `
  WITH parejas AS (
    -- OJO: la diferencia va en ABSOLUTO y el que se anula se elige por id, no
    -- por fecha. Dos inserciones concurrentes pueden recibir los ids en un
    -- orden y las marcas de tiempo en el otro — pasó con el préstamo #6287,
    -- donde el abono #4990 quedó 0,002 s DESPUÉS del #4991. Comparar
    -- Comparar las fechas asumiendo que el id mayor es posterior deja fuera
    -- esos casos sin que nadie lo note.
    SELECT GREATEST(a.id, b.id) AS anular, LEAST(a.id, b.id) AS conserva,
           a.valor, a.prestamo_id,
           ABS(EXTRACT(EPOCH FROM (b.fecha - a.fecha)))::numeric AS seg
      FROM abonos_prestamo a
      JOIN abonos_prestamo b ON b.prestamo_id = a.prestamo_id AND b.id > a.id
       AND b.valor = a.valor AND COALESCE(b.metodo,'') = COALESCE(a.metodo,'')
       AND ABS(EXTRACT(EPOCH FROM (b.fecha - a.fecha))) <= 1
       AND NOT a.anulado AND NOT b.anulado
  ),
  porPrestamo AS (
    SELECT prestamo_id, SUM(valor) AS quita, array_agg(anular) AS ids, MAX(seg) AS peor_seg
      FROM parejas GROUP BY prestamo_id
  )
  SELECT pp.prestamo_id, pp.quita::numeric, pp.ids, pp.peor_seg,
         p.valor_prestamo::numeric AS vale, p.total_abonado::numeric AS abonado,
         p.estado, p.nombre_producto,
         ((p.total_abonado - pp.quita) >= p.valor_prestamo) AS sigue_cubierto,
         su.negocio_id AS neg,
         CASE WHEN p.prestatario_id IS NOT NULL THEN 'p' ELSE 'c' END AS tipo,
         COALESCE(p.prestatario_id, p.cliente_id) AS pid,
         COALESCE(pr.nombre, cl.nombre) AS persona
    FROM porPrestamo pp
    JOIN prestamos  p  ON p.id = pp.prestamo_id
    JOIN sucursales su ON su.id = p.sucursal_id
    LEFT JOIN prestatarios pr ON pr.id = p.prestatario_id
    LEFT JOIN clientes     cl ON cl.id = p.cliente_id
   WHERE COALESCE(p.prestatario_id, p.cliente_id) IS NOT NULL`;

const SQL_DEUDAS = `
  SELECT su.negocio_id AS neg,
         CASE WHEN p.prestatario_id IS NOT NULL THEN 'p' ELSE 'c' END AS tipo,
         COALESCE(p.prestatario_id, p.cliente_id) AS pid,
         SUM(p.valor_prestamo - p.total_abonado) FILTER (WHERE p.estado = 'Activo') AS deuda
    FROM prestamos p JOIN sucursales su ON su.id = p.sucursal_id
   WHERE COALESCE(p.prestatario_id, p.cliente_id) IS NOT NULL
   GROUP BY 1,2,3`;

const huella = (rows) => JSON.stringify(
  rows.map((r) => `${r.neg}|${r.tipo}|${r.pid}|${Number(r.deuda || 0)}`).sort());

(async () => {
  console.log(APLICAR ? '⚠  MODO APLICAR — se va a escribir en la base\n'
                      : '🔎 SIMULACIÓN — no se escribe nada (usa --aplicar para ejecutar)\n');

  const svc = require('../src/modules/prestamos/prestamos.service');
  const extracto = async (neg, tipo, pid) => {
    const movs = await svc.getEstadoCuenta(neg, tipo === 'p' ? 'prestatario' : 'cliente', pid);
    const cs = movs.filter((m) => m.saldo != null);
    return cs.length ? Number(cs[cs.length - 1].saldo) : 0;
  };

  const { rows: cands } = await pool.query(SQL_CANDIDATOS);
  const { rows: deudas } = await pool.query(SQL_DEUDAS);
  const mapaDeuda = new Map(deudas.map((r) => [`${r.neg}|${r.tipo}|${r.pid}`, Number(r.deuda || 0)]));

  // Agrupar por persona y decidir quién califica.
  const porPersona = {};
  for (const c of cands) {
    const k = `${c.neg}|${c.tipo}|${c.pid}`;
    porPersona[k] ||= { ...c, seguros: [], riesgo: 0, quitaSegura: 0 };
    if (c.sigue_cubierto) {
      porPersona[k].seguros.push(c);
      porPersona[k].quitaSegura += Number(c.quita);
    } else {
      porPersona[k].riesgo += Number(c.quita);
    }
  }

  const califican = [], descartadas = [];
  for (const [k, p] of Object.entries(porPersona)) {
    const d = mapaDeuda.get(k) ?? 0;
    const e = await extracto(p.neg, p.tipo, p.pid);
    // Anular saca el abono del saldo: el extracto sube exactamente por eso.
    (d === e + p.quitaSegura ? califican : descartadas).push({ ...p, deuda: d, extractoHoy: e, quedaria: e + p.quitaSegura });
  }

  console.log('── Personas que quedan CUADRADAS (se corrigen) ──');
  let idsAnular = [], totalPlata = 0, prestamos = 0;
  for (const p of califican.sort((a, b) => b.deuda - a.deuda)) {
    for (const s of p.seguros) { idsAnular = idsAnular.concat(s.ids); totalPlata += Number(s.quita); prestamos++; }
    console.log(`   ${String(p.persona).slice(0,20).padEnd(20)} deuda ${cop(p.deuda).padStart(15)}  ` +
      `extracto ${cop(p.extractoHoy).padStart(15)} → ${cop(p.quedaria).padStart(15)}  ` +
      `(${p.seguros.length} préstamo(s), ${cop(p.quitaSegura)})`);
  }
  console.log(`\n   ${califican.length} personas · ${prestamos} préstamos · ${idsAnular.length} abonos · ${cop(totalPlata)}`);

  console.log('\n── Personas que NO se tocan (quedarían a medias) ──');
  for (const p of descartadas) {
    console.log(`   ${String(p.persona).slice(0,20).padEnd(20)} quedaría en ${cop(p.quedaria)} vs deuda ${cop(p.deuda)}` +
      `  — le sobran ${cop(p.riesgo)} que sí le subirían la deuda`);
  }
  if (!descartadas.length) console.log('   (ninguna)');

  const peor = califican.flatMap((p) => p.seguros).reduce((m, s) => Math.max(m, Number(s.peor_seg)), 0);
  console.log(`\n   Separación máxima de los duplicados a anular: ${peor.toFixed(3)} segundos`);

  if (!APLICAR) { await pool.end(); return; }
  if (!idsAnular.length) { console.log('\nNada que hacer.'); await pool.end(); return; }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: antes } = await client.query(SQL_DEUDAS);

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
    `, [idsAnular, MOTIVO]);

    // ── BARANDA 1: nadie cambió de deuda ────────────────────────────────────
    const { rows: despues } = await client.query(SQL_DEUDAS);
    if (huella(antes) !== huella(despues)) {
      const m = new Map(antes.map((r) => [`${r.neg}|${r.tipo}|${r.pid}`, Number(r.deuda || 0)]));
      for (const d of despues) {
        const k = `${d.neg}|${d.tipo}|${d.pid}`;
        if (m.get(k) !== Number(d.deuda || 0)) console.error(`   deuda movida en ${k}: ${cop(m.get(k))} → ${cop(d.deuda)}`);
      }
      throw new Error('La deuda de alguien cambió — no era lo acordado');
    }
    console.log(`\n✓ Deudas verificadas: ${antes.length} personas, ninguna se movió.`);

    // ── BARANDA 2: ningún préstamo cambió de estado ni de valor ─────────────
    const { rows: [chk] } = await client.query(`
      SELECT (SELECT COUNT(*)::int FROM prestamos WHERE total_abonado < 0) AS negativos,
             (SELECT COUNT(*)::int FROM prestamos p
               WHERE p.id = ANY($1::int[]) AND p.estado <> 'Saldado') AS destapados,
             (SELECT COUNT(*)::int FROM abonos_prestamo
               WHERE anulado AND COALESCE(BTRIM(motivo_anulacion),'') = '') AS sin_motivo
    `, [califican.flatMap((p) => p.seguros).map((s) => s.prestamo_id)]);
    if (chk.negativos || chk.destapados || chk.sin_motivo) {
      throw new Error(`Estado inconsistente (negativos ${chk.negativos}, destapados ${chk.destapados}, sin motivo ${chk.sin_motivo})`);
    }
    console.log('✓ Ningún préstamo cambió de estado ni quedó en negativo.');

    await client.query('COMMIT');
    console.log('\n✅ Aplicado. Ningún cliente cambió de deuda.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Revertido, no se escribió nada:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
