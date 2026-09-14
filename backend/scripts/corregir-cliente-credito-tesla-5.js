// Corrección de la factura #5 de Tesla SmartPhone Shop (negocio 33).
//
// La venta a crédito se hizo a «Cliente Generico» (cédula 0000) y a los 30
// minutos se editó la factura a «Kevin bodega 207 americas» (cédula 123456).
// `editarFactura` cambiaba `facturas.cliente_id` pero no `creditos.cliente_id`:
// el estado de cuenta (que agrupa por la cédula de la factura) se lo muestra a
// Kevin, y el PAGO TOTAL (que busca por `creditos.cliente_id`) se lo cobraría al
// cliente genérico. Se alinea el crédito al cliente de la factura. No cambia
// ningún valor: solo a quién pertenece el crédito.
//
// Guardas con las cifras de hoy: si algo cambió, ROLLBACK y no escribe nada.
//
//   cd backend && node scripts/corregir-cliente-credito-tesla-5.js
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, ssl: { rejectUnauthorized: false }, max: 1,
});

const NEGOCIO = 33, FACTURA = 11269, NUMERO = 5, CREDITO = 152;
const CLIENTE_VIEJO = 3837, CLIENTE_NUEVO = 3839;
const MOTIVO = 'Corrección 14-sep-2026: la factura se editó de «Cliente Generico» a «Kevin bodega 207 americas» '
  + 'y el crédito seguía asociado al cliente genérico. Los valores no cambiaron.';

(async () => {
  const c = await pool.connect();
  try {
    await c.query("SET lock_timeout = '5s'");
    await c.query('BEGIN');

    const [cred] = (await c.query(
      `SELECT * FROM creditos WHERE id = $1 AND factura_id = $2 FOR UPDATE`, [CREDITO, FACTURA])).rows;
    const [fac] = (await c.query(
      `SELECT f.*, s.negocio_id FROM facturas f JOIN sucursales s ON s.id = f.sucursal_id WHERE f.id = $1`, [FACTURA])).rows;
    const clientes = (await c.query(
      `SELECT id, negocio_id, nombre, cedula FROM clientes WHERE id = ANY($1)`, [[CLIENTE_VIEJO, CLIENTE_NUEVO]])).rows;
    const viejo = clientes.find((x) => x.id === CLIENTE_VIEJO);
    const nuevo = clientes.find((x) => x.id === CLIENTE_NUEVO);
    const [{ n: abonos }] = (await c.query(
      `SELECT COUNT(*)::int AS n FROM abonos_credito WHERE credito_id = $1`, [CREDITO])).rows;

    const g = {
      negocio:          fac?.negocio_id === NEGOCIO,
      numero:           fac?.numero === NUMERO,
      estado_factura:   fac?.estado === 'Credito',
      credito_viejo:    cred?.cliente_id === CLIENTE_VIEJO,
      factura_nueva:    fac?.cliente_id === CLIENTE_NUEVO,
      cedula_factura:   fac?.cedula === '123456',
      cliente_nuevo_ok: nuevo?.negocio_id === NEGOCIO && nuevo?.cedula === fac?.cedula,
      cliente_viejo_ok: viejo?.negocio_id === NEGOCIO && viejo?.cedula === '0000',
      sin_abonos:       abonos === 0,
    };
    const fallan = Object.entries(g).filter(([, v]) => !v).map(([k]) => k);
    console.log('Guardas:', fallan.length ? `FALLA ${fallan.join(', ')}` : 'OK');
    if (fallan.length) throw new Error('La factura ya no está como se diagnosticó: no se escribe nada');

    const archivo = path.join(__dirname, `respaldo-cliente-credito-${CREDITO}-${Date.now()}.json`);
    fs.writeFileSync(archivo, JSON.stringify({ credito: cred, factura: fac, clientes }, null, 2));
    console.log('Respaldo:', archivo);

    const u = await c.query(
      `UPDATE creditos SET cliente_id = $1 WHERE id = $2 AND cliente_id = $3`, [CLIENTE_NUEVO, CREDITO, CLIENTE_VIEJO]);
    if (u.rowCount !== 1) throw new Error(`rowCount inesperado ${u.rowCount}`);

    await c.query(
      `INSERT INTO auditoria (negocio_id, usuario_id, accion, tabla, registro_id, detalle)
       VALUES ($1, NULL, 'Corrección manual de crédito', 'facturas', $2, $3)`,
      [NEGOCIO, FACTURA, JSON.stringify({
        tipo: 'cliente', numero: NUMERO, credito_id: CREDITO, motivo: MOTIVO,
        cliente_antes:   { id: viejo.id, nombre: viejo.nombre, cedula: viejo.cedula },
        cliente_despues: { id: nuevo.id, nombre: nuevo.nombre, cedula: nuevo.cedula },
      })]);

    await c.query('COMMIT');
    console.log(`APLICADO: crédito ${CREDITO} → cliente ${CLIENTE_NUEVO} (${nuevo.nombre})`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('ROLLBACK:', e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})();
