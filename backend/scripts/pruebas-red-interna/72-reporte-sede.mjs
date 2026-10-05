// ─────────────────────────────────────────────────────────────────────────────
// REPORTE POR SEDE (oct-2026)
//
// La sede entera en el período: equipos (con IMEI) y accesorios, cuántos
// siguen pendientes y cuántos ya se pagaron, lo pagado y lo que se debe; por
// tipo, mes a mes y por empleado. Sale de las MISMAS consultas que el reporte
// por empleado, y esta prueba arranca del MISMO escenario (el de la 68) para
// poder exigir que los dos digan lo mismo.
//
//   · Sección 1 — equipo o accesorio.
//   · Sección 2 — ★ las unidades de la sede = la suma de las del reporte por
//                 empleado, tipo por tipo y estado por estado.
//   · Sección 3 — la plata: contado por línea, crédito por CRÉDITO (dos líneas,
//                 una deuda), lo cancelado y lo devuelto no suman, y el
//                 «Saldado» sin abono se muestra aparte.
//   · Sección 4 — mes a mes y por empleado suman el total.
//   · Sección 5 — la lista de lo que se debe suma el total debido.
//   · Sección 6 — permisos: vendedor no; supervisor la suya (sin sede no es
//                 «todas»); «todas» solo el admin, dentro de su negocio.
//   · Sección 7 — el PDF de verdad: cifras, ningún salto de PDFKit, WinAnsi,
//                 el pie libre, «todas» una sede por hoja, 250 deudas.
//   · Sección 8 — la pantalla pide lo que el backend entiende (estática).
//
// Requiere PGlite (no va en package.json a propósito):
//   npm install --no-save @electric-sql/pglite
// ─────────────────────────────────────────────────────────────────────────────
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Writable } from 'node:stream';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');
const FRONT = path.resolve(RAIZ, '../frontend/src');
const leer = (...p) => readFileSync(path.join(...p), 'utf8');

const db = new PGlite();
await db.exec(leer(AQUI, 'esquema.sql'));
await db.exec(leer(AQUI, 'esquema-completo.sql'));
await db.exec(`
  ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS rol TEXT;
  ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS negocio_id INT;
  ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS sucursal_id INT;
  ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT TRUE;
`);

const conectar = (t) => ({ query: (s, p) => t.query(s, p ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

// Instrumentación de PDFKit: qué texto se pinta, dónde, y quién abre páginas.
const PDFDocument = require(path.join(RAIZ, 'node_modules/pdfkit'));
let trazos = null;
let saltosPdfkit = 0;
const origFragment = PDFDocument.prototype._fragment;
PDFDocument.prototype._fragment = function (t, x, y, o) {
  // El índice se anota AL PINTAR: al cerrar, PDFKit vacía `_pageBuffer`.
  if (trazos) trazos.push({ t: String(t ?? ''), x, y, n: this._pageBuffer.indexOf(this.page) });
  return origFragment.call(this, t, x, y, o);
};
const origContinue = PDFDocument.prototype.continueOnNewPage;
PDFDocument.prototype.continueOnNewPage = function (...a) { saltosPdfkit += 1; return origContinue.apply(this, a); };

const svc = require(path.join(RAIZ, 'src/modules/prestamos/reporteEmpleado.service.js'));
const { generarPdfReporteEmpleado } = require(path.join(RAIZ, 'src/modules/prestamos/reporteEmpleado.pdf.js'));
const base = require(path.join(RAIZ, 'src/utils/pdf.base.js'));

let pasados = 0; const fallos = [];
const ok = (nombre, cond, detalle = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos.push(nombre);
};
const seccion = (t) => console.log(`\n═══ ${t} ═══`);

// ── Escenario ───────────────────────────────────────────────────────────────
await db.exec(`
  INSERT INTO negocios (id, nombre) VALUES (1, 'Celulares Centro'), (2, 'Otro negocio');
  INSERT INTO sucursales (id, negocio_id, nombre) VALUES (1, 1, 'Centro'), (2, 1, 'Norte'), (3, 2, 'Ajena');
  INSERT INTO usuarios (id, nombre, rol, negocio_id, sucursal_id, activo) VALUES
    (1, 'Ana Torres',  'vendedor',      1, 1, TRUE),
    (2, 'Luis Pérez',  'vendedor',      1, 1, TRUE),
    (3, 'Jefe',        'admin_negocio', 1, NULL, TRUE),
    (4, 'Sofía Norte', 'vendedor',      1, 2, TRUE),
    (5, 'Exempleado',  'vendedor',      1, 1, FALSE),
    (9, 'De otro',     'vendedor',      2, 3, TRUE);
  INSERT INTO clientes (id, negocio_id, nombre, cedula) VALUES (1, 1, 'Carlos Ruiz', '1030');
  INSERT INTO prestatarios (id, negocio_id, nombre) VALUES (1, 1, 'Tienda Sur');
  INSERT INTO empleados_prestatario (id, prestatario_id, nombre) VALUES (1, 1, 'Pedro');
  INSERT INTO vendedores (id, negocio_id, sucursal_id, nombre) VALUES (1, 1, 1, 'Mostrador 1');

  INSERT INTO facturas (id, numero, sucursal_id, usuario_id, vendedor_id, nombre_cliente, cedula, estado, fecha, notas) VALUES
    (1, 101, 1, 1, 1,    'María Gómez', '5550', 'Activa',    '2026-09-05 10:00', NULL),
    (2, 102, 1, 1, NULL, 'Juan Díaz',   '5551', 'Activa',    '2026-09-10 11:00', NULL),
    (3, 103, 1, 1, NULL, 'Rosa Paz',    '5552', 'Cancelada', '2026-09-12 12:00', NULL),
    (4, 104, 1, 1, NULL, 'Carlos Ruiz', '1030', 'Credito',   '2026-09-15 09:00', NULL),
    (5, 105, 1, 1, NULL, 'Elena Mora',  '5553', 'Credito',   '2026-09-18 16:00', NULL),
    (6, 106, 1, 1, NULL, 'Ramiro Gil',  '5554', 'Activa',    '2026-09-20 17:00', NULL),
    (7, 107, 1, 1, NULL, 'Antes',       '1',    'Activa',    '2026-08-31 23:30', NULL),
    (8, 108, 1, 1, NULL, 'Despues',     '2',    'Activa',    '2026-10-01 00:10', NULL),
    (9, 109, 1, 1, NULL, 'Ultimo dia',  '3',    'Activa',    '2026-09-30 23:59', NULL),
    (10, 110, 1, NULL, NULL, 'Carlos Ruiz', '1030', 'Activa', '2026-09-22 10:00', 'Factura generada por saldo de préstamo #2'),
    (11, 111, 1, 2, NULL, 'Cliente Luis', '4',  'Activa',    '2026-09-07 10:00', NULL),
    (12, 112, 2, 1, NULL, 'Otra sede',   '5',   'Activa',    '2026-09-07 10:00', NULL),
    (13, 113, 1, 1, NULL, 'Nocturno',    '6',   'Activa',    '2026-09-02 02:00', NULL);

  INSERT INTO lineas_factura (factura_id, nombre_producto, imei, cantidad, precio, cantidad_devuelta) VALUES
    (1, 'iPhone 13 128GB', '111', 1, 2500000, 0),
    (1, 'Vidrio templado', NULL,  2, 20000,   0),
    (2, 'Samsung A54',     '222', 1, 1400000, 1),
    (3, 'Moto G84',        '333', 1, 900000,  0),
    (4, 'iPhone 14',       '444', 1, 3000000, 0),
    (5, 'Xiaomi 13',       '555', 1, 1800000, 0),
    (6, 'Cargador 20W',    NULL,  3, 50000,   1),
    (7, 'Antes',           '777', 1, 1,       0),
    (8, 'Despues',         '888', 1, 1,       0),
    (9, 'Poco X6',         '999', 1, 1100000, 0),
    (10, 'Redmi 12',       '1002', 1, 700000, 0),
    (11, 'Galaxy S23',     '1111', 1, 3200000, 0),
    (12, 'Otra sede',      '1212', 1, 1,       0),
    (13, 'Honor 90',       '1313', 1, 1500000, 0);

  INSERT INTO creditos (id, factura_id, cliente_id, sucursal_id, valor_total, cuota_inicial, total_abonado, estado) VALUES
    (1, 4, 1, 1, 3000000, 500000, 1000000, 'Activo'),
    (2, 5, NULL, 1, 1800000, 0, 1800000, 'Saldado');
  INSERT INTO abonos_credito (credito_id, valor, fecha, anulado) VALUES
    (1, 1000000, '2026-09-20 10:00', FALSE),
    (2, 1800000, '2026-09-25 10:00', FALSE),
    (2, 50000,   '2026-09-28 10:00', TRUE);

  INSERT INTO prestamos (id, numero, sucursal_id, usuario_id, prestatario, cedula, imei, nombre_producto,
                         cantidad_prestada, valor_prestamo, total_abonado, estado,
                         cliente_id, prestatario_id, empleado_id, fecha) VALUES
    (1, 11, 1, 1, 'Carlos Ruiz', '1030', '1001', 'iPhone 12', 1, 1200000, 200000, 'Activo',   1, NULL, NULL, '2026-09-03 10:00'),
    (2, 12, 1, 1, 'Carlos Ruiz', '1030', '1002', 'Redmi 12',  1, 700000,  700000, 'Saldado',  1, NULL, NULL, '2026-09-06 10:00'),
    (3, 13, 1, 1, 'Tienda Sur', 'COMPANERO', '1003', 'Moto E', 1, 400000, 0,      'Devuelto', NULL, 1, 1,  '2026-09-08 10:00'),
    (4, 14, 1, 1, 'Tienda Sur', 'COMPANERO', NULL,  'Forro',   5, 50000,  0,      'Activo',   NULL, 1, NULL, '2026-09-09 10:00'),
    (5, 15, 1, 1, 'Carlos Ruiz', 'AJUSTE', NULL, 'Ajuste de deuda', 1, 90000, 0,  'Activo',   1, NULL, NULL, '2026-09-10 10:00'),
    (6, 16, 1, 2, 'Tienda Sur', 'COMPANERO', '1004', 'A15',    1, 600000, 0,      'Activo',   NULL, 1, NULL, '2026-09-11 10:00');
  INSERT INTO abonos_prestamo (prestamo_id, valor, fecha, anulado) VALUES
    (1, 200000, '2026-09-10 10:00', FALSE),
    (2, 700000, '2026-09-22 10:00', FALSE),
    (2, 10000,  '2026-09-29 10:00', TRUE);
`);

const ADMIN = { id: 3, nombre: 'Jefe', rol: 'admin_negocio' };
const ANA   = { id: 1, nombre: 'Ana Torres', rol: 'vendedor' };
const SEP   = { desde: '2026-09-01', hasta: '2026-09-30' };

const reporte = (extra = {}) => svc.obtenerReporte({
  negocioId: 1, sucursalId: 1, usuario: ADMIN, usuarioId: 1, soloEquipos: false, ...SEP, ...extra,
});
const sec  = (emp, tipo) => emp.secciones.find((s) => s.id === tipo);
const grp  = (emp, tipo, g) => sec(emp, tipo).grupos.find((x) => x.id === g);
const docs = (emp, tipo, g) => (grp(emp, tipo, g)?.filas || []).map((f) => f.documento).sort();

const WINANSI = new Set([...Array.from({ length: 95 }, (_, i) => 32 + i), ...Array.from({ length: 96 }, (_, i) => 160 + i),
  ...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.split('').map((ch) => ch.codePointAt(0))]);

// ═══ Reporte por SEDE ═══════════════════════════════════════════════════════
const sedeSvc = require(path.join(RAIZ, 'src/modules/prestamos/reporteSede.service.js'));
const { generarPdfReporteSede } = require(path.join(RAIZ, 'src/modules/prestamos/reporteSede.pdf.js'));
const ctrl = require(path.join(RAIZ, 'src/modules/prestamos/prestamos.controller.js'));

// Dos casos que el escenario de la 68 no tiene: un crédito de DOS líneas (su
// plata se cuenta UNA vez) y uno cerrado «Saldado» sin el abono registrado.
await db.exec(`
  SELECT setval('facturas_id_seq', (SELECT MAX(id) FROM facturas));
  INSERT INTO facturas (id, numero, sucursal_id, usuario_id, nombre_cliente, cedula, estado, fecha) VALUES
    (120, 120, 1, 1, 'Tomás Lee',  '7001', 'Credito', '2026-09-20 10:00'),
    (121, 121, 1, 2, 'Lucía Mar',  '7002', 'Credito', '2026-09-21 10:00');
  INSERT INTO lineas_factura (factura_id, nombre_producto, imei, cantidad, precio, cantidad_devuelta) VALUES
    (120, 'Tablet A9',  '2020', 1, 1000000, 0),
    (121, 'Moto G54',   '2121', 1, 800000,  0),
    (121, 'Funda Moto', NULL,   1, 200000,  0);
  INSERT INTO creditos (id, factura_id, cliente_id, sucursal_id, valor_total, cuota_inicial, total_abonado, estado) VALUES
    (3, 120, NULL, 1, 1000000, 0,      0, 'Saldado'),
    (4, 121, NULL, 1, 1000000, 100000, 0, 'Activo');
`);

const rSede = (extra = {}) => sedeSvc.obtenerReporteSede({
  negocioId: 1, sucursalId: 1, usuario: ADMIN, ...SEP, ...extra,
});
const tipo = (s, id) => s.tipos.find((t) => t.id === id);

// ═══ 1 ══════════════════════════════════════════════════════════════════════
seccion('1 · Equipo o accesorio');
ok('con IMEI = equipo', sedeSvc.categoriaDe('3567') === 'equipo');
ok('sin IMEI = accesorio', sedeSvc.categoriaDe(null) === 'accesorio' && sedeSvc.categoriaDe('  ') === 'accesorio');
ok('el mes se nombra en español', sedeSvc.etiquetaMes('2026-09') === 'Septiembre 2026');

// ═══ 2 ══════════════════════════════════════════════════════════════════════
seccion('2 · Las unidades son las del reporte por empleado');
const r2 = await rSede();
const s2 = r2.sedes[0];
const emp2 = await reporte({ usuarioId: null, soloEquipos: false });
for (const t of svc.TIPOS) {
  for (const g of svc.GRUPOS) {
    const delEmpleado = emp2.empleados.reduce((acc, e) =>
      acc + (sec(e, t.id).grupos.find((x) => x.id === g.id)?.filas.reduce((a, f) => a + f.cantidad, 0) || 0), 0);
    const deSede = tipo(s2, t.id).unidades.equipo[g.id] + tipo(s2, t.id).unidades.accesorio[g.id];
    if (delEmpleado || deSede) ok(`★ ${t.titulo} · ${g.titulo}: sede ${deSede} = suma de empleados ${delEmpleado}`, deSede === delEmpleado);
  }
}
ok('el iPhone 13 es equipo y el vidrio (×2) accesorio',
  tipo(s2, 'contado').unidades.equipo.pagado >= 1 && tipo(s2, 'contado').unidades.accesorio.pagado === 2);
ok('el forro prestado (×5) es accesorio pendiente', tipo(s2, 'prestamo_companero').unidades.accesorio.pendiente === 5);
ok('fuera: la factura del préstamo saldado y el ajuste de deuda',
  tipo(s2, 'contado').documentos === 7 && tipo(s2, 'prestamo_cliente').documentos === 2);
ok('fuera: la otra sede y lo de fuera del rango (F-107, F-108, F-112)',
  !s2.meses.some((m) => m.mes !== '2026-09'));

// ═══ 3 ══════════════════════════════════════════════════════════════════════
seccion('3 · La plata');
const c = tipo(s2, 'contado');
ok('★ contado = precio × lo que no se devolvió (el cargador: 2 de 3)', c.valor === 2540000 + 100000 + 1100000 + 3200000 + 1500000, String(c.valor));
ok('★ contado: lo cancelado y lo devuelto entero no suman', c.pagado === c.valor && c.debe === 0);
const cr = tipo(s2, 'credito');
ok('★ crédito: la plata se cuenta por CRÉDITO, no por línea (el de dos líneas una vez)',
  cr.valor === 3000000 + 1800000 + 1000000 + 1000000, String(cr.valor));
ok('★ crédito: pagado = cuota inicial + abonos', cr.pagado === (500000 + 1000000) + 1800000 + 0 + 100000, String(cr.pagado));
ok('★ crédito: debe = saldo de lo ACTIVO', cr.debe === 1500000 + 900000, String(cr.debe));
ok('★ el «Saldado» sin abono no se esconde: va como cerrado sin pago', cr.cerrado_sin_pago === 1000000);
ok('crédito: valor = pagado + debe + cerrado sin pago', cr.valor === cr.pagado + cr.debe + cr.cerrado_sin_pago);
ok('créditos activos y saldados', cr.activos === 2 && cr.saldados === 2, `${cr.activos}/${cr.saldados}`);
const pc = tipo(s2, 'prestamo_cliente');
ok('★ préstamo a cliente: valor, abonado y lo que falta', pc.valor === 1900000 && pc.pagado === 900000 && pc.debe === 1000000);
const pp = tipo(s2, 'prestamo_companero');
ok('★ préstamo devuelto no suma plata (Moto E)', pp.valor === 650000 && pp.debe === 650000 && pp.pagado === 0, String(pp.valor));
ok('★ total = suma de los tipos',
  ['valor', 'pagado', 'debe'].every((k) => Math.abs(s2.total[k] - s2.tipos.reduce((a, t) => a + t[k], 0)) < 0.01));

// ═══ 4 ══════════════════════════════════════════════════════════════════════
seccion('4 · Mes a mes y por empleado');
const r4 = await rSede({ desde: '2026-08-01', hasta: '2026-10-31' });
const s4 = r4.sedes[0];
ok('tres meses, en orden', s4.meses.map((m) => m.mes).join() === '2026-08,2026-09,2026-10', s4.meses.map((m) => m.mes).join());
ok('★ la suma de los meses = el total',
  ['valor', 'pagado', 'debe', 'documentos'].every((k) => Math.abs(s4.total[k] - s4.meses.reduce((a, m) => a + m[k], 0)) < 0.01));
ok('★ la suma de los empleados = el total',
  ['valor', 'pagado', 'debe', 'documentos', 'activos'].every((k) => Math.abs(s4.total[k] - s4.empleados.reduce((a, e) => a + e[k], 0)) < 0.01));
ok('empleados: quien más movió arriba', s4.empleados[0].nombre === 'Ana Torres' && s4.empleados[1].nombre === 'Luis Pérez');
const luis = s2.empleados.find((e) => e.usuario_id === 2);
ok('Luis: Galaxy S23 de contado, el crédito de dos líneas y el A15 prestado',
  luis.valor === 3200000 + 1000000 + 600000 && luis.debe === 900000 + 600000, `${luis.valor}/${luis.debe}`);

// ═══ 5 ══════════════════════════════════════════════════════════════════════
seccion('5 · Lo que se debe, documento por documento');
const pend = s2.pendientes;
ok('solo créditos y préstamos con saldo', pend.every((g) => g.id !== 'contado' && g.documentos.every((d) => d.debe > 0)));
ok('★ la lista suma lo mismo que el total debido',
  Math.abs(pend.reduce((a, g) => a + g.debe, 0) - s2.total.debe) < 0.01);
const pcr = pend.find((g) => g.id === 'credito');
ok('del que más debe al que menos', pcr.documentos[0].debe >= pcr.documentos[pcr.documentos.length - 1].debe);
ok('el crédito de dos líneas sale UNA vez, con sus dos productos',
  pcr.documentos.filter((d) => d.documento === 'F-121').length === 1
  && pcr.documentos.find((d) => d.documento === 'F-121').productos.includes('Funda Moto'));
ok('cada documento dice quién lo hizo', pcr.documentos.find((d) => d.documento === 'F-121').empleado === 'Luis Pérez');
ok('sin la opción, no hay lista', (await rSede({ incluirPendientes: false })).sedes[0].pendientes === null);

// ═══ 6 ══════════════════════════════════════════════════════════════════════
seccion('6 · Quién puede pedirlo');
const rechazo = async (p) => { try { await sedeSvc.obtenerReporteSede(p); return null; } catch (e) { return e.status; } };
ok('★ un vendedor no (son las cifras de toda la sede): 403',
  await rechazo({ negocioId: 1, sucursalId: 1, usuario: ANA, ...SEP }) === 403);
const SUP = { id: 2, nombre: 'Luis Pérez', rol: 'supervisor' };
ok('★ un supervisor sin sede NO cae en «todas»: 400',
  await rechazo({ negocioId: 1, sucursalId: null, usuario: SUP, ...SEP }) === 400);
const rSup = await sedeSvc.obtenerReporteSede({ negocioId: 1, sucursalId: 1, usuario: SUP, ...SEP });
ok('un supervisor saca la suya', rSup.sedes.length === 1 && rSup.sedes[0].sucursal_id === 1 && !rSup.todas);
ok('rango malo: 400', await rechazo({ negocioId: 1, sucursalId: 1, usuario: ADMIN, desde: '2026-09-30', hasta: '2026-09-01' }) === 400);
ok('una sede de otro negocio: 404', await rechazo({ negocioId: 1, sucursalId: 3, usuario: ADMIN, ...SEP }) === 404);

const rTodas = await rSede({ sucursalId: null });
ok('★ admin «todas»: las sedes de SU negocio, ninguna ajena', rTodas.todas && rTodas.sedes.map((s) => s.sucursal_id).join() === '1,2');
ok('★ el consolidado = la suma de las sedes',
  ['valor', 'pagado', 'debe'].every((k) => Math.abs(rTodas.consolidado[k] - rTodas.sedes.reduce((a, s) => a + s.total[k], 0)) < 0.01));
ok('Norte trae la venta de Ana allá (F-112)', rTodas.sedes[1].total.valor === 1);

// El controlador: `todas=1` solo lo honra el admin.
const llamar = (handler, query, user, sucursal_id = 1) => new Promise((resolve, reject) => {
  handler({ query, user, sucursal_id }, { json: (o) => resolve(o.data), status: () => ({ json: resolve }) }, reject);
});
const cSup = await llamar(ctrl.getResumenReporteSede, { ...SEP, todas: '1' }, { ...SUP, negocio_id: 1 });
ok('★ un supervisor que manda todas=1 recibe solo la suya', !cSup.todas && cSup.sedes.length === 1 && cSup.sedes[0].sucursal_id === 1);
const cAdm = await llamar(ctrl.getResumenReporteSede, { ...SEP, todas: '1' }, { ...ADMIN, negocio_id: 1 });
ok('el admin sí', cAdm.todas && cAdm.sedes.length === 2 && cAdm.consolidado);
ok('el resumen del modal no trae la lista larga', cAdm.sedes.every((s) => s.pendientes === undefined));

// ═══ 7 ══════════════════════════════════════════════════════════════════════
seccion('7 · El PDF de verdad');
const renderSede = async (rep) => {
  trazos = []; saltosPdfkit = 0;
  const doc = generarPdfReporteSede({ reporte: rep, config: { nombre_negocio: 'Celulares Centro', nit: '900' } });
  const partes = [];
  await new Promise((res, rej) => {
    doc.pipe(new Writable({ write(ch, _e, cb) { partes.push(ch); cb(); } })).on('finish', res).on('error', rej);
  });
  const salida = trazos; trazos = null;
  return { buf: Buffer.concat(partes), trazos: salida, paginas: Math.max(...salida.map((t) => t.n)) + 1 };
};
const p1 = await renderSede(r2);
if (process.env.GUARDAR_PDF) writeFileSync(path.join(process.env.GUARDAR_PDF, 'reporte-sede.pdf'), p1.buf);
const t1 = p1.trazos.map((t) => t.t).join(' ');
ok('es un PDF', p1.buf.subarray(0, 5).toString() === '%PDF-');
for (const t of ['REPORTE POR SEDE', 'Centro', 'UNIDADES POR TIPO Y ESTADO', 'PLATA POR TIPO', 'MES A MES',
  'POR EMPLEADO', 'Por cobrar · Ventas a crédito', 'Celulares y equipos'.toUpperCase(), 'TOTAL DEBIDO']) {
  ok(`trae «${t}»`, t1.toUpperCase().includes(t.toUpperCase()));
}
ok('★ dice el total debido de verdad', t1.includes(base.formatCOP(s2.total.debe)), base.formatCOP(s2.total.debe));
ok('★ y lo pagado', t1.includes(base.formatCOP(s2.total.pagado)));
ok('★ explica lo cerrado sin pago registrado', t1.includes('sin el abono registrado'));
ok('ningún salto lo decidió PDFKit', saltosPdfkit === 0, `saltos=${saltosPdfkit}`);
const fuera1 = [...new Set([...t1].filter((ch) => !WINANSI.has(ch.codePointAt(0))))];
ok('todo carácter impreso está en WinAnsi', fuera1.length === 0, fuera1.join(''));
ok('nada invade la franja del pie', !p1.trazos.some((t) => t.y > base.BODY_BOTTOM && t.y < base.PAGE_H - 44));

const pTodas = await renderSede(rTodas);
const inicioCentro = pTodas.trazos.find((t) => t.t === 'Centro' && t.y > 100 && t.y < 250)?.n;
const inicioNorte  = pTodas.trazos.find((t) => t.t === 'Norte' && t.y > 100 && t.y < 250)?.n;
ok('★ «todas»: consolidado en la primera hoja y cada sede en la suya',
  pTodas.trazos.some((t) => t.n === 0 && t.t === 'Todas las sedes') && inicioCentro > 0 && inicioNorte > inicioCentro,
  `${inicioCentro} / ${inicioNorte}`);
ok('«todas»: sin saltos de PDFKit', saltosPdfkit === 0);

// Muchas deudas: la lista se parte en hojas llenas, con su cabecera.
await db.exec(`
  SELECT setval('prestamos_id_seq', (SELECT MAX(id) FROM prestamos));
  INSERT INTO prestamos (sucursal_id, usuario_id, numero, prestatario, cedula, imei, nombre_producto,
                         cantidad_prestada, valor_prestamo, total_abonado, estado, cliente_id, fecha)
  SELECT 1, 2, 5000 + g, 'Cliente con un nombre bastante largo número ' || g, '88' || g,
         '36' || LPAD(g::text, 13, '0'), 'Equipo de gama media con nombre muy largo modelo ' || g,
         1, 900000, (g % 4) * 100000, 'Activo', 1, '2026-09-10 10:00'::timestamp + (g || ' minutes')::interval
    FROM generate_series(1, 250) g;
`);
const rGrande = await rSede();
const pG = await renderSede(rGrande);
ok('250 deudas: sin saltos de PDFKit', saltosPdfkit === 0);
ok('250 deudas: hojas llenas (menos de 20)', pG.paginas > 5 && pG.paginas < 20, `${pG.paginas} páginas`);
ok('la cabecera de la lista se repite en cada hoja que la lleva',
  new Set(pG.trazos.filter((t) => t.t === 'EMPLEADO').map((t) => t.n)).size >= pG.paginas - 2);
ok('nada invade la franja del pie (250)', !pG.trazos.some((t) => t.y > base.BODY_BOTTOM && t.y < base.PAGE_H - 44));
const vacia = await renderSede(await rSede({ desde: '2026-01-01', hasta: '2026-01-31' }));
ok('sin nada en el período: lo dice', vacia.trazos.some((t) => t.t.includes('No hay ventas, créditos ni préstamos')));

// ═══ 8 ══════════════════════════════════════════════════════════════════════
seccion('8 · La pantalla pide lo que el backend entiende');
const api8   = leer(FRONT, 'api/prestamos.api.js');
const modal8 = leer(FRONT, 'pages/prestamos/ModalReporteEmpleado.jsx');
const rutas8 = leer(RAIZ, 'src/modules/prestamos/prestamos.routes.js');
const pag8   = leer(FRONT, 'pages/prestamos/PrestamosPage.jsx');
ok('la API pide las dos rutas', api8.includes("'/prestamos/reporte-sede'") && api8.includes("'/prestamos/reporte-sede/pdf'"));
ok('manda todas, pendientes y la sede', ["todas: '1'", "pendientes: pendientes ? '1' : '0'", 'sucursal_id'].every((x) => api8.includes(x)));
ok('★ las rutas van ANTES de /:id/pdf',
  rutas8.indexOf("router.get('/reporte-sede/pdf'") > 0
  && rutas8.indexOf("router.get('/reporte-sede/pdf'") < rutas8.indexOf("router.get('/:id/pdf'"));
ok('★ el vendedor no ve la pestaña de sede', modal8.includes("usuario.rol !== 'vendedor'") && modal8.includes('<PanelReporteSede'));
ok('el modal muestra las cifras antes de descargar', modal8.includes('getResumenReporteSede(filtros)'));
ok('el admin puede pedir todas las sedes', modal8.includes('value="todas"'));
ok('el botón de la cabecera nombra los dos reportes', pag8.includes("'Reporte por empleado / sede'"));

console.log(`\n${pasados} verificaciones pasaron · ${fallos.length} fallaron`);
if (fallos.length) { console.log(fallos.map((f) => `  ✗ ${f}`).join('\n')); process.exit(1); }
