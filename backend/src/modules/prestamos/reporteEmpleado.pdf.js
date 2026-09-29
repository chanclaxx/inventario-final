'use strict';
// src/modules/prestamos/reporteEmpleado.pdf.js
// ─────────────────────────────────────────────────────────────────────────────
// PDF del reporte por empleado. SOLO DIBUJA: los datos (y su clasificación por
// tipo y estado) vienen armados de `reporteEmpleado.service`.
//
// Estructura, por empleado:
//   encabezado → ficha del empleado → resumen (unidades por tipo y estado) →
//   un bloque por tipo (contado, crédito, préstamo a cliente, a compañero) →
//   dentro, una tabla por estado (pagados, pendientes, devolución parcial,
//   devueltos, cancelados).
//
// No suma plata: el resumen cuenta UNIDADES para ubicarse, y la liquidación la
// hacen el empleado y el jefe (decisión del negocio). Con «todos», cada
// empleado arranca en su propia hoja para poder entregarla por separado.
//
// Todo pasa por las primitivas de `pdf.base` (tablaPaginada, textoAcotado,
// asegurarEspacio): ningún salto de página lo decide PDFKit.
// ─────────────────────────────────────────────────────────────────────────────
const PDFDocument = require('pdfkit');
const {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W, BODY_BOTTOM, FONT, C, TONOS,
  formatCOP, rectFill, rectFillStroke, hLine,
  encabezado, badgeEstado, pieDocumento, asegurarEspacio,
  encabezadoContinuo, medirTexto, textoAcotado, tablaPaginada,
} = require('../../utils/pdf.base');
const { TIPOS, GRUPOS, tituloGrupo } = require('./reporteEmpleado.service');

const COLOR_TIPO = {
  azul:    { fg: C.azul,    bg: C.azulFondo,    borde: C.azulBorde    },
  morado:  { fg: C.morado,  bg: C.moradoFondo,  borde: C.moradoBorde  },
  naranja: { fg: C.naranja, bg: C.naranjaFondo, borde: C.naranjaBorde },
  verde:   { fg: C.verde,   bg: C.verdeFondo,   borde: C.verdeBorde   },
};

// Alto de la franja que se repite arriba de cada hoja de continuación.
const CONT_H = 34;

const fechaCorta = (iso) => {
  const [a, m, d] = String(iso || '').split('-');
  return a && m && d ? `${d}/${m}/${a}` : String(iso || '');
};

const ahoraBogota = () => new Date().toLocaleString('es-CO', {
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota',
});

// ─── Columnas de las tablas ─────────────────────────────────────────────────
// Suman CONTENT_W exacto: una columna de más se sale del marco en silencio.
const COLS = [
  { id: 'fecha',    titulo: 'Fecha',             w: 50 },
  { id: 'doc',      titulo: 'Doc.',              w: 40 },
  { id: 'persona',  titulo: 'Cliente / persona', w: 104 },
  { id: 'producto', titulo: 'Producto',          w: 124 },
  { id: 'cant',     titulo: 'Cant.',             w: 34, align: 'center' },
  { id: 'valor',    titulo: 'Valor',             w: 60, align: 'right' },
  { id: 'detalle',  titulo: 'Detalle',           w: CONTENT_W - 412 },
];
const PAD = 5;
const colX = (() => {
  const xs = {};
  let x = MARGIN;
  for (const c of COLS) { xs[c.id] = x; x += c.w; }
  return xs;
})();
const colW = Object.fromEntries(COLS.map((c) => [c.id, c.w]));
const anchoUtil = (id) => colW[id] - PAD * 2;

const CABECERA_H = 20;

const dibujarCabeceraTabla = (doc, y) => {
  doc.roundedRect(MARGIN, y, CONTENT_W, CABECERA_H, 8).fill(C.grisFondo);
  doc.rect(MARGIN, y + 8, CONTENT_W, CABECERA_H - 8).fill(C.grisFondo);
  hLine(doc, y + CABECERA_H, { color: C.grisBorde, width: 0.5 });
  for (const c of COLS) {
    textoAcotado(doc, c.titulo.toUpperCase(), colX[c.id] + PAD, y + 7, anchoUtil(c.id), {
      font: FONT.bold, size: 6.3, color: C.gris, align: c.align || 'left', characterSpacing: 0.5,
    });
  }
};

const textoDetalle = (d) => (typeof d === 'string' ? d : `${d.etiqueta}: ${formatCOP(d.valor)}`);

/** Mide y prepara una fila: el alto tiene que saberse ANTES de dibujarla. */
const prepararFila = (doc, f, tonoGrupo) => {
  const nombre   = medirTexto(doc, f.persona, anchoUtil('persona'), { lineas: 2, font: FONT.bold, size: 7.5 });
  const extra    = f.persona_extra
    ? medirTexto(doc, f.persona_extra, anchoUtil('persona'), { lineas: 2, size: 6.5 }) : null;
  const producto = medirTexto(doc, f.producto, anchoUtil('producto'), { lineas: 2, size: 7.5 });
  const imei     = f.imei ? medirTexto(doc, `IMEI ${f.imei}`, anchoUtil('producto'), { lineas: 1, size: 6.5 }) : null;
  const detalles = (f.detalle || []).map((d) =>
    ({ d, m: medirTexto(doc, textoDetalle(d), anchoUtil('detalle'), { lineas: 3, size: 6.6 }) }));

  const altoPersona  = nombre.alto + (extra ? 2 + extra.alto : 0);
  const altoProducto = producto.alto + (imei ? 2 + imei.alto : 0);
  const altoDetalle  = detalles.reduce((s, x) => s + x.m.alto + 1.5, 0);
  const alto = Math.max(22, Math.max(altoPersona, altoProducto, altoDetalle, 9) + 12);

  return {
    alto,
    dibujar: (d, y) => {
      const yt = y + 6;
      textoAcotado(d, f.fecha || '—', colX.fecha + PAD, yt, anchoUtil('fecha'), { size: 7.5, color: C.grisOscuro });
      textoAcotado(d, f.documento, colX.doc + PAD, yt, anchoUtil('doc'), { font: FONT.bold, size: 7.5 });

      let yp = yt;
      yp += textoAcotado(d, nombre.texto, colX.persona + PAD, yp, anchoUtil('persona'),
        { lineas: 2, font: FONT.bold, size: 7.5 });
      if (extra) {
        textoAcotado(d, extra.texto, colX.persona + PAD, yp + 2, anchoUtil('persona'),
          { lineas: 2, size: 6.5, color: C.gris });
      }

      let yr = yt;
      yr += textoAcotado(d, producto.texto, colX.producto + PAD, yr, anchoUtil('producto'),
        { lineas: 2, size: 7.5 });
      if (imei) {
        textoAcotado(d, imei.texto, colX.producto + PAD, yr + 2, anchoUtil('producto'),
          { size: 6.5, color: C.gris });
      }

      textoAcotado(d, String(f.cantidad ?? 1), colX.cant + PAD, yt, anchoUtil('cant'),
        { size: 7.5, align: 'center' });
      textoAcotado(d, f.obsequio ? 'Obsequio' : formatCOP(f.valor), colX.valor + PAD, yt, anchoUtil('valor'),
        { font: FONT.bold, size: 7.5, align: 'right', color: f.obsequio ? C.gris : C.negro });

      let yd = yt;
      for (const { d: det, m } of detalles) {
        // Lo que se debe va en el color del grupo: es lo primero que se busca.
        const color = typeof det === 'string' ? C.gris : (TONOS[tonoGrupo]?.fg || C.grisOscuro);
        yd += textoAcotado(d, m.texto, colX.detalle + PAD, yd, anchoUtil('detalle'),
          { lineas: 3, size: 6.6, color, font: typeof det === 'string' ? FONT.normal : FONT.bold }) + 1.5;
      }
    },
  };
};

// ─── Bloques ────────────────────────────────────────────────────────────────

const fichaEmpleado = (doc, y, { empleado, reporte, generado }) => {
  const h = 62;
  rectFillStroke(doc, MARGIN, y, CONTENT_W, h, C.grisFondo, C.grisBorde, 8);

  doc.font(FONT.bold).fontSize(6.5).fillColor(C.grisClaro)
    .text('EMPLEADO', MARGIN + 14, y + 11, { characterSpacing: 1.2, lineBreak: false });
  textoAcotado(doc, empleado.nombre, MARGIN + 14, y + 22, CONTENT_W * 0.58,
    { font: FONT.bold, size: 15, color: C.negro });
  textoAcotado(doc, [reporte.sucursal_nombre ? `Sucursal ${reporte.sucursal_nombre}` : null,
    `${fechaCorta(reporte.desde)} – ${fechaCorta(reporte.hasta)}`].filter(Boolean).join('  ·  '),
  MARGIN + 14, y + 43, CONTENT_W * 0.6, { size: 8, color: C.gris });

  const xd = MARGIN + CONTENT_W * 0.62;
  const wd = CONTENT_W * 0.38 - 14;
  doc.font(FONT.bold).fontSize(6.5).fillColor(C.grisClaro)
    .text('INCLUYE', xd, y + 11, { width: wd, align: 'right', characterSpacing: 1.2, lineBreak: false });
  textoAcotado(doc, reporte.solo_equipos ? 'Solo equipos con IMEI' : 'Todos los productos',
    xd, y + 23, wd, { font: FONT.bold, size: 8.5, align: 'right', color: C.grisOscuro });
  textoAcotado(doc, `Generado el ${generado}`, xd, y + 43, wd, { size: 7, align: 'right', color: C.grisClaro });

  return y + h + 16;
};

/** Unidades por tipo y estado. Sirve para ubicarse, no para liquidar. */
const resumen = (doc, y, empleado) => {
  const colTipo = 150;
  const colW2 = (CONTENT_W - colTipo) / (GRUPOS.length + 1);
  const filaH = 18;
  y = asegurarEspacio(doc, y, 16 + CABECERA_H + filaH * TIPOS.length + 10);

  doc.font(FONT.bold).fontSize(7).fillColor(C.grisClaro)
    .text('RESUMEN · UNIDADES POR ESTADO', MARGIN, y, { characterSpacing: 1.2, lineBreak: false });
  y += 14;

  const filas = empleado.secciones.map((s) => {
    const color = COLOR_TIPO[s.color] || COLOR_TIPO.azul;
    return {
      alto: filaH,
      dibujar: (d, yf) => {
        d.circle(MARGIN + 12, yf + filaH / 2, 3).fill(color.fg);
        textoAcotado(d, s.titulo, MARGIN + 21, yf + 5.5, colTipo - 26, { font: FONT.bold, size: 7.5 });
        GRUPOS.forEach((g, i) => {
          const n = s.grupos.find((x) => x.id === g.id)?.filas
            .reduce((acc, f) => acc + (f.cantidad || 0), 0) || 0;
          textoAcotado(d, n ? String(n) : '–', MARGIN + colTipo + colW2 * i, yf + 5.5, colW2,
            { size: 7.5, align: 'center', color: n ? (TONOS[g.tono]?.fg || C.negro) : C.grisBorde,
              font: n ? FONT.bold : FONT.normal });
        });
        textoAcotado(d, String(s.unidades || '–'), MARGIN + colTipo + colW2 * GRUPOS.length, yf + 5.5, colW2,
          { size: 7.5, align: 'center', font: FONT.bold, color: s.unidades ? C.negro : C.grisBorde });
      },
    };
  });

  return tablaPaginada(doc, y, {
    cabeceraAlto: CABECERA_H,
    dibujarCabecera: (d, yc) => {
      d.roundedRect(MARGIN, yc, CONTENT_W, CABECERA_H, 8).fill(C.grisFondo);
      d.rect(MARGIN, yc + 8, CONTENT_W, CABECERA_H - 8).fill(C.grisFondo);
      textoAcotado(d, 'TIPO', MARGIN + 21, yc + 7, colTipo - 26,
        { font: FONT.bold, size: 6, color: C.gris, characterSpacing: 0.5 });
      const titulos = [...GRUPOS.map((g) => g.corto || g.titulo), 'Total'];
      titulos.forEach((t, i) => {
        textoAcotado(d, t.toUpperCase(), MARGIN + colTipo + colW2 * i + 2, yc + 3.5, colW2 - 4,
          { lineas: 2, font: FONT.bold, size: 5.8, color: C.gris, align: 'center', characterSpacing: 0.3 });
      });
    },
    filas,
    espacioDespues: 20,
  });
};

const tituloTipo = (doc, y, seccion) => {
  const color = COLOR_TIPO[seccion.color] || COLOR_TIPO.azul;
  const h = 26;
  rectFill(doc, MARGIN, y, CONTENT_W, h, color.bg, 6);
  doc.rect(MARGIN, y, 4, h).fill(color.fg);
  textoAcotado(doc, seccion.titulo, MARGIN + 14, y + 8, CONTENT_W * 0.6,
    { font: FONT.bold, size: 10.5, color: color.fg });
  const cuenta = seccion.total_filas === 0
    ? 'Sin movimientos'
    : `${seccion.total_filas} registro${seccion.total_filas !== 1 ? 's' : ''} · ${seccion.unidades} unidad${seccion.unidades !== 1 ? 'es' : ''}`;
  textoAcotado(doc, cuenta, MARGIN + CONTENT_W * 0.5, y + 9.5, CONTENT_W * 0.5 - 12,
    { size: 7.5, align: 'right', color: C.grisOscuro });
  return y + h + 10;
};

const bloqueTipo = (doc, y, seccion) => {
  if (seccion.total_filas === 0) {
    y = asegurarEspacio(doc, y, 26 + 22);
    y = tituloTipo(doc, y, seccion);
    textoAcotado(doc, 'No hubo movimientos de este tipo en el período.', MARGIN + 14, y - 2, CONTENT_W - 28,
      { size: 7.5, color: C.grisClaro });
    return y + 20;
  }

  let primero = true;
  for (const g of seccion.grupos) {
    const filas = g.filas.map((f) => prepararFila(doc, f, g.tono));
    // El título del tipo, el del grupo, la cabecera y la primera fila van
    // juntos: un título solo al pie de una hoja es un título huérfano.
    const reservaTitulo = primero ? 36 : 0;
    y = asegurarEspacio(doc, y, reservaTitulo + 28 + CABECERA_H + (filas[0]?.alto || 0));
    if (primero) { y = tituloTipo(doc, y, seccion); primero = false; }

    badgeEstado(doc, g.titulo, g.tono, MARGIN, y, { w: 150, h: 18 });
    const unidades = g.filas.reduce((s, f) => s + (f.cantidad || 0), 0);
    textoAcotado(doc,
      `${g.filas.length} registro${g.filas.length !== 1 ? 's' : ''} · ${unidades} unidad${unidades !== 1 ? 'es' : ''}`,
      MARGIN + 160, y + 5, CONTENT_W - 160, { size: 7.5, color: C.gris });
    y += 26;

    y = tablaPaginada(doc, y, {
      cabeceraAlto: CABECERA_H,
      dibujarCabecera: dibujarCabeceraTabla,
      filas,
      espacioDespues: 16,
    });
  }
  return y + 8;
};

// ─── Documento ──────────────────────────────────────────────────────────────

/**
 * @param {object} p
 * @param {object} p.reporte  salida de reporteEmpleado.service.obtenerReporte
 * @param {object} p.config   mapa de config_negocio (con los datos de la sede)
 * @returns {PDFDocument} ya cerrado con `end()`, listo para `pipe`.
 */
const generarPdfReporteEmpleado = ({ reporte, config = {} }) => {
  const periodo  = `${fechaCorta(reporte.desde)} – ${fechaCorta(reporte.hasta)}`;
  const generado = ahoraBogota();
  const titulo   = reporte.todos || reporte.empleados.length !== 1
    ? 'Reporte por empleado'
    : `Reporte de ${reporte.empleados[0].nombre}`;

  const doc = new PDFDocument({
    size: 'A4', bufferPages: true,
    // top = franja de continuación, bottom = pie: así el único salto que PDFKit
    // pudiera hacer solo aterriza en el mismo sitio que los nuestros.
    margins: { top: CONT_H + 18, bottom: PAGE_H - BODY_BOTTOM, left: MARGIN, right: MARGIN },
    info: { Title: `${titulo} · ${periodo}`, Author: config.nombre_negocio || 'Inventario', Subject: 'Reporte por empleado' },
  });

  // Nombre del empleado en curso y si la hoja nueva es de continuación o
  // arranca a otro empleado (esa lleva el encabezado completo).
  let actual = null;
  let hojaNuevaEmpleado = false;
  encabezadoContinuo(doc, (d) => {
    if (hojaNuevaEmpleado) return;
    rectFill(d, 0, 0, PAGE_W, CONT_H, C.headerBg, 0);
    textoAcotado(d, `${config.nombre_negocio || ''}  ·  ${actual || 'Reporte por empleado'}`,
      MARGIN, 13, CONTENT_W * 0.65, { font: FONT.bold, size: 8, color: C.headerText });
    textoAcotado(d, periodo, MARGIN + CONTENT_W * 0.65, 13, CONTENT_W * 0.35,
      { size: 8, align: 'right', color: C.headerSub });
  });

  const portada = (empleado) => {
    let y = encabezado(doc, {
      config, titulo: 'Reporte por empleado', subtitulo: periodo, franja: C.azul, headerH: 100,
    });
    y += 18;
    return fichaEmpleado(doc, y, { empleado, reporte, generado });
  };

  if (!reporte.empleados.length) {
    let y = encabezado(doc, { config, titulo: 'Reporte por empleado', subtitulo: periodo, franja: C.azul, headerH: 100 });
    y += 40;
    textoAcotado(doc, 'No hay ventas, créditos ni préstamos registrados en el período.', MARGIN, y, CONTENT_W,
      { font: FONT.bold, size: 11, align: 'center', color: C.gris });
    textoAcotado(doc, `${reporte.sucursal_nombre ? `Sucursal ${reporte.sucursal_nombre} · ` : ''}${periodo}`,
      MARGIN, y + 20, CONTENT_W, { size: 8.5, align: 'center', color: C.grisClaro });
  }

  reporte.empleados.forEach((empleado, i) => {
    actual = empleado.nombre;
    if (i > 0) {
      hojaNuevaEmpleado = true;
      doc.addPage();
      hojaNuevaEmpleado = false;
    }
    let y = portada(empleado);
    y = resumen(doc, y, empleado);
    for (const seccion of empleado.secciones) y = bloqueTipo(doc, y, seccion);

    // Cierre: deja escrito que el documento no liquida nada.
    y = asegurarEspacio(doc, y, 30);
    hLine(doc, y, { color: C.grisBorde });
    textoAcotado(doc,
      'Documento informativo. Muestra los movimientos y su estado a la fecha de generación; no calcula comisiones ni liquidaciones.',
      MARGIN, y + 8, CONTENT_W, { lineas: 2, size: 7, color: C.grisClaro });
  });

  pieDocumento(doc, { texto: `${config.nombre_negocio || ''} · Reporte por empleado · ${periodo}` });
  doc.end();
  return doc;
};

module.exports = { generarPdfReporteEmpleado, COLS };
