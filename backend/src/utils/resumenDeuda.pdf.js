'use strict';

/**
 * RESUMEN DE LO QUE SE DEBE — la tabla que abre los PDF de préstamos y
 * créditos (pedido del usuario, 10-oct-2026: «una tabla al principio que
 * resuma el contenido, para no tener que revisar todo el PDF»).
 *
 * Una fila por producto: fecha y hora, cantidad, producto, variante, línea,
 * precio unitario, total y lo que falta por pagar. Arriba de la tabla, las
 * cifras que se leen primero —subtotal, lo abonado, los cargos y el VALOR A
 * COBRAR— para que queden SIEMPRE en la primera hoja aunque la tabla sea larga.
 *
 * Solo DIBUJA: las cifras llegan calculadas por quien llama, con las mismas
 * reglas de la pantalla (capital = valor − abonado; mora e interés aparte).
 *
 * Fila: { fecha, referencia, cantidad, producto, detalle?, variante, linea,
 *         unitario, total, debe }   · `debe` null = la celda va vacía (en una
 *         factura de varias líneas la deuda es de la FACTURA, no de la línea:
 *         va una sola vez, en su última línea).
 */

const {
  MARGIN, CONTENT_W, FONT, C,
  formatCOP, formatFecha,
  rectFill, rectFillStroke,
  labelSeccion, asegurarEspacio, medirTexto, textoAcotado, tablaPaginada,
} = require('./pdf.base');

const formatHora = (fecha) => (fecha ? new Date(fecha).toLocaleTimeString('es-CO', {
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota',
}) : '');

// Fecha(58) Cant(30) Producto(104) Variante(74) Línea(52) V.unit(56) Total(58) Debe(resto)
const COLS = (() => {
  const anchos = [58, 30, 104, 74, 52, 56, 58];
  anchos.push(CONTENT_W - anchos.reduce((s, w) => s + w, 0));
  const claves = ['fecha', 'cant', 'producto', 'variante', 'linea', 'unit', 'total', 'debe'];
  let x = MARGIN;
  return Object.fromEntries(claves.map((k, i) => {
    const c = { x, w: anchos[i] };
    x += anchos[i];
    return [k, c];
  }));
})();

const HEAD_H = 22;
const PAD = 5;
const OPT_PROD = { font: FONT.bold, size: 7, lineas: 4, color: C.negro };
const OPT_DET  = { size: 6.2, lineas: 2, color: C.gris };
const OPT_TXT  = { size: 7, lineas: 4, color: C.grisOscuro };

/** Cifras de cierre: van ANTES de la tabla para quedar en la primera hoja. */
const _tarjetaTotales = (doc, y, totales) => {
  const stats = [
    ['Subtotal', formatCOP(totales.subtotal), C.negro],
    [totales.abonadoLabel || 'Abonado', `- ${formatCOP(totales.abonado)}`, C.verde],
  ];
  if (totales.cargos > 0) stats.push(['Interés y mora', `+ ${formatCOP(totales.cargos)}`, C.naranja]);

  const H = 50;
  y = asegurarEspacio(doc, y, H);
  rectFillStroke(doc, MARGIN, y, CONTENT_W, H, C.grisFondo, C.grisBorde, 8);

  // El valor a cobrar ocupa el bloque de la derecha, resaltado.
  const anchoCobrar = 150;
  rectFill(doc, MARGIN + CONTENT_W - anchoCobrar, y, anchoCobrar, H, totales.cobrar > 0 ? C.rojo : C.verde, 8);
  textoAcotado(doc, 'VALOR A COBRAR', MARGIN + CONTENT_W - anchoCobrar + 12, y + 11, anchoCobrar - 24,
    { font: FONT.bold, size: 7.5, color: C.blanco, characterSpacing: 0.8 });
  textoAcotado(doc, formatCOP(totales.cobrar), MARGIN + CONTENT_W - anchoCobrar + 12, y + 24, anchoCobrar - 24,
    { font: FONT.bold, size: 15, color: C.blanco });

  const w = (CONTENT_W - anchoCobrar - 16) / stats.length;
  stats.forEach(([label, valor, color], i) => {
    const x = MARGIN + 12 + i * w;
    textoAcotado(doc, label.toUpperCase(), x, y + 12, w - 6, { size: 6.8, color: C.gris, characterSpacing: 0.4 });
    textoAcotado(doc, valor, x, y + 25, w - 6, { font: FONT.bold, size: 10, color });
  });
  return y + H + 10;
};

/**
 * @param {object} opts
 * @param {string} opts.titulo
 * @param {Array}  opts.filas      ver arriba
 * @param {object} opts.totales    { subtotal, abonado, abonadoLabel?, cargos, cobrar, cantidad }
 * @param {string} [opts.nota]     renglón aclaratorio bajo la tabla
 * @returns {number} y libre debajo
 */
const tablaResumenDeuda = (doc, y, { titulo = 'Resumen', filas = [], totales, nota = null }) => {
  y = labelSeccion(doc, y, titulo, { reservar: 50 + HEAD_H + 30 });
  y = _tarjetaTotales(doc, y, totales);

  const cabecera = (d, yc) => {
    rectFill(d, MARGIN, yc, CONTENT_W, HEAD_H, C.negro, 6);
    d.rect(MARGIN, yc + 12, CONTENT_W, HEAD_H - 12).fill(C.negro);
    const o = { font: FONT.bold, size: 6.8, color: C.blanco };
    const t = (txt, c, align = 'left') => textoAcotado(d, txt, c.x + PAD, yc + 8, c.w - PAD * 2, { ...o, align });
    t('Fecha y hora', COLS.fecha);
    t('Cant.', COLS.cant, 'right');
    t('Producto', COLS.producto);
    t('Variante', COLS.variante);
    t('Línea', COLS.linea);
    t('V. unitario', COLS.unit, 'right');
    t('Total', COLS.total, 'right');
    t('Debe', COLS.debe, 'right');
  };

  const filasDibujo = filas.map((f) => {
    const wProd = COLS.producto.w - PAD * 2;
    const altoProd = medirTexto(doc, f.producto || '—', wProd, OPT_PROD).alto
      + (f.detalle ? medirTexto(doc, f.detalle, wProd, OPT_DET).alto + 1 : 0);
    const altoVar = medirTexto(doc, f.variante || '—', COLS.variante.w - PAD * 2, OPT_TXT).alto;
    const altoLin = medirTexto(doc, f.linea || '—', COLS.linea.w - PAD * 2, OPT_TXT).alto;
    const altoFecha = 8.5 * (f.referencia ? 3 : 2);
    const alto = Math.max(altoProd, altoVar, altoLin, altoFecha) + PAD * 2;
    return {
      alto,
      dibujar: (d, yf) => {
        const yt = yf + PAD;
        const num = (txt, c, extra = {}) => textoAcotado(d, txt, c.x + PAD, yt, c.w - PAD * 2,
          { size: 7, color: C.grisOscuro, align: 'right', ...extra });
        textoAcotado(d, formatFecha(f.fecha), COLS.fecha.x + PAD, yt, COLS.fecha.w - PAD,
          { size: 7, color: C.grisOscuro });
        textoAcotado(d, formatHora(f.fecha), COLS.fecha.x + PAD, yt + 8.5, COLS.fecha.w - PAD,
          { size: 6.5, color: C.grisClaro });
        if (f.referencia) {
          textoAcotado(d, f.referencia, COLS.fecha.x + PAD, yt + 17, COLS.fecha.w - PAD,
            { font: FONT.bold, size: 6.5, color: C.gris });
        }
        num(String(f.cantidad ?? ''), COLS.cant);
        const yDet = yt + textoAcotado(d, f.producto || '—', COLS.producto.x + PAD, yt, COLS.producto.w - PAD * 2, OPT_PROD);
        if (f.detalle) {
          textoAcotado(d, f.detalle, COLS.producto.x + PAD, yDet + 1, COLS.producto.w - PAD * 2, OPT_DET);
        }
        textoAcotado(d, f.variante || '—', COLS.variante.x + PAD, yt, COLS.variante.w - PAD * 2,
          { ...OPT_TXT, color: f.variante ? C.grisOscuro : C.grisBorde });
        textoAcotado(d, f.linea || '—', COLS.linea.x + PAD, yt, COLS.linea.w - PAD * 2,
          { ...OPT_TXT, color: f.linea ? C.grisOscuro : C.grisBorde });
        num(f.unitario != null ? formatCOP(f.unitario) : '—', COLS.unit);
        num(formatCOP(f.total), COLS.total, { font: FONT.bold, color: C.negro });
        if (f.debe != null) {
          num(formatCOP(f.debe), COLS.debe, { font: FONT.bold, color: f.debe > 0 ? C.rojo : C.verde });
        }
      },
    };
  });

  // Fila de TOTAL: viaja con la tabla si esta se parte entre hojas.
  filasDibujo.push({
    alto: 20,
    fondo: C.grisFondo,
    dibujar: (d, yf) => {
      textoAcotado(d, 'TOTAL', COLS.fecha.x + PAD, yf + 6.5, COLS.producto.x + COLS.producto.w - COLS.fecha.x,
        { font: FONT.bold, size: 7.5, color: C.negro });
      textoAcotado(d, String(totales.cantidad ?? ''), COLS.cant.x + PAD, yf + 6.5, COLS.cant.w - PAD * 2,
        { font: FONT.bold, size: 7.5, color: C.negro, align: 'right' });
      textoAcotado(d, formatCOP(totales.subtotal), COLS.total.x, yf + 6.5, COLS.total.w - PAD,
        { font: FONT.bold, size: 7.5, color: C.negro, align: 'right' });
      textoAcotado(d, formatCOP(totales.debeCapital ?? totales.cobrar), COLS.debe.x, yf + 6.5, COLS.debe.w - PAD,
        { font: FONT.bold, size: 7.5, color: C.rojo, align: 'right' });
    },
  });

  y = tablaPaginada(doc, y, {
    cabeceraAlto: HEAD_H,
    dibujarCabecera: cabecera,
    filas: filasDibujo,
    radio: 6,
    espacioDespues: nota ? 6 : 18,
  });

  if (nota) {
    const OPT_NOTA = { size: 7, lineas: 4, color: C.gris };
    const alto = medirTexto(doc, nota, CONTENT_W, OPT_NOTA).alto;
    y = asegurarEspacio(doc, y, alto);
    y += textoAcotado(doc, nota, MARGIN, y, CONTENT_W, OPT_NOTA) + 14;
  }
  return y;
};

/**
 * Separa la variante que el carrito pega al nombre de una línea de factura
 * («Correa (Talla: 38MM)»), para que en la tabla vaya en su columna.
 */
const separarVariante = (nombre, variante) => {
  const n = String(nombre || '').trim();
  const v = String(variante || '').trim();
  if (!v) return { producto: n, variante: null };
  const sufijo = ` (${v})`;
  if (n.toLowerCase().endsWith(sufijo.toLowerCase())) {
    return { producto: n.slice(0, -sufijo.length), variante: v };
  }
  return { producto: n, variante: v };
};

module.exports = { tablaResumenDeuda, separarVariante };
