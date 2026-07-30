// ─────────────────────────────────────────────────────────────────────────────
// TARIFAS PORCENTUALES × RED INTERNA — contra un Postgres real (PGlite/WASM).
//
// Verifica la decisión de diseño: en un LOCAL la tarifa se calcula sobre el
// VALOR INTERNO de la remisión (lo que le debe a la bodega), no sobre
// `seriales.costo_compra` (que es el costo de la bodega y nunca se reescribe).
//
// Cubre:
//   · la bodega usa su propio costo, el local el valor interno
//   · el override de valor de la bodega manda sobre el costo real
//   · unidades propias del local (retoma / compra propia) no admiten tarifa
//   · una unidad vendida y devuelta como retoma deja de ser consignada
//   · un negocio SIN red interna no ve ninguna clave nueva (aditividad)
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
// `esquema-completo.sql` COMPLEMENTA al anterior (no lo reemplaza): aporta
// prestamos/prestatarios, que la query real de getSeriales necesita para
// resolver `prestado_a`.
await db.exec(readFileSync(path.join(AQUI, 'esquema-completo.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260725_red_interna.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260726_red_interna_v2.sql'), 'utf8'));

const conectar = (t) => ({ query: (text, params) => t.query(text, params ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] = {
  id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} },
};

const service       = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));
const repo          = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.repository.js'));
const serialService  = require(path.join(RAIZ, 'src/modules/productos/productosSerial.service.js'));
const { invalidarCache } = require(path.join(RAIZ, 'src/middlewares/redInterna.middleware.js'));

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
function checkEq(nombre, real, esperado) {
  const ok = real === esperado;
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}: ${JSON.stringify(real)}${ok ? '' : `  ← esperaba ${JSON.stringify(esperado)}`}`);
  ok ? pasados++ : fallos++;
}

// ── Datos base ──────────────────────────────────────────────────────────────
// Negocio 1 CON red interna: bodega (suc 1) + local Centro (suc 2).
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Con Red'), ('Sin Red');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Bodega'),(1,'Centro'),(2,'Unica');
  INSERT INTO usuarios (nombre) VALUES ('Admin'),('Vendedor Centro');
  INSERT INTO config_negocio VALUES
    (1,'red_interna_activa','1'), (1,'red_interna_bodega_id','1'),
    (1,'tarifas_activo','1');
  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id)
    VALUES ('iPhone 13','Apple','128GB', 2600000, 1);      -- id 1, bodega
  INSERT INTO seriales (producto_id, imei, costo_compra) VALUES
    (1,'350000000000001', 1800000),   -- id 1: se despacha al costo
    (1,'350000000000002', 1850000),   -- id 2: se despacha con override
    (1,'350000000000003', 1900000);   -- id 3: se queda en la bodega
  -- Negocio 2, sin red interna
  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id)
    VALUES ('Moto G','Motorola','128GB', 700000, 3);       -- id 2
  INSERT INTO seriales (producto_id, imei, costo_compra) VALUES (2,'990000000000001', 500000);
`);

const reqBodega = {
  user: { id: 1, negocio_id: 1, rol: 'admin_negocio' },
  sucursal_id: 1, esBodega: true,
  red: { activa: true, bodega_id: 1, modo_precio: 'costo',
         confirmar_recepcion: true, confirmar_remesa: true, ocultar_costos: true },
};
const reqCentro = {
  user: { id: 2, negocio_id: 1, rol: 'vendedor' },
  sucursal_id: 2, esBodega: false, red: { ...reqBodega.red },
};

console.log('\n═══ 1. La bodega despacha 2 equipos: uno al costo, uno con valor forzado ═══');
const remision = await service.despachar(reqBodega, {
  sucursal_destino_id: 2,
  lineas: [
    { tipo: 'serial', serial_id: 1 },                          // al costo → 1.800.000
    { tipo: 'serial', serial_id: 2, valor_interno: 2000000 },   // override → 2.000.000
  ],
});
check('Valor total de la remisión', remision.valor_total, 1800000 + 2000000);

const lineas = await repo.getLineasRemision(remision.id);
await service.recibir(reqCentro, remision.id, {
  lineas_recibidas: lineas.map((l) => Number(l.id)),
});
const ubic = await q(`SELECT s.id, ps.sucursal_id FROM seriales s JOIN productos_serial ps ON ps.id=s.producto_id WHERE s.id IN (1,2) ORDER BY s.id`);
checkEq('Los 2 equipos llegaron al local', ubic.every((r) => r.sucursal_id === 2), true);
const costos = await q(`SELECT id, costo_compra FROM seriales WHERE id IN (1,2) ORDER BY id`);
check('★ costo_compra del equipo 1 intacto (verdad de la bodega)', costos[0].costo_compra, 1800000);
check('★ costo_compra del equipo 2 intacto pese al override', costos[1].costo_compra, 1850000);

console.log('\n═══ 2. Base de la tarifa en el LOCAL = valor interno, no costo de compra ═══');
// El producto serial del local es el que resolvió la recepción.
const prodLocal = await q(`SELECT id FROM productos_serial WHERE sucursal_id = 2 LIMIT 1`);
let enLocal = await serialService.getSeriales(1, prodLocal[0].id, false);
const porImei = (lista, imei) => lista.find((s) => s.imei === imei);

check('Equipo despachado al costo → costo_tarifa = 1.800.000',
  porImei(enLocal, '350000000000001').costo_tarifa, 1800000);
check('★ Equipo con override → costo_tarifa = 2.000.000 (no 1.850.000)',
  porImei(enLocal, '350000000000002').costo_tarifa, 2000000);
checkEq('Ambos marcados como mercancía de bodega',
  enLocal.every((s) => s.origen_red === 'bodega'), true);

console.log('\n═══ 3. La BODEGA sigue usando su propio costo (sin claves nuevas) ═══');
const enBodega = await serialService.getSeriales(1, 1, false);
checkEq('La bodega no recibe costo_tarifa', 'costo_tarifa' in enBodega[0], false);
checkEq('La bodega no recibe origen_red',   'origen_red'   in enBodega[0], false);
check('El costo de la bodega es su costo de compra', enBodega[0].costo_compra, 1900000);

console.log('\n═══ 4. Unidad PROPIA del local (retoma) → no admite tarifa ═══');
await db.exec(`
  INSERT INTO seriales (producto_id, imei, costo_compra, cliente_origen)
    VALUES (${prodLocal[0].id}, '350000000000009', 1200000, 'Cliente Retoma');
`);
enLocal = await serialService.getSeriales(1, prodLocal[0].id, false);
const propia = porImei(enLocal, '350000000000009');
checkEq('★ Unidad propia marcada como propio', propia.origen_red, 'propio');
check('★ Unidad propia sin costo_tarifa (null, nunca 0)', propia.costo_tarifa, null);
check('Su costo_compra sigue disponible para reportes', propia.costo_compra, 1200000);

console.log('\n═══ 5. Equipo consignado VENDIDO y devuelto como retoma → deja de ser de bodega ═══');
await db.exec(`
  INSERT INTO facturas (numero, sucursal_id, nombre_cliente, estado, fecha)
    VALUES (1, 2, 'Cliente Contado', 'Activa', NOW());
  INSERT INTO lineas_factura (factura_id, nombre_producto, imei, cantidad, precio)
    VALUES (1, 'iPhone 13', '350000000000001', 1, 2600000);
  -- La retoma reactiva la MISMA fila (así lo hace facturas.service)
  UPDATE seriales SET vendido = FALSE, cliente_origen = 'Volvió en retoma' WHERE id = 1;
`);
enLocal = await serialService.getSeriales(1, prodLocal[0].id, false);
const vuelta = porImei(enLocal, '350000000000001');
checkEq('★ Su ciclo de consignación se cerró → propio', vuelta.origen_red, 'propio');
check('★ Ya no calcula sobre el valor interno', vuelta.costo_tarifa, null);
// El otro equipo, nunca vendido, sigue consignado
check('El equipo no vendido sigue sobre su valor interno',
  porImei(enLocal, '350000000000002').costo_tarifa, 2000000);

console.log('\n═══ 6. Factura cancelada no cierra la consignación ═══');
await db.exec(`UPDATE facturas SET estado = 'Cancelada' WHERE id = 1;`);
enLocal = await serialService.getSeriales(1, prodLocal[0].id, false);
checkEq('★ Con la factura cancelada vuelve a ser mercancía de bodega',
  porImei(enLocal, '350000000000001').origen_red, 'bodega');
check('Y recupera su valor interno', porImei(enLocal, '350000000000001').costo_tarifa, 1800000);

console.log('\n═══ 6b. Salud: entrega + devolución del mismo IMEI NO es duplicado ═══');
// Regresión detectada en la base real: el chequeo contaba COUNT(*) sobre el join
// lineas_remision × seriales, así que una pareja legítima entrega+devolución
// reportaba "2 filas" con una sola fila en `seriales`.
const devuelto = await service.devolver(reqCentro, {
  lineas: [{ tipo: 'serial', serial_id: 2 }],
  notas: 'devolución de prueba',
});
{
  const lineasDev = await repo.getLineasRemision(devuelto.id);
  await service.confirmarDevolucion(reqBodega, devuelto.id, {
    lineas_recibidas: lineasDev.map((l) => Number(l.id)),
  });
}
const filasImei = await q(`SELECT COUNT(*)::int c FROM seriales WHERE imei='350000000000002'`);
checkEq('Sigue habiendo UNA sola fila en seriales para ese IMEI', filasImei[0].c, 1);
const lineasDelImei = await q(
  `SELECT COUNT(*)::int c FROM lineas_remision WHERE imei='350000000000002'`);
checkEq('Y DOS líneas de remisión (entrega + devolución)', lineasDelImei[0].c, 2);
const salud = await repo.getChequeosSalud(1);
checkEq('★ El chequeo NO lo reporta como IMEI duplicado', salud.imeis_duplicados.length, 0);

console.log('\n═══ 7. ADITIVIDAD: negocio SIN red interna no cambia en nada ═══');
invalidarCache();
const sinRed = await serialService.getSeriales(2, 2, false);
checkEq('No recibe costo_tarifa', 'costo_tarifa' in sinRed[0], false);
checkEq('No recibe origen_red',   'origen_red'   in sinRed[0], false);
check('Su costo sigue siendo el de compra', sinRed[0].costo_compra, 500000);

console.log('\n═══ 8. Red interna activa pero SIN bodega definida → sin claves nuevas ═══');
await db.exec(`DELETE FROM config_negocio WHERE negocio_id=1 AND clave='red_interna_bodega_id';`);
invalidarCache();
const sinBodega = await serialService.getSeriales(1, prodLocal[0].id, false);
checkEq('Degrada al comportamiento de siempre', 'costo_tarifa' in sinBodega[0], false);

console.log(`\n${'─'.repeat(60)}`);
console.log(fallos === 0
  ? `✓ TODO OK — ${pasados} verificaciones`
  : `✗ ${fallos} FALLO(S) de ${pasados + fallos}`);
process.exit(fallos === 0 ? 0 : 1);
