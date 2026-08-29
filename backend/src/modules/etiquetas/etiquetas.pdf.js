'use strict';

// ── El PDF de etiquetas ──────────────────────────────────────────────────────
//
// No usa `pdf.base.js`: aquella es la línea gráfica de los DOCUMENTOS (factura,
// estado de cuenta, obligación) y está toda anclada a una A4 con encabezado
// oscuro y pie de página. Una etiqueta de 38 × 21 mm no tiene encabezado, ni
// pie, ni márgenes de documento; lo único que comparte es `formatCOP`, que sí
// se importa para que el precio impreso se vea igual que en pantalla.
//
// Dos medios, y la diferencia es física:
//   · `hoja`  → una plancha adhesiva. Muchas etiquetas por página, y hay que
//               acertarle a la retícula troquelada.
//   · `rollo` → impresora térmica. Cada etiqueta es UNA PÁGINA del tamaño
//               exacto de la etiqueta; la impresora avanza el rollo sola.
//
// Todo lo que se dibuja sale de `etiquetas.layout.js`. Aquí no se decide nada:
// si el precio no cabe, ya lo decidió el plano — y el mismo plano es el que le
// avisó al usuario antes de imprimir.

const PDFDocument = require('pdfkit');
const { MM }      = require('./etiquetas.formatos');
const layout      = require('./etiquetas.layout');
const { formatCOP } = require('../../utils/pdf.base');

const NEGRO = '#000000';
const GRIS  = '#6B7280';
const GUIA  = '#D1D5DB';

// Fuentes base de PDF: no hay que embeber nada y el archivo pesa lo que pesan
// los vectores del símbolo. En una impresión de 2.000 etiquetas eso importa.
const F = { normal: 'Helvetica', bold: 'Helvetica-Bold', mono: 'Courier-Bold' };

/**
 * Encoge el cuerpo de letra hasta que el texto quepa en `lineas` renglones, y
 * si aun así no cabe deja que pdfkit lo corte con puntos suspensivos.
 *
 * Sin esto, un nombre largo empuja al resto del contenido fuera de la etiqueta
 * y se lleva por delante el código de barras de la etiqueta de al lado.
 */
const _texto = (doc, b) => {
  const fuente = b.mono ? F.mono : (b.bold ? F.bold : F.normal);
  const valor  = b.esPrecio ? formatCOP(b.texto) : String(b.texto ?? '');
  const lineas = b.lineas || 1;

  let size = b.size;
  doc.font(fuente);
  const altoMax = b.size * 1.18 * lineas;
  while (size > 3.5 && doc.fontSize(size).heightOfString(valor, { width: b.w }) > altoMax) {
    size -= 0.25;
  }

  doc.font(fuente).fontSize(size).fillColor(b.gris ? GRIS : NEGRO)
    .text(valor, b.x, b.y, {
      width:  b.w,
      height: altoMax,
      align:  b.align || 'left',
      ellipsis: true,
    });
};

/**
 * Las barras, como UN SOLO camino relleno.
 *
 * Un `fill()` por barra multiplicaría por cuarenta los operadores del PDF: en
 * 2.000 etiquetas son 90.000 rellenos contra 2.000. El archivo pesa menos y las
 * impresoras térmicas —que interpretan el PDF con muy poca memoria— no se
 * atragantan.
 */
const _barras = (doc, s) => {
  let x = s.x;
  for (let i = 0; i < s.barras.length; i += 1) {
    const ancho = s.barras[i] * s.modulo;
    if (i % 2 === 0) doc.rect(x, s.y, ancho, s.alto);   // pares = barra, impares = espacio
    x += ancho;
  }
  doc.fillColor(NEGRO).fill();
};

/**
 * El QR, también como un solo camino, fusionando los módulos oscuros
 * CONSECUTIVOS de cada fila en un rectángulo. Un QR de 21 × 21 tiene ~220
 * módulos oscuros y suele quedar en unos 90 rectángulos.
 *
 * Los rectángulos se solapan medio punto a propósito (`+ 0.02`): sin eso, el
 * antialiasing del visor deja una rejilla de hilos blancos entre módulos que
 * confunde a algunas cámaras.
 */
const _qr = (doc, s) => {
  const m = s.modulo;
  for (let f = 0; f < s.lado; f += 1) {
    let inicio = -1;
    for (let c = 0; c <= s.lado; c += 1) {
      const oscuro = c < s.lado && s.matriz[f][c];
      if (oscuro && inicio < 0) inicio = c;
      if (!oscuro && inicio >= 0) {
        doc.rect(s.x + inicio * m, s.y + f * m, (c - inicio) * m + 0.02, m + 0.02);
        inicio = -1;
      }
    }
  }
  doc.fillColor(NEGRO).fill();
};

/** Una etiqueta completa en la posición (x, y) de la página. */
const _etiqueta = (doc, x, y, wPt, hPt, item, op) => {
  const plano = layout.planear(wPt, hPt, item, op);

  doc.save();
  doc.translate(x, y);

  if (op.marco) {
    doc.rect(0.25, 0.25, wPt - 0.5, hPt - 0.5)
      .strokeColor(GUIA).lineWidth(0.5).dash(2, { space: 2 }).stroke().undash();
  }

  if (plano.simbolo.tipo === 'barras') _barras(doc, plano.simbolo);
  else                                 _qr(doc, plano.simbolo);

  for (const b of plano.bloques) _texto(doc, b);

  doc.restore();
  return plano;
};

/**
 * Genera el PDF y lo escribe en `res`.
 *
 * @param {object[]} etiquetas ya EXPANDIDAS: una entrada por etiqueta física.
 *   La expansión (cuántas de cada nodo) la hace el service; aquí solo se pintan.
 * @param {object} formato del catálogo o a medida
 * @param {object} op { simbologia, mostrar, encabezado, marco, desde, ajuste }
 * @param {object} res respuesta de Express
 */
const generarPdfEtiquetas = ({ etiquetas, formato, opciones: op = {}, res, nombreArchivo = 'etiquetas.pdf' }) => {
  const pagW = formato.pagina.ancho * MM;
  const pagH = formato.pagina.alto  * MM;
  const etW  = formato.etiqueta.ancho * MM;
  const etH  = formato.etiqueta.alto  * MM;

  // La calibración de impresora (`op.ajuste`, en mm) la aplica
  // `layout.posicionEnHoja`: ninguna impresora imprime exactamente donde dice el
  // PDF, y en una plancha troquelada un desvío de 2 mm arruina la hoja entera.
  // El usuario lo mide una vez y lo deja guardado.

  const porPagina = formato.columnas * formato.filas;
  // `desde` permite reusar una plancha a medio gastar: se salta las casillas ya
  // despegadas en vez de tirar la hoja. Es 1-basado porque el usuario cuenta
  // etiquetas, no índices.
  const saltar = Math.max(0, Math.min(porPagina - 1, (Number(op.desde) || 1) - 1));

  const doc = new PDFDocument({ size: [pagW, pagH], margin: 0, autoFirstPage: false, bufferPages: false });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${nombreArchivo}"`);
  doc.pipe(res);

  let celda = saltar;
  let hayPagina = false;

  for (const item of etiquetas) {
    const indice = celda % porPagina;
    // La primera etiqueta SIEMPRE abre página, aunque `desde` la haya movido a
    // media plancha: con `indice === 0` a secas, empezar en la casilla 4 dejaba
    // el documento sin ninguna página y pdfkit reventaba al dibujar.
    if (indice === 0 || !hayPagina) {
      doc.addPage({ size: [pagW, pagH], margin: 0 });
      hayPagina = true;
    }

    const { x, y } = layout.posicionEnHoja(formato, indice, op.ajuste);
    _etiqueta(doc, x, y, etW, etH, item, op);
    celda += 1;
  }

  // Ninguna etiqueta seleccionada: en vez de un PDF vacío —que el navegador
  // abre en blanco y parece un error del sistema— se imprime la razón.
  if (!etiquetas.length) {
    doc.addPage({ size: [pagW, pagH], margin: 0 });
    doc.font(F.normal).fontSize(10).fillColor(GRIS)
      .text('No hay nada que imprimir: ningún producto de los seleccionados tiene código asignado.',
        20, 20, { width: pagW - 40, align: 'center' });
  }

  doc.end();
};

module.exports = { generarPdfEtiquetas };
