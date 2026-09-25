// ─────────────────────────────────────────────────────────────────────────────
// MORA EN LOS ENVÍOS DE LA RED INTERNA
//
// El envío es una deuda desde agosto de 2026; ahora también tiene PLAZO. Esta
// suite sostiene cuatro cosas, en este orden de importancia:
//
//   1. APAGADA, NADA CAMBIA. Sin la migración o sin `red_interna_mora_activa`
//      el despacho, la recepción, el reparto de un pago y la cuenta son los de
//      siempre. Es lo que protege a los negocios que ya operan la red.
//   2. LA MORA NO ES MARGEN. Ni un peso de mora entra en `abonos_remision`,
//      que es lo que los reportes suman como "lo cobrado" del envío.
//   3. LA CUENTA CUADRA. La identidad de capital (Σ saldo de documentos =
//      deuda_total) no se mueve, el extracto sigue sumando la posición neta, y
//      la plata que fue a mora no reaparece como saldo a favor.
//   4. TODO SE DESHACE. Anular el pago o rechazar el gasto devuelve la mora a
//      pendiente; condonar deja rastro y también se puede anular.
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

// Todo el SQL que se emite, para comprobar que sin la feature ninguna consulta
// nombra lo nuevo.
const emitido = [];
const espiar = (obj) => {
  const q = obj.query;
  obj.query = (s, p) => { emitido.push(String(s)); return q(s, p); };
};
espiar(pool);
const connectOriginal = pool.connect;
pool.connect = async () => { const c = await connectOriginal(); espiar(c); return c; };

const columnas = require(path.join(RAIZ, 'src/config/columnas.js'));
const service  = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));
const repo     = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.repository.js'));
const moraRed  = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.mora.js'));
const mw       = require(path.join(RAIZ, 'src/middlewares/redInterna.middleware.js'));
const bcrypt   = require('bcryptjs');

let fallos = 0, pasados = 0;
const money = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('es-CO');
function ok(nombre, cond, detalle = '') {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos++;
}
const cerca = (a, b) => Math.abs(Number(a) - Number(b)) < 1;

await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Test');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Bodega'),(1,'Centro'),(1,'Norte');
  INSERT INTO usuarios (nombre) VALUES ('Admin'),('Supervisor'),('Vendedor');
  INSERT INTO config_negocio VALUES (1,'red_interna_activa','1'),(1,'red_interna_bodega_id','1');
  INSERT INTO lineas_producto (negocio_id, nombre) VALUES (1,'Celulares'),(1,'Accesorios');
  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id, linea_id)
    VALUES ('iPhone 13','Apple','128GB', 2600000, 1, 1);
  INSERT INTO seriales (producto_id, imei, costo_compra)
    SELECT 1, 'IMEI-' || g, 1000000 FROM generate_series(1, 30) g;
  INSERT INTO cuentas_dinero (negocio_id, sucursal_id, nombre, tipo, metodos_pago)
    VALUES (1,1,'Efectivo','efectivo',ARRAY['Efectivo']),
           (1,2,'Efectivo','efectivo',ARRAY['Efectivo']),
           (1,3,'Efectivo','efectivo',ARRAY['Efectivo']);
  INSERT INTO aperturas_caja (sucursal_id) VALUES (1),(2),(3);
`);

const pinHash = await bcrypt.hash('1234', 4);
await db.query(`INSERT INTO config_negocio VALUES (1,'pin_eliminacion',$1)`, [pinHash]);

// Las peticiones de prueba, con el `req.red` que armaría el middleware.
const armar = async () => {
  mw.invalidarCache(1);
  const red = await mw.getConfigRed(1);
  return {
    bodega: { user: { id: 1, negocio_id: 1, rol: 'admin_negocio' }, sucursal_id: 1, esBodega: true,  red },
    superB: { user: { id: 2, negocio_id: 1, rol: 'supervisor' },    sucursal_id: 1, esBodega: true,  red },
    centro: { user: { id: 2, negocio_id: 1, rol: 'supervisor' },    sucursal_id: 2, esBodega: false, red },
    vende:  { user: { id: 3, negocio_id: 1, rol: 'vendedor' },      sucursal_id: 2, esBodega: false, red },
    norte:  { user: { id: 2, negocio_id: 1, rol: 'supervisor' },    sucursal_id: 3, esBodega: false, red },
    adminLocal: { user: { id: 1, negocio_id: 1, rol: 'admin_negocio' }, sucursal_id: 2, esBodega: false, red },
  };
};

let serial = 1;
const despacharYRecibir = async (r, n, destino = 2, extra = {}) => {
  const lineas = Array.from({ length: n }, () => ({ tipo: 'serial', serial_id: serial++ }));
  const e = await service.despachar(r.bodega, { sucursal_destino_id: destino, lineas, ...extra });
  await service.recibir(destino === 2 ? r.centro : r.norte, e.id);
  return e;
};

// Mueve la fecha límite al pasado: es la única forma honesta de simular días
// de atraso sin tocar el reloj. `dias` = cuántos días lleva vencido HOY.
const vencerHace = async (remisionId, dias) => {
  await db.query(
    `UPDATE remisiones SET fecha_limite = (NOW() AT TIME ZONE 'America/Bogota')::date - $2::int WHERE id = $1`,
    [remisionId, dias]
  );
};
// Y la recepción al mismo pasado, para que los abonos de hoy caigan después.
const cuenta = (r, suc = 2) => service.getEstadoCuenta(r.centro.sucursal_id === suc ? r.centro : r.norte, suc);
const env = (c, id) => c.envios.find((e) => Number(e.id) === Number(id));
const sumaAbonosRemision = async () =>
  Number((await db.query(`SELECT COALESCE(SUM(valor),0) AS s FROM abonos_remision WHERE NOT anulado`)).rows[0].s);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 1. Sin la migración: nada cambia, nada nombra lo nuevo ═══');
// ═════════════════════════════════════════════════════════════════════════════
columnas._setMoraEnviosDisponible(false);
let r = await armar();
ok('★ Sin migración la config de mora sale apagada aunque la clave diga 1',
   r.bodega.red.mora.activa === false);

emitido.length = 0;
const e0 = await despacharYRecibir(r, 2);
const p0 = await service.enviarRemesa(r.centro, { valor: 500000 });
await service.confirmarRemesa(r.bodega, p0.id);
let c = await cuenta(r);
ok('★★ Ninguna consulta nombró mora_envios ni las columnas nuevas',
   !emitido.some((s) => /mora_envios|fecha_limite|mora_condicion|mora_plazo_dias/.test(s)),
   `${emitido.filter((s) => /mora_envios|fecha_limite|mora_condicion|mora_plazo_dias/.test(s)).length} consultas`);
ok('  la cuenta sale igual: deuda 1.500.000', cerca(c.totales.deuda_total, 1500000), money(c.totales.deuda_total));
ok('  mora en cero y total a pagar = saldo', c.totales.mora_pendiente === 0
   && cerca(c.totales.total_a_pagar, c.totales.saldo_por_liquidar));
ok('  el envío trae su objeto de mora vacío (misma forma siempre)',
   env(c, e0.id).mora && env(c, e0.id).mora.aplica === false && env(c, e0.id).total_a_pagar === 1500000);
ok('  el reparto es el de siempre', p0.reparto.length === 1 && p0.reparto[0].tipo === 'envio');
let rechazo = null;
try { await service.despachar(r.bodega, { sucursal_destino_id: 2, lineas: [{ tipo: 'serial', serial_id: serial }], mora: { plazo_dias: 10 } }); }
catch (err) { rechazo = err; }
ok('  pedir un plazo explícito con la feature apagada se rechaza (400)', rechazo?.status === 400);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 2. Instalada pero APAGADA en Ajustes: sigue sin plazo ═══');
// ═════════════════════════════════════════════════════════════════════════════
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260925_mora_envios.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260925_mora_envios.sql'), 'utf8'));
ok('  la migración es idempotente (corrió dos veces)', true);
columnas._setMoraEnviosDisponible(true);
r = await armar();
const eApagada = await despacharYRecibir(r, 1);
const filaApagada = (await db.query(`SELECT fecha_limite, mora_plazo_dias FROM remisiones WHERE id = $1`, [eApagada.id])).rows[0];
ok('★ Apagada en Ajustes: el envío nace sin plazo', filaApagada.fecha_limite === null && filaApagada.mora_plazo_dias === null);
c = await cuenta(r);
ok('  y no hay mora en la cuenta', c.totales.mora_pendiente === 0 && c.totales.envios_con_plazo === 0);

// Se salda todo lo de antes para arrancar la sección 3 con la cuenta limpia.
const limpiar = await service.enviarRemesa(r.centro, { valor: c.totales.total_a_pagar });
await service.confirmarRemesa(r.bodega, limpiar.id);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 3. Encendida: el plazo se pacta al despachar y la fecha nace al recibir ═══');
// ═════════════════════════════════════════════════════════════════════════════
const CONDICIONES = [
  { id: 'normal', nombre: 'Normal', tipo: 'mensual', valor: 3, dias_gracia: 0 },
  { id: 'fija',   nombre: 'Fija',   tipo: 'diaria_fija', valor: 2000, dias_gracia: 2 },
  { id: 'aviso',  nombre: 'Solo aviso', tipo: 'mensual', valor: 0 },
];
await db.query(`INSERT INTO config_negocio VALUES
  (1,'red_interna_mora_activa','1'),
  (1,'red_interna_mora_lista',$1),
  (1,'red_interna_mora_default_id','normal'),
  (1,'red_interna_mora_plazo_default_dias','15')`, [JSON.stringify(CONDICIONES)]);
r = await armar();
ok('  la config se lee con las claves de la red', r.bodega.red.mora.activa && r.bodega.red.mora.condiciones.length === 3
   && r.bodega.red.mora.plazo_default === 15);

const eDef = await service.despachar(r.bodega, {
  sucursal_destino_id: 2, lineas: [{ tipo: 'serial', serial_id: serial++ }],
});
let fila = (await db.query(`SELECT * FROM remisiones WHERE id = $1`, [eDef.id])).rows[0];
ok('★ Sin decir nada, el envío sale con el plazo y la condición por defecto',
   fila.mora_plazo_dias === 15 && fila.mora_condicion?.id === 'normal');
ok('  en tránsito todavía NO tiene fecha límite', fila.fecha_limite === null);
c = await cuenta(r);
ok('  la tarjeta del envío en camino ya dice cuántos días tendrá',
   env(c, eDef.id).mora.plazo_dias === 15 && env(c, eDef.id).mora.aplica === false);
await service.recibir(r.centro, eDef.id);
fila = (await db.query(`SELECT fecha_limite::text AS f, (NOW() AT TIME ZONE 'America/Bogota')::date + 15 AS esperado FROM remisiones WHERE id = $1`, [eDef.id])).rows[0];
ok('★★ Al recibir: fecha límite = hoy (Bogotá) + 15 días', fila.f === (fila.esperado instanceof Date
   ? fila.esperado.toISOString().slice(0, 10) : String(fila.esperado).slice(0, 10)), `${fila.f}`);

const eSin = await service.despachar(r.bodega, {
  sucursal_destino_id: 2, lineas: [{ tipo: 'serial', serial_id: serial++ }], mora: null,
});
fila = (await db.query(`SELECT mora_plazo_dias, mora_condicion FROM remisiones WHERE id = $1`, [eSin.id])).rows[0];
ok('★ `mora: null` = sin plazo, a propósito', fila.mora_plazo_dias === null && fila.mora_condicion === null);
await service.recibir(r.centro, eSin.id);

const eFija = await service.despachar(r.bodega, {
  sucursal_destino_id: 2, lineas: [{ tipo: 'serial', serial_id: serial++ }],
  mora: { plazo_dias: 5, condicion_id: 'fija' },
});
fila = (await db.query(`SELECT mora_plazo_dias, mora_condicion FROM remisiones WHERE id = $1`, [eFija.id])).rows[0];
ok('  la bodega elige otra condición y otro plazo', fila.mora_plazo_dias === 5 && fila.mora_condicion.id === 'fija');
rechazo = null;
try { await service.despachar(r.bodega, { sucursal_destino_id: 2, lineas: [{ tipo: 'serial', serial_id: serial }], mora: { plazo_dias: 5, condicion_id: 'no-existe' } }); }
catch (err) { rechazo = err; }
ok('  una condición que no existe se rechaza sin crear nada', rechazo?.status === 400);
await service.recibir(r.centro, eFija.id);

// Sin confirmar recepción: se recibe en la misma transacción del despacho.
const rDirecto = { ...r.bodega, red: { ...r.bodega.red, confirmar_recepcion: false } };
const eDirecto = await service.despachar(rDirecto, {
  sucursal_destino_id: 3, lineas: [{ tipo: 'serial', serial_id: serial++ }],
});
fila = (await db.query(`SELECT fecha_limite FROM remisiones WHERE id = $1`, [eDirecto.id])).rows[0];
ok('  sin confirmación de recepción la fecha límite nace igual', fila.fecha_limite !== null);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 4. La mora se causa sobre el saldo, con el motor de créditos ═══');
// ═════════════════════════════════════════════════════════════════════════════
await vencerHace(eDef.id, 10);         // 3% mensual, 10 días → 1.000.000 × 3% × 10/30 = 10.000
await vencerHace(eFija.id, 6);         // $2.000/día, 2 de gracia → 4 × 2.000 = 8.000
c = await cuenta(r);
ok('★★ 3% mensual, 10 días de atraso sobre $1.000.000 = $10.000',
   env(c, eDef.id).mora.pendiente === 10000, money(env(c, eDef.id).mora.pendiente));
ok('★  $2.000 diarios con 2 días de gracia, 6 vencidos = $8.000',
   env(c, eFija.id).mora.pendiente === 8000, money(env(c, eFija.id).mora.pendiente));
ok('  el envío sin plazo no causa nada', env(c, eSin.id).mora.pendiente === 0);
ok('  totales: mora pendiente 18.000 y 2 envíos vencidos',
   c.totales.mora_pendiente === 18000 && c.totales.envios_vencidos === 2,
   `${money(c.totales.mora_pendiente)} · ${c.totales.envios_vencidos}`);
ok('★ total a pagar = capital + mora', cerca(c.totales.total_a_pagar, c.totales.saldo_por_liquidar + 18000));
ok('  la deuda de CAPITAL no cambió de significado', cerca(c.totales.deuda_total, 3000000),
   money(c.totales.deuda_total));
ok('  el desglose suma hasta el total a pagar',
   cerca(c.desglose.lineas.reduce((s, l) => s + l.valor, 0), c.desglose.saldo)
   && c.desglose.lineas.some((l) => l.clave === 'mora'));

// El vendedor ve la mora: es cuenta, no valorización.
const cv = await service.getEstadoCuenta(r.vende, 2);
ok('★ El vendedor ve la mora y el total a pagar (atraviesan el recorte)',
   cv.costos_ocultos === true && cv.totales.mora_pendiente === 18000 && cv.totales.total_a_pagar === c.totales.total_a_pagar
   && env(cv, eDef.id).mora.pendiente === 10000);

// Solo aviso: vencido pero sin cobro.
const eAviso = await despacharYRecibir(r, 1, 2, { mora: { plazo_dias: 3, condicion_id: 'aviso' } });
await vencerHace(eAviso.id, 20);
c = await cuenta(r);
ok('  condición de solo aviso: vencido y en mora, pero $0',
   env(c, eAviso.id).mora.vencido && env(c, eAviso.id).mora.en_mora && env(c, eAviso.id).mora.pendiente === 0);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 5. Pagar: mora primero, y la mora NO entra en abonos_remision ═══');
// ═════════════════════════════════════════════════════════════════════════════
let antesAbonos = await sumaAbonosRemision();
const pagoDef = await service.enviarRemesa(r.centro, { valor: 1010000, remision_id: eDef.id });
ok('★ Reparto: 10.000 a mora y 1.000.000 a capital del mismo envío',
   pagoDef.reparto.length === 2
   && pagoDef.reparto[0].tipo === 'mora' && pagoDef.reparto[0].valor === 10000
   && pagoDef.reparto[1].tipo === 'envio' && pagoDef.reparto[1].valor === 1000000,
   JSON.stringify(pagoDef.reparto.map((x) => [x.tipo, x.valor])));
ok('★★ abonos_remision solo recibió el capital',
   cerca(await sumaAbonosRemision() - antesAbonos, 1000000));

c = await cuenta(r);
ok('  en tránsito: la mora sigue pendiente (una remesa sin confirmar no cuenta)',
   env(c, eDef.id).mora.pendiente === 10000 && env(c, eDef.id).mora.en_camino === 10000);

// Un segundo pago antes de confirmar el primero NO puede volver a pagar la
// misma mora (la reserva).
const pagoDoble = await service.enviarRemesa(r.centro, { valor: 5000, remision_id: eFija.id, modo_mora: 'solo_mora' });
ok('  pagar solo la mora de OTRO envío funciona', pagoDoble.reparto.length === 1
   && pagoDoble.reparto[0].tipo === 'mora' && pagoDoble.reparto[0].remision_id === eFija.id);
rechazo = null;
try { await service.enviarRemesa(r.centro, { valor: 5000, remision_id: eDef.id, modo_mora: 'solo_mora' }); }
catch (err) { rechazo = err; }
ok('★ La mora ya reservada por un pago en camino no se vuelve a pagar (409)', rechazo?.status === 409);

await service.confirmarRemesa(r.bodega, pagoDef.id);
await service.confirmarRemesa(r.bodega, pagoDoble.id);
c = await cuenta(r);
ok('★ Confirmado: el envío queda PAGADO (capital y mora en cero)',
   env(c, eDef.id).pagado === true && env(c, eDef.id).mora.pendiente === 0 && env(c, eDef.id).mora.cobrada === 10000);
ok('  el otro envío: 8.000 causados, 5.000 cobrados, 3.000 pendientes',
   env(c, eFija.id).mora.cobrada === 5000 && env(c, eFija.id).mora.pendiente === 3000);
ok('★★ la plata que fue a mora NO reaparece como saldo a favor', c.totales.saldo_a_favor === 0,
   money(c.totales.saldo_a_favor));

const sumaExtracto = c.extracto.reduce((s, e) => s + Number(e.valor), 0);
ok('★★ Σ extracto = posición neta (la mora cobrada entra como cargo)',
   cerca(sumaExtracto, c.totales.neto), `${money(sumaExtracto)} vs ${money(c.totales.neto)}`);
ok('  el extracto dice qué mora se pagó y con qué',
   c.extracto.some((e) => e.origen === 'mora' && e.clase === 'cargo' && Number(e.valor) === 10000));

const cuadra = (x) => ({
  suma: x.envios.filter((e) => e.estado !== 'Anulada').reduce((s, e) => s + e.saldo, 0)
      + x.cargos.reduce((s, k) => s + k.saldo, 0),
  deuda: Number(x.totales.deuda_total),
});
let q = cuadra(c);
ok('★★ Identidad de capital intacta: Σ saldo de documentos = deuda_total', cerca(q.suma, q.deuda),
   `${money(q.suma)} vs ${money(q.deuda)}`);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 6. Solo falta la mora: el envío sigue abierto y el FIFO la cobra ═══');
// ═════════════════════════════════════════════════════════════════════════════
// eFija: capital 1.000.000 sin pagar, mora 3.000 pendiente. Se paga el capital
// con capital_primero y queda solo la mora.
const capPrimero = await service.enviarRemesa(r.centro, { valor: 1000000, remision_id: eFija.id, modo_mora: 'capital_primero' });
await service.confirmarRemesa(r.bodega, capPrimero.id);
ok('  capital_primero: todo al capital', capPrimero.reparto.every((x) => x.tipo === 'envio'));
c = await cuenta(r);
ok('★ Capital en cero y mora pendiente: NO está pagado', env(c, eFija.id).saldo === 0
   && env(c, eFija.id).mora.pendiente === 3000 && env(c, eFija.id).pagado === false);
ok('  y cuenta como abierto', c.envios_resumen.abiertos >= 1 && c.totales.envios_abiertos >= 1);
// Se saldan los envíos más viejos con capital abierto: el FIFO va del más
// viejo al más nuevo, y un pago sin dirigir taparía primero su capital.
for (const id of [eSin.id, eAviso.id]) {
  const p = await service.enviarRemesa(r.centro, { valor: 1000000, remision_id: id });
  await service.confirmarRemesa(r.bodega, p.id);
}
// El pago total (sin dirigir) encuentra esa mora aunque el capital esté cubierto.
const pagoTotal = await service.enviarRemesa(r.centro, { valor: 3000 });
ok('★ Un pago sin dirigir encuentra la mora de un envío ya cubierto',
   pagoTotal.reparto.length === 1 && pagoTotal.reparto[0].tipo === 'mora'
   && pagoTotal.reparto[0].remision_id === eFija.id);
await service.confirmarRemesa(r.bodega, pagoTotal.id);
c = await cuenta(r);
ok('  ahora sí: pagado', env(c, eFija.id).pagado === true);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 7. Deshacer: anular el pago devuelve la mora a pendiente ═══');
// ═════════════════════════════════════════════════════════════════════════════
await service.anularRemesa(r.bodega, pagoTotal.id);
c = await cuenta(r);
ok('★ Remesa anulada: la mora vuelve a deberse', env(c, eFija.id).mora.pendiente === 3000
   && env(c, eFija.id).pagado === false);
const filaMora = (await db.query(`SELECT anulado FROM mora_envios WHERE remesa_id = $1`, [pagoTotal.id])).rows;
ok('  su cobro quedó anulado (no borrado)', filaMora.length === 1 && filaMora[0].anulado === true);
q = cuadra(c);
ok('  identidad intacta', cerca(q.suma, q.deuda));
ok('  y el extracto cuadra', cerca(c.extracto.reduce((s, e) => s + Number(e.valor), 0), c.totales.neto));

// Gasto por cuenta de bodega que paga mora, y la bodega lo rechaza.
const gasto = await service.registrarGastoAutorizado(r.centro, { valor: 3000, concepto: 'Domicilio' });
ok('  un gasto también paga mora primero', gasto.reparto.length === 1 && gasto.reparto[0].tipo === 'mora');
await service.decidirGasto(r.bodega, gasto.id, { aprobar: false });
c = await cuenta(r);
ok('★ Gasto rechazado: la mora que cubría vuelve a pendiente', env(c, eFija.id).mora.pendiente === 3000);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 8. Condonar: admin, desde la bodega, con motivo y PIN ═══');
// ═════════════════════════════════════════════════════════════════════════════
const intentos = [
  ['un supervisor', r.superB, { motivo: 'buen cliente', pin: '1234' }, 403],
  ['el admin desde un local', r.adminLocal, { motivo: 'buen cliente', pin: '1234' }, 403],
  ['sin motivo', r.bodega, { motivo: '', pin: '1234' }, 400],
  ['PIN malo', r.bodega, { motivo: 'buen cliente', pin: '0000' }, 403],
  ['más de lo pendiente', r.bodega, { motivo: 'buen cliente', pin: '1234', valor: 999999 }, 400],
];
for (const [quien, req, body, esperado] of intentos) {
  let e = null;
  try { await moraRed.condonar(req, eFija.id, body); } catch (err) { e = err; }
  ok(`  ${quien} → ${esperado}`, e?.status === esperado, e?.message);
}
const cond = await moraRed.condonar(r.bodega, eFija.id, { motivo: 'Se demoró el transportador', pin: '1234' });
ok('★ Condonación total', cond.condonado === 3000);
c = await cuenta(r);
ok('  el envío queda pagado sin que entre un peso', env(c, eFija.id).pagado === true
   && env(c, eFija.id).mora.condonada === 3000);
ok('  la condonación no crea saldo a favor', c.totales.saldo_a_favor === 0);
ok('  el extracto la muestra como informativa (valor 0)',
   c.extracto.some((e) => e.origen === 'mora' && e.clase === 'info' && Number(e.valor) === 0));
let err2 = null;
const cobro = (await db.query(`SELECT id FROM mora_envios WHERE tipo = 'Cobro' AND NOT anulado LIMIT 1`)).rows[0];
try { await moraRed.anularCondonacion(r.bodega, cobro.id); } catch (err) { err2 = err; }
ok('  un COBRO no se anula por aquí (se anula su pago)', err2?.status === 400);
await moraRed.anularCondonacion(r.bodega, cond.movimiento.id);
c = await cuenta(r);
ok('★ Anular la condonación la devuelve a pendiente', env(c, eFija.id).mora.pendiente === 3000);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 9. Fijar el plazo después: nunca hacia atrás ═══');
// ═════════════════════════════════════════════════════════════════════════════
const eViejo = await despacharYRecibir(r, 1, 2, { mora: null });
err2 = null;
try { await moraRed.fijarPlazo(r.superB, eViejo.id, { fecha_limite: '2020-01-01', condicion_id: 'normal' }); }
catch (err) { err2 = err; }
ok('★ Una fecha límite en el pasado se rechaza (sería mora que nadie pactó)', err2?.status === 400);
err2 = null;
try { await moraRed.fijarPlazo(r.centro, eViejo.id, { plazo_dias: 10, condicion_id: 'normal' }); }
catch (err) { err2 = err; }
ok('  el local no puede fijarse el plazo', err2?.status === 403);
const fijado = await moraRed.fijarPlazo(r.superB, eViejo.id, { plazo_dias: 10, condicion_id: 'normal' });
ok('  ya recibido: plazo_dias se convierte en fecha desde hoy', !!fijado.fecha_limite);
c = await cuenta(r);
ok('  aún no vence: por vencer, sin mora', env(c, eViejo.id).mora.aplica
   && env(c, eViejo.id).mora.pendiente === 0 && env(c, eViejo.id).mora.dias_para_vencer === 10);
await moraRed.fijarPlazo(r.superB, eViejo.id, { quitar: true });
fila = (await db.query(`SELECT fecha_limite FROM remisiones WHERE id = $1`, [eViejo.id])).rows[0];
ok('  quitar el plazo lo deja sin fecha', fila.fecha_limite === null);

// En lote: todos los envíos abiertos sin plazo de un local. Uno más sin plazo
// y uno CON plazo propio, que el lote no puede pisar.
await despacharYRecibir(r, 1, 2, { mora: null });
const eConPlazo = await despacharYRecibir(r, 1, 2, { mora: { plazo_dias: 7, condicion_id: 'fija' } });
const lote = await moraRed.fijarPlazoLocal(r.superB, {
  sucursal_id: 2, fecha_limite: new Date(Date.now() + 20 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }),
  condicion_id: 'normal',
});
ok('★ En lote: pone plazo a los abiertos que no lo tenían', lote.actualizados >= 2, `${lote.actualizados}`);
const propio = (await db.query(`SELECT mora_condicion->>'id' AS id FROM remisiones WHERE id = $1`, [eConPlazo.id])).rows[0];
ok('  y NO pisa el plazo que ya tenía cada uno', propio.id === 'fija');

// En tránsito: se cambia lo pactado, no la fecha.
const eTransito = await service.despachar(r.bodega, { sucursal_destino_id: 2, lineas: [{ tipo: 'serial', serial_id: serial++ }] });
await moraRed.fijarPlazo(r.superB, eTransito.id, { plazo_dias: 30, condicion_id: 'fija' });
fila = (await db.query(`SELECT mora_plazo_dias, fecha_limite, mora_condicion->>'id' AS c FROM remisiones WHERE id = $1`, [eTransito.id])).rows[0];
ok('  en tránsito se cambian los días y la condición, la fecha sigue sin nacer',
   fila.mora_plazo_dias === 30 && fila.fecha_limite === null && fila.c === 'fija');
await service.anularRemision(r.bodega, eTransito.id);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 10. El saldo a favor también paga mora (y el invariante aguanta) ═══');
// ═════════════════════════════════════════════════════════════════════════════
// Norte: un envío vencido con mora; la bodega le hace un abono grande.
const eNorte = await despacharYRecibir(r, 1, 3, { mora: { plazo_dias: 5, condicion_id: 'normal' } });
await vencerHace(eNorte.id, 30);     // 1.000.000 × 3% × 30/30 = 30.000
const ajuste = await service.registrarAjuste(r.bodega, { sucursal_id: 3, valor: 3000000, concepto: 'Nota crédito' });
ok('★ El ajuste paga primero la mora y después el capital',
   ajuste.reparto.some((x) => x.tipo === 'mora' && x.valor === 30000));
let cn = await service.getEstadoCuenta(r.norte, 3);
ok('  el envío vencido de Norte quedó pagado', env(cn, eNorte.id).pagado === true);
const favorEsperado = 3000000 - 30000 - Number(cn.totales.cargo_total);
ok('★★ saldo a favor = ajuste − capital − mora (la mora no se devuelve como crédito)',
   cerca(cn.totales.saldo_a_favor, favorEsperado), `${money(cn.totales.saldo_a_favor)} vs ${money(favorEsperado)}`);
ok('  extracto de Norte cuadra', cerca(cn.extracto.reduce((s, e) => s + Number(e.valor), 0), cn.totales.neto),
   `${money(cn.extracto.reduce((s, e) => s + Number(e.valor), 0))} vs ${money(cn.totales.neto)}`);
ok('  INVARIANTE: con saldo a favor no queda nada abierto',
   !(cn.totales.saldo_a_favor > 0 && (cn.totales.deuda_total > 0 || cn.totales.mora_pendiente > 0)));

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 11. El detalle del envío y el panel de la bodega ═══');
// ═════════════════════════════════════════════════════════════════════════════
const det = await service.getRemision(r.vende, eDef.id);
ok('★ getRemision trae la mora y sus movimientos, también para el vendedor',
   det.mora?.aplica === true && det.mora.movimientos.length === 1 && det.resumen.mora_pendiente === 0
   && det.costos_ocultos === true);
const panel = await service.getPanelBodega(r.bodega);
const centroPanel = panel.locales.find((l) => l.sucursal_id === 2);
ok('  el panel de la bodega suma la mora de la red',
   panel.totales.mora_pendiente === centroPanel.totales.mora_pendiente + panel.locales.find((l) => l.sucursal_id === 3).totales.mora_pendiente
   && panel.mora_config.activa === true);
const ctx = await service.getContexto(r.bodega);
ok('  el contexto trae las condiciones para despachar', ctx.mora.activa && ctx.mora.condiciones.length === 3
   && ctx.mora.plazo_default === 15);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 12. PDF, reportes y avisos leen la MISMA mora ═══');
// ═════════════════════════════════════════════════════════════════════════════
const pdf = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.pdf.js'));
// Un envío vencido y sin pagar para que el PDF tenga mora que contar.
const eVencido = await despacharYRecibir(r, 1, 2, { mora: { plazo_dias: 5, condicion_id: 'normal' } });
await vencerHace(eVencido.id, 15);        // 1.000.000 × 3% × 15/30 = 15.000
const detV = await service.getRemision(r.bodega, eVencido.id);
ok('  la ficha del envío: 15.000 de mora y total a pagar 1.015.000',
   detV.mora.pendiente === 15000 && detV.resumen.total_a_pagar === 1015000);

const dibujar = (fn) => {
  const PDFDocument = require('pdfkit');
  const partes = [];
  const origText = PDFDocument.prototype.text;
  PDFDocument.prototype.text = function (t, ...resto) { partes.push(String(t)); return origText.call(this, t, ...resto); };
  try { fn(); } finally { PDFDocument.prototype.text = origText; }
  return partes.join(' | ');
};
const txtEnvio = dibujar(() => pdf.construirPdfEnvio(detV, { nombre_negocio: 'Test' }));
ok('★ PDF del envío: dice el plazo, la mora y el TOTAL A PAGAR',
   txtEnvio.includes('Plazo de pago: vence el')
   && /Total a pagar \| \$\s?1\.015\.000/.test(txtEnvio),
   txtEnvio.match(/Total a pagar[^|]*\|[^|]*/)?.[0]);
const cuentaV = await service.getEstadoCuenta(r.bodega, 2);
const txtPend = dibujar(() => pdf.construirPdfEnviosActivos(cuentaV, { nombre_negocio: 'Test' }));
ok('  PDF de envíos por pagar: incluye la mora en el total',
   txtPend.includes('Mora por pagar tarde') && txtPend.includes('vencido hace 15'));
const noWinAnsi = [...(txtEnvio + txtPend)].filter((ch) => ch.charCodeAt(0) > 255 && !'\u2014\u2019\u201C\u201D\u2022\u2026'.includes(ch));
ok('  ningún carácter fuera de WinAnsi (Helvetica los imprime como comillas)', noWinAnsi.length === 0,
   [...new Set(noWinAnsi)].join(''));

// Reportes: la mora cobrada es ingreso financiero aparte, no utilidad.
const reportes = require(path.join(RAIZ, 'src/modules/reportes/reportes.service.js'));
const hoyIso = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const moraRep = await reportes.getMoraEnviosRango(1, '2000-01-01', hoyIso);
const cobradaReal = Number((await db.query(
  `SELECT COALESCE(SUM(valor),0) AS s FROM (${repo.SQL_MORA_EFECTIVOS}) x WHERE x.tipo = 'Cobro'`)).rows[0].s);
ok('★ Reportes de la bodega: mora cobrada = la de la cuenta', moraRep && cerca(moraRep.cobrada, cobradaReal),
   `${money(moraRep?.cobrada)} vs ${money(cobradaReal)}`);
const ventasBodega = await reportes.getVentasALocales(1, '2000-01-01', hoyIso);
const abonadoCapital = Number((await db.query(
  `SELECT COALESCE(SUM(valor),0) AS s FROM (${repo.SQL_ABONOS_EFECTIVOS}) a
    JOIN remisiones r ON r.id = a.remision_id WHERE r.sucursal_origen_id = 1`)).rows[0].s);
ok('★★ La utilidad de la bodega mide lo cobrado SIN la mora',
   cerca(ventasBodega.resumen.cobrado_total, abonadoCapital),
   `${money(ventasBodega.resumen.cobrado_total)} vs ${money(abonadoCapital)}`);

// Avisos: el motor ve el envío vencido con las cifras de la cuenta.
const operaciones = require(path.join(RAIZ, 'src/modules/notificaciones/notificaciones.operaciones.js'));
const alerta = await operaciones.enviosRedVencidos(1);
const centroAl = alerta.vencidos.find((l) => l.sucursal_id === 2);
const cuentaC = await service.getEstadoCuenta(r.centro, 2);
ok('★ El aviso de vencidos dice la misma mora que la cuenta del local',
   centroAl && centroAl.mora === cuentaC.totales.mora_pendiente && centroAl.vencidos === cuentaC.totales.envios_vencidos,
   `aviso ${money(centroAl?.mora)} · cuenta ${money(cuentaC.totales.mora_pendiente)}`);
const motor = require(path.join(RAIZ, 'src/modules/notificaciones/notificaciones.motor.js'));
const sen = await motor.recolectar(1);
ok('  el motor la marca URGENTE', sen.urgentes.some((s) => s.clave === 'red_envios_vencidos'));

console.log(`\n${fallos === 0 ? '✓' : '✗'} ${pasados} pasaron, ${fallos} fallaron\n`);
process.exit(fallos ? 1 : 0);
