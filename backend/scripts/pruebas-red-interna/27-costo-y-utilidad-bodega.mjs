// ─────────────────────────────────────────────────────────────────────────────
// LAS DOS PUNTAS DEL MISMO NEGOCIO — contra un Postgres real (PGlite).
//
// La bodega le compra a un proveedor y le despacha al local por encima de ese
// costo. Eso parte la operación en dos utilidades que hay que reportar por
// separado, y hasta ahora ninguna de las dos salía bien del todo:
//
//   · EL LOCAL: su costo es el `valor_interno` de la remisión. Las VENTAS ya lo
//     usaban (suite 23), pero el VALOR DEL INVENTARIO seguía valorando su
//     vitrina al costo de la bodega — subvaluando justo la mercancía que, con
//     el modelo "el envío es la deuda", ya le debe.
//   · LA BODEGA: despachar ES venderle al local, pero no hay factura de por
//     medio, así que esa venta no aparecía en ningún reporte. Su inventario
//     salía y su utilidad no subía un peso: el margen del grupo se perdía en el
//     camino entre las dos sucursales.
//
// Cubre:
//   · el inventario del local se valora al valor interno, y la bodega al suyo
//   · una unidad consignada SIN costo de compra ya no se acusa de "sin costo"
//   · el costo de una unidad consignada no se puede pisar desde el local
//   · la utilidad de la bodega = valor interno − lo que le costó a ella
//   · una devolución baja esa venta; una remisión anulada no cuenta
//   · un negocio SIN red interna no cambia en nada
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
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260725_red_interna.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260726_red_interna_v2.sql'), 'utf8'));
// Las dos columnas que este reporte necesita en la línea: lo devuelto de un
// lote y el costo que tenía la bodega al despacharlo.
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260823_remision_variantes.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260823_lotes_cantidad.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260824_costo_origen_remision.sql'), 'utf8'));

const conectar = (t) => ({ query: (text, params) => t.query(text, params ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] = {
  id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} },
};

const reportes = require(path.join(RAIZ, 'src/modules/reportes/reportes.service.js'));

let fallos = 0, pasados = 0;
const money = (n) => (n == null ? 'null' : '$' + Math.round(Number(n)).toLocaleString('es-CO'));
function check(nombre, real, esperado) {
  const ok = real == null && esperado == null
    ? true
    : (real != null && esperado != null && Math.abs(Number(real) - Number(esperado)) < 1);
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}: ${money(real)}${ok ? '' : `  ← esperaba ${money(esperado)}`}`);
  ok ? pasados++ : fallos++;
}
function checkTexto(nombre, real, esperado) {
  const ok = String(real) === String(esperado);
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}: ${real}${ok ? '' : `  ← esperaba ${esperado}`}`);
  ok ? pasados++ : fallos++;
}

// ── Escenario ───────────────────────────────────────────────────────────────
// Negocio 1 CON red: bodega (suc 1) + local (suc 2).  Negocio 2 SIN red (suc 3).
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Con Red'), ('Sin Red');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Bodega'),(1,'Local'),(2,'Unica');
  INSERT INTO config_negocio VALUES (1,'red_interna_activa','1'), (1,'red_interna_bodega_id','1');

  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id) VALUES
    ('iPhone 13','Apple','128GB', 2500000, 1),   -- id 1  bodega
    ('iPhone 13','Apple','128GB', 2500000, 2),   -- id 2  local
    ('Moto G','Motorola','64GB',   700000, 3);   -- id 3  negocio sin red

  -- Todo en STOCK (sin vender, sin prestar): esto es valorización de vitrina.
  INSERT INTO seriales (id, producto_id, imei, costo_compra) VALUES
    (1, 2,'IMEI-CONSIGNADO', 1800000),  -- vino de bodega: se lo pasaron a 2.000.000
    (2, 2,'IMEI-PROPIO',     1500000),  -- retoma del local: es suyo
    (3, 2,'IMEI-SIN-COSTO',     NULL),  -- vino de bodega SIN costo registrado allá
    (4, 1,'IMEI-BODEGA',     1700000),  -- lo que la bodega tiene para despachar
    (5, 3,'IMEI-SINRED',      500000);  -- negocio sin red
  SELECT setval('seriales_id_seq', 5);

  -- Entrega recibida: los dos consignados del local
  INSERT INTO remisiones (id, negocio_id, numero, tipo, sucursal_origen_id, sucursal_destino_id,
                          estado, fecha_emision, fecha_recepcion)
    VALUES (1, 1, 1, 'entrega', 1, 2, 'Recibida', '2026-06-01', '2026-06-02');
  INSERT INTO lineas_remision (remision_id, tipo, serial_id, imei, cantidad, valor_interno,
                               costo_origen, estado_linea, nombre_producto) VALUES
    (1,'serial',1,'IMEI-CONSIGNADO',1, 2000000, 1800000,'Recibida','iPhone 13'),
    (1,'serial',3,'IMEI-SIN-COSTO', 1,  900000,    NULL,'Recibida','iPhone 13');
  SELECT setval('remisiones_id_seq', 1);
`);

console.log('\n═══ 1. El inventario del LOCAL se valora al valor interno ═══');
const invLocal = await reportes.getValorInventario(2);
check('★ 3 equipos: 2.000.000 (bodega) + 1.500.000 (propio) + 900.000 (bodega)',
  invLocal.serial.costo_total, 4400000);
console.log('    (antes daba 3.300.000: los dos de bodega al costo de ELLA, uno de ellos en $0)');
check('De la bodega: los dos consignados, a su valor interno',
  invLocal.serial.costo_bodega, 2900000);
checkTexto('Unidades que son de la bodega', invLocal.serial.unidades_bodega, 2);

console.log('\n═══ 2. Una unidad consignada NO es una unidad "sin costo" ═══');
checkTexto('El contador de sin costo queda en cero', invLocal.serial.sin_costo, 0);
checkTexto('★ IMEI-SIN-COSTO no aparece en la lista para corregir',
  invLocal.sin_costo_items.filter((i) => i.imei === 'IMEI-SIN-COSTO').length, 0);
console.log('    (tiene costo: el valor de la remisión. Mandarlo a "corregir" hacía');
console.log('     que el local escribiera sobre el costo de compra de la bodega)');

console.log('\n═══ 3. La BODEGA y un negocio sin red valoran con su propio costo ═══');
const invBodega = await reportes.getValorInventario(1);
check('★ La bodega usa costo_compra, no el valor que le cobra al local',
  invBodega.serial.costo_total, 1700000);
checkTexto('Y no marca nada como "de bodega"', invBodega.serial.unidades_bodega, 0);
const invSinRed = await reportes.getValorInventario(3);
check('★ Negocio sin red interna: igual que siempre', invSinRed.serial.costo_total, 500000);

console.log('\n═══ 4. El costo de una unidad consignada no se pisa desde el local ═══');
let bloqueado = null;
try {
  await reportes.actualizarCostoCompra(2, 'serial', 'IMEI-CONSIGNADO', null, 999999);
} catch (err) { bloqueado = err; }
checkTexto('★ Rechazado con 409', bloqueado?.status, 409);
checkTexto('Con código propio para la pantalla', bloqueado?.code, 'COSTO_DE_BODEGA');
const { rows: intacto } = await db.query(`SELECT costo_compra FROM seriales WHERE id = 1`);
check('★ El costo de la bodega quedó intacto', intacto[0].costo_compra, 1800000);

const okPropio = await reportes.actualizarCostoCompra(2, 'serial', 'IMEI-PROPIO', null, 1600000);
checkTexto('Una unidad PROPIA del local sí se corrige', okPropio.nuevo_costo, 1600000);

console.log('\n═══ 5. La utilidad de la BODEGA por lo que despacha ═══');
const ventasB = await reportes.getVentasALocales(1, '2026-06-01', '2026-06-30');
check('Le vendió al local (valor interno de lo recibido)', ventasB.resumen.valor_total, 2900000);
check('★ Su costo: 1.800.000 del que sí lo tenía', ventasB.resumen.costo_total, 1800000);
check('★ Utilidad de la bodega = 2.000.000 − 1.800.000', ventasB.resumen.utilidad_total, 200000);
checkTexto('El envío con una línea sin costo no infla la utilidad: se aparta',
  ventasB.resumen.envios_sin_costo, 1);

console.log('\n═══ 6. El LOCAL no reporta ventas a locales ═══');
checkTexto('★ getVentasALocales del local → null', await reportes.getVentasALocales(2, '2026-01-01', '2026-12-31'), null);
checkTexto('★ Negocio sin red → null', await reportes.getVentasALocales(3, '2026-01-01', '2026-12-31'), null);

console.log('\n═══ 7. Mercancía por CANTIDAD: se cobra lo que quedó, a su costo ═══');
await db.exec(`
  INSERT INTO productos_cantidad (id, nombre, stock, costo_unitario, precio, sucursal_id) VALUES
    (1,'Cargador', 100, 7000, 15000, 1),
    (2,'Cargador',   5, 10000, 15000, 2);
  SELECT setval('productos_cantidad_id_seq', 2);

  INSERT INTO remisiones (id, negocio_id, numero, tipo, sucursal_origen_id, sucursal_destino_id,
                          estado, fecha_emision, fecha_recepcion)
    VALUES (2, 1, 2, 'entrega', 1, 2, 'Recibida', '2026-06-10', '2026-06-11');
  -- 5 despachados a 10.000, con costo de bodega 7.000; el local devolvió 2.
  INSERT INTO lineas_remision (remision_id, tipo, producto_origen_id, producto_destino_id,
                               cantidad, cantidad_recibida, cantidad_devuelta,
                               valor_interno, costo_origen, estado_linea, nombre_producto)
    VALUES (2,'cantidad',1,2, 5, 5, 2, 10000, 7000,'Recibida','Cargador');
`);
const ventasC = await reportes.getVentasALocales(1, '2026-06-10', '2026-06-30');
check('★ Vendió 3, no 5: lo devuelto sale del cargo y de la venta',
  ventasC.resumen.valor_total, 30000);
check('★ Su costo son esas mismas 3 unidades', ventasC.resumen.costo_total, 21000);
check('★ Utilidad = 3 × (10.000 − 7.000)', ventasC.resumen.utilidad_total, 9000);
console.log('    (el costo sale del `costo_origen` congelado: el promedio ponderado');
console.log('     del nodo en la bodega ya se movió con la siguiente compra)');

console.log('\n═══ 8. Una remisión anulada no le vendió nada a nadie ═══');
await db.exec(`UPDATE remisiones SET estado = 'Anulada' WHERE id = 2;`);
const ventasAnulada = await reportes.getVentasALocales(1, '2026-06-10', '2026-06-30');
checkTexto('★ Anulada → no queda venta en el período', ventasAnulada, null);

console.log(`\n${'═'.repeat(72)}`);
console.log(`  ${pasados} verificaciones pasaron · ${fallos} fallaron`);
console.log('═'.repeat(72));
process.exit(fallos ? 1 : 0);
