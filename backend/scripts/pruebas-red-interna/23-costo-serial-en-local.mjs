// ─────────────────────────────────────────────────────────────────────────────
// COSTO DE UN EQUIPO CONSIGNADO EN UN LOCAL — contra un Postgres real (PGlite).
//
// En un local de la red, el costo de un equipo que vino de la bodega NO es
// `seriales.costo_compra` —esa es la verdad del costo de la BODEGA, que a
// propósito nunca se reescribe al remisionar— sino el `valor_interno` de la
// remisión: lo que el local tendrá que liquidarle a la bodega al venderlo.
//
// Los productos por CANTIDAD ya lo resolvían solos (la recepción reescribe
// `productos_cantidad.costo_unitario` con el promedio ponderado sobre
// `valor_interno`). Los seriales no, porque `moverSerial` solo cambia
// `producto_id`. Resultado antes de este arreglo: el local vendía un equipo
// consignado y su utilidad salía contra el costo de la bodega —inflada— mientras
// que la de los accesorios salía bien. El mismo reporte con dos varas de medir.
//
// Cubre:
//   · el LOCAL usa el valor interno de la remisión
//   · la BODEGA sigue usando su propio costo de compra
//   · un negocio SIN red interna no cambia en nada (aditividad)
//   · una unidad PROPIA del local (retoma, compra suya) usa su costo_compra
//   · reenvío con otro valor: manda la entrega más reciente anterior a la venta
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

const conectar = (t) => ({ query: (text, params) => t.query(text, params ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] = {
  id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} },
};

const reportes = require(path.join(RAIZ, 'src/modules/reportes/reportes.service.js'));

let fallos = 0, pasados = 0;
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const money = (n) => (n == null ? 'null' : '$' + Math.round(Number(n)).toLocaleString('es-CO'));
function check(nombre, real, esperado) {
  const ok = real == null && esperado == null
    ? true
    : (real != null && esperado != null && Math.abs(Number(real) - Number(esperado)) < 1);
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}: ${money(real)}${ok ? '' : `  ← esperaba ${money(esperado)}`}`);
  ok ? pasados++ : fallos++;
}

// ── Escenario ───────────────────────────────────────────────────────────────
// Negocio 1 CON red: bodega (suc 1) + local (suc 2).  Negocio 2 SIN red (suc 3).
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Con Red'), ('Sin Red');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Bodega'),(1,'Local'),(2,'Unica');
  INSERT INTO config_negocio VALUES (1,'red_interna_activa','1'), (1,'red_interna_bodega_id','1');

  -- Referencias: la misma en bodega y local (como las crea la recepción)
  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id) VALUES
    ('iPhone 13','Apple','128GB', 2500000, 1),   -- id 1  bodega
    ('iPhone 13','Apple','128GB', 2500000, 2),   -- id 2  local
    ('Moto G','Motorola','64GB',   700000, 3);   -- id 3  negocio sin red

  -- CONSIGNADO: costo de bodega 1.800.000, la bodega lo pasa a 2.000.000
  INSERT INTO seriales (producto_id, imei, costo_compra, vendido) VALUES
    (2,'IMEI-CONSIGNADO', 1800000, true),
  -- PROPIO del local (retoma): nunca vino por remisión
    (2,'IMEI-PROPIO',      1500000, true),
  -- La bodega vende una unidad suya
    (1,'IMEI-BODEGA',      1700000, true),
  -- Negocio sin red
    (3,'IMEI-SINRED',       500000, true);

  -- La remisión que entregó el consignado al local, a 2.000.000
  INSERT INTO remisiones (negocio_id, tipo, sucursal_origen_id, sucursal_destino_id,
                          estado, fecha_emision)
    VALUES (1,'entrega',1,2,'Recibida','2026-06-01');
  INSERT INTO lineas_remision (remision_id, tipo, imei, cantidad, valor_interno, estado_linea, nombre_producto)
    VALUES (1,'serial','IMEI-CONSIGNADO',1, 2000000,'Recibida','iPhone 13');

  -- Ventas (todas después de la entrega)
  INSERT INTO facturas (sucursal_id, fecha, estado, nombre_cliente) VALUES
    (2,'2026-07-01','Activa','Cliente L1'),
    (2,'2026-07-02','Activa','Cliente L2'),
    (1,'2026-07-03','Activa','Cliente B'),
    (3,'2026-07-04','Activa','Cliente S');
  -- subtotal es columna generada (cantidad * precio): no se inserta.
  INSERT INTO lineas_factura (factura_id, nombre_producto, imei, cantidad, precio) VALUES
    (1,'iPhone 13','IMEI-CONSIGNADO',1, 2500000),
    (2,'iPhone 13 Retoma','IMEI-PROPIO',1, 2200000),
    (3,'iPhone 13','IMEI-BODEGA',1, 2400000),
    (4,'Moto G','IMEI-SINRED',1, 900000);
`);

const costoDe = async (sucursal, nombreProducto) => {
  const top = await reportes.getProductosTop(sucursal, '2026-01-01', '2026-12-31');
  return top.find((t) => t.nombre_producto === nombreProducto)?.costo_unitario_promedio ?? null;
};

console.log('\n═══ 1. El LOCAL usa el valor interno, no el costo de la bodega ═══');
check('★ Equipo consignado vendido en el local → costo = valor interno',
  await costoDe(2, 'iPhone 13'), 2000000);
console.log('    (antes del arreglo daba 1.800.000, el costo de la BODEGA,');
console.log('     y la utilidad salía inflada en $200.000 por equipo)');

console.log('\n═══ 2. Una unidad PROPIA del local conserva su costo de compra ═══');
check('Retoma del local → costo_compra, no hay remisión que la respalde',
  await costoDe(2, 'iPhone 13 Retoma'), 1500000);

console.log('\n═══ 3. La BODEGA sigue con su propio costo ═══');
check('★ La bodega vende lo suyo → costo_compra (no se le aplica valor interno)',
  await costoDe(1, 'iPhone 13'), 1700000);

console.log('\n═══ 4. Un negocio SIN red interna no cambia en nada ═══');
check('★ Sin remisiones, el costo es el de siempre',
  await costoDe(3, 'Moto G'), 500000);

console.log('\n═══ 5. Reenviado con otro valor: manda la entrega más reciente ═══');
await db.exec(`
  INSERT INTO remisiones (negocio_id, tipo, sucursal_origen_id, sucursal_destino_id,
                          estado, fecha_emision)
    VALUES (1,'entrega',1,2,'Recibida','2026-06-20');
  INSERT INTO lineas_remision (remision_id, tipo, imei, cantidad, valor_interno, estado_linea, nombre_producto)
    VALUES (2,'serial','IMEI-CONSIGNADO',1, 2100000,'Recibida','iPhone 13');
`);
check('★ Gana la entrega del 20-jun (2.100.000), no la del 1-jun',
  await costoDe(2, 'iPhone 13'), 2100000);

// Una entrega POSTERIOR a la venta no puede cambiar el costo de esa venta.
await db.exec(`
  INSERT INTO remisiones (negocio_id, tipo, sucursal_origen_id, sucursal_destino_id,
                          estado, fecha_emision)
    VALUES (1,'entrega',1,2,'Recibida','2026-09-01');
  INSERT INTO lineas_remision (remision_id, tipo, imei, cantidad, valor_interno, estado_linea, nombre_producto)
    VALUES (3,'serial','IMEI-CONSIGNADO',1, 9990000,'Recibida','iPhone 13');
`);
check('★ Una entrega posterior a la venta NO reescribe esa venta',
  await costoDe(2, 'iPhone 13'), 2100000);

console.log('\n═══ 6. Una remisión anulada o no recibida no cuenta ═══');
await db.exec(`
  UPDATE remisiones SET estado = 'Anulada' WHERE id = 2;
  UPDATE lineas_remision SET estado_linea = 'Pendiente' WHERE remision_id = 1;
`);
check('Sin entrega válida vigente → vuelve al costo_compra',
  await costoDe(2, 'iPhone 13'), 1800000);

console.log(`\n${'═'.repeat(72)}`);
console.log(`  ${pasados} verificaciones pasaron · ${fallos} fallaron`);
console.log('═'.repeat(72));
process.exit(fallos ? 1 : 0);
