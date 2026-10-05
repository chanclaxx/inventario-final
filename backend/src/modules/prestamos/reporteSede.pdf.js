'use strict';
// src/modules/prestamos/reporteSede.pdf.js
// ─────────────────────────────────────────────────────────────────────────────
// PDF del reporte por sede. SOLO DIBUJA: las cifras vienen armadas de
// `reporteSede.service` (que a su vez sale de las consultas del reporte por
// empleado).
//
// Estructura, por sede:
//   encabezado → ficha de la sede → seis cifras (equipos, accesorios, valor,
//   pendientes, pagado, debido) → unidades por tipo, categoría y estado →
//   plata por tipo → mes a mes → por empleado → lo que se debe, documento por
//   documento (opcional).
// Con «todas las sedes», primero un consolidado con una fila por sede y luego
// cada sede en su propia hoja.
//
// Todo pasa por las primitivas de `pdf.base` (tablaPaginada, textoAcotado,
// asegurarEspacio): ningún salto de página lo decide PDFKit.
// ─────────────────────────────────────────────────────────────────────────────
const PDFDocument = require('pdfkit');
const {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W, BODY_BOTTOM, FONT, C,
  formatCOP, rectFill, rectFillStroke, hLine,
  encabezado, pieDocumento, asegurarEspacio,
  encabezadoContinuo, medirTexto, textoAcotado, tablaPaginada,
} = require('../../utils/pdf.base');
const { GRUPOS } = require('./reporteEmpleado.service');
const { CATEGORIAS, vigentes } = require('./reporteSede.service');

const CONT_H = 34;
const CAB_H  = 20;
const FILA_H = 17;
const PAD    = 5;

const COLOR_TIPO = { azul: C.azul, morado: C.morado, naranja: C.naranja, verde: C.verde };

const fechaCorta = (iso) => {
  const [a, m, d] = String(iso || '').split('-');
  return a && m && d ? `${d}/${m}/${a}` : String(iso || '');
};
const ahoraBogota = () => new Date().toLocaleString('es-CO', {
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota',
});
const n = (v) => (Number(v) ? Number(v).toLocaleString('es-CO') : '–');
const plata = (v) => (Number(v) ? formatCOP(v) : '–');
// En las tarjetas un cero se escribe: «0 equipos» es una respuesta.
const cuenta = (v) => Number(v || 0).toLocaleString('es-CO');
const pendientes = (t) => CATEGORIAS.reduce((s, c) => s + t.unidades[c.id].pendiente, 0);
const pagados    = (t) => CATEGORIAS.reduce((s, c) => s + t.unidades[c.id].pagado, 0);

// ─── Tabla genérica de cifras ───────────────────────────────────────────────
//
// `columnas`: [{ titulo, w, align }] — la primera toma el ancho que sobre.
// `filas`: [{ celdas: [texto…], negrita?, punto?, fondo?, colores?: {i: color} }]

const anchos = (columnas) => {
  const fijos = columnas.slice(1).reduce((s, c) => s + c.w, 0);
  return [CONTENT_W - fijos, ...columnas.slice(1).map((c) => c.w)];
};

const tituloSeccion = (doc, y, texto, reserva) => {
  y = asegurarEspacio(doc, y, 16 + reserva);
  doc.font(FONT.bold).fontSize(7).fillColor(C.grisClaro)
    .text(texto.toUpperCase(), MARGIN, y, { characterSpacing: 1.2, lineBreak: false });
  return y + 14;
};

const tablaCifras = (doc, y, { titulo, columnas, filas, nota = null }) => {
  const ws = anchos(columnas);
  const xs = ws.reduce((acc, w, i) => [...acc, i === 0 ? MARGIN : acc[i - 1] + ws[i - 1]], []);
  y = tituloSeccion(doc, y, titulo, CAB_H + FILA_H + 4);

  y = tablaPaginada(doc, y, {
    cabeceraAlto: CAB_H,
    dibujarCabecera: (d, yc) => {
      d.roundedRect(MARGIN, yc, CONTENT_W, CAB_H, 8).fill(C.grisFondo);
      d.rect(MARGIN, yc + 8, CONTENT_W, CAB_H - 8).fill(C.grisFondo);
      hLine(d, yc + CAB_H, { color: C.grisBorde, width: 0.5 });
      columnas.forEach((c, i) => {
        // Sin espaciado y con menos margen: a 44 pt «PENDIENTES» o
        // «CANCELADOS» se partían a mitad de palabra.
        const y0 = c.titulo.length > 11 ? yc + 3.5 : yc + 7;
        textoAcotado(d, c.titulo.toUpperCase(), xs[i] + 3, y0, ws[i] - 6, {
          lineas: 2, font: FONT.bold, size: 5.5, color: C.gris,
          align: i === 0 ? 'left' : (c.align || 'right'),
        });
      });
    },
    filas: filas.map((f) => ({
      alto: FILA_H,
      fondo: f.fondo,
      dibujar: (d, yf) => {
        let x0 = xs[0] + PAD;
        if (f.punto) { d.circle(x0 + 3, yf + FILA_H / 2, 2.6).fill(f.punto); x0 += 10; }
        f.celdas.forEach((texto, i) => {
          const x = i === 0 ? x0 : xs[i] + PAD;
          const w = i === 0 ? ws[0] - (x0 - xs[0]) - PAD : ws[i] - PAD * 2;
          textoAcotado(d, String(texto ?? ''), x, yf + 5, w, {
            size: 7, align: i === 0 ? 'left' : (columnas[i].align || 'right'),
            font: f.negrita || i === 0 ? FONT.bold : FONT.normal,
            color: f.colores?.[i] || (texto === '–' ? C.grisBorde : C.negro),
          });
        });
      },
    })),
    espacioDespues: nota ? 6 : 18,
  });

  if (nota) {
    const m = medirTexto(doc, nota, CONTENT_W, { lineas: 3, size: 6.8 });
    y = asegurarEspacio(doc, y, m.alto + 14);
    textoAcotado(doc, nota, MARGIN, y, CONTENT_W, { lineas: 3, size: 6.8, color: C.gris });
    y += m.alto + 14;
  }
  return y;
};

// Las columnas que comparten el mes a mes, los empleados y el consolidado.
const COLS_COMPACTAS = (primera) => [
  { titulo: primera },
  { titulo: 'Equipos', w: 44 },
  { titulo: 'Accesorios', w: 48 },
  { titulo: 'Pendientes (uds)', w: 50 },
  { titulo: 'Pagados (uds)', w: 46 },
  { titulo: 'Valor', w: 68 },
  { titulo: 'Pagado', w: 68 },
  { titulo: 'Debe', w: 64 },
];
const filaCompacta = (nombre, t, extra = {}) => ({
  celdas: [nombre, n(vigentes(t, 'equipo')), n(vigentes(t, 'accesorio')), n(pendientes(t)), n(pagados(t)),
    plata(t.valor), plata(t.pagado), plata(t.debe)],
  colores: { 3: pendientes(t) ? C.naranja : null, 7: t.debe ? C.rojo : null },
  ...extra,
});

// ─── Bloques ────────────────────────────────────────────────────────────────

const fichaSede = (doc, y, { nombre, periodo, generado, detalle }) => {
  const h = 58;
  rectFillStroke(doc, MARGIN, y, CONTENT_W, h, C.grisFondo, C.grisBorde, 8);
  doc.font(FONT.bold).fontSize(6.5).fillColor(C.grisClaro)
    .text('SUCURSAL', MARGIN + 14, y + 10, { characterSpacing: 1.2, lineBreak: false });
  textoAcotado(doc, nombre, MARGIN + 14, y + 21, CONTENT_W * 0.6, { font: FONT.bold, size: 15 });
  textoAcotado(doc, periodo, MARGIN + 14, y + 41, CONTENT_W * 0.6, { size: 8, color: C.gris });
  const xd = MARGIN + CONTENT_W * 0.6;
  const wd = CONTENT_W * 0.4 - 14;
  doc.font(FONT.bold).fontSize(6.5).fillColor(C.grisClaro)
    .text('INCLUYE', xd, y + 10, { width: wd, align: 'right', characterSpacing: 1.2, lineBreak: false });
  textoAcotado(doc, detalle, xd, y + 22, wd, { font: FONT.bold, size: 8.5, align: 'right', color: C.grisOscuro });
  textoAcotado(doc, `Generado el ${generado}`, xd, y + 41, wd, { size: 7, align: 'right', color: C.grisClaro });
  return y + h + 14;
};

/** Seis cifras para leer el mes de un vistazo. */
const cifras = (doc, y, t) => {
  const tiles = [
    { t: 'Celulares y equipos', v: cuenta(vigentes(t, 'equipo')),
      d: `${cuenta(t.unidades.equipo.pendiente)} pendientes · ${cuenta(t.unidades.equipo.pagado)} pagados`, c: C.azul },
    { t: 'Accesorios y otros', v: cuenta(vigentes(t, 'accesorio')),
      d: `${cuenta(t.unidades.accesorio.pendiente)} pendientes · ${cuenta(t.unidades.accesorio.pagado)} pagados`, c: C.morado },
    { t: 'Valor del período', v: formatCOP(t.valor), d: `${cuenta(t.documentos)} documentos`, c: C.negro },
    { t: 'Activos (por cobrar)', v: cuenta(t.activos),
      d: 'créditos y préstamos con saldo', c: C.naranja },
    { t: 'Total pagado', v: formatCOP(t.pagado), d: `${cuenta(t.saldados)} documentos pagados`, c: C.verde },
    { t: 'Total debido', v: formatCOP(t.debe), d: 'capital, sin mora ni interés', c: C.rojo },
  ];
  const gap = 8;
  const w = (CONTENT_W - gap * 2) / 3;
  const h = 48;
  y = asegurarEspacio(doc, y, h * 2 + gap + 16);
  tiles.forEach((x, i) => {
    const xx = MARGIN + (i % 3) * (w + gap);
    const yy = y + Math.floor(i / 3) * (h + gap);
    rectFillStroke(doc, xx, yy, w, h, C.blanco, C.grisBorde, 8);
    doc.rect(xx, yy + 8, 3, h - 16).fill(x.c);
    textoAcotado(doc, x.t.toUpperCase(), xx + 12, yy + 8, w - 20,
      { font: FONT.bold, size: 6, color: C.grisClaro, characterSpacing: 0.6 });
    textoAcotado(doc, x.v, xx + 12, yy + 19, w - 20, { font: FONT.bold, size: 12.5, color: x.c });
    textoAcotado(doc, x.d, xx + 12, yy + 35, w - 20, { size: 6.5, color: C.gris });
  });
  return y + h * 2 + gap + 18;
};

const tablaUnidades = (doc, y, sede) => {
  const columnas = [
    { titulo: 'Tipo' }, { titulo: 'Categoría', w: 58, align: 'left' },
    ...GRUPOS.map((g) => ({ titulo: g.corto || g.titulo, w: 48 })),
    { titulo: 'Total', w: 38 },
  ];
  const filas = [];
  for (const tipo of sede.tipos) {
    CATEGORIAS.forEach((c, i) => {
      const u = tipo.unidades[c.id];
      filas.push({
        punto: i === 0 ? COLOR_TIPO[tipo.color] : null,
        celdas: [i === 0 ? tipo.titulo : '', c.corto, ...GRUPOS.map((g) => n(u[g.id])), n(u.total)],
        colores: { 3: u.pendiente ? C.naranja : null, 2: u.pagado ? C.verde : null },
      });
    });
  }
  CATEGORIAS.forEach((c, i) => {
    const u = sede.total.unidades[c.id];
    filas.push({
      negrita: true, fondo: C.grisFondo,
      celdas: [i === 0 ? 'Total' : '', c.corto, ...GRUPOS.map((g) => n(u[g.id])), n(u.total)],
    });
  });
  return tablaCifras(doc, y, {
    titulo: 'Unidades por tipo y estado',
    columnas, filas,
    nota: 'Equipos = productos con IMEI (celulares, tablets, relojes…). Cada unidad está en el estado que tiene HOY. '
      + 'Pagados incluye lo vendido de contado.',
  });
};

const tablaPlata = (doc, y, sede) => {
  const columnas = [
    { titulo: 'Tipo' }, { titulo: 'Docs.', w: 44 }, { titulo: 'Activos', w: 42 }, { titulo: 'Saldados', w: 44 },
    { titulo: 'Valor', w: 72 }, { titulo: 'Pagado', w: 72 }, { titulo: 'Debe', w: 68 },
  ];
  const fila = (titulo, t, extra = {}) => ({
    celdas: [titulo, n(t.documentos), n(t.activos), n(t.saldados), plata(t.valor), plata(t.pagado), plata(t.debe)],
    colores: { 2: t.activos ? C.naranja : null, 6: t.debe ? C.rojo : null, 5: t.pagado ? C.verde : null },
    ...extra,
  });
  const filas = sede.tipos.map((t) => fila(t.titulo, t, { punto: COLOR_TIPO[t.color] }));
  filas.push(fila('Total', sede.total, { negrita: true, fondo: C.grisFondo }));

  const notas = ['Valor = lo que vale hoy cada documento (la devolución ya lo rebajó). Pagado = contado + cuotas iniciales + abonos. '
    + 'Debe = saldo de capital de lo activo; la mora y el interés van aparte. Lo cancelado y lo devuelto no suma plata.'];
  if (sede.total.cerrado_sin_pago > 0) {
    notas.push(`Hay ${formatCOP(sede.total.cerrado_sin_pago)} en documentos cerrados como saldados sin el abono registrado: `
      + 'por eso Valor no es igual a Pagado + Debe.');
  }
  return tablaCifras(doc, y, { titulo: 'Plata por tipo', columnas, filas, nota: notas.join(' ') });
};

const tablaMeses = (doc, y, sede) => {
  if (!sede.meses.length) return y;
  const filas = sede.meses.map((m) => filaCompacta(m.etiqueta, m));
  if (sede.meses.length > 1) filas.push(filaCompacta('Total', sede.total, { negrita: true, fondo: C.grisFondo }));
  return tablaCifras(doc, y, { titulo: 'Mes a mes', columnas: COLS_COMPACTAS('Mes'), filas });
};

const tablaEmpleados = (doc, y, sede) => {
  if (!sede.empleados.length) return y;
  const filas = sede.empleados.map((e) => filaCompacta(e.nombre, e));
  if (sede.empleados.length > 1) filas.push(filaCompacta('Total', sede.total, { negrita: true, fondo: C.grisFondo }));
  return tablaCifras(doc, y, {
    titulo: 'Por empleado (quien registró la operación)', columnas: COLS_COMPACTAS('Empleado'), filas,
  });
};

// ─── Lo que se debe, documento por documento ────────────────────────────────

const COLS_PEND = [
  { id: 'fecha', titulo: 'Fecha', w: 46 },
  { id: 'doc', titulo: 'Doc.', w: 40 },
  { id: 'persona', titulo: 'Persona', w: 92 },
  { id: 'producto', titulo: 'Producto', w: 108 },
  { id: 'empleado', titulo: 'Empleado', w: 53 },
  { id: 'valor', titulo: 'Valor', w: 51, align: 'right' },
  { id: 'pagado', titulo: 'Pagado', w: 50, align: 'right' },
  { id: 'debe', titulo: 'Debe', w: CONTENT_W - 440, align: 'right' },
];
const pX = (() => { const xs = {}; let x = MARGIN; for (const c of COLS_PEND) { xs[c.id] = x; x += c.w; } return xs; })();
const pW = (id) => COLS_PEND.find((c) => c.id === id).w - PAD * 2;

const cabeceraPend = (d, y) => {
  d.roundedRect(MARGIN, y, CONTENT_W, CAB_H, 8).fill(C.grisFondo);
  d.rect(MARGIN, y + 8, CONTENT_W, CAB_H - 8).fill(C.grisFondo);
  hLine(d, y + CAB_H, { color: C.grisBorde, width: 0.5 });
  for (const c of COLS_PEND) {
    textoAcotado(d, c.titulo.toUpperCase(), pX[c.id] + PAD, y + 7, pW(c.id),
      { font: FONT.bold, size: 6, color: C.gris, align: c.align || 'left', characterSpacing: 0.4 });
  }
};

const filaPend = (doc, f) => {
  const persona  = medirTexto(doc, f.persona, pW('persona'), { lineas: 2, font: FONT.bold, size: 7 });
  const extra    = f.persona_extra ? medirTexto(doc, f.persona_extra, pW('persona'), { lineas: 1, size: 6.2 }) : null;
  const producto = medirTexto(doc, f.productos, pW('producto'), { lineas: 3, size: 6.6 });
  const empleado = medirTexto(doc, f.empleado, pW('empleado'), { lineas: 2, size: 6.6 });
  const alto = Math.max(20, Math.max(persona.alto + (extra ? extra.alto + 1 : 0), producto.alto, empleado.alto) + 11);
  return {
    alto,
    dibujar: (d, y) => {
      const yt = y + 5.5;
      textoAcotado(d, f.fecha || '—', pX.fecha + PAD, yt, pW('fecha'), { size: 7, color: C.grisOscuro });
      textoAcotado(d, f.documento, pX.doc + PAD, yt, pW('doc'), { font: FONT.bold, size: 7 });
      const yp = yt + textoAcotado(d, persona.texto, pX.persona + PAD, yt, pW('persona'), { lineas: 2, font: FONT.bold, size: 7 });
      if (extra) textoAcotado(d, extra.texto, pX.persona + PAD, yp + 1, pW('persona'), { size: 6.2, color: C.gris });
      textoAcotado(d, producto.texto, pX.producto + PAD, yt, pW('producto'), { lineas: 3, size: 6.6 });
      textoAcotado(d, empleado.texto, pX.empleado + PAD, yt, pW('empleado'), { lineas: 2, size: 6.6, color: C.grisOscuro });
      textoAcotado(d, plata(f.valor), pX.valor + PAD, yt, pW('valor'), { size: 6.8, align: 'right' });
      textoAcotado(d, plata(f.pagado), pX.pagado + PAD, yt, pW('pagado'), { size: 6.8, align: 'right', color: C.verde });
      textoAcotado(d, plata(f.debe), pX.debe + PAD, yt, pW('debe'), { font: FONT.bold, size: 6.8, align: 'right', color: C.rojo });
    },
  };
};

const listaPendientes = (doc, y, sede) => {
  if (!sede.pendientes || !sede.pendientes.length) return y;
  for (const g of sede.pendientes) {
    const filas = g.documentos.map((f) => filaPend(doc, f));
    y = asegurarEspacio(doc, y, 30 + CAB_H + (filas[0]?.alto || 0));
    const color = COLOR_TIPO[g.color] || C.azul;
    rectFill(doc, MARGIN, y, CONTENT_W, 22, C.grisFondo, 6);
    doc.rect(MARGIN, y, 4, 22).fill(color);
    textoAcotado(doc, `Por cobrar · ${g.titulo}`, MARGIN + 12, y + 7, CONTENT_W * 0.6, { font: FONT.bold, size: 9, color });
    textoAcotado(doc, `${n(g.documentos.length)} documento${g.documentos.length !== 1 ? 's' : ''} · debe ${formatCOP(g.debe)}`,
      MARGIN + CONTENT_W * 0.45, y + 8, CONTENT_W * 0.55 - 10, { size: 7.5, align: 'right', color: C.grisOscuro });
    y += 30;
    y = tablaPaginada(doc, y, { cabeceraAlto: CAB_H, dibujarCabecera: cabeceraPend, filas, espacioDespues: 16 });
  }
  return y;
};

// ─── Documento ──────────────────────────────────────────────────────────────

/**
 * @param {object} p.reporte  salida de reporteSede.service.obtenerReporteSede
 * @param {object} p.config   mapa de config_negocio (con los datos de la sede si es una)
 */
const generarPdfReporteSede = ({ reporte, config = {} }) => {
  const periodo  = `${fechaCorta(reporte.desde)} – ${fechaCorta(reporte.hasta)}`;
  const generado = ahoraBogota();
  const detalle  = reporte.incluye_pendientes ? 'Resumen + lo que se debe' : 'Solo el resumen';

  const doc = new PDFDocument({
    size: 'A4', bufferPages: true,
    margins: { top: CONT_H + 18, bottom: PAGE_H - BODY_BOTTOM, left: MARGIN, right: MARGIN },
    info: { Title: `Reporte por sede · ${periodo}`, Author: config.nombre_negocio || 'Inventario', Subject: 'Reporte por sede' },
  });

  let actual = null;
  let hojaNueva = false;
  encabezadoContinuo(doc, (d) => {
    if (hojaNueva) return;
    rectFill(d, 0, 0, PAGE_W, CONT_H, C.headerBg, 0);
    textoAcotado(d, `${config.nombre_negocio || ''}  ·  ${actual || 'Reporte por sede'}`,
      MARGIN, 13, CONTENT_W * 0.65, { font: FONT.bold, size: 8, color: C.headerText });
    textoAcotado(d, periodo, MARGIN + CONTENT_W * 0.65, 13, CONTENT_W * 0.35,
      { size: 8, align: 'right', color: C.headerSub });
  });

  const portada = (nombre) => {
    const y = encabezado(doc, { config, titulo: 'Reporte por sede', subtitulo: periodo, franja: C.azul, headerH: 100 });
    return fichaSede(doc, y + 18, { nombre, periodo, generado, detalle });
  };
  const hoja = (i, nombre) => {
    actual = nombre;
    if (i > 0) { hojaNueva = true; doc.addPage(); hojaNueva = false; }
  };

  let i = 0;
  if (reporte.todas && reporte.consolidado) {
    hoja(i++, 'Todas las sedes');
    let y = portada('Todas las sedes');
    y = cifras(doc, y, reporte.consolidado);
    const filas = reporte.sedes.map((s) => filaCompacta(s.nombre, s.total));
    filas.push(filaCompacta('Total', reporte.consolidado, { negrita: true, fondo: C.grisFondo }));
    tablaCifras(doc, y, {
      titulo: 'Por sede', columnas: COLS_COMPACTAS('Sede'), filas,
      nota: 'Cada sede sigue en su propia hoja, con el detalle por tipo, mes y empleado.',
    });
  }

  for (const sede of reporte.sedes) {
    hoja(i++, sede.nombre);
    let y = portada(sede.nombre);
    if (sede.vacio) {
      textoAcotado(doc, `No hay ventas, créditos ni préstamos registrados en ${sede.nombre} en el período.`,
        MARGIN, y + 20, CONTENT_W, { font: FONT.bold, size: 10.5, align: 'center', color: C.gris });
      continue;
    }
    y = cifras(doc, y, sede.total);
    y = tablaUnidades(doc, y, sede);
    y = tablaPlata(doc, y, sede);
    y = tablaMeses(doc, y, sede);
    y = tablaEmpleados(doc, y, sede);
    y = listaPendientes(doc, y, sede);

    y = asegurarEspacio(doc, y, 30);
    hLine(doc, y, { color: C.grisBorde });
    textoAcotado(doc,
      'Documento informativo. Fecha de cada operación = la de la venta o el préstamo; su estado y lo pagado son los de la fecha de generación. '
      + 'No incluye la factura que genera un préstamo saldado (ya está contado como préstamo) ni los ajustes de deuda.',
      MARGIN, y + 8, CONTENT_W, { lineas: 3, size: 7, color: C.grisClaro });
  }

  pieDocumento(doc, { texto: `${config.nombre_negocio || ''} · Reporte por sede · ${periodo}` });
  doc.end();
  return doc;
};

module.exports = { generarPdfReporteSede };
