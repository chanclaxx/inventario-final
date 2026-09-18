// ─────────────────────────────────────────────────────────────────────────────
// TÉCNICOS EXTERNOS — un equipo NUESTRO sale a reparación, contra un Postgres
// real (PGlite). Ver migrations/20260918_tecnicos_externos.sql.
//
// El caso que lo originó: retomo un equipo, hay que cambiarle la batería, lo
// mando a un técnico. Ese técnico cobra (de contado, a crédito o con anticipo),
// da garantía, y lo que cobró SUBE EL COSTO del equipo. Mientras lo tiene él,
// el equipo no se puede vender, ni prestar, ni mover.
//
//   · Sección 1  — SIN la función (tablas ausentes): caja, tesorería, reportes
//                  y el inventario emiten el mismo SQL de siempre. Es la que hay
//                  que mirar primero: protege a los 28 negocios.
//   · Sección 2  — la migración: idempotente, y el runner usa el MISMO archivo.
//   · Sección 3  — enviar: solo equipos disponibles de la sucursal.
//   · Sección 4  — el CANDADO: vender, prestar, mover o borrar revienta con
//                  ST001 por cualquier camino; editar otra cosa, no.
//   · Sección 5  — recibir reparado: el costo sube con su rastro, la garantía
//                  se precarga del técnico, el precio solo si alguien lo pide.
//   · Sección 6  — la cuenta: anticipo, crédito, saldo a favor, devolución,
//                  anulación. El extracto termina en el mismo saldo.
//   · Sección 7  — caja y tesorería cuadran con los pagos.
//   · Sección 8  — garantía: el reclamo cubierto ($0) hereda el plazo; si el
//                  técnico cobra, el costo se aplica como en cualquier trabajo;
//                  una garantía vencida no se reclama.
//   · Sección 9  — equipo YA VENDIDO desde la orden del cliente: el costo no
//                  sube; va a la venta o a la orden, según se decida.
//   · Sección 10 — equipo consignado en un LOCAL: costo_compra (de la bodega)
//                  no se toca; los reportes lo suman sobre el valor interno.
//   · Sección 11 — permisos: null = base del rol.
//   · Sección 12 — aislamiento entre negocios.
//   · Sección 13 — avisos: demorado y garantía por vencer.
//   · Sección 14 — anular un envío y el doble clic.
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
await db.exec(`
  ALTER TABLE retomas   ADD COLUMN IF NOT EXISTS prestamo_id          INTEGER;
  ALTER TABLE retomas   ADD COLUMN IF NOT EXISTS sucursal_id          INTEGER;
  ALTER TABLE aperturas_caja ADD COLUMN IF NOT EXISTS usuario_id     INTEGER;
  ALTER TABLE aperturas_caja ADD COLUMN IF NOT EXISTS monto_inicial  NUMERIC DEFAULT 0;
  CREATE TABLE IF NOT EXISTS lineas_compra (
    id SERIAL PRIMARY KEY, compra_id INT, producto_id INT, imei TEXT,
    nombre_producto TEXT, cantidad INT DEFAULT 1, precio_unitario NUMERIC DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS movimientos_acreedor (
    id SERIAL PRIMARY KEY, acreedor_id INT, sucursal_id INT, tipo TEXT,
    valor NUMERIC DEFAULT 0, metodo TEXT, fecha TIMESTAMP DEFAULT NOW(),
    descripcion TEXT, cargo_id INT, compra_id INT,
    registrar_en_caja BOOLEAN DEFAULT TRUE, mov_dinero_id BIGINT, usuario_id INT
  );
  CREATE TABLE IF NOT EXISTS acreedores (id SERIAL PRIMARY KEY, negocio_id INT, nombre TEXT, proveedor_id INT);
  CREATE TABLE IF NOT EXISTS arqueos_cuenta (id SERIAL PRIMARY KEY, cuenta_id INT, fecha TIMESTAMP DEFAULT NOW(), saldo NUMERIC);
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS registrar_en_caja BOOLEAN DEFAULT TRUE;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS numero_factura TEXT;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS metodo TEXT;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS estado TEXT DEFAULT 'Activa';
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS total NUMERIC DEFAULT 0;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS proveedor_id INT;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS fecha TIMESTAMP DEFAULT NOW();
  ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS negocio_id INT;
  ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS usuario_id INT;
  ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS cliente_id INT;
  ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS cliente_cedula TEXT;
  ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS cliente_telefono TEXT;
  ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS negocio_id INT;
  CREATE TABLE IF NOT EXISTS auditoria (id SERIAL PRIMARY KEY, negocio_id INT, usuario_id INT,
    accion TEXT, tabla TEXT, registro_id INT, detalle JSONB, fecha TIMESTAMP DEFAULT NOW());
`);
for (const m of ['20260725_red_interna', '20260726_red_interna_v2', '20260822_red_interna_envios',
  '20260823_red_interna_control', '20260823_red_interna_cargos_pagables', '20260823_remision_variantes',
  '20260823_lotes_cantidad', '20260824_costo_origen_remision', '20260823_valor_acreditado']) {
  await db.exec(readFileSync(path.join(RAIZ, `../migrations/${m}.sql`), 'utf8'));
}

const conectar = (t) => ({
  query: async (text, params) => {
    const r = await t.query(text, params ?? []);
    return { ...r, rowCount: r.rowCount ?? r.affectedRows ?? (r.rows?.length ?? 0) };
  },
});
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] = {
  id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} },
};

const columnas  = require(path.join(RAIZ, 'src/config/columnas.js'));
const costoRed  = require(path.join(RAIZ, 'src/utils/costoRed.util.js'));
const cajaRepo  = require(path.join(RAIZ, 'src/modules/caja/caja.repository.js'));
const tesoRepo  = require(path.join(RAIZ, 'src/modules/tesoreria/tesoreria.repository.js'));
const serialRepo = require(path.join(RAIZ, 'src/modules/productos/productosSerial.repository.js'));
const svc       = require(path.join(RAIZ, 'src/modules/tecnicos/tecnicos.service.js'));
const cuenta    = require(path.join(RAIZ, 'src/modules/tecnicos/tecnicos.cuenta.js'));
const serviciosSvc = require(path.join(RAIZ, 'src/modules/servicios/servicios.service.js'));
const { puedeTecnicos } = require(path.join(RAIZ, 'src/middlewares/role.middleware.js'));
const tecMw     = require(path.join(RAIZ, 'src/middlewares/tecnicos.middleware.js'));
const { exigirNoEnTecnico } = require(path.join(RAIZ, 'src/utils/serialEnTecnico.util.js'));
const motor     = require(path.join(RAIZ, 'src/modules/notificaciones/notificaciones.motor.js'));
const costosUtil = require(path.join(RAIZ, 'src/utils/costos.util.js'));

// ── Reporte ─────────────────────────────────────────────────────────────────
let ok = 0; const fallos = [];
const q = async (s, p = []) => (await db.query(s, p)).rows;
const money = (n) => (n == null ? 'null' : '$' + Math.round(Number(n)).toLocaleString('es-CO'));
const check = (n, real, esp) => {
  const bien = Math.abs(Number(real || 0) - Number(esp || 0)) < 1;
  console.log(`  ${bien ? '✓' : '✗'} ${n}: ${money(real)}${bien ? '' : `  ← esperaba ${money(esp)}`}`);
  bien ? ok++ : fallos.push(`${n}: ${money(real)} (esperaba ${money(esp)})`);
};
const checkEq = (n, real, esp) => {
  const bien = JSON.stringify(real) === JSON.stringify(esp);
  console.log(`  ${bien ? '✓' : '✗'} ${n}: ${JSON.stringify(real)}${bien ? '' : ` ← esperaba ${JSON.stringify(esp)}`}`);
  bien ? ok++ : fallos.push(`${n}: ${JSON.stringify(real)} (esperaba ${JSON.stringify(esp)})`);
};
const checkSi = (n, cond) => {
  console.log(`  ${cond ? '✓' : '✗'} ${n}`);
  cond ? ok++ : fallos.push(n);
};
const falla = async (n, fn, patron) => {
  try {
    await fn();
    console.log(`  ✗ ${n}: no falló`); fallos.push(`${n}: no falló`);
  } catch (err) {
    const msg = `${err.code || ''} ${err.message || ''}`;
    const bien = !patron || patron.test(msg);
    console.log(`  ${bien ? '✓' : '✗'} ${n} → ${msg.trim().slice(0, 110)}`);
    bien ? ok++ : fallos.push(`${n}: ${msg}`);
  }
};
const seccion = (t) => console.log(`\n── ${t}`);

// ── Datos ───────────────────────────────────────────────────────────────────
// Negocio 1 con dos sedes (1 = bodega, 2 = local). Negocio 2 es el vecino que
// comparte la base y no puede ver nada.
await db.exec(`
  INSERT INTO negocios (id, nombre) VALUES (1, 'Cellsite'), (2, 'Vecino');
  INSERT INTO sucursales (id, negocio_id, nombre) VALUES (1, 1, 'Bodega'), (2, 1, 'Local'), (3, 2, 'Otro');
  INSERT INTO usuarios (id, nombre, negocio_id) VALUES (1, 'Admin', 1), (2, 'Super', 1), (3, 'Vende', 1), (9, 'Ajeno', 2);
  INSERT INTO productos_serial (id, nombre, precio, sucursal_id) VALUES
    (1, 'iPhone 11 usado', 900000, 1), (2, 'Moto G', 500000, 2), (3, 'iPhone ajeno', 1, 3);
  INSERT INTO seriales (id, producto_id, imei, costo_compra, precio) VALUES
    (1, 1, 'IMEI-A', 400000, 900000),
    (2, 1, 'IMEI-B', 300000, NULL),
    (3, 1, 'IMEI-C', 350000, NULL),
    (4, 2, 'IMEI-L', 200000, NULL),
    (5, 1, 'IMEI-V', 380000, NULL),
    (6, 3, 'IMEI-X', 100000, NULL),
    (7, 1, 'IMEI-D', 250000, NULL);
  SELECT setval('seriales_id_seq', 20);
  INSERT INTO aperturas_caja (id, sucursal_id, estado, fecha_apertura) VALUES (1, 1, 'Abierta', NOW() - INTERVAL '1 hour');
  INSERT INTO cuentas_dinero (id, negocio_id, sucursal_id, nombre, tipo, metodos_pago) VALUES
    (1, 1, 1, 'Efectivo bodega', 'efectivo', '{Efectivo}'),
    (2, 1, 1, 'Nequi bodega', 'billetera', '{Nequi}');
`);

const admin = { id: 1, negocio_id: 1, rol: 'admin_negocio', sucursal_id: null };
const superv = { id: 2, negocio_id: 1, rol: 'supervisor', sucursal_id: 1 };
const vende = { id: 3, negocio_id: 1, rol: 'vendedor', sucursal_id: 1 };
const ajeno = { id: 9, negocio_id: 2, rol: 'admin_negocio', sucursal_id: null };

// ═════════════════════════════════════════════════════════════════════════════
seccion('1. Sin la función: todo emite el SQL de siempre');
columnas._setTecnicosDisponible(false);
{
  const frag = costoRed.sqlCostoPorImei('l.imei', 'f.sucursal_id', 'f.fecha', 'f.id')
    + costoRed.sqlValorInternoEnStock('s.id', 'ps.sucursal_id');
  checkSi('los fragmentos de costo no nombran equipos_tecnico', !frag.includes('equipos_tecnico'));
  const cajaAntes = await cajaRepo.getResumenDia(1, 1, 1);
  checkSi('la caja del día resuelve sin las tablas', !!cajaAntes?.totales);
  check('  y no trae pagos a técnicos', cajaAntes.grupos.pagosTecnico.total, 0);
  const delta = await tesoRepo.getDeltaCuenta({ cuentaId: 1, sucursalId: 1, metodos: ['Efectivo'],
    esEfectivo: true, usarAncla: false, negocioId: 1 });
  checkSi('la tesorería resuelve sin las tablas', delta && Number.isFinite(delta.delta));
  const ser = await serialRepo.getSeriales(1, null);
  checkSi('el inventario de seriales resuelve sin las tablas', ser.length === 5);
  checkSi('  y no trae la columna del técnico', !('en_tecnico_nombre' in ser[0]));
  const cfg = await tecMw.getConfigTecnicos(1);
  checkEq('sin tablas la función está apagada aunque se encienda', cfg.activo, false);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('2. La migración');
const SQL_MIG = readFileSync(path.join(RAIZ, 'migrations/20260918_tecnicos_externos.sql'), 'utf8');
await db.exec(SQL_MIG);
await db.exec(SQL_MIG);
checkSi('se aplica dos veces sin error (idempotente)', true);
{
  const runner = readFileSync(path.join(RAIZ, 'src/config/migrations.js'), 'utf8');
  checkSi('el runner de arranque lee el MISMO archivo', runner.includes("migrations/20260918_tecnicos_externos.sql'"));
  await columnas.detectarColumnas();
  checkEq('detectarColumnas la reconoce', columnas.hayTecnicos(), true);
  tecMw.invalidarCache();
  checkEq('sin la clave en config, sigue apagada', (await tecMw.getConfigTecnicos(1)).activo, false);
  await q(`INSERT INTO config_negocio VALUES (1, 'tecnicos_externos_activo', '1')`);
  tecMw.invalidarCache();
  checkEq('encendida en Ajustes, activa', (await tecMw.getConfigTecnicos(1)).activo, true);
  checkEq('el vecino sigue apagado', (await tecMw.getConfigTecnicos(2)).activo, false);
  // Una venta normal de un serial que nunca salió no se entera del trigger.
  await q(`UPDATE seriales SET vendido = TRUE WHERE id = 7`);
  await q(`UPDATE seriales SET vendido = FALSE WHERE id = 7`);
  checkSi('vender un serial que nunca fue al técnico funciona igual', true);
}

const juan  = await svc.crearTecnico(1, { nombre: 'Juan Baterías', telefono: '300', garantia_dias_default: 30 });
const pedro = await svc.crearTecnico(1, { nombre: 'Pedro Pantallas' });
await falla('un técnico sin nombre no se crea', () => svc.crearTecnico(1, { nombre: '  ' }), /nombre/);

// ═════════════════════════════════════════════════════════════════════════════
seccion('3. Enviar');
await falla('un equipo de otra sucursal no sale desde esta', () =>
  svc.enviar(admin, 1, { tecnico_id: juan.id, equipos: [{ serial_id: 4, trabajo: 'x' }] }), /esta sucursal/);
await falla('sin trabajo no sale', () =>
  svc.enviar(admin, 1, { tecnico_id: juan.id, equipos: [{ serial_id: 1 }] }), /trabajo/);
await falla('el mismo equipo dos veces en la salida', () =>
  svc.enviar(admin, 1, { tecnico_id: juan.id, equipos: [{ serial_id: 1, trabajo: 'a' }, { serial_id: 1, trabajo: 'b' }] }), /repetido/);
await q(`UPDATE seriales SET prestado = TRUE WHERE id = 3`);
await falla('un equipo prestado no sale', () =>
  svc.enviar(admin, 1, { tecnico_id: juan.id, equipos: [{ serial_id: 3, trabajo: 'x' }] }), /prestado/);
await q(`UPDATE seriales SET prestado = FALSE WHERE id = 3`);
await q(`UPDATE seriales SET vendido = TRUE WHERE id = 5`);
await falla('un equipo vendido no sale del inventario (va por la orden)', () =>
  svc.enviar(admin, 1, { tecnico_id: juan.id, equipos: [{ serial_id: 5, trabajo: 'x' }] }), /orden de servicio/);
await falla('un técnico de otro negocio no existe aquí', () =>
  svc.enviar(ajeno, 3, { tecnico_id: juan.id, equipos: [{ serial_id: 6, trabajo: 'x' }] }), /Técnico no encontrado/);

// Salida #1: A y B a Juan, con anticipo de $50.000.
const s1 = await svc.enviar(superv, 1, {
  tecnico_id: juan.id,
  equipos: [{ serial_id: 1, trabajo: 'Cambio de batería' }, { serial_id: 2, trabajo: 'Revisar pin de carga' }],
  anticipo: { valor: 50000, metodo: 'Efectivo' },
});
checkEq('la salida lleva número', s1.salida.numero, 1);
checkEq('dos equipos, los dos En_tecnico', s1.equipos.map((e) => e.estado), ['En_tecnico', 'En_tecnico']);
check('el anticipo quedó registrado', s1.anticipo.valor, 50000);
await falla('un equipo no puede estar donde DOS técnicos', () =>
  svc.enviar(admin, 1, { tecnico_id: pedro.id, equipos: [{ serial_id: 1, trabajo: 'x' }] }), /está donde el técnico Juan/);

// ═════════════════════════════════════════════════════════════════════════════
seccion('4. El candado');
await falla('venderlo (UPDATE vendido)', () => q(`UPDATE seriales SET vendido = TRUE, fecha_salida = CURRENT_DATE WHERE id = 1`), /ST001|técnico Juan/);
await falla('prestarlo', () => q(`UPDATE seriales SET prestado = TRUE WHERE id = 1`), /ST001|técnico/);
await falla('moverlo de referencia (retoma / traslado)', () => q(`UPDATE seriales SET producto_id = 2 WHERE id = 1`), /ST001/);
await falla('borrarlo (cancelar la compra)', () => q(`DELETE FROM seriales WHERE id = 1`), /ST001/);
await q(`UPDATE seriales SET color = 'Negro' WHERE id = 1`);
checkSi('editar otro dato (color) sí se puede', true);
await falla('despachar a un local (el despacho no escribe en seriales)', () =>
  exigirNoEnTecnico(pool, 1, 'IMEI-A'), /Juan Baterías/);
{
  const ser = await serialRepo.getSeriales(1, null);
  const a = ser.find((s) => s.id === 1);
  checkEq('el inventario dice con quién está', a.en_tecnico_nombre, 'Juan Baterías');
  checkEq('  y el que no salió no dice nada', ser.find((s) => s.id === 3).en_tecnico_nombre, null);
  const disp = await svc.buscarDisponibles(1, 1, 'IMEI');
  checkSi('el buscador para enviar ya no lo ofrece', !disp.some((d) => d.id === 1) && disp.some((d) => d.id === 3));
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('5. Recibir reparado');
const eqA = s1.equipos.find((e) => e.serial_id === 1);
const eqB = s1.equipos.find((e) => e.serial_id === 2);
await falla('un vendedor sin la llave de pagar no paga al recibir', () =>
  svc.recibir(vende, 1, eqA.id, { resultado: 'Reparado', costo: 120000, pago: { valor: 10, metodo: 'Efectivo' } }, { puedePagar: false }), /permiso/);
const rA = await svc.recibir(superv, 1, eqA.id, { resultado: 'Reparado', costo: 120000, precio_venta: 1000000 }, { puedePagar: true });
checkEq('queda Reparado', rA.equipo.estado, 'Reparado');
checkEq('el costo fue a costo_compra', rA.equipo.costo_aplicado_a, 'costo_compra');
check('rastro: costo anterior', rA.equipo.costo_serial_anterior, 400000);
check('rastro: costo nuevo', rA.equipo.costo_serial_nuevo, 520000);
check('seriales.costo_compra = 400.000 + 120.000', (await q('SELECT costo_compra FROM seriales WHERE id = 1'))[0].costo_compra, 520000);
checkEq('la garantía se precargó del técnico', rA.equipo.garantia_dias, 30);
check('el precio cambió porque alguien lo pidió', (await q('SELECT precio FROM seriales WHERE id = 1'))[0].precio, 1000000);
check('  y quedó el precio anterior', rA.equipo.precio_anterior, 900000);
await q(`UPDATE seriales SET vendido = TRUE WHERE id = 1`);
await q(`UPDATE seriales SET vendido = FALSE WHERE id = 1`);
checkSi('recibido, ya se puede vender', true);
await falla('recibirlo dos veces', () => svc.recibir(superv, 1, eqA.id, { resultado: 'Reparado', costo: 1 }), /ya se recibió/);
{
  // Con el candado de costos, el vendedor no ve el costo del equipo, pero sí
  // lo que cobró el técnico (lo que se le debe).
  await q(`INSERT INTO config_negocio VALUES (1, 'costos_solo_admin', '1')`);
  costosUtil.invalidarCache();
  const lista = await svc.listarEquipos(vende, 1, {});
  const a = lista.find((e) => e.id === eqA.id);
  checkEq('costos_solo_admin: el vendedor no ve el costo del equipo', a.costo_serial_nuevo, null);
  check('  pero sí lo que cobró el técnico', a.costo, 120000);
  const listaAdmin = await svc.listarEquipos(admin, 1, {});
  check('  el admin sí lo ve', listaAdmin.find((e) => e.id === eqA.id).costo_serial_nuevo, 520000);
  await q(`DELETE FROM config_negocio WHERE clave = 'costos_solo_admin'`);
  costosUtil.invalidarCache();
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('6. La cuenta del técnico');
let det = await svc.detalleTecnico(admin, juan.id);
check('cargo 120.000 − anticipo 50.000 = le debemos 70.000', det.resumen.deuda, 70000);
check('  pendiente del cargo de A', det.equipos.find((e) => e.id === eqA.id).pago.pendiente, 70000);
await falla('pagarle más de lo que se le debe', () =>
  svc.registrarPago(superv, 1, juan.id, { tipo: 'Pago', valor: 80000, metodo: 'Efectivo' }), /anticipo/);
await falla('devolverle algo que no tiene a favor', () =>
  svc.registrarPago(superv, 1, juan.id, { tipo: 'Devolucion', valor: 1000, metodo: 'Efectivo' }), /no tiene/);
const p70 = await svc.registrarPago(superv, 1, juan.id, { tipo: 'Pago', valor: 70000, metodo: 'Nequi' });
check('pagado lo que se debía, queda en 0', p70.resumen.saldo, 0);

// B vuelve SIN reparar, con $20.000 de diagnóstico. Antes, anticipo de 100.000
// a la salida #2 (C a Juan).
const s2 = await svc.enviar(superv, 1, {
  tecnico_id: juan.id, equipos: [{ serial_id: 3, trabajo: 'Pantalla' }],
  anticipo: { valor: 100000, metodo: 'Efectivo' },
});
const rB = await svc.recibir(superv, 1, eqB.id, { resultado: 'Sin_reparar', costo: 20000 }, { puedePagar: true });
checkEq('B volvió sin reparar', rB.equipo.estado, 'Sin_reparar');
check('el diagnóstico SÍ se suma al costo del equipo', (await q('SELECT costo_compra FROM seriales WHERE id = 2'))[0].costo_compra, 320000);
checkEq('  y no lleva garantía', rB.equipo.garantia_dias, null);
check('anticipo 100.000 − diagnóstico 20.000 = 80.000 a favor', rB.resumen.saldo_a_favor, 80000);
await falla('devolver 90.000 cuando hay 80.000 a favor', () =>
  svc.registrarPago(superv, 1, juan.id, { tipo: 'Devolucion', valor: 90000, metodo: 'Efectivo' }), /80\.000/);
const dev = await svc.registrarPago(superv, 1, juan.id, { tipo: 'Devolucion', valor: 30000, metodo: 'Efectivo' });
check('devolvió 30.000: quedan 50.000 a favor', dev.resumen.saldo_a_favor, 50000);
// C vuelve reparado por 60.000: el saldo a favor se consume solo.
const eqC = s2.equipos[0];
const rC = await svc.recibir(superv, 1, eqC.id, { resultado: 'Reparado', costo: 60000, garantia_dias: 15 }, { puedePagar: true });
check('C cobra 60.000 contra 50.000 a favor: se le deben 10.000', rC.resumen.deuda, 10000);
checkEq('la garantía escrita manda sobre la del técnico', rC.equipo.garantia_dias, 15);
det = await svc.detalleTecnico(admin, juan.id);
checkSi('el anticipo de la salida #2 se ve en SU cargo (C)',
  det.equipos.find((e) => e.id === eqC.id).pago.pagado > 0);
const ultimo = det.extracto[det.extracto.length - 1];
check('el extracto termina en el mismo saldo que el resumen', ultimo.saldo, det.resumen.saldo);
// Anular el pago de 70.000: vuelve la deuda.
await svc.anularPago(admin, p70.pago.id, 'Se registró en el método equivocado');
det = await svc.detalleTecnico(admin, juan.id);
check('anulado el pago de 70.000, la deuda vuelve a 80.000', det.resumen.deuda, 80000);
checkSi('el pago anulado sigue en el extracto, sin mover el saldo',
  det.extracto.some((m) => m.anulado && m.valor === 70000 && m.signo === 0));
await falla('anularlo dos veces', () => svc.anularPago(admin, p70.pago.id, 'x'), /ya estaba anulado/);
await falla('anular sin motivo', () => svc.anularPago(admin, dev.pago.id, ''), /motivo/);

// ═════════════════════════════════════════════════════════════════════════════
seccion('7. Caja y tesorería');
{
  const c = await cajaRepo.getResumenDia(1, 1, 1);
  // Salen: anticipo 50.000 + anticipo 100.000 (efectivo). El de 70.000 por
  // Nequi se anuló y no cuenta. Entra: devolución 30.000.
  check('caja: pagos a técnicos (egreso)', c.grupos.pagosTecnico.total, 150000);
  check('caja: devoluciones de técnicos (ingreso)', c.grupos.devolucionesTecnico.total, 30000);
  checkSi('  el pago anulado no está', !c.grupos.pagosTecnico.items.some((i) => Number(i.valor) === 70000));
  check('caja: por método, Efectivo sale 150.000', c.metodosPagoDetalle.Efectivo.egresos, 150000);
  check('caja: por método, Efectivo entra 30.000', c.metodosPagoDetalle.Efectivo.ingresos, 30000);
  const ef = await tesoRepo.getDeltaCuenta({ cuentaId: 1, sucursalId: 1, metodos: ['Efectivo'],
    esEfectivo: true, usarAncla: false, negocioId: 1 });
  check('tesorería efectivo: −150.000 + 30.000', ef.delta, -120000);
  const nq = await tesoRepo.getDeltaCuenta({ cuentaId: 2, sucursalId: 1, metodos: ['Nequi'],
    esEfectivo: false, usarAncla: false, negocioId: 1 });
  check('tesorería Nequi: el pago anulado no la mueve', nq.delta, 0);
  const otra = await cajaRepo.getResumenDia(1, 2, 1);
  check('la caja de OTRA sucursal no ve estos pagos', otra.grupos.pagosTecnico.total, 0);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('8. Garantía');
const recl = await svc.reclamarGarantia(superv, 1, eqC.id, { trabajo: 'La pantalla volvió a fallar' });
checkEq('el reclamo va al MISMO técnico', recl.equipos[0].tecnico_id, juan.id);
checkEq('  ligado al trabajo original', recl.equipos[0].reclamo_de_id, eqC.id);
await falla('el equipo vuelve a quedar bloqueado', () => q(`UPDATE seriales SET vendido = TRUE WHERE id = 3`), /ST001/);
await falla('no se abren dos reclamos del mismo trabajo', () => svc.reclamarGarantia(superv, 1, eqC.id, {}), /reclamo abierto/);
const costoCAntes = Number((await q('SELECT costo_compra FROM seriales WHERE id = 3'))[0].costo_compra);
const deudaAntesRecl = (await svc.detalleTecnico(admin, juan.id)).resumen.saldo;
const rRecl = await svc.recibir(superv, 1, recl.equipos[0].id, { resultado: 'Reparado', costo: 0 }, { puedePagar: true });
check('un reclamo cubierto ($0) no cobra nada', rRecl.equipo.costo, 0);
check('  y el costo del equipo no cambia', (await q('SELECT costo_compra FROM seriales WHERE id = 3'))[0].costo_compra, costoCAntes);
checkSi('  hereda lo que quedaba de la garantía original (≤ 15 días)', rRecl.equipo.garantia_dias <= 15 && rRecl.equipo.garantia_dias >= 14);
check('  y la cuenta del técnico no se mueve', (await svc.detalleTecnico(admin, juan.id)).resumen.saldo, deudaAntesRecl);
// Segundo reclamo del mismo trabajo, esta vez el técnico COBRA (la falla nueva
// no la cubría su garantía): el costo se aplica como en cualquier trabajo.
const recl2 = await svc.reclamarGarantia(superv, 1, eqC.id, { trabajo: 'Ahora falla el flex' });
const rRecl2 = await svc.recibir(superv, 1, recl2.equipos[0].id,
  { resultado: 'Reparado', costo: 45000, garantia_dias: 20 }, { puedePagar: true });
check('un reclamo que el técnico cobró SÍ aplica su costo', rRecl2.equipo.costo, 45000);
checkEq('  sigue ligado al trabajo original', rRecl2.equipo.reclamo_de_id, eqC.id);
check('  sube el costo del equipo', (await q('SELECT costo_compra FROM seriales WHERE id = 3'))[0].costo_compra, costoCAntes + 45000);
check('  y entra a la cuenta del técnico', (await svc.detalleTecnico(admin, juan.id)).resumen.saldo, deudaAntesRecl + 45000);
checkEq('  con la garantía escrita (trabajo pagado, garantía propia)', rRecl2.equipo.garantia_dias, 20);
await q(`UPDATE equipos_tecnico SET fecha_regreso = NOW() - INTERVAL '40 days' WHERE id = $1`, [eqA.id]);
await falla('una garantía vencida no se reclama', () => svc.reclamarGarantia(superv, 1, eqA.id, {}), /venció/);

// ═════════════════════════════════════════════════════════════════════════════
seccion('9. Equipo YA VENDIDO desde la orden del cliente');
// IMEI-V (serial 5) se vendió en la factura 1 por 700.000.
await db.exec(`
  INSERT INTO facturas (id, numero, sucursal_id, nombre_cliente, estado, fecha) VALUES (1, 1, 1, 'Ana', 'Activa', NOW() - INTERVAL '30 days');
  INSERT INTO lineas_factura (factura_id, nombre_producto, imei, cantidad, precio) VALUES (1, 'iPhone 11 usado', 'IMEI-V', 1, 700000);
  INSERT INTO ordenes_servicio (id, negocio_id, sucursal_id, estado, cliente_nombre, equipo_serial, equipo_nombre, falla_reportada)
    VALUES (1, 1, 1, 'Recibido', 'Ana', 'IMEI-V', 'iPhone 11', 'No carga'),
           (2, 1, 1, 'Recibido', 'Luis', 'IMEI-NO-ES-NUESTRO', 'Samsung A10', 'Pantalla');
`);
const so = await svc.enviarDesdeOrden(superv, 1, { tecnico_id: pedro.id, trabajo: 'Pin de carga' });
checkEq('el IMEI vendido queda ligado (origen vendido)', [so.equipos[0].origen, so.equipos[0].serial_id], ['vendido', 5]);
checkEq('la orden pasa a En_reparacion', (await q('SELECT estado FROM ordenes_servicio WHERE id = 1'))[0].estado, 'En_reparacion');
await falla('cancelar la venta mientras está donde el técnico', () => q(`UPDATE seriales SET vendido = FALSE WHERE id = 5`), /ST001/);
await falla('la orden no se entrega con el equipo afuera', () => serviciosSvc.entregar(1, 1), /Pedro Pantallas/);
await falla('la orden no se marca lista con el equipo afuera', () => serviciosSvc.marcarListo(1, 1, { precio_final: 1 }), /técnico/);
const rV = await svc.recibir(superv, 1, so.equipos[0].id, { resultado: 'Reparado', costo: 80000, cargar_a: 'venta' }, { puedePagar: true });
checkEq('cargado a la venta', [rV.equipo.costo_aplicado_a, rV.equipo.factura_cargo_id], ['venta', 1]);
check('el costo del serial vendido NO sube', (await q('SELECT costo_compra FROM seriales WHERE id = 5'))[0].costo_compra, 380000);
{
  const [r] = await q(`
    SELECT ${costoRed.sqlCostoPorImei('l.imei', 'f.sucursal_id', 'f.fecha', 'f.id')} AS costo
    FROM lineas_factura l JOIN facturas f ON f.id = l.factura_id WHERE f.id = 1`);
  check('el reporte de ESA venta ve costo 380.000 + 80.000', r.costo, 460000);
  const [r2] = await q(`
    SELECT ${costoRed.sqlCostoPorImei('l.imei', 'f.sucursal_id', 'f.fecha')} AS costo
    FROM lineas_factura l JOIN facturas f ON f.id = l.factura_id WHERE f.id = 1`);
  check('  sin la factura (otros llamadores) no suma nada', r2.costo, 380000);
}
const so2 = await svc.enviarDesdeOrden(admin, 2, { tecnico_id: pedro.id, trabajo: 'Pantalla' });
checkEq('un IMEI que no es nuestro es equipo del cliente', [so2.equipos[0].origen, so2.equipos[0].serial_id], ['cliente', null]);
await svc.recibir(admin, 1, so2.equipos[0].id, { resultado: 'Reparado', costo: 150000 }, { puedePagar: true });
check('su costo va a la orden del cliente (costo_real)', (await q('SELECT costo_real FROM ordenes_servicio WHERE id = 2'))[0].costo_real, 150000);
await serviciosSvc.marcarListo(1, 2, { precio_final: 220000, costo_real: 150000 });
checkSi('con el equipo de vuelta, la orden sí se marca lista', true);

// ═════════════════════════════════════════════════════════════════════════════
seccion('10. Equipo CONSIGNADO en un local de la red');
// IMEI-L (serial 4) llegó al Local (suc 2) en una remisión con valor interno
// de 260.000. Su costo_compra (200.000) es el de la bodega.
await db.exec(`
  INSERT INTO remisiones (id, negocio_id, tipo, sucursal_origen_id, sucursal_destino_id, estado, fecha_emision)
    VALUES (1, 1, 'entrega', 1, 2, 'Recibida', NOW() - INTERVAL '10 days');
  INSERT INTO lineas_remision (remision_id, tipo, serial_id, imei, estado_linea, valor_interno)
    VALUES (1, 'serial', 4, 'IMEI-L', 'Recibida', 260000);
`);
const sl = await svc.enviar(admin, 2, { tecnico_id: juan.id, equipos: [{ serial_id: 4, trabajo: 'Batería' }] });
const rL = await svc.recibir(admin, 2, sl.equipos[0].id, { resultado: 'Reparado', costo: 50000 }, { puedePagar: true });
checkEq('se marca sobre el valor interno', rL.equipo.costo_aplicado_a, 'valor_interno');
check('costo_compra (la verdad de la bodega) no se toca', (await q('SELECT costo_compra FROM seriales WHERE id = 4'))[0].costo_compra, 200000);
{
  const [r] = await q(`SELECT ${costoRed.sqlValorInternoEnStock('s.id', 'ps.sucursal_id')} AS v
    FROM seriales s JOIN productos_serial ps ON ps.id = s.producto_id WHERE s.id = 4`);
  check('el valor del local en inventario = 260.000 + 50.000', r.v, 310000);
  await db.exec(`
    INSERT INTO facturas (id, numero, sucursal_id, nombre_cliente, estado, fecha) VALUES (2, 2, 2, 'Beto', 'Activa', NOW() + INTERVAL '1 minute');
    INSERT INTO lineas_factura (factura_id, nombre_producto, imei, cantidad, precio) VALUES (2, 'Moto G', 'IMEI-L', 1, 400000);
  `);
  const [v] = await q(`
    SELECT ${costoRed.sqlCostoPorImei('l.imei', 'f.sucursal_id', 'f.fecha', 'f.id')} AS costo
    FROM lineas_factura l JOIN facturas f ON f.id = l.factura_id WHERE f.id = 2`);
  check('la venta en el local reporta costo 310.000', v.costo, 310000);
  const [b] = await q(`SELECT costo_compra FROM seriales WHERE id = 4`);
  check('y la bodega sigue viendo su 200.000', b.costo_compra, 200000);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('11. Permisos');
checkEq('base supervisor: mover y pagar', ['mover', 'pagar', 'anular', 'gestionar'].map((a) => puedeTecnicos(superv, a)), [true, true, false, false]);
checkEq('base vendedor: solo mover', ['mover', 'pagar', 'anular', 'gestionar'].map((a) => puedeTecnicos(vende, a)), [true, false, false, false]);
checkEq('admin: todo', ['mover', 'pagar', 'anular', 'gestionar'].map((a) => puedeTecnicos(admin, a)), [true, true, true, true]);
checkEq('objeto explícito: se le quita mover al vendedor y se le da anular',
  ['mover', 'anular', 'pagar'].map((a) => puedeTecnicos({ ...vende, permisos_tecnicos: { mover: false, anular: true } }, a)),
  [false, true, false]);
checkEq('un token viejo sin la clave cae en la base', puedeTecnicos({ rol: 'supervisor' }, 'pagar'), true);

// ═════════════════════════════════════════════════════════════════════════════
seccion('12. Aislamiento entre negocios');
checkEq('el vecino no ve técnicos', (await svc.listarTecnicos(2)).length, 0);
await falla('el vecino no abre la cuenta de Juan', () => svc.detalleTecnico(ajeno, juan.id), /no encontrado/);
await falla('el vecino no recibe un equipo de Juan', () =>
  svc.recibir(ajeno, 3, eqB.id, { resultado: 'Reparado', costo: 1 }), /no encontrado/);
await falla('el vecino no le paga a Juan', () =>
  svc.registrarPago(ajeno, 3, juan.id, { tipo: 'Anticipo', valor: 1, metodo: 'Efectivo' }), /no encontrado/);
checkEq('la lista de equipos del vecino está vacía', (await svc.listarEquipos(ajeno, 3, { alcance: 'negocio' })).length, 0);
{
  await q(`INSERT INTO seriales (id, producto_id, imei, costo_compra) VALUES (21, 2, 'IMEI-L2', 100000)`);
  const sOtra = await svc.enviar(admin, 2, { tecnico_id: pedro.id, equipos: [{ serial_id: 21, trabajo: 'x' }] });
  await falla('un supervisor no recibe un equipo de otra sucursal', () =>
    svc.recibir(superv, 1, sOtra.equipos[0].id, { resultado: 'Reparado' }), /otra sucursal/);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('13. Avisos');
{
  const sd = await svc.enviar(admin, 1, { tecnico_id: pedro.id, equipos: [{ serial_id: 7, trabajo: 'Cámara' }] });
  await q(`UPDATE salidas_tecnico SET fecha = NOW() - INTERVAL '10 days' WHERE id = $1`, [sd.salida.id]);
  // La garantía de C (15 días) vence dentro de la ventana de 5 días si la
  // corremos: regreso hace 12 días → vence en 3.
  await q(`UPDATE equipos_tecnico SET fecha_regreso = NOW() - INTERVAL '12 days' WHERE id = $1`, [eqC.id]);
  const r = await motor.recolectar(1);
  const claves = r.senales.map((s) => s.clave);
  checkSi('equipo demorado (10 días ≥ 7)', claves.includes('tecnicos_demorados'));
  checkSi('garantía del técnico por vencer', claves.includes('tecnicos_garantia_por_vencer'));
  checkEq('  el detalle nombra el equipo', r.detalle.tecnicos.garantias.items.map((i) => i.imei), ['IMEI-C']);
  const r2 = await motor.recolectar(2);
  checkSi('el vecino (apagado) no recibe esas señales', !r2.senales.some((s) => s.categoria === 'tecnicos'));
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('14. Anular un envío y el doble clic');
{
  const [abierto] = await q(`SELECT id FROM equipos_tecnico WHERE serial_id = 7 AND estado = 'En_tecnico'`);
  await falla('anular sin motivo', () => svc.anularEquipo(admin, 1, abierto.id, ''), /motivo/);
  await svc.anularEquipo(admin, 1, abierto.id, 'Lo mandé al técnico equivocado');
  await q(`UPDATE seriales SET vendido = TRUE WHERE id = 7`);
  checkSi('anulado el envío, el equipo queda libre', true);
  await q(`UPDATE seriales SET vendido = FALSE WHERE id = 7`);
  det = await svc.detalleTecnico(admin, pedro.id);
  checkSi('un envío anulado no genera cargo', !det.extracto.some((m) => m.detalle?.imei === 'IMEI-D'));
  await svc.registrarPago(admin, 1, pedro.id, { tipo: 'Anticipo', valor: 12345, metodo: 'Efectivo' });
  await falla('el mismo anticipo dos veces seguidas', () =>
    svc.registrarPago(admin, 1, pedro.id, { tipo: 'Anticipo', valor: 12345, metodo: 'Efectivo' }), /ya se registró/);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('15. La cuenta pura (sin base)');
{
  const eqs = [
    { id: 1, salida_id: 10, estado: 'Reparado', costo: 100, fecha_regreso: '2026-01-02' },
    { id: 2, salida_id: 11, estado: 'Reparado', costo: 50, fecha_regreso: '2026-01-03' },
    { id: 3, salida_id: 12, estado: 'En_tecnico', costo: 0 },
    { id: 4, salida_id: 12, estado: 'Anulado', costo: 999 },
  ];
  const pg = [
    { id: 1, tipo: 'Anticipo', valor: 50, salida_id: 11, fecha: '2026-01-01' },
    { id: 2, tipo: 'Pago', valor: 30, salida_id: null, fecha: '2026-01-04' },
    { id: 3, tipo: 'Pago', valor: 1000, salida_id: null, fecha: '2026-01-05', anulado: true },
  ];
  const imp = cuenta.imputar(eqs, pg);
  checkEq('el anticipo dirigido paga SU salida', imp.get(2), { valor: 50, pagado: 50, pendiente: 0 });
  checkEq('el pago suelto va al cargo más viejo', imp.get(1), { valor: 100, pagado: 30, pendiente: 70 });
  check('un equipo anulado o afuera no es cargo', cuenta.resumen(eqs, pg).total_cargos, 150);
  check('el anulado no cuenta', cuenta.saldoDe(eqs, pg), 70);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('16. El frontend promete lo mismo que el backend');
{
  // Las dos copias de la regla de permisos (el frontend no puede importar del
  // backend). Si se separan, la pantalla ofrece botones que el backend rechaza
  // o esconde lo que sí se puede — lo que ya pasó con la lista de módulos.
  const FRONT = path.resolve(RAIZ, '../frontend/src');
  const permisosFront = await import(new URL(`file:///${path.join(FRONT, 'utils/permisosTecnicos.js').replace(/\\/g, '/')}`).href);
  const { BASE_TECNICOS } = require(path.join(RAIZ, 'src/middlewares/role.middleware.js'));
  checkEq('la base de permisos es la misma en las dos copias', permisosFront.BASE_TECNICOS, BASE_TECNICOS);
  const llaves = permisosFront.LLAVES_TECNICOS.map((l) => l.id).sort();
  checkEq('las cuatro llaves son las mismas', llaves, ['anular', 'gestionar', 'mover', 'pagar']);
  for (const u of [superv, vende, admin, { ...vende, permisos_tecnicos: { pagar: true } }]) {
    for (const a of llaves) {
      if (permisosFront.puedeTecnicos(u, a) !== puedeTecnicos(u, a)) {
        fallos.push(`puedeTecnicos difiere para ${u.rol}/${a}`);
      }
    }
  }
  checkSi('puedeTecnicos da lo mismo en las dos copias (16 casos)', !fallos.some((f) => f.startsWith('puedeTecnicos difiere')));

  // Los rangos de los avisos: Ajustes los ofrece y config.service los valida con
  // los del middleware. Una pantalla que ofrece 120 días guardaría un número que
  // el backend rechaza.
  const cfgPage = readFileSync(path.join(FRONT, 'pages/configuracion/ConfigPage.jsx'), 'utf8');
  for (const [clave, r] of Object.entries(tecMw.RANGOS)) {
    checkSi(`Ajustes ofrece ${clave} con ${r.defecto}, ${r.min} y ${r.max}`,
      cfgPage.includes(`campo('${clave}', ${r.defecto}, ${r.min}, ${r.max},`));
  }
  // Marcar lista una orden no puede borrar lo que cobró el técnico.
  const servPage = readFileSync(path.join(FRONT, 'pages/servicios/ServiciosPage.jsx'), 'utf8');
  checkSi('Marcar listo arranca con el costo_real que ya tiene la orden', servPage.includes('orden.costo_real != null ? Number(orden.costo_real)'));
  checkSi('la caja pinta los dos grupos nuevos',
    ['pagosTecnico', 'devolucionesTecnico'].every((g) =>
      readFileSync(path.join(FRONT, 'pages/caja/CajaPage.jsx'), 'utf8').includes(`grupoKey="${g}"`)));
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('17. Trazabilidad: la línea de tiempo del IMEI');
{
  const busqueda = require(path.join(RAIZ, 'src/modules/busqueda/busqueda.service.js'));
  const r = await busqueda.buscarPorIMEI('IMEI-C', 1, 'admin_negocio');
  const tec = r.historial.filter((h) => h.tipo === 'tecnico');
  checkEq('IMEI-C muestra sus tres pasos por el técnico (trabajo y dos reclamos)', tec.map((t) => t.detalle.reclamo), [false, true, true]);
  checkEq('  con quién estuvo', [...new Set(tec.map((t) => t.detalle.tecnico))], ['Juan Baterías']);
  check('  el admin ve lo que cobró', tec[0].detalle.costo, 60000);
  const rv = await busqueda.buscarPorIMEI('IMEI-C', 1, 'vendedor');
  checkEq('el vendedor NO ve el costo', rv.historial.find((h) => h.tipo === 'tecnico').detalle.costo, undefined);
  const otro = await busqueda.buscarPorIMEI('IMEI-C', 2, 'admin_negocio');
  checkEq('el vecino no ve nada de ese IMEI', otro, null);
}

// ── Resultado ───────────────────────────────────────────────────────────────
console.log(`\n${ok} verificaciones correctas, ${fallos.length} fallas`);
if (fallos.length) {
  console.log('\nFALLAS:');
  fallos.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
process.exit(0);
