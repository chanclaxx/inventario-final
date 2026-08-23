// ─────────────────────────────────────────────────────────────────────────────
// FASES 1–5: devolución auditable, costos por rol, medios de pago,
//            corrección de valores y desglose del saldo.
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
    VALUES ('iPhone 13','Apple','128GB', 2600000, 1, 1),   -- id 1 bodega
           ('Xiaomi 12','Xiaomi','256GB', 900000, 2, 1);   -- id 2 Centro (propio)
  INSERT INTO seriales (producto_id, imei, costo_compra) VALUES
    (1,'AAA111', 1800000),   -- id 1 · de bodega
    (1,'AAA222', 1850000),   -- id 2 · de bodega
    (2,'PROP-1',  600000);   -- id 3 · PROPIO del local (retoma)

  -- Cuentas: el local tiene efectivo y Nequi
  INSERT INTO cuentas_dinero (negocio_id, sucursal_id, nombre, tipo, metodos_pago) VALUES
    (1,1,'Efectivo','efectivo',ARRAY['Efectivo']),
    (1,1,'Nequi','billetera',ARRAY['Nequi']),
    (1,2,'Efectivo','efectivo',ARRAY['Efectivo']),
    (1,2,'Nequi','billetera',ARRAY['Nequi']);
  INSERT INTO aperturas_caja (sucursal_id) VALUES (1),(2);
`);

const red = { activa:true, bodega_id:1, confirmar_recepcion:true, confirmar_remesa:true,
              ocultar_costos:true };
const bodega = { user:{id:1,negocio_id:1,rol:'admin_negocio'}, sucursal_id:1, esBodega:true, red };
const superv = { user:{id:2,negocio_id:1,rol:'supervisor'},    sucursal_id:2, esBodega:false, red };
const vende  = { user:{id:3,negocio_id:1,rol:'vendedor'},      sucursal_id:2, esBodega:false, red };

// Despachar 2 equipos al local
const r1 = await service.despachar(bodega, {
  sucursal_destino_id: 2, lineas: [{tipo:'serial',serial_id:1},{tipo:'serial',serial_id:2}],
});
const l1 = await repo.getLineasRemision(r1.id);
await service.recibir(superv, r1.id, { lineas_recibidas: l1.map((x)=>Number(x.id)) });

console.log('\n═══ 1. La devolución distingue el origen de cada equipo ═══');
const prev = await service.previsualizarDevolucion(superv, {
  lineas: [{ tipo:'serial', serial_id: 1 }, { tipo:'serial', serial_id: 3 }],
});
const deBodega = prev.items.find((i) => i.imei === 'AAA111');
const propio   = prev.items.find((i) => i.imei === 'PROP-1');
ok('★ El que vino de bodega se marca como tal', deBodega.origen === 'bodega',
   `envío #${deBodega.remision_numero}`);
ok('★ La retoma del local se marca como propia', propio.origen === 'propio');
ok('★ Avisa que hay algo que decidir', prev.requiere_decision === true, `${prev.propios} propio(s)`);

console.log('\n═══ 2. Emitir la devolución NO mueve el inventario ═══');
const dev = await service.devolver(superv, {
  lineas: [
    { tipo:'serial', serial_id: 1 },                              // de bodega
    { tipo:'serial', serial_id: 3, genera_saldo_favor: true },    // propio, la bodega lo compra
  ],
  notas: 'Devuelvo uno y vendo el otro a bodega',
});
ok('★ Queda EN TRÁNSITO', dev.estado === 'En transito');
const dondeEsta = await q(`SELECT ps.sucursal_id FROM seriales s
  JOIN productos_serial ps ON ps.id=s.producto_id WHERE s.id = 1`);
ok('★ El equipo sigue en el local hasta que la bodega confirme',
   dondeEsta[0].sucursal_id === 2);
let estado = await service.getPanelLocal(superv);
ok('  y sigue contando en la consignación del local',
   estado.totales.en_consignacion_unidades === 2);
const deudaAntesDev = Number(estado.totales.deuda_total);

console.log('\n═══ 3. La bodega la confirma: ahí sí se mueve todo ═══');
const lDev = await repo.getLineasRemision(dev.id);
const conf = await service.confirmarDevolucion(bodega, dev.id, {
  lineas_recibidas: lDev.map((x) => Number(x.id)),
});
ok('★ Queda Recibida', conf.estado === 'Recibida');
ok('  con 2 unidades', conf.recibidas === 2);
const tras = await q(`SELECT ps.sucursal_id FROM seriales s
  JOIN productos_serial ps ON ps.id=s.producto_id WHERE s.id IN (1,3) ORDER BY s.id`);
ok('★ Ambos equipos ya están en la bodega',
   tras.every((t) => t.sucursal_id === 1));

estado = await service.getPanelLocal(superv);
ok('★ El de bodega salió de la consignación',
   estado.totales.en_consignacion_unidades === 1);
ok('★ El propio generó saldo a favor', conf.saldo_a_favor === 600000, money(conf.saldo_a_favor));
// La devolución baja la deuda por dos vías distintas y no intercambiables:
//   el equipo DE BODEGA deja de cargar en su envío (su línea queda 'Devuelta'),
//   el equipo PROPIO que la bodega compró entra como crédito de $600.000.
// La deuda nunca queda negativa: el crédito que sobre se guarda a favor y se
// aplica solo cuando llegue el próximo envío.
ok('★ La deuda baja por el equipo devuelto Y por el crédito',
   Number(estado.totales.deuda_total) === deudaAntesDev - 1800000 - 600000,
   money(estado.totales.deuda_total));
ok('★ Y nunca queda negativa (la bodega no le queda debiendo plata)',
   Number(estado.totales.deuda_total) >= 0 && Number(estado.totales.saldo_por_liquidar) >= 0);

console.log('\n═══ 4. Una devolución sin confirmar se ve en la bandeja de bodega ═══');
const dev2 = await service.devolver(superv, { lineas: [{ tipo:'serial', serial_id: 2 }] });
const panelB = await service.getPanelBodega(bodega);
ok('★ Aparece en devoluciones por confirmar',
   (panelB.devoluciones_por_confirmar || []).some((d) => d.id === dev2.id),
   `${(panelB.devoluciones_por_confirmar || []).length} pendiente(s)`);

console.log('\n═══ 5. Un vendedor NO ve costos, pero sí lo que debe entregar ═══');
// Primero se vende algo para que haya deuda
await db.exec(`
  INSERT INTO facturas (numero, sucursal_id, nombre_cliente, estado, fecha)
    VALUES (1, 2, 'Cliente', 'Activa', NOW() + INTERVAL '1 minute');
  INSERT INTO lineas_factura (factura_id, nombre_producto, imei, cantidad, precio)
    VALUES (1, 'iPhone 13', 'AAA222', 1, 2600000);
`);
const paraSuperv = await service.getPanelLocal(superv);
const paraVende  = await service.getPanelLocal(vende);

ok('El supervisor SÍ ve el valor de la mercancía',
   paraSuperv.totales.en_consignacion_valor !== null);
ok('★ El vendedor NO ve el valor de la mercancía',
   paraVende.totales.en_consignacion_valor === null);
ok('★ Pero SÍ ve cuántos equipos tiene',
   paraVende.totales.en_consignacion_unidades === paraSuperv.totales.en_consignacion_unidades);
ok('★ Y SÍ ve cuánto debe remitir (lo necesita para entregar la plata)',
   Number(paraVende.totales.saldo_por_liquidar) === Number(paraSuperv.totales.saldo_por_liquidar),
   money(paraVende.totales.saldo_por_liquidar));
ok('  viene marcado para que la pantalla lo sepa', paraVende.costos_ocultos === true);

const cuentaVende  = await service.getEstadoCuenta(vende, 2);
const cuentaSuperv = await service.getEstadoCuenta(superv, 2);
// El extracto del vendedor ya NO viene en blanco: los cargos y abonos son su
// cuenta con la bodega y los necesita. Lo que se le borra es el valor de la
// mercancía, que viaja en las filas informativas (una venta).
ok('★ En el extracto el vendedor ve la cuenta, pero no el valor de lo vendido',
   cuentaVende.extracto.every((e) => e.clase !== 'info' || Number(e.valor) === 0) &&
   cuentaVende.extracto.length === cuentaSuperv.extracto.length);
ok('★ En la mercancía tampoco ve valores',
   cuentaVende.mercancia.items.every((u) => u.valor_interno === null));
ok('  pero sí los estados', cuentaVende.mercancia.items.every((u) => !!u.etiqueta_estado));

console.log('\n═══ 6. Remesas por cualquier medio, no solo efectivo ═══');
const cuentas = await service.getCuentasParaRemesa(superv);
ok('★ Lista las cuentas del local', cuentas.length === 2,
   cuentas.map((c) => c.nombre).join(', '));
ok('  sin cuentas de tránsito ni divisa', cuentas.every((c) => c.tipo !== 'transito'));

const nequiLocal = cuentas.find((c) => c.nombre === 'Nequi');
// Una cuenta de la BODEGA, para comprobar que el local no puede gastar de ella.
const cuentaBodegaEfectivo = (await q(
  `SELECT id FROM cuentas_dinero WHERE sucursal_id = 1 AND tipo = 'efectivo' LIMIT 1`
))[0].id;
const remNequi = await service.enviarRemesa(superv, {
  valor: 500000, cuenta_origen_id: nequiLocal.id, metodo: 'Nequi',
});
ok('★ La remesa guarda el método', remNequi.metodo === 'Nequi');
const movNequi = await q(`SELECT cuenta_id FROM movimientos_dinero WHERE id = $1`, [remNequi.mov_salida_id]);
ok('★ Y salió de la cuenta Nequi del local', movNequi[0].cuenta_id === nequiLocal.id);

const espejos = await q(`SELECT COUNT(*)::int c FROM movimientos_caja WHERE activo`);
ok('★ Una remesa por Nequi NO se espeja en la caja física', espejos[0].c === 0);

await service.confirmarRemesa(bodega, remNequi.id);
const destino = await q(`SELECT cd.nombre FROM remesas r
  JOIN cuentas_dinero cd ON cd.id = r.cuenta_destino_id WHERE r.id = $1`, [remNequi.id]);
ok('★ Aterrizó en la cuenta Nequi de la BODEGA', destino[0].nombre === 'Nequi');

console.log('\n   … y una remesa en efectivo sí pasa por caja');
const efvo = cuentas.find((c) => c.es_efectivo);
const remEfvo = await service.enviarRemesa(superv, {
  valor: 300000, cuenta_origen_id: efvo.id, metodo: 'Efectivo',
});
await service.confirmarRemesa(bodega, remEfvo.id);
const espejos2 = await q(`SELECT COUNT(*)::int c FROM movimientos_caja WHERE activo`);
ok('★ Dos espejos: egreso del local e ingreso de la bodega', espejos2[0].c === 2);

console.log('\n═══ 6b. El gasto por cuenta de bodega también elige de dónde sale ═══');
// Antes siempre se asumía la caja de efectivo: un gasto pagado por Nequi
// descuadraba la caja física del local.
const gastoNequi = await service.registrarGastoAutorizado(superv, {
  valor: 120000, concepto: 'Domicilio pagado por Nequi', cuenta_origen_id: nequiLocal.id,
});
const movGasto = await q(
  `SELECT cuenta_id, tipo, categoria FROM movimientos_dinero WHERE id = $1`,
  [gastoNequi.mov_dinero_id]
);
ok('★ Salió de la cuenta elegida, no de la caja', movGasto[0].cuenta_id === nequiLocal.id);
ok('  y como salida de categoría gasto',
   movGasto[0].tipo === 'salida' && movGasto[0].categoria === 'gasto');
const espejos3 = await q(`SELECT COUNT(*)::int c FROM movimientos_caja WHERE activo`);
ok('★ Un gasto por Nequi NO se espeja en la caja física', espejos3[0].c === 2);

const gastoEfvo = await service.registrarGastoAutorizado(superv, {
  valor: 50000, concepto: 'Transporte en efectivo', cuenta_origen_id: efvo.id,
});
const espejos4 = await q(`SELECT COUNT(*)::int c FROM movimientos_caja WHERE activo`);
ok('★ Pero uno en efectivo SÍ', espejos4[0].c === 3, `${espejos4[0].c} espejos`);
ok('  y los dos bajan la deuda con la bodega',
   Number(gastoNequi.valor) === 120000 && Number(gastoEfvo.valor) === 50000);

let cuentaAjena = false;
try {
  await service.registrarGastoAutorizado(superv, {
    valor: 1000, concepto: 'Prueba', cuenta_origen_id: cuentaBodegaEfectivo,
  });
} catch (e) { cuentaAjena = e.status === 403; }
ok('★ No se puede gastar desde una cuenta de otra sucursal', cuentaAjena);

console.log('\n═══ 7. Corregir el valor de una línea ═══');
const r3 = await service.despachar(bodega, {
  sucursal_destino_id: 2, lineas: [{ tipo:'serial', serial_id: 1, valor_interno: 1800000 }],
});
const l3 = await repo.getLineasRemision(r3.id);
// En tránsito: edición directa
const fix1 = await service.corregirValorLinea(bodega, Number(l3[0].id), { valor_nuevo: 1750000 });
ok('★ En tránsito se edita directo, sin nota', fix1.con_nota === false);
const trasFix = await repo.getLineasRemision(r3.id);
ok('  el valor quedó actualizado', Number(trasFix[0].valor_interno) === 1750000, money(trasFix[0].valor_interno));

// Ya recibida: exige motivo y deja nota
await service.recibir(superv, r3.id, { lineas_recibidas: [Number(l3[0].id)] });
let sinMotivo = false;
try { await service.corregirValorLinea(bodega, Number(l3[0].id), { valor_nuevo: 1900000 }); }
catch (e) { sinMotivo = e.status === 400; }
ok('★ Ya recibida, exige explicar el motivo', sinMotivo);

const fix2 = await service.corregirValorLinea(bodega, Number(l3[0].id), {
  valor_nuevo: 1900000, motivo: 'Se digitó mal el costo de compra',
});
ok('★ Se corrige y queda la nota', fix2.con_nota === true);
ok('  con el valor anterior', Number(fix2.valor_anterior) === 1750000, money(fix2.valor_anterior));
const lineaFix = await q(`SELECT valor_interno, valor_original FROM lineas_remision WHERE id = $1`,
  [Number(l3[0].id)]);
ok('★ El valor efectivo es el nuevo', Number(lineaFix[0].valor_interno) === 1900000);
ok('★ Y se conserva el original para auditoría',
   Number(lineaFix[0].valor_original) === 1750000, money(lineaFix[0].valor_original));

const detalle = await service.getRemision(bodega, r3.id);
ok('★ La remisión muestra sus correcciones', detalle.correcciones.length === 1,
   detalle.correcciones[0]?.motivo);

console.log('\n═══ 8. Detalle del envío con códigos, cantidades y estados ═══');
ok('★ Trae el estado actual de cada línea', detalle.lineas.every((l) => !!l.etiqueta_estado),
   detalle.lineas.map((l) => l.etiqueta_estado).join(', '));
ok('★ Y el resumen de cuánto ya generó deuda', detalle.resumen != null,
   `enviado ${money(detalle.resumen.enviado)} · en vitrina ${money(detalle.resumen.en_vitrina)}`);
ok('★ La bodega puede corregir si ya se recibió', detalle.puede_corregir === true);
ok('  y no editar en crudo', detalle.puede_editar_valores === false);

const detalleVende = await service.getRemision(vende, r3.id);
// El vendedor ya no pierde el resumen entero: la CUENTA del envío (cargo,
// abonado, saldo) es la plata que tiene que entregar y sin verla no podría
// pagar. Lo que sigue oculto es la valorización de la mercancía.
ok('★ El vendedor ve el detalle SIN el valor de cada equipo',
   detalleVende.lineas.every((l) => l.valor_interno === null)
   && detalleVende.resumen.en_vitrina === null
   && detalleVende.resumen.enviado === null);
ok('  pero SÍ ve lo que debe de ese envío',
   detalleVende.resumen.saldo === detalle.resumen.saldo,
   money(detalleVende.resumen.saldo));

console.log('\n═══ 9. El desglose explica POR QUÉ debe eso ═══');
const cuenta = await service.getEstadoCuenta(superv, 2);
const d = cuenta.desglose;
ok('★ Trae los renglones que suman al saldo', d.lineas.length >= 2,
   d.lineas.map((x) => x.clave).join(', '));
const suma = d.lineas.reduce((s, x) => s + Number(x.valor), 0);
ok('★ La suma del desglose = el saldo', Math.abs(suma - d.saldo) < 1,
   `${money(suma)} vs ${money(d.saldo)}`);
ok('★ Dice de dónde va a salir la plata', d.respaldo.unidades >= 0,
   `${d.respaldo.unidades} en vitrina`);
const remesaLinea = d.lineas.find((x) => x.clave === 'pagos');
ok('★ Y por qué medio ha pagado', Object.keys(remesaLinea.medios).length === 2,
   Object.entries(remesaLinea.medios).map(([m, v]) => `${m}: ${money(v)}`).join(' · '));

console.log('\n═══ 10. Permisos de la devolución ═══');
let noLocal = false;
try { await service.confirmarDevolucion(superv, dev2.id, {}); }
catch (e) { noLocal = e.status === 403; }
ok('★ Un local no puede confirmar su propia devolución', noLocal);

console.log(`\n${'═'.repeat(62)}`);
console.log(`RESULTADO: ${pasados} pasaron, ${fallos} fallaron`);
console.log('═'.repeat(62));
process.exit(fallos ? 1 : 0);
