// ─────────────────────────────────────────────────────────────────────────────
// PDF DE GARANTÍAS CON PROVEEDORES — dos documentos:
//
//   1. EL CASO (comprobante para el CLIENTE): qué producto dejó, qué falla, qué
//      entregó, y qué se hizo (otra unidad, el dinero, o queda esperando).
//      NUNCA lleva costos: lo lee el cliente al otro lado del mostrador.
//   2. EL ENVÍO (guía para el PROVEEDOR): cada unidad que va en la caja, con su
//      IMEI, la falla, la compra de la que vino y hasta cuándo responde. El
//      valor solo sale si quien imprime puede ver costos (el recorte ya viene
//      del service: `costos_ocultos`).
//
// SOLO DIBUJA: los datos salen de `service.detalle` y `service.getEnvio`, las
// mismas funciones de la pantalla. Todo se dibuja con `pdf.base` («ningún salto
// lo decide PDFKit», ver 43-pdf-factura) y solo con caracteres de WinAnsi.
// ─────────────────────────────────────────────────────────────────────────────

const PDFDocument = require('pdfkit');
const { pool } = require('../../config/db');
const {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W, BODY_BOTTOM, FONT, C, TONOS,
  formatCOP, formatFecha, formatFechaHora,
  rectFill, rectFillStroke, labelSeccion, fila,
  encabezado, badgeEstado, pieDocumento, asegurarEspacio,
  encabezadoContinuo, textoAcotado, medirTexto, tablaPaginada,
} = require('../../utils/pdf.base');

const HEADER_CONT_H = 40;
const CUERPO_TOP    = HEADER_CONT_H + 22;
const _num = (v) => Number(v || 0);

const _config = async (negocioId, sucursalId) => {
  const { rows } = await pool.query('SELECT clave, valor FROM config_negocio WHERE negocio_id = $1', [negocioId]);
  return require('../../utils/emisor.util').configDocumento(
    negocioId, sucursalId, Object.fromEntries(rows.map((r) => [r.clave, r.valor])));
};

const _nuevoDoc = (titulo, config) => new PDFDocument({
  size: 'A4',
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

// 'YYYY-MM-DD' → 'DD/MM/AAAA' sin pasar por Date (un DATE en Bogotá se correría un día).
const _fechaDia = (iso) => {
  const f = String(iso || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(f) ? f.split('-').reverse().join('/') : '';
};

const _bloquePartes = (doc, y, izq, der) => {
  const gap = 12;
  const w = (CONTENT_W - gap) / 2;
  const alto = 70;
  y = asegurarEspacio(doc, y, alto + 10);
  [[izq, MARGIN], [der, MARGIN + w + gap]].forEach(([p, x]) => {
    rectFillStroke(doc, x, y, w, alto, C.grisFondo, C.grisBorde, 8);
    doc.font(FONT.bold).fontSize(7).fillColor(C.grisClaro)
      .text(p.titulo.toUpperCase(), x + 12, y + 10, { width: w - 24, characterSpacing: 1.1, height: 10, lineBreak: false });
    textoAcotado(doc, p.nombre || '-', x + 12, y + 23, w - 24, { font: FONT.bold, size: 11, color: C.negro });
    p.lineas.filter(Boolean).slice(0, 2).forEach((linea, i) => {
      textoAcotado(doc, linea, x + 12, y + 40 + i * 12, w - 24, { size: 8, color: C.gris });
    });
  });
  return y + alto + 16;
};

const _nota = (doc, y, texto, tono = 'azul') => {
  const t = TONOS[tono] || TONOS.gris;
  const m = medirTexto(doc, texto, CONTENT_W - 24, { lineas: 6, size: 8 });
  const alto = m.alto + 14;
  y = asegurarEspacio(doc, y, alto);
  rectFillStroke(doc, MARGIN, y, CONTENT_W, alto, t.bg, t.borde, 8);
  textoAcotado(doc, texto, MARGIN + 12, y + 7, CONTENT_W - 24, { lineas: 6, size: 8, color: t.fg });
  return y + alto + 12;
};

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

/** Tabla genérica: columnas [titulo, ancho|null, alinear] y filas de textos. */
const _tabla = (doc, y, cols, filas) => {
  const fijos = cols.reduce((s, c) => s + (c[1] || 0), 0);
  const pad = 10;
  const flexible = CONTENT_W - fijos - pad * 2;
  const xs = [];
  let x = MARGIN + pad;
  for (const c of cols) { xs.push(x); x += c[1] ?? flexible; }
  const ancho = (i) => (cols[i][1] ?? flexible) - 6;
  const cabecera = (d, yy) => {
    rectFill(d, MARGIN, yy, CONTENT_W, 20, C.grisBorde, 8);
    d.rect(MARGIN, yy + 10, CONTENT_W, 10).fill(C.grisBorde);
    cols.forEach(([t, , al], i) => d.font(FONT.bold).fontSize(7.5).fillColor(C.grisOscuro)
      .text(String(t).toUpperCase(), xs[i], yy + 6.5, { width: ancho(i), align: al || 'left', height: 10, lineBreak: false }));
  };
  const filasPdf = filas.map((f) => {
    const sub = f.sub || null;
    const altoSub = sub ? medirTexto(doc, sub, ancho(1), { lineas: 3, size: 7.5 }).alto : 0;
    return {
      alto: 20 + (sub ? altoSub + 3 : 0),
      dibujar: (d, yy) => {
        f.celdas.forEach((v, i) => {
          textoAcotado(d, v == null ? '' : String(v), xs[i], yy + 6, ancho(i),
            { size: 8, color: C.negro, font: i === 1 ? FONT.bold : FONT.normal, align: cols[i][2] || 'left' });
        });
        if (sub) textoAcotado(d, sub, xs[1], yy + 17, ancho(1), { lineas: 3, size: 7.5, color: C.gris });
      },
    };
  });
  return tablaPaginada(doc, y, { cabeceraAlto: 20, dibujarCabecera: cabecera, filas: filasPdf, espacioDespues: 14 });
};

const ESTADO_CLIENTE = {
  pendiente: { texto: 'Cliente espera', tono: 'naranja', franja: C.naranja },
  resuelto:  { texto: 'Resuelto',       tono: 'verde',   franja: C.verde },
  no_aplica: { texto: 'En garantía',    tono: 'azul',    franja: C.azul },
  anulado:   { texto: 'Anulada',        tono: 'gris',    franja: C.gris },
};

// Lo que se hizo con el cliente, con palabras del documento.
const _textoCliente = (m) => {
  if (m.tipo === 'cambio') {
    return `Se le entregó otra unidad: ${m.nombre_producto || 'producto'}${m.imei ? ` (IMEI ${m.imei})` : ''}`
      + `${_num(m.cantidad) > 1 ? ` x ${m.cantidad}` : ''}.`;
  }
  if (m.metodo === 'Crédito') return `Se devolvió la línea a la venta a crédito: el crédito bajó ${formatCOP(m.valor)}.`;
  return `Se le devolvió ${formatCOP(m.valor)} (${m.metodo || 'Efectivo'}).`;
};

// ═════════════════════════════════════════════════════════════════════════════
// 1. EL CASO — comprobante para el cliente
// ═════════════════════════════════════════════════════════════════════════════

const construirPdfReclamo = (r, config) => {
  const numero = `#${r.numero ?? r.id}`;
  const lineas = r.lineas || [];
  const estadoCli = r.anulado ? 'anulado'
    : r.origen_tipo === 'inventario' ? 'no_aplica'
      : lineas.every((l) => l.estado_cliente === 'resuelto') ? 'resuelto' : 'pendiente';
  const est = ESTADO_CLIENTE[estadoCli];
  const doc = _nuevoDoc(`Garantía ${numero}`, config);
  encabezadoContinuo(doc, _continuacion(`Garantía ${numero}${r.cliente_nombre ? ` · ${r.cliente_nombre}` : ''}`));

  let y = encabezado(doc, {
    config, titulo: 'Recibo de garantía', numero,
    subtitulo: `Recibido ${formatFechaHora(r.fecha)}`, franja: est.franja,
  });
  y += 16;
  badgeEstado(doc, est.texto, est.tono, PAGE_W - MARGIN - 110, y, { w: 110 });
  y += 30;

  const doc_origen = r.factura_numero
    ? `Factura #${String(r.factura_numero).padStart(6, '0')}`
    : r.prestamo_numero ? `Préstamo #${r.prestamo_numero}` : 'Inventario de la tienda';
  y = _bloquePartes(doc, y,
    { titulo: 'Cliente', nombre: r.cliente_nombre || (r.origen_tipo === 'inventario' ? 'Sin cliente' : '-'),
      lineas: [r.cliente_cedula ? `C.C./NIT: ${r.cliente_cedula}` : null, r.cliente_telefono ? `Tel: ${r.cliente_telefono}` : null] },
    { titulo: 'Recibido en', nombre: r.sucursal_nombre,
      lineas: [`Por: ${r.usuario_nombre || '-'}`, doc_origen] });

  y = labelSeccion(doc, y, 'Producto', { reservar: 44 });
  y = _tabla(doc, y, [['#', 22], ['Producto', null], ['Cant.', 46, 'center']],
    lineas.map((l, i) => ({
      celdas: [i + 1, l.nombre_producto, l.cantidad],
      sub: [l.variante_texto, l.imei ? `IMEI ${l.imei}` : null].filter(Boolean).join(' · ') || null,
    })));

  const detalles = [`Falla reportada: ${r.falla}`];
  if (r.estado_fisico) detalles.push(`Estado físico: ${r.estado_fisico}`);
  const acc = Array.isArray(r.accesorios) ? r.accesorios : [];
  detalles.push(`Entregó: ${acc.length ? acc.join(', ') : 'solo el producto'}`);
  y = _nota(doc, y, detalles.join('\n'), 'gris');

  if (r.origen_tipo !== 'inventario') {
    const movCli = (r.movimientos || []).filter((m) => m.lado === 'cliente' && !m.anulado);
    y = labelSeccion(doc, y, 'Qué se hizo', { reservar: 30 });
    for (const m of movCli) {
      y = _nota(doc, y, `${formatFechaHora(m.fecha)} · ${_textoCliente(m)}`, 'verde');
    }
    const faltan = lineas.reduce((s, l) => s + Math.max(0, _num(l.cantidad) - _num(l.cantidad_cliente)), 0);
    if (!r.anulado && faltan > 0) {
      y = _nota(doc, y, `Queda pendiente: ${faltan} unidad(es). La tienda gestiona la garantía con el proveedor y le avisará cuando tenga la respuesta.`, 'naranja');
    }
  }
  if (r.anulado) y = _nota(doc, y, `Garantía anulada: ${r.anulado_motivo || ''}`, 'gris');
  if (r.notas) y = _nota(doc, y, `Notas: ${r.notas}`, 'gris');

  _firmas(doc, y,
    { titulo: 'Cliente', detalle: r.cliente_nombre || '' },
    { titulo: 'Recibió', detalle: r.sucursal_nombre });

  pieDocumento(doc, {
    texto: `${config?.nombre_negocio || 'El negocio'} · garantía ${numero} · generado ${formatFechaHora(new Date())}`,
    soloSiVarias: true,
  });
  doc.end();
  return doc;
};

const generarPdfReclamo = async (user, id) => {
  const service = require('./reclamosGarantia.service');
  const r = await service.detalle(user, id);
  const config = await _config(user.negocio_id, r.sucursal_id);
  return construirPdfReclamo(r, config);
};

// ═════════════════════════════════════════════════════════════════════════════
// 2. EL ENVÍO — guía para el proveedor
// ═════════════════════════════════════════════════════════════════════════════

const construirPdfEnvio = (e, config) => {
  const numero = `#${e.numero ?? e.id}`;
  const verValores = !e.costos_ocultos;
  const lineas = (e.lineas || []).filter((l) => !l.anulado);
  const doc = _nuevoDoc(`Envío de garantía ${numero}`, config);
  encabezadoContinuo(doc, _continuacion(`Envío de garantía ${numero} · ${e.proveedor_nombre || ''}`));

  let y = encabezado(doc, {
    config, titulo: 'Envío de garantía', numero,
    subtitulo: `Enviado ${formatFecha(e.fecha)}`, franja: e.anulado ? C.gris : C.azul,
  });
  y += 16;
  badgeEstado(doc, e.anulado ? 'Anulado' : 'En garantía', e.anulado ? 'gris' : 'azul', PAGE_W - MARGIN - 110, y, { w: 110 });
  y += 30;

  y = _bloquePartes(doc, y,
    { titulo: 'Envía', nombre: config?.nombre_negocio || e.sucursal_nombre,
      lineas: [e.sucursal_nombre, `Por: ${e.usuario_nombre || '-'}`] },
    { titulo: 'Proveedor', nombre: e.proveedor_nombre,
      lineas: [e.proveedor_nit ? `NIT: ${e.proveedor_nit}` : null,
        [e.transportadora, e.guia ? `guía ${e.guia}` : null].filter(Boolean).join(' · ') || null] });

  const cols = verValores
    ? [['#', 22], ['Producto', null], ['Cant.', 40, 'center'], ['Compra', 78], ['Garantía', 66], ['Valor', 72, 'right']]
    : [['#', 22], ['Producto', null], ['Cant.', 40, 'center'], ['Compra', 90], ['Garantía', 76]];
  y = labelSeccion(doc, y, `Unidades (${lineas.length})`, { reservar: 44 });
  y = _tabla(doc, y, cols, lineas.map((l, i) => {
    const celdas = [i + 1, l.nombre_producto, l.cantidad,
      l.compra_numero ? `#${l.compra_numero} ${formatFecha(l.compra_fecha)}` : '-',
      l.garantia_proveedor_hasta ? _fechaDia(l.garantia_proveedor_hasta) : '-'];
    if (verValores) celdas.push(l.costo_unitario == null ? '-' : formatCOP(_num(l.costo_unitario) * _num(l.cantidad)));
    return {
      celdas,
      sub: [l.variante_texto, l.imei ? `IMEI ${l.imei}` : null, `Garantía #${l.reclamo_numero}: ${l.falla}`]
        .filter(Boolean).join(' · '),
    };
  }));

  if (verValores) {
    const total = lineas.reduce((s, l) => s + _num(l.costo_unitario) * _num(l.cantidad), 0);
    y = asegurarEspacio(doc, y, 40);
    rectFillStroke(doc, PAGE_W - MARGIN - 250, y, 250, 30, C.grisFondo, C.grisBorde, 8);
    doc.font(FONT.bold).fontSize(10).fillColor(C.negro)
      .text('Valor de lo enviado', PAGE_W - MARGIN - 238, y + 10, { width: 130, height: 12, lineBreak: false });
    doc.font(FONT.bold).fontSize(11).fillColor(C.negro)
      .text(formatCOP(total), PAGE_W - MARGIN - 120, y + 9, { width: 108, align: 'right', height: 13, lineBreak: false });
    y += 44;
  }
  if (e.anulado) y = _nota(doc, y, `Envío anulado: ${e.anulado_motivo || ''}`, 'gris');
  if (e.notas) y = _nota(doc, y, `Notas: ${e.notas}`, 'gris');

  _firmas(doc, y,
    { titulo: 'Entregó', detalle: e.sucursal_nombre },
    { titulo: 'Recibió (proveedor)', detalle: e.proveedor_nombre });

  pieDocumento(doc, {
    texto: `${config?.nombre_negocio || 'El negocio'} · envío de garantía ${numero} · generado ${formatFechaHora(new Date())}`,
  });
  doc.end();
  return doc;
};

const generarPdfEnvio = async (user, id) => {
  const service = require('./reclamosGarantia.service');
  const e = await service.getEnvio(user, id);
  const config = await _config(user.negocio_id, e.sucursal_id);
  return construirPdfEnvio(e, config);
};

// ═════════════════════════════════════════════════════════════════════════════
// 3. ESTADO DE CUENTA de las garantías con un proveedor
// ═════════════════════════════════════════════════════════════════════════════

const ESTADO_LINEA = {
  por_enviar: 'Por enviar', afuera: 'Con el proveedor', parcial: 'Parcial', resuelto: 'Resuelto', anulado: 'Anulado',
};

// Lo que respondió el proveedor por la línea, en palabras.
const _respuesta = (l) => [
  _num(l.uds_repuestas) ? `repuso ${l.uds_repuestas}` : null,
  _num(l.uds_reparadas) ? `reparó ${l.uds_reparadas}` : null,
  _num(l.valor_nota_credito) ? `nota crédito ${formatCOP(l.valor_nota_credito)}` : null,
  _num(l.valor_dinero) ? `devolvió ${formatCOP(l.valor_dinero)}` : null,
  _num(l.uds_no_cubiertas) ? `no cubrió ${l.uds_no_cubiertas}` : null,
].filter(Boolean).join(' · ') || '-';

const construirPdfEstadoCuenta = (d, config) => {
  const p = d.proveedor;
  const r = d.resumen;
  const verValores = !d.costos_ocultos;
  const periodo = d.desde || d.hasta
    ? `${d.desde ? _fechaDia(d.desde) : 'el inicio'} a ${d.hasta ? _fechaDia(d.hasta) : 'hoy'}`
    : 'todo el historial';
  const doc = _nuevoDoc(`Garantías con ${p.nombre}`, config);
  encabezadoContinuo(doc, _continuacion(`Garantías con ${p.nombre} · ${periodo}`));

  let y = encabezado(doc, {
    config, titulo: 'Estado de garantías', numero: null,
    subtitulo: `${p.nombre} · ${periodo}`, franja: C.azul,
  });
  y += 18;

  y = _bloquePartes(doc, y,
    { titulo: 'Proveedor', nombre: p.nombre, lineas: [p.nit ? `NIT: ${p.nit}` : null, p.telefono ? `Tel: ${p.telefono}` : null] },
    { titulo: 'Resumen', nombre: `${r.unidades} unidad(es) en ${r.casos} caso(s)`,
      lineas: [`Por enviar ${r.por_enviar} · con el proveedor ${r.afuera}`,
        r.dias_respuesta != null ? `Responde en ${r.dias_respuesta} día(s) en promedio` : 'Sin respuestas todavía'] });

  const filasTot = [
    ['Unidades repuestas', String(r.repuestas)],
    ['Unidades reparadas', String(r.reparadas)],
    ['Unidades que no cubrió', String(r.no_cubiertas), r.no_cubiertas ? C.rojo : C.negro],
    ['Notas crédito', formatCOP(r.nota_credito)],
    ['Dinero devuelto', formatCOP(r.dinero)],
  ];
  if (verValores) filasTot.push(['Lo que tiene nuestro hoy (costo)', formatCOP(r.valor_afuera), r.valor_afuera ? C.naranja : C.negro]);
  if (verValores && r.valor_no_cubierto) filasTot.push(['Perdido (dado de baja)', formatCOP(r.valor_no_cubierto), C.rojo]);
  y = asegurarEspacio(doc, y, filasTot.length * 16 + 50);
  const w = 280;
  const x = PAGE_W - MARGIN - w;
  const alto = filasTot.length * 16 + 44;
  rectFillStroke(doc, x, y, w, alto, C.grisFondo, C.grisBorde, 8);
  let yy = y + 8;
  for (const [label, valor, color] of filasTot) {
    yy = fila(doc, yy, label, valor, { x: x + 12, w: w - 24, valorColor: color || C.negro });
  }
  fila(doc, yy + 8, 'Recuperado', formatCOP(r.recuperado), {
    x: x + 12, w: w - 24, labelFont: FONT.bold, valorFont: FONT.bold, labelSize: 10, valorSize: 12, valorColor: C.verde, alto: 18,
  });
  y += alto + 16;

  y = labelSeccion(doc, y, `Unidades (${(d.lineas || []).length})`, { reservar: 44 });
  y = _tabla(doc, y, [['Fecha', 58], ['Producto', null], ['Cant.', 34, 'center'], ['Estado', 76], ['Respuesta', 130]],
    (d.lineas || []).map((l) => ({
      celdas: [formatFecha(l.reclamo_fecha), l.nombre_producto, l.cantidad,
        ESTADO_LINEA[l.estado_proveedor] || l.estado_proveedor, _respuesta(l)],
      sub: [`Garantía #${l.reclamo_numero}`, l.imei ? `IMEI ${l.imei}` : null, l.falla,
        l.envio_numero ? `envío #${l.envio_numero} (${formatFecha(l.envio_fecha)})` : 'sin enviar',
        l.dias_afuera != null ? `${l.dias_afuera} día(s) afuera` : null]
        .filter(Boolean).join(' · '),
    })));

  pieDocumento(doc, {
    texto: `${config?.nombre_negocio || 'El negocio'} · garantías con ${p.nombre} · generado ${formatFechaHora(new Date())}`,
  });
  doc.end();
  return doc;
};

const generarPdfEstadoCuenta = async (user, sucursalId, proveedorId, query) => {
  const service = require('./reclamosGarantia.service');
  const d = await service.estadoCuentaProveedor(user, sucursalId, proveedorId, query);
  const config = await _config(user.negocio_id, user.rol === 'admin_negocio' ? sucursalId : user.sucursal_id);
  return construirPdfEstadoCuenta(d, config);
};

module.exports = {
  construirPdfReclamo, construirPdfEnvio, construirPdfEstadoCuenta,
  generarPdfReclamo, generarPdfEnvio, generarPdfEstadoCuenta,
};
