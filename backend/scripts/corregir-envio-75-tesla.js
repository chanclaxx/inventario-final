// Corrección del envío #75 de Tesla SmartPhone Shop (negocio 33) → BUNNY MOBILE.
//
// 29-sep-2026. La bodega mandó 10 × ML ORIGINALES APPLE LIGTHNING en el envío
// #74 y Bunny los recibió (19:01) y los pagó (remesa 29). Como en Bunny el
// producto conservaba la talla «SIN MARCA» —que en la bodega se quitó en la
// importación del 6-sep— el local veía esa talla en 0; el admin eliminó el
// producto en Bunny (19:06, con las 10 unidades adentro), sumó +10 en la bodega
// (19:08) y volvió a despachar lo mismo como #75. El #75 no se podía recibir
// («valor único»: la recepción intentaba recrear el producto eliminado).
//
// El cliente confirmó que en Bunny hay 10 unidades en total: el #75 sobra.
//   1. Anula el #75 (como `anularRemision`: estado Anulada, línea Devuelta).
//   2. Revierte el +10 de la bodega (60 → 50), con su renglón en el historial.
//   3. Restaura el producto en Bunny (con sus 10) y le quita la talla vacía.
//   4. Iguala el producto en las sedes 48 y 50: sin talla, como la bodega. En la
//      48 la talla tenía las 6 unidades del envío #1: el producto ya dice 6, y
//      la línea del #1 pasa al producto sin talla para que el lote FIFO siga
//      reconociéndolas como mercancía de la bodega al devolverlas.
//
// Guardas con las cifras de hoy: si algo cambió, ROLLBACK y no escribe nada.
//
//   cd backend && node scripts/corregir-envio-75-tesla.js            (en seco)
//   cd backend && node scripts/corregir-envio-75-tesla.js --aplicar
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, ssl: { rejectUnauthorized: false }, max: 1,
});

const APLICAR = process.argv.includes('--aplicar');
const NEGOCIO = 33, BODEGA = 40, BUNNY = 49;
const REMISION = 112, NUMERO = 75, LINEA = 1531;
const PROD_BODEGA = 2419, PROD_BUNNY = 4075, TALLA_BUNNY = 5887;
const PROD_48 = 3741, TALLA_48 = 4827, LINEA_ENVIO_1 = 99;
const PROD_50 = 6280, TALLA_50 = 16504;
const MOTIVO = 'Corrección 29-sep-2026: el envío #75 repetía las 10 uds del #74, que Bunny ya había '
  + 'recibido y pagado; el producto se había eliminado en Bunny porque su talla «SIN MARCA» '
  + '(que la bodega ya no tiene) se veía en 0. En Bunny hay 10 uds en total (confirmado por el cliente).';

(async () => {
  const c = await pool.connect();
  try {
    await c.query("SET lock_timeout = '5s'");
    await c.query('BEGIN');

    const uno = async (sql, p) => (await c.query(sql, p)).rows[0];
    const rem   = await uno(`SELECT * FROM remisiones WHERE id = $1 FOR UPDATE`, [REMISION]);
    const lineas = (await c.query(`SELECT * FROM lineas_remision WHERE remision_id = $1`, [REMISION])).rows;
    const pb    = await uno(`SELECT * FROM productos_cantidad WHERE id = $1 FOR UPDATE`, [PROD_BODEGA]);
    const [{ n: tallasBodega }] = (await c.query(
      `SELECT count(*)::int n FROM atributos_producto WHERE producto_id = $1 AND activo`, [PROD_BODEGA])).rows;
    const pbu   = await uno(`SELECT * FROM productos_cantidad WHERE id = $1 FOR UPDATE`, [PROD_BUNNY]);
    const tbu   = await uno(`SELECT * FROM atributos_producto WHERE id = $1 FOR UPDATE`, [TALLA_BUNNY]);
    const [{ n: codigoOcupado }] = (await c.query(
      `SELECT count(*)::int n FROM productos_cantidad
       WHERE sucursal_id = $1 AND activo AND codigo = $2 AND id <> $3`, [BUNNY, pbu?.codigo, PROD_BUNNY])).rows;
    const p48   = await uno(`SELECT * FROM productos_cantidad WHERE id = $1 FOR UPDATE`, [PROD_48]);
    const t48   = await uno(`SELECT * FROM atributos_producto WHERE id = $1 FOR UPDATE`, [TALLA_48]);
    const l99   = await uno(`SELECT * FROM lineas_remision WHERE id = $1 FOR UPDATE`, [LINEA_ENVIO_1]);
    const p50   = await uno(`SELECT * FROM productos_cantidad WHERE id = $1 FOR UPDATE`, [PROD_50]);
    const t50   = await uno(`SELECT * FROM atributos_producto WHERE id = $1 FOR UPDATE`, [TALLA_50]);
    const tallasActivas = async (id) => Number((await uno(
      `SELECT count(*)::int n FROM atributos_producto WHERE producto_id = $1 AND activo`, [id])).n);

    const g = {
      remision:        rem?.negocio_id == NEGOCIO && rem?.numero === NUMERO && rem?.estado === 'En transito'
                       && rem?.sucursal_origen_id === BODEGA && rem?.sucursal_destino_id === BUNNY,
      una_linea:       lineas.length === 1 && Number(lineas[0].id) === LINEA && lineas[0].estado_linea === 'Pendiente'
                       && lineas[0].cantidad === 10 && lineas[0].producto_origen_id === PROD_BODEGA,
      bodega_60:       pb?.sucursal_id === BODEGA && Number(pb.stock) === 60 && pb.activo && tallasBodega === 0,
      bunny_eliminado: pbu?.sucursal_id === BUNNY && pbu.activo === false && Number(pbu.stock) === 10
                       && pbu.nombre === pb?.nombre,
      bunny_talla:     tbu?.producto_id === PROD_BUNNY && tbu.activo && Number(tbu.stock) === 0,
      bunny_1_talla:   (await tallasActivas(PROD_BUNNY)) === 1,
      codigo_libre:    codigoOcupado === 0,
      s48:             p48?.sucursal_id === 48 && p48.activo && Number(p48.stock) === 6
                       && t48?.producto_id === PROD_48 && t48.activo && Number(t48.stock) === 6
                       && (await tallasActivas(PROD_48)) === 1,
      linea_envio_1:   Number(l99?.atributo_destino_id) === TALLA_48 && Number(l99?.producto_destino_id) === PROD_48,
      s50:             p50?.sucursal_id === 50 && p50.activo && Number(p50.stock) === 0
                       && t50?.producto_id === PROD_50 && t50.activo && Number(t50.stock) === 0
                       && (await tallasActivas(PROD_50)) === 1,
    };
    const fallan = Object.entries(g).filter(([, v]) => !v).map(([k]) => k);
    console.log('Guardas:', fallan.length ? `FALLA ${fallan.join(', ')}` : 'OK');
    if (fallan.length) throw new Error('Los datos ya no están como se diagnosticó: no se escribe nada');

    if (APLICAR) {
      const archivo = path.join(__dirname, `respaldo-envio-75-tesla-${Date.now()}.json`);
      fs.writeFileSync(archivo, JSON.stringify({ rem, lineas, pb, pbu, tbu, p48, t48, l99, p50, t50 }, null, 2));
      console.log('Respaldo:', archivo);
    }

    const exigir = (r, n, que) => { if (r.rowCount !== n) throw new Error(`${que}: rowCount ${r.rowCount}`); };
    const audit = (usuarioTabla, id, accion, detalle) => c.query(
      `INSERT INTO auditoria (negocio_id, usuario_id, accion, tabla, registro_id, detalle)
       VALUES ($1, NULL, $2, $3, $4, $5)`,
      [NEGOCIO, accion, usuarioTabla, id, JSON.stringify({ ...detalle, motivo: MOTIVO })]);

    // 1. Anular el #75 (lo mismo que hace anularRemision).
    exigir(await c.query(`UPDATE remisiones SET estado = 'Anulada' WHERE id = $1 AND estado = 'En transito'`, [REMISION]), 1, 'anular');
    exigir(await c.query(`UPDATE lineas_remision SET estado_linea = 'Devuelta' WHERE remision_id = $1`, [REMISION]), 1, 'línea');
    await audit('red_interna', REMISION, 'Remisión anulada', { sucursal_id: BODEGA, numero: NUMERO });

    // 2. Revertir el +10 de la bodega.
    exigir(await c.query(`UPDATE productos_cantidad SET stock = stock - 10 WHERE id = $1 AND stock = 60`, [PROD_BODEGA]), 1, 'bodega');
    await c.query(
      `INSERT INTO historial_stock_cantidad (producto_id, sucursal_id, cantidad, costo_unitario, tipo, notas)
       VALUES ($1, $2, -10, $3, 'ajuste', $4)`,
      [PROD_BODEGA, BODEGA, pb.costo_unitario, 'Corrección: revierte el ajuste +10 del 29-sep 19:08 (reenvío del #74 como #75, anulado)']);
    await audit('productos_cantidad', PROD_BODEGA, 'Ajuste de stock',
      { sucursal_id: BODEGA, producto: pb.nombre, cantidad: -10, stock_anterior: 60, stock_nuevo: 50 });

    // 3. Restaurar el producto en Bunny, sin la talla vacía.
    exigir(await c.query(`UPDATE productos_cantidad SET activo = true WHERE id = $1 AND activo = false`, [PROD_BUNNY]), 1, 'restaurar');
    exigir(await c.query(`UPDATE atributos_producto SET activo = false WHERE id = $1`, [TALLA_BUNNY]), 1, 'talla bunny');
    await audit('productos_cantidad', PROD_BUNNY, 'Producto cantidad restaurado',
      { sucursal_id: BUNNY, producto: pbu.nombre, stock: 10, talla_desactivada: tbu.valor });

    // 4. Igualar 48 y 50 con la bodega: sin talla.
    exigir(await c.query(`UPDATE atributos_producto SET activo = false WHERE id = $1`, [TALLA_50]), 1, 'talla 50');
    exigir(await c.query(`UPDATE atributos_producto SET activo = false WHERE id = $1`, [TALLA_48]), 1, 'talla 48');
    exigir(await c.query(
      `UPDATE lineas_remision SET atributo_destino_id = NULL WHERE id = $1 AND atributo_destino_id = $2`,
      [LINEA_ENVIO_1, TALLA_48]), 1, 'línea envío #1');
    for (const [suc, id, talla, stock] of [[48, PROD_48, t48, 6], [50, PROD_50, t50, 0]]) {
      await audit('productos_cantidad', id, 'Variante desactivada',
        { sucursal_id: suc, producto: pb.nombre, talla: talla.valor, stock_producto: stock });
    }

    // Verificación dentro de la misma transacción.
    const fin = async (id) => uno(`SELECT stock, activo FROM productos_cantidad WHERE id = $1`, [id]);
    const v = { bodega: await fin(PROD_BODEGA), bunny: await fin(PROD_BUNNY), s48: await fin(PROD_48), s50: await fin(PROD_50) };
    const [{ n: enTransito }] = (await c.query(
      `SELECT count(*)::int n FROM remisiones WHERE negocio_id = $1 AND sucursal_destino_id = $2 AND estado = 'En transito'`,
      [NEGOCIO, BUNNY])).rows;
    console.log('Después:', JSON.stringify(v), '· envíos en tránsito a Bunny:', enTransito);
    for (const id of [PROD_BUNNY, PROD_48, PROD_50]) {
      if ((await tallasActivas(id)) !== 0) throw new Error(`producto ${id} sigue con tallas`);
    }

    await c.query(APLICAR ? 'COMMIT' : 'ROLLBACK');
    console.log(APLICAR ? 'APLICADO.' : 'EN SECO: nada se escribió (usa --aplicar).');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})();
