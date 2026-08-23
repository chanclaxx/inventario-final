// ─────────────────────────────────────────────────────────────────────────────
// LA CUENTA DE CADA ENVÍO
//
// Desde agosto de 2026 el ENVÍO es el documento de deuda: el local paga todo lo
// que la bodega le entrega, esté vendido o no. Cada envío tiene su cargo
// (derivado de sus líneas) y sus abonos (escritos, porque a qué envío se imputa
// un pago lo decide una persona).
//
// LA IDENTIDAD QUE SOSTIENE LA PANTALLA:
//
//   Σ saldo(envío) + cargos sueltos = deuda_total
//
// Si se rompe, la cifra grande estaría contando una historia distinta a la de
// las tarjetas de abajo — el descuadre que este módulo existe para evitar.
//
// Y la de la venta, que ahora es al revés: vender NO mueve un peso de esta
// cuenta. Se sigue calculando para contarle al local qué vendió y qué le queda,
// pero el dinero ya no depende de eso.
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
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260822_red_interna_envios.sql'), 'utf8'));

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
    (1,'E2-AAA', 2000000),   -- id 5 · envío 2 · se vende y luego se devuelve
    (1,'E2-BBB', 2000000),   -- id 6 · envío 2 · se devuelve
    (1,'E3-AAA',  500000);   -- id 7 · envío 3 anulado, reusado en el envío 4

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

// Valores del montaje, para no repetirlos en cada cuenta:
//   Envío 1 → 4 equipos × $1.000.000               = $4.000.000
//   Envío 2 → 2 equipos × $2.000.000 + 4 × $30.000 = $4.120.000
//   Envío 3 → anulado, no cobra nada
const CARGO_E1 = 4 * 1000000;
const CARGO_E2 = 2 * 2000000 + 4 * 30000;

console.log('\n═══ 1. El cargo del envío = lo que el local recibió ═══');

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
const env  = (id) => cuenta.envios.find((e) => e.id === id);
const env1 = () => env(e1.id);
const env2 = () => env(e2.id);

ok('★ Aparecen los tres envíos, incluido el anulado', cuenta.envios.length === 3);
ok('  el anulado se lista como Anulada', env(e3.id)?.estado === 'Anulada');
ok('  y no cobra nada', Number(env(e3.id).cargo) === 0);

ok('★ Envío 1: cargo por sus 4 equipos',
   Number(env1().cargo) === CARGO_E1, money(env1().cargo));
ok('  con saldo completo: nadie ha pagado', Number(env1().saldo) === CARGO_E1);
ok('★ Envío 2: los accesorios entran en SU cargo',
   Number(env2().cargo) === CARGO_E2, money(env2().cargo));
ok('  y se cuentan aparte de los equipos',
   Number(env2().accesorios_unidades) === 4 && Number(env2().unidades) === 2);

// La identidad que sostiene toda la pantalla: la cifra grande no es otra cosa
// que la suma de los saldos de los envíos.
const cuadra = (c) => {
  const suma = c.envios.reduce((s, e) => s + Number(e.saldo), 0)
             + Number(c.totales.cargos_sueltos);
  return { suma, deuda: Number(c.totales.deuda_total) };
};
let x = cuadra(cuenta);
ok('★★ Σ saldo de los envíos + cargos sueltos = deuda_total',
   Math.abs(x.suma - x.deuda) < 1, `${money(x.suma)} vs ${money(x.deuda)}`);
ok('  y la deuda es todo lo entregado',
   Number(cuenta.totales.deuda_total) === CARGO_E1 + CARGO_E2,
   money(cuenta.totales.deuda_total));

// La tarjeta del envío muestra sus productos sin desplegar nada, así que las
// líneas tienen que venir con el envío y no en una consulta aparte por tarjeta.
ok('★ Cada envío trae sus líneas', (env1().lineas || []).length === 4,
   `${(env1().lineas || []).length} líneas`);
ok('  con nombre, estado y subtotal',
   env1().lineas.every((l) => l.nombre_producto && l.etiqueta_estado && l.subtotal > 0));
ok('  y el envío 2 incluye la línea de accesorios',
   env2().lineas.some((l) => l.tipo === 'cantidad' && Number(l.cantidad) === 4));

console.log('\n═══ 2. Vender NO mueve la cuenta: solo informa ═══');

await db.exec(`
  INSERT INTO facturas (numero, sucursal_id, nombre_cliente, estado, fecha)
    VALUES (1, 2, 'Ana Pérez',  'Activa', NOW() + INTERVAL '1 minute'),
           (2, 2, 'Luis Gómez', 'Activa', NOW() + INTERVAL '2 minutes'),
           (3, 2, 'Sara Ruiz',  'Activa', NOW() + INTERVAL '3 minutes');
  INSERT INTO lineas_factura (factura_id, nombre_producto, imei, cantidad, precio)
    VALUES (1, 'iPhone 13', 'E1-AAA', 1, 1500000),
           (2, 'iPhone 13', 'E1-BBB', 1, 1600000),
           (3, 'iPhone 13', 'E2-AAA', 1, 2800000);
  -- La 2 es a crédito y solo abonaron 400.000 de 1.600.000. Antes eso decidía
  -- cuánto debía el local; ahora el riesgo del crédito es suyo y a la bodega le
  -- debe el equipo completo desde que lo recibió.
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
ok('★★ Y el saldo del envío 1 no se movió ni un peso',
   Number(env1().saldo) === CARGO_E1, money(env1().saldo));
ok('★★ Tampoco el del envío 2, con su venta a crédito a medio recaudar',
   Number(env2().saldo) === CARGO_E2, money(env2().saldo));

console.log('\n═══ 3. Devolver un equipo baja el cargo de SU envío ═══');
const dev = await service.devolver(centro, { lineas: [{ tipo: 'serial', serial_id: 6 }] });
await service.confirmarDevolucion(bodega, dev.id, {});
cuenta = await service.getEstadoCuenta(centro, 2);
const CARGO_E2B = CARGO_E2 - 2000000;   // 2.120.000

ok('★ Envío 2 marca 1 devuelto', Number(env2().devueltas) === 1);
ok('★★ Y su cargo baja el valor del equipo, sin contra-asiento',
   Number(env2().cargo) === CARGO_E2B, money(env2().cargo));
ok('  el envío 1 ni se entera', Number(env1().cargo) === CARGO_E1);
x = cuadra(cuenta);
ok('★★ La identidad aguanta tras la devolución',
   Math.abs(x.suma - x.deuda) < 1, `${money(x.suma)} vs ${money(x.deuda)}`);

console.log('\n═══ 4. Abono DIRIGIDO: paga el envío que el local elija ═══');
const abono1 = await service.enviarRemesa(centro, { valor: 1000000, remision_id: e2.id });
await service.confirmarRemesa(bodega, abono1.id);
cuenta = await service.getEstadoCuenta(centro, 2);
ok('★ Se imputó al envío 2, que es el que se eligió',
   Number(env2().abonado) === 1000000 && Number(env2().saldo) === CARGO_E2B - 1000000,
   money(env2().saldo));
ok('★ El envío 1 sigue intacto, aunque sea el más viejo',
   Number(env1().abonado) === 0, money(env1().saldo));
ok('  y el reparto viene en la respuesta', abono1.reparto.length === 1);

console.log('\n═══ 5. Pago TOTAL: del envío más viejo al más nuevo ═══');
const total = await service.enviarRemesa(centro, { valor: 4500000 });
await service.confirmarRemesa(bodega, total.id);
cuenta = await service.getEstadoCuenta(centro, 2);
ok('★ Tapó el envío 1 completo primero', Number(env1().saldo) === 0, money(env1().saldo));
ok('  y quedó marcado como pagado', env1().pagado === true);
ok('★ Y el resto se fue al envío 2',
   Number(env2().saldo) === CARGO_E2B - 1000000 - 500000, money(env2().saldo));
ok('★ Un solo pago produjo DOS abonos, uno por envío', total.reparto.length === 2);
ok('  sin guardar el total en ninguna parte: se deriva sumando',
   total.reparto.reduce((s, r) => s + r.valor, 0) === 4500000);
x = cuadra(cuenta);
ok('★★ La identidad aguanta con pagos de por medio',
   Math.abs(x.suma - x.deuda) < 1, `${money(x.suma)} vs ${money(x.deuda)}`);

console.log('\n═══ 6. Gastos y ajustes entran por el MISMO reparto ═══');
await service.registrarGastoAutorizado(centro, { valor: 200000, concepto: 'Domicilio' });
await service.registrarAjuste(bodega, { sucursal_id: 2, valor: 100000, concepto: 'Garantía' });
cuenta = await service.getEstadoCuenta(centro, 2);
const SALDO_E2 = CARGO_E2B - 1000000 - 500000 - 200000 - 100000;   // 320.000
ok('★ El gasto y el ajuste taparon el envío abierto',
   Number(env2().saldo) === SALDO_E2, money(env2().saldo));
ok('  el envío 1, ya pagado, no recibe nada', Number(env1().saldo) === 0);
x = cuadra(cuenta);
ok('★★ La identidad aguanta con gastos y ajustes',
   Math.abs(x.suma - x.deuda) < 1, `${money(x.suma)} vs ${money(x.deuda)}`);

console.log('\n═══ 7. Una remesa sin confirmar reserva, pero no baja la deuda ═══');
const pendiente = await service.enviarRemesa(centro, { valor: 100000 });
cuenta = await service.getEstadoCuenta(centro, 2);
ok('★ El saldo del envío NO baja hasta que la bodega confirme',
   Number(env2().saldo) === SALDO_E2, money(env2().saldo));
ok('  pero se ve en tránsito', Number(cuenta.totales.remesas_en_transito) === 100000);
// La reserva existe para que un segundo pago no vuelva a tapar lo mismo.
const segundo = await service.enviarRemesa(centro, { valor: 100000 });
ok('★★ Un segundo pago NO vuelve a imputar lo que el primero ya reservó',
   segundo.reparto.reduce((s, r) => s + r.valor, 0) === 100000
   && Number(segundo.sobrante) === 0);

console.log('\n   … y anular la remesa libera su imputación');
await service.anularRemesa(centro, pendiente.id);
await service.anularRemesa(centro, segundo.id);
cuenta = await service.getEstadoCuenta(centro, 2);
ok('★ El envío vuelve a deber lo mismo', Number(env2().saldo) === SALDO_E2,
   money(env2().saldo));

console.log('\n═══ 8. Devolver algo YA PAGADO deja saldo a favor ═══');
// El equipo 5 (E2-AAA) está vendido; para devolverlo hay que deshacer la venta.
await db.exec(`
  UPDATE seriales SET vendido = FALSE WHERE imei = 'E2-AAA';
  UPDATE facturas SET estado = 'Cancelada' WHERE id = 3;
`);
const devPagada = await service.devolver(centro, { lineas: [{ tipo: 'serial', serial_id: 5 }] });
await service.confirmarDevolucion(bodega, devPagada.id, {});
cuenta = await service.getEstadoCuenta(centro, 2);
const FAVOR = 2000000 - SALDO_E2;   // el cargo cayó 2.000.000 sobre un saldo de 320.000
ok('★ El envío 2 queda sobre-pagado', Number(env2().excedente) === FAVOR,
   money(env2().excedente));
ok('  y su saldo se queda en 0, nunca negativo', Number(env2().saldo) === 0);
ok('★★ El exceso se vuelve saldo a favor del local',
   Number(cuenta.totales.saldo_a_favor) === FAVOR, money(cuenta.totales.saldo_a_favor));
ok('★★ Y lo por pagar nunca queda negativo: la bodega no le debe plata',
   Number(cuenta.totales.saldo_por_liquidar) === 0);

console.log('\n   … y el próximo envío se lo descuenta solo');
const e4 = await service.despachar(bodega, {
  sucursal_destino_id: 2, lineas: [{ tipo: 'serial', serial_id: 7 }],   // $500.000
});
const rec4 = await recibirTodo(e4.id);
cuenta = await service.getEstadoCuenta(centro, 2);
ok('★ Al recibirlo se aplicó el crédito sin que nadie hiciera nada',
   Number(rec4.saldo_favor_aplicado) === 500000, money(rec4.saldo_favor_aplicado));
ok('  el envío nuevo nace pagado', Number(env(e4.id).saldo) === 0);
ok('  y el crédito baja en esos 500.000',
   Number(cuenta.totales.saldo_a_favor) === FAVOR - 500000,
   money(cuenta.totales.saldo_a_favor));

console.log('\n═══ 9. Un ajuste EN CONTRA no cuelga de ningún envío ═══');
await service.registrarAjuste(bodega, {
  sucursal_id: 2, valor: -300000, concepto: 'Equipo roto en el local',
});
cuenta = await service.getEstadoCuenta(centro, 2);
ok('★ Suma como cargo suelto', Number(cuenta.totales.cargos_sueltos) === 300000,
   money(cuenta.totales.cargos_sueltos));
ok('  y ningún envío se lo atribuye',
   cuenta.envios.every((e) => Number(e.saldo) === 0));
x = cuadra(cuenta);
ok('★★ La identidad aguanta con cargos sueltos',
   Math.abs(x.suma - x.deuda) < 1, `${money(x.suma)} vs ${money(x.deuda)}`);

console.log('\n═══ 10. El extracto cuadra con la cuenta ═══');
const sumaExtracto = cuenta.extracto.reduce((s, e) => s + Number(e.valor), 0);
ok('★★ Σ movimientos del extracto = posición neta del local',
   Math.abs(sumaExtracto - Number(cuenta.totales.neto)) < 1,
   `${money(sumaExtracto)} vs ${money(cuenta.totales.neto)}`);
ok('  y las ventas van en 0 (son informativas)',
   cuenta.extracto.filter((e) => e.origen === 'venta').every((e) => Number(e.valor) === 0));

console.log('\n═══ 11. Filtrar la mercancía por varios estados a la vez ═══');
const vendidos = await service.getEstadoCuenta(centro, 2, { estado: 'Por liquidar,En recaudo' });
ok('★ "Vendidos" trae contado y crédito juntos', vendidos.mercancia.total === 2,
   `${vendidos.mercancia.total} unidades`);
const prestados = await service.getEstadoCuenta(centro, 2, { estado: 'En prestamo' });
ok('★ "En prestamo" trae el equipo prestado', prestados.mercancia.total === 1,
   prestados.mercancia.items[0]?.imei);

console.log('\n═══ 12. ★ Un vendedor ve la CUENTA, nunca el costo de la mercancía ═══');
const comoVendedor = await service.getEstadoCuenta(vende, 2);
const v1 = comoVendedor.envios.find((e) => e.id === e1.id);
ok('★ Sigue viendo cuántos vendió',    Number(v1.vendidas) === 2);
ok('  cuántos prestó',                 Number(v1.prestadas) === 1);
ok('  y cuántos le quedan',            Number(v1.disponibles) === 1);
ok('★★ Y SÍ ve lo que debe de cada envío: sin eso no podría pagar',
   Number(v1.saldo) === Number(env1().saldo) && Number(v1.cargo) === Number(env1().cargo),
   money(v1.cargo));
ok('★★ Las líneas del envío llegan sin valor',
   v1.lineas.every((l) => l.valor_interno === null && l.subtotal === null));
ok('  pero con el producto y su estado',
   v1.lineas.every((l) => l.nombre_producto && l.etiqueta_estado));
ok('★ Pero no el valor de lo disponible', v1.disponibles_valor === null);
ok('  ni el valor de lo vendido',        v1.vendidas_valor === null);
ok('  ni el valor total del envío',      v1.valor_total === null);
ok('★ Ni la valorización de la mercancía en los totales',
   comoVendedor.totales.en_vitrina_valor === null &&
   comoVendedor.totales.vendido_valor === null);
ok('★ Y el desglose tampoco la filtra por la puerta de atrás',
   comoVendedor.desglose.respaldo.valor === null,
   'esta era la fuga: el desglose se colaba sin recortar');
ok('★ Conserva lo único que necesita: cuánto pagar',
   Number(comoVendedor.totales.saldo_por_liquidar) ===
     Number(cuenta.totales.saldo_por_liquidar),
   money(comoVendedor.totales.saldo_por_liquidar));

console.log('\n═══ 13. La bodega ve lo mismo desde su lado ═══');
const desdeBodega = await service.getEstadoCuenta(bodega, 2);
ok('★ Mismos envíos', desdeBodega.envios.length === cuenta.envios.length);
ok('★ Mismo saldo por envío',
   desdeBodega.envios.every((e) =>
     Number(e.saldo) === Number(cuenta.envios.find((c) => c.id === e.id).saldo)));
let bloqueado = false;
try { await service.getEstadoCuenta(centro, 1); } catch (e) { bloqueado = e.status === 403; }
ok('★ Y un local sigue sin poder ver la cuenta de otro', bloqueado);

console.log(`\n${'─'.repeat(60)}`);
console.log(`  ${pasados} pasaron · ${fallos} fallaron`);
console.log('─'.repeat(60));
process.exit(fallos ? 1 : 0);
