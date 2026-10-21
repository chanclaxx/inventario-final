// ─────────────────────────────────────────────────────────────────────────────
// CENTRO DE GASTOS — Reportes → Gastos (20-oct-2026)
//
// Lo que se gasta en OPERAR (no mercancía), por MES CONTABLE, fijo o variable,
// opt-in por negocio, con permiso por usuario para registrar. Proyección deja
// de leer `gastos_fijos` y lee de aquí; los gastos fijos viejos se convierten
// en recurrentes sin perder ninguno.
//
// La sección 1 es la que hay que mirar primero: apagado, nada cambia y
// Proyección no resta nada. La 2, que la conversión no pierde ni duplica. La
// 11 levanta las rutas REALES por HTTP para los permisos.
//
//   node scripts/pruebas-red-interna/82-centro-gastos.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');
const FRONT = path.resolve(RAIZ, '../frontend/src');
const leer = (...p) => readFileSync(path.join(...p), 'utf8');

let pasados = 0; const fallos = [];
const ok = (nombre, cond, detalle = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos.push(nombre);
};
const eq = (nombre, real, esperado) => ok(nombre, JSON.stringify(real) === JSON.stringify(esperado),
  JSON.stringify(real) === JSON.stringify(esperado) ? '' : `dio ${JSON.stringify(real)}, esperaba ${JSON.stringify(esperado)}`);
const seccion = (t) => console.log(`\n═══ ${t} ═══`);
const lanza = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

// ─── Base en memoria ────────────────────────────────────────────────────────
const db = new PGlite();
await db.exec(`
  CREATE TABLE negocios (id SERIAL PRIMARY KEY, nombre TEXT);
  CREATE TABLE sucursales (id SERIAL PRIMARY KEY, negocio_id INT, nombre TEXT, activa BOOLEAN DEFAULT TRUE);
  CREATE TABLE usuarios (id SERIAL PRIMARY KEY, negocio_id INT, nombre TEXT, rol TEXT, activo BOOLEAN DEFAULT TRUE);
  CREATE TABLE config_negocio (negocio_id INT, clave TEXT, valor TEXT, UNIQUE (negocio_id, clave));
  CREATE TABLE gastos_fijos (id SERIAL PRIMARY KEY, sucursal_id INT NOT NULL, nombre TEXT NOT NULL,
    valor NUMERIC(14,2) NOT NULL, activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMP DEFAULT NOW(), actualizado_en TIMESTAMP DEFAULT NOW());
  CREATE TABLE auditoria (id SERIAL PRIMARY KEY, negocio_id INT, usuario_id INT, accion TEXT, tabla TEXT,
    registro_id INT, detalle JSONB, fecha TIMESTAMP DEFAULT NOW());
  INSERT INTO negocios (nombre) VALUES ('Uno'), ('Dos');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1, 'Centro'), (1, 'Norte'), (2, 'Ajena');
  INSERT INTO usuarios (negocio_id, nombre, rol) VALUES
    (1, 'Dueño', 'admin_negocio'), (1, 'Laura', 'supervisor'), (1, 'Pedro', 'vendedor'), (2, 'Otro', 'admin_negocio');
  INSERT INTO gastos_fijos (sucursal_id, nombre, valor, activo) VALUES
    (1, 'Arriendo local', 2500000, TRUE),
    (1, 'Internet Claro', 120000, TRUE),
    (1, 'Pago contador', 400000, TRUE),
    (1, 'Cosa rara', 50000, TRUE),
    (1, 'Viejo apagado', 999, FALSE),
    (3, 'Arriendo ajeno', 1, TRUE);
`);

const conectar = (t) => ({ query: (s, p) => t.query(s, p ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

const columnas = require(path.join(RAIZ, 'src/config/columnas.js'));
const util     = require(path.join(RAIZ, 'src/modules/gastos/gastos.util.js'));
const servicio = require(path.join(RAIZ, 'src/modules/gastos/gastos.service.js'));
const reportes = require(path.join(RAIZ, 'src/modules/reportes/reportes.service.js'));
const express  = require(path.join(RAIZ, 'node_modules/express'));

const ADMIN = { id: 1, rol: 'admin_negocio', negocio_id: 1, modulos_permitidos: null };
const ctx = (sucursalId = 1, usuarioId = 1, negocioId = 1) => ({ negocioId, sucursalId, usuarioId });

// ─── 1. Apagado ─────────────────────────────────────────────────────────────
seccion('1. Apagado: sin tablas o sin la clave, nada cambia');
columnas._setGastosDisponible(false);
eq('sin tablas: no está activo', await servicio.estaActivo(1), false);
eq('sin tablas: Proyección no resta nada', (await servicio.estimadoMensual(1, '2026-04-01', '2026-09-30')).total, 0);

await db.exec(leer(RAIZ, 'migrations/20261020_gastos.sql'));
await db.exec(leer(RAIZ, 'migrations/20261020_gastos.sql')); // idempotente
await columnas.detectarColumnas();
eq('la migración corre dos veces y se detecta', [columnas.hayGastos(), columnas.hayPermisosGastos()], [true, true]);
eq('con tablas pero sin la clave: apagado', await servicio.estaActivo(1), false);
const est0 = await servicio.estimadoMensual(1, '2026-04-01', '2026-09-30');
eq('★ apagado: Proyección no resta (decisión del usuario)', [est0.activo, est0.total, est0.lista.length], [false, 0, 0]);
eq('apagado no convierte nada todavía', (await db.query('SELECT COUNT(*)::int n FROM gastos_recurrentes')).rows[0].n, 0);
await db.query(`INSERT INTO config_negocio VALUES (1, 'gastos_activo', '1')`);
eq('con la clave en 1: activo', await servicio.estaActivo(1), true);
eq('otro negocio sigue apagado', await servicio.estaActivo(2), false);

// ─── 2. Catálogo y conversión ───────────────────────────────────────────────
seccion('2. Categorías por defecto y conversión de los gastos fijos de Proyección');
await servicio.asegurarCatalogo(1);
servicio._olvidarCatalogo(1);
await servicio.asegurarCatalogo(1);
const cats = (await db.query('SELECT id, nombre, tipo FROM categorias_gasto WHERE negocio_id = 1 ORDER BY orden')).rows;
eq('14 categorías, una sola vez', cats.length, util.CATEGORIAS_DEFECTO.length);
const catId = (n) => cats.find((c) => c.nombre === n).id;
const recs = (await db.query(`SELECT nombre, valor::float v, tipo, categoria_id, sucursal_id, origen_gasto_fijo_id
  FROM gastos_recurrentes ORDER BY origen_gasto_fijo_id`)).rows;
eq('★ se convierten los 4 activos de la sede (ni el apagado ni el de otro negocio)', recs.map((r) => r.nombre),
  ['Arriendo local', 'Internet Claro', 'Pago contador', 'Cosa rara']);
eq('★ con su valor, como FIJOS', recs.map((r) => [r.v, r.tipo]),
  [[2500000, 'fijo'], [120000, 'fijo'], [400000, 'fijo'], [50000, 'fijo']]);
eq('cada uno en su categoría por el nombre', recs.map((r) => r.categoria_id),
  [catId('Arriendo'), catId('Internet y telefonía'), catId('Contador y honorarios'), catId('Otros')]);
servicio._olvidarCatalogo(1);
await servicio.asegurarCatalogo(1);
eq('★ convertir otra vez no duplica', (await db.query('SELECT COUNT(*)::int n FROM gastos_recurrentes')).rows[0].n, 4);
eq('la tabla vieja no se toca', (await db.query('SELECT COUNT(*)::int n FROM gastos_fijos')).rows[0].n, 6);
eq('pistas: «Pago de nómina» → Nómina', util.categoriaPorNombre('Pago de nómina'), 'Nómina y prestaciones');
eq('pistas: «Luz y agua» → Servicios', util.categoriaPorNombre('Luz y agua'), 'Servicios públicos');
eq('pistas: «Música ambiental» NO es impuesto', util.categoriaPorNombre('Música ambiental'), 'Otros');

// ─── 3. El valor de un gasto ────────────────────────────────────────────────
seccion('3. Total: subtotal + IVA − retenciones, o el total escrito');
eq('solo el total', util.calcularValores({ valor_total: 50000 }).valor_total, 50000);
eq('★ subtotal + IVA − retenciones', util.calcularValores({ subtotal: 100000, iva: 19000, retenciones: 2500 }).valor_total, 116500);
eq('cantidad × unitario arma el subtotal', util.calcularValores({ cantidad: 3, valor_unitario: 2500, iva: 0 }), {
  cantidad: 3, valor_unitario: 2500, subtotal: 7500, iva: 0, retenciones: null, valor_total: 7500 });
eq('con subtotal, el total escrito se ignora', util.calcularValores({ subtotal: 1000, valor_total: 999999 }).valor_total, 1000);
eq('sin valor → error', (await lanza(() => util.calcularValores({})))?.code, 'GASTO_SIN_VALOR');
eq('negativo → error', (await lanza(() => util.calcularValores({ valor_total: -5 })))?.code, 'GASTO_NUMERO_INVALIDO');
eq('texto → error', (await lanza(() => util.calcularValores({ valor_total: 'abc' })))?.code, 'GASTO_NUMERO_INVALIDO');

// ─── 4. Registrar ───────────────────────────────────────────────────────────
seccion('4. Registrar: mes contable, tipo e idempotencia');
const g1 = await servicio.registrarGasto(ctx(), { categoria_id: catId('Publicidad'), valor_total: 80000, fecha: '2026-10-05' });
eq('el mes contable sale de la fecha', g1.mes_contable, '2026-10');
eq('el tipo sale de la categoría', g1.tipo, 'variable');
const g2 = await servicio.registrarGasto(ctx(), { categoria_id: catId('Arriendo'), valor_total: 2500000,
  fecha: '2026-11-03', mes_contable: '2026-10', tercero: 'Inmobiliaria' });
eq('★ el arriendo de octubre pagado en noviembre es de OCTUBRE', [g2.fecha, g2.mes_contable], ['2026-11-03', '2026-10']);
const g3 = await servicio.registrarGasto(ctx(), { categoria_id: catId('Publicidad'), tipo: 'fijo', valor_total: 30000,
  fecha: '2026-10-07', clave_idempotencia: 'clic-1' });
const g3b = await servicio.registrarGasto(ctx(), { categoria_id: catId('Publicidad'), tipo: 'fijo', valor_total: 30000,
  fecha: '2026-10-07', clave_idempotencia: 'clic-1' });
eq('el tipo se puede cambiar en el gasto', g3.tipo, 'fijo');
eq('★ doble clic (misma clave) = un solo gasto', g3b.id, g3.id);
eq('categoría que no existe → 400', (await lanza(() => servicio.registrarGasto(ctx(), { categoria_id: 9999, valor_total: 1 })))?.code, 'CATEGORIA_NO_EXISTE');
await servicio.asegurarCatalogo(2);
const catAjena = (await db.query('SELECT id FROM categorias_gasto WHERE negocio_id = 2 LIMIT 1')).rows[0].id;
eq('★ categoría de OTRO negocio → 400', (await lanza(() => servicio.registrarGasto(ctx(), { categoria_id: catAjena, valor_total: 1 })))?.code, 'CATEGORIA_NO_EXISTE');
eq('fecha inválida → 400', (await lanza(() => servicio.registrarGasto(ctx(), { categoria_id: catId('Otros'), valor_total: 1, fecha: '2026-02-30' })))?.code, 'FECHA_INVALIDA');
// Mes anterior, para el promedio.
await servicio.registrarGasto(ctx(), { categoria_id: catId('Publicidad'), valor_total: 50000, fecha: '2026-09-10' });
await servicio.registrarGasto(ctx(), { categoria_id: catId('Arriendo'), valor_total: 2500000, fecha: '2026-09-02' });
// Otra sede del mismo negocio.
await servicio.registrarGasto(ctx(2), { categoria_id: catId('Publicidad'), valor_total: 777, fecha: '2026-10-05' });

// ─── 5. Recurrentes ─────────────────────────────────────────────────────────
seccion('5. Recurrentes: un pago por mes; anular lo libera');
const recArr = (await db.query(`SELECT id FROM gastos_recurrentes WHERE nombre = 'Internet Claro'`)).rows[0].id;
const pago = await servicio.confirmarRecurrente(ctx(), recArr, { mes: '2026-10', valor: 125000 });
eq('confirmar crea el gasto ligado, con el valor real del mes', [pago.recurrente_id, pago.valor_total, pago.mes_contable, pago.tipo],
  [recArr, 125000, '2026-10', 'fijo']);
eq('★ el mismo mes otra vez → 409', (await lanza(() => servicio.confirmarRecurrente(ctx(), recArr, { mes: '2026-10' })))?.code, 'RECURRENTE_YA_PAGADO');
await servicio.anularGasto(ctx(), ADMIN, pago.id, 'Valor equivocado');
const pago2 = await servicio.confirmarRecurrente(ctx(), recArr, { mes: '2026-10' });
eq('anulado, se puede volver a pagar (con el valor de la plantilla)', pago2.valor_total, 120000);
eq('recurrente de otra sede → 404', (await lanza(() => servicio.confirmarRecurrente(ctx(2), recArr, { mes: '2026-10' })))?.code, 'RECURRENTE_NO_EXISTE');
eq('estado: pagado', util.estadoRecurrente({ dia_pago: 5, pagado: true }, '2026-10-01', '2026-10-20').estado, 'pagado');
eq('estado: vencido (día 5, hoy 20)', util.estadoRecurrente({ dia_pago: 5, pagado: false }, '2026-10-01', '2026-10-20').estado, 'vencido');
eq('estado: por vencer (3 días)', util.estadoRecurrente({ dia_pago: 23, pagado: false }, '2026-10-01', '2026-10-20'), { vence: '2026-10-23', estado: 'por_vencer', dias: 3 });
eq('estado: pendiente', util.estadoRecurrente({ dia_pago: 30, pagado: false }, '2026-10-01', '2026-10-20').estado, 'pendiente');
eq('día 31 en febrero vence el 28', util.estadoRecurrente({ dia_pago: 31, pagado: false }, '2026-02-01', '2026-01-10').vence, '2026-02-28');
eq('sin día: pendiente hasta que el mes pasa', [
  util.estadoRecurrente({ dia_pago: null, pagado: false }, '2026-10-01', '2026-10-31').estado,
  util.estadoRecurrente({ dia_pago: null, pagado: false }, '2026-10-01', '2026-11-01').estado], ['pendiente', 'vencido']);

// ─── 6. Resumen del mes ─────────────────────────────────────────────────────
seccion('6. Resumen: totales, categorías, promedio y pendientes');
const anuladoPub = await servicio.registrarGasto(ctx(), { categoria_id: catId('Publicidad'), valor_total: 999999, fecha: '2026-10-09' });
await servicio.anularGasto(ctx(), ADMIN, anuladoPub.id, 'Duplicado');
const res = await servicio.resumenMes(ctx(), ADMIN, '2026-10', { puedeRegistrar: true });
// Octubre sede 1: publicidad 80.000 (var) + 30.000 (fijo) + arriendo 2.500.000 (fijo) + internet 120.000 (fijo)
eq('★ total del mes sin anulados ni otra sede', res.total, 2730000);
eq('fijos y variables', [res.fijos, res.variables], [2650000, 80000]);
eq('promedio de septiembre (el único mes previo con gastos)', [res.promedio, res.meses_promedio], [2550000, 1]);
eq('variación contra el promedio', res.variacion_pct, 7);
const pub = res.por_categoria.find((c) => c.nombre === 'Publicidad');
eq('Publicidad: 110.000 en el mes, 50.000 de promedio, +120 %', [pub.total, pub.cantidad, pub.promedio, pub.variacion_pct], [110000, 2, 50000, 120]);
const otrosCat = res.por_categoria.find((c) => c.nombre === 'Otros');
eq('una categoría sin gastos pero con fijo esperado aparece con su presupuesto', [otrosCat.total, otrosCat.presupuesto], [0, 50000]);
eq('ordenadas de mayor a menor', res.por_categoria[0].nombre, 'Arriendo');
eq('4 pendientes (los recurrentes de la sede)', res.pendientes.length, 4);
eq('Internet figura pagado con lo que se pagó', res.pendientes.find((p) => p.nombre === 'Internet Claro').estado, 'pagado');
eq('resumen de recurrentes', [res.recurrentes_resumen.pagados, res.recurrentes_resumen.total], [1, 4]);
eq('serie de 6 meses terminando en octubre', [res.serie.length, res.serie[5].mes, res.serie[4].total], [6, '2026-10', 2550000]);
eq('permisos del admin', res.permisos, { puede_registrar: true, puede_administrar: true, ve_resultados: true });
const res2 = await servicio.resumenMes(ctx(2), ADMIN, '2026-10', { puedeRegistrar: true });
eq('★ la otra sede solo ve lo suyo', [res2.total, res2.pendientes.length], [777, 0]);
const lista = await servicio.listarGastos(ctx(), '2026-10');
eq('la lista no trae anulados', lista.some((g) => g.anulado), false);
eq('…salvo que se pidan', (await servicio.listarGastos(ctx(), '2026-10', { incluirAnulados: true })).filter((g) => g.anulado).length, 2);

// ─── 7. Editar y anular ─────────────────────────────────────────────────────
seccion('7. Editar y anular: el admin o quien lo registró');
const LAURA = { id: 2, rol: 'supervisor', negocio_id: 1 };
const PEDRO = { id: 3, rol: 'vendedor', negocio_id: 1 };
const deLaura = await servicio.registrarGasto(ctx(1, 2), { categoria_id: catId('Papelería y aseo'), valor_total: 12000, fecha: '2026-10-12' });
eq('★ otro usuario no puede editarlo', (await lanza(() => servicio.editarGasto(ctx(1, 3), PEDRO, deLaura.id, { valor_total: 1 })))?.code, 'GASTO_AJENO');
const editado = await servicio.editarGasto(ctx(1, 2), LAURA, deLaura.id, { valor_total: 15000, fecha: '2026-10-12', nombre: 'Resma' });
eq('quien lo registró sí', [editado.valor_total, editado.nombre], [15000, 'Resma']);
eq('anular exige motivo', (await lanza(() => servicio.anularGasto(ctx(1, 2), LAURA, deLaura.id, '')))?.code, 'MOTIVO_REQUERIDO');
await servicio.anularGasto(ctx(1, 1), ADMIN, deLaura.id, 'No era de la empresa');
eq('anulado no se edita', (await lanza(() => servicio.editarGasto(ctx(), ADMIN, deLaura.id, { valor_total: 1 })))?.code, 'GASTO_ANULADO');
eq('no se anula dos veces', (await lanza(() => servicio.anularGasto(ctx(), ADMIN, deLaura.id, 'otra vez')))?.code, 'GASTO_ANULADO');
eq('★ nada se borra', (await db.query('SELECT COUNT(*)::int n FROM gastos WHERE id = $1', [deLaura.id])).rows[0].n, 1);
eq('gasto de otra sede → 404', (await lanza(() => servicio.editarGasto(ctx(2), ADMIN, g1.id, { valor_total: 1 })))?.code, 'GASTO_NO_EXISTE');
eq('mover un recurrente a un mes donde ya está pagado → 409',
  (await (async () => {
    const sep = await servicio.confirmarRecurrente(ctx(), recArr, { mes: '2026-09' });
    return (await lanza(() => servicio.editarGasto(ctx(), ADMIN, sep.id, { valor_total: 1, fecha: '2026-10-01', mes_contable: '2026-10' })))?.code;
  })()), 'RECURRENTE_YA_PAGADO');

// ─── 8. Estado de resultados ────────────────────────────────────────────────
seccion('8. Estado de resultados: la utilidad bruta es la de Ventas');
const ventasFalsas = {
  resumen: { total_ventas: 20000000, ingresos_mora: 30000, ingresos_interes: 20000 },
  utilidad_periodo: { contado: 4000000, creditos: 500000, prestamos: 0, servicios: 100000, despachos: 0,
    total: 4600000, sin_costo: { total: 2 } },
  red_interna: { mora: { cobrada: 10000 } },
};
const er = util.armarEstadoResultados({ ventasRango: ventasFalsas, gastos: { fijos: 2650000, variables: 80000 } });
eq('★ bruta − gastos = operacional', er.utilidad_operacional, 4600000 - 2730000);
eq('+ financieros (mora, interés, mora de la red) = neta', [er.ingresos_financieros.total, er.utilidad_neta], [60000, 1930000]);
eq('de cada $100 vendidos', er.gasto_por_cada_100, 14);
eq('sin ventas no inventa la proporción', util.armarEstadoResultados({ ventasRango: {}, gastos: {} }).gasto_por_cada_100, null);
const original = reportes.getVentasRango;
let pedido = null;
reportes.getVentasRango = async (s, d, h) => { pedido = [s, d, h]; return ventasFalsas; };
const erSvc = await servicio.estadoResultados(ctx(), '2026-09');
reportes.getVentasRango = original;
eq('pide Ventas del mes entero de su sede', pedido, [1, '2026-09-01', '2026-09-30']);
eq('y resta los gastos de ese mes contable', erSvc.gastos.total, 2550000 + 120000);
eq('un mes que no empieza → 400', (await lanza(() => servicio.estadoResultados(ctx(), '2099-01')))?.code, 'MES_FUTURO');

// ─── 9. Proyección ──────────────────────────────────────────────────────────
seccion('9. Proyección: recurrentes + promedio de lo demás');
const est = await servicio.estimadoMensual(1, '2026-04-01', '2026-10-31');
// Recurrentes activos: 2.500.000 + 120.000 + 400.000 + 50.000 = 3.070.000.
// Sin plantilla: sept 2.550.000, oct 2.610.000 → promedio 2.580.000 (abril-agosto vacíos no cuentan).
eq('★ recurrentes de la sede', est.plantillas_total, 3070000);
eq('★ promedio de los meses con gastos sin plantilla', [est.otros_promedio, est.meses_otros], [2580000, 2]);
eq('total = los dos', est.total, 3070000 + 2580000);
eq('la lista trae la fila del promedio', est.lista.at(-1).nombre, 'Otros gastos (promedio de 2 meses)');
const fuente = leer(RAIZ, 'src/modules/reportes/reportes.service.js');
const proy = fuente.slice(fuente.indexOf('const getProyeccion'), fuente.indexOf('// ─── CRUD de gastos fijos'));
ok('★ getProyeccion ya no lee la tabla gastos_fijos', !/FROM gastos_fijos/.test(proy));
ok('getProyeccion lee el centro de gastos', /gastos\.service'\)\s*\.estimadoMensual/.test(proy));

// ─── 10. Análisis: gastos de un rango de días ───────────────────────────────
seccion('10. Rango de días: cada mes aporta su proporción');
const p = await servicio.totalPeriodo(ctx(), '2026-10-16', '2026-10-31');
eq('medio octubre (16 de 31 días)', p.total, Math.round(2730000 * 16 / 31));
const p2 = await servicio.totalPeriodo(ctx(), '2026-09-01', '2026-10-31');
eq('dos meses enteros', p2.total, 2670000 + 2730000);

// ─── 11. Rutas reales y permisos ────────────────────────────────────────────
seccion('11. Rutas: quién ve, quién registra, quién administra');
const router = require(path.join(RAIZ, 'src/modules/gastos/gastos.routes.js'));
let usuarioActual = null;
const app = express();
app.use(express.json());
app.use((req, _r, next) => { req.user = usuarioActual; req.sucursal_id = usuarioActual?.sucursal_id ?? 1; next(); });
app.use('/gastos', router);
app.use((e, _req, res, _next) => res.status(e.status || 500).json({ ok: false, error: e.message, code: e.code }));
const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
const url = `http://127.0.0.1:${server.address().port}/gastos`;
const pedir = async (u, metodo, ruta, body) => {
  usuarioActual = u;
  const r = await fetch(url + ruta, { method: metodo, headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined });
  return r.status;
};
const MODS = ['inventario', 'facturar', 'reportes'];
const sup = (extra = {}) => ({ id: 2, rol: 'supervisor', negocio_id: 1, sucursal_id: 1, modulos_permitidos: MODS, ...extra });
const nuevo = { categoria_id: catId('Otros'), valor_total: 1000, fecha: '2026-10-15' };

eq('★ supervisor sin permiso: no ve', await pedir(sup(), 'GET', '/resumen?mes=2026-10'), 403);
eq('★ supervisor sin permiso: no registra', await pedir(sup(), 'POST', '/', nuevo), 403);
eq('con «registrar»: ve', await pedir(sup({ permisos_gastos: { registrar: true } }), 'GET', '/resumen?mes=2026-10'), 200);
eq('con «registrar»: registra', await pedir(sup({ permisos_gastos: { registrar: true } }), 'POST', '/', nuevo), 201);
eq('con «registrar»: no ve el estado de resultados', await pedir(sup({ permisos_gastos: { registrar: true } }), 'GET', '/estado-resultados?mes=2026-10'), 403);
eq('con «registrar»: no crea categorías', await pedir(sup({ permisos_gastos: { registrar: true } }), 'POST', '/categorias', { nombre: 'X' }), 403);
eq('con «ver todos los reportes»: ve', await pedir(sup({ permisos_reportes: { ver_todo: true } }), 'GET', '/', null), 200);
eq('★ con «ver todos los reportes»: NO registra', await pedir(sup({ permisos_reportes: { ver_todo: true } }), 'POST', '/', nuevo), 403);
eq('★ «registrar» sin el módulo reportes: nada', await pedir(sup({ permisos_gastos: { registrar: true }, modulos_permitidos: ['inventario'] }), 'POST', '/', nuevo), 403);
eq('admin crea categorías', await pedir({ ...ADMIN, sucursal_id: 1 }, 'POST', '/categorias', { nombre: 'Seguros', tipo: 'fijo' }), 200);
eq('categoría repetida → 409', await pedir({ ...ADMIN, sucursal_id: 1 }, 'POST', '/categorias', { nombre: 'seguros' }), 409);
eq('admin crea un gasto fijo', await pedir({ ...ADMIN, sucursal_id: 1 }, 'POST', '/recurrentes', { nombre: 'Vigilancia', categoria_id: catId('Otros'), valor: 90000, dia_pago: 10 }), 200);
eq('negocio apagado → 404 para todos', await pedir({ id: 4, rol: 'admin_negocio', negocio_id: 2, sucursal_id: 3, modulos_permitidos: null }, 'GET', '/resumen', null), 404);
server.close();

// ─── 12. Lo que se guarda del permiso ───────────────────────────────────────
seccion('12. Permiso por usuario');
const { _normalizarPermisosGastos: norm } = require(path.join(RAIZ, 'src/modules/usuarios/usuarios.service.js'));
eq('encendido con el módulo', norm({ registrar: true }, 'supervisor', MODS), { registrar: true });
eq('apagado = NULL, nunca false', norm({ registrar: false }, 'supervisor', MODS), null);
eq('sin el módulo reportes = NULL', norm({ registrar: true }, 'vendedor', null), null);
eq('admin siempre NULL', norm({ registrar: true }, 'admin_negocio', null), null);
const { puedeRegistrarGastos, puedeVerGastos } = require(path.join(RAIZ, 'src/middlewares/role.middleware.js'));
eq('token viejo sin la clave: no registra', puedeRegistrarGastos({ rol: 'supervisor', modulos_permitidos: MODS }), false);
eq('ver con reportes completos', puedeVerGastos({ rol: 'supervisor', modulos_permitidos: MODS, permisos_reportes: { ver_todo: true } }), true);

// ─── 13. Espejos: runner, login, frontend ───────────────────────────────────
seccion('13. Runner de arranque, login y pantallas');
const runner = leer(RAIZ, 'src/config/migrations.js');
ok('el runner lee el MISMO .sql', runner.includes("migrations/20261020_gastos.sql"));
const authSvc = leer(RAIZ, 'src/modules/auth/auth.service.js');
ok('★ el login lee el permiso con to_jsonb (sin la columna no se cae)', authSvc.includes("to_jsonb(u) -> 'permisos_gastos'"));
ok('las rutas están montadas', leer(RAIZ, 'src/index.js').includes("'/api/gastos'"));
const leerFront = (p) => { try { return leer(FRONT, p); } catch { return ''; } };
const reportesPage = leerFront('pages/reportes/ReportesPage.jsx');
ok('Reportes tiene la pestaña Gastos', /id: 'gastos'/.test(reportesPage));
ok('la pestaña depende del opt-in', reportesPage.includes("gastos_activo === '1'"));
const proyPanel = leerFront('pages/reportes/PanelProyeccion.jsx');
ok('★ Proyección ya no edita gastos fijos', !/crearGastoFijo|actualizarGastoFijo|eliminarGastoFijo/.test(proyPanel));
const usuariosCfg = leerFront('pages/configuracion/UsuariosConfig.jsx');
ok('la casilla de gastos solo con la función encendida', usuariosCfg.includes('mostrarPermGastos') && usuariosCfg.includes("gastos_activo === '1'"));
const ctxFront = leerFront('context/AuthContext.jsx');
ok('AuthContext espeja la regla (registrar === true y el módulo)', ctxFront.includes('permisos_gastos?.registrar !== true'));

console.log(`\n${pasados} verificaciones pasaron, ${fallos.length} fallaron.`);
if (fallos.length) { console.log('Fallaron:', fallos); process.exit(1); }
process.exit(0);
