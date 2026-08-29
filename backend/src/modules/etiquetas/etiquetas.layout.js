// ── Cómo se reparte el espacio DENTRO de una etiqueta ────────────────────────
//
// Geometría pura: ni pdfkit ni base de datos. Devuelve el plano de la etiqueta
// —dónde va cada texto y dónde va el símbolo— y `etiquetas.pdf.js` se limita a
// ejecutarlo.
//
// Está separado porque lo usan DOS cosas: el PDF y la vista previa que le avisa
// al usuario "en esta etiqueta la barra fina queda en 0,19 mm; tu lector va a
// fallar". Si la previa calculara por su cuenta acabaría mintiendo, y el usuario
// se enteraría después de gastar la plancha. Es el mismo criterio con el que el
// importador corre el importador DE VERDAD dentro de una transacción que hace
// ROLLBACK en vez de escribir un validador paralelo.
//
// ── La regla que manda sobre todas: el símbolo tiene que escanear ────────────
// Una etiqueta con el nombre completo, el precio grande y un código ilegible no
// sirve para nada; una con solo el código sí. Cuando no cabe todo se sacrifica
// el TEXTO —precio, encabezado, variante, nombre, en ese orden— y jamás el
// símbolo. Lo sacrificado se devuelve como aviso; nada se cae en silencio.

const { MM }  = require('./etiquetas.formatos');
const code128 = require('../../utils/code128.util');
const qrUtil  = require('../../utils/qr.util');

// Ancho mínimo del módulo estrecho. Por debajo, una impresora de oficina ya no
// resuelve el borde y el lector empieza a fallar de forma INTERMITENTE, que es
// peor que fallar siempre: nadie sospecha de la etiqueta.
const MODULO_MIN_MM    = 0.25;   // Code 128 con lector láser
const MODULO_MIN_QR_MM = 0.33;   // QR con cámara de celular

// Zona muda: blanco obligatorio a los lados del símbolo. Sin ella el lector no
// encuentra dónde empieza el código, por perfectas que estén las barras.
const QUIET_BARRAS = 10;   // módulos a cada lado (ISO/IEC 15417)
const QUIET_QR     = 4;    // módulos a cada lado (ISO/IEC 18004)

// Alto mínimo de las barras. El estándar pide el 15 % del ancho del símbolo; en
// etiquetas pequeñas eso no cabe nunca, así que se toma un piso absoluto de
// 5 mm, que es lo que un lector de bodega necesita para no perder el barrido.
const ALTO_BARRAS_MIN = 5 * MM;
const LADO_QR_MIN     = 9 * MM;
const SEPARACION_QR   = 2 * MM;   // aire entre el QR y la columna de texto

// A partir de esta relación ancho/alto el QR va al LADO y no arriba: un QR es
// cuadrado, y encima del texto en una etiqueta apaisada desperdicia media
// etiqueta. Al lado, el QR sale más grande y el texto cabe entero.
const RELACION_QR_LATERAL = 1.6;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/**
 * Plano de una etiqueta, en puntos y relativo a su esquina superior izquierda.
 *
 * @param {number} wPt  ancho de la etiqueta en puntos
 * @param {number} hPt  alto de la etiqueta en puntos
 * @param {object} item nodo a etiquetar: { nombre, variante_label, codigo, precio }
 * @param {object} op   { simbologia: 'barras'|'qr', mostrar: {...}, encabezado }
 * @returns {{ bloques: object[], simbolo: object, moduloMm: number, avisos: string[] }}
 */
const planear = (wPt, hPt, item, op = {}) => {
  const simbologia = op.simbologia === 'qr' ? 'qr' : 'barras';
  const mostrar    = op.mostrar || {};

  // Margen interior proporcional, con tope: en una etiqueta de 100 mm un 6 %
  // serían 6 mm de blanco desperdiciado.
  const pad = clamp(Math.min(wPt, hPt) * 0.06, 1.2 * MM, 2.5 * MM);
  const x0 = pad, y0 = pad;
  const w  = wPt - pad * 2;
  const h  = hPt - pad * 2;
  if (w <= 0 || h <= 0) {
    throw { status: 400, message: 'La etiqueta es demasiado pequeña para imprimir nada' };
  }

  const lateral   = simbologia === 'qr' && (w / h) >= RELACION_QR_LATERAL;
  const anchoCol  = lateral ? w - h - SEPARACION_QR : w;
  const altoCol   = h;

  // ── Tamaños de letra, escalados al alto de la etiqueta ─────────────────────
  const S = {
    encabezado: clamp(h * 0.10, 3.5, 6.5),
    nombre:     clamp(h * 0.15, 4.5, 9.5),
    variante:   clamp(h * 0.13, 4.0, 8.0),
    codigo:     clamp(h * 0.13, 4.5, 8.5),
    precio:     clamp(h * 0.18, 5.0, 12),
  };
  const alto = (s) => s * 1.18;

  // ── Qué texto se pide ──────────────────────────────────────────────────────
  //
  // El código legible NO es opcional y no aparece en `activo`: cuando el símbolo
  // se raya, se moja o el lector no lo toma, alguien tiene que poder teclearlo.
  // Es la salida de emergencia de toda la feature.
  const pedido = {
    encabezado: !!(mostrar.encabezado && op.encabezado),
    nombre:     mostrar.nombre !== false,
    variante:   mostrar.variante !== false && !!item.variante_label,
    precio:     !!mostrar.precio && item.precio != null && Number(item.precio) > 0,
  };
  const activo = { ...pedido };
  const avisos = [];
  let lineasNombre = 2;

  // Alto de TODO el texto de la columna, incluido el código legible.
  const altoTexto = () =>
    (activo.encabezado ? alto(S.encabezado) : 0)
    + (activo.nombre   ? alto(S.nombre) * lineasNombre : 0)
    + (activo.variante ? alto(S.variante) : 0)
    + alto(S.codigo)
    + (activo.precio   ? alto(S.precio) : 0);

  // ¿Cabe el símbolo con lo que queda? En lateral el QR no compite por el alto
  // (van en columnas), así que allí lo único que puede no caber es el texto.
  const cabe = () => {
    if (lateral) return altoTexto() <= altoCol;
    const libre = h - altoTexto();
    return simbologia === 'qr'
      ? Math.min(w, libre) >= LADO_QR_MIN
      : libre >= ALTO_BARRAS_MIN;
  };

  if (!cabe() && activo.nombre) lineasNombre = 1;
  for (const clave of ['precio', 'encabezado', 'variante', 'nombre']) {
    if (cabe()) break;
    if (!activo[clave]) continue;
    activo[clave] = false;
    avisos.push(`sin_espacio_${clave}`);
  }

  // ── Armado ─────────────────────────────────────────────────────────────────
  const bloques  = [];
  const colX     = lateral ? x0 + h + SEPARACION_QR : x0;
  const colW     = lateral ? Math.max(0, anchoCol) : w;
  const alinear  = lateral ? 'left' : 'center';

  let cursor = y0;
  const texto = (clave, contenido, extra = {}) => {
    bloques.push({ texto: contenido, x: colX, y: cursor, w: colW, size: S[clave], align: alinear, lineas: 1, ...extra });
    cursor += alto(S[clave]) * (extra.lineas || 1);
  };

  if (activo.encabezado) texto('encabezado', op.encabezado, { gris: true });
  if (activo.nombre)     texto('nombre', item.nombre || '', { bold: true, lineas: lineasNombre });
  if (activo.variante)   texto('variante', item.variante_label);

  // ── El símbolo ─────────────────────────────────────────────────────────────
  let simbolo;
  let moduloMm;

  if (simbologia === 'qr') {
    const { matriz, lado } = qrUtil.codificar(item.codigo);
    const conQuiet = lado + QUIET_QR * 2;

    // Lateral: cuadrado de lado = alto útil, pegado a la izquierda. Apilado: lo
    // que quede libre entre el texto de arriba y el de abajo, sin pasarse del
    // ancho (un QR es cuadrado y el ancho también lo limita).
    const ladoPt = lateral ? h : Math.max(0, Math.min(w, h - altoTexto()));
    const mod    = ladoPt / conQuiet;
    moduloMm     = mod / MM;

    const sx = lateral ? x0 : x0 + (w - ladoPt) / 2;
    const sy = lateral ? y0 : cursor;

    simbolo = { tipo: 'qr', matriz, lado, modulo: mod, ladoPt, x: sx + QUIET_QR * mod, y: sy + QUIET_QR * mod };
    if (!lateral) cursor += ladoPt;
  } else {
    const { barras, modulos } = code128.codificar(item.codigo);
    const mod = w / (modulos + QUIET_BARRAS * 2);
    moduloMm  = mod / MM;

    const altoBar = Math.max(ALTO_BARRAS_MIN * 0.6, h - altoTexto());
    simbolo = { tipo: 'barras', barras, modulo: mod, x: x0 + QUIET_BARRAS * mod, y: cursor, alto: altoBar };
    cursor += altoBar;
  }

  // Código legible, siempre. Debajo del símbolo (apilado) o en la columna de
  // texto (lateral).
  texto('codigo', item.codigo, { mono: true });
  if (activo.precio) texto('precio', item.precio, { bold: true, esPrecio: true });

  const minimo = simbologia === 'qr' ? MODULO_MIN_QR_MM : MODULO_MIN_MM;
  if (moduloMm < minimo) avisos.push('modulo_estrecho');

  return { pad, bloques, simbolo, moduloMm, minimoMm: minimo, avisos, simbologia, lateral };
};

/**
 * Dónde cae la casilla `indice` de una plancha, en puntos.
 *
 * Vive aquí y no dentro del que dibuja para que la prueba pueda comprobar la
 * retícula REAL: es la aritmética que decide si las etiquetas caen sobre el
 * troquel o media hoja corrida, y un error aquí no se ve en pantalla — se ve
 * cuando ya se gastó la plancha.
 *
 * `ajuste` es la calibración de la impresora, en milímetros.
 */
const posicionEnHoja = (formato, indice, ajuste = { x: 0, y: 0 }) => {
  const col = indice % formato.columnas;
  const fil = Math.floor(indice / formato.columnas);
  return {
    x: (formato.margen.izquierda + col * (formato.etiqueta.ancho + formato.separacion.x)) * MM + (Number(ajuste.x) || 0) * MM,
    y: (formato.margen.arriba    + fil * (formato.etiqueta.alto  + formato.separacion.y)) * MM + (Number(ajuste.y) || 0) * MM,
  };
};

module.exports = {
  planear, posicionEnHoja,
  MODULO_MIN_MM, MODULO_MIN_QR_MM,
  QUIET_BARRAS, QUIET_QR,
  ALTO_BARRAS_MIN, LADO_QR_MIN,
};
