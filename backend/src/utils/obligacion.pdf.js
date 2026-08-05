'use strict';

/**
 * BLOQUES Y DOCUMENTOS DE OBLIGACIÓN (créditos y préstamos).
 *
 * Todo lo que un documento necesita decir sobre una deuda —estado, cifras,
 * plazo, mora e historial de abonos— se dibuja aquí, a partir del resumen que
 * produce utils/obligacion.js. La factura a crédito, el comprobante de préstamo,
 * el aviso de mora y el paz y salvo comparten estos bloques, así que los cinco
 * documentos muestran las mismas cifras con el mismo aspecto.
 */

const PDFDocument = require('pdfkit');
const {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W, FONT, C, TONOS,
  formatCOP, formatFecha, formatFechaHora,
  rectFill, rectFillStroke, hLine,
  labelSeccion, fila, encabezado, badgeEstado, bloqueFirma, pieDocumento, asegurarEspacio,
} = require('./pdf.base');
const { describirCondicion } = require('./obligacion');
const { describirPlanInteres } = require('./interes.util');

// ─── Bloque: estado de la obligación ─────────────────────────────────────────

/**
 * Tarjeta principal: badge de estado, barra de avance y las cifras que definen
 * la deuda. Es el bloque que permite entender la obligación de un vistazo sin
 * entrar al sistema.
 */
const bloqueEstadoObligacion = (doc, resumen, y, { titulo = 'Estado de la obligación' } = {}) => {
  y = labelSeccion(doc, y, titulo);

  const tono = TONOS[resumen.estado_tono] || TONOS.gris;

  const filas = [];
  if (resumen.devuelto > 0) {
    filas.push(['Valor original de la venta', formatCOP(resumen.valor_original)]);
    filas.push(['Devoluciones',               `- ${formatCOP(resumen.devuelto)}`]);
  }
  filas.push([resumen.tipo === 'credito' ? 'Valor de la venta' : 'Valor del préstamo',
    formatCOP(resumen.valor_actual)]);
  if (resumen.cuota_inicial > 0) {
    filas.push(['Cuota inicial',   `- ${formatCOP(resumen.cuota_inicial)}`]);
    filas.push(['Valor financiado', formatCOP(resumen.financiado)]);
  }
  filas.push([`Total abonado (${resumen.num_abonos} abono${resumen.num_abonos === 1 ? '' : 's'})`,
    `- ${formatCOP(resumen.total_abonado)}`]);

  // Los cargos financieros se muestran DENTRO del estado, no en un anexo. Son
  // deuda del cliente y el documento tiene que decirlo aunque el capital ya esté
  // en cero — de hecho sobre todo en ese caso, que es cuando la obligación sigue
  // abierta solo por ellos.
  //
  // Van separados a propósito: el interés es el precio de la financiación y la
  // mora es la sanción por el atraso. El cliente tiene derecho a ver cuánto le
  // costó cada cosa, y juntarlos en un solo renglón lo escondería.
  const conInteres = resumen.interes_causado > 0 || resumen.interes_pendiente > 0;
  const conMora    = resumen.mora_causada    > 0 || resumen.mora_pendiente    > 0;
  const conCargos  = conInteres || conMora;

  if (conInteres) {
    filas.push(['Interés de financiación', formatCOP(resumen.interes_causado)]);
    if (resumen.interes_cobrado   > 0) filas.push(['Interés pagado',    `- ${formatCOP(resumen.interes_cobrado)}`]);
    if (resumen.interes_condonado > 0) filas.push(['Interés condonado', `- ${formatCOP(resumen.interes_condonado)}`]);
  }
  if (conMora) {
    filas.push(['Mora causada', formatCOP(resumen.mora_causada)]);
    if (resumen.mora_cobrada > 0)   filas.push(['Mora cobrada',   `- ${formatCOP(resumen.mora_cobrada)}`]);
    if (resumen.mora_condonada > 0) filas.push(['Mora condonada', `- ${formatCOP(resumen.mora_condonada)}`]);
  }

  // El cierre lleva un renglón por cada cargo pendiente más el total. Se mide
  // aquí para que la caja crezca con el contenido en vez de recortarlo.
  const lineasCierre = (conInteres ? 1 : 0) + (conMora ? 1 : 0) + (conCargos ? 1 : 0);
  const H = 52 + filas.length * 16 + 30 + (conCargos ? lineasCierre * 15 + 4 : 0);
  rectFillStroke(doc, MARGIN, y, CONTENT_W, H, C.grisFondo, C.grisBorde, 8);

  // Badge de estado arriba a la derecha
  badgeEstado(doc, resumen.estado_label, resumen.estado_tono, PAGE_W - MARGIN - 14 - 92, y + 12);
  doc.font(FONT.normal).fontSize(7).fillColor(C.grisClaro)
    .text(resumen.estado_desc, PAGE_W - MARGIN - 14 - 130, y + 35, { width: 130, align: 'right' });

  // Avance del pago
  doc.font(FONT.bold).fontSize(8).fillColor(C.grisOscuro)
    .text(`${resumen.avance_pct}% pagado`, MARGIN + 14, y + 14, { width: 120 });

  const barraW = CONTENT_W * 0.42;
  rectFill(doc, MARGIN + 14, y + 28, barraW, 5, C.grisBorde, 2.5);
  if (resumen.avance_pct > 0) {
    rectFill(doc, MARGIN + 14, y + 28, Math.max(3, barraW * resumen.avance_pct / 100), 5,
      resumen.pagada ? C.verde : C.azul, 2.5);
  }

  // Cifras
  let yf = y + 48;
  for (const [label, valor] of filas) {
    yf = fila(doc, yf, label, valor, { x: MARGIN + 14, w: CONTENT_W - 28 });
  }

  // Saldo pendiente: la cifra que importa, resaltada
  hLine(doc, yf + 2, { x1: MARGIN + 14, x2: PAGE_W - MARGIN - 14, color: C.grisBorde });
  doc.font(FONT.bold).fontSize(10).fillColor(C.grisOscuro)
    .text('SALDO PENDIENTE', MARGIN + 14, yf + 12,
      { width: CONTENT_W * 0.5, lineBreak: false });
  doc.font(FONT.bold).fontSize(14).fillColor(resumen.saldo > 0 ? tono.fg : C.verde)
    .text(formatCOP(resumen.saldo), MARGIN, yf + 9,
      { width: CONTENT_W - 14, align: 'right', lineBreak: false });

  // Con cargos pendientes, el saldo de capital NO es lo que el cliente debe
  // pagar: se agregan los renglones de interés y mora, y el total real.
  if (conCargos) {
    let yc = yf + 30;
    const renglonCargo = (label, valor) => {
      doc.font(FONT.normal).fontSize(8.5).fillColor(C.grisOscuro)
        .text(label, MARGIN + 14, yc, { width: CONTENT_W * 0.5, lineBreak: false });
      doc.font(FONT.bold).fontSize(9).fillColor(valor > 0 ? C.rojo : C.verde)
        .text(formatCOP(valor), MARGIN, yc, { width: CONTENT_W - 14, align: 'right', lineBreak: false });
      yc += 15;
    };

    if (conInteres) renglonCargo('Interés pendiente', resumen.interes_pendiente);
    if (conMora)    renglonCargo('Mora pendiente',    resumen.mora_pendiente);

    doc.font(FONT.bold).fontSize(9).fillColor(C.grisOscuro)
      .text('TOTAL A PAGAR', MARGIN + 14, yc, { width: CONTENT_W * 0.5, lineBreak: false });
    doc.font(FONT.bold).fontSize(11).fillColor(resumen.total_a_pagar > 0 ? tono.fg : C.verde)
      .text(formatCOP(resumen.total_a_pagar), MARGIN, yc - 2,
        { width: CONTENT_W - 14, align: 'right', lineBreak: false });
  }

  return y + H + 20;
};

// ─── Bloque: fechas y plazo ──────────────────────────────────────────────────

const bloqueFechas = (doc, resumen, y) => {
  const filas = [['Fecha de emisión', formatFecha(resumen.fecha_emision)]];

  if (resumen.fecha_limite) {
    filas.push(['Fecha de vencimiento', resumen.fecha_limite_txt]);
    if (resumen.plazo_dias != null) {
      filas.push(['Plazo otorgado', `${resumen.plazo_dias} día${resumen.plazo_dias === 1 ? '' : 's'}`]);
    }
    if (resumen.vencido && resumen.dias_atraso > 0) {
      filas.push(['Días de atraso', String(resumen.dias_atraso)]);
    }
  }
  if (resumen.fecha_ultimo_abono) {
    filas.push(['Último abono', formatFecha(resumen.fecha_ultimo_abono)]);
  }

  y = labelSeccion(doc, y, 'Fechas y plazo');
  const H = filas.length * 16 + 20;
  rectFillStroke(doc, MARGIN, y, CONTENT_W, H, C.blanco, C.grisBorde, 8);

  let yf = y + 12;
  for (const [label, valor] of filas) {
    yf = fila(doc, yf, label, valor, { x: MARGIN + 14, w: CONTENT_W - 28 });
  }
  return y + H + 20;
};

// ─── Bloque: historial de abonos con saldo corrido ───────────────────────────

/**
 * Cuatro columnas: fecha, método, valor y el saldo que quedó después. La última
 * es la que convierte la factura en un historial de pagos utilizable.
 */
const tablaAbonos = (doc, resumen, y, { titulo = 'Historial de abonos' } = {}) => {
  const abonos = resumen.abonos || [];

  y = labelSeccion(doc, y, `${titulo}${abonos.length ? ` (${abonos.length})` : ''}`);

  const HEAD_H = 22;
  const ROW_H  = 17;
  const hayInicial = resumen.cuota_inicial > 0;
  const nFilas = (hayInicial ? 1 : 0) + (abonos.length || 1);
  const H = HEAD_H + nFilas * ROW_H + (abonos.length ? 22 : 0);

  y = asegurarEspacio(doc, y, Math.min(H + 20, 260));

  rectFillStroke(doc, MARGIN, y, CONTENT_W, H, C.blanco, C.grisBorde, 8);

  const COL_F = CONTENT_W * 0.24;   // fecha
  const COL_M = CONTENT_W * 0.28;   // método
  const COL_V = CONTENT_W * 0.22;   // valor
  const COL_S = CONTENT_W - COL_F - COL_M - COL_V; // saldo

  // Cabecera
  rectFill(doc, MARGIN, y, CONTENT_W, HEAD_H, C.negro, 8);
  doc.rect(MARGIN, y + 12, CONTENT_W, HEAD_H - 12).fill(C.negro);
  doc.font(FONT.bold).fontSize(7).fillColor(C.blanco)
    .text('Fecha',  MARGIN + 12,                       y + 7.5, { width: COL_F - 12, characterSpacing: 0.4 })
    .text('Método', MARGIN + COL_F,                    y + 7.5, { width: COL_M,      characterSpacing: 0.4 })
    .text('Valor',  MARGIN + COL_F + COL_M,            y + 7.5, { width: COL_V,      align: 'right', characterSpacing: 0.4 })
    .text('Saldo',  MARGIN + COL_F + COL_M + COL_V,    y + 7.5, { width: COL_S - 12, align: 'right', characterSpacing: 0.4 });

  let yf = y + HEAD_H;
  let idx = 0;

  const pintarFila = (fechaTxt, metodo, valor, saldo, { esInicial = false } = {}) => {
    if (idx % 2 === 1) doc.rect(MARGIN, yf, CONTENT_W, ROW_H).fill(C.filaAlterna);
    if (idx > 0) hLine(doc, yf, { color: C.grisBorde, width: 0.4 });

    doc.font(FONT.normal).fontSize(7.5).fillColor(C.grisOscuro)
      .text(fechaTxt, MARGIN + 12, yf + 5, { width: COL_F - 12, lineBreak: false });
    doc.font(esInicial ? FONT.bold : FONT.normal).fontSize(7.5)
      .fillColor(esInicial ? C.azul : C.grisOscuro)
      .text(metodo, MARGIN + COL_F, yf + 5, { width: COL_M, lineBreak: false, ellipsis: true });
    doc.font(FONT.bold).fontSize(8).fillColor(C.verde)
      .text(formatCOP(valor), MARGIN + COL_F + COL_M, yf + 5, { width: COL_V, align: 'right', lineBreak: false });
    doc.font(FONT.normal).fontSize(8).fillColor(saldo > 0 ? C.grisOscuro : C.verde)
      .text(formatCOP(saldo), MARGIN + COL_F + COL_M + COL_V, yf + 5,
        { width: COL_S - 12, align: 'right', lineBreak: false });

    yf += ROW_H;
    idx += 1;
  };

  // La cuota inicial es el primer pago de la obligación: va en el historial.
  if (hayInicial) {
    pintarFila(formatFecha(resumen.fecha_emision), 'Cuota inicial',
      resumen.cuota_inicial, resumen.financiado, { esInicial: true });
  }

  if (abonos.length === 0 && !hayInicial) {
    doc.font(FONT.normal).fontSize(8).fillColor(C.grisClaro)
      .text('Sin abonos registrados a la fecha', MARGIN + 12, yf + 5, { width: CONTENT_W - 24 });
    yf += ROW_H;
  } else {
    for (const ab of abonos) {
      pintarFila(formatFecha(ab.fecha), ab.metodo, ab.valor, ab.saldo_despues);
    }
  }

  // Totales
  if (abonos.length) {
    rectFill(doc, MARGIN, yf, CONTENT_W, 22, C.grisFondo, 0);
    hLine(doc, yf, { color: C.grisBorde });
    doc.font(FONT.bold).fontSize(8).fillColor(C.grisOscuro)
      .text('TOTAL ABONADO', MARGIN + 12, yf + 7, { width: COL_F + COL_M - 12, lineBreak: false });
    doc.font(FONT.bold).fontSize(8.5).fillColor(C.verde)
      .text(formatCOP(resumen.total_abonado), MARGIN + COL_F + COL_M, yf + 6.5,
        { width: COL_V, align: 'right', lineBreak: false });
    doc.font(FONT.bold).fontSize(8.5).fillColor(resumen.saldo > 0 ? C.rojo : C.verde)
      .text(formatCOP(resumen.saldo), MARGIN + COL_F + COL_M + COL_V, yf + 6.5,
        { width: COL_S - 12, align: 'right', lineBreak: false });
  }

  return y + H + 20;
};

// ─── Bloque: movimientos de mora ─────────────────────────────────────────────

/**
 * Cobros y condonaciones de los CARGOS FINANCIEROS del documento — interés
 * corriente y mora, en una sola tabla y con cada renglón diciendo cuál es.
 *
 * Va aparte del historial de abonos a propósito: un abono baja el precio del
 * producto y los cargos son ingreso financiero, y mezclarlos haría creer que el
 * cliente pagó más del producto de lo que pagó. Sin este bloque, el cliente que
 * pagó intereses no tenía dónde verlos.
 */
const tablaMovimientosMora = (doc, resumen, y, { titulo = null } = {}) => {
  const movs = resumen.mora_movimientos || [];
  const pendiente = (resumen.cargos_pendientes != null)
    ? resumen.cargos_pendientes
    : (resumen.mora_pendiente || 0);
  if (!movs.length && !(pendiente > 0)) return y;

  const hayInteres = resumen.interes_causado > 0 || resumen.interes_pendiente > 0
    || movs.some((m) => m.concepto === 'interes');
  const hayMora = resumen.mora_causada > 0 || resumen.mora_pendiente > 0
    || movs.some((m) => m.concepto !== 'interes');

  // El título dice de qué habla la tabla, para que el cliente no tenga que
  // deducirlo de los renglones.
  titulo = titulo || (hayInteres && hayMora ? 'Intereses y mora'
    : hayInteres ? 'Intereses de financiación'
    : 'Intereses de mora');

  y = labelSeccion(doc, y, `${titulo}${movs.length ? ` (${movs.length})` : ''}`);

  const HEAD_H = 22;
  const ROW_H  = 17;
  const nFilas = movs.length || 1;
  const H = HEAD_H + nFilas * ROW_H + 22;

  y = asegurarEspacio(doc, y, Math.min(H + 20, 260));
  rectFillStroke(doc, MARGIN, y, CONTENT_W, H, C.blanco, C.grisBorde, 8);

  const COL_F = CONTENT_W * 0.24;   // fecha
  const COL_C = CONTENT_W * 0.46;   // concepto
  const COL_V = CONTENT_W - COL_F - COL_C; // valor

  rectFill(doc, MARGIN, y, CONTENT_W, HEAD_H, C.negro, 8);
  doc.rect(MARGIN, y + 12, CONTENT_W, HEAD_H - 12).fill(C.negro);
  doc.font(FONT.bold).fontSize(7).fillColor(C.blanco)
    .text('Fecha',    MARGIN + 12,            y + 7.5, { width: COL_F - 12, characterSpacing: 0.4 })
    .text('Concepto', MARGIN + COL_F,         y + 7.5, { width: COL_C,      characterSpacing: 0.4 })
    .text('Valor',    MARGIN + COL_F + COL_C, y + 7.5, { width: COL_V - 12, align: 'right', characterSpacing: 0.4 });

  let yf = y + HEAD_H;

  if (!movs.length) {
    doc.font(FONT.normal).fontSize(8).fillColor(C.grisClaro)
      .text('Sin cobros registrados', MARGIN + 12, yf + 5, { width: CONTENT_W - 24 });
    yf += ROW_H;
  } else {
    movs.forEach((m, i) => {
      if (i % 2 === 1) doc.rect(MARGIN, yf, CONTENT_W, ROW_H).fill(C.filaAlterna);
      if (i > 0) hLine(doc, yf, { color: C.grisBorde, width: 0.4 });

      // Cada renglón dice de qué cargo es: son deudas con causa distinta y el
      // cliente tiene derecho a distinguirlas en su comprobante.
      const cual = m.concepto === 'interes' ? 'interés' : 'mora';
      const concepto = m.es_cobro
        ? `Cobro de ${cual}${m.metodo ? ` · ${m.metodo}` : ''}`
        : `${cual === 'interés' ? 'Interés' : 'Mora'} condonada${m.motivo ? ` · ${m.motivo}` : ''}`;

      doc.font(FONT.normal).fontSize(7.5).fillColor(C.grisOscuro)
        .text(formatFecha(m.fecha), MARGIN + 12, yf + 5, { width: COL_F - 12, lineBreak: false });
      doc.font(FONT.normal).fontSize(7.5).fillColor(C.grisOscuro)
        .text(concepto, MARGIN + COL_F, yf + 5, { width: COL_C, lineBreak: false, ellipsis: true });
      doc.font(FONT.bold).fontSize(8).fillColor(m.es_cobro ? C.verde : C.grisClaro)
        .text(formatCOP(m.valor), MARGIN + COL_F + COL_C, yf + 5,
          { width: COL_V - 12, align: 'right', lineBreak: false });

      yf += ROW_H;
    });
  }

  // Cierre: lo que todavía se debe. La etiqueta se adapta para no mentir cuando
  // solo hay uno de los dos cargos.
  const etiquetaCierre = hayInteres && hayMora ? 'PENDIENTE (INTERÉS + MORA)'
    : hayInteres ? 'INTERÉS PENDIENTE'
    : 'MORA PENDIENTE';

  rectFill(doc, MARGIN, yf, CONTENT_W, 22, C.grisFondo, 0);
  hLine(doc, yf, { color: C.grisBorde });
  doc.font(FONT.bold).fontSize(8).fillColor(C.grisOscuro)
    .text(etiquetaCierre, MARGIN + 12, yf + 7, { width: COL_F + COL_C - 12, lineBreak: false });
  doc.font(FONT.bold).fontSize(8.5).fillColor(pendiente > 0 ? C.rojo : C.verde)
    .text(formatCOP(pendiente), MARGIN + COL_F + COL_C, yf + 6.5,
      { width: COL_V - 12, align: 'right', lineBreak: false });

  return y + H + 20;
};

// ─── Bloque: condiciones de pago pactadas ────────────────────────────────────
//
// En Colombia NI el interés corriente NI el moratorio son exigibles si no se
// pactaron por escrito, así que este bloque acompaña a la firma en los
// documentos de crédito. Se imprime si hay plazo O si hay interés: un préstamo
// puede causar interés sin tener fecha límite, y en ese caso el pacto del
// interés es justamente lo único que hay que dejar por escrito.
const bloqueCondiciones = (doc, resumen, y, { compacto = false } = {}) => {
  const descMora    = describirCondicion(resumen.condicion);
  const descInteres = describirPlanInteres(resumen.condicion_interes);
  if (!resumen.fecha_limite && !descInteres) return y;

  y = labelSeccion(doc, y, 'Condiciones de pago');

  const filas = [['Saldo a pagar', formatCOP(resumen.saldo)]];

  // El interés va PRIMERO: es el precio del crédito, lo que el cliente paga por
  // el solo hecho de financiarse. La mora es la excepción, no la regla.
  if (descInteres) {
    filas.push(['Interés de financiación', descInteres]);
    if (resumen.interes_causado > 0) {
      filas.push(['Interés causado a la fecha', formatCOP(resumen.interes_causado)]);
    }
  }

  if (resumen.fecha_limite) {
    filas.push(['Fecha límite de pago', resumen.fecha_limite_txt]);
    if (descMora) filas.push(['Interés por mora', descMora]);
    if (resumen.vencido && resumen.mora?.pendiente > 0) {
      filas.push(['Días de atraso a la fecha', String(resumen.dias_atraso)]);
      filas.push(['Mora causada a la fecha',   formatCOP(resumen.mora.pendiente)]);
    }
  }

  for (const [label, valor] of filas) y = fila(doc, y, label, valor);

  if (!compacto) {
    // La declaración menciona SOLO lo que de verdad se pactó: firmar que se
    // acepta un interés de mora en un documento que no lo lleva es lo que hacía
    // el texto anterior si se usaba el plazo como excusa para cobrar interés.
    const partes = [];
    if (descInteres) partes.push('el interés de financiación');
    if (resumen.fecha_limite) partes.push(descMora ? 'el plazo y el interés de mora' : 'el plazo de pago');

    const detalle = [
      descInteres ? 'El interés de financiación se causa desde la entrega, según la periodicidad pactada.' : null,
      descMora    ? 'La mora se liquida sobre el saldo de capital pendiente, por los días de atraso.'      : null,
    ].filter(Boolean).join(' ');

    y += 6;
    doc.font(FONT.normal).fontSize(7.5).fillColor(C.grisClaro)
      .text(
        `El cliente declara conocer y aceptar ${partes.join(' y ')} aquí pactado${partes.length > 1 ? 's' : ''}. ${detalle}`,
        MARGIN, y, { width: CONTENT_W },
      );
    y += 22;
  }

  return y + 8;
};

// ─── Bloque: datos de la persona ─────────────────────────────────────────────

const bloquePersona = (doc, persona, y, { titulo = 'Cliente' } = {}) => {
  const lineas = [
    persona.cedula   && persona.cedula !== 'COMPANERO' ? `CC: ${persona.cedula}` : null,
    persona.celular  && persona.celular !== '0000000000' ? `Tel: ${persona.celular}` : null,
    persona.email    || null,
    persona.direccion || null,
  ].filter(Boolean);

  const H = 44 + lineas.length * 13;
  rectFillStroke(doc, MARGIN, y, CONTENT_W, H, C.grisFondo, C.grisBorde, 8);

  doc.font(FONT.bold).fontSize(7).fillColor(C.grisClaro)
    .text(String(titulo).toUpperCase(), MARGIN + 14, y + 12, { characterSpacing: 1 });
  doc.font(FONT.bold).fontSize(13).fillColor(C.negro)
    .text(persona.nombre || '—', MARGIN + 14, y + 24, { width: CONTENT_W - 28, lineBreak: false, ellipsis: true });

  let yd = y + 42;
  for (const l of lineas) {
    doc.font(FONT.normal).fontSize(8.5).fillColor(C.gris)
      .text(l, MARGIN + 14, yd, { width: CONTENT_W - 28, lineBreak: false, ellipsis: true });
    yd += 13;
  }

  return y + H + 20;
};

// ─── Documento: AVISO DE MORA ────────────────────────────────────────────────

/**
 * Requerimiento de pago para una obligación vencida. Va con firma del cliente
 * porque en la práctica se usa como constancia de que se le notificó.
 */
const generarAvisoMora = ({ config, persona, resumen, descripcion, terminos = [], logo = null }) => {
  const doc = new PDFDocument({
    size: 'A4', margin: 0, bufferPages: true,
    info: {
      Title:  `Aviso de mora — ${persona.nombre}`,
      Author: config?.nombre_negocio || 'Mi Negocio',
      Subject: 'Requerimiento de pago',
    },
  });

  const numero = `#${String(resumen.numero).padStart(6, '0')}`;
  let y = encabezado(doc, {
    config, logo,
    titulo:    'Aviso de mora',
    numero,
    subtitulo: formatFechaHora(new Date()),
    franja:    C.rojo,
  });
  y += 24;

  // ── Franja de alerta: el dato que motiva el documento ─────────────────────
  // El aviso lo dispara la MORA, pero lo que se le cobra al cliente son las tres
  // cubetas: cobrarle solo capital + mora dejaría el interés sin reclamar.
  const moraPendiente    = Number(resumen.mora?.pendiente || 0);
  const interesPendiente = Number(resumen.interes_pendiente || 0);
  const totalHoy         = resumen.saldo + moraPendiente + interesPendiente;
  const ALERT_H = 66;
  rectFillStroke(doc, MARGIN, y, CONTENT_W, ALERT_H, C.rojoFondo, C.rojoBorde, 8);
  rectFill(doc, MARGIN, y, 4, ALERT_H, C.rojo, 0);
  doc.rect(MARGIN, y, 4, ALERT_H - 8).fill(C.rojo);

  doc.font(FONT.bold).fontSize(12).fillColor(C.rojo)
    .text('OBLIGACIÓN VENCIDA', MARGIN + 18, y + 12, { width: CONTENT_W * 0.55 });
  doc.font(FONT.normal).fontSize(8.5).fillColor(C.grisOscuro)
    .text(
      `Su obligación presenta ${resumen.dias_atraso} día(s) de atraso `
      + `desde el ${resumen.fecha_limite_txt}.`,
      MARGIN + 18, y + 30, { width: CONTENT_W * 0.55 },
    );

  doc.font(FONT.normal).fontSize(7.5).fillColor(C.grisClaro)
    .text('TOTAL A PAGAR HOY', MARGIN + CONTENT_W * 0.60, y + 14,
      { width: CONTENT_W * 0.40 - 14, align: 'right' });
  doc.font(FONT.bold).fontSize(17).fillColor(C.rojo)
    .text(formatCOP(totalHoy), MARGIN + CONTENT_W * 0.55, y + 28,
      { width: CONTENT_W * 0.45 - 14, align: 'right' });

  y += ALERT_H + 22;

  y = bloquePersona(doc, persona, y, { titulo: resumen.tipo === 'credito' ? 'Cliente' : 'Prestatario' });

  if (descripcion) {
    y = labelSeccion(doc, y, 'Obligación');
    doc.font(FONT.normal).fontSize(9).fillColor(C.grisOscuro)
      .text(descripcion, MARGIN, y, { width: CONTENT_W });
    y += doc.heightOfString(descripcion, { width: CONTENT_W }) + 16;
  }

  // ── Desglose de lo adeudado ───────────────────────────────────────────────
  y = labelSeccion(doc, y, 'Detalle de la deuda');
  const detalle = [['Saldo de capital pendiente', formatCOP(resumen.saldo)]];
  if (interesPendiente > 0) detalle.push(['Interés de financiación pendiente', formatCOP(interesPendiente)]);
  detalle.push(['Intereses de mora causados', formatCOP(moraPendiente)]);
  const H = detalle.length * 16 + 52;
  rectFillStroke(doc, MARGIN, y, CONTENT_W, H, C.blanco, C.grisBorde, 8);
  let yd = y + 12;
  for (const [l, v] of detalle) yd = fila(doc, yd, l, v, { x: MARGIN + 14, w: CONTENT_W - 28 });

  hLine(doc, yd + 2, { x1: MARGIN + 14, x2: PAGE_W - MARGIN - 14, color: C.grisBorde });
  doc.font(FONT.bold).fontSize(10).fillColor(C.grisOscuro)
    .text('TOTAL A PAGAR', MARGIN + 14, yd + 14, { width: CONTENT_W * 0.5, lineBreak: false });
  doc.font(FONT.bold).fontSize(14).fillColor(C.rojo)
    .text(formatCOP(totalHoy), MARGIN, yd + 11,
      { width: CONTENT_W - 14, align: 'right', lineBreak: false });
  y += H + 20;

  y = bloqueFechas(doc, resumen, y);
  y = tablaAbonos(doc, resumen, y, { titulo: 'Pagos recibidos' });
  y = bloqueCondiciones(doc, resumen, y, { compacto: true });

  // ── Términos ──────────────────────────────────────────────────────────────
  y = asegurarEspacio(doc, y, 150);
  y = labelSeccion(doc, y, 'Términos y condiciones');

  const textos = terminos.length ? terminos : [
    'Este documento constituye un requerimiento de pago por la obligación vencida descrita arriba.',
    'Los intereses de mora se liquidan sobre el saldo de capital pendiente, por los días de atraso, '
      + 'conforme a la condición pactada al momento de la venta.',
    'Se solicita ponerse al día o acercarse al establecimiento a acordar un plan de pago.',
  ];
  for (const t of textos) {
    const alto = doc.font(FONT.normal).fontSize(8).heightOfString(t, { width: CONTENT_W, lineGap: 1.5 });
    y = asegurarEspacio(doc, y, alto + 8);
    doc.font(FONT.normal).fontSize(8).fillColor(C.gris)
      .text(`• ${t}`, MARGIN, y, { width: CONTENT_W, lineGap: 1.5 });
    y += alto + 6;
  }

  // ── Firma ─────────────────────────────────────────────────────────────────
  y = asegurarEspacio(doc, y + 24, 70);
  y = bloqueFirma(doc, y + 20, {
    titulo: 'Firma de recibido del cliente',
    identificacion: [persona.nombre, persona.cedula ? `C.C. ${persona.cedula}` : null]
      .filter(Boolean).join('  ·  '),
  });

  pieDocumento(doc, { texto: `Aviso de mora ${numero} · ${config?.nombre_negocio || ''}` });
  doc.end();
  return doc;
};

// ─── Documento: PAZ Y SALVO ──────────────────────────────────────────────────

/**
 * Constancia de que la obligación quedó cancelada. Solo se emite si el saldo
 * está en cero: es un documento que compromete al negocio.
 */
const generarPazYSalvo = ({ config, persona, resumen, descripcion, logo = null }) => {
  const doc = new PDFDocument({
    size: 'A4', margin: 0, bufferPages: true,
    info: {
      Title:  `Paz y salvo — ${persona.nombre}`,
      Author: config?.nombre_negocio || 'Mi Negocio',
      Subject: 'Constancia de cancelación de obligación',
    },
  });

  const numero = `#${String(resumen.numero).padStart(6, '0')}`;
  let y = encabezado(doc, {
    config, logo,
    titulo:    'Paz y salvo',
    numero,
    subtitulo: formatFechaHora(new Date()),
    franja:    C.verde,
  });
  y += 24;

  // ── Declaración ───────────────────────────────────────────────────────────
  const DECL_H = 84;
  rectFillStroke(doc, MARGIN, y, CONTENT_W, DECL_H, C.verdeFondo, C.verdeBorde, 8);
  rectFill(doc, MARGIN, y, 4, DECL_H, C.verde, 0);
  doc.rect(MARGIN, y, 4, DECL_H - 8).fill(C.verde);

  doc.font(FONT.bold).fontSize(13).fillColor(C.verde)
    .text('CUENTA SALDADA', MARGIN + 18, y + 12, { width: CONTENT_W - 32 });
  doc.font(FONT.normal).fontSize(9).fillColor(C.grisOscuro)
    .text(
      `${config?.nombre_negocio || 'El establecimiento'} hace constar que `
      + `${persona.nombre}${persona.cedula && persona.cedula !== 'COMPANERO' ? `, identificado(a) con C.C. ${persona.cedula},` : ''} `
      + `canceló en su totalidad la obligación ${numero} y NO PRESENTA SALDO PENDIENTE alguno a la fecha.`,
      MARGIN + 18, y + 32, { width: CONTENT_W - 36, lineGap: 1.5 },
    );

  y += DECL_H + 22;

  y = bloquePersona(doc, persona, y, { titulo: resumen.tipo === 'credito' ? 'Cliente' : 'Prestatario' });

  if (descripcion) {
    y = labelSeccion(doc, y, 'Obligación cancelada');
    doc.font(FONT.normal).fontSize(9).fillColor(C.grisOscuro)
      .text(descripcion, MARGIN, y, { width: CONTENT_W });
    y += doc.heightOfString(descripcion, { width: CONTENT_W }) + 16;
  }

  // ── Cifras finales ────────────────────────────────────────────────────────
  y = labelSeccion(doc, y, 'Resumen de la obligación');
  const detalle = [
    [resumen.tipo === 'credito' ? 'Valor original de la venta' : 'Valor del préstamo',
      formatCOP(resumen.valor_original)],
    ...(resumen.devuelto > 0     ? [['Devoluciones',  `- ${formatCOP(resumen.devuelto)}`]] : []),
    ...(resumen.cuota_inicial > 0 ? [['Cuota inicial', formatCOP(resumen.cuota_inicial)]]  : []),
    [`Total abonado (${resumen.num_abonos} abono${resumen.num_abonos === 1 ? '' : 's'})`,
      formatCOP(resumen.total_abonado)],
    ['Fecha de emisión',    formatFecha(resumen.fecha_emision)],
    ...(resumen.fecha_ultimo_abono ? [['Fecha del último pago', formatFecha(resumen.fecha_ultimo_abono)]] : []),
    ['Fecha en que quedó saldada', formatFecha(resumen.fecha_ultimo_abono || new Date())],
  ];

  const H = detalle.length * 16 + 52;
  rectFillStroke(doc, MARGIN, y, CONTENT_W, H, C.blanco, C.grisBorde, 8);
  let yd = y + 12;
  for (const [l, v] of detalle) yd = fila(doc, yd, l, v, { x: MARGIN + 14, w: CONTENT_W - 28 });

  hLine(doc, yd + 2, { x1: MARGIN + 14, x2: PAGE_W - MARGIN - 14, color: C.grisBorde });
  doc.font(FONT.bold).fontSize(10).fillColor(C.grisOscuro)
    .text('SALDO PENDIENTE', MARGIN + 14, yd + 14, { width: CONTENT_W * 0.5, lineBreak: false });
  doc.font(FONT.bold).fontSize(14).fillColor(C.verde)
    .text(formatCOP(0), MARGIN, yd + 11, { width: CONTENT_W - 14, align: 'right', lineBreak: false });
  y += H + 20;

  y = tablaAbonos(doc, resumen, y, { titulo: 'Pagos recibidos' });

  // ── Firma / sello del establecimiento ─────────────────────────────────────
  y = asegurarEspacio(doc, y + 20, 110);
  doc.font(FONT.normal).fontSize(8).fillColor(C.grisClaro)
    .text(
      'Se expide la presente constancia a solicitud del interesado, '
      + `el ${formatFecha(new Date())}.`,
      MARGIN, y, { width: CONTENT_W },
    );
  y += 40;

  y = bloqueFirma(doc, y, {
    titulo: 'Firma y sello del establecimiento',
    identificacion: [config?.nombre_negocio, config?.nit ? `NIT ${config.nit}` : null]
      .filter(Boolean).join('  ·  '),
  });

  pieDocumento(doc, { texto: `Paz y salvo ${numero} · ${config?.nombre_negocio || ''}` });
  doc.end();
  return doc;
};

module.exports = {
  bloqueEstadoObligacion, bloqueFechas, tablaAbonos, tablaMovimientosMora,
  bloqueCondiciones, bloquePersona,
  generarAvisoMora, generarPazYSalvo,
};
