// src/modules/facturas/facturas.pdf.js
// ─────────────────────────────────────────────────────────────────────────────
// Genera el PDF de una factura usando PDFKit.
// Diseño premium con tipografía limpia, bloques bien definidos y espaciado
// consistente. Paleta oscura en encabezado, tarjetas con bordes suaves.
//
// PAGINACIÓN — lo que hay que entender antes de tocar este archivo.
//
// PDFKit abre una página nueva ÉL SOLO cada vez que se le pide dibujar texto
// (con `width`) por debajo del borde inferior útil de la página. El documento se
// creaba con `margin: 0`, así que ese borde era el filo del papel, y cada
// llamada a `doc.text` que caía más abajo se llevaba su propia página: una
// factura de 60 productos salía con 160 páginas casi vacías y la tabla partida
// por la mitad, con las filas encaramadas sobre el encabezado.
//
// La regla ahora es una: **nada se dibuja sin haber comprobado antes que cabe**.
//   · Los bloques (tarjetas, totales, firma) pasan por `asegurarEspacio`, que
//     salta de página ANTES de dibujar en vez de dejar que PDFKit lo haga a
//     mitad de un rectángulo.
//   · Las listas (productos, pagos, abonos) van por `tablaPaginada`, que dibuja
//     el marco por tramos —uno por página— y repite la cabecera arriba de cada
//     uno.
//   · Los textos de las celdas van por `textoAcotado`, que fija el alto y con
//     eso desactiva el salto automático: un nombre larguísimo se recorta con
//     puntos suspensivos en vez de abrir cuarenta páginas.
//   · Los márgenes del documento ya NO son cero: declaran el alto del
//     encabezado de continuación y la franja del pie, de modo que el salto
//     automático que quede (un párrafo de garantías más largo que una página)
//     aterrice debajo del encabezado y se detenga encima del pie.
// ─────────────────────────────────────────────────────────────────────────────

const PDFDocument = require('pdfkit');

// Base gráfica compartida por TODOS los documentos (paleta, tipografía, medidas
// y primitivas de dibujo). Antes estaba copiada aquí, en prestamos.pdf.service y
// en estadoCuenta.pdf: ahora un cambio de línea gráfica se aplica a los cinco.
const {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W, BODY_BOTTOM, FONT, C,
  formatCOP, formatFecha, formatFechaHora,
  rectFill, rectFillStroke, hLine,
  labelSeccion, fila, textoUnaLinea, dibujarLogo,
  badgeEstado, asegurarEspacio, inicioCuerpo, encabezadoContinuo,
  partirPalabrasLargas, medirTexto, textoAcotado, tablaPaginada, pieDocumento,
} = require('../../utils/pdf.base');

// Bloques de obligación (estado, fechas, abonos, condiciones), compartidos con
// el comprobante de préstamo, el aviso de mora y el paz y salvo.
const {
  bloqueEstadoObligacion, bloqueFechas, tablaAbonos, tablaMovimientosMora, bloqueCondiciones,
} = require('../../utils/obligacion.pdf');

// ─── Medidas de la página ─────────────────────────────────────────────────────

const HEADER_H       = 110;  // encabezado completo, solo en la primera página
const HEADER_CONT_H  = 40;   // franja de continuación, de la segunda en adelante
const CUERPO_TOP     = HEADER_CONT_H + 22;

// ─── Helpers propios de la factura ────────────────────────────────────────────

function labelTipoRetoma(retoma) {
  return retoma.imei ? 'Equipo con serial / IMEI' : 'Producto por cantidad';
}

function calcularValorRetoma(retoma) {
  return Number(retoma?.valor_retoma || 0);
}

function dibujarLogoHeader(doc, config, headerH) {
  return dibujarLogo(doc, config?.logo_negocio, headerH);
}

/** Número de factura ya formateado, que es la identidad del documento. */
function numeroFactura(factura) {
  return `#${String(factura.numero ?? factura.id).padStart(6, '0')}`;
}

/**
 * Color de la franja del encabezado: de un vistazo se distingue una venta de
 * contado de un crédito al día, abonado o vencido.
 */
function franjaEstado(resumen) {
  if (!resumen) return C.verde;
  if (resumen.pagada) return C.verde;
  if (resumen.vencido) return C.rojo;
  return C.naranja;
}

/** Alto de cuerpo disponible en una página entera de continuación. */
function altoUtilPagina() {
  return BODY_BOTTOM - CUERPO_TOP;
}

// ─── SECCIÓN: Encabezado ──────────────────────────────────────────────────────

function seccionEncabezado(doc, config, factura, resumen = null) {
  // La franja y el título cambian según sea contado o crédito: se reconoce el
  // tipo de documento de un vistazo.
  const esCredito = !!resumen;

  // ── Fondo del encabezado ──────────────────────────────────────────────────
  rectFill(doc, 0, 0, PAGE_W, HEADER_H, C.headerBg, 0);
  doc.rect(0, HEADER_H - 3, PAGE_W, 3).fill(franjaEstado(resumen));

  // ── Logo (se dibuja encima del fondo) ─────────────────────────────────────
  const logoOffset = dibujarLogoHeader(doc, config, HEADER_H);

  // Columna izquierda (negocio) hasta el 60%; columna derecha (factura) desde el 62%.
  const leftX  = MARGIN + logoOffset;
  const leftW  = MARGIN + CONTENT_W * 0.60 - leftX;
  const rightX = MARGIN + CONTENT_W * 0.62;
  const rightW = PAGE_W - rightX - MARGIN;

  // ── Lado izquierdo: nombre del negocio en una sola línea ──────────────────
  const nombreNegocio = config?.nombre_negocio || 'MI TIENDA';
  textoUnaLinea(doc, nombreNegocio, leftX, 28, leftW);

  let yInfo = 56;
  const infoNegocio = [
    config?.nit       ? `NIT: ${config.nit}`       : null,
    config?.direccion ? config.direccion             : null,
    config?.telefono  ? `Tel: ${config.telefono}`   : null,
  ].filter(Boolean);

  for (const linea of infoNegocio) {
    textoAcotado(doc, linea, leftX, yInfo, leftW, { size: 8, color: C.headerSub });
    yInfo += 12;
  }

  // ── Lado derecho: número de factura, fecha, estado ────────────────────────
  textoAcotado(doc, numeroFactura(factura), rightX, 22, rightW,
    { font: FONT.bold, size: 26, color: C.headerText, align: 'right' });

  textoAcotado(doc, esCredito ? 'FACTURA DE VENTA A CRÉDITO' : 'FACTURA DE VENTA',
    rightX, 54, rightW, { size: 8, color: C.headerSub, align: 'right' });

  textoAcotado(doc, formatFechaHora(factura.fecha), rightX, 66, rightW,
    { size: 8, color: C.headerSub, align: 'right' });

  // Badge de estado. En una venta a crédito lo que importa no es que la factura
  // esté "Activa", sino en qué va la deuda: pendiente, abonada, pagada o vencida.
  if (esCredito) {
    badgeEstado(doc, resumen.estado_label, resumen.estado_tono,
      PAGE_W - MARGIN - 92, 78, { w: 92, h: 19 });
  } else {
    // `Credito` sigue aquí para el caso degradado en que la venta es a crédito
    // pero no se pudo resolver su resumen (p. ej. sin la migración de mora):
    // el PDF sale como antes en vez de perder el color del badge.
    const estadoConfig = {
      Activa:    { bg: C.verde,   texto: 'ACTIVA'    },
      Credito:   { bg: C.naranja, texto: 'CRÉDITO'   },
      Cancelada: { bg: C.rojo,    texto: 'CANCELADA' },
    };
    const est = estadoConfig[factura.estado] || { bg: C.gris, texto: factura.estado?.toUpperCase() };
    const badgeW = 68;
    const badgeX = PAGE_W - MARGIN - badgeW;
    rectFill(doc, badgeX, 79, badgeW, 18, est.bg, 4);
    textoAcotado(doc, est.texto, badgeX, 84, badgeW,
      { font: FONT.bold, size: 7.5, color: C.blanco, align: 'center', characterSpacing: 0.8 });
  }

  return HEADER_H + 22;
}

/**
 * Encabezado de las páginas 2, 3, 4… Va enganchado a `pageAdded`, así que se
 * dibuja tanto en los saltos que decidimos nosotros como en los que PDFKit hace
 * por su cuenta al desbordar un párrafo — antes esas páginas salían sin nada
 * arriba y con el texto pegado al filo del papel.
 */
function seccionEncabezadoContinuacion(doc, config, factura, resumen) {
  rectFill(doc, 0, 0, PAGE_W, HEADER_CONT_H, C.headerBg, 0);
  doc.rect(0, HEADER_CONT_H - 2, PAGE_W, 2).fill(franjaEstado(resumen));

  textoAcotado(doc, config?.nombre_negocio || 'MI TIENDA', MARGIN, 13, CONTENT_W * 0.55,
    { font: FONT.bold, size: 10, color: C.headerText });

  textoAcotado(doc, `Factura ${numeroFactura(factura)} · continuación`,
    MARGIN + CONTENT_W * 0.55, 15, CONTENT_W * 0.45,
    { size: 8.5, color: C.headerSub, align: 'right' });
}

// ─── SECCIÓN: Cliente ─────────────────────────────────────────────────────────

function seccionCliente(doc, factura, y) {
  const esCompanero = factura.cedula === 'COMPANERO';

  // Cada dato es una línea; el nombre puede necesitar dos y por eso se mide en
  // vez de darlo por hecho: un nombre largo se comía la primera línea de datos.
  const nombre = medirTexto(doc, factura.nombre_cliente || '—', CONTENT_W - 28,
    { lineas: 2, font: FONT.bold, size: 13 });

  const datos = [];
  if (!esCompanero) {
    const cedulaTexto = `CC: ${factura.cedula}`;
    const celularTexto = (factura.celular && factura.celular !== '0000000000')
      ? `  ·  Tel: ${factura.celular}` : '';
    datos.push({ texto: cedulaTexto + celularTexto, size: 8.5, color: C.gris });
    if (factura.cliente_email)     datos.push({ texto: factura.cliente_email,     size: 8.5, color: C.gris });
    if (factura.cliente_direccion) datos.push({ texto: factura.cliente_direccion, size: 8.5, color: C.gris });
  }
  if (factura.usuario_nombre) {
    datos.push({ texto: `Atendido por: ${factura.usuario_nombre}`, size: 8, color: C.grisClaro });
  }
  if (factura.vendedor_nombre) {
    datos.push({ texto: `Vendedor: ${factura.vendedor_nombre}`, size: 8, color: C.grisClaro });
  }

  const alturaBloque = 21 + nombre.alto + datos.length * 14 + 9;

  y = asegurarEspacio(doc, y, alturaBloque);

  // Tarjeta con borde
  rectFillStroke(doc, MARGIN, y, CONTENT_W, alturaBloque, C.grisFondo, C.grisBorde, 8);

  // Label interno
  textoAcotado(doc, 'CLIENTE', MARGIN + 14, y + 12, CONTENT_W - 28,
    { font: FONT.bold, size: 7, color: C.grisClaro, characterSpacing: 1 });

  // Nombre del cliente
  textoAcotado(doc, factura.nombre_cliente || '—', MARGIN + 14, y + 24, CONTENT_W - 28,
    { lineas: 2, font: FONT.bold, size: 13, color: C.negro });

  let yDatos = y + 24 + nombre.alto + 3;
  for (const dato of datos) {
    textoAcotado(doc, dato.texto, MARGIN + 14, yDatos, CONTENT_W - 28,
      { size: dato.size, color: dato.color });
    yDatos += 14;
  }

  return y + alturaBloque + 18;
}

// ─── SECCIÓN: Tabla de productos ──────────────────────────────────────────────

/**
 * Rejilla de la tabla. Los anchos son fijos y el sobrante se lo queda la
 * descripción: con porcentajes, "Precio unit." se montaba sobre "Subtotal" en
 * cuanto la cifra pasaba del millón.
 */
const COL = (() => {
  const padL = 12, padR = 12, hueco = 10;
  const cant = 38, precio = 84, sub = 92;
  const desc = CONTENT_W - padL - padR - cant - precio - sub - hueco * 3;
  const xDesc   = MARGIN + padL;
  const xCant   = xDesc + desc + hueco;
  const xPrecio = xCant + cant + hueco;
  const xSub    = xPrecio + precio + hueco;
  return {
    desc:   { x: xDesc,   w: desc },
    cant:   { x: xCant,   w: cant },
    precio: { x: xPrecio, w: precio },
    sub:    { x: xSub,    w: sub },
  };
})();

const TABLA_HEAD_H = 28;

function cabeceraProductos(doc, y) {
  rectFill(doc, MARGIN, y, CONTENT_W, TABLA_HEAD_H, C.negro, 8);
  // Esquinas inferiores cuadradas en el header
  doc.rect(MARGIN, y + 16, CONTENT_W, 12).fill(C.negro);

  const opts = { font: FONT.bold, size: 7.5, color: C.blanco, characterSpacing: 0.5 };
  textoAcotado(doc, 'Descripción',  COL.desc.x,   y + 10, COL.desc.w,   opts);
  textoAcotado(doc, 'Cant.',        COL.cant.x,   y + 10, COL.cant.w,   { ...opts, align: 'right' });
  textoAcotado(doc, 'Precio unit.', COL.precio.x, y + 10, COL.precio.w, { ...opts, align: 'right' });
  textoAcotado(doc, 'Subtotal',     COL.sub.x,    y + 10, COL.sub.w,    { ...opts, align: 'right' });
}

function seccionProductos(doc, lineas, y) {
  // Excluir productos totalmente devueltos; ajustar cantidad neta para los parciales
  const lineasMostrar = lineas
    .filter((l) => {
      const cantNeta = Number(l.cantidad) - Number(l.cantidad_devuelta || 0);
      return cantNeta > 0;
    })
    .map((l) => {
      const cantNeta     = Number(l.cantidad) - Number(l.cantidad_devuelta || 0);
      const subtotalNeto = Number(l.precio) * cantNeta;
      return { ...l, _cantNeta: cantNeta, _subtotalNeto: subtotalNeto };
    });

  // El alto de cada fila se calcula ANTES de dibujar nada: es lo que permite
  // saber cuántas caben en lo que queda de página. Un nombre largo ocupa dos
  // líneas en vez de invadir la columna de al lado o quedar recortado siempre.
  const filas = lineasMostrar.map((linea) => {
    const nombre = medirTexto(doc, linea.nombre_producto || '—', COL.desc.w,
      { lineas: 2, font: FONT.bold, size: 9 });
    const alto = Math.max(24, 7 + nombre.alto + (linea.imei ? 11 : 0) + 7);

    return {
      alto,
      dibujar: (d, yf) => {
        const yTexto = yf + 7;

        textoAcotado(d, linea.nombre_producto || '—', COL.desc.x, yTexto, COL.desc.w,
          { lineas: 2, font: FONT.bold, size: 9, color: C.negro });

        if (linea.imei) {
          textoAcotado(d, `IMEI: ${linea.imei}`, COL.desc.x, yTexto + nombre.alto + 1,
            COL.desc.w, { size: 7.5, color: C.grisClaro });
        }

        textoAcotado(d, String(linea._cantNeta), COL.cant.x, yTexto, COL.cant.w,
          { size: 9, color: C.grisOscuro, align: 'right' });
        textoAcotado(d, formatCOP(linea.precio), COL.precio.x, yTexto, COL.precio.w,
          { size: 9, color: C.grisOscuro, align: 'right' });
        textoAcotado(d, formatCOP(linea._subtotalNeto), COL.sub.x, yTexto, COL.sub.w,
          { font: FONT.bold, size: 9, color: C.negro, align: 'right' });
      },
    };
  });

  if (filas.length === 0) {
    filas.push({
      alto: 26,
      dibujar: (d, yf) => textoAcotado(d, 'Sin productos vigentes en esta factura',
        COL.desc.x, yf + 8, CONTENT_W - 24, { size: 8.5, color: C.grisClaro }),
    });
  }

  // Se reserva la cabecera más la primera fila: un título "PRODUCTOS" solo al
  // final de una página, con la tabla en la siguiente, es exactamente el
  // "header mal hecho" que se veía.
  y = labelSeccion(doc, y, 'Productos', { reservar: TABLA_HEAD_H + filas[0].alto });

  return tablaPaginada(doc, y, {
    cabeceraAlto:    TABLA_HEAD_H,
    dibujarCabecera: cabeceraProductos,
    filas,
    espacioDespues:  18,
  });
}

// ─── SECCIÓN: Devoluciones ────────────────────────────────────────────────────

function seccionDevoluciones(doc, lineas, y) {
  const devueltas = lineas.filter((l) => Number(l.cantidad_devuelta || 0) > 0);
  if (devueltas.length === 0) return y;

  const altoDe = (l) => (l.imei ? 56 : 42);

  y = labelSeccion(doc, y, devueltas.length === 1 ? 'Devolución' : `Devoluciones (${devueltas.length})`,
    { reservar: altoDe(devueltas[0]) });

  for (const linea of devueltas) {
    const cantDev  = Number(linea.cantidad_devuelta);
    const valorDev = Number(linea.precio) * cantDev;
    const alturaBloque = altoDe(linea);

    // Cada devolución es un bloque indivisible: o cabe entera o pasa a la
    // página siguiente. Partido, el "- $120.000" quedaba huérfano arriba.
    y = asegurarEspacio(doc, y, alturaBloque + 10);

    rectFillStroke(doc, MARGIN, y, CONTENT_W, alturaBloque, C.naranjaFondo, '#FDE68A', 8);

    let yInterna = y + 12;

    textoAcotado(doc, linea.nombre_producto || '—', MARGIN + 14, yInterna, CONTENT_W * 0.65,
      { font: FONT.bold, size: 8.5, color: C.naranja });
    yInterna += 14;

    if (linea.imei) {
      textoAcotado(doc, `IMEI: ${linea.imei}`, MARGIN + 14, yInterna, CONTENT_W - 28,
        { size: 7.5, color: C.grisOscuro });
      yInterna += 14;
    }

    textoAcotado(doc, `Devuelto: ${cantDev} ud${cantDev !== 1 ? 's' : ''}.`,
      MARGIN + 14, yInterna, CONTENT_W * 0.5, { size: 8.5, color: C.grisOscuro });
    textoAcotado(doc, `- ${formatCOP(valorDev)}`, MARGIN, yInterna, CONTENT_W - 14,
      { font: FONT.bold, size: 8.5, color: C.naranja, align: 'right' });

    y += alturaBloque + 10;
  }

  return y + 10;
}

// ─── SECCIÓN: Retomas ─────────────────────────────────────────────────────────

function seccionRetomas(doc, retomas, y) {
  if (!retomas || retomas.length === 0) return y;

  const describir = (retoma) => {
    const nombreProd = retoma.nombre_producto_serial
      || retoma.nombre_producto_cantidad
      || retoma.nombre_producto
      || null;

    return [
      retoma.descripcion                                    ? retoma.descripcion            : null,
      `Tipo: ${labelTipoRetoma(retoma)}`,
      nombreProd                                            ? `Producto: ${nombreProd}`     : null,
      (!retoma.imei && Number(retoma.cantidad_retoma) > 1)  ? `Cantidad: ${retoma.cantidad_retoma}` : null,
    ].filter(Boolean);
  };

  const altoDe = (retoma) => 16 + describir(retoma).length * 13 + 28
    + (retomas.length > 1 ? 14 : 0);

  y = labelSeccion(doc, y, retomas.length === 1 ? 'Retoma' : `Retomas (${retomas.length})`,
    { reservar: altoDe(retomas[0]) });

  for (const [i, retoma] of retomas.entries()) {
    const lineas = describir(retoma);
    const alturaBloque = altoDe(retoma);

    y = asegurarEspacio(doc, y, alturaBloque + 10);

    rectFillStroke(doc, MARGIN, y, CONTENT_W, alturaBloque, C.moradoFondo, '#DDD6FE', 8);

    // Número de retoma si hay varias
    let yInterna = y + 12;
    if (retomas.length > 1) {
      textoAcotado(doc, `RETOMA ${i + 1}`, MARGIN + 14, yInterna, CONTENT_W - 28,
        { font: FONT.bold, size: 7.5, color: C.morado, characterSpacing: 0.8 });
      yInterna += 14;
    }

    for (const linea of lineas) {
      textoAcotado(doc, linea, MARGIN + 14, yInterna, CONTENT_W - 28,
        { size: 8.5, color: C.grisOscuro });
      yInterna += 13;
    }

    // Valor retoma
    const valRetoma = calcularValorRetoma(retoma);
    hLine(doc, yInterna + 4, { x1: MARGIN + 14, x2: PAGE_W - MARGIN - 14, color: '#DDD6FE' });

    textoAcotado(doc, 'Valor retoma:', MARGIN + 14, yInterna + 10, CONTENT_W * 0.5,
      { size: 8.5, color: C.morado });
    textoAcotado(doc, `- ${formatCOP(valRetoma)}`, MARGIN, yInterna + 10, CONTENT_W - 14,
      { font: FONT.bold, size: 9, color: C.morado, align: 'right' });

    y += alturaBloque + 10;
  }

  return y + 14;
}

// ─── SECCIÓN: Totales y Pagos ─────────────────────────────────────────────────

function seccionTotalesYPagos(doc, factura, y) {
  const lineas      = factura.lineas  || [];
  const pagos       = factura.pagos   || [];
  const retomas     = factura.retomas || [];
  const total       = lineas.reduce((s, l) => {
    const cantNeta = Math.max(0, Number(l.cantidad) - Number(l.cantidad_devuelta || 0));
    return s + Number(l.precio) * cantNeta;
  }, 0);
  const totalRetoma = retomas.reduce((s, r) => s + calcularValorRetoma(r), 0);
  const totalNeto   = total - totalRetoma;
  const totalPagado = pagos.reduce((s, p) => s + Number(p.valor || 0), 0);
  const cambio      = totalPagado - totalNeto;

  // ── Bloque TOTAL ──────────────────────────────────────────────────────────
  const colorTotalBg  = totalNeto < 0 ? C.verdeFondo : C.negro;
  const colorTotalTxt = totalNeto < 0 ? C.verde      : C.blanco;

  // El total y su desglose no se separan nunca: leer "TOTAL A PAGAR" sin la
  // cifra, o la cifra sin las retomas que la explican, es peor que un salto.
  const altoDesglose = totalRetoma > 0 ? 16 * 2 + 12 : 0;
  y = asegurarEspacio(doc, y, 48 + 16 + altoDesglose);

  rectFill(doc, MARGIN, y, CONTENT_W, 48, colorTotalBg, 8);

  textoAcotado(doc, 'TOTAL A PAGAR', MARGIN + 16, y + 16, CONTENT_W * 0.5,
    { font: FONT.bold, size: 11, color: colorTotalTxt });

  const textoTotal = totalNeto < 0
    ? `+ ${formatCOP(Math.abs(totalNeto))}`
    : formatCOP(totalNeto);

  textoAcotado(doc, textoTotal, MARGIN, y + 12, CONTENT_W - 16,
    { font: FONT.bold, size: 16, color: colorTotalTxt, align: 'right' });

  y += 48 + 16;

  // Si hay retomas mostrar desglose
  if (totalRetoma > 0) {
    y = fila(doc, y, 'Subtotal productos', formatCOP(total));
    y = fila(doc, y, `Retoma${retomas.length > 1 ? 's' : ''} (${retomas.length})`,
      `- ${formatCOP(totalRetoma)}`,
      { valorColor: C.morado, valorFont: FONT.bold });

    hLine(doc, y, { color: C.grisBorde });
    y += 12;
  }

  // ── Bloque PAGOS ──────────────────────────────────────────────────────────
  const FILA_PAGO = 22;
  const filasPago = [];

  for (const pago of pagos) {
    filasPago.push({
      alto: FILA_PAGO,
      dibujar: (d, yf, ctx) => {
        if (!ctx.primeraDelTramo) {
          hLine(d, yf, { x1: MARGIN + 14, x2: PAGE_W - MARGIN - 14, color: C.grisBorde, width: 0.4 });
        }
        textoAcotado(d, pago.metodo || '—', MARGIN + 14, yf + 4, CONTENT_W * 0.5,
          { size: 9, color: C.grisOscuro });
        textoAcotado(d, formatCOP(pago.valor), MARGIN, yf + 4, CONTENT_W - 14,
          { font: FONT.bold, size: 9, color: C.negro, align: 'right' });
      },
    });
  }

  if (cambio > 0) {
    filasPago.push({
      alto: FILA_PAGO,
      dibujar: (d, yf, ctx) => {
        if (!ctx.primeraDelTramo) {
          hLine(d, yf, { x1: MARGIN + 14, x2: PAGE_W - MARGIN - 14, color: C.grisBorde, width: 0.4 });
        }
        textoAcotado(d, 'Cambio', MARGIN + 14, yf + 4, CONTENT_W * 0.5, { size: 9, color: C.verde });
        textoAcotado(d, formatCOP(cambio), MARGIN, yf + 4, CONTENT_W - 14,
          { font: FONT.bold, size: 9, color: C.verde, align: 'right' });
      },
    });
  }

  // Relleno inferior de la tarjeta: sin él el último importe queda pegado al borde.
  filasPago.push({ alto: 12 });

  y = labelSeccion(doc, y, 'Pagos', { reservar: 12 + (filasPago[0]?.alto || 0) });

  return tablaPaginada(doc, y, {
    cabeceraAlto:   12,
    filas:          filasPago,
    fondo:          C.grisFondo,
    alterna:        null,
    separador:      false,
    espacioDespues: 14,
  });
}

// ─── SECCIÓN: Notas ───────────────────────────────────────────────────────────

/**
 * Párrafo dentro de una tarjeta. Si el texto no cabe en una página entera se
 * dibuja SIN tarjeta y se deja fluir: el marco no se puede partir, pero el
 * texto sí, y perder una observación larga por no poder enmarcarla sería peor.
 */
function bloqueParrafo(doc, y, texto, {
  size = 8.5, color = C.grisOscuro, lineGap = 0,
  fondo = C.grisFondo, borde = C.grisBorde, padding = 14,
} = {}) {
  const w = CONTENT_W - padding * 2;
  doc.font(FONT.normal).fontSize(size);
  const partido = partirPalabrasLargas(doc, texto, w);
  const altoTexto  = doc.heightOfString(partido, { width: w, lineGap });
  const altoBloque = altoTexto + 24;

  if (altoBloque <= altoUtilPagina()) {
    y = asegurarEspacio(doc, y, altoBloque);
    rectFillStroke(doc, MARGIN, y, CONTENT_W, altoBloque, fondo, borde, 8);
    doc.font(FONT.normal).fontSize(size).fillColor(color)
      .text(partido, MARGIN + padding, y + 12, { width: w, lineGap, height: altoTexto + 1 });
    return y + altoBloque + 24;
  }

  // Más largo que una página: se deja al flujo de PDFKit, que ahora aterriza
  // bajo el encabezado de continuación gracias a los márgenes del documento.
  y = asegurarEspacio(doc, y, 40);
  doc.font(FONT.normal).fontSize(size).fillColor(color)
    .text(partido, MARGIN + padding, y, { width: w, lineGap });
  return doc.y + 24;
}

// ─── SECCIÓN: Ajustes a esta factura ──────────────────────────────────────────
//
// Si la factura se editó o se corrigió después de emitida, el cliente ve cifras
// que no son las de la venta original. Esta sección cuenta lo que hizo el
// programa (utils/ajustesFactura.js) para que no parezca un error.
function seccionAjustes(doc, ajustes, y) {
  if (!ajustes || ajustes.length === 0) return y;

  y = labelSeccion(doc, y, 'Ajustes a esta factura', { reservar: 40 });
  const texto = ajustes.map((a) => `${formatFecha(a.fecha)} — ${a.texto}`).join('\n\n');
  return bloqueParrafo(doc, y, texto);
}

function seccionNotas(doc, notas, y) {
  if (!notas) return y;

  y = labelSeccion(doc, y, 'Observaciones', { reservar: 40 });
  return bloqueParrafo(doc, y, notas);
}

// ─── SECCIÓN: Garantías ───────────────────────────────────────────────────────

function seccionGarantias(doc, garantias, y) {
  if (!garantias || garantias.length === 0) return y;

  // Separador antes de garantías
  y = asegurarEspacio(doc, y, 60);
  hLine(doc, y, { color: C.grisBorde });
  y += 20;

  y = labelSeccion(doc, y, 'Términos y Garantías', { reservar: 50 });

  const sorted = [...garantias].sort((a, b) => a.orden - b.orden);

  for (const g of sorted) {
    // El título también puede necesitar dos líneas: darlo por hecho en una hacía
    // que el texto de la garantía se dibujara encima de él.
    const titulo = medirTexto(doc, g.titulo || '', CONTENT_W - 32,
      { lineas: 2, font: FONT.bold, size: 9 });

    doc.font(FONT.normal).fontSize(8);
    const cuerpo    = partirPalabrasLargas(doc, g.texto || '', CONTENT_W - 32);
    const altoTexto = doc.heightOfString(cuerpo, { width: CONTENT_W - 32, lineGap: 2 });
    const altoBloque = 12 + titulo.alto + 4 + altoTexto + 12;

    if (altoBloque <= altoUtilPagina()) {
      y = asegurarEspacio(doc, y, altoBloque + 10);

      rectFillStroke(doc, MARGIN, y, CONTENT_W, altoBloque, C.blanco, C.grisBorde, 8);

      // Barra izquierda de acento
      rectFill(doc, MARGIN, y, 4, altoBloque, C.negro, 0);

      textoAcotado(doc, g.titulo || '', MARGIN + 18, y + 12, CONTENT_W - 32,
        { lineas: 2, font: FONT.bold, size: 9, color: C.negro });

      doc.font(FONT.normal).fontSize(8).fillColor(C.gris)
        .text(cuerpo, MARGIN + 18, y + 12 + titulo.alto + 4,
          { width: CONTENT_W - 32, lineGap: 2, height: altoTexto + 1 });

      y += altoBloque + 10;
    } else {
      // Una garantía más larga que la página: título y texto fluyen sin marco.
      y = asegurarEspacio(doc, y, 50);
      textoAcotado(doc, g.titulo || '', MARGIN + 18, y, CONTENT_W - 32,
        { lineas: 2, font: FONT.bold, size: 9, color: C.negro });
      y += titulo.alto + 4;
      doc.font(FONT.normal).fontSize(8).fillColor(C.gris)
        .text(cuerpo, MARGIN + 18, y, { width: CONTENT_W - 32, lineGap: 2 });
      y = doc.y + 14;
    }
  }

  return y + 14;
}

// ─── SECCIÓN: Estado de la obligación a crédito ───────────────────────────────
//
// Todo lo que el cliente necesita para entender su deuda sin entrar al sistema:
// estado, valor financiado, saldo, plazo, mora e historial de abonos con el
// saldo que quedó después de cada uno.
//
// Los bloques y las cifras salen de utils/obligacion*.js, los mismos que usan el
// ticket POS, el aviso de mora y el paz y salvo: no hay forma de que un
// documento diga una cosa y otro diga otra.
function seccionCredito(doc, credito, y) {
  const resumen = credito?.resumen;
  if (!resumen) return y;

  // Cada bloque de obligación reserva ya su propio alto (lo hace su etiqueta de
  // sección, que ahora se dibuja después de medir la tarjeta). Un salto genérico
  // aquí encima sobraría y además rompería de más: pediría 200 pt cuando la
  // tarjeta puede necesitar 150, y mandaría a una hoja nueva algo que cabía.
  y = bloqueEstadoObligacion(doc, resumen, y, { titulo: 'Estado del crédito' });
  y = bloqueFechas(doc, resumen, y);
  y = tablaAbonos(doc, resumen, y);
  // Los intereses de mora van en su propia tabla: no se mezclan con los abonos
  // al producto (que son los que definen la utilidad de la venta).
  y = tablaMovimientosMora(doc, resumen, y);
  y = bloqueCondiciones(doc, resumen, y);

  return y;
}

// ─── SECCIÓN: Pie de página ───────────────────────────────────────────────────

function seccionPie(doc, y, { esCredito = false, factura = null } = {}) {
  // El agradecimiento y la firma son un bloque: una firma sola en la última
  // página, sin nada más, es la página "vacía" que hacía imposible imprimir.
  //
  // La reserva es la MEDIDA REAL del bloque (línea 20 + título 22 + firma 16 +
  // rótulo), ni un punto más: redondear al alza de más mandaba la firma a una
  // hoja nueva teniendo 150 pt libres debajo.
  y = asegurarEspacio(doc, y, esCredito ? 82 : 72);

  // Línea decorativa
  hLine(doc, y, { color: C.grisBorde });
  y += 16;

  textoAcotado(doc, '¡Gracias por su compra!', MARGIN, y, CONTENT_W,
    { font: FONT.bold, size: 11, color: C.negro, align: 'center' });

  y += 22;

  // Línea de firma
  const firmaY = y + 16;
  const firmaX1 = PAGE_W / 2 - 80;
  const firmaX2 = PAGE_W / 2 + 80;

  doc.moveTo(firmaX1, firmaY).lineTo(firmaX2, firmaY)
    .strokeColor(C.grisBorde).lineWidth(0.75).stroke();

  // En una venta a crédito la firma es la prueba del pacto, así que se identifica
  // a quien firma (nombre y cédula) en lugar de un "firma del cliente" genérico.
  if (esCredito) {
    textoAcotado(doc, 'Firma de aceptación del cliente', MARGIN, firmaY + 6, CONTENT_W,
      { font: FONT.bold, size: 8, color: C.negro, align: 'center' });
    const ident = [factura?.nombre_cliente, factura?.cedula ? `C.C. ${factura.cedula}` : null]
      .filter(Boolean).join('  ·  ');
    if (ident) {
      textoAcotado(doc, ident, MARGIN, firmaY + 18, CONTENT_W,
        { size: 7.5, color: C.grisClaro, align: 'center' });
      return firmaY + 36;
    }
    return firmaY + 24;
  }

  textoAcotado(doc, 'Firma del cliente', MARGIN, firmaY + 6, CONTENT_W,
    { size: 8, color: C.grisClaro, align: 'center' });

  return firmaY + 24;
}

// ─── Función principal exportada ──────────────────────────────────────────────

/**
 * Genera el PDF de una factura y lo escribe en el stream de respuesta.
 *
 * @param {{ factura: object, config: object, garantias: Array, res: object }} params
 */
function generarPdfFactura({ factura, config, garantias = [], credito = null, ajustes = [], res }) {
  const numFactura = String(factura.numero ?? factura.id).padStart(6, '0');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="factura-${numFactura}.pdf"`
  );

  const doc = new PDFDocument({
    size:        'A4',
    // Los márgenes NO son decorativos: son el contrato con PDFKit sobre dónde
    // empieza y dónde termina el cuerpo. `top` deja sitio al encabezado de
    // continuación y `bottom` al pie con la paginación, de modo que un salto
    // automático aterrice donde debe. Con `margin: 0` aterrizaba en el filo del
    // papel, encima del encabezado. Los bloques siguen posicionándose a mano.
    margins: {
      top:    CUERPO_TOP,
      bottom: PAGE_H - BODY_BOTTOM,
      left:   MARGIN,
      right:  MARGIN,
    },
    autoFirstPage: true,
    bufferPages:   true,   // necesario para numerar "Página N de M" al final
    info: {
      Title:   `Factura #${numFactura}`,
      Author:  config?.nombre_negocio || 'Sistema de Facturación',
      Subject: 'Factura de venta',
      Creator: 'Sistema POS',
    },
  });

  doc.pipe(res);

  const resumen = credito?.resumen || null;

  // A partir de la segunda página, franja de continuación. Va antes de dibujar
  // nada para que cubra también los saltos internos de las tablas.
  encabezadoContinuo(doc, (d) => seccionEncabezadoContinuacion(d, config, factura, resumen));

  let y = 0;

  y = seccionEncabezado(doc, config, factura, resumen);
  y = seccionCliente(doc, factura, y);
  y = seccionProductos(doc, factura.lineas || [], y);
  y = seccionDevoluciones(doc, factura.lineas || [], y);
  y = seccionRetomas(doc, factura.retomas || [], y);
  y = seccionTotalesYPagos(doc, factura, y);
  y = seccionCredito(doc, credito, y);
  y = seccionAjustes(doc, ajustes, y);
  y = seccionNotas(doc, factura.notas, y);
  y = seccionGarantias(doc, garantias, y);
  // En una venta a crédito la firma es la prueba del pacto, así que se pide
  // siempre que haya crédito, no solo cuando además se pactó una fecha límite.
  seccionPie(doc, y, { esCredito: !!resumen, factura });

  // "Página 1 de 3" solo se puede escribir cuando ya se sabe cuántas hay: por
  // eso el documento se genera con `bufferPages` y el pie se pinta al final.
  pieDocumento(doc, {
    texto: `Factura ${numeroFactura(factura)} · ${config?.nombre_negocio || ''}`.trim(),
    soloSiVarias: true,
  });

  doc.end();
}

module.exports = { generarPdfFactura };
