/**
 * Alinea el ESTADO DE CUENTA con la DEUDA, sin mover la deuda de nadie.
 *
 * EL PROBLEMA
 * Cuando se devuelve un producto (o se cancela una factura a crédito), su cobro
 * sale de la cuenta pero los abonos que ya se le habían hecho se quedaban vivos.
 * El estado de cuenta los seguía restando contra nada y daba POR DEBAJO de la
 * deuda real — a 23 personas, y a varias de ellas negativa.
 *
 * LO QUE HACE ESTE SCRIPT
 * Marca esos abonos como `anulado`, con el motivo escrito al lado. El movimiento
 * NO se borra: sigue en el extracto, marcado, para que se pueda leer por qué no
 * cuenta.
 *
 * LO QUE **NO** HACE — y es a propósito:
 *   · NO toca la deuda de nadie. Un préstamo devuelto y un crédito cancelado no
 *     entran en el cálculo de la deuda (solo cuentan los ACTIVOS), así que bajar
 *     su `total_abonado` no mueve un peso de lo que alguien debe. Está verificado
 *     persona por persona antes de escribir.
 *   · NO corrige los pagos duplicados. Eso sí subiría deudas, y la decisión del
 *     negocio fue dejar la deuda exactamente como está.
 *   · NO reabre ningún documento cerrado.
 *
 * Por defecto SIMULA. Para aplicar:
 *     node scripts/corregir-abonos-descuadrados.js --aplicar
 */
require('dotenv').config();
const { pool } = require('../src/config/db');

const APLICAR = process.argv.includes('--aplicar');
const cop = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('es-CO');

// ── Abonos vivos sobre préstamos devueltos ──────────────────────────────────
const SQL_PRESTAMOS = `
  SELECT ap.id, ap.valor, ap.prestamo_id, p.nombre_producto,
         su.negocio_id, n.nombre AS negocio,
         COALESCE(pr.nombre, cl.nombre) AS persona,
         (ap.abono_total_id IS NOT NULL) AS de_pago_total
    FROM abonos_prestamo ap
    JOIN prestamos  p  ON p.id  = ap.prestamo_id
    JOIN sucursales su ON su.id = p.sucursal_id
    JOIN negocios   n  ON n.id  = su.negocio_id
    LEFT JOIN prestatarios pr ON pr.id = p.prestatario_id
    LEFT JOIN clientes     cl ON cl.id = p.cliente_id
   WHERE p.estado = 'Devuelto' AND NOT ap.anulado
   ORDER BY su.negocio_id, ap.valor DESC`;

// ── Abonos vivos sobre créditos cancelados ──────────────────────────────────
const SQL_CREDITOS = `
  SELECT ac.id, ac.valor, ac.credito_id,
         su.negocio_id, n.nombre AS negocio,
         f.nombre_cliente AS persona
    FROM abonos_credito ac
    JOIN creditos   cr ON cr.id = ac.credito_id
    JOIN facturas   f  ON f.id  = cr.factura_id
    JOIN sucursales su ON su.id = cr.sucursal_id
    JOIN negocios   n  ON n.id  = su.negocio_id
   WHERE cr.estado = 'Cancelado' AND NOT ac.anulado
   ORDER BY su.negocio_id, ac.valor DESC`;

/** Deuda de cada persona con préstamos, para comprobar que NO se mueve. */
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

const resumir = (titulo, filas) => {
  const total = filas.reduce((s, r) => s + Number(r.valor), 0);
  console.log(`── ${titulo} ──`);
  console.log(`   ${filas.length} abonos · ${cop(total)}`);
  const porNegocio = {};
  for (const r of filas) {
    const k = `${r.negocio_id} ${r.negocio}`;
    porNegocio[k] = porNegocio[k] || { n: 0, v: 0 };
    porNegocio[k].n++; porNegocio[k].v += Number(r.valor);
  }
  for (const [k, v] of Object.entries(porNegocio)) {
    console.log(`     ${k.padEnd(26)} ${String(v.n).padStart(3)} abonos  ${cop(v.v).padStart(15)}`);
  }
  console.log();
  return total;
};

(async () => {
  console.log(APLICAR ? '⚠  MODO APLICAR — se va a escribir en la base\n'
                      : '🔎 SIMULACIÓN — no se escribe nada (usa --aplicar para ejecutar)\n');

  const { rows: pres } = await pool.query(SQL_PRESTAMOS);
  const { rows: cred } = await pool.query(SQL_CREDITOS);

  const tP = resumir('Préstamos devueltos con abonos vivos', pres);
  const tC = resumir('Créditos cancelados con abonos vivos', cred);
  const dePagoTotal = pres.filter((r) => r.de_pago_total);
  console.log(`   De esos, ${dePagoTotal.length} vienen de un PAGO TOTAL ` +
    `(${cop(dePagoTotal.reduce((s, r) => s + Number(r.valor), 0))}) — son los que hoy`);
  console.log('   dejan el extracto descuadrado aunque el código ya esté corregido.\n');
  console.log(`TOTAL a marcar como anulado: ${cop(tP + tC)}\n`);

  if (!APLICAR) { await pool.end(); return; }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Foto de las deudas ANTES. Es la baranda de todo el script.
    const { rows: antes } = await client.query(SQL_DEUDAS);

    if (pres.length) {
      await client.query(`
        WITH previos AS (
          SELECT id, prestamo_id, (valor - valor_anulado) AS pendiente
            FROM abonos_prestamo WHERE id = ANY($1::int[]) AND NOT anulado
        ),
        marcados AS (
          UPDATE abonos_prestamo a
             SET anulado = TRUE, valor_anulado = a.valor,
                 motivo_anulacion = 'Anulado: el producto fue devuelto', anulado_en = NOW()
            FROM previos pv WHERE a.id = pv.id
           RETURNING pv.prestamo_id, pv.pendiente
        ),
        porPrestamo AS (SELECT prestamo_id, SUM(pendiente) AS baja FROM marcados GROUP BY prestamo_id)
        UPDATE prestamos p SET total_abonado = GREATEST(0, p.total_abonado - pp.baja)
          FROM porPrestamo pp WHERE p.id = pp.prestamo_id
      `, [pres.map((r) => r.id)]);
    }

    if (cred.length) {
      await client.query(`
        WITH previos AS (
          SELECT id, credito_id, (valor - valor_anulado) AS pendiente
            FROM abonos_credito WHERE id = ANY($1::int[]) AND NOT anulado
        ),
        marcados AS (
          UPDATE abonos_credito a
             SET anulado = TRUE, valor_anulado = a.valor,
                 motivo_anulacion = 'Anulado: se canceló la factura', anulado_en = NOW()
            FROM previos pv WHERE a.id = pv.id
           RETURNING pv.credito_id, pv.pendiente
        ),
        porCredito AS (SELECT credito_id, SUM(pendiente) AS baja FROM marcados GROUP BY credito_id)
        UPDATE creditos c SET total_abonado = GREATEST(0, c.total_abonado - pc.baja)
          FROM porCredito pc WHERE c.id = pc.credito_id
      `, [cred.map((r) => r.id)]);
    }

    // ── LA BARANDA ──────────────────────────────────────────────────────────
    // Si la deuda de UNA sola persona se movió, esto no era lo acordado y se
    // revierte todo. Es la comprobación que hace seguro correr el script sobre
    // la base de un cliente.
    const { rows: despues } = await client.query(SQL_DEUDAS);
    if (huella(antes) !== huella(despues)) {
      const mapa = new Map(antes.map((r) => [`${r.neg}|${r.tipo}|${r.pid}`, Number(r.deuda || 0)]));
      for (const d of despues) {
        const k = `${d.neg}|${d.tipo}|${d.pid}`;
        if (mapa.get(k) !== Number(d.deuda || 0)) {
          console.error(`   deuda movida en ${k}: ${cop(mapa.get(k))} → ${cop(d.deuda)}`);
        }
      }
      throw new Error('La deuda de alguien cambió — no era lo acordado');
    }
    console.log(`✓ Deudas verificadas: ${antes.length} personas, ninguna se movió.`);

    const { rows: [chk] } = await client.query(`
      SELECT (SELECT COUNT(*)::int FROM abonos_prestamo a JOIN prestamos p ON p.id=a.prestamo_id
               WHERE p.estado='Devuelto' AND NOT a.anulado) AS pres_vivos,
             (SELECT COUNT(*)::int FROM abonos_credito ac JOIN creditos c ON c.id=ac.credito_id
               WHERE c.estado='Cancelado' AND NOT ac.anulado) AS cred_vivos`);
    if (chk.pres_vivos || chk.cred_vivos) throw new Error('Quedaron abonos vivos sin marcar');

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
