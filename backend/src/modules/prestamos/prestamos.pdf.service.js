'use strict';

/**
 * PDF DE PRÉSTAMOS — préstamos activos de una persona, comprobante de un
 * préstamo, estado de cuenta, aviso de mora y paz y salvo.
 *
 * Reglas que mandan en los cinco (oct-2026, pedido del negocio):
 *   1. TODA fecha va con su HORA: dos préstamos del mismo día a la misma persona
 *      solo se distinguen por ella.
 *   2. El producto va con su VARIANTE (talla, color…) cuando la tiene, y el
 *      equipo con su IMEI y su color. Sin variante sale lo de siempre.
 *   3. El detalle completo: número del préstamo, quién lo registró, empleado,
 *      plazo, cargos, y de cada abono el método, quién lo registró y si salió
 *      de un pago total.
 *   4. NINGÚN salto de página lo decide PDFKit. El PDF de préstamos activos
 *      escribía el pie («Página 1 de 1») en y = 825 con un margen inferior de
 *      52: el texto caía bajo el borde útil y PDFKit abría una hoja nueva POR
 *      CADA PIE. De ahí salían las páginas en blanco (2 préstamos → 3 hojas).
 *      Ahora todo va por `pdf.base` (márgenes de contrato, tablas paginadas,
 *      texto con alto fijo), igual que la factura.
 */

const PDFDocument = require('pdfkit');
const { configDocumento, encabezadoPara, aplicarDatosSucursal } = require('../../utils/emisor.util');
const { pool }    = require('../../config/db');
const repo        = require('./prestamos.repository');
const { sqlVarianteTexto, nombreConVariante } = require('../../utils/varianteTexto.util');

// Núcleo compartido con los créditos: mismo cálculo del estado de la deuda y
// mismos bloques de dibujo, para que préstamo y crédito produzcan documentos
// idénticos en estructura y en cifras.
const { resumirObligacion, describirCondicion } = require('../../utils/obligacion');
const { describirPlanInteres } = require('../../utils/interes.util');
const {
  bloqueEstadoObligacion, bloqueFechas, tablaAbonos, tablaMovimientosMora, bloqueCondiciones,
  bloquePersona, generarAvisoMora, generarPazYSalvo,
} = require('../../utils/obligacion.pdf');
const {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W, BODY_BOTTOM, FONT, C,
  formatCOP, formatFechaHora,
  rectFill, rectFillStroke,
  labelSeccion, encabezado, pieDocumento, asegurarEspacio, encabezadoContinuo,
  medirTexto, textoAcotado, badgeEstado,
} = require('../../utils/pdf.base');

const HEADER_CONT_H = 40;
const CUERPO_TOP    = HEADER_CONT_H + 22;

/** Documento A4 con los márgenes del contrato de pdf.base. */
const _nuevoDocumento = (info) => new PDFDocument({
  size: 'A4', bufferPages: true,
  margins: { top: CUERPO_TOP, bottom: PAGE_H - BODY_BOTTOM, left: MARGIN, right: MARGIN },
  info,
});

const _encabezadoContinuacion = (doc, titulo) => {
  rectFill(doc, 0, 0, PAGE_W, HEADER_CONT_H, C.headerBg, 0);
  textoAcotado(doc, titulo, MARGIN, 15, CONTENT_W, { font: FONT.bold, size: 9, color: C.headerText });
};

const _numero = (p) => `#${String(p.numero ?? p.id).padStart(6, '0')}`;

/** Producto con variante, o el nombre a secas si no tiene. */
const _producto = (p) => nombreConVariante(p.nombre_producto || '—', p.variante_texto);

/**
 * Configuración del encabezado: NIT/dirección/teléfono de la sede (o del
 * negocio) y el nombre de siempre. Préstamos usaba el nombre del REGISTRO del
 * negocio (`req.user.negocio_nombre`) y así sigue cuando la sede no tiene uno
 * propio.
 */
const _configEncabezado = async (negocioId, sucursalId, { nombre, logo }) => {
  const enc = await encabezadoPara(negocioId, sucursalId, { nombre, logo });
  let config = {};
  try { config = await configDocumento(negocioId, sucursalId); } catch { config = {}; }
  return {
    ...config,
    nombre_negocio: enc.nombre || config.nombre_negocio || 'Mi Negocio',
    logo_negocio:   enc.logo || config.logo_negocio || null,
  };
};

/** Cargos (mora e interés) de una lista; sin la migración, el PDF sale igual. */
const _anotarCargos = async (prestamos) => {
  try {
    const moraService = require('../mora/mora.service');
    return await moraService.anotarLista(prestamos, 'prestamo');
  } catch (err) {
    console.warn('[pdf-prestamo] Cargos no incluidos:', err.message);
    return prestamos;
  }
};

/**
 * Grilla de datos etiqueta → valor en dos columnas. Se mide entera antes de
 * dibujar: es un bloque indivisible.
 */
const _grillaDatos = (doc, y, pares, { fondo = C.blanco, soloMedir = false } = {}) => {
  const visibles = pares.filter(([, v]) => v != null && v !== '' && v !== '—');
  if (!visibles.length) return soloMedir ? 0 : y;
  const colW = (CONTENT_W - 28) / 2;
  const OPT_V = { font: FONT.bold, size: 8, lineas: 3, color: C.negro };
  const filasGrilla = [];
  for (let i = 0; i < visibles.length; i += 2) {
    const par = visibles.slice(i, i + 2);
    const alto = Math.max(...par.map(([, v]) => medirTexto(doc, String(v), colW - 8, OPT_V).alto)) + 14;
    filasGrilla.push({ par, alto });
  }
  const H = filasGrilla.reduce((s, f) => s + f.alto, 0) + 12;
  if (soloMedir) return H + 8;
  y = asegurarEspacio(doc, y, H);
  rectFillStroke(doc, MARGIN, y, CONTENT_W, H, fondo, C.grisBorde, 6);
  let yf = y + 6;
  for (const f of filasGrilla) {
    f.par.forEach(([label, valor], k) => {
      const x = MARGIN + 14 + k * colW;
      textoAcotado(doc, String(label).toUpperCase(), x, yf + 2, colW - 8,
        { font: FONT.bold, size: 6.5, color: C.grisClaro, characterSpacing: 0.6 });
      textoAcotado(doc, String(valor), x, yf + 11, colW - 8, OPT_V);
    });
    yf += f.alto;
  }
  return y + H + 8;
};

/** Datos de un préstamo para la grilla (comprobante y préstamos activos). */
const _paresPrestamo = (p, { conProducto = false } = {}) => {
  const cant = Number(p.cantidad_prestada) || 1;
  const esSerial = !!p.imei;
  const plan = describirPlanInteres(p.interes_condicion);
  return [
    conProducto ? ['Producto', _producto(p)] : null,
    p.variante_texto && !conProducto ? ['Variante', p.variante_texto] : null,
    ['Fecha y hora', formatFechaHora(p.fecha)],
    ['Sucursal', p.sucursal_nombre || '—'],
    ['Línea', p.linea_nombre || null],
    ['IMEI', p.imei || null],
    ['Color del equipo', p.serial_color || null],
    ['Cantidad', esSerial ? '1' : String(cant)],
    !esSerial && cant > 1 ? ['Valor unitario', formatCOP(Number(p.valor_prestamo) / cant)] : null,
    ['Empleado', p.empleado_nombre || null],
    ['Registró', p.usuario_nombre || null],
    p.fecha_limite ? ['Fecha límite de pago', String(p.fecha_limite).slice(0, 10).split('-').reverse().join('/')] : null,
    p.fecha_limite && p.mora_condicion ? ['Mora pactada', describirCondicion(p.mora_condicion)] : null,
    plan ? ['Interés pactado', plan] : null,
  ].filter(Boolean);
};

// ─────────────────────────────────────────────────────────────────────────────
// SECCIÓN 1: Préstamos activos de una persona
// ─────────────────────────────────────────────────────────────────────────────

/** Cifras de cierre de un préstamo: capital, cargos y total a pagar. */
const _totalesPrestamo = (doc, resumen, y) => {
  const stats = [
    ['Valor préstamo', formatCOP(resumen.valor_actual), C.negro],
    ['Total abonado', formatCOP(resumen.total_abonado), C.verde],
    ['Saldo capital', formatCOP(resumen.saldo), resumen.saldo > 0 ? C.rojo : C.verde],
  ];
  if (resumen.interes_pendiente > 0) stats.push(['Interés pendiente', formatCOP(resumen.interes_pendiente), C.rojo]);
  if (resumen.mora_pendiente > 0)    stats.push(['Mora pendiente', formatCOP(resumen.mora_pendiente), C.rojo]);
  if (resumen.cargos_pendientes > 0) stats.push(['Total a pagar', formatCOP(resumen.total_a_pagar), C.rojo]);

  const H = 36;
  y = asegurarEspacio(doc, y, H);
  rectFillStroke(doc, MARGIN, y, CONTENT_W, H, C.azulFondo, C.azulBorde, 6);
  const w = (CONTENT_W - 16) / stats.length;
  stats.forEach(([label, valor, color], i) => {
    const x = MARGIN + 8 + i * w;
    textoAcotado(doc, label.toUpperCase(), x, y + 7, w - 6, { size: 6.5, color: C.gris, characterSpacing: 0.4 });
    textoAcotado(doc, valor, x, y + 18, w - 6, { font: FONT.bold, size: 9, color });
  });
  return y + H;
};

const _tarjetaPrestamo = (doc, p, abonos, y) => {
  const resumen = resumirObligacion({
    tipo: 'prestamo', documento: p, abonos, mora: p.mora || null, interes: p.interes || null,
  });

  // Barra del título: número + producto con variante a la izquierda, fecha y
  // hora y estado a la derecha. Reserva la grilla para no quedar huérfana.
  const titulo = `Préstamo ${_numero(p)} · ${_producto(p)}`;
  const OPT_T = { font: FONT.bold, size: 10, lineas: 3, color: C.blanco };
  const anchoTitulo = CONTENT_W - 150;
  const altoTitulo = medirTexto(doc, titulo, anchoTitulo, OPT_T).alto + 16;
  const pares = _paresPrestamo(p);
  // Título y datos son un bloque: un título solo al pie de la hoja, con sus
  // datos en la siguiente, no se entiende.
  y = asegurarEspacio(doc, y, altoTitulo + 6 + _grillaDatos(doc, y, pares, { soloMedir: true }));

  rectFill(doc, MARGIN, y, CONTENT_W, altoTitulo, C.negro, 6);
  textoAcotado(doc, titulo, MARGIN + 12, y + 8, anchoTitulo, OPT_T);
  textoAcotado(doc, formatFechaHora(p.fecha), MARGIN, y + 8, CONTENT_W - 12,
    { size: 8, color: C.headerSub, align: 'right' });
  if (resumen.vencido) {
    textoAcotado(doc, `VENCIDO · ${resumen.dias_atraso} día(s)`, MARGIN, y + 20, CONTENT_W - 12,
      { font: FONT.bold, size: 7.5, color: '#FCA5A5', align: 'right' });
  }
  y += altoTitulo + 6;

  y = _grillaDatos(doc, y, pares);
  y = tablaAbonos(doc, resumen, y, { titulo: `Abonos del préstamo ${_numero(p)}` });
  // tablaAbonos deja 20 de aire; los totales van pegados a la tabla.
  y = _totalesPrestamo(doc, resumen, y - 12);
  return { y: y + 22, resumen };
};

const _resumenGeneral = (doc, resumenes, y) => {
  const suma = (k) => resumenes.reduce((s, r) => s + Number(r[k] || 0), 0);
  const stats = [
    ['Préstamos', String(resumenes.length), C.blanco],
    ['Total prestado', formatCOP(suma('valor_actual')), C.blanco],
    ['Total abonado', formatCOP(suma('total_abonado')), '#6EE7B7'],
    ['Saldo capital', formatCOP(suma('saldo')), '#FCA5A5'],
  ];
  const cargos = suma('cargos_pendientes');
  if (cargos > 0) {
    stats.push(['Interés + mora', formatCOP(cargos), '#FCA5A5']);
    stats.push(['Total a pagar', formatCOP(suma('total_a_pagar')), '#FCA5A5']);
  }

  const H = 56;
  y = asegurarEspacio(doc, y, H);
  rectFill(doc, MARGIN, y, CONTENT_W, H, C.negro, 8);
  textoAcotado(doc, 'RESUMEN GENERAL', MARGIN + 12, y + 8, CONTENT_W - 24,
    { font: FONT.bold, size: 8.5, color: C.blanco, characterSpacing: 0.8 });
  const w = (CONTENT_W - 24) / stats.length;
  stats.forEach(([label, valor, color], i) => {
    const x = MARGIN + 12 + i * w;
    textoAcotado(doc, label.toUpperCase(), x, y + 24, w - 6, { size: 6.5, color: C.headerSub });
    textoAcotado(doc, valor, x, y + 35, w - 6, { font: FONT.bold, size: 9.5, color });
  });
  return y + H;
};

const generarPdfPrestamosActivos = async ({ tipo, personaId, negocioId, negocioNombre, logoNegocio, sucursalId = null }) => {
  let prestamos = tipo === 'prestatario'
    ? await repo.findActivosPorPrestatario(personaId, negocioId)
    : await repo.findActivosPorCliente(personaId, negocioId);
  if (!prestamos.length) {
    const err = new Error('Esta persona no tiene préstamos activos');
    err.status = 404;
    throw err;
  }
  // Del más viejo al más nuevo: es el orden en que se fue armando la deuda.
  prestamos = await _anotarCargos([...prestamos].reverse());

  // Reúne préstamos de varias sedes: el encabezado es el de la sede de quien
  // lo imprime (sin sede elegida, el del negocio).
  const config = await _configEncabezado(negocioId, sucursalId, { nombre: negocioNombre, logo: logoNegocio });

  const todosAbonos = await repo.findAbonosPorPrestamos(prestamos.map((p) => p.id));
  const abonosPorPrestamo = {};
  for (const a of todosAbonos) (abonosPorPrestamo[a.prestamo_id] ||= []).push(a);

  const primero = prestamos[0];
  const persona = tipo === 'prestatario'
    ? { nombre: primero.prestatario_nombre }
    : { nombre: primero.cliente_nombre, cedula: primero.cliente_cedula, celular: primero.cliente_celular };

  const generado = formatFechaHora(new Date());
  const doc = _nuevoDocumento({
    Title:   `Préstamos activos — ${persona.nombre}`,
    Author:  config.nombre_negocio,
    Subject: 'Préstamos activos',
  });

  let y = encabezado(doc, {
    config, logo: config.logo_negocio,
    titulo: 'Préstamos activos', subtitulo: `Generado: ${generado}`, franja: C.azul,
  });
  encabezadoContinuo(doc, (d) => _encabezadoContinuacion(d, `Préstamos activos · ${persona.nombre || ''}`));
  y += 20;
  y = bloquePersona(doc, persona, y, { titulo: tipo === 'prestatario' ? 'Prestatario' : 'Cliente' });

  textoAcotado(doc,
    `${prestamos.length} préstamo${prestamos.length !== 1 ? 's' : ''} activo${prestamos.length !== 1 ? 's' : ''}`
      + ' · del más antiguo al más reciente',
    MARGIN, y - 8, CONTENT_W, { size: 8, color: C.gris });
  y += 8;

  const resumenes = [];
  for (const p of prestamos) {
    const r = _tarjetaPrestamo(doc, p, abonosPorPrestamo[p.id] || [], y);
    y = r.y;
    resumenes.push(r.resumen);
  }
  _resumenGeneral(doc, resumenes, y);

  pieDocumento(doc, { texto: `${config.nombre_negocio} · Préstamos activos de ${persona.nombre || ''} · Generado el ${generado}` });
  doc.end();
  return doc;
};

// ─────────────────────────────────────────────────────────────────────────────
// SECCIÓN 2: Comprobante de un préstamo
// ─────────────────────────────────────────────────────────────────────────────

/** El préstamo con todo lo que el comprobante imprime, en UNA consulta. */
const _cargarPrestamo = async (prestamoId) => {
  const { rows } = await pool.query(`
    SELECT
      p.*,
      su.nombre  AS sucursal_nombre,
      e.nombre   AS empleado_nombre,
      u.nombre   AS usuario_nombre,
      pr.nombre  AS prestatario_nombre,
      c.nombre   AS cliente_nombre,
      c.cedula   AS cliente_cedula,
      c.celular  AS cliente_celular,
      s.color    AS serial_color,
      COALESCE(lps.nombre, lpc.nombre) AS linea_nombre,
      ${sqlVarianteTexto('p', { conEtiquetas: true })} AS variante_texto
    FROM prestamos p
    JOIN  sucursales               su  ON su.id  = p.sucursal_id
    LEFT JOIN empleados_prestatario e   ON e.id   = p.empleado_id
    LEFT JOIN usuarios              u   ON u.id   = p.usuario_id
    LEFT JOIN prestatarios          pr  ON pr.id  = p.prestatario_id
    LEFT JOIN clientes              c   ON c.id   = p.cliente_id
    -- UNA fila de serial (el IMEI vive en varias filas): un JOIN plano
    -- multiplicaba el préstamo y la línea salía de una fila al azar.
    LEFT JOIN LATERAL (
      SELECT s2.color, ps2.linea_id
        FROM seriales s2
        LEFT JOIN productos_serial ps2 ON ps2.id = s2.producto_id
       WHERE s2.imei = p.imei
       ORDER BY (ps2.sucursal_id = p.sucursal_id) DESC NULLS LAST, s2.id
       LIMIT 1
    ) s ON p.imei IS NOT NULL
    LEFT JOIN lineas_producto       lps ON lps.id = s.linea_id
    LEFT JOIN productos_cantidad    pc  ON pc.id  = p.producto_id AND p.imei IS NULL
    LEFT JOIN lineas_producto       lpc ON lpc.id = pc.linea_id
    WHERE p.id = $1
  `, [prestamoId]);
  return rows[0] || null;
};

/** Mora e interés de un préstamo, con sus cobros y condonaciones. */
const _cargosDe = async (datos, prestamoId, negocioId) => {
  // Basta con que exista CUALQUIERA de los dos pactos: un préstamo puede causar
  // interés sin tener fecha límite. En try/catch porque la migración de mora
  // puede no estar aplicada: el documento sale igual, sin ese bloque.
  if (!datos.fecha_limite && !datos.interes_condicion) return { mora: null, interes: null, movimientos: [] };
  try {
    const moraService = require('../mora/mora.service');
    const estado = await moraService.estadoDe('prestamo', prestamoId, negocioId);
    return { mora: estado.mora, interes: estado.interes, movimientos: estado.movimientos || [] };
  } catch (err) {
    console.warn('[pdf-prestamo] Cargos no incluidos:', err.message);
    return { mora: null, interes: null, movimientos: [] };
  }
};

const _encabezadoIndividual = (doc, { config, prestamo, resumen }) => {
  const y = encabezado(doc, {
    config, logo: config.logo_negocio,
    titulo:    'Comprobante de préstamo',
    numero:    _numero(prestamo),
    subtitulo: formatFechaHora(prestamo.fecha),
    franja:    C.verde,
  });
  badgeEstado(doc, resumen.estado_label, resumen.estado_tono, PAGE_W - MARGIN - 92, 82);
  return y;
};

const _bloquePrestatario = (doc, prestamo, y) => {
  const persona = {
    nombre:  prestamo.prestatario_nombre || prestamo.cliente_nombre || prestamo.prestatario,
    cedula:  prestamo.cliente_cedula || prestamo.cedula,
    celular: prestamo.cliente_celular || prestamo.telefono,
  };
  return bloquePersona(doc, persona, y, { titulo: 'Prestatario' });
};

const _bloqueGarantias = (doc, garantias, y) => {
  if (!garantias || garantias.length === 0) return y;
  const OPT = { size: 8, lineas: 60, lineGap: 1, color: C.grisOscuro };

  const medidas = garantias.map((g) => ({
    g, altoTexto: medirTexto(doc, g.texto || '', CONTENT_W - 28, OPT).alto,
  }));
  y = labelSeccion(doc, y, 'Garantías del producto', { reservar: 26 + (medidas[0]?.altoTexto || 0) });

  medidas.forEach(({ g, altoTexto }, i) => {
    const H = 26 + altoTexto;
    y = asegurarEspacio(doc, y, H);
    rectFillStroke(doc, MARGIN, y, CONTENT_W, H, i % 2 === 0 ? C.grisFondo : C.blanco, C.grisBorde, 6);
    textoAcotado(doc, g.titulo || '', MARGIN + 14, y + 7, CONTENT_W - 28,
      { font: FONT.bold, size: 8.5, color: C.negro });
    textoAcotado(doc, g.texto || '', MARGIN + 14, y + 20, CONTENT_W - 28, OPT);
    y += H + 4;
  });
  return y + 6;
};

const generarPdfPrestamoIndividual = async ({ prestamoId, negocioId, negocioNombre, logoNegocio }) => {
  const prestamo = await repo.findByIdYNegocio(prestamoId, negocioId);
  if (!prestamo) {
    const err = new Error('Préstamo no encontrado');
    err.status = 404;
    throw err;
  }
  if (prestamo.estado === 'Devuelto') {
    const err = new Error('Los préstamos devueltos no generan comprobante');
    err.status = 400;
    throw err;
  }

  const datos = await _cargarPrestamo(prestamoId);
  // El encabezado es el de la sede que prestó, si tiene datos propios.
  const config = await _configEncabezado(negocioId, datos.sucursal_id, { nombre: negocioNombre, logo: logoNegocio });
  const abonos    = await repo.getAbonos(prestamoId);
  const garantias = await repo.getGarantiasPorPrestamo(datos.imei, datos.producto_id, negocioId);
  const cargos    = await _cargosDe(datos, prestamoId, negocioId);

  // Mismos bloques que la factura a crédito, alimentados por el mismo resumen.
  const resumen = resumirObligacion({
    tipo: 'prestamo', documento: datos, abonos,
    mora: cargos.mora, interes: cargos.interes, mora_movimientos: cargos.movimientos,
  });

  const generado = formatFechaHora(new Date());
  const doc = _nuevoDocumento({
    Title:  `Comprobante Préstamo ${_numero(datos)}`,
    Author: config.nombre_negocio,
  });

  let y = _encabezadoIndividual(doc, { config, prestamo: datos, resumen });
  encabezadoContinuo(doc, (d) => _encabezadoContinuacion(d, `Comprobante de préstamo ${_numero(datos)}`));
  y += 20;
  y = _bloquePrestatario(doc, datos, y);
  y = labelSeccion(doc, y, 'Datos del préstamo', { reservar: 60 });
  y = _grillaDatos(doc, y, _paresPrestamo(datos, { conProducto: true }));
  y += 10;
  y = bloqueEstadoObligacion(doc, resumen, y, { titulo: 'Estado del préstamo' });
  y = bloqueFechas(doc, resumen, y);
  y = tablaAbonos(doc, resumen, y);
  y = tablaMovimientosMora(doc, resumen, y);
  y = bloqueCondiciones(doc, resumen, y);
  _bloqueGarantias(doc, garantias, y);

  pieDocumento(doc, { texto: `${config.nombre_negocio} · Préstamo ${_numero(datos)} · Generado el ${generado}` });
  doc.end();
  return doc;
};

// ─────────────────────────────────────────────────────────────────────────────
// SECCIÓN 3: PDF estado de cuenta — 5 columnas igual que la cuadrícula web
// ─────────────────────────────────────────────────────────────────────────────
//
// El dibujo vive en utils/estadoCuenta.pdf.js (compartido con créditos) y los
// movimientos los calcula prestamos.service: aquí no se vuelve a acumular el
// saldo, para que el PDF no pueda diferir de lo que muestra la pantalla. Lo
// único que se agrega son los renglones de DETALLE de cada movimiento.

const { construirPdfEstadoCuenta } = require('../../utils/estadoCuenta.pdf');

const TIPO_LABEL = {
  prestamo:       { label: 'Préstamo',        bg: '#FFFBEB', text: '#D97706' },
  abono:          { label: 'Abono',           bg: '#ECFDF5', text: '#059669' },
  abono_total:    { label: 'Pago total',      bg: '#EEF2FF', text: '#4338CA' },
  pago_producto:  { label: 'Pago producto',   bg: '#EFF6FF', text: '#2563EB' },
  saldo_aplicado: { label: 'Saldo aplicado',  bg: '#F0FDFA', text: '#0D9488' },
  compra_directa: { label: 'Compra artículo', bg: '#F5F3FF', text: '#7C3AED' },
  // Mismos colores que en el estado de cuenta de créditos.
  mora_cobro:       { label: 'Mora',       bg: '#FEF2F2', text: '#DC2626' },
  mora_condonacion: { label: 'Mora cond.', bg: '#F3F4F6', text: '#6B7280' },
  interes_cobro:       { label: 'Interés',       bg: '#ECFDF5', text: '#0F766E' },
  interes_condonacion: { label: 'Interés cond.', bg: '#F3F4F6', text: '#6B7280' },
};

/**
 * Lo que la cuadrícula de la pantalla no muestra y el PDF sí: de cada préstamo
 * su número, variante, IMEI, color y quién lo hizo; de cada abono quién lo
 * registró. Una consulta por tabla, por ids: los movimientos ya vienen
 * acotados a la persona y a la sede por el service.
 */
const _detallesEstadoCuenta = async (movimientos) => {
  const idsPrestamo = new Set();
  const idsAbono    = new Set();
  const idsTotal    = new Set();
  const idsMora     = new Set();
  const idsRetoma   = new Set();
  for (const m of movimientos) {
    if (m.tipo === 'prestamo') idsPrestamo.add(Number(m.referencia_id));
    if (m.prestamo_id) idsPrestamo.add(Number(m.prestamo_id));
    if (['abono', 'pago_producto', 'saldo_aplicado'].includes(m.tipo)) idsAbono.add(Number(m.referencia_id));
    if (m.tipo === 'abono_total') {
      idsTotal.add(Number(m.referencia_id));
      for (const d of (Array.isArray(m.detalle) ? m.detalle : [])) idsPrestamo.add(Number(d.prestamo_id));
    }
    if (/^(mora|interes)_/.test(m.tipo)) idsMora.add(Number(m.referencia_id));
    if (m.tipo === 'compra_directa') idsRetoma.add(Number(m.referencia_id));
  }
  const arr = (s) => [...s].filter((n) => Number.isInteger(n) && n > 0);
  const mapa = async (ids, sql) => {
    if (!ids.length) return new Map();
    try {
      const { rows } = await pool.query(sql, [ids]);
      return new Map(rows.map((r) => [Number(r.id), r]));
    } catch (err) {
      // El detalle es un extra: si una columna falta en una base vieja, el
      // estado de cuenta sale con lo de siempre en vez de no salir.
      console.warn('[pdf-estado-cuenta] Detalle no incluido:', err.message);
      return new Map();
    }
  };

  const [prestamos, abonos, totales, moras, retomas] = await Promise.all([
    mapa(arr(idsPrestamo), `
      SELECT p.id, p.numero, p.nombre_producto, p.imei, p.cantidad_prestada, p.valor_prestamo,
             p.fecha_limite, p.estado,
             ${sqlVarianteTexto('p', { conEtiquetas: true })} AS variante_texto,
             su.nombre AS sucursal_nombre, e.nombre AS empleado_nombre, u.nombre AS usuario_nombre,
             (SELECT s2.color FROM seriales s2 WHERE s2.imei = p.imei AND p.imei IS NOT NULL
               ORDER BY s2.id LIMIT 1) AS serial_color
        FROM prestamos p
        JOIN sucursales su ON su.id = p.sucursal_id
        LEFT JOIN empleados_prestatario e ON e.id = p.empleado_id
        LEFT JOIN usuarios u ON u.id = p.usuario_id
       WHERE p.id = ANY($1::int[])`),
    mapa(arr(idsAbono), `
      SELECT ap.id, ap.prestamo_id, u.nombre AS usuario_nombre
        FROM abonos_prestamo ap LEFT JOIN usuarios u ON u.id = ap.usuario_id
       WHERE ap.id = ANY($1::int[])`),
    mapa(arr(idsTotal), `
      SELECT at.id, at.valor_total, u.nombre AS usuario_nombre
        FROM abonos_totales at LEFT JOIN usuarios u ON u.id = at.usuario_id
       WHERE at.id = ANY($1::int[])`),
    mapa(arr(idsMora), `
      SELECT mm.id, u.nombre AS usuario_nombre
        FROM movimientos_mora mm LEFT JOIN usuarios u ON u.id = mm.usuario_id
       WHERE mm.id = ANY($1::bigint[])`),
    mapa(arr(idsRetoma), `
      SELECT r.id, r.imei, r.color, r.descripcion, r.cantidad_retoma, r.tipo_retoma
        FROM retomas r WHERE r.id = ANY($1::int[])`),
  ]);

  const describirPrestamo = (p) => {
    if (!p) return null;
    const cant = Number(p.cantidad_prestada) || 1;
    return [
      `Préstamo ${_numero(p)}`,
      _producto(p),
      p.imei ? `IMEI ${p.imei}` : null,
      p.serial_color ? `Color ${p.serial_color}` : null,
      !p.imei ? `${cant} unidad${cant === 1 ? '' : 'es'}` : null,
    ].filter(Boolean).join(' · ');
  };

  return movimientos.map((m) => {
    const detalles = [];
    if (m.tipo === 'prestamo') {
      const p = prestamos.get(Number(m.referencia_id));
      if (p) {
        const cant = Number(p.cantidad_prestada) || 1;
        detalles.push([
          `Préstamo ${_numero(p)}`,
          p.imei ? `IMEI ${p.imei}` : null,
          p.serial_color ? `Color ${p.serial_color}` : null,
          p.imei ? null : `${cant} unidad${cant === 1 ? '' : 'es'}`
            + (cant > 1 ? ` × ${formatCOP(Number(p.valor_prestamo) / cant)}` : ''),
          p.sucursal_nombre ? `Sede: ${p.sucursal_nombre}` : null,
        ].filter(Boolean).join(' · '));
        const quien = [
          p.empleado_nombre ? `Empleado: ${p.empleado_nombre}` : null,
          p.usuario_nombre ? `Registró: ${p.usuario_nombre}` : null,
          p.fecha_limite ? `Vence: ${String(p.fecha_limite).slice(0, 10).split('-').reverse().join('/')}` : null,
        ].filter(Boolean).join(' · ');
        if (quien) detalles.push(quien);
        // El concepto de la pantalla no trae la variante: el PDF la agrega.
        if (p.variante_texto) m = { ...m, concepto: `Préstamo — ${_producto(p)}` };
      }
    } else if (['abono', 'pago_producto', 'saldo_aplicado'].includes(m.tipo)) {
      const p = prestamos.get(Number(m.prestamo_id));
      const ab = abonos.get(Number(m.referencia_id));
      const linea = [describirPrestamo(p), ab?.usuario_nombre ? `Registró: ${ab.usuario_nombre}` : null]
        .filter(Boolean).join(' · ');
      if (linea) detalles.push(linea);
    } else if (m.tipo === 'abono_total') {
      const t = totales.get(Number(m.referencia_id));
      if (t?.usuario_nombre) detalles.push(`Registró: ${t.usuario_nombre}`);
      for (const d of (Array.isArray(m.detalle) ? m.detalle : [])) {
        const p = prestamos.get(Number(d.prestamo_id));
        detalles.push(`${formatCOP(d.valor)} a ${describirPrestamo(p) || `préstamo #${d.factura}`}`
          + (d.anulado ? ` (anulado${d.motivo_anulacion ? `: ${d.motivo_anulacion}` : ''})` : ''));
      }
    } else if (/^(mora|interes)_/.test(m.tipo)) {
      const mm = moras.get(Number(m.referencia_id));
      const p = prestamos.get(Number(m.prestamo_id));
      const linea = [describirPrestamo(p), mm?.usuario_nombre ? `Registró: ${mm.usuario_nombre}` : null]
        .filter(Boolean).join(' · ');
      if (linea) detalles.push(linea);
    } else if (m.tipo === 'compra_directa') {
      const r = retomas.get(Number(m.referencia_id));
      const linea = r ? [
        r.imei ? `IMEI ${r.imei}` : null,
        r.color ? `Color ${r.color}` : null,
        r.tipo_retoma === 'cantidad' && r.cantidad_retoma ? `${r.cantidad_retoma} unidad(es)` : null,
        r.descripcion || null,
      ].filter(Boolean).join(' · ') : '';
      if (linea) detalles.push(linea);
    }
    return { ...m, detalles };
  });
};

const generarPdfEstadoCuenta = async ({ tipo, personaId, negocioId, negocioNombre, logoNegocio, sucursalId = null }) => {
  // Encabezado de la sede de quien lo imprime (sin sede elegida, el negocio).
  const enc = await encabezadoPara(negocioId, sucursalId, { nombre: negocioNombre, logo: logoNegocio });
  negocioNombre = enc.nombre; logoNegocio = enc.logo;
  // Datos de persona (prestatarios no tiene cedula/celular)
  const personaQuery = tipo === 'prestatario'
    ? `SELECT nombre, NULL AS cedula, NULL AS celular, telefono FROM prestatarios WHERE id = $1`
    : `SELECT nombre, cedula, celular, telefono           FROM clientes       WHERE id = $1`;
  const { rows: personaRows } = await pool.query(personaQuery, [personaId]);
  const persona = personaRows[0];
  if (!persona) {
    const err = new Error('Persona no encontrada');
    err.status = 404;
    throw err;
  }
  if (!persona.celular && persona.telefono) persona.celular = persona.telefono;

  const { rows: configRows } = await pool.query(
    `SELECT clave, valor FROM config_negocio WHERE negocio_id = $1`,
    [negocioId]
  );
  const config = {};
  for (const row of configRows) config[row.clave] = row.valor;

  // Mismos movimientos que consume la pantalla.
  const service     = require('./prestamos.service');
  const base = (await service.getEstadoCuenta(negocioId, tipo, personaId, sucursalId))
    .map((m) => {
      // Igual que en la pantalla: fuera del saldo va el préstamo devuelto, sus
      // abonos, y cualquier abono anulado del todo. Un pago total con solo una
      // PARTE anulada sigue contando por el resto, así que no se atenúa: se le
      // pone la nota diciendo cuánto de él no cuenta.
      const anuladoParcial = Number(m.valor_anulado || 0);
      const devuelto = m.anulado_total === true || m.prestamo_estado === 'Devuelto';
      // `nota` es el sufijo entre paréntesis del concepto. Lo usa el aviso
      // "Devuelto" y, cuando no aplica, la descripción que escribió el usuario
      // (hoy solo la del pago total): los dos casos nunca coinciden en la misma
      // fila, porque uno es de préstamos y el otro de abonos totales.
      return {
        ...m,
        nota:     m.anulado_total  ? (m.motivo_anulacion || 'Anulado')
                : anuladoParcial > 0 ? `${formatCOP(anuladoParcial)} no cuenta — ${m.motivo_anulacion || 'anulado'}`
                : devuelto           ? 'Devuelto'
                : (m.descripcion || null),
        atenuado: devuelto,
      };
    });
  const movimientos = await _detallesEstadoCuenta(base);

  const conSaldo   = movimientos.filter((m) => m.saldo != null);
  const saldoFinal = conSaldo.length ? conSaldo[conSaldo.length - 1].saldo : 0;

  return construirPdfEstadoCuenta({
    persona,
    subtitulo: tipo === 'prestatario' ? 'Prestatario' : 'Cliente',
    movimientos,
    saldoFinal,
    config: { ...aplicarDatosSucursal(config, enc.datos), nombre_negocio: negocioNombre },
    logoNegocio,
    tipoLabels: TIPO_LABEL,
    negocioNombre,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// SECCIÓN 4: Aviso de mora y paz y salvo — idénticos a los de créditos
// ─────────────────────────────────────────────────────────────────────────────

/** Carga el préstamo con su persona, abonos y mora, y arma el resumen. */
const _documentoPrestamo = async (prestamoId, negocioId) => {
  const prestamo = await repo.findByIdYNegocio(prestamoId, negocioId);
  if (!prestamo) {
    const err = new Error('Préstamo no encontrado');
    err.status = 404;
    throw err;
  }

  const { rows } = await pool.query(`
    SELECT p.*,
           COALESCE(pr.nombre, c.nombre, p.prestatario) AS persona_nombre,
           COALESCE(c.cedula,  p.cedula)                AS persona_cedula,
           COALESCE(c.celular, p.telefono)              AS persona_celular,
           ${sqlVarianteTexto('p', { conEtiquetas: true })} AS variante_texto,
           (SELECT s2.color FROM seriales s2 WHERE s2.imei = p.imei AND p.imei IS NOT NULL
             ORDER BY s2.id LIMIT 1) AS serial_color
    FROM prestamos p
    LEFT JOIN prestatarios pr ON pr.id = p.prestatario_id
    LEFT JOIN clientes     c  ON c.id  = p.cliente_id
    WHERE p.id = $1
  `, [prestamoId]);
  const datos = rows[0];

  const abonos = await repo.getAbonos(prestamoId);
  const cargos = await _cargosDe(datos, prestamoId, negocioId);

  // Aviso de mora y paz y salvo: con los datos de la sede que prestó.
  const config = await configDocumento(negocioId, datos.sucursal_id);

  const cant = Number(datos.cantidad_prestada) || 1;
  const descripcion = [
    `Préstamo ${_numero(datos)} del ${formatFechaHora(datos.fecha)}`,
    _producto(datos),
    datos.imei ? `IMEI ${datos.imei}` : null,
    datos.serial_color ? `Color ${datos.serial_color}` : null,
    (!datos.imei && cant > 1) ? `${cant} unidades` : null,
  ].filter(Boolean).join(' · ');

  return {
    config,
    // Para el ticket POS: con ella la pantalla resuelve el mismo encabezado.
    sucursal_id: datos.sucursal_id,
    persona: {
      nombre:  datos.persona_nombre,
      cedula:  datos.persona_cedula !== 'COMPANERO' ? datos.persona_cedula : null,
      celular: datos.persona_celular !== '0000000000' ? datos.persona_celular : null,
    },
    resumen: resumirObligacion({
      tipo: 'prestamo', documento: datos, abonos,
      mora: cargos.mora, interes: cargos.interes, mora_movimientos: cargos.movimientos,
    }),
    descripcion: descripcion || null,
  };
};

const generarPdfAvisoMoraPrestamo = async ({ prestamoId, negocioId }) => {
  const { config, persona, resumen, descripcion } = await _documentoPrestamo(prestamoId, negocioId);
  if (!resumen.vencido) {
    const err = new Error('Este préstamo no está vencido: no procede un aviso de mora');
    err.status = 400;
    throw err;
  }
  return generarAvisoMora({ config, persona, resumen, descripcion });
};

const generarPdfPazYSalvoPrestamo = async ({ prestamoId, negocioId }) => {
  const { config, persona, resumen, descripcion } = await _documentoPrestamo(prestamoId, negocioId);
  if (!resumen.pagada) {
    const err = new Error('El préstamo aún tiene saldo pendiente: no se puede expedir paz y salvo');
    err.status = 400;
    throw err;
  }
  return generarPazYSalvo({ config, persona, resumen, descripcion });
};

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  generarPdfPrestamosActivos, generarPdfPrestamoIndividual, generarPdfEstadoCuenta,
  generarPdfAvisoMoraPrestamo, generarPdfPazYSalvoPrestamo, _documentoPrestamo,
  // Para las pruebas: dibujan sin tocar la base.
  _detallesEstadoCuenta, TIPO_LABEL,
};
