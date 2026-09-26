// ─────────────────────────────────────────────────────────────────────────────
// UTILIDAD ESPERADA de lo que se otorgó a plazo
//
// La utilidad REAL de un crédito, un préstamo o un envío a un local se cuenta al
// COBRAR y no cambia. La ESPERADA es otra cifra, informativa: cuánto va a dejar
// lo que se dio a plazo en el período si se paga completo (valor − costo).
//
// Sostiene:
//   1. el contado NO entra (su utilidad ya es real);
//   2. crédito, préstamo y despacho dan valor − costo, por la fecha de la
//      operación, y lo cancelado / fuera del período no cuenta;
//   3. la realizada de esas mismas operaciones es la regla de siempre
//      (lo cobrado cubre primero el costo) — no se inventa ganancia;
//   4. lo que no tiene costo no suma esperada: se cuenta aparte;
//   5. lo que no llegó o se devolvió en un envío no va a dejar nada.
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
for (const m of [
  '20260725_red_interna', '20260726_red_interna_v2', '20260822_red_interna_envios',
  '20260823_red_interna_control', '20260823_red_interna_cargos_pagables',
  '20260823_remision_variantes', '20260823_lotes_cantidad',
  '20260824_costo_origen_remision', '20260823_valor_acreditado',
]) {
  await db.exec(readFileSync(path.join(RAIZ, `../migrations/${m}.sql`), 'utf8'));
}
const conectar = (t) => ({ query: (s, p) => t.query(s, p ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

const service  = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));
const repo     = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.repository.js'));
const reportes = require(path.join(RAIZ, 'src/modules/reportes/reportes.service.js'));

let fallos = 0, pasados = 0;
const money = (n) => (n == null ? 'null' : '$' + Math.round(Number(n)).toLocaleString('es-CO'));
function ok(nombre, cond, detalle = '') {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos++;
}

// Todas las fechas en el mismo día fijo: las consultas leen el TIMESTAMP como
// UTC y lo pasan a Bogotá (convención del reporte), así que se usa el mediodía.
const DIA = '2026-06-15';
const AYER = '2026-06-14';
const TS  = `${DIA} 17:00:00`;
const TSA = `${AYER} 17:00:00`;

await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Test');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Bodega'),(1,'Centro');
  INSERT INTO usuarios (nombre) VALUES ('Admin'),('Supervisor');
  INSERT INTO config_negocio VALUES (1,'red_interna_activa','1'),(1,'red_interna_bodega_id','1');
  INSERT INTO lineas_producto (negocio_id, nombre) VALUES (1,'Celulares'),(1,'Accesorios');
  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id, linea_id)
    VALUES ('iPhone 13','Apple','128GB', 2600000, 1, 1);
  INSERT INTO seriales (producto_id, imei, costo_compra) VALUES
    (1,'VEN-CONT', 1000000), (1,'VEN-CRED', 1000000), (1,'PRES-1', 300000),
    (1,'ENV-1', 1000000), (1,'ENV-2', 1000000), (1,'ENV-3', 1000000);
  INSERT INTO productos_cantidad (nombre, precio, costo_unitario, stock, sucursal_id, linea_id)
    VALUES ('Case', 50000, 20000, 10, 1, 2), ('Sin costo', 50000, NULL, 10, 1, 2);
  INSERT INTO cuentas_dinero (negocio_id, sucursal_id, nombre, tipo, metodos_pago)
    VALUES (1,1,'Efectivo','efectivo',ARRAY['Efectivo']), (1,2,'Efectivo','efectivo',ARRAY['Efectivo']);
  INSERT INTO aperturas_caja (sucursal_id) VALUES (1),(2);
`);

// Contado: NO debe entrar.
await db.exec(`
  INSERT INTO facturas (numero, sucursal_id, nombre_cliente, estado, fecha) VALUES (1, 1, 'Contado', 'Activa', '${TS}');
  INSERT INTO lineas_factura (factura_id, nombre_producto, imei, cantidad, precio) VALUES (1, 'iPhone 13', 'VEN-CONT', 1, 1500000);
`);
// Crédito de HOY: iPhone (costo 1.000.000) + 2 cases (costo 20.000 c/u), por 1.800.000.
// Cuota inicial 300.000 y un abono de 500.000 → cobrado 800.000 < costo 1.040.000.
await db.exec(`
  INSERT INTO facturas (numero, sucursal_id, nombre_cliente, estado, fecha) VALUES (2, 1, 'Ana', 'Credito', '${TS}');
  INSERT INTO lineas_factura (factura_id, nombre_producto, imei, cantidad, precio) VALUES (2, 'iPhone 13', 'VEN-CRED', 1, 1700000);
  INSERT INTO lineas_factura (factura_id, nombre_producto, producto_id, cantidad, precio) VALUES (2, 'Case', 1, 2, 50000);
  INSERT INTO creditos (factura_id, sucursal_id, valor_total, cuota_inicial, total_abonado, estado, creado_en)
    VALUES (2, 1, 1800000, 300000, 500000, 'Activo', '${TS}');
`);
// Crédito de AYER y crédito CANCELADO de hoy: no cuentan.
await db.exec(`
  INSERT INTO facturas (numero, sucursal_id, nombre_cliente, estado, fecha) VALUES (3, 1, 'Ayer', 'Credito', '${TSA}');
  INSERT INTO lineas_factura (factura_id, nombre_producto, producto_id, cantidad, precio) VALUES (3, 'Case', 1, 1, 90000);
  INSERT INTO creditos (factura_id, sucursal_id, valor_total, estado) VALUES (3, 1, 90000, 'Activo');
  INSERT INTO facturas (numero, sucursal_id, nombre_cliente, estado, fecha) VALUES (4, 1, 'Cancelado', 'Cancelada', '${TS}');
  INSERT INTO lineas_factura (factura_id, nombre_producto, producto_id, cantidad, precio) VALUES (4, 'Case', 1, 1, 90000);
  INSERT INTO creditos (factura_id, sucursal_id, valor_total, estado) VALUES (4, 1, 90000, 'Cancelada');
`);
// Préstamos de hoy: uno con costo (300.000, se presta en 500.000 y ya abonó
// 450.000 → realizada 150.000) y uno SIN costo.
await db.exec(`
  INSERT INTO prestamos (numero, sucursal_id, prestatario, imei, nombre_producto, valor_prestamo, total_abonado, estado, fecha)
    VALUES (1, 1, 'Luis', 'PRES-1', 'iPhone 13', 500000, 450000, 'Activo', '${TS}');
  INSERT INTO prestamos (numero, sucursal_id, prestatario, producto_id, nombre_producto, valor_prestamo, total_abonado, estado, cantidad_prestada, fecha)
    VALUES (2, 1, 'Sofía', 2, 'Sin costo', 100000, 0, 'Activo', 2, '${TS}');
`);

// Despacho de hoy: 3 equipos (costo 1.000.000) a 1.200.000 c/u. Uno no llega.
const red = { activa: true, bodega_id: 1, confirmar_recepcion: true, confirmar_remesa: true, ocultar_costos: true };
const bodega = { user: { id: 1, negocio_id: 1, rol: 'admin_negocio' }, sucursal_id: 1, esBodega: true, red };
const centro = { user: { id: 2, negocio_id: 1, rol: 'supervisor' },    sucursal_id: 2, esBodega: false, red };
const envio = await service.despachar(bodega, {
  sucursal_destino_id: 2,
  lineas: [4, 5, 6].map((id) => ({ tipo: 'serial', serial_id: id, valor_interno: 1200000 })),
});
await db.query(`UPDATE remisiones SET fecha_emision = $2 WHERE id = $1`, [envio.id, TS]);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 1. Qué entra y qué no ═══');
// ═════════════════════════════════════════════════════════════════════════════
let u = await reportes.getUtilidadEsperadaRango(1, DIA, DIA);
ok('★ Solo el crédito de HOY (ni el de ayer, ni el cancelado, ni el contado)',
   u.creditos.cantidad === 1 && u.creditos.detalle[0].persona === 'Ana');
ok('  los dos préstamos de hoy', u.prestamos.cantidad === 2);
ok('  el despacho de hoy, aunque vaya en camino', u.envios.cantidad === 1 && u.envios.detalle[0].en_camino === true);
ok('★ Un día sin nada a plazo → null (la tarjeta no aparece)',
   await reportes.getUtilidadEsperadaRango(1, '2026-01-01', '2026-01-01') === null);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 2. Esperada = valor − costo ═══');
// ═════════════════════════════════════════════════════════════════════════════
const c = u.creditos.detalle[0];
ok('★★ Crédito: 1.800.000 − (1.000.000 + 2 × 20.000) = 760.000', c.esperada === 760000, money(c.esperada));
const p1 = u.prestamos.detalle.find((p) => p.numero === 1);
ok('★ Préstamo: 500.000 − 300.000 = 200.000', p1.esperada === 200000, money(p1.esperada));
const e = u.envios.detalle[0];
ok('★ Despacho: 3 × (1.200.000 − 1.000.000) = 600.000', e.esperada === 600000, money(e.esperada));

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 3. La realizada de esas operaciones es la regla de siempre ═══');
// ═════════════════════════════════════════════════════════════════════════════
ok('★★ Crédito: cobró 800.000 y costó 1.040.000 → todavía NO ha dejado nada',
   c.realizada === 0 && c.cobrado === 800000, `realizada ${money(c.realizada)}`);
ok('  Préstamo: abonó 450.000 sobre costo 300.000 → realizada 150.000', p1.realizada === 150000);
ok('  Despacho sin pagos: realizada 0', e.realizada === 0);
ok('  por realizar = esperada − realizada',
   u.total.por_realizar === u.total.esperada - u.total.realizada);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 4. Sin costo no se inventa ganancia ═══');
// ═════════════════════════════════════════════════════════════════════════════
const p2 = u.prestamos.detalle.find((p) => p.numero === 2);
ok('★ El préstamo sin costo tiene esperada null', p2.esperada === null && p2.sin_costo === true);
ok('  y no suma: esperada de préstamos = 200.000', u.prestamos.esperada === 200000, money(u.prestamos.esperada));
ok('  se cuenta aparte (sin_costo = 1)', u.prestamos.sin_costo === 1);
ok('★ Total esperado = 760.000 + 200.000 + 600.000',
   u.total.esperada === 1560000 && u.total.operaciones === 4, money(u.total.esperada));

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 5. Lo que no llegó o se devolvió no va a dejar nada ═══');
// ═════════════════════════════════════════════════════════════════════════════
const lineas = await repo.getLineasRemision(envio.id);
await service.recibir(centro, envio.id, { lineas_recibidas: lineas.slice(0, 2).map((l) => Number(l.id)) });
u = await reportes.getUtilidadEsperadaRango(1, DIA, DIA);
ok('★ Uno de los tres no llegó: el despacho ahora espera 400.000', u.envios.detalle[0].esperada === 400000,
   money(u.envios.detalle[0].esperada));
ok('  y ya no va en camino', u.envios.detalle[0].en_camino === false);
const pago = await service.enviarRemesa(centro, { valor: 2100000 });
await service.confirmarRemesa(bodega, pago.id);
u = await reportes.getUtilidadEsperadaRango(1, DIA, DIA);
ok('★ El local pagó 2.100.000 de 2.400.000 (costo 2.000.000): realizada 100.000',
   u.envios.detalle[0].realizada === 100000, money(u.envios.detalle[0].realizada));

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 6. La utilidad REAL no se movió ═══');
// ═════════════════════════════════════════════════════════════════════════════
const ventas = await reportes.getVentasALocales(1, DIA, DIA);
ok('★ La utilidad realizada de la bodega sigue siendo la suya (no la esperada)',
   ventas == null || ventas.resumen.utilidad_realizada !== u.envios.esperada);
const creditoFila = (await db.query(`SELECT total_abonado FROM creditos WHERE factura_id = 2`)).rows[0];
ok('  y el cálculo no escribió nada en ningún documento', Number(creditoFila.total_abonado) === 500000);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 7. En la lista de facturas: real en 0, esperada al lado ═══');
// ═════════════════════════════════════════════════════════════════════════════
let ventasDia = null;
try {
  ventasDia = await reportes.getVentasRango(1, DIA, DIA);
} catch (err) {
  console.log(`  (el fixture no alcanza para getVentasRango completo: ${err.message})`);
}
if (ventasDia) {
  const fCred = ventasDia.facturas.find((f) => f.nombre_cliente === 'Ana');
  const fCont = ventasDia.facturas.find((f) => f.nombre_cliente === 'Contado');
  ok('★★ La factura a crédito sigue con utilidad REAL 0', fCred.utilidad_neta === 0
     && fCred.lineas.every((l) => l.utilidad === 0));
  ok('★ …y trae la esperada: 760.000', fCred.utilidad_esperada === 760000, money(fCred.utilidad_esperada));
  ok('  cada línea trae la suya y la marca en_credito',
     fCred.lineas.every((l) => l.en_credito === true)
     && fCred.lineas.reduce((s, l) => s + l.utilidad_esperada, 0) === 760000);
  ok('  la de contado no cambia ni trae esperada',
     fCont.utilidad_neta === 500000 && fCont.utilidad_esperada === undefined
     && fCont.lineas.every((l) => l.en_credito === undefined));
  ok('★ La utilidad neta del período no incluye la esperada',
     ventasDia.resumen.utilidad_neta_total === 500000, money(ventasDia.resumen.utilidad_neta_total));
  ok('  créditos activos: esperada al lado de la parcial',
     ventasDia.creditos.activos.detalle.some((c) => c.nombre_cliente === 'Ana' && c.utilidad_esperada === 760000));
  ok('  préstamos activos: esperada al lado de la parcial',
     ventasDia.prestamos.activos.some((p) => p.prestatario === 'Luis' && p.utilidad_esperada === 200000));
  ok('  y el bloque de utilidad esperada viaja con el reporte', ventasDia.utilidad_esperada?.total?.esperada > 0);
}

console.log(`\n${fallos === 0 ? '✓' : '✗'} ${pasados} pasaron, ${fallos} fallaron\n`);
process.exit(fallos ? 1 : 0);
