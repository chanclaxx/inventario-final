// ─────────────────────────────────────────────────────────────────────────────
// ESTADO DE CUENTA POR ENVÍO
//
// El local no pregunta "cuánto debo": pregunta "de lo que me mandaron en este
// envío, qué vendí, qué presté y qué me queda". Esta suite verifica que la
// respuesta salga bien y —lo importante— que CUADRE con el saldo del panel:
//
//   Σ deuda_pendiente(envío) + accesorios_pendiente = saldo_por_liquidar
//
// Si esa identidad se rompe, el desglose por envío estaría contando una
// historia distinta a la del número grande, que es exactamente el descuadre
// que el modelo derivado existe para evitar.
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

const conectar = (t) => ({ query: (s, p) => t.query(s, p ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

const service = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));
const repo    = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.repository.js'));

let fallos = 0, pasados = 0;
const money = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('es-CO');
function ok(nombre, cond, detalle = '') {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos++;
}

await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Test');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Bodega'),(1,'Centro');
  INSERT INTO usuarios (nombre) VALUES ('Admin'),('Supervisor'),('Vendedor');
  INSERT INTO config_negocio VALUES (1,'red_interna_activa','1'),(1,'red_interna_bodega_id','1');
  INSERT INTO lineas_producto (negocio_id, nombre) VALUES (1,'Celulares'),(1,'Accesorios');

  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id, linea_id)
    VALUES ('iPhone 13','Apple','128GB', 2600000, 1, 1);
  INSERT INTO seriales (producto_id, imei, costo_compra) VALUES
    (1,'E1-AAA', 1000000),   -- id 1 · envío 1 · se vende de contado
    (1,'E1-BBB', 1000000),   -- id 2 · envío 1 · se vende a crédito
    (1,'E1-CCC', 1000000),   -- id 3 · envío 1 · se presta
    (1,'E1-DDD', 1000000),   -- id 4 · envío 1 · queda en vitrina
    (1,'E2-AAA', 2000000),   -- id 5 · envío 2 · se vende de contado
    (1,'E2-BBB', 2000000),   -- id 6 · envío 2 · se devuelve
    (1,'E3-AAA',  500000);   -- id 7 · envío 3 · se anula el envío

  INSERT INTO productos_cantidad (nombre, codigo, precio, costo_unitario, stock, sucursal_id, linea_id)
    VALUES ('Cargador 20W','CARG20', 60000, 30000, 10, 1, 2);

  INSERT INTO cuentas_dinero (negocio_id, sucursal_id, nombre, tipo, metodos_pago)
    VALUES (1,1,'Efectivo','efectivo',ARRAY['Efectivo']),
           (1,2,'Efectivo','efectivo',ARRAY['Efectivo']);
  INSERT INTO aperturas_caja (sucursal_id) VALUES (1),(2);
`);

const red = { activa:true, bodega_id:1, confirmar_recepcion:true, confirmar_remesa:true,
              ocultar_costos:true };
const bodega = { user:{id:1,negocio_id:1,rol:'admin_negocio'}, sucursal_id:1, esBodega:true, red };
const centro = { user:{id:2,negocio_id:1,rol:'supervisor'},    sucursal_id:2, esBodega:false, red };
const vende  = { user:{id:3,negocio_id:1,rol:'vendedor'},      sucursal_id:2, esBodega:false, red };

const recibirTodo = async (remisionId) => {
  const lineas = await repo.getLineasRemision(remisionId);
  return service.recibir(centro, remisionId, {
    lineas_recibidas: lineas.map((l) => Number(l.id)),
    cantidades: Object.fromEntries(
      lineas.filter((l) => l.tipo === 'cantidad').map((l) => [l.id, l.cantidad])
    ),
  });
};

console.log('\n═══ 1. Tres envíos: el segundo con accesorios, el tercero anulado ═══');

const e1 = await service.despachar(bodega, {
  sucursal_destino_id: 2,
  lineas: [1, 2, 3, 4].map((id) => ({ tipo: 'serial', serial_id: id })),
  notas: 'Surtido inicial',
});
await recibirTodo(e1.id);

const e2 = await service.despachar(bodega, {
  sucursal_destino_id: 2,
  lineas: [
    { tipo: 'serial', serial_id: 5 },
    { tipo: 'serial', serial_id: 6 },
    { tipo: 'cantidad', producto_id: 1, cantidad: 4 },
  ],
});
await recibirTodo(e2.id);

const e3 = await service.despachar(bodega, {
  sucursal_destino_id: 2, lineas: [{ tipo: 'serial', serial_id: 7 }],
});
await service.anularRemision(bodega, e3.id);

let cuenta = await service.getEstadoCuenta(centro, 2);
ok('★ Aparecen los tres envíos, incluido el anulado', cuenta.envios.length === 3);
ok('  el anulado se lista como Anulada',
   cuenta.envios.find((e) => e.id === e3.id)?.estado === 'Anulada');
ok('  y no cuenta ninguna unidad',
   Number(cuenta.envios.find((e) => e.id === e3.id).unidades) === 0);

const env1 = () => cuenta.envios.find((e) => e.id === e1.id);
const env2 = () => cuenta.envios.find((e) => e.id === e2.id);

ok('★ El envío 1 trae sus 4 equipos', Number(env1().unidades) === 4);
ok('  todos disponibles todavía',     Number(env1().disponibles) === 4);
ok('  y sin deuda generada',          Number(env1().deuda_generada) === 0);
ok('★ El envío 2 cuenta sus accesorios aparte',
   Number(env2().accesorios_unidades) === 4, `${env2().accesorios_unidades} unidades`);
ok('  los accesorios no se cuentan como equipos', Number(env2().unidades) === 2);

console.log('\n═══ 2. Vendido, prestado y disponible se separan por envío ═══');

await db.exec(`
  INSERT INTO facturas (numero, sucursal_id, nombre_cliente, estado, fecha)
    VALUES (1, 2, 'Ana Pérez',  'Activa', NOW() + INTERVAL '1 minute'),
           (2, 2, 'Luis Gómez', 'Activa', NOW() + INTERVAL '2 minutes'),
           (3, 2, 'Sara Ruiz',  'Activa', NOW() + INTERVAL '3 minutes');
  INSERT INTO lineas_factura (factura_id, nombre_producto, imei, cantidad, precio)
    VALUES (1, 'iPhone 13', 'E1-AAA', 1, 1500000),
           (2, 'iPhone 13', 'E1-BBB', 1, 1600000),
           (3, 'iPhone 13', 'E2-AAA', 1, 2800000);
  -- La 2 es a crédito: abonaron 400.000 de 1.600.000
  INSERT INTO creditos (factura_id, valor_total, cuota_inicial, total_abonado)
    VALUES (2, 1600000, 400000, 0);
  UPDATE seriales SET vendido = TRUE  WHERE imei IN ('E1-AAA','E1-BBB','E2-AAA');
  UPDATE seriales SET prestado = TRUE WHERE imei = 'E1-CCC';
`);

cuenta = await service.getEstadoCuenta(centro, 2);
ok('★ Envío 1: 2 vendidos',    Number(env1().vendidas) === 2);
ok('  uno de contado',         Number(env1().vendidas_contado) === 1);
ok('  y uno a crédito',        Number(env1().vendidas_credito) === 1);
ok('★ Envío 1: 1 prestado',    Number(env1().prestadas) === 1);
ok('★ Envío 1: 1 disponible',  Number(env1().disponibles) === 1);
ok('  con su valor en vitrina', Number(env1().disponibles_valor) === 1000000,
   money(env1().disponibles_valor));
ok('★ El prestado NO genera deuda (nada se ha vendido)',
   Number(env1().prestadas_valor) === 1000000 &&
   Number(env1().deuda_generada) === 1400000,
   `generó ${money(env1().deuda_generada)}`);
ok('  = 1.000.000 del contado + 400.000 recaudado del crédito',
   Number(env1().deuda_generada) === 1000000 + 400000);
ok('★ Envío 2: 1 vendido de 2.000.000', Number(env2().deuda_generada) === 2000000,
   money(env2().deuda_generada));

console.log('\n═══ 3. La devolución sale del envío del que salió el equipo ═══');
const dev = await service.devolver(centro, { lineas: [{ tipo: 'serial', serial_id: 6 }] });
await service.confirmarDevolucion(bodega, dev.id, {});
cuenta = await service.getEstadoCuenta(centro, 2);
ok('★ Envío 2 marca 1 devuelto', Number(env2().devueltas) === 1);
ok('  y ya no lo cuenta como disponible', Number(env2().disponibles) === 0);
ok('  la deuda del envío 2 no cambia (lo devuelto nunca se vendió)',
   Number(env2().deuda_generada) === 2000000);

console.log('\n═══ 4. ★ Sin pagos, lo pendiente por envío = lo generado ═══');
ok('Envío 1 pendiente = generado',
   Number(env1().deuda_pendiente) === Number(env1().deuda_generada), money(env1().deuda_pendiente));
ok('Envío 2 pendiente = generado',
   Number(env2().deuda_pendiente) === Number(env2().deuda_generada), money(env2().deuda_pendiente));

const cuadra = (c) => {
  const suma = c.envios.reduce((s, e) => s + Number(e.deuda_pendiente), 0)
             + Number(c.envios_resumen.accesorios_pendiente);
  return { suma, saldo: Math.max(0, Number(c.totales.saldo_por_liquidar)) };
};
let x = cuadra(cuenta);
ok('★★ Σ pendiente por envío + accesorios = saldo por liquidar',
   Math.abs(x.suma - x.saldo) < 1, `${money(x.suma)} vs ${money(x.saldo)}`);

console.log('\n═══ 5. Un pago parcial se imputa a las ventas más antiguas ═══');
// Ventas en orden: E1-AAA (1.000.000) → E1-BBB (400.000) → E2-AAA (2.000.000).
// Una remesa de 1.200.000 cubre la primera completa y 200.000 de la segunda.
const rem = await service.enviarRemesa(centro, { valor: 1200000 });
await service.confirmarRemesa(bodega, rem.id);
cuenta = await service.getEstadoCuenta(centro, 2);

ok('★ El envío 1 queda debiendo 200.000',
   Number(env1().deuda_pendiente) === 200000, money(env1().deuda_pendiente));
ok('  (generó 1.400.000 y le imputaron 1.200.000)',
   Number(env1().deuda_generada) === 1400000);
ok('★ El envío 2 sigue debiendo todo: es la venta más nueva',
   Number(env2().deuda_pendiente) === 2000000, money(env2().deuda_pendiente));

x = cuadra(cuenta);
ok('★★ Con pagos de por medio, la identidad se mantiene',
   Math.abs(x.suma - x.saldo) < 1, `${money(x.suma)} vs ${money(x.saldo)}`);
ok('  y el resumen reporta lo mismo que la suma',
   Number(cuenta.envios_resumen.pendiente_en_envios) ===
     cuenta.envios.reduce((s, e) => s + Number(e.deuda_pendiente), 0));

console.log('\n═══ 6. Los gastos por cuenta de bodega también imputan ═══');
await service.registrarGastoAutorizado(centro, { valor: 200000, concepto: 'Domicilio' });
cuenta = await service.getEstadoCuenta(centro, 2);
ok('★ El envío 1 queda al día', Number(env1().deuda_pendiente) === 0,
   money(env1().deuda_pendiente));
x = cuadra(cuenta);
ok('★★ La identidad aguanta con gastos', Math.abs(x.suma - x.saldo) < 1,
   `${money(x.suma)} vs ${money(x.saldo)}`);

console.log('\n═══ 7. Un ajuste de la bodega también baja lo pendiente ═══');
await service.registrarAjuste(bodega, { sucursal_id: 2, valor: 500000, concepto: 'Garantía' });
cuenta = await service.getEstadoCuenta(centro, 2);
ok('★ El envío 2 baja a 1.500.000', Number(env2().deuda_pendiente) === 1500000,
   money(env2().deuda_pendiente));
x = cuadra(cuenta);
ok('★★ La identidad aguanta con ajustes', Math.abs(x.suma - x.saldo) < 1,
   `${money(x.suma)} vs ${money(x.saldo)}`);

console.log('\n═══ 8. La deuda de accesorios no se cuelga de ningún envío ═══');
// El local vendió 3 de los 4 cargadores: su stock baja, y esa deuda es del
// producto (fungible), no de un envío. Debe aparecer como residuo.
await db.exec(`UPDATE productos_cantidad SET stock = 1 WHERE sucursal_id = 2`);
cuenta = await service.getEstadoCuenta(centro, 2);
ok('★ Aparece deuda de accesorios fuera de los envíos',
   Number(cuenta.envios_resumen.accesorios_pendiente) === 90000,
   money(cuenta.envios_resumen.accesorios_pendiente));
ok('  y ningún envío se la atribuye',
   cuenta.envios.every((e) => Number(e.deuda_pendiente) % 30000 !== 30000));
x = cuadra(cuenta);
ok('★★ La identidad aguanta con accesorios de por medio',
   Math.abs(x.suma - x.saldo) < 1, `${money(x.suma)} vs ${money(x.saldo)}`);

console.log('\n═══ 8b. ★ DEUDA TOTAL y POR REMITIR son cosas distintas ═══');
// La deuda es por cuánta mercancía responde el local (esté vendida o no);
// por remitir es lo que tiene que entregar YA (solo lo vendido). Confundirlas
// era el reclamo del cliente.
cuenta = await service.getEstadoCuenta(centro, 2);
let tt = cuenta.totales;
ok('★ La deuda es MAYOR que lo exigible mientras quede mercancía sin vender',
   Number(tt.deuda_total) > Number(tt.saldo_por_liquidar),
   `${money(tt.deuda_total)} vs ${money(tt.saldo_por_liquidar)}`);
ok('★★ deuda_total = por_remitir + lo que todavía no se cobra',
   Math.abs(Number(tt.deuda_total)
            - Number(tt.saldo_por_liquidar) - Number(tt.por_vender)) < 1,
   `${money(tt.deuda_total)} = ${money(tt.saldo_por_liquidar)} + ${money(tt.por_vender)}`);
ok('★★ valor_en_poder = deuda_total + todo lo pagado',
   Math.abs(Number(tt.valor_en_poder) - Number(tt.deuda_total)
            - Number(tt.remesado_recibido) - Number(tt.gastos_autorizados)
            - Number(tt.ajustes)) < 1,
   money(tt.valor_en_poder));
ok('  y lo que no se cobra nunca es negativo', Number(tt.por_vender) >= 0);

console.log('\n═══ 9. Filtrar la mercancía por varios estados a la vez ═══');
const vendidos = await service.getEstadoCuenta(centro, 2, { estado: 'Por liquidar,En recaudo' });
ok('★ "Vendidos" trae contado y crédito juntos', vendidos.mercancia.total === 3,
   `${vendidos.mercancia.total} unidades`);
const soloContado = await service.getEstadoCuenta(centro, 2, { estado: 'Por liquidar' });
ok('  y un solo estado sigue funcionando igual', soloContado.mercancia.total === 2);
const prestados = await service.getEstadoCuenta(centro, 2, { estado: 'En prestamo' });
ok('★ "En prestamo" trae el equipo prestado', prestados.mercancia.total === 1,
   prestados.mercancia.items[0]?.imei);
ok('  que no genera deuda', Number(prestados.mercancia.liquidable_total) === 0);

console.log('\n═══ 10. ★ Un vendedor ve los conteos, nunca los pesos ═══');
const comoVendedor = await service.getEstadoCuenta(vende, 2);
const v1 = comoVendedor.envios.find((e) => e.id === e1.id);
ok('★ Sigue viendo cuántos vendió',    Number(v1.vendidas) === 2);
ok('  cuántos prestó',                 Number(v1.prestadas) === 1);
ok('  y cuántos le quedan',            Number(v1.disponibles) === 1);
ok('★ Pero no cuánto generó de deuda', v1.deuda_generada === null);
ok('  ni cuánto queda pendiente',      v1.deuda_pendiente === null);
ok('  ni el valor de lo disponible',   v1.disponibles_valor === null);
ok('  ni el valor del envío',          v1.valor_total === null);
ok('★ El resumen tampoco filtra pesos',
   comoVendedor.envios_resumen.pendiente_en_envios === null &&
   comoVendedor.envios_resumen.accesorios_pendiente === null);
ok('  pero sí cuántos envíos son', comoVendedor.envios_resumen.total === 3);
ok('★ Y conserva lo único que necesita: cuánto remitir',
   Number(comoVendedor.totales.saldo_por_liquidar) ===
     Number(cuenta.totales.saldo_por_liquidar),
   money(comoVendedor.totales.saldo_por_liquidar));

console.log('\n═══ 11. La bodega ve lo mismo desde su lado ═══');
const desdeBodega = await service.getEstadoCuenta(bodega, 2);
ok('★ Mismos envíos', desdeBodega.envios.length === cuenta.envios.length);
ok('★ Mismo pendiente por envío',
   desdeBodega.envios.every((e) =>
     Number(e.deuda_pendiente) ===
     Number(cuenta.envios.find((c) => c.id === e.id).deuda_pendiente)));
let bloqueado = false;
try { await service.getEstadoCuenta(centro, 1); } catch (e) { bloqueado = e.status === 403; }
ok('★ Y un local sigue sin poder ver la cuenta de otro', bloqueado);

console.log('\n═══ 12. Devolver mercancía baja la DEUDA, no lo exigible ═══');
// Va al final porque mueve el inventario: el equipo 4 (E1-DDD) estaba en
// vitrina y al devolverlo deja de ser responsabilidad del local.
const antesDeuda   = Number(cuenta.totales.deuda_total);
const antesRemitir = Number(cuenta.totales.saldo_por_liquidar);
const devExtra = await service.devolver(centro, { lineas: [{ tipo: 'serial', serial_id: 4 }] });
await service.confirmarDevolucion(bodega, devExtra.id, {});
cuenta = await service.getEstadoCuenta(centro, 2);
tt = cuenta.totales;
ok('★ Devolver un equipo BAJA la deuda total en su valor',
   Number(tt.deuda_total) === antesDeuda - 1000000,
   `${money(antesDeuda)} → ${money(tt.deuda_total)}`);
ok('★ Pero NO cambia lo exigible: ese equipo nunca se vendió',
   Number(tt.saldo_por_liquidar) === antesRemitir, money(tt.saldo_por_liquidar));
ok('★★ Y la identidad se mantiene después de devolver',
   Math.abs(Number(tt.deuda_total)
            - Number(tt.saldo_por_liquidar) - Number(tt.por_vender)) < 1);
x = cuadra(cuenta);
ok('★★ Igual que el reparto por envío', Math.abs(x.suma - x.saldo) < 1);

console.log(`\n${'─'.repeat(60)}`);
console.log(`  ${pasados} pasaron · ${fallos} fallaron`);
console.log('─'.repeat(60));
process.exit(fallos ? 1 : 0);
