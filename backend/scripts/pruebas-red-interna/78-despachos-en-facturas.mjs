// ─────────────────────────────────────────────────────────────────────────────
// LOS DESPACHOS A LOS LOCALES EN EL HISTORIAL DE FACTURAS (pedido del usuario,
// 9-oct-2026: «que el envío salga donde están todas las demás facturas, pero
// con cuidado de que los reportes no se dañen»).
//
// La decisión que protege los reportes: el despacho se LEE de `remisiones` y
// viaja aparte (`despachos`), nunca como fila de `facturas`. Todos los reportes
// suman `facturas`/`lineas_factura`, y el despacho ya se cuenta por su lado
// (grupo «Red interna» de Ventas, utilidad al cobrar).
//
//   · Sección 1 — sin red interna: la respuesta es EXACTAMENTE la de siempre
//                 (sin la clave `despachos`), y el buscador responde [].
//   · Sección 2 — ★ despachar no escribe en facturas, lineas_factura ni
//                 pagos_factura, y `items` sigue siendo solo facturas.
//   · Sección 3 — alcance: solo la sede que DESPACHA; el local no lo ve como
//                 factura suya; las devoluciones no salen.
//   · Sección 4 — el valor del envío sigue la lista de quién ve el precio de
//                 los despachos (recortado en el backend).
//   · Sección 5 — sin el módulo red_interna no hay despachos.
//   · Sección 6 — búsqueda: destino, número, producto, IMEI y fechas.
//   · Sección 7 — el scroll no se corta si quedan despachos más viejos.
//   · Sección 8 — ★ la pantalla no suma despachos al total del día (estática).
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
const FRONT = path.resolve(RAIZ, '../frontend/src');

const db = new PGlite();
await db.exec(readFileSync(path.join(AQUI, 'esquema.sql'), 'utf8'));
await db.exec(readFileSync(path.join(AQUI, 'esquema-completo.sql'), 'utf8'));
for (const m of ['20260725_red_interna', '20260726_red_interna_v2', '20260822_red_interna_envios',
  '20260823_red_interna_control', '20260823_red_interna_cargos_pagables', '20260823_remision_variantes',
  '20260823_lotes_cantidad', '20260824_costo_origen_remision', '20260823_valor_acreditado']) {
  await db.exec(readFileSync(path.join(RAIZ, `../migrations/${m}.sql`), 'utf8'));
}
await db.exec(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS negocio_id INT;`);

const conectar = (t) => ({ query: (s, p) => t.query(s, p ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

const service   = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));
const repo      = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.repository.js'));
const redMw     = require(path.join(RAIZ, 'src/middlewares/redInterna.middleware.js'));
const ctrlFac   = require(path.join(RAIZ, 'src/modules/facturas/facturas.controller.js'));
const repoFac   = require(path.join(RAIZ, 'src/modules/facturas/facturas.repository.js'));

let pasados = 0; const fallos = [];
const ok = (nombre, cond, detalle = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos.push(nombre);
};
const seccion = (t) => console.log(`\n═══ ${t} ═══`);

/** Llama un controlador Express y devuelve lo que respondió. */
const llamar = (fn, req) => new Promise((resolve, reject) => {
  const res = {
    statusCode: 200,
    status(c) { this.statusCode = c; return this; },
    json(body) { resolve({ status: this.statusCode, body }); },
  };
  fn(req, res, (err) => (err ? reject(err) : resolve({ status: 500, body: null })));
});

// ── Escenario ───────────────────────────────────────────────────────────────
// Bodega (1) surte a Bunny (2). La bodega también vende al público (factura).
const PRECIO_DESPACHO = 1300000; const PRECIO_CARG = 45000;
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Tesla');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Bodega'),(1,'Bunny Mobile');
  INSERT INTO usuarios (nombre, negocio_id) VALUES ('Admin',1),('Bodeguero',1),('Supervisor Bunny',1);
  INSERT INTO config_negocio VALUES (1,'red_interna_activa','0'),(1,'red_interna_bodega_id','1');
  INSERT INTO lineas_producto (negocio_id, nombre) VALUES (1,'Celulares'),(1,'Accesorios');
  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id, linea_id)
    VALUES ('iPhone 13','Apple','128GB', 2600000, 1, 1);
  INSERT INTO seriales (producto_id, imei, costo_compra) VALUES (1,'IMEI-111', 1000000), (1,'IMEI-222', 1000000);
  INSERT INTO productos_cantidad (nombre, codigo, precio, costo_unitario, stock, sucursal_id, linea_id)
    VALUES ('Cargador 20W','CARG20', 60000, 30000, 50, 1, 2);
  INSERT INTO cuentas_dinero (negocio_id, sucursal_id, nombre, tipo, metodos_pago)
    VALUES (1,1,'Efectivo','efectivo',ARRAY['Efectivo']), (1,2,'Efectivo','efectivo',ARRAY['Efectivo']);
  INSERT INTO aperturas_caja (sucursal_id) VALUES (1),(2);
  -- Una venta de mostrador de la bodega, de hoy.
  INSERT INTO facturas (numero, sucursal_id, usuario_id, nombre_cliente, cedula, estado)
    VALUES (1, 1, 1, 'Cliente de mostrador', '123', 'Activa');
  INSERT INTO lineas_factura (factura_id, nombre_producto, cantidad, precio) VALUES (1, 'Cargador 20W', 1, 60000);
  INSERT INTO pagos_factura (factura_id, metodo, valor) VALUES (1, 'Efectivo', 60000);
`);

const U = {
  admin:     { id: 1, negocio_id: 1, rol: 'admin_negocio' },
  bodeguero: { id: 2, negocio_id: 1, rol: 'supervisor' },
  bunny:     { id: 3, negocio_id: 1, rol: 'supervisor' },
};
const setConfig = async (clave, valor) => {
  await db.query(`DELETE FROM config_negocio WHERE negocio_id = 1 AND clave = $1`, [clave]);
  if (valor !== undefined) await db.query(`INSERT INTO config_negocio VALUES (1,$1,$2)`, [clave, valor]);
  redMw.invalidarCache();
};
const reqRed = async (user, sucursalId) => {
  const red = await redMw.getConfigRed(1);
  return { user, sucursal_id: sucursalId, esBodega: Number(sucursalId) === 1, red, params: {}, query: {} };
};
const reqFac = (user, sucursalId, query = {}) =>
  ({ user, sucursal_id: sucursalId, todasSucursales: false, params: {}, query });
const recientes = async (user, sucursalId, query = {}) =>
  (await llamar(ctrlFac.getFacturasRecientes, reqFac(user, sucursalId, query))).body.data;
const buscar = async (user, sucursalId, query) =>
  (await llamar(ctrlFac.buscarDespachos, reqFac(user, sucursalId, query))).body.data;
const contar = async () => {
  const { rows: [r] } = await db.query(`SELECT
    (SELECT COUNT(*) FROM facturas)::int AS f, (SELECT COUNT(*) FROM lineas_factura)::int AS l,
    (SELECT COUNT(*) FROM pagos_factura)::int AS p`);
  return r;
};

// ═════════════════════════════════════════════════════════════════════════════
seccion('1. Sin red interna: la respuesta es la de siempre');
{
  const data = await recientes(U.admin, 1);
  const crudo = await repoFac.findRecientes(1, 1, { cursor: null, dias: 5 });
  ok('no aparece la clave `despachos`', !('despachos' in data));
  ok('items y cursor idénticos al repositorio', JSON.stringify(data.items) === JSON.stringify(crudo.items)
    && data.siguienteCursor === crudo.siguienteCursor);
  ok('la ventana interna no se filtra a la respuesta', !('ventana' in data));
  const b = await buscar(U.admin, 1, { q: 'cargador' });
  ok('el buscador de despachos responde [] (no 403)', Array.isArray(b) && b.length === 0);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('2. ★ Despachar no escribe en las tablas de ventas');
await setConfig('red_interna_activa', '1');
const antes = await contar();
const envio = await service.despachar(await reqRed(U.admin, 1), {
  sucursal_destino_id: 2,
  lineas: [
    { tipo: 'serial', serial_id: 1, valor_interno: PRECIO_DESPACHO },
    { tipo: 'cantidad', producto_id: 1, cantidad: 4, valor_interno: PRECIO_CARG },
  ],
});
{
  const despues = await contar();
  ok('facturas, lineas_factura y pagos_factura no cambian al despachar',
    JSON.stringify(antes) === JSON.stringify(despues), JSON.stringify(despues));

  const data = await recientes(U.admin, 1);
  ok('items sigue trayendo SOLO la factura', data.items.length === 1 && data.items[0].nombre_cliente === 'Cliente de mostrador');
  ok('el despacho viaja aparte, en `despachos`', data.despachos?.length === 1 && Number(data.despachos[0].id) === Number(envio.id));
  const d = data.despachos[0];
  ok('trae destino, estado, unidades y productos',
    d.sucursal_destino_nombre === 'Bunny Mobile' && d.estado === 'En transito'
    && d.unidades === 5 && /iPhone/.test(d.productos_nombres) && /Cargador/.test(d.productos_nombres),
    `${d.unidades} uds · ${d.productos_nombres}`);
  ok('el admin ve el valor del envío', Number(d.valor_total) === PRECIO_DESPACHO + 4 * PRECIO_CARG);

  // Recibir tampoco toca facturas (genera la deuda, no una venta facturada).
  const lineas = await repo.getLineasRemision(envio.id);
  await service.recibir(await reqRed(U.bunny, 2), envio.id, {
    lineas_recibidas: lineas.map((l) => Number(l.id)),
    cantidades: Object.fromEntries(lineas.filter((l) => l.tipo === 'cantidad').map((l) => [l.id, l.cantidad])),
  });
  ok('recibir tampoco escribe en las tablas de ventas', JSON.stringify(antes) === JSON.stringify(await contar()));
  const data2 = await recientes(U.admin, 1);
  ok('  y el despacho aparece como Recibida', data2.despachos[0].estado === 'Recibida');
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('3. Alcance: solo la sede que despacha');
{
  const local = await recientes(U.bunny, 2);
  ok('el local no ve el envío en SUS facturas', (local.despachos || []).length === 0);
  // Una devolución del local a la bodega no es un despacho.
  await db.query(`INSERT INTO remisiones (negocio_id, numero, tipo, sucursal_origen_id, sucursal_destino_id, estado)
                  VALUES (1, 99, 'devolucion', 2, 1, 'En transito')`);
  const bod = await recientes(U.admin, 1);
  ok('las devoluciones no salen en la bodega', bod.despachos.length === 1);
  const loc2 = await recientes(U.bunny, 2);
  ok('  ni en el local que la mandó', (loc2.despachos || []).length === 0);
  // Otro negocio con la misma numeración no se cuela.
  await db.exec(`INSERT INTO negocios (nombre) VALUES ('Otro');
    INSERT INTO sucursales (negocio_id, nombre) VALUES (2,'Ajena A'),(2,'Ajena B');
    INSERT INTO remisiones (negocio_id, numero, tipo, sucursal_origen_id, sucursal_destino_id, estado)
      VALUES (2, 1, 'entrega', 3, 4, 'En transito');`);
  const bod2 = await recientes(U.admin, 1);
  ok('un despacho de otro negocio no aparece', bod2.despachos.length === 1);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('4. El valor sigue la lista de quién ve el precio de los despachos');
{
  const sin = await recientes(U.bodeguero, 1);
  ok('el bodeguero fuera de la lista NO recibe el valor', sin.despachos.length === 1 && sin.despachos[0].valor_total === null);
  ok('  pero sí ve el despacho (destino y productos)', sin.despachos[0].sucursal_destino_nombre === 'Bunny Mobile');
  await setConfig('red_interna_valores_usuarios', JSON.stringify([U.bodeguero.id]));
  const con = await recientes(U.bodeguero, 1);
  ok('en la lista, lo ve', Number(con.despachos[0].valor_total) === PRECIO_DESPACHO + 4 * PRECIO_CARG);
  const bSin = await buscar({ ...U.bodeguero, id: 99 }, 1, { q: 'bunny' });
  ok('el recorte aplica también al buscador', bSin.length === 1 && bSin[0].valor_total === null);
  await setConfig('red_interna_valores_usuarios', undefined);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('5. Sin el módulo red_interna no hay despachos');
{
  const sinModulo = { ...U.bodeguero, modulos_permitidos: ['facturar', 'inventario'] };
  const data = await recientes(sinModulo, 1);
  ok('recientes: sin la clave `despachos`', !('despachos' in data) && data.items.length === 1);
  ok('buscador: []', (await buscar(sinModulo, 1, { q: 'bunny' })).length === 0);
  await setConfig('red_interna_bodega_id', undefined);
  ok('sin bodega definida tampoco', !('despachos' in await recientes(U.admin, 1)));
  await setConfig('red_interna_bodega_id', '1');
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('6. Búsqueda');
{
  const n = String((await db.query(`SELECT COALESCE(numero, id) AS n FROM remisiones WHERE id = $1`, [envio.id])).rows[0].n);
  for (const [q, esperado] of [['bunny', 1], ['cargador', 1], ['IMEI-111', 1], [n, 1], ['no-existe-xyz', 0]]) {
    const r = await buscar(U.admin, 1, { q });
    ok(`«${q}» → ${esperado}`, r.length === esperado);
  }
  const hoy = (await db.query(`SELECT to_char(NOW(),'YYYY-MM-DD') AS d`)).rows[0].d;
  ok('rango con el día de hoy (hasta incluido)', (await buscar(U.admin, 1, { desde: hoy, hasta: hoy })).length === 1);
  ok('rango que no lo incluye', (await buscar(U.admin, 1, { desde: '2020-01-01', hasta: '2020-01-31' })).length === 0);
  ok('la búsqueda de facturas no trae despachos',
    (await llamar(ctrlFac.buscarFacturas, reqFac(U.admin, 1, { q: 'bunny' }))).body.data.length === 0);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('7. El scroll no se corta si quedan despachos más viejos');
{
  // Un segundo envío de hace 20 días, sin ninguna factura tan vieja.
  const viejo = await service.despachar(await reqRed(U.admin, 1), {
    sucursal_destino_id: 2, lineas: [{ tipo: 'serial', serial_id: 2, valor_interno: PRECIO_DESPACHO }],
  });
  await db.query(`UPDATE remisiones SET fecha_emision = NOW() - INTERVAL '20 days' WHERE id = $1`, [viejo.id]);
  const p1 = await recientes(U.admin, 1);
  ok('la primera página no lo trae', !p1.despachos.some((d) => Number(d.id) === Number(viejo.id)));
  ok('pero deja cursor para seguir', !!p1.siguienteCursor);
  let cursor = p1.siguienteCursor; let encontrado = false;
  for (let i = 0; i < 6 && cursor && !encontrado; i++) {
    const p = await recientes(U.admin, 1, { cursor });
    encontrado = p.despachos.some((d) => Number(d.id) === Number(viejo.id));
    ok(`  página ${i + 2}: ninguna factura repetida`, p.items.length === 0);
    cursor = p.siguienteCursor;
  }
  ok('el despacho viejo aparece al seguir bajando', encontrado);
  const sinRed = await repoFac.findRecientes(1, 1, { cursor: null, dias: 5 });
  ok('el repositorio de facturas solo, sin despachos, sigue cortando como antes', sinRed.siguienteCursor === null);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('8. ★ La pantalla no suma los despachos al total del día (estática)');
{
  const jsx = readFileSync(path.join(FRONT, 'pages/facturas/FacturarPage.jsx'), 'utf8');
  const grupo = jsx.slice(jsx.indexOf('function GrupoDia'), jsx.indexOf('// ─── Panel de búsqueda'));
  ok('GrupoDia separa facturas de despachos antes de sumar',
    /const facturas\s*=\s*registros\.filter\(\(r\) => !r\._despacho\)/.test(grupo)
    && /const totalDia = facturas\.filter/.test(grupo));
  ok('los despachos no tienen editar ni cancelar', !/FilaDespacho[\s\S]*?onEditar/.test(
    jsx.slice(jsx.indexOf('function FilaDespacho'), jsx.indexOf('function GrupoDia'))));
  const reportes = ['reportes/reportes.service.js', 'reportes/asesor.service.js'];
  ok('ningún reporte importa los despachos de Facturas', reportes.every((f) =>
    !readFileSync(path.join(RAIZ, 'src/modules', f), 'utf8').includes('facturas.despachos')));
}

console.log(`\n${pasados} pasaron, ${fallos.length} fallaron`);
if (fallos.length) { console.log('FALLOS:\n - ' + fallos.join('\n - ')); process.exit(1); }
