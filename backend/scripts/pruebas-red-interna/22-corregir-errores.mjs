// ─────────────────────────────────────────────────────────────────────────────
// CORREGIR LO QUE SALIÓ MAL
//
// El módulo ya tenía una buena gramática para lo delicado: nada que mueva
// mercancía o plata entre las dos partes queda firme hasta que la OTRA
// confirma. Lo que faltaba era aplicar esa misma regla a lo que toca la cuenta
// directamente, y dar salida a los errores de todos los días.
//
// Lo que se verifica aquí:
//   • un GASTO del local no le baja la deuda hasta que la bodega lo apruebe
//     (antes bajaba sola: un local podía rebajarse la deuda y la bodega se
//     enteraba solo si entraba a mirar)
//   • rechazarlo tumba su imputación y los envíos vuelven a quedar abiertos
//   • un gasto o un ajuste mal tecleado se pueden ANULAR — la columna `anulado`
//     existía desde la primera migración y ningún código la ponía en TRUE
//   • una remesa YA CONFIRMADA la puede revertir la bodega, con su tesorería
//   • un abono que entró al envío equivocado se puede mover
//   • lo que "se recibió" y nunca llegó se reporta después
//   • y cada quien solo puede deshacer lo suyo
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
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260823_red_interna_control.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260823_red_interna_cargos_pagables.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260823_remision_variantes.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260823_lotes_cantidad.sql'), 'utf8'));

const conectar = (t) => ({ query: (s, p) => t.query(s, p ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

const service = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));
const repo    = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.repository.js'));

let fallos = 0, pasados = 0;
const q = async (s, p = []) => (await db.query(s, p)).rows;
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
  INSERT INTO lineas_producto (negocio_id, nombre) VALUES (1,'Celulares');

  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id, linea_id)
    VALUES ('iPhone 13','Apple','128GB', 2600000, 1, 1);
  INSERT INTO seriales (producto_id, imei, costo_compra) VALUES
    (1,'AAA111', 1000000),   -- id 1 · envío 1
    (1,'AAA222', 1000000),   -- id 2 · envío 1
    (1,'BBB111', 2000000),   -- id 3 · envío 2
    (1,'BBB222', 2000000);   -- id 4 · envío 2 · "recibido" pero nunca llegó

  INSERT INTO cuentas_dinero (negocio_id, sucursal_id, nombre, tipo, metodos_pago)
    VALUES (1,1,'Efectivo','efectivo',ARRAY['Efectivo']),
           (1,2,'Efectivo','efectivo',ARRAY['Efectivo']);
  INSERT INTO aperturas_caja (sucursal_id) VALUES (1),(2);
`);

const red = { activa:true, bodega_id:1, confirmar_recepcion:true, confirmar_remesa:true,
              ocultar_costos:false };
const bodega = { user:{id:1,negocio_id:1,rol:'admin_negocio'}, sucursal_id:1, esBodega:true, red };
const centro = { user:{id:2,negocio_id:1,rol:'supervisor'},    sucursal_id:2, esBodega:false, red };

const recibirTodo = async (id, req = centro) => {
  const lineas = await repo.getLineasRemision(id);
  return service.recibir(req, id, { lineas_recibidas: lineas.map((l) => Number(l.id)) });
};
const deuda = async () =>
  Number((await service.getEstadoCuenta(centro, 2)).totales.deuda_total);

// Dos envíos: $2.000.000 y $4.000.000.
const e1 = await service.despachar(bodega, {
  sucursal_destino_id: 2,
  lineas: [{ tipo:'serial', serial_id:1 }, { tipo:'serial', serial_id:2 }],
});
await recibirTodo(e1.id);
const e2 = await service.despachar(bodega, {
  sucursal_destino_id: 2,
  lineas: [{ tipo:'serial', serial_id:3 }, { tipo:'serial', serial_id:4 }],
});
await recibirTodo(e2.id);

console.log('\n═══ 1. El gasto del local NO baja la deuda hasta que la bodega apruebe ═══');
const deudaInicial = await deuda();
ok('Punto de partida', deudaInicial === 6000000, money(deudaInicial));

const gasto = await service.registrarGastoAutorizado(centro, {
  valor: 500000, concepto: 'Domicilio urgente',
});
ok('★ Nace "Por aprobar"', gasto.estado === 'Por aprobar', gasto.estado);
ok('★★ La deuda NO se movió', (await deuda()) === deudaInicial, money(await deuda()));
ok('  pero la plata SÍ salió de la caja del local: eso pasó de verdad',
   (await q(`SELECT COUNT(*)::int c FROM movimientos_caja WHERE activo AND tipo = 'Egreso'`))[0].c === 1);

const bandeja = await service.getPanelBodega(bodega);
ok('★ Le aparece a la bodega en su bandeja',
   (bandeja.gastos_por_aprobar || []).some((g) => g.id === gasto.id),
   `${(bandeja.gastos_por_aprobar || []).length} por aprobar`);
ok('  con el nombre del local', bandeja.gastos_por_aprobar[0].sucursal_nombre === 'Centro');
ok('★ Y el local ve el suyo esperando', (await service.getEstadoCuenta(centro, 2))
   .movimientos_cuenta.some((m) => m.id === gasto.id && m.estado === 'Por aprobar'));

console.log('\n   … la bodega lo RECHAZA');
await service.decidirGasto(bodega, gasto.id, { aprobar: false, motivo: 'No estaba autorizado' });
ok('★★ La deuda sigue igual', (await deuda()) === deudaInicial, money(await deuda()));
const abonosRechazado = await q(
  `SELECT anulado FROM abonos_remision WHERE movimiento_id = $1`, [gasto.id]);
ok('★ Su imputación se cayó', abonosRechazado.every((a) => a.anulado === true),
   `${abonosRechazado.length} abono(s)`);

console.log('\n   … otro gasto, y esta vez lo aprueba');
const gasto2 = await service.registrarGastoAutorizado(centro, {
  valor: 500000, concepto: 'Transporte',
});
await service.decidirGasto(bodega, gasto2.id, { aprobar: true });
ok('★★ Ahora sí baja la deuda', (await deuda()) === deudaInicial - 500000, money(await deuda()));

console.log('\n═══ 2. Un gasto o un ajuste mal tecleado se pueden anular ═══');
const ajuste = await service.registrarAjuste(bodega, {
  sucursal_id: 2, valor: 3000000, concepto: 'Dedazo: sobra un cero',
});
ok('El ajuste baja la deuda', (await deuda()) === deudaInicial - 500000 - 3000000);

await service.anularMovimientoCuenta(bodega, ajuste.id, { motivo: 'Me equivoqué' });
ok('★★ Anularlo la devuelve a donde estaba',
   (await deuda()) === deudaInicial - 500000, money(await deuda()));
const ajusteFila = await q(`SELECT anulado FROM movimientos_cuenta_interna WHERE id = $1`, [ajuste.id]);
ok('  y queda marcado, no borrado: el rastro se conserva', ajusteFila[0].anulado === true);

console.log('\n   … y anular un gasto devuelve también la plata a la caja');
const cajaAntes = (await q(
  `SELECT COUNT(*)::int c FROM movimientos_caja WHERE activo AND tipo = 'Egreso'`))[0].c;
await service.anularMovimientoCuenta(bodega, gasto2.id, {});
ok('★★ La deuda vuelve a subir', (await deuda()) === deudaInicial, money(await deuda()));
const cajaDespues = (await q(
  `SELECT COUNT(*)::int c FROM movimientos_caja WHERE activo AND tipo = 'Egreso'`))[0].c;
ok('★ Y el egreso de caja se desactiva', cajaDespues === cajaAntes - 1,
   `${cajaAntes} → ${cajaDespues}`);

console.log('\n═══ 3. Cada quien deshace lo suyo ═══');
const gasto3 = await service.registrarGastoAutorizado(centro, { valor: 100000, concepto: 'Otro' });
let puedeLocal = true;
try { await service.anularMovimientoCuenta(centro, gasto3.id, {}); }
catch { puedeLocal = false; }
ok('★ El local SÍ puede anular su gasto mientras nadie lo aprueba', puedeLocal);

const gasto4 = await service.registrarGastoAutorizado(centro, { valor: 100000, concepto: 'Aprobado ya' });
await service.decidirGasto(bodega, gasto4.id, { aprobar: true });
let bloqueado = null;
try { await service.anularMovimientoCuenta(centro, gasto4.id, {}); }
catch (e) { bloqueado = e; }
ok('★★ Pero NO uno que la bodega ya aprobó', bloqueado?.status === 409, bloqueado?.message);

const ajuste2 = await service.registrarAjuste(bodega, {
  sucursal_id: 2, valor: -50000, concepto: 'Rotura',
});
let ajusteAjeno = null;
try { await service.anularMovimientoCuenta(centro, ajuste2.id, {}); }
catch (e) { ajusteAjeno = e; }
ok('★ Y un local nunca puede anular un ajuste de la bodega', ajusteAjeno?.status === 403,
   ajusteAjeno?.message);

let decideLocal = null;
try { await service.decidirGasto(centro, gasto3.id, { aprobar: true }); }
catch (e) { decideLocal = e; }
ok('★★ Ni aprobarse sus propios gastos', decideLocal?.status === 403, decideLocal?.message);

console.log('\n═══ 4. Revertir una remesa que la bodega ya confirmó ═══');
await service.anularMovimientoCuenta(bodega, gasto4.id, {});
await service.anularMovimientoCuenta(bodega, ajuste2.id, {});
const deudaLimpia = await deuda();

const pago = await service.enviarRemesa(centro, { valor: 2000000, remision_id: e1.id });
await service.confirmarRemesa(bodega, pago.id);
ok('El pago bajó la deuda', (await deuda()) === deudaLimpia - 2000000, money(await deuda()));

let localNoPuede = null;
try { await service.anularRemesa(centro, pago.id); }
catch (e) { localNoPuede = e; }
ok('★★ El local NO puede revertir lo que la bodega ya confirmó',
   localNoPuede?.status === 403, localNoPuede?.message);

await service.anularRemesa(bodega, pago.id);
ok('★★ La bodega sí, y la deuda vuelve', (await deuda()) === deudaLimpia, money(await deuda()));
const envio1 = (await service.getEstadoCuenta(centro, 2)).envios.find((e) => e.id === e1.id);
ok('★ El envío que tapaba vuelve a quedar abierto', Number(envio1.saldo) === 2000000,
   money(envio1.saldo));
// La plata del negocio tiene que cuadrar. Lo único que queda "de menos" es el
// gasto RECHAZADO: esos $500.000 salieron de verdad de la caja del local y, al
// rechazarlos la bodega, se los come el local. No hay plata colgada en tránsito.
const cuentas = await q(`
  SELECT COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE -valor END), 0) AS saldo
  FROM movimientos_dinero WHERE activo`);
ok('★★ No queda plata colgada en tránsito (solo el gasto que rechazaron)',
   Number(cuentas[0].saldo) === -500000, money(cuentas[0].saldo));
const transito = await q(`
  SELECT COALESCE(SUM(CASE WHEN m.tipo='entrada' THEN m.valor ELSE -m.valor END), 0) AS saldo
  FROM movimientos_dinero m JOIN cuentas_dinero c ON c.id = m.cuenta_id
  WHERE m.activo AND c.tipo = 'transito'`);
ok('★★ La cuenta de tránsito queda en cero', Number(transito[0].saldo) === 0,
   money(transito[0].saldo));
const conceptoRechazado = await q(`
  SELECT concepto FROM movimientos_dinero WHERE id = $1`, [gasto.mov_dinero_id]);
ok('★ Y el gasto rechazado deja de decir que era por cuenta de la bodega',
   /rechaz/i.test(conceptoRechazado[0].concepto), conceptoRechazado[0].concepto);

console.log('\n═══ 5. Mover un abono al envío correcto ═══');
const pago2 = await service.enviarRemesa(centro, { valor: 1000000, remision_id: e1.id });
await service.confirmarRemesa(bodega, pago2.id);
const abono = (await repo.getAbonosDeEnvio(1, e1.id)).find((a) => !a.anulado);
ok('El abono entró al envío 1', Number(abono.valor) === 1000000);

await service.moverAbono(centro, abono.id, { remision_id: e2.id });
const cuentaTrasMover = await service.getEstadoCuenta(centro, 2);
const v1 = cuentaTrasMover.envios.find((e) => e.id === e1.id);
const v2 = cuentaTrasMover.envios.find((e) => e.id === e2.id);
ok('★★ El envío 1 vuelve a deber todo', Number(v1.saldo) === 2000000, money(v1.saldo));
ok('★★ Y el envío 2 queda abonado', Number(v2.abonado) === 1000000, money(v2.abonado));
ok('★ La deuda TOTAL no cambió: solo se movió de tarjeta',
   Number(cuentaTrasMover.totales.deuda_total) === deudaLimpia - 1000000,
   money(cuentaTrasMover.totales.deuda_total));

console.log('\n═══ 6. Lo que "se recibió" y nunca llegó ═══');
// El local tocó "Recibí todo" y una caja no venía. El equipo figura en su
// inventario y en su deuda, pero está en la bodega.
const deudaAntesReclamo = Number(cuentaTrasMover.totales.deuda_total);
const reclamo = await service.devolver(centro, {
  lineas: [{ tipo: 'serial', serial_id: 4 }],
  motivo: 'faltante',
  notas: 'Nunca llegó en la caja',
});
ok('★ Nace como un reclamo en tránsito', reclamo.estado === 'En transito');
ok('  marcado como faltante, no como devolución', reclamo.motivo === 'faltante');
ok('★★ La deuda todavía no baja: la bodega tiene que confirmarlo',
   (await deuda()) === deudaAntesReclamo, money(await deuda()));

await service.confirmarDevolucion(bodega, reclamo.id, {});
ok('★★ Confirmado, el cargo de su envío baja',
   (await deuda()) === deudaAntesReclamo - 2000000, money(await deuda()));

const lineaFaltante = await q(`
  SELECT lr.estado_linea FROM lineas_remision lr
  WHERE lr.remision_id = $1 AND lr.serial_id = 4`, [e2.id]);
// La línea queda 'Devuelta' — entró al cargo y salió. 'Faltante' significa
// "nunca entró", que es lo que pasa cuando el local lo rechaza AL recibir.
// El "nunca llegó" de este caso vive en el motivo del reclamo.
ok('★★ La línea sale del cargo', lineaFaltante[0].estado_linea === 'Devuelta',
   lineaFaltante[0].estado_linea);
const motivoReclamo = await q(`SELECT motivo FROM remisiones WHERE id = $1`, [reclamo.id]);
ok('★★ Y queda escrito que fue un faltante, no una devolución',
   motivoReclamo[0].motivo === 'faltante', motivoReclamo[0].motivo);
const dondeEsta = await q(`
  SELECT ps.sucursal_id FROM seriales s
  JOIN productos_serial ps ON ps.id = s.producto_id WHERE s.id = 4`);
ok('★ El equipo vuelve al inventario de la bodega, que es donde estaba',
   dondeEsta[0].sucursal_id === 1);

console.log('\n═══ 7. Un CARGO es un documento que se paga ═══');
// EL BUG REPORTADO DESDE PRODUCCIÓN:
//     "Todos tus envíos están pagados.
//      Más $830.000 de cargos que no vienen de un envío.
//      Y $586.010 a tu favor para el próximo."
//
// Deber y tener a favor al mismo tiempo. El motivo: un ajuste en contra subía
// la deuda pero no era un documento, así que `_imputarFIFO` —que solo repartía
// entre ENVÍOS— nunca lo tocaba. Con los envíos al día, el dinero se volvía
// saldo a favor y el cargo se quedaba ahí. Impagable.
const cargoRoto = await service.registrarAjuste(bodega, {
  sucursal_id: 2, valor: -800000, concepto: 'Equipo roto en el local',
});
let cta = await service.getEstadoCuenta(centro, 2);
ok('★ El cargo aparece como un documento con su saldo',
   (cta.cargos || []).some((c) => c.cargo_id === cargoRoto.id && Number(c.saldo) === 800000),
   `${(cta.cargos || []).length} cargo(s)`);
ok('  y suma a la deuda por su saldo', Number(cta.totales.cargos_sueltos) === 800000,
   money(cta.totales.cargos_sueltos));

console.log('\n   … y se puede PAGAR, que antes era imposible');
const pagoCargo = await service.enviarRemesa(centro, {
  valor: 300000, cargo_id: cargoRoto.id,
});
await service.confirmarRemesa(bodega, pagoCargo.id);
cta = await service.getEstadoCuenta(centro, 2);
const elCargo = cta.cargos.find((c) => c.cargo_id === cargoRoto.id);
ok('★★ El abono entró al cargo', Number(elCargo.abonado) === 300000, money(elCargo.abonado));
ok('  y su saldo baja', Number(elCargo.saldo) === 500000, money(elCargo.saldo));
ok('  igual que la deuda', Number(cta.totales.cargos_sueltos) === 500000,
   money(cta.totales.cargos_sueltos));

console.log('\n   … el FIFO lo reparte junto con los envíos');
const pagoTotal = await service.enviarRemesa(centro, { valor: 10000000 });
await service.confirmarRemesa(bodega, pagoTotal.id);
ok('★★ Un pago total también tapa el cargo',
   pagoTotal.reparto.some((r) => r.tipo === 'cargo'),
   pagoTotal.reparto.map((r) => r.tipo).join(', '));
cta = await service.getEstadoCuenta(centro, 2);
ok('★★ Y ya no queda nada debiendo', Number(cta.totales.deuda_total) === 0,
   money(cta.totales.deuda_total));

console.log('\n═══ 7b. ★★ Deber y tener a favor NO pueden convivir ═══');
// Lo que sobró del pago total quedó a favor. Si ahora la bodega hace un cargo,
// ese crédito tiene que consumirlo de inmediato — no esperar a un envío que
// quizá no llega nunca.
const favorAntes = Number(cta.totales.saldo_a_favor);
ok('El local quedó con saldo a favor', favorAntes > 0, money(favorAntes));

await service.registrarAjuste(bodega, {
  sucursal_id: 2, valor: -200000, concepto: 'Otra rotura',
});
cta = await service.getEstadoCuenta(centro, 2);
ok('★★ El cargo nuevo se cubre solo con el crédito que ya tenía',
   Number(cta.totales.cargos_sueltos) === 0, money(cta.totales.cargos_sueltos));
ok('  y el crédito baja en ese valor',
   Number(cta.totales.saldo_a_favor) === favorAntes - 200000,
   money(cta.totales.saldo_a_favor));
ok('★★ INVARIANTE: si hay saldo a favor, no hay deuda abierta',
   !(Number(cta.totales.saldo_a_favor) > 0 && Number(cta.totales.deuda_total) > 0),
   `deuda ${money(cta.totales.deuda_total)} · a favor ${money(cta.totales.saldo_a_favor)}`);

console.log('\n═══ 8. La identidad aguanta después de todo esto ═══');
const final = await service.getEstadoCuenta(centro, 2);
const suma = final.envios.reduce((s, e) => s + Number(e.saldo), 0)
           + final.cargos.reduce((s, c) => s + Number(c.saldo), 0);
ok('★★ Σ saldo de TODOS los documentos (envíos y cargos) = deuda_total',
   Math.abs(suma - Number(final.totales.deuda_total)) < 1,
   `${money(suma)} vs ${money(final.totales.deuda_total)}`);
const sumaExtracto = final.extracto.reduce((s, e) => s + Number(e.valor), 0);
ok('★★ Σ extracto = posición neta',
   Math.abs(sumaExtracto - Number(final.totales.neto)) < 1,
   `${money(sumaExtracto)} vs ${money(final.totales.neto)}`);

console.log(`\n${'─'.repeat(60)}`);
console.log(`  ${pasados} pasaron · ${fallos} fallaron`);
console.log('─'.repeat(60));
process.exit(fallos ? 1 : 0);
