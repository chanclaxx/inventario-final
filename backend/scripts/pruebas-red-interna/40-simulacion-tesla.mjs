// ─────────────────────────────────────────────────────────────────────────────
// SIMULACIÓN DE LA RED INTERNA DE TESLA — contra un Postgres real (PGlite).
//
// Reproduce el montaje EXACTO del negocio 33 «Tesla SmartPhone Shop»: una
// bodega (BODEGA LAS AMERICAS) que surte a tres locales, con su misma
// configuración —variantes, código escaneable, `costos_solo_admin`, pedidos— y
// con productos, costos y precios REALES de la plantilla que se importó.
//
// LA PREGUNTA QUE RESPONDE, que es la que se hizo al pedirla:
//
//   ¿LOS COSTOS SE SOLAPAN?  No. Y aquí está el porqué, ejecutable:
//
//     · La bodega compra a $3.700 y despacha a $4.600.
//     · $3.700 es el costo de la BODEGA y nunca sale de ella: `costo_origen` lo
//       fotografía en la línea y el catálogo del local ni lo selecciona.
//     · $4.600 es el costo del LOCAL — el `valor_interno` de la línea — y es
//       contra ese, y solo ese, que se mide la utilidad de su venta.
//     · La misma unidad produce DOS utilidades que no se pisan: la de la bodega
//       ($900) y la del local (venta − $4.600).
//
//   ¿LOS REPORTES SE DAN BIEN?  El inventario de cada punta se valora con SU
//   costo, la utilidad de la bodega se realiza cuando el local PAGA (no cuando
//   recibe), y la deuda cuadra con la suma de sus documentos.
//
// Requiere PGlite (no va en package.json a propósito):
//   npm install --no-save @electric-sql/pglite
//   node scripts/pruebas-red-interna/40-simulacion-tesla.mjs
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
for (const m of ['20260725_red_interna.sql', '20260726_red_interna_v2.sql',
                 '20260822_red_interna_envios.sql', '20260823_red_interna_control.sql',
                 '20260823_red_interna_cargos_pagables.sql',
                 '20260823_remision_variantes.sql', '20260823_lotes_cantidad.sql',
                 '20260823_valor_acreditado.sql', '20260824_costo_origen_remision.sql',
                 '20260904_pedidos_internos.sql']) {
  await db.exec(readFileSync(path.join(RAIZ, '../migrations', m), 'utf8'));
}

const conectar = (t) => ({ query: (text, params) => t.query(text, params ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] = {
  id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} },
};

const columnas = require(path.join(RAIZ, 'src/config/columnas.js'));
await columnas.detectarColumnas();
if (!columnas.hayPedidosInternos()) {
  console.error('✗ la detección de columnas no encontró los pedidos internos');
  process.exit(1);
}

const red      = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));
const pedidos  = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.pedidos.service.js'));
const reportes = require(path.join(RAIZ, 'src/modules/reportes/reportes.service.js'));

let fallos = 0, pasados = 0;
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const money = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('es-CO');
function check(nombre, real, esperado) {
  const ok_ = JSON.stringify(real) === JSON.stringify(esperado);
  console.log(`  ${ok_ ? '✓' : '✗'} ${nombre}: ${JSON.stringify(real)}${ok_ ? '' : `  <- esperaba ${JSON.stringify(esperado)}`}`);
  ok_ ? pasados++ : fallos++;
}
function ok(nombre, cond, detalle = '') {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ': ' + detalle : ''}`);
  cond ? pasados++ : fallos++;
}
const falla = async (nombre, fn, esperado) => {
  try { await fn(); ok(nombre, false, 'no lanzó'); }
  catch (e) {
    const texto = `${e.codigo || ''} ${e.message || ''}`.toLowerCase();
    ok(nombre, texto.includes(String(esperado).toLowerCase()), e.message || e.codigo);
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// EL MONTAJE DE TESLA, con datos de la plantilla real.
//
//   producto                     atributo  stock   costo   precio (al local)
//   360 NEGRO                    38MM         15   3.700    4.600
//   360 NEGRO                    40MM         19   3.700    4.600
//   45W SAMSUNG ORIGINAL         NEGRO        63  40.000   48.000
//   45W SAMSUNG ORIGINAL PACHA   NEGRO        45  40.000   48.000  <- el caso PACHA
//   25W SAMSUNG ORIGINAL         (plano)      40  35.000   42.000
// ═════════════════════════════════════════════════════════════════════════════
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Tesla SmartPhone Shop');
  INSERT INTO sucursales (negocio_id, nombre) VALUES
    (1,'BODEGA LAS AMERICAS'),
    (1,'TESLA SMARTPHONESHOP'),
    (1,'BUNNY MOBILE'),
    (1,'Sucursal Camilo');
  INSERT INTO usuarios (nombre) VALUES
    ('Admin Tesla'),('Bodeguero'),('Vendedor Tesla'),('Vendedor Bunny');
  INSERT INTO config_negocio VALUES
    (1,'red_interna_activa','1'), (1,'red_interna_bodega_id','1'),
    (1,'variantes_activo','1'),   (1,'codigo_producto_activo','1'),
    (1,'costos_solo_admin','1'),  (1,'tarifas_activo','0'),
    (1,'ubicacion_activa','1');
  INSERT INTO lineas_producto (negocio_id, nombre) VALUES
    (1,'ACCESORIOS APPLE WATCH'), (1,'CARGADORES'), (1,'PACHAS');

  -- BODEGA. Su costo es lo que el local nunca debe ver.
  INSERT INTO productos_cantidad (sucursal_id, nombre, stock, costo_unitario, precio, linea_id, unidad_medida, codigo) VALUES
    (1,'360 NEGRO',                   34, 3700,  4600,  1, 'unidad', NULL),
    (1,'45W SAMSUNG ORIGINAL',        63, 40000, 48000, 2, 'unidad', NULL),
    (1,'45W SAMSUNG ORIGINAL PACHA',  45, 40000, 48000, 3, 'unidad', NULL),
    (1,'25W SAMSUNG ORIGINAL',        40, 35000, 42000, 2, 'unidad', 'CAR-25W-006');
  INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock, costo_unitario, precio, codigo) VALUES
    (1,1,'38MM',15,3700,4600,'ACC-360-38M-001'),
    (1,1,'40MM',19,3700,4600,'ACC-360-40M-002'),
    (2,1,'NEGRO',63,40000,48000,'CAR-45W-NEG-011'),
    (3,1,'NEGRO',45,40000,48000,'PAC-45W-NEG-011');

  -- LOCALES: catálogo replicado, SIN stock, SIN costo, SIN precio.
  -- Es exactamente como están hoy las sucursales 48 y 49 en producción.
  INSERT INTO productos_cantidad (sucursal_id, nombre, stock, costo_unitario, precio, linea_id, unidad_medida) VALUES
    (2,'360 NEGRO',            0, NULL, NULL, 1, 'unidad'),
    (2,'45W SAMSUNG ORIGINAL', 0, NULL, NULL, 2, 'unidad'),
    (3,'360 NEGRO',            0, NULL, NULL, 1, 'unidad');
  INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock, costo_unitario) VALUES
    (5,2,'38MM',0,NULL),
    (5,2,'40MM',0,NULL),
    (6,2,'NEGRO',0,NULL),
    (7,3,'38MM',0,NULL);
`);

const RED = {
  activa: true, bodega_id: 1, modo_precio: 'costo',
  confirmar_recepcion: true, confirmar_remesa: true, ocultar_costos: true,
  pedidos: true,
};
const admin = { user: { id: 1, negocio_id: 1, rol: 'admin_negocio' }, sucursal_id: 1, esBodega: true,  red: RED };
const tesla = { user: { id: 3, negocio_id: 1, rol: 'vendedor'      }, sucursal_id: 2, esBodega: false, red: RED };
const bunny = { user: { id: 4, negocio_id: 1, rol: 'vendedor'      }, sucursal_id: 3, esBodega: false, red: RED };

console.log('\n=================================================================');
console.log('  SIMULACION - RED INTERNA DE TESLA SMARTPHONE SHOP');
console.log('=================================================================');

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== 1. El local mira el catálogo de la bodega - y NO ve costos ===');
// Es la primera fuga posible: el costo de la bodega es exactamente lo que
// `costos_solo_admin` esconde, y recortarlo solo en la pantalla lo dejaría
// viajando en el JSON, visible desde la consola del navegador.

const catalogo = await pedidos.catalogo(tesla, '');
const jsonCat = JSON.stringify(catalogo);
ok('* ni un costo ni un precio viaja en el JSON del catálogo',
  !/costo|valor_interno|precio/i.test(jsonCat));
ok('lista nodos HOJA (las tallas), no el contenedor',
  catalogo.some((c) => c.variante_label === '38MM')
  && !catalogo.some((c) => c.nombre === '360 NEGRO' && !c.atributo_id));
ok('el producto PLANO sí se lista entero (no tiene tallas)',
  catalogo.some((c) => c.nombre === '25W SAMSUNG ORIGINAL' && !c.atributo_id));
// El Excel traía «45W SAMSUNG ORIGINAL» en dos líneas (CARGADORES y PACHAS).
// Sin el sufijo colapsarían en un solo producto —productos_cantidad es único
// por (nombre, sucursal_id)— y el local no podría pedir el cubo por separado.
const pachas = catalogo.filter((c) => /45W SAMSUNG ORIGINAL/.test(c.nombre_base));
ok('* el caso PACHA quedó separado: dos referencias distintas',
  pachas.length === 2
  && new Set(pachas.map((c) => c.nombre_base)).size === 2
  && new Set(pachas.map((c) => c.linea_nombre)).size === 2,
  pachas.map((c) => `${c.nombre_base} [${c.linea_nombre}]`).join(' · '));

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== 2. El local PIDE - bajando a la variante ===');

const pedido = await pedidos.crear(tesla, {
  notas: 'Reposición fin de semana',
  lineas: [
    { tipo: 'cantidad', producto_id: 1, atributo_id: 1, cantidad_pedida: 10 },
    { tipo: 'cantidad', producto_id: 1, atributo_id: 2, cantidad_pedida: 5 },
    { tipo: 'cantidad', producto_id: 2, atributo_id: 3, cantidad_pedida: 4 },
    { tipo: 'cantidad', producto_id: 4, cantidad_pedida: 3 },
  ],
});
check('el pedido nace Enviado', pedido.estado, 'Enviado');
check('unidades pedidas', Number(pedido.unidades_pedidas), 22);
const ficha0 = await pedidos.getPedido(tesla, pedido.id);
check('la línea con talla congela su etiqueta', ficha0.lineas[0].nombre_producto, '360 NEGRO / 38MM');
ok('* un VENDEDOR pudo pedir (pedir no compromete un peso)', pedido.id > 0);

const bandeja = await pedidos.listar(admin, { abiertos: true });
check('la bodega lo ve en su bandeja', bandeja.length, 1);
check('y sabe cuántas unidades faltan', Number(bandeja[0].unidades_pendientes), 22);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== 3. La bodega DESPACHA - al precio del Excel, que será el costo del local ===');
// Aquí nace la separación de costos: el `valor_interno` que la bodega escribe
// (4.600) es el PRECIO de la plantilla, no su costo (3.700).

const envio = await red.despachar(admin, {
  sucursal_destino_id: 2,
  pedido_id: pedido.id,
  lineas: [
    { tipo: 'cantidad', producto_id: 1, atributo_id: 1, cantidad: 10, valor_interno: 4600 },
    { tipo: 'cantidad', producto_id: 1, atributo_id: 2, cantidad: 5,  valor_interno: 4600 },
    { tipo: 'cantidad', producto_id: 2, atributo_id: 3, cantidad: 4,  valor_interno: 48000 },
    { tipo: 'cantidad', producto_id: 4, cantidad: 3, valor_interno: 42000 },
  ],
});
check('la remisión queda enlazada al pedido', Number(envio.pedido_id), pedido.id);

const lineasEnvio = await q(
  `SELECT id, nombre_producto, cantidad, valor_interno, costo_origen, pedido_linea_id
   FROM lineas_remision WHERE remision_id = $1 ORDER BY id`, [envio.id]);
ok('* las 4 líneas se atribuyeron solas al pedido',
  lineasEnvio.every((l) => l.pedido_linea_id != null));
ok('* el nombre de la línea lleva la TALLA (dos líneas del mismo producto)',
  lineasEnvio[0].nombre_producto === '360 NEGRO / 38MM'
  && lineasEnvio[1].nombre_producto === '360 NEGRO / 40MM');

console.log('\n  -- la doble contabilidad de cada línea --');
for (const l of lineasEnvio) {
  console.log(`     ${String(l.nombre_producto).padEnd(30)} ${String(l.cantidad).padStart(3)} u`
    + `   costo bodega ${money(l.costo_origen).padStart(9)}`
    + `  ->  costo local ${money(l.valor_interno).padStart(9)}`);
}
ok('* costo_origen guarda lo que le costó A LA BODEGA (3.700)',
  Number(lineasEnvio[0].costo_origen) === 3700, money(lineasEnvio[0].costo_origen));
ok('* valor_interno guarda lo que le cuesta AL LOCAL (4.600)',
  Number(lineasEnvio[0].valor_interno) === 4600, money(lineasEnvio[0].valor_interno));
ok('* los dos números conviven en la MISMA fila sin pisarse',
  Number(lineasEnvio[0].costo_origen) !== Number(lineasEnvio[0].valor_interno));

let f = await pedidos.getPedido(admin, pedido.id);
check('el pedido queda despachado entero', f.avance, 'Despachado');

// Con `confirmar_recepcion` activo el stock NO sale al despachar: la mercancía
// sigue siendo de la bodega hasta que alguien del local confirma que llegó.
// Descontarla antes la haría desaparecer de las dos puntas mientras viaja.
const stockEnTransito = await q(
  `SELECT a.valor, a.stock FROM atributos_producto a WHERE a.producto_id=1 ORDER BY a.id`);
ok('* despachar NO baja el stock todavía (la recepción está por confirmar)',
  Number(stockEnTransito[0].stock) === 15 && Number(stockEnTransito[1].stock) === 19,
  `38MM=${stockEnTransito[0].stock} 40MM=${stockEnTransito[1].stock}`);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== 4. El local RECIBE - y ahí nace la deuda ===');

await red.recibir(tesla, envio.id, {});
const CARGO = 10 * 4600 + 5 * 4600 + 4 * 48000 + 3 * 42000;
console.log(`  cargo esperado: 15x4.600 + 4x48.000 + 3x42.000 = ${money(CARGO)}`);

let cuenta = await red.getEstadoCuenta(tesla, 2);
const env = () => cuenta.envios.find((e) => Number(e.id) === Number(envio.id));
check('el envío quedó Recibida',
  (await q(`SELECT estado FROM remisiones WHERE id=$1`, [envio.id]))[0].estado, 'Recibida');
ok('* la deuda del local = la suma de los valores internos',
  Number(env().cargo) === CARGO, money(env().cargo));
ok('* y el saldo nace igual al cargo (nada abonado)',
  Number(env().saldo) === CARGO, money(env().saldo));

// Ahora sí: el stock salió de la HOJA, no del contenedor.
const stockBodega = await q(
  `SELECT a.valor, a.stock FROM atributos_producto a WHERE a.producto_id=1 ORDER BY a.id`);
check('recibido, la 38MM baja de 15 a 5', Number(stockBodega[0].stock), 5);
check('y la 40MM de 19 a 14', Number(stockBodega[1].stock), 14);
const prodBodega = await q(`SELECT stock FROM productos_cantidad WHERE id=1`);
ok('* el producto se recalculó como la SUMA de sus tallas (5+14=19)',
  Number(prodBodega[0].stock) === 19, String(prodBodega[0].stock));

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== 5. * LOS COSTOS NO SE SOLAPAN - la comprobación central ===');

const costosLocal = await q(`
  SELECT p.nombre, a.valor, a.stock, a.costo_unitario
  FROM atributos_producto a JOIN productos_cantidad p ON p.id=a.producto_id
  WHERE p.sucursal_id=2 ORDER BY a.id`);
const costosBodega = await q(`
  SELECT p.nombre, a.valor, a.stock, a.costo_unitario
  FROM atributos_producto a JOIN productos_cantidad p ON p.id=a.producto_id
  WHERE p.sucursal_id=1 ORDER BY a.id`);

console.log('\n  BODEGA (lo que le costó a ella):');
costosBodega.forEach((c) => console.log(
  `     ${(c.nombre + ' / ' + c.valor).padEnd(32)} ${String(c.stock).padStart(3)} u x ${money(c.costo_unitario)}`));
console.log('  LOCAL (lo que le cuesta a él = valor interno):');
costosLocal.forEach((c) => console.log(
  `     ${(c.nombre + ' / ' + c.valor).padEnd(32)} ${String(c.stock).padStart(3)} u x ${money(c.costo_unitario)}`));

const l38 = costosLocal.find((c) => c.valor === '38MM');
const b38 = costosBodega.find((c) => c.valor === '38MM');
ok('* el local quedó costeado al VALOR INTERNO (4.600), no al costo de bodega',
  Number(l38.costo_unitario) === 4600, money(l38.costo_unitario));
ok('* la bodega CONSERVA su costo real (3.700) - no se le pisó nada',
  Number(b38.costo_unitario) === 3700, money(b38.costo_unitario));
ok('* el stock se movió de una punta a la otra sin duplicarse (15 = 5 + 10)',
  Number(b38.stock) === 5 && Number(l38.stock) === 10);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== 6. El VALOR DEL INVENTARIO - cada punta con SU costo ===');

const invBodega = await reportes.getValorInventario(1);
const invLocal  = await reportes.getValorInventario(2);
const totB = Number(invBodega.totales.costo_total);
const totL = Number(invLocal.totales.costo_total);
console.log(`  bodega: ${money(totB)}    local: ${money(totL)}`);
const ESPERADO_BODEGA = 5 * 3700 + 14 * 3700 + 59 * 40000 + 45 * 40000 + 37 * 35000;
ok('* la bodega se valora a SU costo',
  totB === ESPERADO_BODEGA, `${money(totB)} vs ${money(ESPERADO_BODEGA)}`);
ok('* el local se valora al valor interno - justo lo que ya debe',
  totL === CARGO, `${money(totL)} vs ${money(CARGO)}`);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== 7. La UTILIDAD DE LA BODEGA - se realiza cuando el local PAGA ===');

const hoy = (await q(`SELECT CURRENT_DATE::text AS d`))[0].d;
const desde = hoy.slice(0, 8) + '01';
const hasta = hoy;

let vb = await reportes.getVentasALocales(1, desde, hasta);
ok('la bodega tiene el envío como venta al local',
  vb && Number(vb.resumen.valor_total) === CARGO, money(vb?.resumen?.valor_total));
const COSTO_BODEGA_ENVIO = 15 * 3700 + 4 * 40000 + 3 * 35000;
const UTIL_BODEGA = CARGO - COSTO_BODEGA_ENVIO;
console.log(`  le costó ${money(COSTO_BODEGA_ENVIO)} · se lo pasó en ${money(CARGO)} · deja ${money(UTIL_BODEGA)}`);
ok('* su utilidad = valor interno - lo que le costó a ELLA',
  Number(vb.resumen.utilidad_realizada) + Number(vb.resumen.utilidad_pendiente) === UTIL_BODEGA,
  money(Number(vb.resumen.utilidad_realizada) + Number(vb.resumen.utilidad_pendiente)));
ok('* y todavía NO está realizada: el local no ha pagado un peso',
  Number(vb.resumen.utilidad_realizada) === 0, money(vb.resumen.utilidad_realizada));

const PAGO1 = 200000;
const remesa1 = await red.enviarRemesa(tesla, { valor: PAGO1, remision_id: envio.id });
cuenta = await red.getEstadoCuenta(tesla, 2);
ok('* una remesa EN TRÁNSITO no baja la deuda todavía',
  Number(env().saldo) === CARGO, money(env().saldo));
vb = await reportes.getVentasALocales(1, desde, hasta);
ok('* ni realiza utilidad', Number(vb.resumen.utilidad_realizada) === 0);

await red.confirmarRemesa(admin, remesa1.id);
cuenta = await red.getEstadoCuenta(tesla, 2);
ok('confirmada, la deuda baja',
  Number(env().saldo) === CARGO - PAGO1, money(env().saldo));
vb = await reportes.getVentasALocales(1, desde, hasta);
ok('* y ahí sí se realiza utilidad (lo cobrado cubre primero el costo)',
  Number(vb.resumen.utilidad_realizada) === Math.max(0, PAGO1 - COSTO_BODEGA_ENVIO),
  money(vb.resumen.utilidad_realizada));

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== 8. El local VENDE - su utilidad se mide contra el valor interno ===');

await db.exec(`
  INSERT INTO facturas (sucursal_id, usuario_id, nombre_cliente, fecha, estado)
    VALUES (2, 3, 'Cliente mostrador', CURRENT_DATE, 'Activa');
  INSERT INTO lineas_factura (factura_id, nombre_producto, cantidad, precio, producto_id, atributo_id)
    VALUES (1, '360 NEGRO (38MM)', 4, 12000, 5, 5);
  UPDATE atributos_producto SET stock = stock - 4 WHERE id = 5;
  UPDATE productos_cantidad pc SET stock =
    (SELECT COALESCE(SUM(a.stock),0) FROM atributos_producto a WHERE a.producto_id=pc.id AND a.activo)
    WHERE pc.id = 5;
`);

const ventas = await reportes.getVentasRango(2, desde, hasta);
const UTIL_LOCAL = 48000 - 4 * 4600;
console.log(`  vendió 4 x 12.000 = ${money(48000)} · le costaron 4 x 4.600 = ${money(18400)} · deja ${money(UTIL_LOCAL)}`);
ok('* la utilidad del local se mide contra SU costo (4.600), no contra 3.700',
  Number(ventas.resumen.utilidad_neta_total) === UTIL_LOCAL,
  `${money(ventas.resumen.utilidad_neta_total)} vs ${money(UTIL_LOCAL)}`);
const UTIL_SI_SE_SOLAPARAN = 48000 - 4 * 3700;
ok('* NO reporta la utilidad inflada que saldría con el costo de bodega',
  Number(ventas.resumen.utilidad_neta_total) !== UTIL_SI_SE_SOLAPARAN,
  `la inflada sería ${money(UTIL_SI_SE_SOLAPARAN)}`);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== 9. DEVOLUCIÓN - el crédito sale del lote, a SU precio ===');

const devol = await red.devolver(tesla, {
  lineas: [{ tipo: 'cantidad', producto_id: 5, atributo_id: 6, cantidad: 2 }],
  motivo: 'devolucion',
});
await red.confirmarDevolucion(admin, devol.id, {});
cuenta = await red.getEstadoCuenta(tesla, 2);
const CREDITO = 2 * 4600;
ok('* la deuda baja por el valor interno del lote (2 x 4.600)',
  Number(env().cargo) === CARGO - CREDITO, money(env().cargo));
ok('* sin contra-asiento: el cargo se DERIVA, baja solo',
  (await q(`SELECT count(*)::int AS n FROM lineas_remision WHERE remision_id=$1`, [envio.id]))[0].n === 4);
const stockVuelto = await q(`SELECT stock FROM atributos_producto WHERE id=2`);
check('y las 2 unidades volvieron a la bodega (14 -> 16)', Number(stockVuelto[0].stock), 16);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== 10. GASTO del local - no baja la deuda hasta que la bodega lo apruebe ===');

const gasto = await red.registrarGastoAutorizado(tesla, {
  valor: 50000, concepto: 'Transporte de la mercancía',
});
cuenta = await red.getEstadoCuenta(tesla, 2);
const deudaAntesGasto = Number(cuenta.totales.deuda_total);
ok('* el gasto nace «Por aprobar» y NO baja la deuda solo',
  (await q(`SELECT estado FROM movimientos_cuenta_interna WHERE id=$1`, [gasto.id]))[0].estado === 'Por aprobar');

await red.decidirGasto(admin, gasto.id, { aprobar: true });
cuenta = await red.getEstadoCuenta(tesla, 2);
ok('* aprobado por la bodega, ahí sí baja',
  Number(cuenta.totales.deuda_total) === deudaAntesGasto - 50000,
  money(cuenta.totales.deuda_total));

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== 11. INVARIANTE - la deuda cuadra con sus documentos ===');

cuenta = await red.getEstadoCuenta(tesla, 2);
const sumaEnvios = cuenta.envios.reduce((s, e) => s + Number(e.saldo), 0);
const sumaCargos = (cuenta.cargos || []).reduce((s, c) => s + Number(c.saldo), 0);
console.log(`  suma saldo envíos ${money(sumaEnvios)} + cargos ${money(sumaCargos)} = ${money(sumaEnvios + sumaCargos)}`);
console.log(`  deuda_total reportada: ${money(cuenta.totales.deuda_total)}   saldo a favor: ${money(cuenta.totales.saldo_a_favor)}`);
ok('* suma de saldo de TODOS los documentos = deuda_total',
  sumaEnvios + sumaCargos === Number(cuenta.totales.deuda_total),
  `${money(sumaEnvios + sumaCargos)} vs ${money(cuenta.totales.deuda_total)}`);
ok('* si hay saldo a favor, no hay deuda abierta (y viceversa)',
  !(Number(cuenta.totales.saldo_a_favor) > 0 && Number(cuenta.totales.deuda_total) > 0),
  `favor=${money(cuenta.totales.saldo_a_favor)} deuda=${money(cuenta.totales.deuda_total)}`);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== 12. AISLAMIENTO - Bunny no ve ni toca la cuenta de Tesla ===');

const cuentaBunny = await red.getEstadoCuenta(bunny, 3);
check('Bunny no debe nada (no ha recibido nada)', Number(cuentaBunny.totales.deuda_total), 0);
check('y no ve los envíos de Tesla', cuentaBunny.envios.length, 0);
await falla('un local no puede recibir la remisión de otro',
  () => red.recibir(bunny, envio.id, {}), 'otra sucursal');
await falla('la bodega no se pide a sí misma',
  () => pedidos.crear(admin, { lineas: [{ tipo: 'cantidad', producto_id: 1, cantidad_pedida: 1 }] }), 'sí misma');
await falla('no se puede despachar más de lo que hay',
  () => red.despachar(admin, {
    sucursal_destino_id: 3,
    lineas: [{ tipo: 'cantidad', producto_id: 1, atributo_id: 1, cantidad: 9999, valor_interno: 4600 }],
  }), 'stock insuficiente');
await falla('* con variantes activas, una línea sin talla se RECHAZA',
  () => red.despachar(admin, {
    sucursal_destino_id: 3,
    lineas: [{ tipo: 'cantidad', producto_id: 1, cantidad: 1, valor_interno: 4600 }],
  }), 'variante');

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== 13. El vendedor del local NO ve la valorización de la bodega ===');

const panelVendedor = await red.getPanelLocal(tesla);
const jsonPanel = JSON.stringify(panelVendedor);
ok('* el recorte va en el BACKEND: no viaja el costo de la bodega en el JSON',
  !/"costo_origen"/.test(jsonPanel) && !/\b3700\b/.test(jsonPanel),
  /\b3700\b/.test(jsonPanel) ? 'FUGA: aparece 3700' : 'limpio');

// ═════════════════════════════════════════════════════════════════════════════
console.log(`\n${'='.repeat(70)}`);
console.log(`RESULTADO: ${pasados} pasadas, ${fallos} fallidas`);
console.log('='.repeat(70));
process.exit(fallos ? 1 : 0);
