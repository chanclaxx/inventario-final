// Verificación SOLO LECTURA: devoluciones, mora y generación de PDF.
require('dotenv').config();
const { pool } = require('./src/config/db');
const service    = require('./src/modules/creditos/creditos.service');
const pdfService = require('./src/modules/creditos/creditos.pdf.service');

(async () => {
  // ── 1. Clientes con devoluciones parciales en facturas a crédito ───────────
  const { rows: conDevol } = await pool.query(`
    SELECT su.negocio_id,
           COALESCE(NULLIF(f.cedula, ''), f.nombre_cliente) AS clave,
           SUM(lf.cantidad_devuelta * lf.precio) AS devuelto
    FROM creditos c
    JOIN facturas f        ON f.id = c.factura_id
    JOIN lineas_factura lf ON lf.factura_id = f.id
    JOIN sucursales su     ON su.id = c.sucursal_id
    WHERE COALESCE(lf.cantidad_devuelta, 0) > 0
    GROUP BY 1, 2
    ORDER BY 3 DESC
    LIMIT 10
  `);

  console.log(`── Clientes con devoluciones: ${conDevol.length} ──`);
  for (const c of conDevol) {
    const movs = await service.getEstadoCuenta(c.negocio_id, c.clave, null);
    const conSaldo = movs.filter((m) => m.saldo != null);
    const saldoMovs = conSaldo.length ? conSaldo[conSaldo.length - 1].saldo : 0;

    const { rows: [cont] } = await pool.query(`
      SELECT COALESCE(SUM(CASE WHEN c.estado = 'Saldado' THEN 0
                    ELSE c.valor_total - c.cuota_inicial - c.total_abonado END), 0)::numeric AS saldo
      FROM creditos c
      JOIN facturas f ON f.id = c.factura_id
      JOIN sucursales su ON su.id = c.sucursal_id
      WHERE su.negocio_id = $1
        AND COALESCE(NULLIF(f.cedula, ''), f.nombre_cliente) = $2
        AND c.estado <> 'Cancelado'
    `, [c.negocio_id, c.clave]);

    const devs = movs.filter((m) => m.tipo === 'devolucion');
    const sumaDev = devs.reduce((s, m) => s + Number(m.abono || 0), 0);
    const dif = Math.abs(Number(saldoMovs) - Number(cont.saldo));

    console.log(
      `${dif <= 1 ? 'OK ' : 'DIF'} neg=${c.negocio_id} "${String(c.clave).slice(0, 20)}" ` +
      `devolBD=${Math.round(c.devuelto)} devolEstado=${Math.round(sumaDev)} (${devs.length} filas) ` +
      `saldo=${Math.round(saldoMovs)} contable=${Math.round(cont.saldo)}`
    );
    devs.forEach((d) => console.log(`     · ${String(d.fecha).slice(0, 10)} ${Math.round(d.abono)} — ${d.concepto.slice(0, 70)}`));
  }

  // ── 2. Créditos con movimientos de mora ────────────────────────────────────
  const { rows: conMora } = await pool.query(`
    SELECT su.negocio_id, COALESCE(NULLIF(f.cedula, ''), f.nombre_cliente) AS clave, COUNT(*) AS n
    FROM movimientos_mora mm
    JOIN creditos c    ON c.id = mm.credito_id
    JOIN facturas f    ON f.id = c.factura_id
    JOIN sucursales su ON su.id = c.sucursal_id
    WHERE NOT mm.anulado
    GROUP BY 1, 2 LIMIT 5
  `);
  console.log(`\n── Clientes con mora: ${conMora.length} ──`);
  for (const c of conMora) {
    const movs = await service.getEstadoCuenta(c.negocio_id, c.clave, null);
    const mora = movs.filter((m) => m.tipo.startsWith('mora_'));
    console.log(`neg=${c.negocio_id} "${c.clave}" → ${mora.length} mov. de mora (todos con saldo null: ${mora.every((m) => m.saldo === null)})`);
    mora.forEach((m) => console.log(`     · ${m.tipo} ${Math.round(m.abono)} — ${m.concepto.slice(0, 60)}`));
  }

  // ── 3. Generación de PDF de punta a punta ──────────────────────────────────
  const objetivo = conDevol[0] || conMora[0];
  if (objetivo) {
    const doc = await pdfService.generarPdfEstadoCuenta({
      clave: objetivo.clave, negocioId: objetivo.negocio_id,
      negocioNombre: 'Prueba', logoNegocio: null, sucursalId: null,
    });
    const chunks = [];
    await new Promise((res, rej) => {
      doc.on('data', (ch) => chunks.push(ch));
      doc.on('end', res);
      doc.on('error', rej);
    });
    const buf = Buffer.concat(chunks);
    console.log(`\n── PDF generado: ${buf.length} bytes, cabecera "${buf.slice(0, 5).toString()}" ──`);
  }

  await pool.end();
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
