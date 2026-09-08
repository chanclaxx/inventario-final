// ─────────────────────────────────────────────────────────────────────────────
// RETOMAS — el equipo que YO vendí y vuelve, contra un Postgres real (PGlite).
//
// El caso: vendo un equipo, pasan cuatro meses, el cliente lo trae para
// cambiarlo por otro. Ahora estoy retomando mi propio equipo, y su costo ya no
// es el que le pagué al proveedor: es lo que le acabo de reconocer al cliente.
//
// El sistema resolvía eso REACTIVANDO la fila que ya existía (`vendido = false`)
// sin tocar ni el costo, ni la fecha, ni el proveedor. Y como la utilidad de una
// venta con IMEI se calcula contra `seriales.costo_compra`, la reventa podía
// reportar pérdida:
//
//   vendo 800.000 (costo 600.000) → retomo 400.000 → revendo 500.000
//   real:     500.000 − 400.000 =  100.000
//   sistema:  500.000 − 600.000 = −100.000
//
//   · Sección 1 — un serial NUEVO (equipo ajeno) entra como siempre. Es la que
//     hay que mirar primero: es la que protege el flujo que hoy sí funciona.
//   · Sección 2 — el corazón: la REACTIVACIÓN entra con el costo de HOY.
//   · Sección 3 — la referencia es cambiable: el equipo puede volver como
//     "usado" en vez de a la referencia de nuevo.
//   · Sección 4 — el precio de venta lo decide una persona; nunca se deriva del
//     valor de la retoma (que era como el usado quedaba ofrecido en lo que se
//     acababa de pagar por él).
//   · Sección 5 — deshacer. Una reactivación se RESTAURA; hacía `DELETE FROM
//     seriales`, o sea que borraba la unidad original con su costo, su
//     proveedor y su vínculo con la compra.
//   · Sección 6 — las barandas: prestado, ya disponible, y el aislamiento entre
//     los negocios que comparten la base.
//   · Sección 7 — la aritmética del caso completo, con la cifra de utilidad.
//   · Sección 8 — la retoma por CANTIDAD baja al nodo HOJA y pondera el costo
//     contra el stock de ESE nodo.
//   · Sección 9 — sin la migración aplicada, retomar sigue funcionando.
//
// Requiere PGlite (no va en package.json a propósito):
//   npm install --no-save @electric-sql/pglite
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

// El fixture es un recorte. `seriales.precio` existe en producción desde que el
// POS admite precio por unidad, y las retomas lo escriben.
await db.exec(`
  ALTER TABLE seriales ADD COLUMN IF NOT EXISTS precio NUMERIC;
  -- El historial por nodo lo aplica migrations.js en cada arranque desde que el
  -- stock bajó a las variantes; el fixture compartido se quedó sin esas dos.
  ALTER TABLE historial_stock_cantidad ADD COLUMN IF NOT EXISTS atributo_id INT;
  ALTER TABLE historial_stock_cantidad ADD COLUMN IF NOT EXISTS variante_id INT;
`);

// La migración bajo prueba, tal cual se aplica en producción.
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260907_retomas_reingreso.sql'), 'utf8'));

const conectar = (t) => ({
  query: async (text, params) => {
    const r = await t.query(text, params ?? []);
    return { ...r, rowCount: r.rowCount ?? r.affectedRows ?? (r.rows?.length ?? 0) };
  },
});
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] = {
  id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} },
};

const columnas = require(path.join(RAIZ, 'src/config/columnas.js'));
columnas._setRetomaReingresoDisponible(true);

const { ingresarSerialRetomado, revertirIngresoSerial, rastroParaRetoma } =
  require(path.join(RAIZ, 'src/utils/retomaSerial.util.js'));

let fallos = 0, pasados = 0;
const check = (nombre, cond, detalle = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${cond ? '' : `  ← ${detalle}`}`);
  cond ? pasados++ : fallos++;
};
const checkEq = (nombre, real, esperado) => check(
  nombre, JSON.stringify(real) === JSON.stringify(esperado),
  `dio ${JSON.stringify(real)}, esperaba ${JSON.stringify(esperado)}`);

const cli = { ...conectar(db), release() {} };
const hoy = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ── Escenario ────────────────────────────────────────────────────────────────
// Dos negocios sobre la misma base, como en producción.
await db.exec(`
  INSERT INTO negocios(id, nombre) VALUES (1, 'Mi negocio'), (2, 'El de al lado');
  INSERT INTO sucursales(id, negocio_id, nombre) VALUES
    (10, 1, 'Principal'), (11, 1, 'Sansur'), (20, 2, 'Ajena');
  INSERT INTO productos_serial(id, nombre, sucursal_id) VALUES
    (100, 'iPhone 11 Pro',        10),
    (101, 'iPhone 11 Pro USADO',  10),
    (102, 'iPhone 11 Pro',        11),
    (200, 'iPhone 11 Pro',        20);
  INSERT INTO proveedores(id, negocio_id, nombre) VALUES (5, 1, 'Mayorista');
`);

const serial = async (id) => (await db.query(
  `SELECT id, producto_id, imei, vendido, prestado, costo_compra, precio,
          to_char(fecha_entrada,'YYYY-MM-DD') AS fecha_entrada,
          to_char(fecha_salida,'YYYY-MM-DD')  AS fecha_salida,
          proveedor_id, cliente_origen
   FROM seriales WHERE id = $1`, [id])).rows[0];

// ── 1. Un equipo AJENO entra como siempre ───────────────────────────────────
console.log('\n1) Serial NUEVO — el flujo que ya funcionaba no cambia');
{
  const r = await ingresarSerialRetomado(cli, {
    negocioId: 1, sucursalId: 10, imei: '111111111111111',
    productoSerialId: 100, valorRetoma: 400000, clienteOrigen: 'Ana',
  });
  const s = await serial(r.serialId);
  check('se creó la fila',                 r.ingresado === true && !r.reactivado);
  check('no dejó estado anterior',         r.estadoAnterior === null);
  checkEq('costo = valor de la retoma',    Number(s.costo_compra), 400000);
  checkEq('fecha de entrada = hoy',        s.fecha_entrada, hoy());
  checkEq('sin proveedor (vino de un cliente)', s.proveedor_id, null);
  checkEq('disponible',                    [s.vendido, s.prestado], [false, false]);
  checkEq('a nombre de quien lo trajo',    s.cliente_origen, 'Ana');
  checkEq('sin precio impuesto',           s.precio, null);
}

// ── 2. EL CORAZÓN: mi propio equipo vuelve ──────────────────────────────────
console.log('\n2) REACTIVACIÓN — el equipo propio entra con el costo de HOY');
let idPropio;
{
  const { rows } = await db.query(
    `INSERT INTO seriales(producto_id, imei, costo_compra, precio, fecha_entrada,
                          fecha_salida, vendido, proveedor_id, cliente_origen)
     VALUES (100, '222222222222222', 600000, 950000, '2026-05-01', '2026-05-07', true, 5, 'Compra original')
     RETURNING id`);
  idPropio = rows[0].id;

  const r = await ingresarSerialRetomado(cli, {
    negocioId: 1, sucursalId: 10, imei: '222222222222222',
    productoSerialId: 100, valorRetoma: 400000, clienteOrigen: 'Beto',
  });
  const s = await serial(idPropio);

  check('reutiliza la fila, no crea otra', r.serialId === idPropio);
  check('queda marcada como reactivación', r.reactivado === true);
  checkEq('COSTO = lo que le reconocí hoy, no los 600.000 de la compra',
    Number(s.costo_compra), 400000);
  checkEq('fecha de entrada = hoy, no la de hace 4 meses', s.fecha_entrada, hoy());
  checkEq('se le borra la fecha de salida',  s.fecha_salida, null);
  checkEq('deja de arrastrar el proveedor original', s.proveedor_id, null);
  checkEq('vuelve a estar disponible',       [s.vendido, s.prestado], [false, false]);
  checkEq('a nombre de quien lo trajo',      s.cliente_origen, 'Beto');

  check('guardó el costo anterior para poder deshacer',
    Number(r.estadoAnterior.costo_compra) === 600000);
  checkEq('guardó la fecha anterior sin correrla de día',
    r.estadoAnterior.fecha_entrada, '2026-05-01');
  checkEq('guardó que estaba vendida', r.estadoAnterior.vendido, true);

  const total = (await db.query(`SELECT COUNT(*)::int n FROM seriales WHERE imei = '222222222222222'`)).rows[0].n;
  checkEq('sigue habiendo UNA sola fila para ese IMEI', total, 1);
}

// ── 3. La referencia es cambiable ───────────────────────────────────────────
console.log('\n3) El equipo puede volver como USADO, a otra referencia');
{
  await db.query(`UPDATE seriales SET vendido = true, fecha_salida = '2026-09-01' WHERE id = $1`, [idPropio]);

  const r = await ingresarSerialRetomado(cli, {
    negocioId: 1, sucursalId: 10, imei: '222222222222222',
    productoSerialId: 101,        // ← "iPhone 11 Pro USADO"
    valorRetoma: 380000, clienteOrigen: 'Carlos',
  });
  const s = await serial(idPropio);
  checkEq('el equipo se movió a la referencia elegida', s.producto_id, 101);
  checkEq('con el costo de esta retoma',                Number(s.costo_compra), 380000);
  checkEq('el estado anterior recuerda de dónde salió', r.estadoAnterior.producto_id, 100);

  // Una referencia de OTRA sucursal no es un destino válido: el aparato está
  // físicamente donde se está haciendo la retoma.
  let err = null;
  try {
    await ingresarSerialRetomado(cli, {
      negocioId: 1, sucursalId: 10, imei: '333333333333333',
      productoSerialId: 102, valorRetoma: 100, clienteOrigen: 'X',
    });
  } catch (e) { err = e; }
  checkEq('una referencia de otra sucursal se rechaza', err?.status, 403);

  // Sin referencia elegida no revienta: informa que no ingresó, para que la
  // retoma se grabe diciendo la verdad en vez de `ingreso_inventario = true`.
  const sinDestino = await ingresarSerialRetomado(cli, {
    negocioId: 1, sucursalId: 10, imei: '999999999999999',
    productoSerialId: null, valorRetoma: 100, clienteOrigen: 'X',
  });
  checkEq('sin referencia no ingresa y lo dice', sinDestino.ingresado, false);
  checkEq('y no inventa una fila', sinDestino.serialId, null);
}

// ── 4. El precio de venta ───────────────────────────────────────────────────
console.log('\n4) El precio de venta lo decide una persona');
{
  const antes = await serial(idPropio);
  checkEq('sin precio_venta, el precio no se toca', Number(antes.precio), 950000);
  check('y NO quedó en el valor de la retoma', Number(antes.precio) !== 380000);

  await db.query(`UPDATE seriales SET vendido = true WHERE id = $1`, [idPropio]);
  await ingresarSerialRetomado(cli, {
    negocioId: 1, sucursalId: 10, imei: '222222222222222',
    productoSerialId: 101, valorRetoma: 380000, precioVenta: 700000, clienteOrigen: 'Carlos',
  });
  checkEq('con precio_venta, se escribe ese', Number((await serial(idPropio)).precio), 700000);
}

// ── 5. Deshacer ─────────────────────────────────────────────────────────────
console.log('\n5) Anular una retoma NO borra el equipo');
{
  const { rows } = await db.query(
    `INSERT INTO seriales(producto_id, imei, costo_compra, precio, fecha_entrada,
                          fecha_salida, vendido, proveedor_id, cliente_origen)
     VALUES (100, '444444444444444', 600000, 950000, '2026-05-01', '2026-05-07', true, 5, 'Compra original')
     RETURNING id`);
  const id = rows[0].id;

  const r = await ingresarSerialRetomado(cli, {
    negocioId: 1, sucursalId: 10, imei: '444444444444444',
    productoSerialId: 101, valorRetoma: 400000, precioVenta: 700000, clienteOrigen: 'Dora',
  });

  const resultado = await revertirIngresoSerial(cli, {
    negocioId: 1, imei: '444444444444444',
    serialId: r.serialId, reactivado: r.reactivado, estadoAnterior: r.estadoAnterior,
  });
  const s = await serial(id);

  checkEq('la reversión restaura, no elimina', resultado, 'restaurado');
  check('el equipo SIGUE existiendo', s != null);
  checkEq('vuelve a estar vendido',            s.vendido, true);
  checkEq('recupera su costo real de compra',  Number(s.costo_compra), 600000);
  checkEq('recupera su precio',                Number(s.precio), 950000);
  checkEq('recupera su referencia original',   s.producto_id, 100);
  checkEq('recupera su fecha de entrada',      s.fecha_entrada, '2026-05-01');
  checkEq('recupera su fecha de salida',       s.fecha_salida, '2026-05-07');
  checkEq('recupera su proveedor',             s.proveedor_id, 5);

  // Lo que la retoma sí creó, sí se borra.
  const nuevo = await ingresarSerialRetomado(cli, {
    negocioId: 1, sucursalId: 10, imei: '555555555555555',
    productoSerialId: 100, valorRetoma: 200000, clienteOrigen: 'Eva',
  });
  const res2 = await revertirIngresoSerial(cli, {
    negocioId: 1, imei: '555555555555555',
    serialId: nuevo.serialId, reactivado: nuevo.reactivado, estadoAnterior: nuevo.estadoAnterior,
  });
  const quedan = (await db.query(`SELECT COUNT(*)::int n FROM seriales WHERE imei = '555555555555555'`)).rows[0].n;
  checkEq('una fila que creó la retoma sí se elimina', res2, 'eliminado');
  checkEq('y desaparece', quedan, 0);
}

// ── 6. Barandas ─────────────────────────────────────────────────────────────
console.log('\n6) Barandas — prestado, ya disponible, y el negocio de al lado');
{
  await db.query(
    `INSERT INTO seriales(producto_id, imei, costo_compra, vendido, prestado)
     VALUES (100, '666666666666666', 100, false, true)`);
  let err = null;
  try {
    await ingresarSerialRetomado(cli, {
      negocioId: 1, sucursalId: 10, imei: '666666666666666',
      productoSerialId: 100, valorRetoma: 1, clienteOrigen: 'X' });
  } catch (e) { err = e; }
  checkEq('un equipo prestado no se retoma', err?.code, 'IMEI_PRESTADO');

  await db.query(
    `INSERT INTO seriales(producto_id, imei, costo_compra, vendido)
     VALUES (100, '777777777777777', 100, false)`);
  err = null;
  try {
    await ingresarSerialRetomado(cli, {
      negocioId: 1, sucursalId: 10, imei: '777777777777777',
      productoSerialId: 100, valorRetoma: 1, clienteOrigen: 'X' });
  } catch (e) { err = e; }
  checkEq('uno que ya está disponible tampoco', err?.status, 409);

  // El IMEI es único POR NEGOCIO, no globalmente: la misma cifra existe en el
  // negocio 2. Ni el ingreso ni la reversión pueden alcanzarla.
  const { rows: aj } = await db.query(
    `INSERT INTO seriales(producto_id, imei, costo_compra, vendido)
     VALUES (200, '888888888888888', 777777, false) RETURNING id`);
  const idAjeno = aj[0].id;

  const r = await ingresarSerialRetomado(cli, {
    negocioId: 1, sucursalId: 10, imei: '888888888888888',
    productoSerialId: 100, valorRetoma: 300000, clienteOrigen: 'Fabio',
  });
  check('el IMEI del otro negocio no se reactiva: se crea uno propio',
    r.reactivado === false && r.serialId !== idAjeno);
  checkEq('la fila del otro negocio quedó intacta',
    Number((await serial(idAjeno)).costo_compra), 777777);

  await revertirIngresoSerial(cli, { negocioId: 1, imei: '888888888888888', serialId: r.serialId });
  check('y la reversión tampoco la toca', (await serial(idAjeno)) != null);

  // Sin serialId, la reversión cae al camino viejo (buscar por IMEI) — pero
  // acotada al negocio. La consulta anterior era `WHERE s.imei = $1` a secas.
  const res = await revertirIngresoSerial(cli, { negocioId: 1, imei: '888888888888888' });
  checkEq('sin rastro no encuentra nada que borrar en este negocio', res, 'sin_cambio');
  checkEq('el equipo del negocio 2 sigue ahí',
    Number((await serial(idAjeno)).costo_compra), 777777);
}

// ── 7. La aritmética del caso completo ──────────────────────────────────────
console.log('\n7) El caso del usuario, con la cifra de utilidad');
{
  const { rows } = await db.query(
    `INSERT INTO seriales(producto_id, imei, costo_compra, vendido, fecha_salida)
     VALUES (100, 'CASO0000000001', 600000, true, '2026-05-07') RETURNING id`);
  const id = rows[0].id;

  await ingresarSerialRetomado(cli, {
    negocioId: 1, sucursalId: 10, imei: 'CASO0000000001',
    productoSerialId: 101, valorRetoma: 400000, precioVenta: 500000, clienteOrigen: 'Gonzalo',
  });

  const costo = Number((await serial(id)).costo_compra);
  const reventa = 500000;
  checkEq('el costo con el que se valorará la reventa', costo, 400000);
  checkEq('utilidad de la reventa = 100.000', reventa - costo, 100000);
  check('y NO los −100.000 que daba con el costo viejo', reventa - costo > 0);
}

// ── 8. Retoma por CANTIDAD — el stock baja a la hoja ────────────────────────
console.log('\n8) Retoma por cantidad — nodo hoja y costo ponderado');
{
  const repo = require(path.join(RAIZ, 'src/modules/prestamos/prestamos.repository.js'));

  await db.exec(`
    INSERT INTO productos_cantidad(id, nombre, stock, costo_unitario, sucursal_id)
      VALUES (300, 'Correa', 0, NULL, 10);
    INSERT INTO atributos_producto(id, producto_id, sucursal_id, valor, stock, costo_unitario)
      VALUES (301, 300, 10, '38MM', 10, 20000), (302, 300, 10, '42MM', 4, 30000);
  `);

  await repo.ajustarStockConHistorialEnTx(cli, {
    producto_id: 300, sucursal_id: 10, atributo_id: 301,
    cantidad: 10, costo_unitario: 30000, cliente_origen: 'Hugo', tipo: 'retoma',
  });

  const atr = async (id) => (await db.query(
    'SELECT stock, costo_unitario FROM atributos_producto WHERE id = $1', [id])).rows[0];
  const a301 = await atr(301);
  const a302 = await atr(302);
  const prod = (await db.query('SELECT stock FROM productos_cantidad WHERE id = 300')).rows[0];

  checkEq('el stock sube en la TALLA, no en el producto', Number(a301.stock), 20);
  // 10 uds a 20.000 + 10 uds a 30.000 = 25.000, ponderado contra el stock de
  // ESA talla. Contra el del producto (14) daría otra cifra.
  checkEq('costo promedio ponderado del nodo', Number(a301.costo_unitario), 25000);
  checkEq('la otra talla no se toca', [Number(a302.stock), Number(a302.costo_unitario)], [4, 30000]);
  checkEq('el producto se RECALCULA como suma de sus tallas', Number(prod.stock), 24);

  const h = (await db.query(
    `SELECT producto_id, atributo_id, cantidad, tipo FROM historial_stock_cantidad ORDER BY id DESC LIMIT 1`)).rows[0];
  checkEq('el historial anota en qué nodo entró',
    [h.producto_id, h.atributo_id, h.cantidad, h.tipo], [300, 301, 10, 'retoma']);

  // Sin nodo, un producto simple sigue comportándose como siempre.
  await db.exec(`INSERT INTO productos_cantidad(id, nombre, stock, costo_unitario, sucursal_id)
                 VALUES (310, 'Estuche', 5, 4000, 10);`);
  await repo.ajustarStockConHistorialEnTx(cli, {
    producto_id: 310, sucursal_id: 10, cantidad: 5, costo_unitario: 6000,
    cliente_origen: 'Hugo', tipo: 'retoma',
  });
  const simple = (await db.query('SELECT stock, costo_unitario FROM productos_cantidad WHERE id = 310')).rows[0];
  checkEq('producto sin variantes: stock y costo en el producto',
    [Number(simple.stock), Number(simple.costo_unitario)], [10, 5000]);
}

// ── 9. Sin la migración, retomar sigue funcionando ──────────────────────────
console.log('\n9) Migración no aplicada — el rastro se apaga, retomar no');
{
  columnas._setRetomaReingresoDisponible(false);
  checkEq('el rastro no se intenta guardar', rastroParaRetoma({ serialId: 1, reactivado: true }), {});

  const { rows } = await db.query(
    `INSERT INTO seriales(producto_id, imei, costo_compra, vendido)
     VALUES (100, 'SINMIGRACION01', 600000, true) RETURNING id`);
  const r = await ingresarSerialRetomado(cli, {
    negocioId: 1, sucursalId: 10, imei: 'SINMIGRACION01',
    productoSerialId: 100, valorRetoma: 350000, clienteOrigen: 'Iván',
  });
  checkEq('el reingreso escribe el costo de hoy igual',
    Number((await serial(rows[0].id)).costo_compra), 350000);
  check('y la reactivación se detecta igual', r.reactivado === true);
  columnas._setRetomaReingresoDisponible(true);

  const conRastro = rastroParaRetoma(r);
  check('con la migración, el rastro sí viaja',
    conRastro.serial_id === r.serialId && conRastro.reactivado === true
    && typeof conRastro.estado_anterior === 'string');
}

console.log('\n──────────────────────────────────────────────────────────────');
console.log(fallos ? `✗ ${fallos} FALLARON · ${pasados} pasaron`
                   : `✓ TODO OK — ${pasados} verificaciones`);
process.exit(fallos ? 1 : 0);
