// Corrección de las 4 facturas a crédito descuadradas por `editarFactura`, que
// cambiaba los precios de la factura sin mover el crédito (arreglado el
// 14-sep-2026, prueba 46-editar-factura-credito).
//
// Decisiones del dueño del sistema (14-sep-2026):
//   · #6681 Electrocomfort (Caliwood): vale la FACTURA ($3.790.000, descuento
//     real). El crédito baja y se ANULAN —no se borran— los $150.000 del abono
//     que no aplican. No mueve la deuda (sigue saldado) ni la caja.
//   · #6504 José Corredor, #6574 Julián Vásquez (Caliwood) y #17 Jhon Corrales
//     (Tesla): vale el CRÉDITO. La factura vuelve al valor del crédito. En
//     #6574 los $50.000 salen del iPhone: los accesorios (2 × $15.000) no
//     alcanzan a absorberlos.
//
// Todo va en UNA transacción. Cada factura tiene guardas con sus cifras de hoy:
// si cualquiera ya no cuadra, ROLLBACK y no se escribe nada. Deja un respaldo
// JSON en esta carpeta antes de escribir y un rastro en `auditoria`.
//
//   cd backend && node scripts/corregir-creditos-editados.js
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, ssl: { rejectUnauthorized: false }, max: 1,
});

const FECHA = '14-sep-2026';
const CASOS = [
  {
    negocio: 35, factura: 9338, numero: 6681, credito: 80, cliente: 'ELECTROCOMFORT',
    esperado: { valor_total: 3940000, total_abonado: 3940000, estado: 'Saldado', lineas: 3790000 },
    abonos: [{ id: 145, valor: 3940000 }],
    nuevo: { valor_total: 3790000, total_abonado: 3790000 },
    anular: { abono: 145, valor: 150000 },
    motivo: `Corrección ${FECHA}: la factura #6681 se rebajó a $3.790.000 (descuento) pero el crédito `
      + 'se quedó en $3.940.000 y el abono se registró por el valor viejo. $150.000 no aplican a la deuda.',
  },
  {
    negocio: 35, factura: 7060, numero: 6504, credito: 21, cliente: 'JOSE CORREDOR',
    esperado: { valor_total: 2450000, total_abonado: 2450000, estado: 'Saldado', lineas: 2650000 },
    lineas: [{ id: 7741, cantidad: 1, antes: 2650000, despues: 2450000 }],
    motivo: `Corrección ${FECHA}: la factura se editó a $2.650.000 sin mover el crédito; vale el crédito ($2.450.000).`,
  },
  {
    negocio: 35, factura: 8274, numero: 6574, credito: 40, cliente: 'JULIAN VASQUEZ',
    esperado: { valor_total: 4230000, total_abonado: 4230000, estado: 'Saldado', lineas: 4280000 },
    lineas: [
      { id: 9127, cantidad: 1, antes: 4250000, despues: 4200000 },
      { id: 9128, cantidad: 2, antes: 15000,   despues: 15000 },
    ],
    motivo: `Corrección ${FECHA}: la factura se editó a $4.280.000 sin mover el crédito; vale el crédito ($4.230.000).`,
  },
  {
    negocio: 33, factura: 11633, numero: 17, credito: 166, cliente: 'Jhon corrales',
    esperado: { valor_total: 216000, total_abonado: 0, estado: 'Activo', lineas: 250000 },
    lineas: [{ id: 13182, cantidad: 10, antes: 25000, despues: 21600 }],
    motivo: `Corrección ${FECHA}: la factura se editó a $250.000 sin mover el crédito; vale el crédito ($216.000).`,
  },
];

const netoLineas = (lineas) => lineas.reduce((s, l) =>
  s + Number(l.precio) * (Number(l.cantidad) - Number(l.cantidad_devuelta || 0)), 0);

(async () => {
  const c = await pool.connect();
  const respaldo = [];
  try {
    await c.query("SET lock_timeout = '5s'");
    await c.query('BEGIN');

    // ── 1. Guardas: todo tiene que estar EXACTAMENTE como se diagnosticó ──────
    for (const k of CASOS) {
      const cred = (await c.query(
        `SELECT * FROM creditos WHERE id = $1 AND factura_id = $2 FOR UPDATE`, [k.credito, k.factura])).rows[0];
      const [fac] = (await c.query(
        `SELECT f.*, s.negocio_id FROM facturas f JOIN sucursales s ON s.id = f.sucursal_id WHERE f.id = $1`, [k.factura])).rows;
      const lineas = (await c.query(
        `SELECT * FROM lineas_factura WHERE factura_id = $1 ORDER BY id FOR UPDATE`, [k.factura])).rows;
      const abonos = (await c.query(
        `SELECT * FROM abonos_credito WHERE credito_id = $1 ORDER BY id FOR UPDATE`, [k.credito])).rows;

      const g = {
        negocio:       fac?.negocio_id === k.negocio,
        numero:        fac?.numero === k.numero,
        cliente:       String(fac?.nombre_cliente || '').toUpperCase().includes(k.cliente.toUpperCase()),
        estado_fac:    fac?.estado === 'Credito',
        valor_total:   Number(cred?.valor_total) === k.esperado.valor_total,
        total_abonado: Number(cred?.total_abonado) === k.esperado.total_abonado,
        cuota_0:       Number(cred?.cuota_inicial) === 0,
        estado_cred:   cred?.estado === k.esperado.estado,
        lineas_suman:  netoLineas(lineas) === k.esperado.lineas,
        sin_anulados:  abonos.every((a) => !a.anulado && Number(a.valor_anulado) === 0),
      };
      if (k.lineas) {
        g.lineas_exactas = lineas.length === k.lineas.length && k.lineas.every((e) => {
          const l = lineas.find((x) => x.id === e.id);
          return l && Number(l.precio) === e.antes && l.cantidad === e.cantidad && Number(l.cantidad_devuelta || 0) === 0;
        });
        g.cuadra_despues = k.lineas.reduce((s, e) => s + e.despues * e.cantidad, 0) === k.esperado.valor_total;
      }
      if (k.abonos) {
        g.abonos_exactos = abonos.length === k.abonos.length
          && k.abonos.every((e) => abonos.some((a) => a.id === e.id && Number(a.valor) === e.valor));
      }
      const fallan = Object.entries(g).filter(([, v]) => !v).map(([n]) => n);
      console.log(`#${k.numero} ${k.cliente}: ${fallan.length ? 'FALLA ' + fallan.join(', ') : 'guardas OK'}`);
      if (fallan.length) throw new Error(`Factura #${k.numero} ya no está como se diagnosticó: no se escribe nada`);
      respaldo.push({ caso: k, factura: fac, credito: cred, lineas, abonos });
    }

    const archivo = path.join(__dirname, `respaldo-creditos-editados-${Date.now()}.json`);
    fs.writeFileSync(archivo, JSON.stringify(respaldo, null, 2));
    console.log('Respaldo:', archivo);

    // ── 2. Escritura ──────────────────────────────────────────────────────────
    const uno = (r, que) => { if (r.rowCount !== 1) throw new Error(`${que}: rowCount ${r.rowCount}`); };
    for (const k of CASOS) {
      if (k.nuevo) {
        uno(await c.query(
          `UPDATE creditos SET valor_total = $1, total_abonado = $2
            WHERE id = $3 AND valor_total = $4 AND total_abonado = $5`,
          [k.nuevo.valor_total, k.nuevo.total_abonado, k.credito, k.esperado.valor_total, k.esperado.total_abonado]),
        `crédito ${k.credito}`);
      }
      if (k.anular) {
        uno(await c.query(
          `UPDATE abonos_credito SET valor_anulado = $1, anulado = FALSE, motivo_anulacion = $2, anulado_en = NOW()
            WHERE id = $3 AND credito_id = $4 AND valor_anulado = 0 AND NOT anulado`,
          [k.anular.valor, k.motivo, k.anular.abono, k.credito]), `abono ${k.anular.abono}`);
      }
      for (const e of (k.lineas || []).filter((x) => x.antes !== x.despues)) {
        uno(await c.query(
          `UPDATE lineas_factura SET precio = $1 WHERE id = $2 AND factura_id = $3 AND precio = $4`,
          [e.despues, e.id, k.factura, e.antes]), `línea ${e.id}`);
      }
    }

    // ── 3. Verificación DENTRO de la transacción: crédito == factura ─────────
    for (const k of CASOS) {
      const [cr] = (await c.query(`SELECT valor_total, total_abonado, cuota_inicial, estado FROM creditos WHERE id = $1`, [k.credito])).rows;
      const lineas = (await c.query(`SELECT precio, cantidad, cantidad_devuelta FROM lineas_factura WHERE factura_id = $1`, [k.factura])).rows;
      const [{ vigente }] = (await c.query(
        `SELECT COALESCE(SUM(valor - valor_anulado), 0) AS vigente FROM abonos_credito WHERE credito_id = $1 AND NOT anulado`, [k.credito])).rows;
      const ok = Number(cr.valor_total) === netoLineas(lineas)
        && Number(cr.total_abonado) === Number(vigente)
        && cr.estado === k.esperado.estado;
      console.log(`  verificación #${k.numero}: crédito ${cr.valor_total} · factura ${netoLineas(lineas)} · abonado ${cr.total_abonado} · ${cr.estado} → ${ok ? 'OK' : 'NO CUADRA'}`);
      if (!ok) throw new Error(`Factura #${k.numero} no cuadra tras corregir`);
    }

    // ── 4. Rastro en auditoría (savepoint: su forma no puede tumbar la corrección)
    await c.query('SAVEPOINT aud');
    try {
      for (const { caso: k, credito, lineas } of respaldo) {
        await c.query(
          `INSERT INTO auditoria (negocio_id, usuario_id, accion, tabla, registro_id, detalle)
           VALUES ($1, NULL, 'Corrección manual de crédito', 'facturas', $2, $3)`,
          [k.negocio, k.factura, JSON.stringify({
            numero: k.numero, credito_id: k.credito, motivo: k.motivo,
            credito_antes: { valor_total: Number(credito.valor_total), total_abonado: Number(credito.total_abonado) },
            credito_despues: k.nuevo || null, abono_anulado: k.anular || null,
            lineas: (k.lineas || []).filter((e) => e.antes !== e.despues),
            factura_antes: netoLineas(lineas),
          })]);
      }
    } catch (e) {
      await c.query('ROLLBACK TO SAVEPOINT aud');
      console.log('Auditoría no escrita (la corrección sigue):', e.message);
    }

    await c.query('COMMIT');
    console.log('APLICADO');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('ROLLBACK:', e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})();
