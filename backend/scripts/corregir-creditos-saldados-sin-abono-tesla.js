// Tesla (negocio 33, sede 40): 13 créditos quedaron en 'Saldado' con plata sin
// registrar porque el botón «Saldado» de la tarjeta cerraba el crédito con un
// UPDATE a secas, sin abono (arreglado el 29-sep-2026: ahora es «Pagar todo» y
// registra el abono). La plata no estaba en caja ni en reportes.
//
// Decisión del dueño del sistema (29-sep-2026): todos se pagaron, en EFECTIVO,
// el día de su venta, y el abono va SIN nota. Se registra un abono por el saldo
// de cada uno, fechado con la fecha de su factura, a nombre de quien la vendió.
// No se toca el estado (siguen Saldado) ni ningún otro negocio.
//
// Todo va en UNA transacción, con guardas: si cualquier crédito ya no tiene el
// saldo esperado, ROLLBACK y no se escribe nada. Deja respaldo JSON antes.
//
//   cd backend && node scripts/corregir-creditos-saldados-sin-abono-tesla.js            (simula)
//   cd backend && node scripts/corregir-creditos-saldados-sin-abono-tesla.js --aplicar
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const APLICAR = process.argv.includes('--aplicar');
const NEGOCIO = 33;

// crédito → saldo que debe tener hoy (valor_total − cuota_inicial − total_abonado)
const CASOS = {
  151: 154200,  163: 135000,  166: 216000,  203: 5000,    207: 30000,
  208: 8000,    216: 15000,   218: 1662300, 226: 35000,   255: 30000,
  268: 24000,   289: 150000,  311: 319000,
};

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, ssl: { rejectUnauthorized: false }, max: 1,
});

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ids = Object.keys(CASOS).map(Number);

    const { rows } = await client.query(`
      SELECT c.*, f.numero, f.nombre_cliente, f.fecha AS factura_fecha, f.usuario_id AS factura_usuario,
             s.negocio_id
        FROM creditos c
        JOIN facturas f   ON f.id = c.factura_id
        JOIN sucursales s ON s.id = c.sucursal_id
       WHERE c.id = ANY($1::int[])
       ORDER BY c.id
       FOR UPDATE OF c`, [ids]);

    if (rows.length !== ids.length) throw new Error(`Esperaba ${ids.length} créditos, hay ${rows.length}`);
    for (const c of rows) {
      const saldo = Number(c.valor_total) - Number(c.cuota_inicial) - Number(c.total_abonado);
      if (Number(c.negocio_id) !== NEGOCIO) throw new Error(`Crédito ${c.id} no es de Tesla`);
      if (c.estado !== 'Saldado') throw new Error(`Crédito ${c.id} está '${c.estado}', no 'Saldado'`);
      if (Math.abs(saldo - CASOS[c.id]) > 0.5) throw new Error(`Crédito ${c.id}: saldo ${saldo}, esperaba ${CASOS[c.id]}`);
    }

    const respaldo = path.join(__dirname, `respaldo-saldados-sin-abono-tesla-${Date.now()}.json`);
    fs.writeFileSync(respaldo, JSON.stringify(rows, null, 2));
    console.log(`Respaldo: ${respaldo}`);

    let total = 0;
    for (const c of rows) {
      const saldo = CASOS[c.id];
      const { rows: [ab] } = await client.query(`
        INSERT INTO abonos_credito (credito_id, usuario_id, fecha, valor, metodo, notas)
        VALUES ($1, $2, $3, $4, 'Efectivo', NULL)
        RETURNING id, fecha`, [c.id, c.factura_usuario, c.factura_fecha, saldo]);
      const { rows: [cr] } = await client.query(`
        UPDATE creditos SET total_abonado = total_abonado + $1 WHERE id = $2
        RETURNING valor_total, cuota_inicial, total_abonado, estado`, [saldo, c.id]);
      if (Math.abs(Number(cr.valor_total) - Number(cr.cuota_inicial) - Number(cr.total_abonado)) > 0.5) {
        throw new Error(`Crédito ${c.id} no quedó en cero`);
      }
      await client.query(`
        INSERT INTO auditoria (negocio_id, usuario_id, accion, tabla, registro_id, detalle)
        VALUES ($1, NULL, 'Abono a crédito', 'creditos', $2, $3)`,
        [NEGOCIO, c.id, JSON.stringify({ sucursal_id: c.sucursal_id, monto: saldo, saldo_nuevo: 0, correccion_saldado_sin_abono: true })]);
      total += saldo;
      console.log(`  #${c.numero} ${c.nombre_cliente.padEnd(28)} crédito ${c.id}  +$${saldo.toLocaleString('es-CO')}  abono ${ab.id} (${ab.fecha.toISOString?.() ?? ab.fecha})`);
    }
    console.log(`Total: $${total.toLocaleString('es-CO')} en ${rows.length} abonos`);

    if (APLICAR) { await client.query('COMMIT'); console.log('✓ APLICADO'); }
    else         { await client.query('ROLLBACK'); console.log('(simulación: ROLLBACK, no se escribió nada — usa --aplicar)'); }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('✗ ROLLBACK:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
