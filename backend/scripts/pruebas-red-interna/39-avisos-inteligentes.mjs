// ─────────────────────────────────────────────────────────────────────────────
// AVISOS INTELIGENTES — prioridad, resumen y las cuatro alertas nuevas
//
// Contra Postgres real. Lo que esta prueba sostiene, en orden de importancia:
//
//   1. QUE UN NEGOCIO AL DÍA NO RECIBA NADA. Es la sección 1 y es la que hay que
//      mirar primero. Un aviso diario que dice "no tienes nada pendiente"
//      entrena a la gente a ignorarlo, y entonces el día que sí trae algo
//      tampoco lo abre. Sin señales no hay resumen: `resumenDiario` da null.
//
//   2. QUE LO URGENTE NO SE DILUYA. La caja abierta y la garantía que vence HOY
//      salen aparte; el stock bajo y los pedidos atrasados van al resumen. Si
//      esto se invierte, volvemos a las seis notificaciones seguidas de las 8:00
//      que hicieron que el usuario pidiera este trabajo.
//
//   3. QUE LA PRIORIDAD DEPENDA DE LA SITUACIÓN, NO DEL TIPO. La MISMA garantía
//      es normal a diez días y urgente el día que vence. Un motor con una tabla
//      fija de "tipos importantes" no puede hacer eso.
//
//   4. Que las cuatro alertas nuevas midan lo que dicen medir, incluidas sus
//      exclusiones: un equipo ya vendido no genera aviso de garantía, y una
//      orden ya recibida no aparece como atrasada.
//
//   node scripts/pruebas-red-interna/39-avisos-inteligentes.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');

let fallos = 0, pasados = 0;
const check = (etiqueta, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (ok) { pasados++; console.log(`  ✓ ${etiqueta}`); }
  else    { fallos++;  console.log(`  ✗ ${etiqueta} — dio ${JSON.stringify(real)}, esperaba ${JSON.stringify(esperado)}`); }
};
const seccion = (t) => console.log(`\n═══ ${t} ═══`);

const db = new PGlite();
await db.exec(readFileSync(path.join(AQUI, 'esquema.sql'), 'utf8'));
await db.exec(readFileSync(path.join(AQUI, 'esquema-completo.sql'), 'utf8'));

await db.exec(`
  ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS negocio_id INT;
  ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS nit TEXT;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS proveedor_id INT;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS usuario_id INT;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS estado TEXT DEFAULT 'Activa';
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS notas TEXT;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS numero_factura TEXT;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS registrar_en_caja BOOLEAN DEFAULT TRUE;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS factura_confirmada BOOLEAN DEFAULT TRUE;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS es_entrada BOOLEAN DEFAULT FALSE;

  CREATE TABLE IF NOT EXISTS acreedores (
    id SERIAL PRIMARY KEY, negocio_id INT, nombre TEXT, cedula TEXT,
    telefono TEXT, proveedor_id INT
  );
  CREATE TABLE IF NOT EXISTS movimientos_acreedor (
    id SERIAL PRIMARY KEY, acreedor_id INT, usuario_id INT, tipo TEXT,
    valor NUMERIC DEFAULT 0, descripcion TEXT, fecha TIMESTAMP DEFAULT NOW(),
    compra_id INT, cargo_id INT, registrar_en_caja BOOLEAN DEFAULT TRUE,
    metodo TEXT, sucursal_id INT
  );
  CREATE TABLE IF NOT EXISTS lineas_compra (
    id SERIAL PRIMARY KEY, compra_id INT, nombre_producto TEXT, imei TEXT,
    cantidad INT, precio_unitario NUMERIC, variante_id INT, atributo_id INT,
    producto_id INT, cantidad_devuelta INT DEFAULT 0
  );
  -- aperturas_caja YA existe en el fixture, pero sin las columnas que la caja
  -- real si tiene (caja.repository une por usuario_id). Es el caso de siempre:
  -- ante la duda, créele a la migración y no al fixture.
  ALTER TABLE aperturas_caja ADD COLUMN IF NOT EXISTS usuario_id INT;
  ALTER TABLE aperturas_caja ADD COLUMN IF NOT EXISTS monto_apertura NUMERIC DEFAULT 0;
  ALTER TABLE aperturas_caja ADD COLUMN IF NOT EXISTS monto_cierre NUMERIC;
  CREATE TABLE IF NOT EXISTS push_suscripciones (
    id SERIAL PRIMARY KEY, usuario_id INT, negocio_id INT, sucursal_id INT,
    endpoint TEXT, p256dh TEXT, auth TEXT, user_agent TEXT,
    activa BOOLEAN DEFAULT TRUE, creado_en TIMESTAMP DEFAULT NOW(),
    ultimo_ok TIMESTAMP, fallos INT DEFAULT 0
  );
  -- La cartera no es lo que esta suite prueba, pero el motor la consulta: sin
  -- estas columnas se apaga sola y llena la salida de avisos que no son fallos.
  ALTER TABLE prestamos ADD COLUMN IF NOT EXISTS fecha_limite DATE;
  ALTER TABLE creditos  ADD COLUMN IF NOT EXISTS fecha_limite DATE;
  ALTER TABLE negocios ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT TRUE;
  ALTER TABLE negocios ADD COLUMN IF NOT EXISTS estado_plan TEXT DEFAULT 'activo';
  ALTER TABLE negocios ADD COLUMN IF NOT EXISTS plan TEXT;
  ALTER TABLE negocios ADD COLUMN IF NOT EXISTS fecha_vencimiento TIMESTAMP;
`);
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260806_ordenes_compra.sql'), 'utf8'));

const conectar = () => ({ query: (s, p) => db.query(s, p ?? []) });
const pool = { ...conectar(), connect: async () => ({ ...conectar(), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

const ops   = require(path.join(RAIZ, 'src/modules/notificaciones/notificaciones.operaciones.js'));
const motor = require(path.join(RAIZ, 'src/modules/notificaciones/notificaciones.motor.js'));

// ── Datos base ──────────────────────────────────────────────────────────────
await db.exec(`
  INSERT INTO negocios(id, nombre, activo, estado_plan) VALUES (1, 'Test', true, 'activo');
  INSERT INTO sucursales(id, negocio_id, nombre, activa) VALUES (1, 1, 'Principal', true);
  INSERT INTO usuarios(id, nombre) VALUES (1, 'Ana');
  INSERT INTO proveedores(id, negocio_id, nombre, nit, activo) VALUES (1, 1, 'Distri SAS', '900', true);
  INSERT INTO productos_serial(id, sucursal_id, nombre, activo) VALUES (30, 1, 'iPhone', true);
`);

// ═══════════════════════════════════════════════════════════════════════════
seccion('1. Un negocio al día no recibe NADA');
// ═══════════════════════════════════════════════════════════════════════════
// La sección que hay que mirar primero. Un "no tienes nada pendiente" diario es
// la forma más rápida de que dejen de abrir los avisos.

const limpio = await motor.recolectar(1);
check('★★ sin nada pendiente no hay ni una señal', limpio.senales.length, 0);
check('★★ y por lo tanto NO hay resumen que mandar', motor.resumenDiario(limpio.normales), null);

// ═══════════════════════════════════════════════════════════════════════════
seccion('2. Garantías del proveedor por vencer');
// ═══════════════════════════════════════════════════════════════════════════
// El aviso que no existía de ninguna forma: una garantía que se pasa ya no se
// puede reclamar, y nadie va a revisarlas equipo por equipo.

await db.exec(`
  INSERT INTO compras(id, sucursal_id, proveedor_id, usuario_id, total, fecha, estado)
    VALUES (100, 1, 1, 1, 500000, NOW() - INTERVAL '20 days', 'Activa');
  -- Vence en 10 días (20 transcurridos de 30): entra, pero NO es urgente.
  INSERT INTO lineas_compra(compra_id, nombre_producto, imei, cantidad, precio_unitario, garantia_dias)
    VALUES (100, 'iPhone 13', 'IMEI-VIGENTE', 1, 500000, 30);
  INSERT INTO seriales(producto_id, imei, costo_compra, vendido, prestado)
    VALUES (30, 'IMEI-VIGENTE', 500000, false, false);
`);

let g = await ops.garantiasPorVencer(1, 15);
check('la garantía que vence en 10 días aparece', g.total, 1);
check('con sus días restantes bien contados', g.items[0].dias_restantes, 10);
check('★ y NO cuenta como que vence hoy', g.vencen_hoy, 0);

let s = await motor.recolectar(1);
let garantia = s.senales.find((x) => x.clave === 'garantias_por_vencer');
check('★★ a 10 días la garantía es NORMAL: va al resumen', garantia?.prioridad, 'normal');

// La MISMA garantía, el día que vence. La prioridad la decide la situación, no
// el tipo de aviso.
await db.query(`UPDATE compras SET fecha = NOW() - INTERVAL '30 days' WHERE id = 100`);
g = await ops.garantiasPorVencer(1, 15);
check('★ ahora vence hoy', g.vencen_hoy, 1);
s = await motor.recolectar(1);
garantia = s.senales.find((x) => x.clave === 'garantias_por_vencer');
check('★★ y la MISMA garantía pasa a URGENTE', garantia?.prioridad, 'urgente');
check('con un texto que dice por qué no puede esperar',
  garantia?.titulo.includes('HOY'), true);

// Un equipo ya vendido no genera aviso: la garantía que corre es la del cliente
// y reclamarle al proveedor por él es otro trámite.
await db.query(`UPDATE seriales SET vendido = true WHERE imei = 'IMEI-VIGENTE'`);
check('★★ un equipo YA VENDIDO no genera aviso de garantía',
  (await ops.garantiasPorVencer(1, 15)).total, 0);
await db.query(`UPDATE seriales SET vendido = false WHERE imei = 'IMEI-VIGENTE'`);

// ═══════════════════════════════════════════════════════════════════════════
seccion('3. Pedidos que debían haber llegado');
// ═══════════════════════════════════════════════════════════════════════════

await db.exec(`
  INSERT INTO ordenes_compra(id, negocio_id, sucursal_id, proveedor_id, numero, estado, fecha_esperada)
    VALUES (200, 1, 1, 1, 5, 'Emitida', CURRENT_DATE - 7);
  INSERT INTO lineas_orden_compra(id, orden_id, tipo, nombre_producto, cantidad_pedida)
    VALUES (2000, 200, 'cantidad', 'Cargador', 100);
`);
let p = await ops.pedidosAtrasados(1);
check('el pedido atrasado aparece', p.total, 1);
check('con sus días de retraso', p.items[0].dias_atraso, 7);
check('y las unidades que faltan', p.items[0].unidades_pendientes, 100);

// Recibirlo completo lo saca de la lista: el avance se DERIVA, nadie tiene que
// acordarse de marcar la orden.
await db.exec(`
  INSERT INTO compras(id, sucursal_id, proveedor_id, total, fecha, estado, orden_compra_id)
    VALUES (101, 1, 1, 100000, NOW(), 'Activa', 200);
  INSERT INTO lineas_compra(compra_id, nombre_producto, cantidad, precio_unitario, orden_linea_id)
    VALUES (101, 'Cargador', 100, 1000, 2000);
`);
check('★★ recibido completo, deja de estar atrasado', (await ops.pedidosAtrasados(1)).total, 0);

// Y cancelar esa recepción lo REABRE solo, por la misma razón.
await db.query(`UPDATE compras SET estado = 'Cancelada' WHERE id = 101`);
check('★★ cancelar la recepción lo vuelve a poner atrasado',
  (await ops.pedidosAtrasados(1)).total, 1);

// ═══════════════════════════════════════════════════════════════════════════
seccion('4. Entradas sin confirmar');
// ═══════════════════════════════════════════════════════════════════════════
// Mientras no se confirme, esa mercancía se vende con un costo provisional y la
// utilidad reportada miente.

await db.exec(`
  INSERT INTO compras(id, sucursal_id, usuario_id, total, fecha, estado, es_entrada, factura_confirmada)
    VALUES (102, 1, 1, 80000, NOW() - INTERVAL '5 days', 'Activa', true, false);
`);
check('una entrada de hace 5 días con umbral 3 aparece',
  (await ops.entradasSinConfirmar(1, 3)).total, 1);
check('★ pero con umbral 10 todavía no molesta',
  (await ops.entradasSinConfirmar(1, 10)).total, 0);
check('★★ una entrada YA CONFIRMADA nunca aparece',
  await (async () => {
    await db.query(`UPDATE compras SET factura_confirmada = true WHERE id = 102`);
    const r = (await ops.entradasSinConfirmar(1, 3)).total;
    await db.query(`UPDATE compras SET factura_confirmada = false WHERE id = 102`);
    return r;
  })(), 0);

// ═══════════════════════════════════════════════════════════════════════════
seccion('5. Cajas que quedaron abiertas');
// ═══════════════════════════════════════════════════════════════════════════
// El único de los cuatro que NO es un vencimiento: no hay fecha límite, hay una
// caja que lleva demasiado tiempo abierta. Por eso se mide en HORAS.

await db.exec(`
  INSERT INTO aperturas_caja(id, sucursal_id, usuario_id, estado, fecha_apertura)
    VALUES (300, 1, 1, 'Abierta', NOW() - INTERVAL '20 hours');
`);
const c = await ops.cajasSinCerrar(1, 16);
check('la caja de 20 horas aparece', c.total, 1);
check('con las horas bien contadas', c.items[0].horas_abierta, 20);
check('★ una caja de 4 horas es operación normal',
  await (async () => {
    await db.query(`UPDATE aperturas_caja SET fecha_apertura = NOW() - INTERVAL '4 hours' WHERE id = 300`);
    return (await ops.cajasSinCerrar(1, 16)).total;
  })(), 0);
await db.query(`UPDATE aperturas_caja SET fecha_apertura = NOW() - INTERVAL '20 hours' WHERE id = 300`);
check('★★ una caja CERRADA nunca aparece',
  await (async () => {
    await db.query(`UPDATE aperturas_caja SET estado = 'Cerrada' WHERE id = 300`);
    const r = (await ops.cajasSinCerrar(1, 16)).total;
    await db.query(`UPDATE aperturas_caja SET estado = 'Abierta' WHERE id = 300`);
    return r;
  })(), 0);

// ═══════════════════════════════════════════════════════════════════════════
seccion('6. La prioridad: qué suena solo y qué va al resumen');
// ═══════════════════════════════════════════════════════════════════════════

const final = await motor.recolectar(1);
const claves = (lista) => lista.map((x) => x.clave).sort();

check('★★ la caja abierta suena SOLA (urgente)',
  final.urgentes.some((x) => x.clave === 'caja_sin_cerrar'), true);
check('★★ la garantía que vence hoy también',
  final.urgentes.some((x) => x.clave === 'garantias_por_vencer'), true);
check('★★ los pedidos atrasados van al RESUMEN, no suenan solos',
  final.normales.some((x) => x.clave === 'pedidos_atrasados'), true);
check('★★ y las entradas sin confirmar también',
  final.normales.some((x) => x.clave === 'entradas_sin_confirmar'), true);
check('nada queda fuera de las dos listas',
  final.urgentes.length + final.normales.length, final.senales.length);
check('las señales salen sin repetirse',
  new Set(claves(final.senales)).size, final.senales.length);

// El resumen: UNA notificación con lo no urgente.
const resumen = motor.resumenDiario(final.normales);
check('★★ hay UN resumen para todo lo no urgente', Boolean(resumen), true);
check('que lleva al panel de Avisos', resumen.url, '/avisos');
check('y dice cuántas cosas trae', resumen.titulo.includes(String(final.normales.length)), true);

// ═══════════════════════════════════════════════════════════════════════════
seccion('7. Umbrales configurables');
// ═══════════════════════════════════════════════════════════════════════════
// Con el umbral equivocado el aviso o llega tarde o se vuelve ruido diario, y no
// hay un número correcto para todos los negocios.

await db.exec(`
  INSERT INTO config_negocio(negocio_id, clave, valor) VALUES (1, 'notif_caja_horas', '48');
`);
const conUmbral = await motor.recolectar(1);
check('★ el umbral del negocio manda sobre el default',
  conUmbral.umbrales.caja_horas, 48);
check('★★ y con 48 horas la caja de 20 deja de avisar',
  conUmbral.urgentes.some((x) => x.clave === 'caja_sin_cerrar'), false);

await db.query(`UPDATE config_negocio SET valor = '999' WHERE clave = 'notif_caja_horas'`);
check('★ un valor fuera de rango cae al default en vez de romper',
  (await motor.recolectar(1)).umbrales.caja_horas, motor.DEFAULTS.caja_horas);

// ═══════════════════════════════════════════════════════════════════════════
seccion('8. El cron y el panel leen lo MISMO');
// ═══════════════════════════════════════════════════════════════════════════
// Si la pantalla calculara por su cuenta, el usuario abriría el resumen que le
// llegó al celular y encontraría algo distinto a lo que le avisaron.

const cronSrc = readFileSync(path.join(RAIZ, 'src/modules/notificaciones/notificaciones.cron.js'), 'utf8');
const ctrlSrc = readFileSync(path.join(RAIZ, 'src/modules/notificaciones/notificaciones.controller.js'), 'utf8');

check('★★ el cron usa el motor', cronSrc.includes('motor.recolectar'), true);
check('★★ y el panel también', ctrlSrc.includes('motor.recolectar'), true);
check('★ el cron ya no manda un push por cada alerta suelta',
  ['_avisarPorVencer', '_avisarPlan', '_avisarStockBajo', '_avisarPagosProveedor',
    '_avisarBorradoresPorVencer'].some((f) => cronSrc.includes(f)), false);
check('★★ pero SÍ conserva el aviso por cliente, que abre su ficha',
  cronSrc.includes('_avisarCarteraVencida'), true);
check('★ y todo envío sigue deduplicado por día',
  (cronSrc.match(/unico_por_dia: true/g) || []).length >= 3, true);
check('★ hay una segunda pasada, y solo con lo urgente',
  cronSrc.includes('soloUrgentes: true'), true);

// ═══════════════════════════════════════════════════════════════════════════
seccion('9. La sesión sobrevive a cerrar la PWA');
// ═══════════════════════════════════════════════════════════════════════════
// Sin esto, tocar una notificación abre el login y se pierde el enlace que
// traía el aviso — que es justo lo que se venía a ver.

const FRONT = path.resolve(RAIZ, '../frontend/src');
const axiosSrc = readFileSync(path.join(FRONT, 'api/axios.config.js'), 'utf8');
const authSrc  = readFileSync(path.join(FRONT, 'context/AuthContext.jsx'), 'utf8');
const rutaSrc  = readFileSync(path.join(FRONT, 'components/layout/PrivateRoute.jsx'), 'utf8');

check('★★ el refresh ya NO usa una URL relativa (caía en Vercel, no en el backend)',
  axiosSrc.includes("axios.post(\n          '/api/auth/refresh'"), false);
check('★★ ahora sale de la misma base que el resto de la API',
  axiosSrc.includes('${API_BASE}/auth/refresh'), true);
check('★ y un refresh sin token se trata como fallo, no como éxito',
  axiosSrc.includes("throw new Error('refresh sin token')"), true);
check('★★ la app intenta restaurar la sesión al abrir', authSrc.includes('restaurarSesion'), true);
check('★★ y la ruta protegida ESPERA en vez de mandar al login',
  rutaSrc.includes('if (restaurando) return null;'), true);

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(62)}`);
console.log(`  ${pasados} verificaciones pasaron · ${fallos} fallaron`);
console.log('═'.repeat(62));
process.exit(fallos > 0 ? 1 : 0);
