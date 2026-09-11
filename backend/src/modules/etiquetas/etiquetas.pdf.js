'use strict';

// ── El PDF de etiquetas ──────────────────────────────────────────────────────
//
// No usa `pdf.base.js`: aquella es la línea gráfica de los DOCUMENTOS (factura,
// estado de cuenta, obligación) y está toda anclada a una A4 con encabezado
// oscuro y pie de página. Una etiqueta de 38 × 21 mm no tiene encabezado, ni
// pie, ni márgenes de documento; lo único que comparte es `formatCOP`, que sí
// se importa para que el precio impreso se vea igual que en pantalla.
//
// Cada página del PDF mide EXACTAMENTE lo que el papel que la impresora tiene
// que recibir: la plancha entera, o una fila del rollo. Ese es el contrato con
// cualquier impresora —de oficina, térmica o de recibos—: si el tamaño de papel
// del diálogo coincide con el de la página y la escala es 100 %, cada etiqueta
// cae sobre su troquel. Lo que la impresora haga distinto (entrar corrida,
// achicar, girar) se corrige con la calibración, que aquí se aplica como UNA
// transformación por página (`layout.matrizPagina`), y la misma se aplica a la
// hoja de prueba: lo que la prueba muestra es lo que van a hacer las etiquetas.
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
 *
 * El `height` explícito no es decorativo: es lo que impide que pdfkit abra una
 * página nueva por su cuenta cuando el texto cae cerca del borde (con la página
 * girada, "el borde" para pdfkit ya no es el de la etiqueta).
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

/** Una etiqueta completa en la posición lógica (x, y) de la página. */
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
 * Documento con las páginas ya calibradas: cada página nueva nace con la
 * transformación de la impresora puesta, así el resto del código dibuja en
 * milímetros de la página lógica y nunca piensa en giros ni escalas.
 */
const _documento = (formato, op, res, nombreArchivo) => {
  const { matriz, papel } = layout.matrizPagina(formato, op);
  const doc = new PDFDocument({ size: [papel.ancho, papel.alto], margin: 0, autoFirstPage: false, bufferPages: false });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${nombreArchivo}"`);
  doc.pipe(res);

  const nuevaPagina = () => {
    doc.addPage({ size: [papel.ancho, papel.alto], margin: 0 });
    doc.transform(...matriz);
  };
  return { doc, nuevaPagina };
};

/**
 * Genera el PDF y lo escribe en `res`.
 *
 * @param {object[]} etiquetas ya EXPANDIDAS: una entrada por etiqueta física.
 *   La expansión (cuántas de cada nodo) la hace el service; aquí solo se pintan.
 * @param {object} formato del catálogo o a medida
 * @param {object} op { simbologia, mostrar, encabezado, pie, diseno, marco, desde, ajuste, impresora, dpi }
 * @param {object} res respuesta de Express
 */
const generarPdfEtiquetas = ({ etiquetas, formato, opciones: op = {}, res, nombreArchivo = 'etiquetas.pdf' }) => {
  const etW = formato.etiqueta.ancho * MM;
  const etH = formato.etiqueta.alto  * MM;

  const porPagina = formato.columnas * formato.filas;
  // `desde` permite reusar una plancha a medio gastar: se salta las casillas ya
  // despegadas en vez de tirar la hoja. Es 1-basado porque el usuario cuenta
  // etiquetas, no índices.
  const saltar = Math.max(0, Math.min(porPagina - 1, (Number(op.desde) || 1) - 1));

  const { doc, nuevaPagina } = _documento(formato, op, res, nombreArchivo);

  let celda = saltar;
  let hayPagina = false;

  for (const item of etiquetas) {
    const indice = celda % porPagina;
    // La primera etiqueta SIEMPRE abre página, aunque `desde` la haya movido a
    // media plancha: con `indice === 0` a secas, empezar en la casilla 4 dejaba
    // el documento sin ninguna página y pdfkit reventaba al dibujar.
    if (indice === 0 || !hayPagina) {
      nuevaPagina();
      hayPagina = true;
    }

    const { x, y } = layout.celda(formato, indice);
    _etiqueta(doc, x, y, etW, etH, item, op);
    celda += 1;
  }

  // Ninguna etiqueta seleccionada: en vez de un PDF vacío —que el navegador
  // abre en blanco y parece un error del sistema— se imprime la razón.
  if (!etiquetas.length) {
    nuevaPagina();
    const W = formato.pagina.ancho * MM;
    const H = formato.pagina.alto * MM;
    doc.font(F.normal).fontSize(Math.min(10, H / 5)).fillColor(GRIS)
      .text('No hay nada que imprimir: ningún producto de los seleccionados tiene código asignado.',
        4, 4, { width: Math.max(10, W - 8), height: Math.max(10, H - 8), align: 'center', ellipsis: true });
  }

  doc.end();
};

// ─────────────────────────────────────────────────────────────────────────────
// Hoja de prueba de alineación
// ─────────────────────────────────────────────────────────────────────────────
//
// Se imprime ANTES de gastar la plancha o el rollo, en papel normal o en una
// etiqueta. Dibuja justo lo que hace falta para calibrar a ojo y con regla:
//
//   · el contorno de cada etiqueta (¿cae sobre el troquel?),
//   · su área segura, punteada (lo que quede fuera se puede cortar),
//   · una cruz en el centro y el número de la casilla,
//   · una regla de largo conocido: si mide distinto, la impresora está
//     escalando, y el valor medido es lo que se escribe en «Escala»,
//   · el borde de la página, punteado: dónde empieza y termina el papel que la
//     impresora cree tener.
//
// Pasa por la MISMA transformación que las etiquetas: con la calibración
// puesta, la prueba muestra exactamente dónde van a caer.

const { largoRegla } = layout;

const _regla = (doc, x, y, largoMm) => {
  const L = largoMm * MM;
  doc.save().lineWidth(0.4).strokeColor(NEGRO);
  doc.moveTo(x, y).lineTo(x + L, y).stroke();
  for (let mm = 0; mm <= largoMm; mm += 1) {
    const t = mm % 10 === 0 ? 2.2 * MM : (mm % 5 === 0 ? 1.4 * MM : 0.7 * MM);
    doc.moveTo(x + mm * MM, y).lineTo(x + mm * MM, y - t).stroke();
  }
  doc.restore();
};

const _pruebaCelda = (doc, x, y, wPt, hPt, numero, formato, op, conRegla) => {
  const plano = { pad: layout.planear(wPt, hPt, { codigo: '0', nombre: '' }, { ...op, simbologia: 'barras' }).pad };
  doc.save();
  doc.translate(x, y);

  // Contorno exacto de la etiqueta.
  doc.lineWidth(0.6).strokeColor(NEGRO).rect(0, 0, wPt, hPt).stroke();

  // Área segura (margen interior).
  const p = plano.pad;
  if (p > 0.5) {
    doc.lineWidth(0.4).strokeColor(GRIS).dash(1.5, { space: 1.5 })
      .rect(p, p, wPt - 2 * p, hPt - 2 * p).stroke().undash();
  }

  // Cruz central.
  const cx = wPt / 2;
  const cy = hPt / 2;
  const brazo = Math.min(wPt, hPt) * 0.12;
  doc.lineWidth(0.5).strokeColor(NEGRO)
    .moveTo(cx - brazo, cy).lineTo(cx + brazo, cy).stroke()
    .moveTo(cx, cy - brazo).lineTo(cx, cy + brazo).stroke();

  const tam = Math.max(4, Math.min(8, hPt / 7));
  doc.font(F.bold).fontSize(tam).fillColor(NEGRO)
    .text(`#${numero}`, p + 1, p + 1, { width: wPt / 2, height: tam * 1.3, lineBreak: false });

  // La primera casilla lleva la regla y su rótulo en el lugar de la medida: las
  // dos cosas juntas no caben en una etiqueta de 25 mm de alto, y la medida ya
  // está en todas las demás casillas.
  const L = conRegla ? largoRegla(formato.etiqueta.ancho) : null;
  if (L) {
    const xr = (wPt - L * MM) / 2;
    const yr = cy + Math.min(hPt * 0.28, 6 * MM);
    _regla(doc, xr, yr, L);
    doc.font(F.normal).fontSize(tam * 0.85).fillColor(NEGRO)
      .text(`${L} mm`, xr, yr + 0.8, { width: L * MM, height: tam * 1.2, align: 'center', lineBreak: false });
  } else {
    doc.font(F.normal).fontSize(tam * 0.85).fillColor(NEGRO)
      .text(`${String(formato.etiqueta.ancho).replace('.', ',')} × ${String(formato.etiqueta.alto).replace('.', ',')} mm`,
        p + 1, hPt - p - tam * 1.2, { width: wPt - 2 * p - 2, height: tam * 1.2, align: 'right', lineBreak: false });
  }
  doc.restore();
};

/**
 * La hoja de prueba. Una página para las planchas; dos para los rollos, porque
 * en un rollo lo que hay que ver es cómo avanza de una fila a la siguiente.
 */
const generarPdfPrueba = ({ formato, opciones: op = {}, res, nombreArchivo = 'prueba-alineacion.pdf' }) => {
  const etW = formato.etiqueta.ancho * MM;
  const etH = formato.etiqueta.alto  * MM;
  const W = formato.pagina.ancho * MM;
  const H = formato.pagina.alto  * MM;
  const porPagina = formato.columnas * formato.filas;
  const paginas = formato.medio === 'rollo' ? 2 : 1;

  const { doc, nuevaPagina } = _documento(formato, op, res, nombreArchivo);

  let numero = 1;
  for (let pag = 0; pag < paginas; pag += 1) {
    nuevaPagina();
    // Borde de la página: dónde cree la impresora que empieza y termina el papel.
    doc.save().lineWidth(0.4).strokeColor(GRIS).dash(3, { space: 2 })
      .rect(0.3, 0.3, W - 0.6, H - 0.6).stroke().undash().restore();

    for (let i = 0; i < porPagina; i += 1) {
      const { x, y } = layout.celda(formato, i);
      _pruebaCelda(doc, x, y, etW, etH, numero, formato, op, pag === 0 && i === 0);
      numero += 1;
    }
  }
  doc.end();
};

module.exports = { generarPdfEtiquetas, generarPdfPrueba, largoRegla };
