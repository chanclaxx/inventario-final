// ─────────────────────────────────────────────────────────────────────────────
// Prueba end-to-end de la RED INTERNA contra un Postgres real (PGlite/WASM).
// Ejercita el service verdadero — no un mock — con un pool falso que apunta a
// la base en memoria. Verifica el circuito completo y, sobre todo, que la
// utilidad de los reportes siga cuadrando.
// ─────────────────────────────────────────────────────────────────────────────
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
// Raíz del backend, relativa a este archivo (no depende de dónde se ejecute).
const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');

const db = new PGlite();
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
await db.exec(readFileSync(path.join(AQUI, 'esquema.sql'), 'utf8'));
// El cruce de 'a quien se presto' toca prestamos/prestatarios, que viven aqui.
await db.exec(readFileSync(path.join(AQUI, 'esquema-completo.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260725_red_interna.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260726_red_interna_v2.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260822_red_interna_envios.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260823_red_interna_control.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260823_red_interna_cargos_pagables.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260823_remision_variantes.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260823_lotes_cantidad.sql'), 'utf8'));

// ── Pool falso: PGlite con la misma interfaz que `pg` ───────────────────────
const conectar = (target) => ({
  query: (text, params) => target.query(text, params ?? []),
});
const pool = {
  ...conectar(db),
  connect: async () => ({ ...conectar(db), release() {} }),
};

// Inyectar el pool falso antes de que los módulos reales carguen `config/db`.
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] = {
  id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} },
};

const service = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));
const repo    = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.repository.js'));

// ── Utilidades de prueba ────────────────────────────────────────────────────
let fallos = 0, pasados = 0;
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const money = (n) => '$' + Math.round(Number(n)).toLocaleString('es-CO');

function check(nombre, real, esperado) {
  const ok = Math.abs(Number(real) - Number(esperado)) < 1;
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}: ${money(real)}${ok ? '' : `  ← esperaba ${money(esperado)}`}`);
  ok ? pasados++ : fallos++;
}
function checkN(nombre, real, esperado) {
  const ok = Number(real) === Number(esperado);
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}: ${real}${ok ? '' : `  ← esperaba ${esperado}`}`);
  ok ? pasados++ : fallos++;
}

// ── Datos base: 1 negocio, bodega + 2 locales ──────────────────────────────
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Celulares Test');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Bodega'),(1,'Centro'),(1,'Norte');
  INSERT INTO usuarios (nombre) VALUES ('Admin'),('Vendedor Centro');
  INSERT INTO config_negocio VALUES
    (1,'red_interna_activa','1'), (1,'red_interna_bodega_id','1');
  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id)
    VALUES ('iPhone 13','Apple','128GB', 2600000, 1),
           ('Galaxy A54','Samsung','256GB', 1200000, 1);
  -- Costos reales de compra (esta es la base de la utilidad en reportes)
  INSERT INTO seriales (producto_id, imei, costo_compra) VALUES
    (1,'350000000000001', 1800000),
    (1,'350000000000002', 1850000),
    (2,'350000000000003',  900000),
    (2,'350000000000004',  920000);
  INSERT INTO productos_cantidad (nombre, stock, costo_unitario, precio, sucursal_id)
    VALUES ('Cargador tipo C', 50, 8000, 20000, 1);
  INSERT INTO cuentas_dinero (negocio_id, sucursal_id, nombre, tipo, metodos_pago)
    VALUES (1,1,'Efectivo','efectivo',ARRAY['Efectivo']),
           (1,2,'Efectivo','efectivo',ARRAY['Efectivo']);
  -- Cajas abiertas: así se ejercita el espejo en movimientos_caja
  INSERT INTO aperturas_caja (sucursal_id) VALUES (1),(2);
`);

const reqBodega = {
  user: { id: 1, negocio_id: 1, rol: 'admin_negocio' },
  sucursal_id: 1, esBodega: true,
  red: { activa: true, bodega_id: 1, modo_precio: 'costo',
         confirmar_recepcion: true, confirmar_remesa: true, ocultar_costos: false },
};
const reqCentro = {
  user: { id: 2, negocio_id: 1, rol: 'vendedor' },
  sucursal_id: 2, esBodega: false,
  red: { ...reqBodega.red },
};

console.log('\n═══ 1. La bodega despacha 3 equipos + 10 cargadores a Centro ═══');
const remision = await service.despachar(reqBodega, {
  sucursal_destino_id: 2,
  lineas: [
    { tipo: 'serial', serial_id: 1 },
    { tipo: 'serial', serial_id: 2 },
    { tipo: 'serial', serial_id: 3 },
    { tipo: 'cantidad', producto_id: 1, cantidad: 10 },
  ],
  notas: 'Envío de prueba',
});
checkN('Remisión creada con número', remision.numero, 1);
check('Valor total (suma de costos reales)', remision.valor_total, 1800000 + 1850000 + 900000 + 8000 * 10);
checkN('Estado inicial = En tránsito', remision.estado === 'En transito' ? 1 : 0, 1);

const stockBodega = (await q(`SELECT stock FROM productos_cantidad WHERE id=1`))[0].stock;
checkN('El inventario NO se movió al despachar (cargadores en bodega)', stockBodega, 50);
const seriales1 = await q(`SELECT ps.sucursal_id FROM seriales s JOIN productos_serial ps ON ps.id=s.producto_id WHERE s.id=1`);
checkN('El equipo sigue en la bodega mientras va en tránsito', seriales1[0].sucursal_id, 1);

console.log('\n═══ 2. El local recibe: llegan 2 equipos, 1 NO llega ═══');
const lineas = await repo.getLineasRemision(remision.id);
const recibidas = lineas.filter((l) => l.serial_id !== 3).map((l) => Number(l.id)); // el serial 3 no llegó
const rec = await service.recibir(reqCentro, remision.id, { lineas_recibidas: recibidas });
checkN('Estado = Parcial', rec.estado === 'Parcial' ? 1 : 0, 1);
checkN('Recibidas', rec.recibidas, 3);
checkN('Faltantes', rec.faltantes, 1);

const s3 = await q(`SELECT ps.sucursal_id FROM seriales s JOIN productos_serial ps ON ps.id=s.producto_id WHERE s.id=3`);
checkN('El equipo faltante SIGUE en la bodega', s3[0].sucursal_id, 1);
const s1 = await q(`SELECT ps.sucursal_id FROM seriales s JOIN productos_serial ps ON ps.id=s.producto_id WHERE s.id=1`);
checkN('El equipo recibido pasó al local', s1[0].sucursal_id, 2);

const filasImei = await q(`SELECT COUNT(*)::int c FROM seriales WHERE imei='350000000000001'`);
checkN('★ El IMEI NO se duplicó (una sola fila en seriales)', filasImei[0].c, 1);

const costoIntacto = await q(`SELECT costo_compra FROM seriales WHERE id=1`);
check('★ costo_compra intacto (base de la utilidad)', costoIntacto[0].costo_compra, 1800000);

const stocks = await q(`SELECT id, sucursal_id, stock, costo_unitario FROM productos_cantidad ORDER BY id`);
checkN('Cargadores que quedan en bodega', stocks.find((r) => r.sucursal_id === 1).stock, 40);
checkN('Cargadores que llegaron al local', stocks.find((r) => r.sucursal_id === 2).stock, 10);
check('Costo promedio correcto en el local', stocks.find((r) => r.sucursal_id === 2).costo_unitario, 8000);

console.log('\n═══ 3. Estado del local: recibir YA es deber ═══');
// Cambio de modelo (agosto 2026): el local paga lo que la bodega le entrega,
// esté vendido o no. Antes esta misma prueba exigía saldo 0 hasta la venta.
let estado = await service.getPanelLocal(reqCentro);
check('En vitrina (informativo)', estado.totales.en_consignacion_valor, 1800000 + 1850000);
checkN('Equipos en vitrina', estado.totales.en_consignacion_unidades, 2);
check('★ La deuda nace con el envío: 2 equipos + 10 cargadores',
      estado.totales.deuda_total, 1800000 + 1850000 + 10 * 8000);
check('★ Y es exigible completa, sin haber vendido nada',
      estado.totales.saldo_por_liquidar, 3730000);
checkN('Un solo envío, y está abierto', estado.totales.envios_abiertos, 1);

console.log('\n═══ 4. El local vende un iPhone de CONTADO por $2.600.000 ═══');
await db.exec(`
  INSERT INTO facturas (numero, sucursal_id, nombre_cliente, estado, fecha)
    VALUES (1, 2, 'Cliente Contado', 'Activa', NOW());
  INSERT INTO lineas_factura (factura_id, nombre_producto, imei, cantidad, precio)
    VALUES (1, 'iPhone 13', '350000000000001', 1, 2600000);
  INSERT INTO pagos_factura (factura_id, metodo, valor) VALUES (1,'Efectivo',2600000);
  UPDATE seriales SET vendido = TRUE, fecha_salida = CURRENT_DATE WHERE id = 1;
`);
estado = await service.getPanelLocal(reqCentro);
check('★ Vender NO mueve la deuda: ya la debía desde que recibió',
      estado.totales.saldo_por_liquidar, 3730000);
check('★ Solo cambia el informativo: el equipo sale de la vitrina',
      estado.totales.en_consignacion_valor, 1850000);
check('Y aparece como vendido', estado.totales.vendido_valor, 1800000);

console.log('\n═══ 5. Vende el otro iPhone a CRÉDITO ($2.700.000, abonado $500.000) ═══');
await db.exec(`
  INSERT INTO facturas (numero, sucursal_id, nombre_cliente, estado, fecha)
    VALUES (2, 2, 'Cliente Credito', 'Credito', NOW());
  INSERT INTO lineas_factura (factura_id, nombre_producto, imei, cantidad, precio)
    VALUES (2, 'iPhone 13', '350000000000002', 1, 2700000);
  INSERT INTO creditos (factura_id, sucursal_id, valor_total, cuota_inicial, total_abonado)
    VALUES (2, 2, 2700000, 300000, 200000);
  UPDATE seriales SET vendido = TRUE WHERE id = 2;
`);
estado = await service.getPanelLocal(reqCentro);
// El riesgo del crédito es del LOCAL: le fió a su cliente, pero a la bodega ya
// le debía el equipo completo desde que lo recibió. Antes la deuda con bodega
// crecía al ritmo del recaudo (mín(recaudado, costo)); eso se acabó.
check('★ Vender a crédito tampoco mueve la deuda con la bodega',
      estado.totales.saldo_por_liquidar, 3730000);
checkN('Aparece como "en recaudo" (informativo)', estado.totales.en_recaudo_unidades, 1);

console.log('\n   … el cliente abona $1.600.000 más (total recaudado $2.100.000)');
await db.exec(`UPDATE creditos SET total_abonado = 1800000 WHERE id = 1;`);
estado = await service.getPanelLocal(reqCentro);
check('★ Que el cliente del local abone no cambia nada de esta cuenta',
      estado.totales.saldo_por_liquidar, 3730000);

console.log('\n═══ 6. El local remite $2.000.000 a la bodega ═══');
const remesa = await service.enviarRemesa(reqCentro, { valor: 2000000 });
checkN('Remesa en tránsito', remesa.estado === 'En transito' ? 1 : 0, 1);
estado = await service.getPanelLocal(reqCentro);
check('Saldo NO baja todavía (la bodega no ha confirmado)', estado.totales.saldo_por_liquidar, 3730000);
check('Se muestra en tránsito', estado.totales.remesas_en_transito, 2000000);

const cuentas = await q(`SELECT c.nombre, c.tipo, c.sucursal_id,
   COALESCE(SUM(CASE WHEN m.tipo='entrada' THEN m.valor ELSE -m.valor END),0) saldo
   FROM cuentas_dinero c LEFT JOIN movimientos_dinero m ON m.cuenta_id=c.id AND m.activo
   GROUP BY c.id ORDER BY c.id`);
check('Salió de la caja del local', cuentas.find((c) => c.sucursal_id === 2 && c.tipo === 'efectivo').saldo, -2000000);
check('★ Está en la cuenta de tránsito (el dinero NO desaparece)',
      cuentas.find((c) => c.tipo === 'transito').saldo, 2000000);
check('★ Total del negocio intacto', cuentas.reduce((s, c) => s + Number(c.saldo), 0), 0);

console.log('\n   … la bodega confirma que recibió');
await service.confirmarRemesa(reqBodega, remesa.id);
estado = await service.getPanelLocal(reqCentro);
check('★ Ahora sí baja el saldo por liquidar', estado.totales.saldo_por_liquidar, 3730000 - 2000000);

const cuentas2 = await q(`SELECT c.tipo, c.sucursal_id,
   COALESCE(SUM(CASE WHEN m.tipo='entrada' THEN m.valor ELSE -m.valor END),0) saldo
   FROM cuentas_dinero c LEFT JOIN movimientos_dinero m ON m.cuenta_id=c.id AND m.activo
   GROUP BY c.id ORDER BY c.id`);
check('Tránsito vuelve a 0', cuentas2.find((c) => c.tipo === 'transito').saldo, 0);
check('La plata llegó a la caja de la bodega',
      cuentas2.find((c) => c.sucursal_id === 1 && c.tipo === 'efectivo').saldo, 2000000);

const espejos = await q(`SELECT ac.sucursal_id, mc.tipo, mc.valor, mc.referencia_tipo
   FROM movimientos_caja mc JOIN aperturas_caja ac ON ac.id = mc.caja_id
   WHERE mc.activo ORDER BY mc.id`);
checkN('★ Espejo en caja: 2 movimientos (egreso local + ingreso bodega)', espejos.length, 2);
checkN('Egreso en la caja del local',
       espejos.filter((e) => e.sucursal_id === 2 && e.tipo === 'Egreso').length, 1);
checkN('Ingreso en la caja de la bodega',
       espejos.filter((e) => e.sucursal_id === 1 && e.tipo === 'Ingreso').length, 1);
checkN('Marcados como tesoreria (no se cuentan doble)',
       espejos.filter((e) => e.referencia_tipo === 'tesoreria').length, 2);

console.log('\n═══ 7. Conciliación: ¿cuál se vendió y no se ha pagado? ═══');
const conc = await service.getConciliacion(reqCentro, 2);
for (const u of conc.liquidaciones) {
  console.log(`   ${u.liquidada ? '✓ PAGADO ' : '⏳ PENDIENTE'}  ${u.nombre_producto}  ${u.imei}  ${money(u.liquidable)}`);
}
checkN('Dos equipos vendidos listados', conc.liquidaciones.length, 2);
checkN('★ El primero (FIFO) queda cubierto por la remesa',
       conc.liquidaciones.find((u) => u.imei === '350000000000001').liquidada ? 1 : 0, 1);
checkN('★ El segundo sigue pendiente',
       conc.liquidaciones.find((u) => u.imei === '350000000000002').liquidada ? 1 : 0, 0);

console.log('\n═══ 8. ★★ LA PRUEBA CLAVE: la utilidad de los reportes ★★ ═══');
// Réplica EXACTA del cálculo de reportes.service.js (_costoPorImei + subtotal):
//   utilidad = precio de venta − costo_compra del serial en esa sucursal
const utilidad = await q(`
  SELECT f.sucursal_id, su.nombre AS sucursal,
         SUM(l.cantidad * l.precio) AS ventas,
         SUM(COALESCE((
           SELECT s.costo_compra FROM seriales s
           JOIN productos_serial ps ON ps.id = s.producto_id
           WHERE s.imei = l.imei AND ps.sucursal_id = f.sucursal_id LIMIT 1
         ), 0)) AS costo,
         SUM(l.cantidad * l.precio - COALESCE((
           SELECT s.costo_compra FROM seriales s
           JOIN productos_serial ps ON ps.id = s.producto_id
           WHERE s.imei = l.imei AND ps.sucursal_id = f.sucursal_id LIMIT 1
         ), 0)) AS utilidad
  FROM lineas_factura l
  JOIN facturas f ON f.id = l.factura_id
  JOIN sucursales su ON su.id = f.sucursal_id
  WHERE f.estado <> 'Cancelada'
  GROUP BY f.sucursal_id, su.nombre
`);
for (const r of utilidad) {
  console.log(`   ${r.sucursal}: ventas ${money(r.ventas)} − costo ${money(r.costo)} = utilidad ${money(r.utilidad)}`);
}
const totalVentas   = utilidad.reduce((s, r) => s + Number(r.ventas), 0);
const totalUtilidad = utilidad.reduce((s, r) => s + Number(r.utilidad), 0);

check('★ Ventas del negocio = solo las ventas REALES a clientes', totalVentas, 2600000 + 2700000);
check('★ Utilidad = venta − costo ORIGINAL de compra (sin inflar)',
      totalUtilidad, (2600000 - 1800000) + (2700000 - 1850000));

const nFacturas = await q(`SELECT COUNT(*)::int c FROM facturas`);
checkN('★ La red interna NO creó ni una factura', nFacturas[0].c, 2);
const nClientes = await q(`SELECT COUNT(*)::int c FROM clientes`);
checkN('★ NO creó clientes fantasma', nClientes[0].c, 0);
const nCreditos = await q(`SELECT COUNT(*)::int c FROM creditos`);
checkN('★ NO infló la cartera de créditos', nCreditos[0].c, 1);

console.log('\n═══ 9. Panel de salud (invariantes) ═══');
const salud = await service.getSalud(reqBodega);
checkN('Equipos sin ubicar', salud.sin_ubicar.length, 0);
checkN('IMEIs duplicados', salud.imeis_duplicados.length, 0);
checkN('Remesas huérfanas', salud.remesas_huerfanas.length, 0);
checkN('★ Todo cuadra', salud.ok ? 1 : 0, 1);

console.log('\n   … simulo un equipo que desaparece del local (robo / venta no registrada)');
await db.exec(`UPDATE seriales SET producto_id = 1 WHERE id = 4`); // ruido: no remisionado
await db.exec(`
  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id)
    VALUES ('iPhone 13','Apple','128GB', 2600000, 3);
  INSERT INTO seriales (producto_id, imei, costo_compra) VALUES (3,'350000000000009', 1700000);
`);
const rem2 = await service.despachar(reqBodega, {
  sucursal_destino_id: 2, lineas: [{ tipo: 'serial', serial_id: 4 }],
});
const l2 = await repo.getLineasRemision(rem2.id);
await service.recibir(reqCentro, rem2.id, { lineas_recibidas: l2.map((x) => Number(x.id)) });
// Se lo llevan a otra sucursal por fuera del sistema. Se resuelve el id real
// del producto en Norte (los ids intermedios los crea la propia recepción).
const prodNorte = (await q(`SELECT id FROM productos_serial WHERE sucursal_id = 3 LIMIT 1`))[0].id;
await db.exec(`UPDATE seriales SET producto_id = ${prodNorte} WHERE id = 4`);
const salud2 = await service.getSalud(reqBodega);
checkN('★ El panel detecta el equipo fuera de su local', salud2.movidas.length, 1);
checkN('Y marca que hay algo por revisar', salud2.ok ? 1 : 0, 0);

console.log('\n═══ 10. El traslado libre queda cerrado ═══');
const traslados = require(path.join(RAIZ, 'src/modules/traslados/traslados.service.js'));
try {
  await traslados.ejecutarTraslado(1, 1, {
    sucursal_origen_id: 1, sucursal_destino_id: 2,
    lineas: [{ tipo: 'serial', serial_id: 3, producto_destino_id: 1 }],
  });
  checkN('★ Debió bloquear el traslado libre', 0, 1);
} catch (e) {
  checkN('★ Traslado libre bloqueado con mensaje claro', e.status === 409 ? 1 : 0, 1);
  console.log(`     "${e.message}"`);
}

console.log('\n═══ 11. Si el local ANULA una factura, la cuenta con bodega NO se mueve ═══');
// Antes anular una venta bajaba la deuda con la bodega, porque la deuda salía
// de las ventas. Ahora sale del envío: lo que el local haga con su cliente es
// asunto suyo. Lo que sí se corrige solo —y esa ventaja de derivar sigue
// intacta— es el informativo: el equipo vuelve a la vitrina.
const antesAnular = (await service.getPanelLocal(reqCentro)).totales.saldo_por_liquidar;
await db.exec(`
  UPDATE facturas SET estado = 'Cancelada' WHERE id = 1;
  UPDATE seriales SET vendido = FALSE, fecha_salida = NULL WHERE id = 1;
`);
const trasAnular = await service.getPanelLocal(reqCentro);
check('★ La deuda con la bodega no se toca: no nació de esa venta',
      trasAnular.totales.saldo_por_liquidar, antesAnular);
checkN('★ El equipo vuelve a contarse en vitrina, sin ajuste manual',
       trasAnular.totales.en_consignacion_unidades, 1);
const saludAnular = await service.getSalud(reqBodega);
checkN('★ Y NO aparece como "sin ubicar" (falsa alarma evitada)',
       saludAnular.sin_ubicar.length, 0);

console.log(`\n${'═'.repeat(60)}`);
console.log(`RESULTADO: ${pasados} pasaron, ${fallos} fallaron`);
console.log('═'.repeat(60));
process.exit(fallos ? 1 : 0);
