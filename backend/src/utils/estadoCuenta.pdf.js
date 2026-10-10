'use strict';

/**
 * PDF de ESTADO DE CUENTA — compartido por préstamos, créditos y la cuenta de
 * un local de la red interna.
 *
 * Este módulo solo DIBUJA. No consulta la base ni calcula saldos: recibe los
 * movimientos ya resueltos por el service del módulo correspondiente, que es la
 * única fuente de verdad del acumulado. Así el PDF no puede mostrar un número
 * distinto al de la pantalla.
 *
 * Cada movimiento debe traer:
 *   { fecha, tipo, concepto, cargo, abono, saldo, nota?, atenuado?, detalles? }
 *   · `saldo` en null  → el movimiento no entra al acumulado (se pinta "—").
 *   · `nota`           → sufijo entre paréntesis en el concepto ("Devuelto"…).
 *   · `atenuado`       → se pinta en gris (documento anulado/devuelto).
 *   · `detalles`       → renglones debajo del concepto: productos con su
 *                        variante e IMEI, quién registró, a qué se repartió un
 *                        pago total… Opcional: sin él la fila es la de siempre.
 *
 * Paginación: la tabla va por `tablaPaginada` (repite la cabecera en cada hoja)
 * y todo texto lleva alto fijo, así que PDFKit nunca abre una hoja por su
 * cuenta. Antes la tabla se dibujaba a mano con el documento en `margin: 0`, el
 * resumen final no medía si cabía y el marco se trazaba desde la primera hoja
 * hasta la última `y` — en un extracto largo salían hojas con solo el resumen
 * o con nada.
 */

const PDFDocument = require('pdfkit');
const {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W, BODY_BOTTOM, FONT, C,
  formatCOP, formatFecha, formatFechaHora,
  rectFill, rectFillStroke,
  encabezado, pieDocumento, asegurarEspacio, encabezadoContinuo,
  medirTexto, textoAcotado, tablaPaginada,
} = require('./pdf.base');
const { tablaResumenDeuda } = require('./resumenDeuda.pdf');

const HEADER_CONT_H = 40;
const CUERPO_TOP    = HEADER_CONT_H + 22;

const formatHora = (fecha) => {
  if (!fecha) return '';
  return new Date(fecha).toLocaleTimeString('es-CO', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota',
  });
};

// ─── Bloques ─────────────────────────────────────────────────────────────────

const _encabezadoContinuacion = (doc, titulo) => {
  rectFill(doc, 0, 0, PAGE_W, HEADER_CONT_H, C.headerBg, 0);
  textoAcotado(doc, titulo, MARGIN, 15, CONTENT_W,
    { font: FONT.bold, size: 9, color: C.headerText });
};

const _infoPersona = (doc, persona, subtitulo, saldoFinal, y) => {
  const H = 70;
  rectFillStroke(doc, MARGIN, y, CONTENT_W, H, C.grisFondo, C.grisBorde, 8);

  const avSize = 38;
  const avX = MARGIN + 14;
  const avY = y + (H - avSize) / 2;
  rectFill(doc, avX, avY, avSize, avSize, saldoFinal > 0 ? C.rojoFondo : C.verdeFondo, 10);
  textoAcotado(doc, (persona.nombre || '?').slice(0, 2).toUpperCase(), avX, avY + 12, avSize,
    { font: FONT.bold, size: 13, color: saldoFinal > 0 ? C.rojo : C.verde, align: 'center' });

  const dataX = avX + avSize + 12;
  const dataW = CONTENT_W - (dataX - MARGIN) - 120;
  textoAcotado(doc, persona.nombre || '', dataX, y + 12, dataW,
    { font: FONT.bold, size: 11, color: C.negro });
  textoAcotado(doc, subtitulo || '', dataX, y + 27, dataW, { size: 8, color: C.gris, lineas: 2 });
  if (persona.cedula || persona.celular) {
    const datos = [persona.cedula && `CC: ${persona.cedula}`, persona.celular && `Tel: ${persona.celular}`]
      .filter(Boolean).join('  ·  ');
    textoAcotado(doc, datos, dataX, y + 48, dataW, { size: 8, color: C.gris });
  }

  const saldoX = PAGE_W - MARGIN - 14;
  textoAcotado(doc, 'Saldo deuda', saldoX - 110, y + 18, 110,
    { size: 7.5, color: C.grisClaro, align: 'right' });
  textoAcotado(doc, formatCOP(saldoFinal), saldoX - 110, y + 30, 110,
    { font: FONT.bold, size: 12, color: saldoFinal > 0 ? C.rojo : C.verde, align: 'right' });

  return y + H + 16;
};

// Fecha(62) + Justificación + −(66) + +(66) + Saldo(80) = CONTENT_W
const COL = (() => {
  const F = 62, M = 66, P = 66, S = 80;
  const J = CONTENT_W - F - M - P - S;
  return {
    F: { x: MARGIN,                 w: F },
    J: { x: MARGIN + F,             w: J },
    M: { x: MARGIN + F + J,         w: M },
    P: { x: MARGIN + F + J + M,     w: P },
    S: { x: MARGIN + F + J + M + P, w: S },
  };
})();

const HEAD_H = 24;
const BADGE_W = 54;
const BADGE_H = 12;
const OPT_CONCEPTO = { size: 8, lineas: 6 };
const OPT_DETALLE  = { size: 6.8, lineas: 30, lineGap: 0.5 };

const _tabla = (doc, movimientos, tipoLabels, y) => {
  const fallback = Object.values(tipoLabels)[0] || { label: '', bg: C.grisFondo, text: C.gris };

  const cabecera = (d, yc) => {
    rectFill(d, MARGIN, yc, CONTENT_W, HEAD_H, C.negro, 6);
    d.rect(MARGIN, yc + 12, CONTENT_W, HEAD_H - 12).fill(C.negro);
    const o = { font: FONT.bold, size: 7.5, color: C.blanco };
    textoAcotado(d, 'Fecha y hora',  COL.F.x + 6, yc + 8.5, COL.F.w - 8, o);
    textoAcotado(d, 'Justificación', COL.J.x + 4, yc + 8.5, COL.J.w - 8, o);
    textoAcotado(d, '-', COL.M.x + 4, yc + 8.5, COL.M.w - 8, { ...o, color: C.verde, align: 'right' });
    textoAcotado(d, '+', COL.P.x + 4, yc + 8.5, COL.P.w - 8, { ...o, color: C.naranja, align: 'right' });
    textoAcotado(d, 'Saldo', COL.S.x + 4, yc + 8.5, COL.S.w - 10, { ...o, align: 'right' });
  };

  const conceptoW = COL.J.w - BADGE_W - 12;
  const detalleW  = COL.J.w - 10;

  const filas = movimientos.map((mov) => {
    const tipoCfg  = tipoLabels[mov.tipo] || fallback;
    const concepto = mov.nota ? `${mov.concepto || ''} (${mov.nota})` : (mov.concepto || '');
    const detalles = (Array.isArray(mov.detalles) ? mov.detalles : []).filter(Boolean);
    const textoDet = detalles.join('\n');

    // Todo se mide antes de dibujar: tablaPaginada decide con estos altos si la
    // fila cabe en lo que queda de la hoja.
    const altoConcepto = medirTexto(doc, concepto, conceptoW, OPT_CONCEPTO).alto;
    const altoDetalle  = textoDet ? medirTexto(doc, textoDet, detalleW, OPT_DETALLE).alto + 3 : 0;
    const altoCuerpo   = Math.max(BADGE_H, altoConcepto) + altoDetalle;
    const alto = Math.max(28, altoCuerpo + 14);

    return {
      alto,
      dibujar: (d, yf) => {
        const atenuado = !!mov.atenuado;
        const esCargo  = !!mov.cargo;

        textoAcotado(d, formatFecha(mov.fecha), COL.F.x + 6, yf + 7, COL.F.w - 8,
          { size: 7.5, color: C.grisOscuro });
        textoAcotado(d, formatHora(mov.fecha), COL.F.x + 6, yf + 17, COL.F.w - 8,
          { size: 7, color: C.grisClaro });

        rectFill(d, COL.J.x + 4, yf + 6, BADGE_W, BADGE_H, tipoCfg.bg, 6);
        textoAcotado(d, tipoCfg.label, COL.J.x + 4, yf + 9, BADGE_W,
          { font: FONT.bold, size: 6.5, color: tipoCfg.text, align: 'center' });

        textoAcotado(d, concepto, COL.J.x + BADGE_W + 8, yf + 7, conceptoW,
          { ...OPT_CONCEPTO, color: atenuado ? C.grisClaro : C.negro });
        if (textoDet) {
          textoAcotado(d, textoDet, COL.J.x + 6, yf + 7 + Math.max(BADGE_H, altoConcepto) + 3, detalleW,
            { ...OPT_DETALLE, color: atenuado ? C.grisClaro : C.gris });
        }

        const monto = (txt, col, color, font = FONT.normal) =>
          textoAcotado(d, txt, col.x + 4, yf + 7, col.w - 8, { font, size: 8, color, align: 'right' });

        // − abonos (reducen deuda) · + cargos (aumentan deuda)
        if (!esCargo && mov.abono) monto(formatCOP(mov.abono), COL.M, atenuado ? C.grisClaro : C.verde);
        else monto('—', COL.M, C.grisBorde);
        if (esCargo) monto(formatCOP(mov.cargo), COL.P, atenuado ? C.grisClaro : C.naranja);
        else monto('—', COL.P, C.grisBorde);

        if (mov.saldo != null) {
          monto(formatCOP(mov.saldo), { x: COL.S.x, w: COL.S.w - 2 },
            mov.saldo > 0 ? C.rojo : C.verde, FONT.bold);
        } else {
          monto('—', { x: COL.S.x, w: COL.S.w - 2 }, C.grisClaro);
        }
      },
    };
  });

  return tablaPaginada(doc, y, {
    cabeceraAlto: HEAD_H,
    dibujarCabecera: cabecera,
    filas,
    radio: 6,
    alterna: C.grisFondo,
    espacioDespues: 14,
  });
};

const _resumen = (doc, movimientos, saldoFinal, y) => {
  const totalCargos = movimientos.filter((m) => m.cargo).reduce((s, m) => s + Number(m.cargo), 0);
  const totalAbonos = movimientos.filter((m) => m.abono).reduce((s, m) => s + Number(m.abono), 0);
  const nCargos     = movimientos.filter((m) => m.cargo).length;
  const nAbonos     = movimientos.filter((m) => m.abono).length;

  const H = 64;
  y = asegurarEspacio(doc, y, H);
  rectFillStroke(doc, MARGIN, y, CONTENT_W, H, C.grisFondo, C.grisBorde, 8);

  textoAcotado(doc, 'Resumen', MARGIN + 14, y + 10, 200, { font: FONT.bold, size: 9, color: C.negro });

  const statW = (CONTENT_W - 28) / 4;
  const stats = [
    { label: 'Movimientos',         value: String(movimientos.length), color: C.negro   },
    { label: `Cargos (${nCargos})`, value: formatCOP(totalCargos),     color: C.naranja },
    { label: `Abonos (${nAbonos})`, value: formatCOP(totalAbonos),     color: C.verde   },
    { label: 'Saldo final',         value: formatCOP(saldoFinal),      color: saldoFinal > 0 ? C.rojo : C.verde },
  ];

  stats.forEach((s, i) => {
    const sx = MARGIN + 14 + i * statW;
    textoAcotado(doc, s.label, sx, y + 28, statW - 4, { size: 7.5, color: C.grisClaro });
    textoAcotado(doc, s.value, sx, y + 40, statW - 4, { font: FONT.bold, size: 9.5, color: s.color });
  });

  return y + H;
};

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * @param {object}   opts
 * @param {object}   opts.persona      — { nombre, cedula, celular }
 * @param {string}   opts.subtitulo    — 'Cliente' | 'Prestatario' …
 * @param {Array}    opts.movimientos  — ya calculados por el service del módulo
 * @param {number}   opts.saldoFinal   — saldo acumulado final
 * @param {object}   opts.config       — config_negocio como objeto clave→valor
 * @param {string}   [opts.logoNegocio]
 * @param {object}   opts.tipoLabels   — tipo → { label, bg, text }
 * @param {string}   [opts.negocioNombre]
 * @param {object}   [opts.resumenDeuda] — tabla de apertura (utils/resumenDeuda.pdf):
 *                   { titulo, filas, totales, nota }. Sin ella, el PDF de siempre.
 * @returns {PDFDocument} stream ya finalizado (doc.end() incluido)
 */
const construirPdfEstadoCuenta = ({
  persona, subtitulo, movimientos, saldoFinal,
  config, logoNegocio, tipoLabels, negocioNombre,
  resumenDeuda = null,
}) => {
  // Los márgenes son parte del contrato (ver pdf.base): `top` = alto del
  // encabezado de continuación y `bottom` = la franja del pie. Con `margin: 0`
  // el borde inferior útil era el filo del papel y cualquier texto que cayera
  // abajo se llevaba una hoja nueva.
  const doc = new PDFDocument({
    size: 'A4', bufferPages: true,
    margins: { top: CUERPO_TOP, bottom: PAGE_H - BODY_BOTTOM, left: MARGIN, right: MARGIN },
    info: { Title: `Estado de cuenta — ${persona.nombre}`, Author: negocioNombre || 'Mi Negocio' },
  });

  const generado = formatFechaHora(new Date());
  const configEnc = { ...(config || {}), nombre_negocio: config?.nombre_negocio || negocioNombre };
  let y = encabezado(doc, {
    config: configEnc, logo: logoNegocio || null,
    titulo: 'Estado de cuenta', subtitulo: `Generado: ${generado}`,
  });
  encabezadoContinuo(doc, (d) =>
    _encabezadoContinuacion(d, `Estado de cuenta · ${persona.nombre || ''}`));

  y += 16;
  y  = _infoPersona(doc, persona, subtitulo, saldoFinal, y);

  // La tabla que lo resume todo —qué debe, de qué, y el valor a cobrar— va
  // antes del extracto: es lo que se busca primero y queda en la primera hoja.
  if (resumenDeuda) {
    y = tablaResumenDeuda(doc, y, resumenDeuda);
    y = asegurarEspacio(doc, y, 80);
  }

  if (movimientos.length === 0) {
    textoAcotado(doc, 'Sin movimientos registrados.', MARGIN, y + 20, CONTENT_W,
      { size: 10, color: C.grisClaro, align: 'center' });
  } else {
    textoAcotado(doc, `Movimientos (${movimientos.length})`, MARGIN, y, CONTENT_W,
      { font: FONT.bold, size: 9, color: C.negro });
    y += 14;
    y  = _tabla(doc, movimientos, tipoLabels, y);
    _resumen(doc, movimientos, saldoFinal, y);
  }

  pieDocumento(doc, {
    texto: `Estado de cuenta · ${persona.nombre || ''} · Generado el ${generado}`,
  });
  doc.end();
  return doc;
};

module.exports = { construirPdfEstadoCuenta, formatHora };
