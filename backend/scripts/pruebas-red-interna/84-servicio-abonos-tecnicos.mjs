// ─────────────────────────────────────────────────────────────────────────────
// SERVICIO TÉCNICO — abonos en cualquier etapa y el técnico que reparó.
// Ver migrations/20261025_servicio_abonos_tecnicos.sql (pedido del usuario,
// 25-oct-2026: «el cliente apenas entrega el celular da un abono o transfiere
// la mitad»).
//
//   · Sección 1  — SIN la migración: todo como antes (abonos solo al final, el
//                  diagnóstico, la caja). Es la que hay que mirar primero.
//   · Sección 2  — la migración: idempotente y el runner lee el MISMO archivo.
//   · Sección 3  — abono al RECIBIR, en la misma transacción que la orden.
//   · Sección 4  — sin precio no hay tope; el doble clic se rechaza.
//   · Sección 5  — el precio queda por debajo de lo abonado: 409 y devolución.
//   · Sección 6  — caja, tesorería y la factura al entregar cuadran.
//   · Sección 7  — sin reparar con anticipo: devuelve el resto o cobra la falta.
//   · Sección 8  — anular un abono (y lo que no se puede anular).
//   · Sección 9  — garantía: el saldo se mide contra el precio de la GARANTÍA.
//   · Sección 10 — técnicos internos: lista, asignación, obligatorio, filtro.
//   · Sección 11 — el técnico externo que lo reparó responde solo.
//   · Sección 12 — reporte «Por técnico» suma lo mismo que el reporte.
//   · Sección 13 — los PDF salen con los abonos y las devoluciones.
//   · Sección 14 — el frontend promete lo mismo que el backend.
//
// Requiere PGlite (no va en package.json a propósito):
//   npm install --no-save @electric-sql/pglite
// ─────────────────────────────────────────────────────────────────────────────
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { PassThrough } from 'node:stream';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');
const FRONT = path.resolve(RAIZ, '../frontend/src');

const db = new PGlite();
// La base de producción fija la zona de Bogotá en cada conexión (db.js).
await db.exec("SET TIME ZONE 'America/Bogota'");
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
  ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS negocio_id INT;
  CREATE TABLE IF NOT EXISTS auditoria (id SERIAL PRIMARY KEY, negocio_id INT, usuario_id INT,
    accion TEXT, tabla TEXT, registro_id INT, detalle JSONB, fecha TIMESTAMP DEFAULT NOW());

  -- Las dos tablas de Servicios con las columnas y CHECK de PRODUCCIÓN (el
  -- fixture viejo no tiene costo_estimado, negocio_id, el CHECK de estado…).
  DROP TABLE IF EXISTS abonos_servicio CASCADE;
  DROP TABLE IF EXISTS ordenes_servicio CASCADE;
  CREATE TABLE ordenes_servicio (
    id SERIAL PRIMARY KEY,
    sucursal_id integer NOT NULL, negocio_id integer NOT NULL, usuario_id integer,
    cliente_nombre character varying(150) NOT NULL, cliente_telefono character varying(20),
    cliente_id integer, equipo_tipo character varying(50), equipo_nombre character varying(100),
    equipo_serial character varying(100), falla_reportada text NOT NULL,
    contrasena_equipo character varying(100), notas_tecnico text,
    costo_estimado numeric(12,2), costo_real numeric(12,2), precio_final numeric(12,2),
    total_abonado numeric(12,2) DEFAULT 0 NOT NULL, motivo_sin_reparar character varying(100),
    garantia_cobrable boolean DEFAULT false NOT NULL, orden_origen_id integer,
    estado character varying(20) DEFAULT 'Recibido' NOT NULL,
    fecha_recepcion timestamp without time zone DEFAULT now() NOT NULL,
    fecha_entrega timestamp without time zone,
    creado_en timestamp without time zone DEFAULT now() NOT NULL,
    cliente_cedula character varying(30), precio_garantia numeric(12,2), costo_garantia numeric(12,2),
    checklist_equipo jsonb, patron_desbloqueo jsonb, factura_id integer, numero integer,
    CONSTRAINT ordenes_servicio_estado_check CHECK (estado IN
      ('Recibido','En_reparacion','Listo','Entregado','Pendiente_pago','Sin_reparar','Garantia'))
  );
  CREATE TABLE abonos_servicio (
    id SERIAL PRIMARY KEY, orden_id integer NOT NULL, usuario_id integer,
    valor numeric(12,2) NOT NULL, metodo character varying(30) DEFAULT 'Efectivo' NOT NULL,
    notas text, fecha timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT abonos_servicio_valor_check CHECK (valor > 0)
  );
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
const cajaRepo  = require(path.join(RAIZ, 'src/modules/caja/caja.repository.js'));
const tesoRepo  = require(path.join(RAIZ, 'src/modules/tesoreria/tesoreria.repository.js'));
const svc       = require(path.join(RAIZ, 'src/modules/servicios/servicios.service.js'));
const repo      = require(path.join(RAIZ, 'src/modules/servicios/servicios.repository.js'));
const tecnicos  = require(path.join(RAIZ, 'src/modules/servicios/servicios.tecnicos.js'));
const pdf       = require(path.join(RAIZ, 'src/modules/servicios/servicios.pdf.js'));
const reportes  = require(path.join(RAIZ, 'src/modules/reportes/reportes.service.js'));
const configSvc = require(path.join(RAIZ, 'src/modules/config/config.service.js'));

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
    return null;
  } catch (err) {
    const msg = `${err.code || ''} ${err.message || ''}`;
    const bien = !patron || patron.test(msg);
    console.log(`  ${bien ? '✓' : '✗'} ${n} → ${msg.trim().slice(0, 110)}`);
    bien ? ok++ : fallos.push(`${n}: ${msg}`);
    return err;
  }
};
const seccion = (t) => console.log(`\n── ${t}`);

// ── Datos ───────────────────────────────────────────────────────────────────
await db.exec(`
  INSERT INTO negocios (id, nombre) VALUES (1, 'Celulares Centro'), (2, 'Vecino');
  INSERT INTO sucursales (id, negocio_id, nombre) VALUES (1, 1, 'Centro'), (2, 1, 'Norte'), (3, 2, 'Otro');
  INSERT INTO usuarios (id, nombre, negocio_id) VALUES (1, 'Admin', 1), (2, 'Cajera', 1), (9, 'Ajeno', 2);
  INSERT INTO aperturas_caja (id, sucursal_id, estado, fecha_apertura) VALUES (1, 1, 'Abierta', NOW() - INTERVAL '1 hour');
  INSERT INTO cuentas_dinero (id, negocio_id, sucursal_id, nombre, tipo, metodos_pago) VALUES
    (1, 1, 1, 'Efectivo Centro', 'efectivo', '{Efectivo}'),
    (2, 1, 1, 'Nequi Centro', 'billetera', '{Nequi}');
`);
const N = 1;          // negocio
const S = 1;          // sede Centro
const ADMIN = 1;
const orden = async (id) => (await q('SELECT * FROM ordenes_servicio WHERE id = $1', [id]))[0];
const abonos = async (id) => q('SELECT * FROM abonos_servicio WHERE orden_id = $1 ORDER BY id', [id]);
const nueva = (extra = {}) => svc.crearOrden({
  sucursal_id: S, negocio_id: N, usuario_id: ADMIN,
  cliente_nombre: 'Laura Ríos', cliente_telefono: '3001234567', cliente_cedula: '1020',
  equipo_tipo: 'Celular', equipo_nombre: 'iPhone 12', falla_reportada: 'No carga', ...extra,
});
const abonar = (id, valor, metodo = 'Efectivo') => svc.registrarAbono(N, id, { valor, metodo, usuarioId: ADMIN });
const cajaDia = () => cajaRepo.getResumenDia(1, S, N);
const deltaTeso = async (cuentaId, metodo, esEfectivo) => (await tesoRepo.getDeltaCuenta({
  cuentaId, sucursalId: S, metodos: [metodo], esEfectivo, usarAncla: false, negocioId: N })).delta;

// ═════════════════════════════════════════════════════════════════════════════
seccion('1. Sin la migración: todo como antes');
{
  columnas._setServicioAbonosV2Disponible(false);
  columnas._setTecnicosServicioDisponible(false);
  const o = await nueva({ costo_estimado: 100000 });
  checkEq('la orden nace Recibido, numerada', [o.estado, o.numero], ['Recibido', 1]);
  await falla('abonar al recibir NO se puede (como siempre)', () => abonar(o.id, 10000), /no permite abonos/);
  await falla('ni crear la orden con abono inicial', () => nueva({ abono_inicial: { valor: 5000 } }), /actualización/);
  checkEq('ese intento no dejó orden', (await q('SELECT COUNT(*)::int AS n FROM ordenes_servicio'))[0].n, 1);
  await svc.marcarListo(N, o.id, { precio_final: 90000, costo_real: 40000 });
  await abonar(o.id, 50000);
  const ent = await svc.entregar(N, o.id);
  checkEq('entregar con saldo → Pendiente de pago', [ent.estado, Number(ent.saldo_al_entregar)], ['Pendiente_pago', 40000]);
  await abonar(o.id, 40000, 'Nequi');
  const fin = await orden(o.id);
  checkEq('el último abono la entrega y crea la factura', [fin.estado, !!fin.factura_id], ['Entregado', true]);
  const pagos = await q('SELECT metodo, valor::int AS v FROM pagos_factura WHERE factura_id = $1 ORDER BY metodo', [fin.factura_id]);
  checkEq('la factura con los pagos por método', pagos.map((p) => [p.metodo, p.v]), [['Efectivo', 50000], ['Nequi', 40000]]);
  const sr = await nueva();
  await svc.sinReparar(N, sr.id, { motivo: 'Falta de repuestos', precio_diagnostico: 15000, usuario_id: ADMIN });
  const abSr = await abonos(sr.id);
  checkEq('sin reparar: el diagnóstico entra como abono en Efectivo', abSr.map((a) => [Number(a.valor), a.metodo]), [[15000, 'Efectivo']]);
  const c = await cajaDia();
  check('la caja del día ve los tres abonos (sin columnas nuevas)', c.grupos.abonosServicio.total, 105000);
  check('y ningún egreso de servicio', c.grupos.devolucionesServicio?.total ?? 0, 0);
  const sinMig = await reportes.getServiciosRango(S, '2000-01-01', '2100-01-01');
  checkEq('el reporte no trae tabla por técnico', sinMig.por_tecnico, null);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('2. La migración');
{
  const sql = readFileSync(path.join(RAIZ, 'migrations/20261025_servicio_abonos_tecnicos.sql'), 'utf8');
  await db.exec(sql);
  await db.exec(sql);
  checkSi('se aplica dos veces sin error (idempotente)', true);
  const runner = readFileSync(path.join(RAIZ, 'src/config/migrations.js'), 'utf8');
  checkSi('el runner de arranque lee el MISMO archivo', runner.includes('20261025_servicio_abonos_tecnicos.sql'));
  await columnas.detectarColumnas();
  checkEq('la detección enciende las dos banderas', [columnas.hayServicioAbonosV2(), columnas.hayTecnicosServicio()], [true, true]);
  const viejos = await q('SELECT tipo, ciclo, anulado FROM abonos_servicio LIMIT 1');
  checkEq('los abonos viejos quedan como abono, sin ciclo, vigentes', [viejos[0].tipo, viejos[0].ciclo, viejos[0].anulado], ['abono', null, false]);
  await falla('el CHECK de tipo existe', () => q("INSERT INTO abonos_servicio (orden_id, valor, tipo) VALUES (1, 1, 'regalo')"), /check|violates/i);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('3. Abono al RECIBIR (misma transacción que la orden)');
let A; // la orden de Laura: estimado 120.000, deja 100.000 por Nequi al entregar el equipo
{
  A = await nueva({ costo_estimado: 120000, abono_inicial: { valor: 100000, metodo: 'Nequi' } });
  checkEq('la orden nace con lo abonado', [A.estado, Number(A.total_abonado)], ['Recibido', 100000]);
  checkSi('y el abono viaja con ella (para el recibo)', Array.isArray(A.abonos) && A.abonos.length === 1);
  const ab = await abonos(A.id);
  checkEq('el abono queda con etapa Recibido y ciclo 0', ab.map((a) => [Number(a.valor), a.metodo, a.etapa, a.ciclo, a.tipo]),
    [[100000, 'Nequi', 'Recibido', 0, 'abono']]);
  const antes = (await q('SELECT COUNT(*)::int AS n FROM ordenes_servicio'))[0].n;
  await falla('si el abono no se puede escribir, la orden tampoco queda',
    () => repo.create(N, S, ADMIN, { cliente_nombre: 'X', falla_reportada: 'y',
      abono_inicial: { valor: 1000, metodo: 'M'.repeat(40) } }), /value too long|demasiado/i);
  checkEq('  …no quedó orden huérfana', (await q('SELECT COUNT(*)::int AS n FROM ordenes_servicio'))[0].n, antes);
  await falla('un abono inicial negativo se rechaza', () => nueva({ abono_inicial: { valor: -5 } }), /no es válido/);
  const r = await svc.getResumenHoy(S, N);
  checkSi('«Ingresos hoy» incluye el abono al recibir', Number(r.ingresos_hoy) >= 100000);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('4. Sin precio no hay tope; el doble clic se rechaza');
{
  await svc.enReparacion(N, A.id);
  const r = await abonar(A.id, 50000);
  checkEq('en reparación se abona sin precio: avisa que pasó el estimado', [Number(r.total_abonado), r.supera_estimado], [150000, true]);
  await falla('el mismo abono otra vez en 90 s es un doble clic', () => abonar(A.id, 50000), /ABONO_DUPLICADO/);
  checkEq('y no se sumó', Number((await orden(A.id)).total_abonado), 150000);
  checkEq('la etapa del segundo abono es En_reparacion', (await abonos(A.id)).map((a) => a.etapa), ['Recibido', 'En_reparacion']);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('5. El precio queda por debajo de lo abonado');
{
  const err = await falla('marcar listo en 120.000 con 150.000 abonados pide la devolución',
    () => svc.marcarListo(N, A.id, { precio_final: 120000, costo_real: 50000, usuario_id: ADMIN }), /ABONADO_MAYOR_A_PRECIO/);
  checkEq('  …con las cifras para la pantalla', err?.detalle, { abonado: 150000, precio: 120000, devolver: 30000 });
  checkEq('  …y la orden NO cambió', (await orden(A.id)).estado, 'En_reparacion');
  const l = await svc.marcarListo(N, A.id, { precio_final: 120000, costo_real: 50000, usuario_id: ADMIN,
    devolucion: { metodo: 'Efectivo' } });
  checkEq('con la devolución confirmada queda Lista y pagada', [l.estado, Number(l.total_abonado)], ['Listo', 120000]);
  const dev = (await abonos(A.id)).filter((a) => a.tipo === 'devolucion');
  checkEq('la devolución quedó escrita (30.000 en Efectivo)', dev.map((a) => [Number(a.valor), a.metodo, a.etapa]),
    [[30000, 'Efectivo', 'En_reparacion']]);
  const o = await repo.findById(N, A.id);
  checkEq('saldo 0 y precio del ciclo 120.000', [Number(o.saldo_pendiente), Number(o.precio_ciclo)], [0, 120000]);
  await falla('ya pagada, no admite más abonos', () => abonar(A.id, 1000), /ya está pagada/);

  // Precio MAYOR: no hay nada que devolver y el tope vuelve a ser el saldo.
  const B = await nueva({ cliente_nombre: 'Pedro', abono_inicial: { valor: 50000, metodo: 'Efectivo' } });
  const lb = await svc.marcarListo(N, B.id, { precio_final: 200000, usuario_id: ADMIN });
  checkEq('precio mayor que lo abonado: lista sin devolución', [lb.estado, Number(lb.total_abonado)], ['Listo', 50000]);
  await falla('con precio, el tope es el saldo (150.000)', () => abonar(B.id, 160000), /150\.000/);
  await abonar(B.id, 150000, 'Nequi');
  const eb = await svc.entregar(N, B.id);
  checkEq('pagada completa, se entrega', eb.estado, 'Entregado');
  globalThis.__B = B.id;
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('6. Caja, tesorería y la factura al entregar');
{
  const e = await svc.entregar(N, A.id);
  checkEq('A se entrega sin saldo', e.estado, 'Entregado');
  const fa = (await orden(A.id)).factura_id;
  const pagos = await q('SELECT metodo, valor::int AS v FROM pagos_factura WHERE factura_id = $1 ORDER BY metodo', [fa]);
  checkEq('la factura: Nequi 100.000 + Efectivo 50.000 − devolución 30.000', pagos.map((p) => [p.metodo, p.v]),
    [['Efectivo', 20000], ['Nequi', 100000]]);
  const linea = await q('SELECT precio::int AS p FROM lineas_factura WHERE factura_id = $1', [fa]);
  checkEq('y su línea por el precio final', linea.map((l) => l.p), [120000]);
  const sumaPagos = pagos.reduce((s, p) => s + p.v, 0);
  check('los pagos suman el precio (no lo que pasó por la mano)', sumaPagos, 120000);

  const c = await cajaDia();
  // 105.000 de la sección 1 + A (100.000 + 50.000) + B (50.000 + 150.000)
  check('caja: abonos de servicio', c.grupos.abonosServicio.total, 455000);
  check('caja: devoluciones de servicio (egreso)', c.grupos.devolucionesServicio.total, 30000);
  checkSi('  la devolución no está entre los ingresos', !c.grupos.abonosServicio.items.some((i) => i.tipo === 'devolucion'));
  check('caja por método: Efectivo sale 30.000', c.metodosPagoDetalle.Efectivo.egresos, 30000);
  // Efectivo que entró de servicio: 50+15 (secc. 1) + 50 (A) + 50 (B) = 165.000
  check('caja por método: Efectivo entra 165.000', c.metodosPagoDetalle.Efectivo.ingresos, 165000);
  check('tesorería Efectivo: 165.000 − 30.000', await deltaTeso(1, 'Efectivo', true), 135000);
  // Nequi: 40.000 (secc. 1) + 100.000 (A) + 150.000 (B)
  check('tesorería Nequi: 290.000', await deltaTeso(2, 'Nequi', false), 290000);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('7. Sin reparar con anticipo');
{
  const C = await nueva({ cliente_nombre: 'Camila', abono_inicial: { valor: 80000, metodo: 'Efectivo' } });
  await svc.sinReparar(N, C.id, { motivo: 'No fue posible reparar', precio_diagnostico: 20000,
    metodo: 'Efectivo', usuario_id: ADMIN });
  const oc = await orden(C.id);
  checkEq('abonó 80.000, diagnóstico 20.000: queda en 20.000 cobrados', [oc.estado, Number(oc.total_abonado), Number(oc.precio_final)],
    ['Sin_reparar', 20000, 20000]);
  checkEq('se le devuelven 60.000', (await abonos(C.id)).map((a) => [a.tipo, Number(a.valor)]), [['abono', 80000], ['devolucion', 60000]]);

  const D = await nueva({ cliente_nombre: 'Diego', abono_inicial: { valor: 10000, metodo: 'Efectivo' } });
  await svc.sinReparar(N, D.id, { motivo: 'Cliente no aceptó el precio', precio_diagnostico: 25000,
    metodo: 'Nequi', usuario_id: ADMIN });
  checkEq('abonó 10.000, diagnóstico 25.000: se cobran 15.000 por el método elegido',
    (await abonos(D.id)).map((a) => [a.tipo, Number(a.valor), a.metodo]), [['abono', 10000, 'Efectivo'], ['abono', 15000, 'Nequi']]);

  const E = await nueva({ cliente_nombre: 'Elena', abono_inicial: { valor: 30000, metodo: 'Nequi' } });
  await svc.sinReparar(N, E.id, { motivo: 'Otro', precio_diagnostico: null, metodo: 'Nequi', usuario_id: ADMIN });
  checkEq('sin diagnóstico se devuelve TODO lo abonado', [(await abonos(E.id)).map((a) => [a.tipo, Number(a.valor)]),
    Number((await orden(E.id)).total_abonado)], [[['abono', 30000], ['devolucion', 30000]], 0]);
  globalThis.__CDE = [C.id, D.id, E.id];
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('8. Anular un abono');
{
  const F = await nueva({ cliente_nombre: 'Fabio', abono_inicial: { valor: 40000, metodo: 'Efectivo' } });
  const abF = (await abonos(F.id))[0];
  await falla('el motivo es obligatorio', () => svc.anularAbono(N, F.id, abF.id, { motivo: ' ', usuarioId: ADMIN }), /motivo/);
  const r = await svc.anularAbono(N, F.id, abF.id, { motivo: 'Se registró a la orden equivocada', usuarioId: ADMIN });
  checkEq('anulado: lo abonado vuelve a 0', Number(r.orden.total_abonado), 0);
  const fila = (await abonos(F.id))[0];
  checkEq('la fila NO se borra: queda anulada con motivo y quién', [fila.anulado, fila.anulado_motivo, fila.anulado_por],
    [true, 'Se registró a la orden equivocada', ADMIN]);
  await falla('anularlo otra vez', () => svc.anularAbono(N, F.id, abF.id, { motivo: 'otra vez', usuarioId: ADMIN }), /YA_ANULADO/);
  const c = await cajaDia();
  checkSi('la caja lo trae tachado (activo = false) y no lo suma',
    c.grupos.abonosServicio.items.some((i) => Number(i.id) === abF.id && i.activo === false));
  const [C] = globalThis.__CDE;
  const devC = (await abonos(C)).find((a) => a.tipo === 'devolucion');
  await falla('una orden cerrada no deja anular', () => svc.anularAbono(N, C, devC.id, { motivo: 'prueba', usuarioId: ADMIN }), /ORDEN_CERRADA/);
  const G = await nueva({ cliente_nombre: 'Gina' });
  await q("INSERT INTO abonos_servicio (orden_id, valor, metodo) VALUES ($1, 5000, 'Efectivo')", [G.id]);
  await q('UPDATE ordenes_servicio SET total_abonado = 5000 WHERE id = $1', [G.id]);
  const viejo = (await abonos(G.id))[0];
  await falla('un abono de antes de la migración (sin ciclo) no se anula',
    () => svc.anularAbono(N, G.id, viejo.id, { motivo: 'prueba', usuarioId: ADMIN }), /ABONO_OTRO_CICLO/);
  await falla('el abono de otra orden no se alcanza', () => svc.anularAbono(N, G.id, abF.id, { motivo: 'prueba', usuarioId: ADMIN }), /no encontrado/);
  await falla('ni desde otro negocio', () => svc.anularAbono(2, F.id, abF.id, { motivo: 'prueba', usuarioId: 9 }), /no encontrada/);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('9. Garantía: el saldo es el de la GARANTÍA');
{
  const B = globalThis.__B;
  const g = await svc.abrirGarantia(N, B, { cobrable: true });
  checkEq('abrir una garantía cobrable: ciclo 1 y abonado en 0', [g.estado, g.ciclo, Number(g.total_abonado)], ['Garantia', 1, 0]);
  const r = await abonar(B, 30000);
  checkEq('sin precio de garantía todavía, se abona sin tope', Number(r.total_abonado), 30000);
  const ab = (await abonos(B)).at(-1);
  checkEq('  …y queda en el ciclo 1', [ab.ciclo, ab.etapa], [1, 'Garantia']);
  const viejo = (await abonos(B))[0];
  await falla('un abono de la reparación (ciclo 0) ya no se anula', () => svc.anularAbono(N, B, viejo.id, { motivo: 'prueba', usuarioId: ADMIN }), /ABONO_OTRO_CICLO/);
  await svc.marcarListo(N, B, { es_garantia: true, precio_garantia: 50000, costo_garantia: 20000, usuario_id: ADMIN });
  const o = await repo.findById(N, B);
  // ANTES: ya en «Listo», el saldo se medía contra el precio de la reparación
  // original (200.000): le cobraba 170.000 a una garantía de 50.000.
  checkEq('lista: el saldo es contra la garantía (50.000 − 30.000)', [o.estado, Number(o.precio_ciclo), Number(o.saldo_pendiente)], ['Listo', 50000, 20000]);
  await falla('el tope del abono también', () => abonar(B, 25000), /20\.000/);
  const e = await svc.entregar(N, B);
  checkEq('entregar: Pendiente de pago por 20.000 (no por 170.000)', [e.estado, Number(e.saldo_al_entregar)], ['Pendiente_pago', 20000]);
  const facAntes = (await orden(B)).factura_id;
  await abonar(B, 20000);
  checkEq('pagada la garantía, se entrega; la factura es la de la reparación', [(await orden(B)).estado, (await orden(B)).factura_id], ['Entregado', facAntes]);

  // Garantía GRATIS
  const g2 = await svc.abrirGarantia(N, B, { cobrable: false });
  checkEq('garantía gratis: ciclo 2', g2.ciclo, 2);
  await falla('no admite abonos', () => abonar(B, 1000), /GARANTIA_SIN_COSTO/);
  await svc.marcarListo(N, B, { es_garantia_gratis: true, usuario_id: ADMIN });
  const og = await repo.findById(N, B);
  checkEq('lista: precio del ciclo 0 y saldo 0', [Number(og.precio_ciclo), Number(og.saldo_pendiente)], [0, 0]);
  const eg = await svc.entregar(N, B);
  checkEq('se entrega sin cobrar nada', eg.estado, 'Entregado');
  const sinCero = await q('SELECT COUNT(*)::int AS n FROM lineas_factura WHERE precio = 0');
  checkEq('y no se crea ninguna factura de $0', sinCero[0].n, 0);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('10. Técnicos internos');
let JUAN; let ANA;
{
  checkEq('apagado: la lista dice que no está activa', (await svc.getTecnicos(N, { sucursalId: S })).activa, false);
  const H = await nueva({ cliente_nombre: 'Hugo', tecnico_id: 999 });
  checkEq('apagado: el tecnico_id de la petición se ignora', (await orden(H.id)).tecnico_id, null);
  await svc.enReparacion(N, H.id);
  const lh = await svc.marcarListo(N, H.id, { precio_final: 10000, usuario_id: ADMIN });
  checkEq('apagado: marcar listo NO pide técnico', lh.estado, 'Listo');

  await falla('encenderlo valida el valor', () => configSvc.saveConfig(N, { servicios_tecnicos_activo: 'si' }), /encendida \(1\)/);
  await configSvc.saveConfig(N, { servicios_tecnicos_activo: '1' });
  checkSi('encendido', await tecnicos.activos(N));
  JUAN = await svc.crearTecnico(N, { nombre: 'Juan Pérez', sucursal_id: S });
  ANA = await svc.crearTecnico(N, { nombre: 'Ana  Gómez', sucursal_id: null, usuario_id: 2 });
  checkEq('el nombre se limpia', ANA.nombre, 'Ana Gómez');
  await falla('dos activos con el mismo nombre', () => svc.crearTecnico(N, { nombre: 'juan pérez' }), /TECNICO_DUPLICADO/);
  await falla('una sede de otro negocio', () => svc.crearTecnico(N, { nombre: 'X', sucursal_id: 3 }), /no es de tu negocio/);
  const NORTE = await svc.crearTecnico(N, { nombre: 'Solo Norte', sucursal_id: 2 });
  const lista = await svc.getTecnicos(N, { sucursalId: S });
  checkEq('la sede Centro ve a Juan y Ana (el de Norte no)', lista.tecnicos.map((t) => t.nombre).sort(), ['Ana Gómez', 'Juan Pérez']);

  const I = await nueva({ cliente_nombre: 'Iván', tecnico_id: JUAN.id });
  checkEq('se asigna al crear la orden', (await orden(I.id)).tecnico_id, JUAN.id);
  await falla('uno de otra sede no', () => nueva({ tecnico_id: NORTE.id }), /TECNICO_OTRA_SEDE/);
  const K = await nueva({ cliente_nombre: 'Karen' });
  await svc.enReparacion(N, K.id, { tecnico_id: ANA.id });
  checkEq('o al pasarla a reparación', (await orden(K.id)).tecnico_id, ANA.id);
  const L = await nueva({ cliente_nombre: 'Luis' });
  await falla('marcar lista sin decir quién la reparó', () => svc.marcarListo(N, L.id, { precio_final: 30000, usuario_id: ADMIN }), /TECNICO_REQUERIDO/);
  const ll = await svc.marcarListo(N, L.id, { precio_final: 30000, costo_real: 10000, tecnico_id: JUAN.id, usuario_id: ADMIN });
  checkEq('con el técnico, lista', [ll.estado, ll.tecnico_id], ['Listo', JUAN.id]);
  const lk = await svc.marcarListo(N, K.id, { precio_final: 60000, costo_real: 25000, usuario_id: ADMIN });
  checkEq('si ya lo tenía asignado, no hay que repetirlo', lk.tecnico_id, ANA.id);
  await svc.asignarTecnico(N, K.id, JUAN.id);
  checkEq('se puede cambiar después', (await orden(K.id)).tecnico_id, JUAN.id);
  await svc.asignarTecnico(N, K.id, ANA.id);
  await svc.actualizarTecnico(N, NORTE.id, { activo: false });
  await falla('uno desactivado no se asigna', () => svc.asignarTecnico(N, K.id, NORTE.id), /TECNICO_INACTIVO/);
  await falla('ni el de otro negocio', () => svc.asignarTecnico(N, K.id, 12345), /TECNICO_INVALIDO/);
  await falla('ni a una orden de otro negocio', () => svc.asignarTecnico(2, K.id, JUAN.id), /404|no está encendida|no encontrada/);

  const deJuan = await svc.getOrdenes(S, N, { tecnico: String(JUAN.id) });
  checkEq('filtro: las de Juan', deJuan.map((o) => o.cliente_nombre).sort(), ['Iván', 'Luis']);
  const sinTec = await svc.getOrdenes(S, N, { tecnico: 'sin' });
  checkSi('filtro: «sin asignar» no trae ninguna de Juan ni de Ana', sinTec.every((o) => !o.tecnico_id));
  const raro = await svc.getOrdenes(S, N, { tecnico: 'abc' });
  checkEq('un filtro que no se entiende no recorta', raro.length, (await svc.getOrdenes(S, N, {})).length);
  checkEq('la lista trae el nombre del técnico', deJuan.map((o) => o.tecnico_nombre), ['Juan Pérez', 'Juan Pérez']);
  for (const id of [I.id]) {
    await svc.enReparacion(N, id);
    await svc.marcarListo(N, id, { precio_final: 80000, costo_real: 30000, usuario_id: ADMIN });
  }
  for (const id of [I.id, K.id, L.id]) {
    const o = await orden(id);
    await abonar(id, Number(o.precio_final) - Number(o.total_abonado));
    await svc.entregar(N, id);
  }
  // Una garantía gratis de Ana = un reproceso suyo.
  await svc.abrirGarantia(N, K.id, { cobrable: false });
  await svc.marcarListo(N, K.id, { es_garantia_gratis: true, usuario_id: ADMIN });
  await svc.entregar(N, K.id);
  globalThis.__IKL = [I.id, K.id, L.id];
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('11. El técnico externo responde solo');
{
  await db.exec(`
    CREATE TABLE IF NOT EXISTS tecnicos (id SERIAL PRIMARY KEY, negocio_id INT, nombre TEXT);
    CREATE TABLE IF NOT EXISTS equipos_tecnico (id SERIAL PRIMARY KEY, negocio_id INT, tecnico_id INT,
      orden_servicio_id INT, estado TEXT, fecha_regreso TIMESTAMP);
    INSERT INTO tecnicos (id, negocio_id, nombre) VALUES (1, 1, 'TecniCell');
  `);
  const M = await nueva({ cliente_nombre: 'Mario' });
  await db.query(`INSERT INTO equipos_tecnico (negocio_id, tecnico_id, orden_servicio_id, estado, fecha_regreso)
    VALUES (1, 1, $1, 'Reparado', NOW())`, [M.id]);
  columnas._setTecnicosDisponible(true);
  try {
    const lm = await svc.marcarListo(N, M.id, { precio_final: 70000, costo_real: 45000, usuario_id: ADMIN });
    checkEq('reparado afuera: se marca lista sin técnico interno', lm.estado, 'Listo');
    const o = await repo.findById(N, M.id);
    checkEq('y la orden dice quién la reparó', o.tecnico_externo, 'TecniCell');
    await abonar(M.id, 70000);
    await svc.entregar(N, M.id);
    const rep = await reportes.getServiciosRango(S, '2000-01-01', '2100-01-01');
    const ext = rep.por_tecnico.find((f) => f.externo);
    checkEq('en el reporte va en su propia fila de externos', [ext?.nombre, ext?.entregadas], ['TecniCell', 1]);
  } finally {
    columnas._setTecnicosDisponible(false);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('12. Reporte «Por técnico»');
{
  columnas._setTecnicosDisponible(true);
  const rep = await reportes.getServiciosRango(S, '2000-01-01', '2100-01-01');
  columnas._setTecnicosDisponible(false);
  const fila = (n) => rep.por_tecnico.find((f) => f.nombre === n);
  const juan = fila('Juan Pérez');
  const ana = fila('Ana Gómez');
  checkEq('Juan: 2 entregadas (Iván 80.000 y Luis 30.000)', [juan.entregadas, juan.ingresos], [2, 110000]);
  checkEq('  utilidad 50.000 + 20.000', juan.utilidad, 70000);
  checkEq('Ana: 1 entregada y 1 reproceso (la garantía gratis)', [ana.entregadas, ana.reprocesos], [1, 1]);
  checkEq('  la orden cuenta UNA vez con lo que cobró', ana.ingresos, 60000);
  const total = rep.por_tecnico.reduce((s, f) => s + f.entregadas + f.sin_reparar, 0);
  checkEq('Σ por técnico = las órdenes cerradas del reporte', total, rep.cerrados.length);
  check('Σ cobrado por técnico = total_ingresos del reporte',
    rep.por_tecnico.reduce((s, f) => s + f.ingresos, 0), rep.resumen.total_ingresos);
  checkSi('«Sin técnico asignado» va al final', rep.por_tecnico.at(-1).clave === 'sin');
  const pura = reportes.porTecnicoServicio([
    { tecnico_id: 7, tecnico_nombre: 'Z', categoria: 'pagado', ingresos: 100, costo: 40, utilidad: 60, dias_reparacion: 2 },
    { tecnico_id: 7, tecnico_nombre: 'Z', categoria: 'pagado', ingresos: 50, costo: 0, utilidad: null, dias_reparacion: 4 },
    { tecnico_id: 7, tecnico_nombre: 'Z', categoria: 'pagado', es_garantia_gratis: true, ingresos: 10, costo: 4, utilidad: 6 },
  ], [{ tecnico_id: 7, tecnico_nombre: 'Z', cantidad: 3 }]);
  checkEq('pura: sin costo no suma utilidad, días promedio, en curso, reproceso', [pura[0].entregadas, pura[0].utilidad, pura[0].sin_costo, pura[0].dias_promedio, pura[0].en_curso, pura[0].reprocesos],
    [3, 66, 1, 3, 3, 1]);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('13. Los PDF');
{
  const aBuffer = (fn) => new Promise((resolve, reject) => {
    const res = new PassThrough();
    res.setHeader = () => {};
    const partes = [];
    res.on('data', (d) => partes.push(d));
    res.on('end', () => resolve(Buffer.concat(partes)));
    res.on('error', reject);
    fn(res);
  });
  const o = await repo.findById(N, A.id);
  const ab = await repo.getAbonos(N, A.id);
  const rec = await aBuffer((res) => pdf.generarPdfRecepcion({ orden: o, abonos: ab, config: { nombre_negocio: 'Prueba' }, res }));
  checkSi('el recibo de recepción sale con los abonos', rec.slice(0, 4).toString() === '%PDF');
  const com = await aBuffer((res) => pdf.generarPdfServicio({ orden: o, abonos: ab, config: { nombre_negocio: 'Prueba' }, res }));
  checkSi('el comprobante sale con la devolución', com.slice(0, 4).toString() === '%PDF');
  const B = await repo.findById(N, globalThis.__B);
  const vig = pdf.pagosVigentes(B, await repo.getAbonos(N, globalThis.__B));
  checkSi('el comprobante de una garantía solo lista los pagos de SU ciclo', vig.every((a) => a.ciclo === null || Number(a.ciclo) === Number(B.ciclo)));
  const src = readFileSync(path.join(RAIZ, 'src/modules/servicios/servicios.pdf.js'), 'utf8');
  checkSi('ningún carácter fuera de WinAnsi en lo que se imprime (sin −)', !src.includes('−'));
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('14. El frontend promete lo mismo que el backend');
{
  const front = await import(pathToFileURL(path.join(FRONT, 'utils/servicioCobro.js')).href);
  const B_ORDEN = await repo.findById(N, globalThis.__B);
  const B_ABONOS = await repo.getAbonos(N, globalThis.__B);
  const casos = [
    { estado: 'Recibido', precio_final: null, precio_garantia: null, garantia_cobrable: false, total_abonado: 50 },
    { estado: 'Listo', precio_final: '120000.00', precio_garantia: null, garantia_cobrable: false, total_abonado: 0 },
    { estado: 'Garantia', precio_final: '200000.00', precio_garantia: null, garantia_cobrable: true, total_abonado: 0 },
    { estado: 'Listo', precio_final: '200000.00', precio_garantia: '50000.00', garantia_cobrable: true, total_abonado: 30000 },
    { estado: 'Garantia', precio_final: '200000.00', precio_garantia: null, garantia_cobrable: false, total_abonado: 200000 },
    { estado: 'Listo', precio_final: '200000.00', precio_garantia: '0.00', garantia_cobrable: false, total_abonado: 200000 },
  ];
  checkEq('precioCiclo: navegador == backend en todos los casos',
    casos.map((c) => front.precioCiclo(c)), casos.map((c) => repo.precioCiclo(c)));
  const filas = await q(`SELECT ${repo.SQL_PRECIO_CICLO('o')} AS p FROM (VALUES
    ('Recibido', NULL::numeric, NULL::numeric, false), ('Listo', 120000, NULL, false), ('Garantia', 200000, NULL, true),
    ('Listo', 200000, 50000, true), ('Garantia', 200000, NULL, false), ('Listo', 200000, 0, false)
  ) AS o(estado, precio_final, precio_garantia, garantia_cobrable)`);
  checkEq('…y == el SQL', filas.map((f) => (f.p === null ? null : Number(f.p))), casos.map((c) => repo.precioCiclo(c)));
  checkEq('devolver al fijar precio', [front.devolucionAlFijarPrecio(150000, 120000), front.devolucionAlFijarPrecio(50000, 200000)], [30000, 0]);
  checkEq('sin reparar: devolver / cobrar (la misma cuenta de la sección 7)',
    [front.cuentaSinReparar({ estado: 'Recibido', total_abonado: 80000 }, 20000).devolver,
      front.cuentaSinReparar({ estado: 'Recibido', total_abonado: 10000 }, 25000).cobrar,
      front.cuentaSinReparar({ estado: 'Garantia', garantia_cobrable: false, total_abonado: 90000 }, 0).devolver],
    [60000, 15000, 0]);
  const A_ORDEN = await repo.findById(N, A.id);
  const A_ABONOS = await repo.getAbonos(N, A.id);
  checkSi('  (hay pagos que comparar)', A_ABONOS.length >= 3 && B_ABONOS.length >= 3);
  for (const [o, abs] of [[A_ORDEN, A_ABONOS], [B_ORDEN, B_ABONOS]]) {
    checkEq(`pagosVigentes #${o.id}: navegador == PDF`, front.pagosVigentes(o, abs).map((x) => x.id),
      pdf.pagosVigentes(o, abs).map((x) => x.id));
  }
  checkSi('puedeAbonar: sí al recibir, no en garantía gratis, no pagada',
    front.puedeAbonar({ estado: 'Recibido', total_abonado: 0 })
    && !front.puedeAbonar({ estado: 'Garantia', garantia_cobrable: false })
    && !front.puedeAbonar({ estado: 'Listo', precio_final: 100, total_abonado: 100 }));
  const pag = readFileSync(path.join(FRONT, 'pages/servicios/ServiciosPage.jsx'), 'utf8');
  checkSi('la pantalla ofrece el abono al recibir, en reparación y listo',
    pag.includes("['Recibido', 'En_reparacion', 'Listo'].includes(estado) && puedeAbonar(orden)"));
  checkSi('crear la orden manda el abono en la MISMA petición', /abono_inicial:\s+Number\(form\.abono_valor\)/.test(pag));
  checkSi('marcar listo manda la devolución cuando sobra', pag.includes("devolucion: { metodo: metodoDev }"));
  const rutas = readFileSync(path.join(RAIZ, 'src/modules/servicios/servicios.routes.js'), 'utf8');
  checkSi('anular un abono exige admin', /abonos\/:abonoId\/anular',\s*requireModulo\('servicios'\),\s*requireNivel\('admin_negocio'\)/.test(rutas));
  checkSi('las rutas de técnicos van ANTES de /:id', rutas.indexOf("'/tecnicos'") < rutas.indexOf("router.get('/:id'"));
  const cajaFront = readFileSync(path.join(FRONT, 'pages/caja/CajaPage.jsx'), 'utf8');
  checkSi('la caja pinta las devoluciones de servicio entre los egresos', cajaFront.includes("'devoluciones', 'devolucionesServicio'"));
}

console.log(`\n${ok} verificaciones correctas, ${fallos.length} fallidas`);
if (fallos.length) { console.log('\nFALLAS:'); fallos.forEach((f) => console.log(' ·', f)); process.exit(1); }
