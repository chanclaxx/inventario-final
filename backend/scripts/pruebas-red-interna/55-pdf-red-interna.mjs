// ─────────────────────────────────────────────────────────────────────────────
// PDF DE LA RED INTERNA — los tres documentos, contra un Postgres real (PGlite)
// y leyendo el TEXTO que de verdad se pinta en el PDF (PDFKit instrumentado,
// como en 43-pdf-factura).
//
//   · Sección 1 — el envío: productos, IMEI, cargo, abonos, saldo y firmas; el
//                 PDF dice las MISMAS cifras que la pantalla (getRemision).
//   · Sección 2 — quién ve valores: el vendedor NO ve el valor de cada línea
//                 (salvo que el negocio lo encienda), pero SÍ su cuenta; y
//                 nadie del local ve el costo de la BODEGA, ni en el PDF ni en
//                 el JSON del detalle (esa fuga existía).
//   · Sección 3 — abonos ajenos: el detalle del envío sumaba los abonos de un
//                 CARGO cuyo id coincidía con el del envío (OR cargo_id).
//   · Sección 4 — la devolución: el vendedor ve lo acreditado (no $0).
//   · Sección 5 — envíos activos: el total es el de la pantalla.
//   · Sección 6 — estado de cuenta: el saldo final = totales.neto, lo
//                 informativo no mueve el saldo, y sale TODO el historial.
//   · Sección 7 — acceso: un local no imprime lo de otro.
//   · Sección 8 — un envío de 70 líneas: ningún salto lo decide PDFKit.
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
for (const m of ['20260725_red_interna', '20260726_red_interna_v2', '20260822_red_interna_envios',
  '20260823_red_interna_control', '20260823_red_interna_cargos_pagables', '20260823_remision_variantes',
  '20260823_lotes_cantidad', '20260824_costo_origen_remision', '20260823_valor_acreditado']) {
  await db.exec(readFileSync(path.join(RAIZ, `../migrations/${m}.sql`), 'utf8'));
}

const conectar = (t) => ({ query: (s, p) => t.query(s, p ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

// ── Instrumentación de PDFKit (antes de cargar los generadores) ─────────────
const PDFDocument = require(path.join(RAIZ, 'node_modules/pdfkit'));
const proto = PDFDocument.prototype;
let traza = null;
const origFragment = proto._fragment;
proto._fragment = function (texto, ...rest) {
  if (traza) traza.textos.push(String(texto ?? ''));
  return origFragment.call(this, texto, ...rest);
};
const origAddPage = proto.addPage;
proto.addPage = function (...a) {
  if (traza) traza.paginas += 1;
  return origAddPage.apply(this, a);
};
const origContinuar = proto.continueOnNewPage;
proto.continueOnNewPage = function (...a) {
  if (traza) traza.automaticos += 1;
  return origContinuar.apply(this, a);
};

const service = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));
const repo    = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.repository.js'));
const pdf     = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.pdf.js'));

// Helvetica (fuente estándar de PDFKit) solo tiene los caracteres de WinAnsi.
// Uno de fuera (el menos U+2212, una flecha) se imprime como COMILLAS — el texto
// del PDF dice «−$» y la hoja impresa «"$». Se descubrió renderizando el PDF;
// esta verificación es la que lo habría atrapado.
const EXTRA_WINANSI = new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ']);
const esWinAnsi = (ch) => {
  const c = ch.codePointAt(0);
  return (c >= 0x20 && c <= 0x7E) || (c >= 0xA0 && c <= 0xFF) || EXTRA_WINANSI.has(ch) || ch === String.fromCharCode(10);
};
const fueraDeWinAnsi = new Set();

/** Genera el PDF, espera a que termine y devuelve su texto, páginas y bytes. */
const leer = async (generar) => {
  // El constructor (autoFirstPage) también pasa por addPage, así que la
  // primera hoja ya queda contada: se arranca en 0.
  traza = { textos: [], automaticos: 0, paginas: 0 };
  const salida = await generar();
  const doc = salida.doc || salida;
  const trozos = [];
  doc.on('data', (c) => trozos.push(c));
  await new Promise((ok) => doc.on('end', ok));
  const r = {
    texto: traza.textos.join(' | '),
    paginas: traza.paginas,
    automaticos: traza.automaticos,
    bytes: Buffer.concat(trozos),
  };
  for (const ch of r.texto) if (!esWinAnsi(ch)) fueraDeWinAnsi.add(ch);
  traza = null;
  return r;
};

let pasados = 0; const fallos = [];
const money = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP',
  minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(n || 0));
const ok = (nombre, cond, detalle = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos.push(nombre);
};
const falla = async (nombre, fn, patron) => {
  try { await fn(); ok(nombre, false, 'no falló'); }
  catch (e) { ok(nombre, !patron || patron.test(`${e.message || ''} ${e.status || ''}`), e.message); }
};
const seccion = (t) => console.log(`\n═══ ${t} ═══`);

// ── Escenario ───────────────────────────────────────────────────────────────
// Bodega (1) surte a Centro (2) y a Norte (3). El valor del envío (lo que el
// local debe) es DISTINTO del costo de la bodega, para poder distinguirlos.
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Tesla');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Bodega'),(1,'Centro'),(1,'Norte');
  INSERT INTO usuarios (nombre) VALUES ('Admin'),('Supervisor Centro'),('Vendedor Centro'),('Supervisor Norte');
  INSERT INTO config_negocio VALUES (1,'red_interna_activa','1'),(1,'red_interna_bodega_id','1'),
                                    (1,'nombre_negocio','Tesla Celulares');
  INSERT INTO lineas_producto (negocio_id, nombre) VALUES (1,'Celulares'),(1,'Accesorios');
  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id, linea_id)
    VALUES ('iPhone 13','Apple','128GB', 2600000, 1, 1);
  INSERT INTO seriales (producto_id, imei, costo_compra) VALUES
    (1,'IMEI-111', 1000000), (1,'IMEI-222', 1000000), (1,'IMEI-333', 1000000), (1,'IMEI-444', 1000000);
  INSERT INTO productos_cantidad (nombre, codigo, precio, costo_unitario, stock, sucursal_id, linea_id)
    VALUES ('Cargador 20W','CARG20', 60000, 30000, 50, 1, 2);
  INSERT INTO cuentas_dinero (negocio_id, sucursal_id, nombre, tipo, metodos_pago)
    VALUES (1,1,'Efectivo','efectivo',ARRAY['Efectivo']), (1,2,'Efectivo','efectivo',ARRAY['Efectivo']),
           (1,3,'Efectivo','efectivo',ARRAY['Efectivo']);
  INSERT INTO aperturas_caja (sucursal_id) VALUES (1),(2),(3);
`);

const red = (extra = {}) => ({ activa: true, bodega_id: 1, confirmar_recepcion: true,
  confirmar_remesa: true, ocultar_costos: true, ...extra });
const bodega = { user: { id: 1, negocio_id: 1, rol: 'admin_negocio' }, sucursal_id: 1, esBodega: true, red: red() };
const centro = { user: { id: 2, negocio_id: 1, rol: 'supervisor' }, sucursal_id: 2, esBodega: false, red: red() };
const vende  = { user: { id: 3, negocio_id: 1, rol: 'vendedor' },   sucursal_id: 2, esBodega: false, red: red() };
const norte  = { user: { id: 4, negocio_id: 1, rol: 'supervisor' }, sucursal_id: 3, esBodega: false, red: red() };

const recibirTodo = async (remisionId, req = centro) => {
  const lineas = await repo.getLineasRemision(remisionId);
  return service.recibir(req, remisionId, {
    lineas_recibidas: lineas.map((l) => Number(l.id)),
    cantidades: Object.fromEntries(lineas.filter((l) => l.tipo === 'cantidad').map((l) => [l.id, l.cantidad])),
  });
};

// Envío 1 a Centro: 3 iPhone a $1.300.000 + 4 cargadores a $45.000.
const e1 = await service.despachar(bodega, {
  sucursal_destino_id: 2,
  lineas: [
    { tipo: 'serial', serial_id: 1, valor_interno: 1300000 },
    { tipo: 'serial', serial_id: 2, valor_interno: 1300000 },
    { tipo: 'serial', serial_id: 3, valor_interno: 1300000 },
    { tipo: 'cantidad', producto_id: 1, cantidad: 4, valor_interno: 45000 },
  ],
  notas: 'Surtido de septiembre',
});
await recibirTodo(e1.id);
const CARGO_E1 = 3 * 1300000 + 4 * 45000;
// Un abono de $1.000.000 dirigido al envío 1.
const rem = await service.enviarRemesa(centro, { valor: 1000000, remision_id: e1.id });
await service.confirmarRemesa(bodega, rem.id);

// ═════════════════════════════════════════════════════════════════════════════
seccion('1. El PDF de un envío');
{
  const det = await service.getRemision(bodega, e1.id);
  const p = await leer(() => pdf.generarPdfEnvio(bodega, e1.id));
  ok('sale un PDF de verdad', p.bytes.slice(0, 5).toString() === '%PDF-' && p.bytes.length > 2000, `${p.bytes.length} bytes`);
  ok('título y número del envío', p.texto.includes('ENVÍO DE MERCANCÍA') && p.texto.includes(`#${det.numero ?? det.id}`));
  ok('de dónde sale y a dónde llega', p.texto.includes('Bodega') && p.texto.includes('Centro'));
  ok('cada producto con su IMEI', ['IMEI-111', 'IMEI-222', 'IMEI-333'].every((i) => p.texto.includes(i)));
  ok('los cargadores con su cantidad', p.texto.includes('Cargador 20W'));
  ok('el cargo es el de la pantalla', det.resumen.cargo === CARGO_E1 && p.texto.includes(money(CARGO_E1)), money(det.resumen.cargo));
  ok('el abono aparece', p.texto.includes(`- ${money(1000000)}`));
  ok('el saldo es el de la pantalla', p.texto.includes(money(CARGO_E1 - 1000000)) && det.resumen.saldo === CARGO_E1 - 1000000);
  ok('firmas de entrega y recibido', p.texto.includes('Entregó') && p.texto.includes('Recibió'));
  ok('dice que no es factura de venta', p.texto.includes('no es factura de venta'));
  ok('ningún salto de página lo decidió PDFKit', p.automaticos === 0);
  ok('un envío de 4 productos cabe en UNA hoja', p.paginas === 1, `${p.paginas} página(s)`);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('2. Quién ve qué valores');
{
  const pBodega = await leer(() => pdf.generarPdfEnvio(bodega, e1.id));
  const pVende  = await leer(() => pdf.generarPdfEnvio(vende, e1.id));
  ok('la bodega ve el valor de cada línea', pBodega.texto.includes(money(1300000)));
  ok('el vendedor NO ve el valor de cada línea (regla por defecto)', !pVende.texto.includes(money(1300000)));
  ok('  pero SÍ su cuenta: cargo y saldo', pVende.texto.includes(money(CARGO_E1)) && pVende.texto.includes(money(CARGO_E1 - 1000000)));
  ok('  y los productos con su IMEI', pVende.texto.includes('IMEI-111'));

  // La opción de Ajustes (red_interna_ocultar_costos = '0'): el vendedor ve
  // el valor del envío. Es lo que el local debe, no el costo de la bodega.
  const vendeVe = { ...vende, red: red({ ocultar_costos: false }) };
  const pVe = await leer(() => pdf.generarPdfEnvio(vendeVe, e1.id));
  ok('con la opción encendida, el vendedor ve el valor de cada línea', pVe.texto.includes(money(1300000)));

  // El costo de la BODEGA ($1.000.000 por iPhone) no lo ve nadie del local.
  for (const [quien, req] of [['supervisor', centro], ['vendedor', vende], ['vendedor con la opción', vendeVe]]) {
    const det = await service.getRemision(req, e1.id);
    const serial = det.lineas.find((l) => l.imei === 'IMEI-111');
    ok(`JSON del detalle, ${quien} del local: sin el costo de la bodega`, serial.costo_origen == null);
  }
  const detAdmin = await service.getRemision(bodega, e1.id);
  ok('el admin sí ve el costo de la bodega', Number(detAdmin.lineas.find((l) => l.imei === 'IMEI-111').costo_origen) === 1000000);
  const pSup = await leer(() => pdf.generarPdfEnvio(centro, e1.id));
  ok('ningún PDF del local muestra el costo de la bodega',
    ![pVende, pVe, pSup].some((x) => x.texto.includes(money(1000000)) && x.texto.includes('costo')));
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('3. Abonos de otro documento no se cuelan en el envío');
{
  // Un cargo con el MISMO id que el envío 1, con un abono de $777.000.
  await db.query(`INSERT INTO movimientos_cuenta_interna (id, negocio_id, sucursal_id, tipo, valor, concepto)
                  VALUES ($1, 1, 2, 'Ajuste', -900000, 'Pantalla rota')`, [e1.id]);
  await db.query(`INSERT INTO abonos_remision (negocio_id, sucursal_id, remision_id, cargo_id, movimiento_id, origen, valor)
                  VALUES (1, 2, NULL, $1, $1, 'ajuste', 777000)`, [e1.id]);
  const det = await service.getRemision(bodega, e1.id);
  ok('el detalle del envío no trae el abono del cargo', !det.abonos.some((a) => Number(a.valor) === 777000));
  ok('  y su saldo sigue siendo el real', det.resumen.saldo === CARGO_E1 - 1000000, money(det.resumen.saldo));
  await db.query('DELETE FROM abonos_remision WHERE cargo_id = $1', [e1.id]);
  await db.query('DELETE FROM movimientos_cuenta_interna WHERE id = $1', [e1.id]);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('4. La devolución');
{
  const dev = await service.devolver(centro, { lineas: [{ tipo: 'serial', serial_id: 3 }] });
  const pPend = await leer(() => pdf.generarPdfEnvio(vende, dev.id));
  ok('pendiente: título de devolución', pPend.texto.includes('DEVOLUCIÓN A BODEGA'));
  ok('pendiente: dice que la bodega aún no la revisa', pPend.texto.includes('todavía no ha revisado'));
  await service.confirmarDevolucion(bodega, dev.id, {});
  const det = await service.getRemision(vende, dev.id);
  ok('el detalle trae lo acreditado aunque el vendedor no vea valores', det.resumen.acreditado === 1300000, money(det.resumen.acreditado));
  const p = await leer(() => pdf.generarPdfEnvio(vende, dev.id));
  ok('su PDF dice lo acreditado, no $0', p.texto.includes(money(1300000)));
  ok('  y el IMEI devuelto', p.texto.includes('IMEI-333'));
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('5. Envíos pendientes de un local');
{
  // Un segundo envío, recibido y sin abonos; y uno en camino.
  const e2 = await service.despachar(bodega, { sucursal_destino_id: 2,
    lineas: [{ tipo: 'cantidad', producto_id: 1, cantidad: 6, valor_interno: 45000 }] });
  await recibirTodo(e2.id);
  const e3 = await service.despachar(bodega, { sucursal_destino_id: 2,
    lineas: [{ tipo: 'serial', serial_id: 4, valor_interno: 1300000 }] });
  const cuenta = await service.getEstadoCuenta(centro, 2);
  const p = await leer(() => pdf.generarPdfEnviosActivos(centro, 2));
  ok('los dos envíos con saldo', p.texto.includes(`Envío #${e1.numero ?? e1.id}`) && p.texto.includes(`Envío #${e2.numero ?? e2.id}`));
  ok('el total que debe = el de la pantalla', p.texto.includes(money(cuenta.totales.deuda_total)), money(cuenta.totales.deuda_total));
  ok('lo que va en camino, aparte y sin deuda', p.texto.includes(`Envío #${e3.numero ?? e3.id} · despachado`));
  ok('ningún salto lo decidió PDFKit', p.automaticos === 0, `${p.paginas} página(s)`);
  const pV = await leer(() => pdf.generarPdfEnviosActivos(vende, 2));
  ok('el vendedor: la deuda sí, el valor de cada línea no',
    pV.texto.includes(money(cuenta.totales.deuda_total)) && !pV.texto.includes(money(1300000)));
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('6. Estado de cuenta de un local');
{
  const cuenta = await service.getEstadoCuenta(centro, 2);
  const extracto = await repo.getExtracto(1, 2, { limit: 20000 });
  const movs = pdf.movimientosDeExtracto(extracto);
  const conSaldo = movs.filter((m) => m.saldo != null);
  ok('el saldo final = totales.neto de la pantalla',
    Math.round(conSaldo[conSaldo.length - 1].saldo) === Math.round(cuenta.totales.neto),
    `${money(conSaldo[conSaldo.length - 1].saldo)} vs ${money(cuenta.totales.neto)}`);
  ok('va del más viejo al más nuevo', movs.every((m, i) => i === 0 || new Date(m.fecha) >= new Date(movs[i - 1].fecha)));
  ok('cargos + abonos cuadran con el saldo final',
    Math.round(movs.reduce((s, m) => s + (m.cargo || 0) - (m.abono || 0), 0)) === Math.round(cuenta.totales.neto));
  const p = await leer(() => pdf.generarPdfEstadoCuentaLocal(centro, 2));
  ok('sale el PDF con el nombre del local', p.texto.includes('Centro'));
  ok('con el envío y el pago', p.texto.includes('Envío recibido') && p.texto.includes('Remesa recibida'));
  // El PDF lleva TODO el historial, no el tope de 300 filas de la pantalla.
  ok('pide el extracto sin el tope de la pantalla',
    readFileSync(path.join(RAIZ, 'src/modules/red-interna/redInterna.pdf.js'), 'utf8').includes('limit: 20000'));
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('7. Un local no imprime lo de otro');
await falla('Norte no imprime un envío de Centro', () => pdf.generarPdfEnvio(norte, e1.id), /no es de tu sucursal|403/);
await falla('Norte no imprime el estado de cuenta de Centro', () => pdf.generarPdfEstadoCuentaLocal(norte, 2), /tu sucursal|403/);
await falla('Norte no imprime los envíos pendientes de Centro', () => pdf.generarPdfEnviosActivos(norte, 2), /tu sucursal|403/);
{
  const p = await leer(() => pdf.generarPdfEstadoCuentaLocal(bodega, 2));
  ok('la bodega sí imprime la cuenta de cualquier local', p.texto.includes('Centro'));
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('8. Un envío grande no se desarma');
{
  const valores = Array.from({ length: 70 }, (_, i) =>
    `('Accesorio con un nombre bastante largo número ${i + 1} para probar el corte', 'ACC${i}', 20000, 10000, 20, 1, 2)`).join(',');
  await db.exec(`INSERT INTO productos_cantidad (nombre, codigo, precio, costo_unitario, stock, sucursal_id, linea_id) VALUES ${valores}`);
  const { rows } = await db.query(`SELECT id FROM productos_cantidad WHERE codigo LIKE 'ACC%' ORDER BY id`);
  const grande = await service.despachar(bodega, { sucursal_destino_id: 2,
    lineas: rows.map((r) => ({ tipo: 'cantidad', producto_id: r.id, cantidad: 2, valor_interno: 15000 })) });
  const p = await leer(() => pdf.generarPdfEnvio(bodega, grande.id));
  ok('70 líneas: ningún salto lo decidió PDFKit', p.automaticos === 0);
  ok('  y ocupa pocas páginas, no decenas', p.paginas >= 2 && p.paginas <= 5, `${p.paginas} páginas`);
  ok('  con todas las líneas', p.texto.includes('número 70'));
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('9. Todo lo impreso existe en la fuente');
{
  // El estado de cuenta compartido (préstamos y créditos) tenía el mismo
  // defecto en el encabezado de la columna de abonos: se corrigió de paso.
  const { construirPdfEstadoCuenta } = require(path.join(RAIZ, 'src/utils/estadoCuenta.pdf.js'));
  await leer(() => construirPdfEstadoCuenta({
    persona: { nombre: 'Cliente' }, subtitulo: 'Prueba', saldoFinal: 1000,
    movimientos: [{ fecha: new Date(), tipo: 'x', concepto: 'Cargo', cargo: 1000, abono: null, saldo: 1000 }],
    config: {}, tipoLabels: { x: { label: 'X', bg: '#fff', text: '#000' } }, negocioNombre: 'N',
  }));
  ok('ningún PDF pinta caracteres que Helvetica no tiene', fueraDeWinAnsi.size === 0,
    fueraDeWinAnsi.size ? `fuera de WinAnsi: ${[...fueraDeWinAnsi].map((c) => `U+${c.codePointAt(0).toString(16)}`).join(' ')}` : '');
  const acre = readFileSync(path.join(RAIZ, 'src/modules/acreedores/acreedores.pdf.js'), 'utf8');
  ok('el estado de cuenta de acreedores tampoco usa el menos tipográfico', !acre.includes("label: '−'"));
}

// ── Resultado ───────────────────────────────────────────────────────────────
console.log(`\n${pasados} verificaciones pasaron, ${fallos.length} fallaron`);
if (fallos.length) { fallos.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
process.exit(0);
