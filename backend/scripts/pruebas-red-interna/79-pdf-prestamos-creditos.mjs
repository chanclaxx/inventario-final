// ─────────────────────────────────────────────────────────────────────────────
// PDF DE PRÉSTAMOS Y CRÉDITOS — hora, variante, detalle y CERO páginas en blanco
// (pedido del usuario, 10-oct-2026)
//
// «Cuando descargo un PDF de préstamos o créditos quiero que salga la hora y el
// detalle de absolutamente todo, la variante del producto si está activa, y se
// descargan páginas en blanco.»
//
// Las páginas en blanco eran del PDF «Préstamos activos»: escribía el pie
// («Página 1 de 1») en y = 825 con margen inferior de 52, el texto caía bajo el
// borde útil y PDFKit abría UNA HOJA NUEVA POR CADA PIE (2 préstamos → 3 hojas).
// El estado de cuenta (préstamos y créditos) tenía la versión silenciosa del
// mismo defecto: `margin: 0` y un resumen final que no medía si cabía.
//
// Esta suite corre las consultas REALES contra PGlite y renderiza los seis
// documentos de verdad, instrumentando PDFKit:
//
//   · Sección 1 — ninguna hoja vacía y ningún salto decidido por PDFKit, en los
//                 seis documentos y con 1, 3 y 25 préstamos. ★ La que protege
//                 del reporte original.
//   · Sección 2 — la HORA: de la operación, de cada abono, de la cuota inicial
//                 y de la mora cobrada.
//   · Sección 3 — la VARIANTE: por etiqueta congelada, por id (préstamos
//                 viejos), sin repetirla cuando la factura ya la trae en el
//                 nombre, y nada de «()» cuando no hay.
//   · Sección 4 — el DETALLE: IMEI, color, quién registró, método, pago total
//                 y su reparto, cantidades y lo devuelto.
//   · Sección 5 — todo lo impreso existe en Helvetica (WinAnsi).
//   · Sección 6 — el navegador no revoca el enlace del PDF en la misma línea
//                 del clic (en iPhone eso abre una página en blanco). Estática.
//
//   node scripts/pruebas-red-interna/79-pdf-prestamos-creditos.mjs
// Requiere PGlite (npm install --no-save @electric-sql/pglite).
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

// Igual que config/db.js: los TIMESTAMP están en hora Bogotá.
const db = new PGlite({ parsers: {
  1114: (v) => (v ? new Date(`${v.replace(' ', 'T')}-05:00`) : null),
  1082: (v) => v,
} });
await db.exec(leer(AQUI, 'esquema.sql'));
await db.exec(leer(AQUI, 'esquema-completo.sql'));
await db.exec(`
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS saldo_a_favor NUMERIC DEFAULT 0;
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS telefono TEXT;
  ALTER TABLE prestamos ADD COLUMN IF NOT EXISTS atributo_label TEXT;
  ALTER TABLE prestamos ADD COLUMN IF NOT EXISTS variante_label TEXT;
  ALTER TABLE abonos_totales ADD COLUMN IF NOT EXISTS usuario_id INT;
  ALTER TABLE abonos_totales ADD COLUMN IF NOT EXISTS destino TEXT;
  ALTER TABLE garantias ADD COLUMN IF NOT EXISTS titulo TEXT;
  ALTER TABLE garantias ADD COLUMN IF NOT EXISTS texto TEXT;
  CREATE TABLE IF NOT EXISTS auditoria (
    id SERIAL PRIMARY KEY, negocio_id INT, usuario_id INT, fecha TIMESTAMP DEFAULT NOW(),
    accion VARCHAR, tabla VARCHAR, registro_id INT, detalle TEXT
  );
`);
await db.exec(leer(RAIZ, 'migrations/20260730_mora_credito.sql'));
await db.exec(leer(RAIZ, 'migrations/20260804_interes_corriente.sql'));
await db.exec(leer(RAIZ, 'migrations/20260825_abonos_anulados.sql'));
await db.exec(leer(RAIZ, 'migrations/20260825_pago_total_credito.sql'));

const conectar = (t) => ({
  query: async (text, params) => {
    const r = await t.query(text, params ?? []);
    return { ...r, rowCount: r.rowCount ?? r.affectedRows ?? (r.rows?.length ?? 0) };
  },
});
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

// ── Instrumentación de PDFKit ───────────────────────────────────────────────
const PDFDocument = require(path.join(RAIZ, 'node_modules/pdfkit'));
let trazos = null;
let saltosPdfkit = 0;
const origFragment = PDFDocument.prototype._fragment;
PDFDocument.prototype._fragment = function (t, x, y, o) {
  if (trazos) trazos.push({ t: String(t ?? ''), x, y, n: this._pageBuffer.indexOf(this.page) });
  return origFragment.call(this, t, x, y, o);
};
const origContinue = PDFDocument.prototype.continueOnNewPage;
PDFDocument.prototype.continueOnNewPage = function (...a) { saltosPdfkit += 1; return origContinue.apply(this, a); };

const base = require(path.join(RAIZ, 'src/utils/pdf.base.js'));
const pdfP = require(path.join(RAIZ, 'src/modules/prestamos/prestamos.pdf.service.js'));
const pdfC = require(path.join(RAIZ, 'src/modules/creditos/creditos.pdf.service.js'));

let pasados = 0; const fallos = [];
const ok = (nombre, cond, detalle = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos.push(nombre);
};
const seccion = (t) => console.log(`\n═══ ${t} ═══`);

/** Renderiza un PDF y devuelve sus trazos, páginas y saltos de PDFKit. */
const leerPdf = async (fn) => {
  trazos = []; saltosPdfkit = 0;
  const doc = await fn();
  await new Promise((res) => { doc.on('data', () => {}); doc.on('end', res); });
  const t = trazos; trazos = null;
  const nPaginas = Math.max(0, ...t.map((x) => x.n)) + 1;
  const texto = t.map((x) => x.t).join(' ').replace(/\s+/g, ' ');
  return { trazos: t, paginas: nPaginas, automaticos: saltosPdfkit, texto };
};

// Una hoja tiene CUERPO si algo se escribió entre el encabezado de
// continuación (62) y el pie (BODY_BOTTOM). Una hoja con solo el pie o solo el
// encabezado es exactamente la «página en blanco» del reporte.
const hojasSinCuerpo = (r) => {
  const vacias = [];
  for (let n = 0; n < r.paginas; n++) {
    const cuerpo = r.trazos.filter((x) => x.n === n && x.y >= 60 && x.y <= base.BODY_BOTTOM && x.t.trim());
    if (!cuerpo.length) vacias.push(n + 1);
  }
  return vacias;
};

// ── Escenario ───────────────────────────────────────────────────────────────
const sembrar = async (nPrestamos = 3) => {
  await db.exec(`
    TRUNCATE negocios, sucursales, usuarios, clientes, tipos_caracteristica, lineas_producto,
      productos_cantidad, atributos_producto, variantes_atributo, productos_serial, seriales,
      prestamos, abonos_prestamo, abonos_totales, facturas, lineas_factura, creditos, abonos_credito,
      movimientos_mora, garantias, garantias_lineas, vendedores RESTART IDENTITY CASCADE;
    INSERT INTO negocios (id, nombre) VALUES (1, 'Celulares Centro');
    INSERT INTO sucursales (id, negocio_id, nombre) VALUES (1, 1, 'Centro');
    INSERT INTO usuarios (id, nombre) VALUES (1, 'Ana Torres'), (2, 'Luis Caja');
    INSERT INTO config_negocio (negocio_id, clave, valor) VALUES (1, 'nombre_negocio', 'Celulares Centro'), (1, 'nit', '900123456-7')
      ON CONFLICT DO NOTHING;
    INSERT INTO clientes (id, negocio_id, nombre, cedula, celular) VALUES (1, 1, 'Carlos Ruiz', '1030', '3001112233');
    INSERT INTO tipos_caracteristica (id, negocio_id, nombre) VALUES (1, 1, 'Talla'), (2, 1, 'Color');
    INSERT INTO lineas_producto (id, negocio_id, nombre) VALUES (1, 1, 'Accesorios'), (2, 1, 'iPhones');
    INSERT INTO productos_cantidad (id, nombre, sucursal_id, linea_id) VALUES (10, 'Correa reloj', 1, 1);
    INSERT INTO atributos_producto (id, producto_id, sucursal_id, tipo_id, valor) VALUES (20, 10, 1, 1, '38MM'), (21, 10, 1, 1, '42MM');
    INSERT INTO variantes_atributo (id, atributo_id, producto_id, tipo_id, valor) VALUES (30, 20, 10, 2, 'Negro');
    INSERT INTO productos_serial (id, nombre, sucursal_id, linea_id) VALUES (40, 'iPhone 13', 1, 2);
    INSERT INTO seriales (id, producto_id, imei, color, prestado) VALUES (1, 40, '356789012345678', 'Azul Sierra', TRUE);
    INSERT INTO vendedores (id, negocio_id, sucursal_id, nombre) VALUES (1, 1, 1, 'Sofía Vende');

    -- P1: con la variante congelada en la etiqueta (talla + color).
    INSERT INTO prestamos (id, numero, sucursal_id, usuario_id, cliente_id, nombre_producto, producto_id,
      atributo_id, variante_id, atributo_label, variante_label, cantidad_prestada, valor_prestamo, total_abonado, estado, fecha)
    VALUES (1, 7, 1, 1, 1, 'Correa reloj', 10, 20, 30, 'Talla: 38MM', 'Color: Negro', 2, 60000, 20000, 'Activo', '2026-09-01 08:15:00');
    -- P2: equipo con IMEI, plazo vencido y mora pactada.
    INSERT INTO prestamos (id, numero, sucursal_id, usuario_id, cliente_id, nombre_producto, imei,
      cantidad_prestada, valor_prestamo, total_abonado, estado, fecha, fecha_limite, mora_condicion)
    VALUES (2, 8, 1, 2, 1, 'iPhone 13', '356789012345678', 1, 3000000, 1000000, 'Activo', '2026-09-03 19:47:00',
      '2026-09-20', '{"id":"normal","nombre":"Normal","tipo":"mensual","valor":2,"dias_gracia":0}');
    -- P3: préstamo VIEJO: guardó el id de la talla pero no la etiqueta.
    INSERT INTO prestamos (id, numero, sucursal_id, usuario_id, cliente_id, nombre_producto, producto_id,
      atributo_id, cantidad_prestada, valor_prestamo, total_abonado, estado, fecha)
    VALUES (3, 9, 1, 1, 1, 'Correa reloj', 10, 21, 1, 30000, 0, 'Activo', '2026-09-05 06:05:00');

    INSERT INTO abonos_totales (id, sucursal_id, persona_id, tipo_persona, valor_total, metodo, fecha, descripcion, usuario_id)
    VALUES (1, 1, 1, 'cliente', 400000, 'Efectivo', '2026-09-15 10:31:00', 'Quincena', 2);
    INSERT INTO abonos_prestamo (id, prestamo_id, usuario_id, valor, metodo, fecha, abono_total_id, anulado, valor_anulado, motivo_anulacion) VALUES
      (1, 1, 2, 20000,  'Nequi',    '2026-09-10 13:22:00', NULL, FALSE, 0, NULL),
      (2, 2, 1, 600000, 'Efectivo', '2026-09-12 16:09:00', NULL, FALSE, 0, NULL),
      (3, 2, 2, 400000, 'Efectivo', '2026-09-15 10:31:00', 1,    FALSE, 0, NULL),
      (4, 2, 1, 5000,   'Efectivo', '2026-09-15 10:32:00', NULL, TRUE,  5000, 'Doble clic');

    -- Factura a crédito: una línea por CANTIDAD con la talla ya en el nombre (como la
    -- arma el carrito) y una con IMEI. Una unidad devuelta.
    INSERT INTO facturas (id, numero, sucursal_id, usuario_id, vendedor_id, nombre_cliente, cedula, celular, fecha)
    VALUES (100, 6681, 1, 1, 1, 'Carlos Ruiz', '1030', '3001112233', '2026-09-02 11:11:00');
    INSERT INTO lineas_factura (factura_id, nombre_producto, imei, cantidad, precio, producto_id, atributo_id, cantidad_devuelta) VALUES
      (100, 'Correa reloj (Talla: 42MM)', NULL, 2, 30000, 10, 21, 1),
      (100, 'iPhone 13', '356789012345678', 1, 3500000, NULL, NULL, 0);
    INSERT INTO creditos (id, factura_id, sucursal_id, valor_total, cuota_inicial, total_abonado, estado, creado_en)
    VALUES (50, 100, 1, 3530000, 500000, 1000000, 'Activo', '2026-09-02 11:11:00');
    INSERT INTO abonos_credito (id, credito_id, usuario_id, valor, metodo, notas, fecha)
    VALUES (1, 50, 2, 1000000, 'Nequi', 'Primera cuota', '2026-09-20 18:45:00');
  `);
  // Préstamos de relleno para las pruebas de volumen.
  for (let i = 0; i < nPrestamos - 3; i++) {
    const id = 1000 + i;
    await db.query(`INSERT INTO prestamos (id, numero, sucursal_id, usuario_id, cliente_id, nombre_producto, producto_id,
      atributo_id, variante_id, atributo_label, variante_label, cantidad_prestada, valor_prestamo, total_abonado, estado, fecha)
      VALUES ($1, $1, 1, 1, 1, 'Correa reloj', 10, 20, 30, 'Talla: 38MM', 'Color: Negro', 1, 30000, 10000, 'Activo', '2026-09-06 09:00:00')`, [id]);
    await db.query(`INSERT INTO abonos_prestamo (id, prestamo_id, usuario_id, valor, metodo, fecha) VALUES ($1, $1, 2, 10000, 'Nequi', '2026-09-08 12:00:00')`, [id]);
  }
};

const documentos = {
  'Préstamos activos':  () => pdfP.generarPdfPrestamosActivos({ tipo: 'cliente', personaId: 1, negocioId: 1, negocioNombre: 'Celulares Centro' }),
  'Comprobante':        () => pdfP.generarPdfPrestamoIndividual({ prestamoId: 2, negocioId: 1, negocioNombre: 'Celulares Centro' }),
  'Estado de cuenta (préstamos)': () => pdfP.generarPdfEstadoCuenta({ tipo: 'cliente', personaId: 1, negocioId: 1, negocioNombre: 'Celulares Centro' }),
  'Aviso de mora (préstamo)': () => pdfP.generarPdfAvisoMoraPrestamo({ prestamoId: 2, negocioId: 1 }),
  'Estado de cuenta (créditos)': () => pdfC.generarPdfEstadoCuenta({ clave: '1030', negocioId: 1, negocioNombre: 'Celulares Centro' }),
};

// ═════════════════════════════════════════════════════════════════════════════
seccion('1. Ninguna hoja vacía y ningún salto decidido por PDFKit ★');
const renders = {};
for (const n of [3, 1 + 3, 25]) {
  await sembrar(n);
  for (const [nombre, fn] of Object.entries(documentos)) {
    let r;
    try { r = await leerPdf(fn); } catch (e) { ok(`${nombre} (${n} préstamos) se genera`, false, e.message); continue; }
    if (n === 3) renders[nombre] = r;
    const vacias = hojasSinCuerpo(r);
    ok(`${nombre} · ${n} préstamos: ${r.paginas} hoja(s), ninguna vacía`, vacias.length === 0,
      vacias.length ? `vacías: ${vacias.join(', ')}` : '');
    ok(`${nombre} · ${n} préstamos: PDFKit no abrió ninguna hoja por su cuenta`, r.automaticos === 0,
      `${r.automaticos} saltos automáticos`);
    ok(`${nombre} · ${n} préstamos: nada debajo del pie`,
      r.trazos.every((x) => x.y <= base.PAGE_H - 20));
  }
}
await sembrar(3);
{
  // El caso exacto del reporte: pocos préstamos caben en UNA hoja.
  const r = renders['Préstamos activos'];
  ok('3 préstamos activos caben en 2 hojas como mucho (antes: una hoja extra por cada pie)', r.paginas <= 2, `${r.paginas} hojas`);
  const pies = r.trazos.filter((x) => /^Página \d+ de \d+$/.test(x.t.trim()));
  ok('  un pie por hoja, y en su hoja', pies.length === r.paginas
    && pies.every((x) => x.t.trim() === `Página ${x.n + 1} de ${r.paginas}`));
  // Paz y salvo: el crédito pagado del todo.
  await db.exec(`UPDATE creditos SET total_abonado = 3030000, estado = 'Saldado' WHERE id = 50;
                 UPDATE abonos_credito SET valor = 3030000 WHERE id = 1`);
  const p = await leerPdf(() => pdfC.generarPdfPazYSalvo({ creditoId: 50, negocioId: 1 }));
  ok('paz y salvo: sin saltos de PDFKit y sin hojas vacías', p.automaticos === 0 && hojasSinCuerpo(p).length === 0, `${p.paginas} hoja(s)`);
  ok('paz y salvo: hora de emisión, del pago y productos con IMEI', p.texto.includes('11:11') && p.texto.includes('18:45') && p.texto.includes('IMEI 356789012345678'));
  await sembrar(3);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('2. La HORA de todo');
{
  const a = renders['Préstamos activos'].texto;
  ok('préstamos activos: hora de cada préstamo', a.includes('08:15') && a.includes('19:47') && a.includes('06:05'));
  ok('préstamos activos: hora de cada abono', a.includes('13:22') && a.includes('16:09') && a.includes('10:31'));
  const c = renders.Comprobante.texto;
  ok('comprobante: hora de emisión y de los abonos', c.includes('19:47') && c.includes('16:09') && c.includes('10:31'));
  ok('comprobante: dice «Fecha y hora»', c.includes('Fecha y hora'));
  const ep = renders['Estado de cuenta (préstamos)'].texto;
  ok('estado de cuenta (préstamos): hora en cada movimiento', ['08:15', '19:47', '06:05', '13:22', '16:09', '10:31'].every((h) => ep.includes(h)));
  const ec = renders['Estado de cuenta (créditos)'].texto;
  ok('estado de cuenta (créditos): hora de la factura y del abono', ec.includes('11:11') && ec.includes('18:45'));
  const av = renders['Aviso de mora (préstamo)'].texto;
  ok('aviso de mora: hora del préstamo y de sus pagos', av.includes('19:47') && av.includes('16:09'));
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('3. La VARIANTE');
{
  const a = renders['Préstamos activos'].texto;
  ok('por la etiqueta congelada: «Talla: 38MM / Color: Negro»', a.includes('Talla: 38MM / Color: Negro'));
  ok('préstamo viejo sin etiqueta: se resuelve por el id («Talla: 42MM»)', a.includes('Talla: 42MM'));
  ok('el equipo sin variante no lleva paréntesis vacíos', !a.includes('()') && !a.includes('iPhone 13 ('));
  const ep = renders['Estado de cuenta (préstamos)'].texto;
  ok('estado de cuenta (préstamos): el préstamo dice su variante', ep.includes('Talla: 38MM') && ep.includes('Talla: 42MM'));
  const ec = renders['Estado de cuenta (créditos)'].texto;
  ok('estado de cuenta (créditos): la línea con su talla', ec.includes('Correa reloj (Talla: 42MM)'));
  ok('  sin repetirla cuando el nombre ya la trae', !ec.includes('(Talla: 42MM) (Talla: 42MM)') && !ec.includes('Talla: 42MM (Talla'));
  const av = renders['Aviso de mora (préstamo)'].texto;
  ok('aviso de mora: el equipo con IMEI y color', av.includes('356789012345678') && av.includes('Azul Sierra'));

  // Un negocio SIN tallas: nada de «Variante» en ningún documento.
  await db.exec(`UPDATE prestamos SET atributo_id = NULL, variante_id = NULL, atributo_label = NULL, variante_label = NULL;
                 UPDATE lineas_factura SET atributo_id = NULL, nombre_producto = 'Correa reloj'`);
  const sin = await leerPdf(documentos['Préstamos activos']);
  ok('sin variantes: el PDF no inventa ninguna', !/talla|variante/i.test(sin.texto) && !sin.texto.includes('()'));
  const sinC = await leerPdf(documentos['Estado de cuenta (créditos)']);
  ok('sin variantes: la factura sale con el nombre tal cual', sinC.texto.includes('Correa reloj') && !/talla/i.test(sinC.texto));
  await sembrar(3);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('4. El DETALLE de todo');
{
  const a = renders['Préstamos activos'].texto;
  ok('número de cada préstamo', a.includes('#000007') && a.includes('#000008') && a.includes('#000009'));
  ok('IMEI y color del equipo', a.includes('356789012345678') && a.includes('Azul Sierra'));
  ok('quién registró el préstamo y cada abono', a.includes('Ana Torres') && a.includes('Registró: Luis Caja'));
  ok('método de cada abono', a.includes('Nequi') && a.includes('Efectivo'));
  ok('el abono que salió de un pago total lo dice, con su nota', a.includes('Parte de un pago total') && a.includes('Quincena'));
  ok('valor unitario de lo prestado por cantidad', /valor unitario/i.test(a));
  ok('mora pendiente y total a pagar del préstamo vencido', /mora pendiente/i.test(a) && /total a pagar/i.test(a));
  ok('el abono anulado (doble clic) no se cuenta como pago', !a.includes('5.000 ') || !a.includes('Doble clic'));
  const ep = renders['Estado de cuenta (préstamos)'].texto;
  ok('estado de cuenta: el abono anulado se ve con su motivo', ep.includes('Doble clic'));
  ok('estado de cuenta: el pago total dice a qué préstamo fue', ep.includes('a Préstamo #000008'));
  ok('estado de cuenta: quién registró', ep.includes('Registró: Luis Caja') && ep.includes('Registró: Ana Torres'));
  const ec = renders['Estado de cuenta (créditos)'].texto;
  ok('créditos: cada producto con cantidad, IMEI y precio', ec.includes('2 × Correa reloj') && ec.includes('IMEI 356789012345678') && ec.includes('c/u'));
  ok('créditos: lo devuelto se dice', ec.includes('1 devuelta(s)'));
  ok('créditos: vendedor y quién registró', ec.includes('Vendedor: Sofía Vende') && ec.includes('Registró: Ana Torres'));
  ok('créditos: el abono con su nota y quién lo registró', ec.includes('Primera cuota') && ec.includes('Registró: Luis Caja'));
  const c = renders.Comprobante.texto;
  ok('comprobante: producto, IMEI, color, registró y mora pactada',
    ['iPhone 13', '356789012345678', 'Azul Sierra', 'Luis Caja', '2% mensual'].every((s) => c.includes(s)));
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('5. Todo lo impreso existe en Helvetica');
{
  // WinAnsi: Latin-1 más estos. Lo demás (el menos tipográfico, flechas…) sale
  // como comillas — se descubrió en la red interna (suite 55).
  const EXTRA = new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ']);
  const fuera = new Set();
  for (const r of Object.values(renders)) {
    for (const ch of r.texto) if (ch.codePointAt(0) > 0xFF && !EXTRA.has(ch)) fuera.add(ch);
  }
  ok('ningún carácter fuera de WinAnsi', fuera.size === 0,
    [...fuera].map((c) => `U+${c.codePointAt(0).toString(16)}`).join(' '));
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('6. El navegador no revoca el PDF antes de abrirlo');
{
  const util = leer(FRONT, 'utils/descargarArchivo.js');
  ok('descargarBlob libera el enlace DESPUÉS (setTimeout)', /setTimeout\(\(\) => URL\.revokeObjectURL\(url\), \d{4,}\)/.test(util));
  const archivos = [
    'components/ui/ModalExportarCuenta.jsx',
    'components/documentos/ModalDocumentosObligacion.jsx',
    'hooks/useImprimirPrestamo.js',
    'hooks/useExportarPdfPrestamos.js',
    'pages/prestamos/ModalReporteEmpleado.jsx',
  ];
  for (const f of archivos) {
    const src = leer(FRONT, f);
    ok(`${f}: usa descargarBlob y no revoca en el acto`, src.includes('descargarBlob') && !src.includes('revokeObjectURL'));
  }
}

// ── Resultado ───────────────────────────────────────────────────────────────
console.log(`\n${pasados} verificaciones pasaron · ${fallos.length} fallaron`);
if (fallos.length) { fallos.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
process.exit(0);
