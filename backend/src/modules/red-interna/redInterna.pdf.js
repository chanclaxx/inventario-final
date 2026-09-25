// ─────────────────────────────────────────────────────────────────────────────
// PDF DE LA RED INTERNA — tres documentos, como los de préstamos:
//
//   1. UN ENVÍO (o una devolución): el documento tipo factura, con sus
//      productos, lo que llegó y lo que no, el cargo, los abonos, el saldo y
//      las firmas de quien entrega y quien recibe.
//   2. ENVÍOS ACTIVOS de un local: cada envío con saldo, con sus productos y
//      abonos, los cargos pendientes y lo que viene en camino.
//   3. ESTADO DE CUENTA de un local: todos los movimientos en orden con el
//      saldo corrido (el mismo extracto de la pantalla).
//
// ESTE MÓDULO SOLO DIBUJA. Los datos salen de las MISMAS funciones que alimentan
// la pantalla (`getRemision`, `getEstadoCuenta`, `repo.getExtracto`), así que:
//   · el PDF no puede decir una cifra distinta a la de la pantalla;
//   · hereda el control de acceso (un local solo imprime lo suyo) y el recorte
//     de valores para el vendedor (`costos_ocultos`), que viven en el backend.
// Si aquí se consultara la base por su cuenta, las dos cosas se separarían.
//
// Todo se dibuja con las herramientas de `utils/pdf.base.js` (tablas que se
// parten repitiendo la cabecera, texto acotado): «ningún salto lo decide
// PDFKit» — ver 43-pdf-factura.
// ─────────────────────────────────────────────────────────────────────────────

const PDFDocument = require('pdfkit');
const { pool } = require('../../config/db');
const {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W, BODY_BOTTOM, FONT, C, TONOS,
  formatCOP, formatFecha, formatFechaHora,
  rectFill, rectFillStroke, hLine, labelSeccion, fila,
  encabezado, badgeEstado, pieDocumento, asegurarEspacio,
  encabezadoContinuo, textoAcotado, medirTexto, tablaPaginada,
} = require('../../utils/pdf.base');

const HEADER_CONT_H = 40;
const CUERPO_TOP    = HEADER_CONT_H + 22;

const _num = (v) => Number(v || 0);

// Helvetica (las fuentes estándar de PDFKit) solo trae los caracteres de
// WinAnsi: el signo menos tipográfico (U+2212) y la flecha (U+2192) NO están y
// se imprimen como comillas. Todo lo que se pinta usa el guion ASCII y «a».
// Se vio al renderizar el PDF, no leyendo su texto: el texto decía «−$».
const _menos = (v) => (_num(v) > 0 ? `- ${formatCOP(v)}` : formatCOP(0));

const _config = async (negocioId) => {
  const { rows } = await pool.query(
    'SELECT clave, valor FROM config_negocio WHERE negocio_id = $1', [negocioId]);
  return Object.fromEntries(rows.map((r) => [r.clave, r.valor]));
};

const _nuevoDoc = (titulo, config) => new PDFDocument({
  size: 'A4',
  // Contrato con PDFKit (ver pdf.base): arriba el encabezado de continuación,
  // abajo el pie. Con margin 0 un salto automático caería en el filo del papel.
  margins: { top: CUERPO_TOP, bottom: PAGE_H - BODY_BOTTOM, left: MARGIN, right: MARGIN },
  autoFirstPage: true,
  bufferPages: true,
  info: { Title: titulo, Author: config?.nombre_negocio || 'Mi Negocio' },
});

const _continuacion = (texto) => (doc) => {
  rectFill(doc, 0, 0, PAGE_W, HEADER_CONT_H, C.headerBg, 0);
  doc.font(FONT.bold).fontSize(9).fillColor(C.headerText)
    .text(texto, MARGIN, 15, { width: CONTENT_W, lineBreak: false, ellipsis: true, height: 12 });
};

const _pie = (doc, config) => pieDocumento(doc, {
  // No es una factura de venta: es un documento interno entre sedes del mismo
  // negocio. Decirlo evita que alguien lo presente como tal.
  texto: `Documento interno entre sedes de ${config?.nombre_negocio || 'el negocio'} · `
    + `generado ${formatFechaHora(new Date())} · no es factura de venta`,
});

const _numeroDoc = (r) => `#${r.numero ?? r.id}`;

const ESTADO_REMISION = {
  'En transito': { texto: 'En camino',   tono: 'naranja', franja: C.naranja },
  Recibida:      { texto: 'Recibido',    tono: 'verde',   franja: C.verde   },
  Parcial:       { texto: 'Recibido parcial', tono: 'azul', franja: C.azul  },
  Anulada:       { texto: 'Anulado',     tono: 'gris',    franja: C.gris    },
};

const ESTADO_LINEA = {
  Pendiente: 'En camino',
  Recibida:  'Recibido',
  Faltante:  'No llegó',
  Devuelta:  'Devuelto',
};

const ORIGEN_ABONO = {
  remesa:       'Pago (remesa)',
  pago:         'Pago',
  pago_total:   'Pago total',
  gasto:        'Gasto por cuenta de bodega',
  ajuste:       'Ajuste a favor',
  saldo_favor:  'Saldo a favor aplicado',
  // Los movimientos de MORA del envío se dibujan con la misma tabla.
  condonacion:  'Mora condonada',
};

// 'YYYY-MM-DD' → 'DD/MM/AAAA' sin pasar por Date: una fecha límite es un DATE
// y convertirla a la zona de Bogotá la correría un día.
const _fechaLimite = (iso) => {
  const f = String(iso || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(f) ? f.split('-').reverse().join('/') : '';
};

// La mora del envío con las palabras del documento. `m` es el objeto `mora`
// que arma el backend (moraRed.moraDeEnvio); aquí no se calcula nada.
const _textoPlazo = (m, enTransito) => {
  if (!m) return null;
  const cond = m.condicion?.nombre ? `${m.condicion.nombre} (${m.descripcion})` : m.descripcion;
  if (m.aplica) {
    const estado = m.en_mora
      ? `vencido hace ${m.dias_vencidos} día(s)`
      : m.vencido ? 'vencido y al día'
      : m.dias_para_vencer != null ? `faltan ${m.dias_para_vencer} día(s)` : 'pagado';
    return `Plazo de pago: vence el ${_fechaLimite(m.fecha_limite)} (${estado}). Mora pactada: ${cond}.`;
  }
  if (enTransito && m.plazo_dias) {
    return `Plazo de pago: ${m.plazo_dias} día(s) desde que el local lo reciba. Mora pactada: ${cond}.`;
  }
  return null;
};

// Los movimientos de mora en la forma de la tabla de abonos.
const _abonosMora = (m) => (m?.movimientos || []).map((x) => (x.tipo === 'Condonacion'
  ? { fecha: x.fecha, origen: 'condonacion', valor: x.valor, anulado: false,
      movimiento_concepto: x.motivo || null }
  : { fecha: x.fecha, origen: x.origen, valor: x.valor, anulado: false,
      remesa_numero: x.remesa_numero, remesa_estado: x.remesa_estado,
      movimiento_concepto: `mora${x.dias_mora != null ? ` de ${x.dias_mora} día(s)` : ''}` }));

const _etiquetaAbono = (a) => {
  const base = ORIGEN_ABONO[a.origen] || (a.origen ? String(a.origen).replace(/_/g, ' ') : 'Abono');
  const doc = a.remesa_numero ? ` #${a.remesa_numero}` : '';
  return `${base}${doc}${a.movimiento_concepto ? ` · ${a.movimiento_concepto}` : ''}`;
};

// Un abono cuenta si no está anulado y, si viene de una remesa, si la bodega
// ya la confirmó. Es la MISMA regla de getRemision (`abonadoEfectivo`).
const _abonoCuenta = (a) => !a.anulado && (a.origen !== 'remesa' || a.remesa_estado === 'Recibida');

// ── Bloques compartidos ──────────────────────────────────────────────────────

/** Dos cajas lado a lado: de dónde sale y a dónde llega. */
const _bloquePartes = (doc, y, izq, der) => {
  const gap = 12;
  const w = (CONTENT_W - gap) / 2;
  const alto = 70;
  y = asegurarEspacio(doc, y, alto + 10);
  [[izq, MARGIN], [der, MARGIN + w + gap]].forEach(([p, x]) => {
    rectFillStroke(doc, x, y, w, alto, C.grisFondo, C.grisBorde, 8);
    doc.font(FONT.bold).fontSize(7).fillColor(C.grisClaro)
      .text(p.titulo.toUpperCase(), x + 12, y + 10, { width: w - 24, characterSpacing: 1.1, height: 10, lineBreak: false });
    textoAcotado(doc, p.nombre || '—', x + 12, y + 23, w - 24, { font: FONT.bold, size: 11, color: C.negro });
    p.lineas.filter(Boolean).slice(0, 2).forEach((linea, i) => {
      textoAcotado(doc, linea, x + 12, y + 40 + i * 12, w - 24, { size: 8, color: C.gris });
    });
  });
  return y + alto + 16;
};

/** Firmas lado a lado: quien entrega y quien recibe. */
const _firmas = (doc, y, izq, der) => {
  y = asegurarEspacio(doc, y + 30, 50);
  const w = 190;
  [[izq, MARGIN + 10], [der, PAGE_W - MARGIN - 10 - w]].forEach(([t, x]) => {
    doc.moveTo(x, y).lineTo(x + w, y).strokeColor(C.grisBorde).lineWidth(0.75).stroke();
    doc.font(FONT.bold).fontSize(8).fillColor(C.negro)
      .text(t.titulo, x, y + 6, { width: w, align: 'center', height: 11, lineBreak: false });
    if (t.detalle) {
      doc.font(FONT.normal).fontSize(7.5).fillColor(C.grisClaro)
        .text(t.detalle, x, y + 18, { width: w, align: 'center', height: 10, lineBreak: false, ellipsis: true });
    }
  });
  return y + 36;
};

/** Tabla de productos de un envío. `verValores` decide si hay columnas de plata. */
const _tablaProductos = (doc, y, lineas, { verValores, conEstado = true }) => {
  const cols = verValores
    ? [['#', 22, 'left'], ['Producto', null, 'left'], ['Cant.', 48, 'center'],
       ...(conEstado ? [['Estado', 70, 'left']] : []), ['Valor', 72, 'right'], ['Subtotal', 78, 'right']]
    : [['#', 22, 'left'], ['Producto', null, 'left'], ['Cant.', 60, 'center'],
       ...(conEstado ? [['Estado', 90, 'left']] : [])];
  const fijos = cols.reduce((s, c) => s + (c[1] || 0), 0);
  const pad = 10;
  const anchoProducto = CONTENT_W - fijos - pad * 2;
  const xs = [];
  let x = MARGIN + pad;
  for (const c of cols) { xs.push(x); x += c[1] ?? anchoProducto; }
  const ancho = (i) => cols[i][1] ?? anchoProducto;

  const cabecera = (d, yy) => {
    rectFill(d, MARGIN, yy, CONTENT_W, 22, C.headerBg, 8);
    d.rect(MARGIN, yy + 12, CONTENT_W, 10).fill(C.headerBg);
    cols.forEach((c, i) => {
      d.font(FONT.bold).fontSize(7.5).fillColor(C.headerText)
        .text(c[0].toUpperCase(), xs[i], yy + 7.5,
          { width: ancho(i) - 4, align: c[2], height: 10, lineBreak: false, characterSpacing: 0.6 });
    });
  };

  const filas = lineas.map((l, idx) => {
    const tachada = l.estado_linea === 'Faltante' || l.estado_linea === 'Devuelta';
    const cant = l.tipo === 'cantidad'
      ? (l.cantidad_recibida != null && Number(l.cantidad_recibida) !== Number(l.cantidad)
        ? `${l.cantidad_recibida} de ${l.cantidad}` : String(l.cantidad ?? 1))
      : '1';
    const subtitulo = [
      l.imei ? `IMEI ${l.imei}` : null,
      Number(l.cantidad_devuelta) > 0 ? `${l.cantidad_devuelta} devuelta(s) a la bodega` : null,
    ].filter(Boolean).join(' · ');
    const m = medirTexto(doc, l.nombre_producto || l.producto_nombre || 'Producto', anchoProducto - 6,
      { lineas: 2, font: FONT.bold, size: 8.5 });
    const alto = Math.max(22, m.alto + (subtitulo ? 12 : 0) + 10);
    return {
      alto,
      dibujar: (d, yy) => {
        const color = tachada ? C.grisClaro : C.negro;
        let i = 0;
        d.font(FONT.normal).fontSize(8).fillColor(C.grisClaro)
          .text(String(idx + 1), xs[i], yy + 6, { width: ancho(i), height: 10, lineBreak: false });
        i += 1;
        textoAcotado(d, l.nombre_producto || l.producto_nombre || 'Producto', xs[i], yy + 5, anchoProducto - 6,
          { lineas: 2, font: FONT.bold, size: 8.5, color });
        if (subtitulo) {
          textoAcotado(d, subtitulo, xs[i], yy + 5 + m.alto + 1, anchoProducto - 6,
            { size: 7, color: C.gris });
        }
        i += 1;
        d.font(FONT.normal).fontSize(8.5).fillColor(color)
          .text(cant, xs[i], yy + 6, { width: ancho(i) - 4, align: 'center', height: 11, lineBreak: false });
        i += 1;
        if (conEstado) {
          d.font(FONT.normal).fontSize(7.5).fillColor(tachada ? C.rojo : C.gris)
            .text(ESTADO_LINEA[l.estado_linea] || l.estado_linea || '—', xs[i], yy + 7,
              { width: ancho(i) - 4, height: 10, lineBreak: false, ellipsis: true });
          i += 1;
        }
        if (verValores) {
          d.font(FONT.normal).fontSize(8.5).fillColor(color)
            .text(formatCOP(l.valor_interno), xs[i], yy + 6, { width: ancho(i) - 4, align: 'right', height: 11, lineBreak: false });
          i += 1;
          d.font(FONT.bold).fontSize(8.5).fillColor(color)
            .text(formatCOP(l.subtotal), xs[i], yy + 6, { width: ancho(i) - 4, align: 'right', height: 11, lineBreak: false });
          if (tachada) {
            const ancla = xs[i] + ancho(i) - 4;
            const w = d.widthOfString(formatCOP(l.subtotal));
            d.moveTo(ancla - w, yy + 11).lineTo(ancla, yy + 11).strokeColor(C.grisClaro).lineWidth(0.6).stroke();
          }
        }
      },
    };
  });

  return tablaPaginada(doc, y, { cabeceraAlto: 22, dibujarCabecera: cabecera, filas, espacioDespues: 16 });
};

/** Filas de totales alineadas a la derecha, dentro de una caja. */
const _cajaTotales = (doc, y, filasTot, { destacada = null } = {}) => {
  const w = 250;
  const x = PAGE_W - MARGIN - w;
  const alto = filasTot.length * 16 + (destacada ? 30 : 0) + 14;
  y = asegurarEspacio(doc, y, alto);
  rectFillStroke(doc, x, y, w, alto, C.grisFondo, C.grisBorde, 8);
  let yy = y + 8;
  for (const [label, valor, color] of filasTot) {
    yy = fila(doc, yy, label, valor, { x: x + 12, w: w - 24, valorColor: color || C.negro });
  }
  if (destacada) {
    hLine(doc, yy + 2, { x1: x + 12, x2: x + w - 12, color: C.grisBorde });
    fila(doc, yy + 8, destacada[0], destacada[1], {
      x: x + 12, w: w - 24, labelFont: FONT.bold, valorFont: FONT.bold,
      labelSize: 10, valorSize: 12, valorColor: destacada[2] || C.negro, alto: 18,
    });
  }
  return y + alto + 14;
};

const _nota = (doc, y, texto, tono = 'azul') => {
  const t = TONOS[tono] || TONOS.gris;
  const m = medirTexto(doc, texto, CONTENT_W - 24, { lineas: 4, size: 8 });
  const alto = m.alto + 14;
  y = asegurarEspacio(doc, y, alto);
  rectFillStroke(doc, MARGIN, y, CONTENT_W, alto, t.bg, t.borde, 8);
  textoAcotado(doc, texto, MARGIN + 12, y + 7, CONTENT_W - 24, { lineas: 4, size: 8, color: t.fg });
  return y + alto + 12;
};

const _tablaAbonos = (doc, y, abonos) => {
  const cols = [[MARGIN + 10, 90, 'Fecha'], [MARGIN + 100, CONTENT_W - 230, 'Concepto'],
    [PAGE_W - MARGIN - 130, 120, 'Valor']];
  const cabecera = (d, yy) => {
    rectFill(d, MARGIN, yy, CONTENT_W, 20, C.grisBorde, 8);
    d.rect(MARGIN, yy + 10, CONTENT_W, 10).fill(C.grisBorde);
    cols.forEach(([x, w, t], i) => d.font(FONT.bold).fontSize(7.5).fillColor(C.grisOscuro)
      .text(t.toUpperCase(), x, yy + 6.5, { width: w, align: i === 2 ? 'right' : 'left', height: 10, lineBreak: false }));
  };
  const filas = abonos.map((a) => {
    const cuenta = _abonoCuenta(a);
    const nota = a.anulado ? 'anulado' : (a.origen === 'remesa' && a.remesa_estado !== 'Recibida')
      ? 'en camino: cuenta cuando la bodega lo confirme' : null;
    return {
      alto: nota ? 30 : 20,
      dibujar: (d, yy) => {
        const color = cuenta ? C.negro : C.grisClaro;
        d.font(FONT.normal).fontSize(8).fillColor(color)
          .text(formatFecha(a.fecha), cols[0][0], yy + 6, { width: cols[0][1], height: 10, lineBreak: false });
        textoAcotado(d, _etiquetaAbono(a), cols[1][0], yy + 6, cols[1][1], { size: 8, color });
        if (nota) textoAcotado(d, nota, cols[1][0], yy + 17, cols[1][1], { size: 7, color: C.naranja });
        d.font(FONT.bold).fontSize(8.5).fillColor(cuenta ? C.verde : C.grisClaro)
          .text(_menos(a.valor), cols[2][0], yy + 6, { width: cols[2][1], align: 'right', height: 11, lineBreak: false });
      },
    };
  });
  return tablaPaginada(doc, y, { cabeceraAlto: 20, dibujarCabecera: cabecera, filas, espacioDespues: 14 });
};

// ═════════════════════════════════════════════════════════════════════════════
// 1. UN ENVÍO (o una devolución)
// ═════════════════════════════════════════════════════════════════════════════

const construirPdfEnvio = (r, config) => {
  const esDevolucion = r.tipo === 'devolucion';
  const verValores = !r.costos_ocultos;
  const estado = ESTADO_REMISION[r.estado] || { texto: r.estado, tono: 'gris', franja: C.gris };
  const titulo = esDevolucion ? 'Devolución a bodega' : 'Envío de mercancía';
  const doc = _nuevoDoc(`${titulo} ${_numeroDoc(r)}`, config);
  encabezadoContinuo(doc, _continuacion(`${titulo} ${_numeroDoc(r)} · de ${r.sucursal_origen_nombre} a ${r.sucursal_destino_nombre}`));

  let y = encabezado(doc, {
    config, titulo, numero: _numeroDoc(r),
    subtitulo: `Emitido ${formatFecha(r.fecha_emision)}`,
    franja: estado.franja,
  });
  y += 16;
  badgeEstado(doc, estado.texto, estado.tono, PAGE_W - MARGIN - 110, y, { w: 110 });
  if (r.pedido?.numero) {
    doc.font(FONT.normal).fontSize(8).fillColor(C.gris)
      .text(`Responde al pedido #${r.pedido.numero}`, MARGIN, y + 6, { width: 260, height: 10, lineBreak: false });
  }
  y += 30;

  y = _bloquePartes(doc, y,
    { titulo: esDevolucion ? 'Devuelve (local)' : 'Sale de (bodega)', nombre: r.sucursal_origen_nombre,
      lineas: [`Despachó: ${r.usuario_emisor_nombre || '—'}`, `Fecha: ${formatFechaHora(r.fecha_emision)}`] },
    { titulo: esDevolucion ? 'Recibe (bodega)' : 'Llega a (local)', nombre: r.sucursal_destino_nombre,
      lineas: r.fecha_recepcion
        ? [`Recibió: ${r.usuario_receptor_nombre || '—'}`, `Fecha: ${formatFechaHora(r.fecha_recepcion)}`]
        : ['Aún no se ha recibido'] });

  // El plazo de pago va ANTES de los productos: es la condición del
  // documento, y quien lo firma tiene que leerla.
  const textoPlazo = esDevolucion ? null : _textoPlazo(r.mora, r.estado === 'En transito');
  if (textoPlazo) y = _nota(doc, y, textoPlazo, r.mora?.en_mora ? 'rojo' : 'azul');

  y = labelSeccion(doc, y, `Productos (${(r.lineas || []).length})`, { reservar: 44 });
  y = _tablaProductos(doc, y, r.lineas || [], { verValores });

  if (esDevolucion) {
    const confirmada = r.estado === 'Recibida' || r.estado === 'Parcial';
    const filasTot = [];
    if (verValores) {
      filasTot.push(['Valor de la mercancía devuelta',
        formatCOP((r.lineas || []).reduce((s, l) => s + _num(l.subtotal), 0))]);
    }
    y = _cajaTotales(doc, y, filasTot, {
      destacada: confirmada
        // Viene calculado de getRemision (antes del recorte del vendedor): es
        // cuenta, no valorización, y el vendedor también tiene que verlo.
        ? ['Acreditado a la cuenta', formatCOP(r.resumen?.acreditado), C.verde]
        : ['Acreditado a la cuenta', 'Pendiente', C.naranja],
    });
    if (!confirmada && r.estado !== 'Anulada') {
      y = _nota(doc, y, 'La bodega todavía no ha revisado esta devolución: la cuenta del local no baja hasta que la confirme.', 'naranja');
    }
  } else {
    const s = r.resumen || {};
    const filasTot = [];
    if (verValores) {
      filasTot.push(['Valor enviado', formatCOP(s.enviado)]);
      if (_num(s.no_llego) > 0) filasTot.push(['No llegó', _menos(s.no_llego), C.rojo]);
      if (_num(s.devuelto) > 0) filasTot.push(['Devuelto a la bodega', _menos(s.devuelto), C.rojo]);
    }
    filasTot.push(['Cargo del envío', formatCOP(s.cargo)]);
    filasTot.push(['Abonado', _menos(s.abonado), C.verde]);
    // Con mora causada, el saldo del producto y la mora van por separado y el
    // total es la suma: la misma lectura de un crédito con mora.
    const m = r.mora || {};
    const conMora = m.aplica && (_num(m.causada) > 0 || _num(m.cobrada) > 0 || _num(m.condonada) > 0);
    if (conMora) {
      filasTot.push(['Saldo del producto', formatCOP(s.saldo), _num(s.saldo) > 0 ? C.rojo : C.verde]);
      filasTot.push([`Mora (${m.dias_cobrables} día(s) de atraso)`, formatCOP(m.causada), C.rojo]);
      if (_num(m.cobrada) > 0)   filasTot.push(['Mora pagada', _menos(m.cobrada), C.verde]);
      if (_num(m.condonada) > 0) filasTot.push(['Mora condonada', _menos(m.condonada), C.verde]);
    }
    const total = conMora ? _num(s.saldo) + _num(m.pendiente) : _num(s.saldo);
    y = _cajaTotales(doc, y, filasTot, {
      destacada: [conMora ? 'Total a pagar' : 'Saldo pendiente', formatCOP(total), total > 0 ? C.rojo : C.verde],
    });

    if (r.estado === 'En transito') {
      y = _nota(doc, y, 'Este envío todavía no se ha recibido. No genera deuda hasta que el local confirme qué le llegó.', 'naranja');
    } else if (r.estado === 'Anulada') {
      y = _nota(doc, y, 'Envío anulado: no genera ninguna deuda.', 'gris');
    }

    const abonos = r.abonos || [];
    if (abonos.length) {
      y = labelSeccion(doc, y, 'Abonos a este envío', { reservar: 40 });
      y = _tablaAbonos(doc, y, abonos);
    }
    const movMora = _abonosMora(r.mora);
    if (movMora.length) {
      y = labelSeccion(doc, y, 'Mora de este envío: pagos y condonaciones', { reservar: 40 });
      y = _tablaAbonos(doc, y, movMora);
    }
    if (verValores && (r.correcciones || []).length) {
      y = labelSeccion(doc, y, 'Correcciones de valor', { reservar: 20 });
      for (const c of r.correcciones) {
        y = asegurarEspacio(doc, y, 14);
        textoAcotado(doc, `${c.nombre_producto || 'Producto'}: ${formatCOP(c.valor_anterior)} a ${formatCOP(c.valor_nuevo)}`
          + `${c.motivo ? ` · ${c.motivo}` : ''} · ${formatFecha(c.fecha)}`, MARGIN, y, CONTENT_W, { size: 8, color: C.gris });
        y += 13;
      }
      y += 6;
    }
  }

  if (r.notas) y = _nota(doc, y, `Notas: ${r.notas}`, 'gris');

  _firmas(doc, y,
    { titulo: 'Entregó', detalle: r.sucursal_origen_nombre },
    { titulo: 'Recibió', detalle: r.sucursal_destino_nombre });

  _pie(doc, config);
  doc.end();
  return doc;
};

const generarPdfEnvio = async (req, remisionId) => {
  const service = require('./redInterna.service');
  const r = await service.getRemision(req, remisionId);
  const config = await _config(req.user.negocio_id);
  return construirPdfEnvio(r, config);
};

// ═════════════════════════════════════════════════════════════════════════════
// 2. ENVÍOS ACTIVOS de un local
// ═════════════════════════════════════════════════════════════════════════════

const construirPdfEnviosActivos = (data, config) => {
  const verValores = !data.costos_ocultos;
  const t = data.totales || {};
  const local = data.sucursal?.nombre || 'Local';
  // Por pagar = capital o mora: un envío con el producto cubierto y la mora
  // pendiente todavía se debe.
  const envios = (data.envios || []).filter((e) => _num(e.saldo) > 0 || _num(e.mora?.pendiente) > 0)
    .sort((a, b) => new Date(a.fecha_recepcion || a.fecha_emision) - new Date(b.fecha_recepcion || b.fecha_emision));
  const cargos = (data.cargos || []).filter((c) => _num(c.saldo) > 0);
  const enCamino = (data.remisiones || []).filter((r) => r.estado === 'En transito' && r.tipo !== 'devolucion');
  const abonosPorEnvio = new Map();
  for (const a of data.abonos || []) {
    if (!a.remision_id) continue;
    const k = Number(a.remision_id);
    if (!abonosPorEnvio.has(k)) abonosPorEnvio.set(k, []);
    abonosPorEnvio.get(k).push(a);
  }

  const doc = _nuevoDoc(`Envíos pendientes — ${local}`, config);
  encabezadoContinuo(doc, _continuacion(`Envíos pendientes · ${local}`));
  let y = encabezado(doc, {
    config, titulo: 'Envíos pendientes de pago', numero: null,
    subtitulo: `${local} · ${formatFecha(new Date())}`,
    franja: _num(t.deuda_total) > 0 ? C.rojo : C.verde,
  });
  y += 18;

  // Lo que se debe DE VERDAD: capital + mora. Sin mora es exactamente la deuda.
  const totalDebe = _num(t.deuda_total) + _num(t.mora_pendiente);

  // Resumen arriba: lo primero que pregunta quien recibe el PDF.
  const tarjetas = [
    ['Debe en total', formatCOP(totalDebe), totalDebe > 0 ? C.rojo : C.verde],
    ['Envíos con saldo', String(envios.length), C.negro],
    ['Cargos pendientes', String(cargos.length), C.negro],
    _num(t.saldo_a_favor) > 0
      ? ['Saldo a favor', formatCOP(t.saldo_a_favor), C.verde]
      : ['En camino', String(enCamino.length), C.negro],
  ];
  const tw = (CONTENT_W - 30) / 4;
  tarjetas.forEach(([l, v, c], i) => {
    const x = MARGIN + i * (tw + 10);
    rectFillStroke(doc, x, y, tw, 46, C.grisFondo, C.grisBorde, 8);
    doc.font(FONT.normal).fontSize(7.5).fillColor(C.gris).text(l, x + 10, y + 9, { width: tw - 20, height: 10, lineBreak: false });
    doc.font(FONT.bold).fontSize(12).fillColor(c).text(v, x + 10, y + 23, { width: tw - 20, height: 15, lineBreak: false, ellipsis: true });
  });
  y += 62;

  if (!envios.length && !cargos.length) {
    y = _nota(doc, y, `${local} no tiene envíos ni cargos pendientes de pago.`, 'verde');
  }

  for (const e of envios) {
    y = asegurarEspacio(doc, y, 90);
    rectFill(doc, MARGIN, y, CONTENT_W, 28, C.azulFondo, 8);
    doc.font(FONT.bold).fontSize(10).fillColor(C.negro)
      .text(`Envío #${e.numero ?? e.id}`, MARGIN + 12, y + 9, { width: 200, height: 12, lineBreak: false });
    const me = e.mora || {};
    const vence = me.aplica
      ? (me.en_mora ? ` · vencido hace ${me.dias_vencidos} día(s)` : ` · vence ${_fechaLimite(me.fecha_limite)}`)
      : '';
    doc.font(FONT.normal).fontSize(8).fillColor(me.en_mora ? C.rojo : C.gris)
      .text(`Recibido ${formatFecha(e.fecha_recepcion || e.fecha_emision)}${vence}`, MARGIN + 120, y + 10.5, { width: 240, height: 10, lineBreak: false, ellipsis: true });
    doc.font(FONT.bold).fontSize(10).fillColor(C.rojo)
      .text(`Debe ${formatCOP(_num(e.saldo) + _num(me.pendiente))}`, MARGIN + 360, y + 9, { width: CONTENT_W - 372, align: 'right', height: 12, lineBreak: false });
    y += 36;
    y = _tablaProductos(doc, y, (e.lineas || []).map((l) => ({ ...l, cantidad_recibida: null })), { verValores });
    const abonos = abonosPorEnvio.get(Number(e.id)) || [];
    if (abonos.length) y = _tablaAbonos(doc, y, abonos);
    const filasEnvio = [
      ['Cargo del envío', formatCOP(e.cargo)],
      ['Abonado', _menos(e.abonado), C.verde],
    ];
    if (_num(me.pendiente) > 0) {
      filasEnvio.push(['Saldo del producto', formatCOP(e.saldo)]);
      filasEnvio.push([`Mora pendiente (${me.dias_vencidos} día(s))`, formatCOP(me.pendiente), C.rojo]);
    }
    y = _cajaTotales(doc, y, filasEnvio, {
      destacada: [_num(me.pendiente) > 0 ? 'Total a pagar' : 'Saldo',
        formatCOP(_num(e.saldo) + _num(me.pendiente)), C.rojo],
    });
  }

  if (cargos.length) {
    y = labelSeccion(doc, y, 'Cargos pendientes (no vienen de un envío)', { reservar: 40 });
    const filas = cargos.map((c) => ({
      alto: 22,
      dibujar: (d, yy) => {
        d.font(FONT.normal).fontSize(8).fillColor(C.gris)
          .text(formatFecha(c.fecha), MARGIN + 10, yy + 7, { width: 70, height: 10, lineBreak: false });
        textoAcotado(d, c.concepto || 'Cargo', MARGIN + 85, yy + 7, CONTENT_W - 300, { size: 8.5 });
        d.font(FONT.normal).fontSize(8).fillColor(C.gris)
          .text(`${formatCOP(c.cargo)} · abonado ${formatCOP(c.abonado)}`, PAGE_W - MARGIN - 215, yy + 7,
            { width: 120, align: 'right', height: 10, lineBreak: false });
        d.font(FONT.bold).fontSize(8.5).fillColor(C.rojo)
          .text(formatCOP(c.saldo), PAGE_W - MARGIN - 90, yy + 7, { width: 80, align: 'right', height: 11, lineBreak: false });
      },
    }));
    y = tablaPaginada(doc, y, { filas, espacioDespues: 14 });
  }

  if (enCamino.length) {
    y = labelSeccion(doc, y, 'En camino (todavía no generan deuda)', { reservar: 20 });
    for (const r of enCamino) {
      y = asegurarEspacio(doc, y, 14);
      textoAcotado(doc, `Envío #${r.numero ?? r.id} · despachado ${formatFecha(r.fecha_emision)}`,
        MARGIN, y, CONTENT_W, { size: 8.5, color: C.gris });
      y += 14;
    }
    y += 8;
  }

  // El total sale de los totales del local, NO de sumar esta lista: es la
  // misma cifra grande de la pantalla, y sumar tarjetas topadas daría menos.
  const filasFinal = [
    ['Envíos con saldo', formatCOP(envios.reduce((s, e) => s + _num(e.saldo), 0))],
    ['Cargos pendientes', formatCOP(cargos.reduce((s, c) => s + _num(c.saldo), 0))],
  ];
  // La mora sale de los totales del local, igual que la deuda.
  if (_num(t.mora_pendiente) > 0) filasFinal.push(['Mora por pagar tarde', formatCOP(t.mora_pendiente), C.rojo]);
  y = _cajaTotales(doc, y, filasFinal,
    { destacada: ['Total que debe', formatCOP(totalDebe), totalDebe > 0 ? C.rojo : C.verde] });

  _pie(doc, config);
  doc.end();
  return doc;
};

const generarPdfEnviosActivos = async (req, sucursalId) => {
  const service = require('./redInterna.service');
  const data = await service.getEstadoCuenta(req, sucursalId, {});
  const config = await _config(req.user.negocio_id);
  return construirPdfEnviosActivos(data, config);
};

// ═════════════════════════════════════════════════════════════════════════════
// 3. ESTADO DE CUENTA de un local
// ═════════════════════════════════════════════════════════════════════════════

const TIPO_LABEL = {
  remision:   { label: 'Envío',      bg: '#FFFBEB', text: '#D97706' },
  devolucion: { label: 'Devolución', bg: '#F5F3FF', text: '#7C3AED' },
  remesa:     { label: 'Pago',       bg: '#ECFDF5', text: '#059669' },
  gasto:      { label: 'Gasto',      bg: '#EFF6FF', text: '#2563EB' },
  ajuste:     { label: 'Ajuste',     bg: '#F3F4F6', text: '#374151' },
  correccion: { label: 'Corrección', bg: '#F3F4F6', text: '#6B7280' },
  venta:      { label: 'Venta',      bg: '#F3F4F6', text: '#6B7280' },
  mora:       { label: 'Mora',       bg: '#FEF2F2', text: '#DC2626' },
};

/**
 * El extracto de la pantalla, del más viejo al más nuevo, en la forma del PDF
 * compartido de estado de cuenta. Positivo = cargo (sube la deuda), negativo =
 * abono. Lo INFORMATIVO (una venta, una corrección, un gasto sin aprobar) no
 * mueve el saldo: se muestra atenuado y sin saldo.
 */
const movimientosDeExtracto = (extracto) => [...extracto].reverse().map((e) => {
  const valor = _num(e.valor);
  const info = e.clase === 'info';
  return {
    fecha:    e.fecha,
    tipo:     e.origen,
    concepto: `${e.concepto}${e.documento ? ` #${e.documento}` : ''}`,
    cargo:    !info && valor > 0 ? valor : null,
    abono:    !info && valor < 0 ? -valor : null,
    saldo:    info ? null : _num(e.saldo),
    nota:     e.detalle || null,
    atenuado: info,
  };
});

const generarPdfEstadoCuentaLocal = async (req, sucursalId) => {
  const service = require('./redInterna.service');
  const repo = require('./redInterna.repository');
  const { construirPdfEstadoCuenta } = require('../../utils/estadoCuenta.pdf');
  // getEstadoCuenta hace el control de acceso (un local solo ve lo suyo) y dice
  // si el usuario ve valores. El extracto se vuelve a pedir SIN el tope de 300
  // de la pantalla: el PDF es el historial completo.
  const data = await service.getEstadoCuenta(req, sucursalId, {});
  const extracto = await repo.getExtracto(req.user.negocio_id, data.sucursal.id, { limit: 20000 });
  const movimientos = movimientosDeExtracto(extracto);
  const conSaldo = movimientos.filter((m) => m.saldo != null);
  const saldoFinal = conSaldo.length ? conSaldo[conSaldo.length - 1].saldo : 0;
  const config = await _config(req.user.negocio_id);
  return {
    saldoFinal,
    doc: construirPdfEstadoCuenta({
      persona: { nombre: data.sucursal.nombre },
      // El extracto cuenta HECHOS: la mora cobrada está dentro, la pendiente
      // no (es un cálculo de hoy). Se dice aquí para que el saldo final no se
      // lea como todo lo que se debe.
      subtitulo: 'Local de la red interna · negativo = saldo a favor del local'
        + (_num(data.totales?.mora_pendiente) > 0
          ? ` · además debe ${formatCOP(data.totales.mora_pendiente)} de mora pendiente`
          : ''),
      movimientos, saldoFinal, config,
      logoNegocio: config.logo_negocio,
      tipoLabels: TIPO_LABEL,
      negocioNombre: config.nombre_negocio,
    }),
  };
};

module.exports = {
  generarPdfEnvio, generarPdfEnviosActivos, generarPdfEstadoCuentaLocal,
  // Para las pruebas: dibujan sin tocar la base.
  construirPdfEnvio, construirPdfEnviosActivos, movimientosDeExtracto,
};
