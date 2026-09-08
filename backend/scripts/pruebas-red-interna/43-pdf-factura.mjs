// ─────────────────────────────────────────────────────────────────────────────
// ESTRUCTURA DEL PDF DE UNA FACTURA
//
// Un PDF mal paginado no se ve mal en el código. Se ve mal cuando alguien ya
// mandó a imprimir 160 hojas: eso es lo que salía de una factura de 60
// productos, porque PDFKit abre una página nueva ÉL SOLO cada vez que se le
// pide dibujar texto (con `width`) por debajo del borde inferior útil, y el
// documento se creaba con `margin: 0` — o sea que ese borde era el filo del
// papel. Cada `doc.text` que caía más abajo se llevaba su propia hoja.
//
// Esta prueba renderiza el PDF DE VERDAD —la misma función que sirve el
// endpoint— e instrumenta PDFKit para mirar dónde cae cada trazo y en qué
// página. No comprueba que "se vea bonito": comprueba las cuatro cosas que
// hacen que un PDF sea imprimible.
//
//   1. Ninguna página está vacía.
//   2. Nada se dibuja fuera del cuerpo (ni sobre el encabezado, ni en la franja
//      del pie, ni fuera del papel).
//   3. PDFKit no decide NINGÚN salto de página por su cuenta: todos son
//      nuestros, y por lo tanto medidos.
//   4. La cabecera de la tabla se repite en cada página que lleva filas.
//
// La sección 1 es la que hay que mirar primero: las facturas normales —las que
// emiten todos los días los 28 negocios— tienen que seguir cabiendo en una hoja.
//
//   node scripts/pruebas-red-interna/43-pdf-factura.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { createRequire } from 'node:module';
import path from 'node:path';
import { Writable } from 'node:stream';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');

const PDFDocument = require(path.join(RAIZ, 'node_modules/pdfkit'));

// ─────────────────────────────────────────────────────────────────────────────
// INSTRUMENTACIÓN — tiene que aplicarse ANTES de cargar el generador
// ─────────────────────────────────────────────────────────────────────────────
const proto = PDFDocument.prototype;
let traza = null;

const envolver = (metodo, leer) => {
  const original = proto[metodo];
  proto[metodo] = function envuelto(...args) {
    if (traza) {
      const dato = leer(args);
      if (dato && Number.isFinite(dato.y)) traza.ops.push({ pagina: traza.pagina, op: metodo, ...dato });
    }
    return original.apply(this, args);
  };
};

// `_fragment` es donde PDFKit pinta CADA LÍNEA ya resuelta, con su y absoluta.
// Se instrumenta ahí y no en `doc.text` porque un párrafo que fluye entre
// páginas es UNA sola llamada a `text`: mirando la API pública, las hojas que
// ese párrafo llena parecerían vacías.
envolver('_fragment',   (a) => ({ y: a[2], texto: String(a[0] ?? '') }));
envolver('rect',        (a) => ({ x: a[0], y: a[1], w: a[2], h: a[3] }));
envolver('roundedRect', (a) => ({ x: a[0], y: a[1], w: a[2], h: a[3] }));
envolver('moveTo',      (a) => ({ y: a[1] }));
envolver('image',       (a) => (typeof a[2] === 'number' ? { y: a[2] } : null));

const origAddPage = proto.addPage;
proto.addPage = function addPageEnvuelto(...a) {
  if (traza) traza.pagina += 1;
  return origAddPage.apply(this, a);
};

// El salto que decide PDFKit por su cuenta. Es EL bug: cada uno de estos era
// una hoja casi vacía.
const origContinuar = proto.continueOnNewPage;
proto.continueOnNewPage = function continuarEnvuelto(...a) {
  if (traza) traza.automaticos += 1;
  return origContinuar.apply(this, a);
};

const { generarPdfFactura } = require(path.join(RAIZ, 'src/modules/facturas/facturas.pdf'));
const base = require(path.join(RAIZ, 'src/utils/pdf.base'));
const { resumirObligacion } = require(path.join(RAIZ, 'src/utils/obligacion'));

const { PAGE_H, CONTENT_W, MARGIN, BODY_BOTTOM } = base;
const CUERPO_TOP = 62;   // HEADER_CONT_H (40) + 22, el margen superior del documento
const TABLA_HEAD_H = 28;

// ─────────────────────────────────────────────────────────────────────────────
let fallos = 0, pasados = 0;
const check = (etiqueta, cond, detalle = '') => {
  if (cond) { pasados++; console.log(`  ✓ ${etiqueta}`); }
  else { fallos++; console.log(`  ✗ ${etiqueta}${detalle ? `\n      ${detalle}` : ''}`); }
};

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────────────────────────────
const config = {
  nombre_negocio: 'Comercializadora El Progreso S.A.S.',
  nit: '900123456-7', direccion: 'Cra 7 # 45-12, Cali', telefono: '3187654321',
};

const NOMBRE_LARGO = 'Cargador rápido universal tipo C 65W con cable trenzado de nylon reforzado edición especial';

function factura(n, opts = {}) {
  const lineas = [];
  for (let i = 0; i < n; i++) {
    lineas.push({
      nombre_producto: opts.largos ? `${NOMBRE_LARGO} ${i + 1}` : `Producto ${i + 1}`,
      cantidad: 1 + (i % 3),
      cantidad_devuelta: 0,
      precio: 35000 + i * 1500,
      imei: opts.seriales && i % 2 === 0 ? `35${String(i).padStart(13, '0')}` : null,
    });
  }
  const total = lineas.reduce((s, l) => s + l.precio * l.cantidad, 0);
  return {
    id: 123, numero: 45, fecha: '2026-09-08T14:22:00Z', estado: 'Activa',
    nombre_cliente: opts.nombreLargo
      ? 'Distribuidora Comercial de Accesorios y Repuestos para Telefonía Móvil del Pacífico S.A.S.'
      : 'María Fernanda Rodríguez Gutiérrez',
    cedula: '1094567890', celular: '3001234567',
    cliente_email: 'maria.fernanda.rodriguez@ejemplo.com',
    cliente_direccion: 'Calle 12 # 34-56 Barrio Centro',
    usuario_nombre: 'Ana Pérez', vendedor_nombre: 'Luis Gómez',
    notas: opts.notas || null,
    lineas, retomas: opts.retomas || [],
    pagos: opts.pagos || [{ metodo: 'Efectivo', valor: total }],
  };
}

const GARANTIAS = [
  { orden: 1, titulo: 'Garantía legal', texto: 'Todo producto nuevo cuenta con garantía de doce (12) meses contados a partir de la fecha de esta factura, conforme a la Ley 1480 de 2011 (Estatuto del Consumidor). La garantía cubre defectos de fabricación y no cubre daños por mal uso, humedad, caídas o manipulación por terceros no autorizados.' },
  { orden: 2, titulo: 'Cambios y devoluciones', texto: 'Los cambios se aceptan dentro de los cinco (5) días hábiles siguientes a la compra, presentando esta factura y con el producto en su empaque original sin señales de uso.' },
  { orden: 3, titulo: 'Servicio técnico', texto: 'Los equipos que requieran revisión deben dejarse en el punto de venta con su respectivo comprobante. El diagnóstico puede tardar hasta ocho (8) días hábiles.' },
];

/** Crédito real, construido con el MISMO resumidor que usa el endpoint. */
function credito(nAbonos) {
  const abonos = [];
  for (let i = 0; i < nAbonos; i++) {
    abonos.push({
      id: i + 1,
      fecha: new Date(Date.UTC(2026, 0, 5 + i * 7)).toISOString(),
      valor: 50000, metodo: i % 3 === 0 ? 'Efectivo' : 'Transferencia Bancolombia',
    });
  }
  const documento = {
    factura_numero: 45, valor_total: 4000000, cuota_inicial: 200000,
    total_abonado: nAbonos * 50000, creado_en: '2026-01-02T10:00:00Z',
    fecha_limite: '2026-12-31',
  };
  return { resumen: resumirObligacion({ tipo: 'credito', documento, abonos }) };
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDER + ANÁLISIS
// ─────────────────────────────────────────────────────────────────────────────
function respuestaFalsa() {
  const trozos = [];
  const w = new Writable({ write(c, e, cb) { trozos.push(c); cb(); } });
  w.setHeader = () => {};
  w._buf = () => Buffer.concat(trozos);
  return w;
}

async function render(f, extra = {}) {
  // autoFirstPage dispara un addPage durante la construccion del documento,
  // asi que el contador arranca en -1 para que la primera hoja real sea la 0.
  traza = { ops: [], pagina: -1, automaticos: 0 };
  const res = respuestaFalsa();
  const fin = new Promise((r) => res.on('finish', r));
  generarPdfFactura({
    factura: f, config,
    garantias: extra.garantias || [],
    credito: extra.credito || null,
    res,
  });
  await fin;
  const buf = res._buf();
  const t = traza;
  traza = null;

  const paginas = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

  // La numeración del pie se dibuja al final con `switchToPage`, que NO pasa por
  // addPage: esos trazos quedan atribuidos a la última página. Se descartan por
  // su posición, que es la única marca fiable que tienen.
  const cuerpo = t.ops.filter((o) => o.y < PAGE_H - 50);

  const porPagina = new Map();
  for (const o of cuerpo) {
    if (!porPagina.has(o.pagina)) porPagina.set(o.pagina, []);
    porPagina.get(o.pagina).push(o);
  }

  return { paginas, automaticos: t.automaticos, ops: cuerpo, porPagina, bytes: buf.length };
}

/** Las cuatro invariantes estructurales, sobre cualquier factura. */
function verificarEstructura(nombre, r, { permitirAutomaticos = false } = {}) {
  // 1. Ninguna página vacía.
  const vacias = [];
  for (let p = 0; p < r.paginas; p++) {
    const ops = r.porPagina.get(p) || [];
    // El encabezado de continuación son 4 trazos: si no hay más, la hoja está
    // en blanco a efectos prácticos y es papel tirado.
    if (ops.length <= 5) vacias.push(p + 1);
  }
  check(`${nombre}: sin páginas vacías`, vacias.length === 0,
    `páginas casi vacías: ${vacias.join(', ')} de ${r.paginas}`);

  // 2. Nada fuera del cuerpo.
  const fuera = r.ops.filter((o) => {
    if (o.pagina === 0 && o.y < 140) return false;   // encabezado completo de la 1ª página
    if (o.pagina > 0 && o.y < CUERPO_TOP) return o.y > 42;  // franja de continuación
    return o.y > BODY_BOTTOM + 1;
  });
  check(`${nombre}: nada invade el pie ni el encabezado`, fuera.length === 0,
    fuera.slice(0, 4).map((o) => `${o.op}@p${o.pagina + 1} y=${Math.round(o.y)} ${o.texto || ''}`).join('\n      '));

  // 3. Ningún salto decidido por PDFKit.
  if (!permitirAutomaticos) {
    check(`${nombre}: ningún salto automático de PDFKit`, r.automaticos === 0,
      `${r.automaticos} saltos automáticos — cada uno es una hoja que nadie midió`);
  }

  // 4. La cabecera negra de la tabla se repite en cada página con filas.
  const cabeceras = r.ops.filter((o) => o.op === 'roundedRect'
    && Math.abs(o.w - CONTENT_W) < 0.5 && o.h === TABLA_HEAD_H && Math.abs(o.x - MARGIN) < 0.5);
  const paginasConCabecera = new Set(cabeceras.map((o) => o.pagina));
  check(`${nombre}: cabecera repetida en cada tramo de la tabla`,
    cabeceras.length === paginasConCabecera.size && cabeceras.length >= 1,
    `${cabeceras.length} cabeceras en ${paginasConCabecera.size} páginas`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 1. LA FACTURA DE TODOS LOS DÍAS SIGUE EN UNA HOJA ═══\n');
// Si esta sección falla, el arreglo salió más caro que el problema: la inmensa
// mayoría de las facturas de los 28 negocios son de menos de diez líneas.
{
  for (const n of [1, 2, 3, 5, 8, 10]) {
    const r = await render(factura(n));
    check(`${String(n).padStart(2)} productos → 1 hoja`, r.paginas === 1, `salieron ${r.paginas}`);
  }
  const r = await render(factura(5, { largos: true, seriales: true }));
  check('5 productos con nombre largo e IMEI → 1 hoja', r.paginas === 1, `salieron ${r.paginas}`);
}

console.log('\n═══ 2. MUCHOS PRODUCTOS: LA REGRESIÓN QUE SE REPORTÓ ═══\n');
// Antes: 20 productos → 8 hojas, 30 → 40 hojas, 60 → 160 hojas.
{
  const esperado = [
    // ~26 productos por hoja: 28 filas de 24 pt en las paginas de continuacion
    // (722 pt de cuerpo menos la cabecera), y unas 19 en la primera.
    [20,  2], [30,  2], [60,  3], [120, 5], [300, 12],
  ];
  for (const [n, tope] of esperado) {
    const r = await render(factura(n));
    check(`${String(n).padStart(3)} productos → ${r.paginas} hojas (tope ${tope})`,
      r.paginas <= tope, `salieron ${r.paginas}`);
    verificarEstructura(`${n} productos`, r);
  }
}

console.log('\n═══ 3. EL CRECIMIENTO ES LINEAL, NO EXPLOSIVO ═══\n');
// El síntoma del bug era que cada fila de más costaba una hoja. Con la tabla
// paginada, duplicar los productos no puede más que duplicar las hojas.
{
  const a = await render(factura(60));
  const b = await render(factura(120));
  check('duplicar productos no más que duplica las hojas',
    b.paginas <= a.paginas * 2, `60→${a.paginas} hojas, 120→${b.paginas}`);

  const c = await render(factura(600));
  check('600 productos siguen siendo imprimibles (≤ 25 hojas)',
    c.paginas <= 25, `salieron ${c.paginas}`);
  verificarEstructura('600 productos', c);
}

console.log('\n═══ 4. NOMBRES: LARGOS, CORTOS Y SIN ESPACIOS ═══\n');
{
  const r1 = await render(factura(40, { largos: true, seriales: true }));
  verificarEstructura('40 nombres largos + IMEI', r1);

  // Un código sin un solo espacio no se puede partir por palabras: PDFKit lo
  // pintaba entero y se comía la columna de al lado.
  const sinEspacios = factura(1);
  sinEspacios.lineas = [{
    nombre_producto: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    cantidad: 1, cantidad_devuelta: 0, precio: 1200000, imei: null,
  }];
  const r2 = await render(sinEspacios);
  check('un nombre sin espacios no revienta el documento', r2.paginas === 1, `salieron ${r2.paginas}`);
  verificarEstructura('nombre sin espacios', r2);

  // La comprobación de que de verdad cabe se hace sobre la función pura.
  const doc = new PDFDocument({ size: 'A4' });
  doc.font(base.FONT.bold).fontSize(9);
  const anchoCol = 231;
  const partido = base.partirPalabrasLargas(doc, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', anchoCol);
  const cabenTodas = partido.split('\n').every((l) => doc.widthOfString(l) <= anchoCol + 0.01);
  check('las palabras se parten hasta caber en la columna', cabenTodas,
    partido.split('\n').map((l) => `${Math.round(doc.widthOfString(l))}pt`).join(' | '));

  // Y el texto normal NO se toca: partir de más metería saltos donde no van.
  const intacto = base.partirPalabrasLargas(doc, 'Cargador tipo C 65W', anchoCol);
  check('un texto que cabe se devuelve sin tocar', intacto === 'Cargador tipo C 65W', intacto);

  // Dos líneas como máximo en la descripción, con recorte.
  const m = base.medirTexto(doc, `${NOMBRE_LARGO} ${NOMBRE_LARGO}`, anchoCol,
    { lineas: 2, font: base.FONT.bold, size: 9 });
  check('la descripción se limita a dos líneas', m.lineas === 2, `dio ${m.lineas}`);
  doc.end();
}

console.log('\n═══ 5. FACTURA A CRÉDITO CON HISTORIAL LARGO ═══\n');
// El historial de abonos tenía el mismo defecto que la tabla de productos: se
// reservaban 260 pt como mucho y el resto se salía del papel.
{
  for (const [n, tope] of [[0, 2], [3, 2], [30, 3], [90, 5]]) {
    const r = await render(factura(4), { credito: credito(n) });
    check(`crédito con ${String(n).padStart(2)} abonos → ${r.paginas} hojas (tope ${tope})`,
      r.paginas <= tope, `salieron ${r.paginas}`);
    verificarEstructura(`crédito ${n} abonos`, r);
  }

  // Lo peor de los dos mundos a la vez.
  const r = await render(factura(80), { credito: credito(60), garantias: GARANTIAS });
  check('80 productos + 60 abonos + garantías → ≤ 8 hojas', r.paginas <= 8, `salieron ${r.paginas}`);
  verificarEstructura('80 productos + crédito + garantías', r, { permitirAutomaticos: true });
}

console.log('\n═══ 6. DEVOLUCIONES, RETOMAS, NOTAS Y GARANTÍAS ═══\n');
{
  const conTodo = factura(9);
  conTodo.lineas[0] = { ...conTodo.lineas[0], cantidad: 3, cantidad_devuelta: 1, imei: '350000000000001' };
  conTodo.lineas[1] = { ...conTodo.lineas[1], cantidad: 2, cantidad_devuelta: 2 };
  conTodo.retomas = [
    { valor_retoma: 300000, imei: '350000000000099', descripcion: 'iPhone 11 usado con rayones en la pantalla', nombre_producto_serial: 'iPhone 11 Pro' },
    { valor_retoma: 80000, cantidad_retoma: 2, descripcion: 'Dos cargadores usados', nombre_producto_cantidad: 'Cargador tipo C' },
  ];
  conTodo.notas = 'El cliente solicita entrega a domicilio el próximo martes en horas de la tarde.';
  const r = await render(conTodo, { garantias: GARANTIAS });
  verificarEstructura('factura con todo', r);
  check('una factura con devoluciones, retomas, notas y garantías cabe en ≤ 3 hojas',
    r.paginas <= 3, `salieron ${r.paginas}`);

  // Ocho retomas: los bloques no se pueden partir, así que cada uno salta entero.
  const muchasRetomas = factura(6);
  muchasRetomas.retomas = Array.from({ length: 8 }, (_, i) => ({
    valor_retoma: 100000 + i * 1000, imei: `3500000000000${String(i).padStart(2, '0')}`,
    descripcion: `Equipo retomado número ${i + 1} en estado regular`,
    nombre_producto_serial: 'iPhone 11 Pro',
  }));
  const r2 = await render(muchasRetomas);
  verificarEstructura('8 retomas', r2);
}

console.log('\n═══ 7. UN PÁRRAFO MÁS LARGO QUE LA PÁGINA ═══\n');
// Este es el único caso en el que se deja fluir a PDFKit: un texto que no cabe
// en una hoja no se puede meter en una tarjeta. Lo que se comprueba es que el
// salto aterrice DEBAJO del encabezado de continuación y no en el filo del papel.
{
  const r = await render(factura(3, { notas: 'OBSERVACIÓN IMPORTANTE PARA EL CLIENTE. '.repeat(400) }));
  check('una nota kilométrica no explota en hojas', r.paginas <= 6, `salieron ${r.paginas}`);
  verificarEstructura('nota kilométrica', r, { permitirAutomaticos: true });

  const arriba = r.ops.filter((o) => o.pagina > 0 && o.y > 42 && o.y < CUERPO_TOP);
  check('el texto que fluye no se monta sobre el encabezado', arriba.length === 0,
    arriba.slice(0, 3).map((o) => `y=${Math.round(o.y)} ${o.texto || ''}`).join(' | '));
}

console.log('\n═══ 8. CASOS DEGENERADOS ═══\n');
{
  const sinNada = {
    id: 7, fecha: '2026-09-08T14:22:00Z', estado: 'Activa',
    nombre_cliente: 'CONSUMIDOR FINAL', cedula: 'COMPANERO',
    lineas: [], retomas: [], pagos: [],
  };
  const r1 = await render(sinNada);
  check('una factura sin líneas ni pagos se genera igual', r1.paginas === 1, `salieron ${r1.paginas}`);
  verificarEstructura('factura vacía', r1);

  // Todas las líneas devueltas: la tabla queda sin filas vigentes.
  const todoDevuelto = factura(4);
  todoDevuelto.lineas = todoDevuelto.lineas.map((l) => ({ ...l, cantidad_devuelta: l.cantidad }));
  const r2 = await render(todoDevuelto);
  verificarEstructura('todo devuelto', r2);

  const r3 = await render(factura(4, { nombreLargo: true }));
  check('un nombre de cliente larguísimo no descuadra la tarjeta', r3.paginas === 1, `salieron ${r3.paginas}`);
  verificarEstructura('cliente con nombre larguísimo', r3);

  const muchosPagos = factura(12, { pagos: Array.from({ length: 14 }, (_, i) => ({ metodo: `Método de pago número ${i + 1}`, valor: 25000 })) });
  const r4 = await render(muchosPagos);
  verificarEstructura('14 pagos', r4);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log(`\n${'─'.repeat(70)}`);
console.log(`  ${pasados} verificaciones pasaron, ${fallos} fallaron`);
console.log(`${'─'.repeat(70)}\n`);
process.exit(fallos ? 1 : 0);
