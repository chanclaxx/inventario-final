// ─────────────────────────────────────────────────────────────────────────────
// REPORTE POR EMPLEADO (29-sep-2026)
//
// Al empleado se le paga por lo que mueve —vendido, prestado a clientes y a
// compañeros, a crédito— y el jefe liquida cada mes. El reporte muestra TODO lo
// que hizo entre dos fechas, separado por tipo y por estado (lo devuelto no se
// paga igual que lo vendido). Solo muestra: no calcula comisiones.
//
//   · Sección 1 — clasificación: cada línea cae en el grupo correcto.
//   · Sección 2 — el mes de Ana: tipos, estados, bordes de fecha y lo que NO
//                 entra (otra sede, ajustes de deuda, la factura que genera un
//                 préstamo saldado).
//   · Sección 3 — «Solo equipos con IMEI» deja fuera los accesorios.
//   · Sección 4 — permisos: el vendedor solo saca el suyo; el selector no
//                 cruza negocios.
//   · Sección 5 — «Todos»: un bloque por empleado, sin la factura del préstamo.
//   · Sección 6 — validación del rango.
//   · Sección 7 — el PDF de verdad: textos, ningún salto decidido por PDFKit,
//                 nada en la franja del pie, todo en WinAnsi, 300 filas.
//   · Sección 8 — la pantalla pide lo que el backend entiende (estática).
//   · Sección 9 — la lista del modal dice cuántas filas trae cada PDF (y son
//                 las mismas del PDF), y el PDF vacío dice por qué (Cellsite).
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

// ═══ 1 ══════════════════════════════════════════════════════════════════════
seccion('1 · Clasificación');
const L = (o) => ({ cantidad: 1, cantidad_devuelta: 0, factura_estado: 'Activa', ...o });
ok('contado entregado = vendido/pagado', svc.clasificarLineaFactura(L({})) === 'pagado');
ok('factura cancelada = cancelado', svc.clasificarLineaFactura(L({ factura_estado: 'Cancelada' })) === 'cancelado');
ok('todo devuelto = devuelto', svc.clasificarLineaFactura(L({ cantidad: 2, cantidad_devuelta: 2 })) === 'devuelto');
ok('parte devuelta = devolución parcial', svc.clasificarLineaFactura(L({ cantidad: 3, cantidad_devuelta: 1 })) === 'devuelto_parcial');
ok('crédito activo = pendiente',
  svc.clasificarLineaFactura(L({ factura_estado: 'Credito', credito_id: 1, credito_estado: 'Activo' })) === 'pendiente');
ok('crédito saldado = pagado',
  svc.clasificarLineaFactura(L({ factura_estado: 'Credito', credito_id: 1, credito_estado: 'Saldado' })) === 'pagado');
ok('crédito cancelado = cancelado aunque la factura siga',
  svc.clasificarLineaFactura(L({ factura_estado: 'Credito', credito_id: 1, credito_estado: 'Cancelado' })) === 'cancelado');
ok('cancelada gana sobre devuelta',
  svc.clasificarLineaFactura(L({ factura_estado: 'Cancelada', cantidad_devuelta: 1 })) === 'cancelado');
ok('préstamo: Activo/Saldado/Devuelto',
  svc.clasificarPrestamo({ estado: 'Activo' }) === 'pendiente'
  && svc.clasificarPrestamo({ estado: 'Saldado' }) === 'pagado'
  && svc.clasificarPrestamo({ estado: 'Devuelto' }) === 'devuelto');
ok('un estado desconocido no se esconde (va a pendientes)', svc.clasificarPrestamo({ estado: 'Raro' }) === 'pendiente');
ok('contado dice «Vendidos» y los demás «Pagados»',
  svc.tituloGrupo('contado', 'pagado') === 'Vendidos' && svc.tituloGrupo('credito', 'pagado') === 'Pagados');

// ═══ 2 ══════════════════════════════════════════════════════════════════════
seccion('2 · El mes de Ana');
const r1 = await reporte();
const ana = r1.empleados[0];
ok('un solo empleado, Ana', r1.empleados.length === 1 && ana.nombre === 'Ana Torres');
ok('trae los cuatro tipos, en orden',
  ana.secciones.map((s) => s.id).join() === 'contado,credito,prestamo_cliente,prestamo_companero');
ok('contado vendidos: F-101 (2 líneas), F-106 no, F-109, F-113',
  docs(ana, 'contado', 'pagado').join() === 'F-101,F-101,F-109,F-113', docs(ana, 'contado', 'pagado').join());
ok('contado devuelto: F-102', docs(ana, 'contado', 'devuelto').join() === 'F-102');
ok('contado devolución parcial: F-106', docs(ana, 'contado', 'devuelto_parcial').join() === 'F-106');
ok('contado cancelado: F-103', docs(ana, 'contado', 'cancelado').join() === 'F-103');
ok('contado nunca tiene «pendientes»', !grp(ana, 'contado', 'pendiente'));
ok('crédito pendiente: F-104; pagado: F-105',
  docs(ana, 'credito', 'pendiente').join() === 'F-104' && docs(ana, 'credito', 'pagado').join() === 'F-105');
ok('préstamos a clientes: P-11 pendiente, P-12 pagado',
  docs(ana, 'prestamo_cliente', 'pendiente').join() === 'P-11' && docs(ana, 'prestamo_cliente', 'pagado').join() === 'P-12');
ok('préstamos a compañeros: P-13 devuelto, P-14 pendiente',
  docs(ana, 'prestamo_companero', 'devuelto').join() === 'P-13' && docs(ana, 'prestamo_companero', 'pendiente').join() === 'P-14');

const todasLasFilas = ana.secciones.flatMap((s) => s.grupos.flatMap((g) => g.filas));
const documentos = new Set(todasLasFilas.map((f) => f.documento));
ok('borde: el 31-ago 23:30 y el 1-oct 00:10 quedan fuera',
  !documentos.has('F-107') && !documentos.has('F-108'));
ok('borde: el 30-sep 23:59 entra', documentos.has('F-109'));
ok('la venta de las 2 a. m. sale con SU día (sin corrimiento de zona)',
  todasLasFilas.find((f) => f.documento === 'F-113')?.fecha === '02/09/2026');
ok('otra sede no entra (F-112)', !documentos.has('F-112'));
ok('el ajuste de deuda no es un préstamo (P-15 fuera)', !documentos.has('P-15'));
ok('lo de Luis no entra en el de Ana', !documentos.has('F-111') && !documentos.has('P-16'));

const f104 = grp(ana, 'credito', 'pendiente').filas[0];
const saldo = f104.detalle.find((d) => typeof d === 'object');
ok('crédito pendiente dice su saldo (3.000.000 − 500.000 − 1.000.000)', saldo?.valor === 1500000, JSON.stringify(f104.detalle));
const f105 = grp(ana, 'credito', 'pagado').filas[0];
ok('crédito pagado dice la fecha del último abono NO anulado',
  f105.detalle.includes('Crédito pagado el 25/09/2026'), JSON.stringify(f105.detalle));
const p12 = grp(ana, 'prestamo_cliente', 'pagado').filas[0];
ok('préstamo pagado: fecha del último abono vigente', p12.detalle.includes('Pagado el 22/09/2026'), JSON.stringify(p12.detalle));
const p11 = grp(ana, 'prestamo_cliente', 'pendiente').filas[0];
ok('préstamo pendiente: debe y abonado',
  p11.detalle.some((d) => d.etiqueta === 'Debe' && d.valor === 1000000)
  && p11.detalle.some((d) => d.etiqueta === 'Abonado' && d.valor === 200000));
const p13 = grp(ana, 'prestamo_companero', 'devuelto').filas[0];
ok('préstamo a compañero dice a qué tienda y quién lo recibió',
  p13.persona === 'Tienda Sur' && p13.persona_extra === 'Recibió: Pedro');
ok('el compañero no sale con cédula «COMPANERO»', !todasLasFilas.some((f) => /COMPANERO/.test(f.persona_extra || '')));
const f106 = grp(ana, 'contado', 'devuelto_parcial').filas[0];
ok('devolución parcial dice cuántas', f106.detalle.includes('Devolvió 1 de 3'));
const f101 = grp(ana, 'contado', 'pagado').filas.find((f) => f.imei === '111');
ok('la venta con vendedor asignado lo muestra', f101.persona_extra.includes('Vendedor: Mostrador 1'));
ok('valor de la línea = lo facturado (2 vidrios a 20.000)',
  grp(ana, 'contado', 'pagado').filas.find((f) => f.producto === 'Vidrio templado')?.valor === 40000);
ok('sin la columna de obsequios el reporte no se cae', todasLasFilas.every((f) => f.obsequio === false));
ok('unidades por tipo: contado (1+2) + 1 + 1 + 3 + 1 + 1 = 10', sec(ana, 'contado').unidades === 10, String(sec(ana, 'contado').unidades));

// Obsequio: con la columna, la línea marcada dice «Obsequio» y no un valor.
await db.exec(`ALTER TABLE lineas_factura ADD COLUMN obsequio BOOLEAN NOT NULL DEFAULT FALSE;
  UPDATE lineas_factura SET obsequio = TRUE, precio = 0 WHERE nombre_producto = 'Vidrio templado';`);
const rOb = await reporte();
const vidrio = rOb.empleados[0].secciones[0].grupos[0].filas.find((f) => f.producto === 'Vidrio templado');
ok('un obsequio sale marcado y sin valor', vidrio?.obsequio === true && vidrio.valor === null);

// ═══ 3 ══════════════════════════════════════════════════════════════════════
seccion('3 · Solo equipos con IMEI');
const r3 = await reporte({ soloEquipos: true });
const filas3 = r3.empleados[0].secciones.flatMap((s) => s.grupos.flatMap((g) => g.filas));
ok('sin vidrio, cargador ni forros', !filas3.some((f) => ['Vidrio templado', 'Cargador 20W', 'Forro'].includes(f.producto)));
ok('todas las filas tienen IMEI', filas3.every((f) => f.imei));
ok('marcado en el reporte', r3.solo_equipos === true);
ok('los equipos siguen todos (7 en facturas + 3 prestados)', filas3.length === 10, String(filas3.length));

// ═══ 4 ══════════════════════════════════════════════════════════════════════
seccion('4 · Permisos');
const r4 = await svc.obtenerReporte({ negocioId: 1, sucursalId: 1, usuario: ANA, usuarioId: 2, ...SEP });
ok('un vendedor que pide a Luis recibe el SUYO', r4.empleados.length === 1 && r4.empleados[0].usuario_id === 1);
const r4b = await svc.obtenerReporte({ negocioId: 1, sucursalId: 1, usuario: ANA, usuarioId: null, ...SEP });
ok('un vendedor que pide «todos» recibe el suyo', r4b.empleados.length === 1 && r4b.empleados[0].usuario_id === 1 && !r4b.todos);
const lv = await svc.listarEmpleados({ negocioId: 1, sucursalId: 1, usuario: ANA });
ok('el selector del vendedor solo lo tiene a él y no deja elegir',
  !lv.puede_elegir && lv.empleados.length === 1 && lv.empleados[0].id === 1);
const la = await svc.listarEmpleados({ negocioId: 1, sucursalId: 1, usuario: ADMIN });
const ids = la.empleados.map((e) => e.id).sort();
ok('el del admin: los de la sede + admin, incluido el inactivo', la.puede_elegir && ids.join() === '1,2,3,5', ids.join());
ok('no aparece la de otra sede ni el de otro negocio', !ids.includes(4) && !ids.includes(9));
let err404 = null;
try { await reporte({ usuarioId: 9 }); } catch (e) { err404 = e; }
ok('pedir un usuario de OTRO negocio responde 404', err404?.status === 404);

// ═══ 5 ══════════════════════════════════════════════════════════════════════
seccion('5 · Todos los empleados');
const r5 = await reporte({ usuarioId: null });
const nombres = r5.empleados.map((e) => e.nombre);
ok('Ana y Luis, cada uno con lo suyo', nombres.join() === 'Ana Torres,Luis Pérez', nombres.join());
ok('la factura que genera un préstamo saldado NO sale (ni como «sin usuario»)',
  !r5.empleados.some((e) => e.secciones.some((s) => s.grupos.some((g) => g.filas.some((f) => f.documento === 'F-110')))));
ok('marcado como «todos»', r5.todos === true);
const luis = r5.empleados[1];
ok('Luis: F-111 vendido y P-16 pendiente',
  docs(luis, 'contado', 'pagado').join() === 'F-111' && docs(luis, 'prestamo_companero', 'pendiente').join() === 'P-16');
const r5b = await svc.obtenerReporte({ negocioId: 1, sucursalId: 1, usuario: ADMIN, usuarioId: 2, desde: '2026-01-01', hasta: '2026-01-31' });
ok('un empleado sin movimientos sale igual, con sus secciones vacías',
  r5b.empleados.length === 1 && r5b.empleados[0].total_filas === 0 && r5b.empleados[0].secciones.length === 4);

// ═══ 6 ══════════════════════════════════════════════════════════════════════
seccion('6 · Rango de fechas');
const rechaza = async (d, h) => { try { await reporte({ desde: d, hasta: h }); return false; } catch (e) { return e.status === 400; } };
ok('sin fechas: 400', await rechaza(undefined, undefined));
ok('inicio después del fin: 400', await rechaza('2026-09-30', '2026-09-01'));
ok('texto cualquiera: 400', await rechaza('ayer', '2026-09-01'));
ok('más de un año: 400', await rechaza('2025-01-01', '2026-09-30'));
ok('un solo día vale', !(await rechaza('2026-09-05', '2026-09-05')));

// ═══ 7 ══════════════════════════════════════════════════════════════════════
seccion('7 · El PDF de verdad');
const WINANSI = new Set([...Array.from({ length: 95 }, (_, i) => 32 + i), ...Array.from({ length: 96 }, (_, i) => 160 + i),
  ...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.split('').map((c) => c.codePointAt(0))]);

const renderizar = async (rep) => {
  trazos = []; saltosPdfkit = 0;
  const doc = generarPdfReporteEmpleado({ reporte: rep, config: { nombre_negocio: 'Celulares Centro', nit: '900' } });
  const partes = [];
  await new Promise((res, rej) => {
    doc.pipe(new Writable({ write(c, _e, cb) { partes.push(c); cb(); } })).on('finish', res).on('error', rej);
  });
  const salida = trazos;
  trazos = null;
  return { buf: Buffer.concat(partes), trazos: salida, paginas: Math.max(...salida.map((t) => t.n)) + 1 };
};

const pdf1 = await renderizar(await reporte());
// Para mirarlo: GUARDAR_PDF=carpeta node 68-reporte-empleado.mjs
if (process.env.GUARDAR_PDF) writeFileSync(path.join(process.env.GUARDAR_PDF, 'reporte-ana.pdf'), pdf1.buf);
const texto1 = pdf1.trazos.map((t) => t.t).join(' ');
ok('es un PDF', pdf1.buf.subarray(0, 5).toString() === '%PDF-');
ok('dice el empleado y el período', texto1.includes('Ana Torres') && texto1.includes('01/09/2026 – 30/09/2026'));
for (const t of ['Ventas de contado', 'Ventas a crédito', 'Préstamos a clientes', 'Préstamos a compañeros']) {
  ok(`trae la sección «${t}»`, texto1.includes(t));
}
for (const t of ['VENDIDOS', 'DEVUELTOS', 'CON DEVOLUCIÓN PARCIAL', 'CANCELADOS', 'PENDIENTES DE PAGO', 'PAGADOS']) {
  ok(`trae el grupo «${t}»`, texto1.includes(t));
}
ok('pinta los IMEI', texto1.includes('IMEI 111') && texto1.includes('IMEI 1003'));
ok('dice que no liquida nada', texto1.includes('no calcula comisiones'));
ok('ningún salto lo decidió PDFKit', saltosPdfkit === 0, `saltos=${saltosPdfkit}`);
const fueraDeWinAnsi = [...new Set([...texto1].filter((c) => !WINANSI.has(c.codePointAt(0))))];
ok('todo carácter impreso está en WinAnsi', fueraDeWinAnsi.length === 0, fueraDeWinAnsi.join(''));
const enElPie = pdf1.trazos.filter((t) => t.y > base.BODY_BOTTOM && t.y < base.PAGE_H - 44);
ok('nada invade la franja del pie', enElPie.length === 0, enElPie.map((t) => t.t).join('|'));

// 300 préstamos: tiene que partirse en hojas llenas, no en una por fila.
await db.exec(`
  SELECT setval('prestamos_id_seq', (SELECT MAX(id) FROM prestamos));
  INSERT INTO prestamos (sucursal_id, usuario_id, numero, prestatario, cedula, imei, nombre_producto,
                         cantidad_prestada, valor_prestamo, total_abonado, estado, cliente_id, fecha)
  SELECT 1, 2, 1000 + g, 'Cliente con un nombre bastante largo número ' || g, '99' || g,
         '35' || LPAD(g::text, 13, '0'), 'Equipo de gama media con nombre muy largo modelo ' || g,
         1, 850000, (g % 3) * 100000, CASE WHEN g % 4 = 0 THEN 'Saldado' WHEN g % 7 = 0 THEN 'Devuelto' ELSE 'Activo' END,
         1, '2026-09-15 10:00'::timestamp + (g || ' minutes')::interval
    FROM generate_series(1, 300) g;
`);
const grande = await renderizar(await reporte({ usuarioId: 2 }));
if (process.env.GUARDAR_PDF) writeFileSync(path.join(process.env.GUARDAR_PDF, 'reporte-luis-300.pdf'), grande.buf);
ok('300 filas: sin saltos de PDFKit', saltosPdfkit === 0);
ok('300 filas caben en hojas llenas (menos de 25)', grande.paginas < 25 && grande.paginas > 5, `${grande.paginas} páginas`);
const cabeceras = grande.trazos.filter((t) => t.t === 'PRODUCTO').map((t) => t.n);
ok('la cabecera de la tabla se repite en cada hoja con filas', new Set(cabeceras).size >= grande.paginas - 1,
  `${new Set(cabeceras).size} de ${grande.paginas}`);
const cont = grande.trazos.filter((t) => t.y < 30 && t.t.includes('Luis Pérez')).map((t) => t.n);
ok('las hojas de continuación dicen de quién son', new Set(cont).size === grande.paginas - 1,
  `${new Set(cont).size} de ${grande.paginas - 1}`);
ok('nada invade la franja del pie (300 filas)',
  !grande.trazos.some((t) => t.y > base.BODY_BOTTOM && t.y < base.PAGE_H - 44));

const todos = await renderizar(await reporte({ usuarioId: null }));
const inicioAna  = todos.trazos.find((t) => t.t === 'Ana Torres')?.n;
const inicioLuis = todos.trazos.find((t) => t.t === 'Luis Pérez' && t.y > 100)?.n;
ok('con «todos», cada empleado empieza en su propia hoja', inicioAna === 0 && inicioLuis > inicioAna, `${inicioAna} / ${inicioLuis}`);
ok('la hoja de Luis abre con el encabezado completo, no con la franja',
  !todos.trazos.some((t) => t.n === inicioLuis && t.y < 30 && t.t.includes('Luis Pérez')));

const vacio = await renderizar(await svc.obtenerReporte({ negocioId: 1, sucursalId: 1, usuario: ADMIN, usuarioId: null, desde: '2026-01-01', hasta: '2026-01-31' }));
ok('sin nada en el período: una hoja que lo dice',
  vacio.paginas === 1 && vacio.trazos.some((t) => t.t.includes('No hay ventas')));

// ═══ 8 ══════════════════════════════════════════════════════════════════════
seccion('8 · La pantalla pide lo que el backend entiende');
const api = leer(FRONT, 'api/prestamos.api.js');
const modal = leer(FRONT, 'pages/prestamos/ModalReporteEmpleado.jsx');
const pagina = leer(FRONT, 'pages/prestamos/PrestamosPage.jsx');
const rutas = leer(RAIZ, 'src/modules/prestamos/prestamos.routes.js');
ok('la API pide las dos rutas', api.includes('/prestamos/reporte-empleado/empleados') && api.includes('/prestamos/reporte-empleado/pdf'));
ok('manda los parámetros que lee el controlador',
  ['usuario_id', 'desde', 'hasta', 'solo_equipos'].every((p) => api.includes(p) || modal.includes(p)));
ok('las rutas van ANTES de /:id/pdf',
  rutas.indexOf("router.get('/reporte-empleado/pdf'") > 0
  && rutas.indexOf("router.get('/reporte-empleado/pdf'") < rutas.indexOf("router.get('/:id/pdf'"));
ok('la página muestra el botón', pagina.includes('ModalReporteEmpleado') && pagina.includes('Reporte por empleado'));
ok('el modal lee el error del blob en vez de un genérico', modal.includes('.text()'));

// ═══ 9 ══════════════════════════════════════════════════════════════════════
// Cellsite (29-sep-2026): «no me sale nada de productos». El modal arrancaba
// en el propio admin —que no vende— y los admins salen en la lista de TODAS
// las sedes: LAURA tenía 1.070 préstamos en Centro y desde Principal su PDF
// salía en blanco. Ahora la lista dice cuántas filas tendría cada PDF.
seccion('9 · La lista dice cuántas filas trae cada PDF');
await db.exec(`
  INSERT INTO usuarios (id, nombre, rol, negocio_id, sucursal_id, activo) VALUES
    (6, 'Beto ', 'vendedor', 1, 1, TRUE);
  SELECT setval('facturas_id_seq', (SELECT MAX(id) FROM facturas));
  INSERT INTO facturas (id, numero, sucursal_id, usuario_id, nombre_cliente, cedula, estado, fecha) VALUES
    (50, 150, 1, 4, 'Cliente de Sofía', '7', 'Activa', '2026-09-14 10:00');
  INSERT INTO lineas_factura (factura_id, nombre_producto, imei, cantidad, precio, cantidad_devuelta) VALUES
    (50, 'Honor X8', '5050', 1, 900000, 0);
  SELECT setval('prestamos_id_seq', (SELECT MAX(id) FROM prestamos));
  INSERT INTO prestamos (sucursal_id, usuario_id, numero, prestatario, cedula, imei, nombre_producto,
                         cantidad_prestada, valor_prestamo, total_abonado, estado, prestatario_id, fecha)
  VALUES (1, 6, 9001, 'Tienda Sur', 'COMPANERO', '6060', 'Moto G', 1, 500000, 0, 'Activo', 1, '2026-09-16 10:00');
`);

const sinFechas = await svc.listarEmpleados({ negocioId: 1, sucursalId: 1, usuario: ADMIN });
ok('sin fechas responde como siempre (un frontend viejo no cambia)',
  sinFechas.empleados.every((e) => e.movimientos === undefined) && sinFechas.sedes === undefined);

for (const solo of [false, true]) {
  const lista = await svc.listarEmpleados({ negocioId: 1, sucursalId: 1, usuario: ADMIN, ...SEP, soloEquipos: solo });
  const real = await reporte({ usuarioId: null, soloEquipos: solo });
  const filasDe = new Map(real.empleados.map((e) => [e.usuario_id, e.total_filas]));
  const descuadres = lista.empleados.filter((e) => e.movimientos !== (filasDe.get(e.id) || 0))
    .map((e) => `${e.nombre}: lista ${e.movimientos} / PDF ${filasDe.get(e.id) || 0}`);
  ok(`cada empleado: el número de la lista = las filas de su PDF (solo equipos: ${solo})`,
    descuadres.length === 0, descuadres.join('; '));
  ok(`«Todos»: total_sede = filas del PDF (solo equipos: ${solo})`,
    lista.total_sede === real.empleados.reduce((s, e) => s + e.total_filas, 0),
    `${lista.total_sede}`);
}

const l9 = await svc.listarEmpleados({ negocioId: 1, sucursalId: 1, usuario: ADMIN, ...SEP, soloEquipos: true });
const de9 = (id) => l9.empleados.find((e) => e.id === id);
ok('el admin sin ventas propias sale con 0 (el modal ya no arranca en él)', de9(3)?.movimientos === 0);
ok('quien movió algo en la sede sale aunque hoy esté asignado a otra', de9(4)?.movimientos === 1, JSON.stringify(de9(4)));
ok('Ana: dice cuántas se quedan fuera por «Solo equipos»',
  de9(1)?.sin_imei === (await reporte({ soloEquipos: false })).empleados[0].total_filas
    - (await reporte({ soloEquipos: true })).empleados[0].total_filas && de9(1).sin_imei > 0,
  String(de9(1)?.sin_imei));
ok('al admin le dice lo que el empleado tiene en OTRA sede',
  JSON.stringify(de9(1)?.otras_sedes) === JSON.stringify([{ sucursal_id: 2, nombre: 'Norte', movimientos: 1 }]),
  JSON.stringify(de9(1)?.otras_sedes));
ok('el admin recibe las sedes para elegir en el modal', l9.sedes.map((s) => s.id).join() === '1,2');
ok('los nombres salen sin espacios de más («Beto »)', de9(6)?.nombre === 'Beto');
ok('ni un empleado de otro negocio', !l9.empleados.some((e) => e.id === 9));

const SUP = { id: 2, nombre: 'Luis Pérez', rol: 'supervisor' };
const lsup = await svc.listarEmpleados({ negocioId: 1, sucursalId: 1, usuario: SUP, ...SEP, soloEquipos: true });
ok('un supervisor no ve otras sedes ni puede cambiar de sede',
  lsup.sedes.length === 0 && lsup.empleados.every((e) => e.otras_sedes.length === 0));
const lven = await svc.listarEmpleados({ negocioId: 1, sucursalId: 1, usuario: ANA, ...SEP, soloEquipos: false });
ok('el vendedor sigue viéndose solo a sí mismo, con su número',
  lven.empleados.length === 1 && lven.empleados[0].id === 1 && lven.empleados[0].movimientos > 0 && !lven.puede_elegir);

// El PDF de alguien sin nada en la sede dice por qué y dónde sí tiene.
const rLuisNorte = await svc.obtenerReporte({ negocioId: 1, sucursalId: 2, usuario: ADMIN, usuarioId: 2, ...SEP, soloEquipos: false });
ok('el reporte vacío trae dónde sí tiene movimientos',
  rLuisNorte.empleados[0].otras_sedes?.[0]?.nombre === 'Centro' && rLuisNorte.empleados[0].otras_sedes[0].movimientos > 0);
const pdfVacio = await renderizar(rLuisNorte);
const txtVacio = pdfVacio.trazos.map((t) => t.t).join(' ');
if (process.env.GUARDAR_PDF) writeFileSync(path.join(process.env.GUARDAR_PDF, 'reporte-vacio.pdf'), pdfVacio.buf);
ok('el PDF vacío explica por qué (empleado y sede)',
  txtVacio.includes('No hay ventas, créditos ni préstamos registrados por Luis Pérez') && txtVacio.includes('Norte'));
ok('y dice en qué sede sí tiene', txtVacio.includes('Sí tiene movimientos en: Centro'));
ok('el aviso no provoca saltos de PDFKit ni sale de WinAnsi',
  saltosPdfkit === 0 && [...txtVacio].every((c) => WINANSI.has(c.codePointAt(0))));
const conDatos = await renderizar(await reporte());
ok('un PDF con filas NO lleva el aviso', !conDatos.trazos.some((t) => t.t.includes('No hay ventas, créditos')));

const modal9 = leer(FRONT, 'pages/prestamos/ModalReporteEmpleado.jsx');
const api9 = leer(FRONT, 'api/prestamos.api.js');
ok('la pantalla pide la lista CON el rango y la sede',
  /getEmpleadosReporte\(\{\s*desde: rango\.desde, hasta: rango\.hasta, solo_equipos: soloEquipos, sucursal_id: sede/.test(modal9)
  && api9.includes("'/prestamos/reporte-empleado/empleados', {"));
ok('el PDF sale de la MISMA sede que se contó', /sucursal_id: sede,\s*\}\);/.test(modal9));
ok('no arranca en uno mismo si no tiene movimientos', modal9.includes('yo.movimientos > 0'));
ok('avisa antes de descargar y ofrece la salida', modal9.includes('otras_sedes') && modal9.includes('setSoloEquipos(false)'));

console.log(`\n${pasados} verificaciones pasaron · ${fallos.length} fallaron`);
if (fallos.length) { console.log(fallos.map((f) => `  ✗ ${f}`).join('\n')); process.exit(1); }
