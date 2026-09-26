// ─────────────────────────────────────────────────────────────────────────────
// REPORTES COHERENTES — una sola utilidad, un solo costo
//
// La auditoría de sep-2026 encontró que cada pestaña de Reportes contaba la
// utilidad a su manera: Análisis solo sumaba contado + créditos, Vendedores y
// Productos tomaban el costo faltante como 0 (utilidad pura) o el promedio del
// modelo, la Proyección dividía el costo conocido entre TODAS las ventas y el
// PDF no sumaba ni préstamos ni despachos. Esta suite sostiene:
//
//   1. la utilidad del período (Ventas) = la suma de la serie de Análisis
//      = lo que dice el PDF, parte por parte;
//   2. lo que no tiene costo no suma utilidad en NINGUNA pestaña;
//   3. el costo de una línea es el mismo en Ventas, Productos y Vendedores
//      (la variante vendida, no el producto por nombre);
//   4. un abono ANULADO no fecha el saldo de un préstamo;
//   5. la Proyección mide el % de costo solo sobre lo que tiene costo, y
//      cuenta los despachos a locales como venta;
//   6. corregir el costo de un IMEI corrige la MISMA fila que lee el reporte;
//   7. sin facturas el reporte no se corta (créditos saldados, despachos).
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

// Mediodía: sin importar cómo lea el driver la hora, la fecha no se corre.
const MAYO  = '2026-05-15 12:00:00';
const JUNIO = '2026-06-10 12:00:00';
const JUNIO2 = '2026-06-12 12:00:00';
const JULIO = '2026-07-02 12:00:00';

await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Test');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Bodega'),(1,'Centro');
  INSERT INTO usuarios (nombre) VALUES ('Admin'),('Supervisor');
  INSERT INTO config_negocio VALUES (1,'red_interna_activa','1'),(1,'red_interna_bodega_id','1'),
                                    (1,'vendedores_activo','1');
  INSERT INTO vendedores (negocio_id, sucursal_id, nombre) VALUES (1, 1, 'Pedro');
  INSERT INTO lineas_producto (negocio_id, nombre) VALUES (1,'Celulares'),(1,'Accesorios');
  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id, linea_id)
    VALUES ('iPhone 13','Apple','128GB', 2600000, 1, 1);
  INSERT INTO seriales (producto_id, imei, costo_compra) VALUES
    (1,'A1', 1000000), (1,'A2', 1000000), (1,'SINC', NULL), (1,'PRES-1', 300000),
    (1,'ENV-1', 1000000), (1,'ENV-2', 1000000),
    -- Otro equipo con costo: antes el IMEI sin costo tomaba el PROMEDIO del modelo.
    (1,'OTRO', 900000);
  INSERT INTO productos_cantidad (nombre, precio, costo_unitario, stock, sucursal_id, linea_id)
    VALUES ('Case', 50000, 20000, 10, 1, 2), ('Sin costo', 50000, NULL, 10, 1, 2),
           ('Correa', 80000, 99999, 10, 1, 2);
  -- La correa tiene tallas: la 38MM costó 30.000 (el producto dice 99.999).
  INSERT INTO atributos_producto (producto_id, sucursal_id, valor, costo_unitario, stock, activo)
    VALUES (3, 1, '38MM', 30000, 5, true);
  INSERT INTO cuentas_dinero (negocio_id, sucursal_id, nombre, tipo, metodos_pago)
    VALUES (1,1,'Efectivo','efectivo',ARRAY['Efectivo']), (1,2,'Efectivo','efectivo',ARRAY['Efectivo']);
  INSERT INTO aperturas_caja (sucursal_id) VALUES (1),(2);
`);

// MAYO — contado: iPhone A1 (costo 1.000.000) a 1.500.000 → 500.000, y un
// producto SIN costo a 100.000 (no suma). Vendedor Pedro.
await db.exec(`
  INSERT INTO facturas (numero, sucursal_id, vendedor_id, nombre_cliente, estado, fecha) VALUES (1, 1, 1, 'Contado', 'Activa', '${MAYO}');
  INSERT INTO lineas_factura (factura_id, nombre_producto, imei, cantidad, precio) VALUES (1, 'iPhone 13', 'A1', 1, 1500000);
  INSERT INTO lineas_factura (factura_id, nombre_producto, producto_id, cantidad, precio) VALUES (1, 'Sin costo', 2, 2, 50000);
`);
// MAYO — crédito: iPhone A2 + 2 cases por 1.800.000; se SALDA en junio.
// Costo 1.040.000 → utilidad 760.000 en JUNIO (fecha de saldo).
await db.exec(`
  INSERT INTO facturas (numero, sucursal_id, nombre_cliente, estado, fecha) VALUES (2, 1, 'Ana', 'Credito', '${MAYO}');
  INSERT INTO lineas_factura (factura_id, nombre_producto, imei, cantidad, precio) VALUES (2, 'iPhone 13', 'A2', 1, 1700000);
  INSERT INTO lineas_factura (factura_id, nombre_producto, producto_id, cantidad, precio) VALUES (2, 'Case', 1, 2, 50000);
  INSERT INTO creditos (factura_id, sucursal_id, valor_total, cuota_inicial, total_abonado, estado, creado_en)
    VALUES (2, 1, 1800000, 300000, 1500000, 'Saldado', '${MAYO}');
  INSERT INTO abonos_credito (credito_id, valor, metodo, fecha) VALUES (1, 1500000, 'Efectivo', '${JUNIO}');
`);
// JUNIO — contado: IMEI SIN costo (no suma, y no toma el promedio del modelo)
// y la correa 38MM (costo de la TALLA 30.000, no los 99.999 del producto).
await db.exec(`
  INSERT INTO facturas (numero, sucursal_id, vendedor_id, nombre_cliente, estado, fecha) VALUES (3, 1, 1, 'Junio', 'Activa', '${JUNIO}');
  INSERT INTO lineas_factura (factura_id, nombre_producto, imei, cantidad, precio) VALUES (3, 'iPhone 13', 'SINC', 1, 1200000);
  INSERT INTO lineas_factura (factura_id, nombre_producto, producto_id, atributo_id, cantidad, precio) VALUES (3, 'Correa', 3, 1, 1, 80000);
`);
// JUNIO — préstamo saldado (costo 300.000, valor 500.000 → 200.000). Tiene un
// abono ANULADO en julio: el saldo es de junio.
await db.exec(`
  INSERT INTO prestamos (numero, sucursal_id, prestatario, imei, nombre_producto, valor_prestamo, total_abonado, estado, fecha)
    VALUES (1, 1, 'Luis', 'PRES-1', 'iPhone 13', 500000, 500000, 'Saldado', '${JUNIO}');
  INSERT INTO abonos_prestamo (prestamo_id, valor, metodo, fecha) VALUES (1, 500000, 'Efectivo', '${JUNIO2}');
  INSERT INTO abonos_prestamo (prestamo_id, valor, metodo, fecha, anulado, valor_anulado)
    VALUES (1, 100000, 'Efectivo', '${JULIO}', true, 100000);
`);
// JUNIO — servicio entregado: 200.000 − 50.000 = 150.000.
await db.exec(`
  INSERT INTO ordenes_servicio (numero, sucursal_id, estado, precio_final, costo_real, total_abonado, fecha_entrega)
    VALUES (1, 1, 'Entregado', 200000, 50000, 200000, '${JUNIO}');
`);
// JUNIO — despacho a un local: 2 equipos (costo 1.000.000) a 1.200.000; el
// local paga 2.100.000 → realizada 100.000 (lo cobrado cubre primero el costo).
const red = { activa: true, bodega_id: 1, confirmar_recepcion: true, confirmar_remesa: true, ocultar_costos: true };
const bodega = { user: { id: 1, negocio_id: 1, rol: 'admin_negocio' }, sucursal_id: 1, esBodega: true, red };
const centro = { user: { id: 2, negocio_id: 1, rol: 'supervisor' },    sucursal_id: 2, esBodega: false, red };
const envio = await service.despachar(bodega, {
  sucursal_destino_id: 2,
  lineas: [5, 6].map((id) => ({ tipo: 'serial', serial_id: id, valor_interno: 1200000 })),
});
const lineasEnv = await repo.getLineasRemision(envio.id);
await service.recibir(centro, envio.id, { lineas_recibidas: lineasEnv.map((l) => Number(l.id)) });
await db.query(`UPDATE remisiones SET fecha_emision = $2, fecha_recepcion = $2 WHERE id = $1`, [envio.id, JUNIO]);
const pago = await service.enviarRemesa(centro, { valor: 2100000 });
await service.confirmarRemesa(bodega, pago.id);

const DESDE = '2026-05-01', HASTA = '2026-06-30';

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 1. Una sola utilidad: Ventas = Análisis = PDF ═══');
// ═════════════════════════════════════════════════════════════════════════════
const ventas   = await reportes.getVentasRango(1, DESDE, HASTA);
const analisis = await reportes.getAnalisis(1, DESDE, HASTA, 'mes');
const up = ventas.utilidad_periodo;
ok('★ Contado: solo el iPhone A1 (500.000) y la correa 38MM (80.000 − 30.000)',
   up.contado === 550000, money(up.contado));
ok('★ Créditos saldados: 1.800.000 − 1.040.000 = 760.000', up.creditos === 760000, money(up.creditos));
ok('★ Préstamos saldados: 200.000', up.prestamos === 200000, money(up.prestamos));
ok('  Servicios: 150.000', up.servicios === 150000, money(up.servicios));
ok('★ Despachos: lo cobrado sobre el costo, 100.000', up.despachos === 100000, money(up.despachos));
ok('★★ Total = 1.760.000', up.total === 1760000, money(up.total));
const sumaSerie = analisis.serie.reduce((s, p) => s + p.utilidad, 0);
ok('★★ La serie de Análisis suma exactamente la utilidad del período', sumaSerie === up.total,
   `serie ${money(sumaSerie)} · ventas ${money(up.total)}`);
const mayo  = analisis.serie.find((p) => p.periodo === '2026-05-01');
const junio = analisis.serie.find((p) => p.periodo === '2026-06-01');
ok('★ Mayo: solo el contado de mayo (500.000)', mayo?.utilidad === 500000, money(mayo?.utilidad));
ok('★ Junio: el crédito cae el mes que se SALDÓ, con préstamo, servicio y despacho',
   junio?.utilidad === 50000 + 760000 + 200000 + 150000 + 100000, money(junio?.utilidad));
ok('  cada período trae su desglose', junio?.utilidad_desglose?.despachos === 100000
   && junio.utilidad_desglose.creditos === 760000);
ok('  la composición incluye los despachos a locales',
   analisis.composicion.some((c) => c.fuente === 'Despachos a locales' && c.total === 2400000));

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 2. Lo que no tiene costo no suma, en ninguna pestaña ═══');
// ═════════════════════════════════════════════════════════════════════════════
const fJun = ventas.facturas.find((f) => f.nombre_cliente === 'Junio');
const lSinc = fJun.lineas.find((l) => l.imei === 'SINC');
ok('★★ El IMEI sin costo queda SIN costo (antes tomaba el promedio del modelo)',
   lSinc.costo_unitario_compra === null && lSinc.utilidad === null);
ok('  y se cuenta: 2 líneas de contado sin costo', up.sin_costo.lineas_contado === 2, String(up.sin_costo.lineas_contado));

const top = await reportes.getProductosTop(1, DESDE, HASTA);
const pSin = top.find((p) => p.nombre_producto === 'Sin costo');
ok('★ Productos: el producto sin costo no tiene utilidad', pSin.utilidad === null && pSin.unidades_sin_costo === 2);
const pIph = top.find((p) => p.nombre_producto === 'iPhone 13');
ok('★ Productos: el iPhone mide solo las unidades con costo (A1 y A2; SINC aparte)',
   pIph.costo_total === 2000000 && pIph.unidades_sin_costo === 1
   && pIph.utilidad === 1500000 + 1700000 - 2000000, `utilidad ${money(pIph.utilidad)}`);

const vend = await reportes.getVentasPorVendedor(1, DESDE, HASTA);
const pedro = vend.vendedores.find((v) => v.vendedor_nombre === 'Pedro');
ok('★★ Vendedores: Pedro no gana por lo que no tiene costo',
   pedro.utilidad === 500000 + 50000, money(pedro.utilidad));
ok('  y se le cuentan sus líneas sin costo', pedro.lineas_sin_costo === 2);
ok('  el margen es sobre lo vendido con costo', Math.round(pedro.margen_porcentaje) === Math.round(550000 / 1580000 * 100),
   `${pedro.margen_porcentaje?.toFixed(1)}%`);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 3. El costo de la línea es el de la VARIANTE vendida ═══');
// ═════════════════════════════════════════════════════════════════════════════
const lCorrea = fJun.lineas.find((l) => l.nombre_producto === 'Correa');
ok('★ Ventas: la correa cuesta 30.000 (la talla), no 99.999', lCorrea.costo_unitario_compra === 30000);
const pCorrea = top.find((p) => p.nombre_producto === 'Correa');
ok('★ Productos dice lo mismo', pCorrea.costo_total === 30000 && pCorrea.utilidad === 50000, money(pCorrea.utilidad));

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 4. Un abono anulado no fecha el saldo ═══');
// ═════════════════════════════════════════════════════════════════════════════
ok('★ El préstamo cuenta en junio aunque tenga un abono anulado en julio',
   ventas.prestamos.saldados?.length === 1);
const julio = await reportes.getVentasRango(1, '2026-07-01', '2026-07-31');
ok('  …y NO en julio', (julio.prestamos.saldados || []).length === 0);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 5. Sin facturas el reporte no se corta ═══');
// ═════════════════════════════════════════════════════════════════════════════
// Una sucursal sin facturas en junio no existe en el fixture; se mide la bodega
// en un rango con créditos saldados y despachos pero sin facturas.
await db.query(`UPDATE facturas SET fecha = $1 WHERE id = 3`, [MAYO]);
const soloJunio = await reportes.getVentasRango(1, '2026-06-01', '2026-06-30');
ok('★ Sin facturas: resumen null pero los créditos saldados siguen', soloJunio.resumen === null
   && soloJunio.creditos.resumen.utilidad_confirmada === 760000);
ok('  y la utilidad del período también', soloJunio.utilidad_periodo.total === 760000 + 200000 + 150000 + 100000,
   money(soloJunio.utilidad_periodo.total));
await db.query(`UPDATE facturas SET fecha = $1 WHERE id = 3`, [JUNIO]);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 6. Proyección: % de costo sobre lo que tiene costo ═══');
// ═════════════════════════════════════════════════════════════════════════════
const serieMes = (await reportes.getAnalisis(1, DESDE, HASTA, 'mes')).serie;
const j = serieMes.find((p) => p.periodo === '2026-06-01');
ok('★ Junio mide ventas con costo (80.000 de la correa) aparte del IMEI sin costo',
   j.ventas_con_costo === 80000 && j.costo === 30000);
ok('★ …y trae lo despachado (2.400.000 a costo 2.000.000)',
   j.despachos_valor === 2400000 && j.despachos_costo === 2000000);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 7. Corregir el costo corrige la fila que lee el reporte ═══');
// ═════════════════════════════════════════════════════════════════════════════
// El IMEI SINC tiene DOS filas (se vendió, volvió y se reingresó): la vendida
// es la que lee el reporte.
// La fila NUEVA es la vendida; una lectura sin orden encuentra primero la vieja.
await db.exec(`INSERT INTO seriales (producto_id, imei, costo_compra, vendido) VALUES (1, 'SINC', NULL, true)`);
await reportes.actualizarCostoCompra(1, 'serial', 'SINC', null, 700000);
const v2 = await reportes.getVentasRango(1, '2026-06-01', '2026-06-30');
const l2 = v2.facturas.find((f) => f.nombre_cliente === 'Junio').lineas.find((l) => l.imei === 'SINC');
ok('★★ El reporte ve la corrección', l2.costo_unitario_compra === 700000, money(l2.costo_unitario_compra));
let codigo = null;
try { await reportes.actualizarCostoCompra(2, 'serial', 'ENV-1', null, 5); } catch (err) { codigo = err.code; }
ok('★ Un equipo consignado se corrige en la remisión, no aquí', codigo === 'COSTO_DE_BODEGA', String(codigo));

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 8. El PDF dice las mismas cifras ═══');
// ═════════════════════════════════════════════════════════════════════════════
try {
  const pdf = require(path.join(RAIZ, 'src/modules/reportes/reportes.pdf.js'));
  // Se instrumenta pdfkit: el contenido va comprimido y no se puede leer crudo.
  const PDFDocument = require(require.resolve('pdfkit', { paths: [RAIZ] }));
  const textos = [];
  const original = PDFDocument.prototype.text;
  PDFDocument.prototype.text = function (t, ...r) { textos.push(String(t)); return original.call(this, t, ...r); };
  const gen = pdf.generarReporteContable || pdf.generarReporte || Object.values(pdf).find((f) => typeof f === 'function');
  const doc = await gen({ negocio: { nombre: 'Test' }, sucursalNombre: 'Bodega', sucursalId: 1,
    desde: DESDE, hasta: HASTA, agrupacion: 'mes' });
  const esperado = (await reportes.getVentasRango(1, DESDE, HASTA)).utilidad_periodo.total;
  const trozos = [];
  const buf = await new Promise((res, rej) => {
    doc.on('data', (c) => trozos.push(c)); doc.on('end', () => res(Buffer.concat(trozos))); doc.on('error', rej);
  });
  ok('★ El PDF se genera (con despachos, préstamos y sin costo)', buf.length > 1000, `${buf.length} bytes`);
  const fila = (t) => textos.findIndex((x) => x.startsWith(t));
  const i = fila('Utilidad total del periodo');
  ok('★★ …y dice la utilidad total del período, la misma cifra de Ventas',
     i >= 0 && Number(textos[i + 1].replace(/[^0-9]/g, '')) === esperado, `${textos[i + 1]} · ventas ${money(esperado)}`);
  ok('  con la línea de despachos a locales', fila('Utilidad de despachos a locales') >= 0);
  ok('  y la nota de lo que no tiene costo', textos.some((x) => x.startsWith('Sin costo registrado')));
} catch (err) {
  ok('★ El PDF se genera (con despachos, préstamos y sin costo)', false, err.message);
}

console.log(`\n${fallos === 0 ? '✓' : '✗'} ${pasados} pasaron, ${fallos} fallaron\n`);
process.exit(fallos ? 1 : 0);
