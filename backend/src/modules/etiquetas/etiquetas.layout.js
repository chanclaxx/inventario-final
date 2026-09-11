// ── Cómo se reparte el espacio DENTRO de una etiqueta, y dónde cae cada una ──
//
// Geometría pura: ni pdfkit ni base de datos. Devuelve el plano de la etiqueta
// —dónde va cada texto y dónde va el símbolo— y la transformación de la página,
// y `etiquetas.pdf.js` se limita a ejecutarlos.
//
// Está separado porque lo usan DOS cosas: el PDF y la vista previa que le avisa
// al usuario "en esta etiqueta la barra fina queda en 0,19 mm; tu lector va a
// fallar" o le dibuja la retícula del rollo. Si la previa calculara por su
// cuenta acabaría mintiendo, y el usuario se enteraría después de gastar la
// plancha. Es el mismo criterio con el que el importador corre el importador DE
// VERDAD dentro de una transacción que hace ROLLBACK en vez de escribir un
// validador paralelo.
//
// ── La regla que manda sobre todas: el símbolo tiene que escanear ────────────
// Una etiqueta con el nombre completo, el precio grande y un código ilegible no
// sirve para nada; una con solo el código sí. Cuando no cabe todo se sacrifica
// el TEXTO —pie, encabezado, precio, variante, nombre, en ese orden— y jamás el
// símbolo. Lo sacrificado se devuelve como aviso; nada se cae en silencio.

const { MM }  = require('./etiquetas.formatos');
const code128 = require('../../utils/code128.util');
const qrUtil  = require('../../utils/qr.util');

// Ancho mínimo del módulo estrecho. Por debajo, una impresora de oficina ya no
// resuelve el borde y el lector empieza a fallar de forma INTERMITENTE, que es
// peor que fallar siempre: nadie sospecha de la etiqueta.
const MODULO_MIN_MM    = 0.25;   // Code 128 con lector láser
const MODULO_MIN_QR_MM = 0.33;   // QR con cámara de celular

// Y un TECHO para las barras. Sin él, en una etiqueta de 100 mm un código de
// seis cifras se estiraba a módulos de más de 1 mm: un símbolo de 10 cm que el
// haz de un lector de mano, a la distancia de siempre, no alcanza a barrer
// entero. 0,6 mm está holgado por encima de lo que piden las normas de
// etiquetado de producto y deja el código del tamaño de siempre.
const MODULO_MAX_MM = 0.6;

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

// Rangos de lo que el usuario puede ajustar del diseño. Los aplica el service
// al sanear la petición y se repiten aquí como red: `planear` también la llama
// la prueba, sin pasar por el service.
const DISENO = {
  escalaTexto:    { min: 0.6, max: 1.6, defecto: 1 },
  lineasNombre:   { min: 1,   max: 3,   defecto: 2 },
  margenInterior: { min: 0,   max: 8 },     // mm; vacío = automático
  altoSimbolo:    { min: 4,   max: 80 },    // mm; vacío = todo lo que quede
};

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const _numero = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// El orden en que se suelta el texto cuando no cabe. El código legible NO está:
// cuando el símbolo se raya, se moja o el lector no lo toma, alguien tiene que
// poder teclearlo. Es la salida de emergencia de toda la feature.
//
// El encabezado (el nombre del negocio) cae ANTES que el precio: es decoración,
// y el precio es lo que el cliente busca en la etiqueta. Con el orden anterior,
// una tira de 3 columnas de 32 × 25 con encabezado y precio pedidos imprimía el
// nombre del negocio en cada etiqueta y ningún precio.
const ORDEN_SACRIFICIO = ['pie', 'encabezado', 'precio', 'variante', 'nombre'];

/**
 * Plano de una etiqueta, en puntos y relativo a su esquina superior izquierda.
 *
 * @param {number} wPt  ancho de la etiqueta en puntos
 * @param {number} hPt  alto de la etiqueta en puntos
 * @param {object} item nodo a etiquetar: { nombre, variante_label, codigo, precio }
 * @param {object} op
 * @param {'barras'|'qr'} op.simbologia
 * @param {object} op.mostrar     { nombre, variante, precio, encabezado, pie }
 * @param {string} [op.encabezado] texto del encabezado (nombre del negocio)
 * @param {string} [op.pie]        texto libre al pie (garantía, sede…)
 * @param {object} [op.diseno]     { alinear, escalaTexto, lineasNombre, margenInterior, altoSimbolo }
 * @param {number} [op.dpi]        resolución de la impresora; con ella el módulo
 *   se ajusta a un número ENTERO de puntos del cabezal (ver abajo)
 * @returns {{ bloques: object[], simbolo: object, moduloMm: number, avisos: string[] }}
 */
const planear = (wPt, hPt, item, op = {}) => {
  const simbologia = op.simbologia === 'qr' ? 'qr' : 'barras';
  const mostrar    = op.mostrar || {};
  const diseno     = op.diseno  || {};

  const escala     = clamp(Number(diseno.escalaTexto) || DISENO.escalaTexto.defecto,
    DISENO.escalaTexto.min, DISENO.escalaTexto.max);
  const lineasMax  = clamp(Math.round(Number(diseno.lineasNombre) || DISENO.lineasNombre.defecto),
    DISENO.lineasNombre.min, DISENO.lineasNombre.max);
  const izquierda  = diseno.alinear === 'izquierda';

  // Margen interior. Automático: proporcional, con tope — en una etiqueta de
  // 100 mm un 6 % serían 6 mm de blanco desperdiciado. A mano: lo que diga el
  // usuario, sin pasarse de un cuarto del lado corto (si no, no queda etiqueta).
  const padManual = _numero(diseno.margenInterior);
  const pad = padManual !== null && Number.isFinite(padManual)
    ? Math.min(clamp(padManual, DISENO.margenInterior.min, DISENO.margenInterior.max) * MM, Math.min(wPt, hPt) / 4)
    : clamp(Math.min(wPt, hPt) * 0.06, 1.2 * MM, 2.5 * MM);

  const x0 = pad, y0 = pad;
  const w  = wPt - pad * 2;
  const h  = hPt - pad * 2;
  if (w <= 0 || h <= 0) {
    throw { status: 400, message: 'La etiqueta es demasiado pequeña para imprimir nada' };
  }

  // Tamaño de un PUNTO del cabezal, en puntos PDF. Sin resolución, null.
  const dpi = Number(op.dpi);
  const punto = Number.isFinite(dpi) && dpi >= 100 && dpi <= 1200 ? 72 / dpi : null;

  const lateral   = simbologia === 'qr' && (w / h) >= RELACION_QR_LATERAL;
  const altoCol   = h;

  // Tope del símbolo a mano. Sin él, las barras se comen todo el alto que deja
  // el texto: en una etiqueta de 100 × 50 eso son 3 cm de barras.
  const altoSimboloMax = _numero(diseno.altoSimbolo);
  const topeSimbolo = altoSimboloMax !== null && Number.isFinite(altoSimboloMax)
    ? clamp(altoSimboloMax, DISENO.altoSimbolo.min, DISENO.altoSimbolo.max) * MM
    : Infinity;

  // ── Tamaños de letra, escalados al alto de la etiqueta y al gusto ──────────
  const S = {
    encabezado: clamp(h * 0.10, 3.5, 6.5) * escala,
    nombre:     clamp(h * 0.15, 4.5, 9.5) * escala,
    variante:   clamp(h * 0.13, 4.0, 8.0) * escala,
    codigo:     clamp(h * 0.13, 4.5, 8.5) * escala,
    precio:     clamp(h * 0.18, 5.0, 12)  * escala,
    pie:        clamp(h * 0.10, 3.5, 6.5) * escala,
  };
  const alto = (s) => s * 1.18;

  // ── Qué texto se pide ──────────────────────────────────────────────────────
  const textoPie = String(op.pie ?? '').trim();
  const pedido = {
    encabezado: !!(mostrar.encabezado && op.encabezado),
    nombre:     mostrar.nombre !== false,
    variante:   mostrar.variante !== false && !!item.variante_label,
    precio:     !!mostrar.precio && item.precio != null && Number(item.precio) > 0,
    pie:        !!mostrar.pie && !!textoPie,
  };
  const activo = { ...pedido };
  const avisos = [];
  let lineasNombre = lineasMax;

  // Alto de TODO el texto de la columna, incluido el código legible.
  const altoTexto = () =>
    (activo.encabezado ? alto(S.encabezado) : 0)
    + (activo.nombre   ? alto(S.nombre) * lineasNombre : 0)
    + (activo.variante ? alto(S.variante) : 0)
    + alto(S.codigo)
    + (activo.precio   ? alto(S.precio) : 0)
    + (activo.pie      ? alto(S.pie) : 0);

  // ¿Cabe el símbolo con lo que queda? En lateral el QR no compite por el alto
  // (van en columnas), así que allí lo único que puede no caber es el texto.
  const cabe = () => {
    if (lateral) return altoTexto() <= altoCol;
    const libre = h - altoTexto();
    return simbologia === 'qr'
      ? Math.min(w, libre) >= LADO_QR_MIN
      : libre >= ALTO_BARRAS_MIN;
  };

  // Antes de soltar nada, el nombre cede renglones: un nombre en una línea
  // (encogido) es mejor que perder la variante o el precio.
  while (!cabe() && activo.nombre && lineasNombre > 1) lineasNombre -= 1;
  for (const clave of ORDEN_SACRIFICIO) {
    if (cabe()) break;
    if (!activo[clave]) continue;
    activo[clave] = false;
    avisos.push(`sin_espacio_${clave}`);
  }

  // ── El símbolo ─────────────────────────────────────────────────────────────
  //
  // Primero se calcula su tamaño, después se reparte el alto: cuando el símbolo
  // es más bajo que el hueco (tope a mano, o un QR limitado por el ancho), lo
  // que sobra se reparte arriba y abajo para que el bloque quede centrado en
  // vez de pegado al borde superior.
  let simbolo;
  let moduloMm;
  let puntosModulo = null;
  let altoSimboloPt;   // lo que el símbolo ocupa en la columna (0 si es lateral)

  // Con resolución conocida, el módulo se lleva a un número ENTERO de puntos
  // del cabezal. Una térmica de 203 dpi pinta en pasos de 0,125 mm: un módulo
  // de 0,28 mm son 2,24 puntos, y el driver redondea cada barra a 2 o a 3 según
  // dónde caiga — barras que deberían medir igual salen distintas y el lector
  // falla de forma intermitente. Con 2 puntos exactos (0,25 mm), todas iguales.
  const ajustarAPunto = (mod) => {
    if (!punto) return mod;
    const n = Math.floor(mod / punto + 1e-9);
    if (n < 1) { avisos.push('resolucion_insuficiente'); return mod; }
    puntosModulo = n;
    return n * punto;
  };

  if (simbologia === 'qr') {
    const { matriz, lado } = qrUtil.codificar(item.codigo);
    const conQuiet = lado + QUIET_QR * 2;

    // Lateral: cuadrado de lado = alto útil, pegado a la izquierda. Apilado: lo
    // que quede libre entre el texto de arriba y el de abajo, sin pasarse del
    // ancho (un QR es cuadrado y el ancho también lo limita) ni del tope.
    const disponible = lateral ? h : Math.max(0, Math.min(w, h - altoTexto(), topeSimbolo));
    const mod    = ajustarAPunto(disponible / conQuiet);
    const ladoPt = mod * conQuiet;
    moduloMm     = mod / MM;

    simbolo = { tipo: 'qr', matriz, lado, modulo: mod, ladoPt, x: 0, y: 0 };
    altoSimboloPt = lateral ? 0 : ladoPt;
  } else {
    const { barras, modulos } = code128.codificar(item.codigo);

    // Las BARRAS tienen que caer dentro del área útil; las ZONAS MUDAS solo
    // dentro de la etiqueta. La zona muda es blanco, no tinta: puede ocupar el
    // margen interior, y si la etiqueta se corre un milímetro en la impresora
    // cae sobre el hueco del troquel, que también es blanco. Contarla dentro
    // del área útil —como se hacía— encogía el módulo un 10 % en las etiquetas
    // pequeñas, que son justo las que están al límite.
    const mod = ajustarAPunto(Math.min(w / modulos, wPt / (modulos + QUIET_BARRAS * 2), MODULO_MAX_MM * MM));
    moduloMm  = mod / MM;

    const altoBar = clamp(h - altoTexto(), ALTO_BARRAS_MIN * 0.6, topeSimbolo);
    const anchoBarras = modulos * mod;
    simbolo = { tipo: 'barras', barras, modulo: mod, x: 0, y: 0, alto: altoBar, ancho: anchoBarras };
    altoSimboloPt = altoBar;
  }

  // ── Armado ─────────────────────────────────────────────────────────────────
  const bloques  = [];
  const colX     = lateral ? x0 + h + SEPARACION_QR : x0;
  const colW     = lateral ? Math.max(0, w - h - SEPARACION_QR) : w;
  const alinear  = lateral || izquierda ? 'left' : 'center';

  const altoContenido = altoTexto() + altoSimboloPt;
  let cursor = y0 + Math.max(0, (altoCol - altoContenido) / 2);

  const texto = (clave, contenido, extra = {}) => {
    bloques.push({ texto: contenido, x: colX, y: cursor, w: colW, size: S[clave], align: alinear, lineas: 1, ...extra });
    cursor += alto(S[clave]) * (extra.lineas || 1);
  };

  if (activo.encabezado) texto('encabezado', op.encabezado, { gris: true });
  if (activo.nombre)     texto('nombre', item.nombre || '', { bold: true, lineas: lineasNombre });
  if (activo.variante)   texto('variante', item.variante_label);

  if (simbolo.tipo === 'qr') {
    const q = QUIET_QR * simbolo.modulo;
    if (lateral) {
      simbolo.x = x0 + (h - simbolo.ladoPt) / 2 + q;
      simbolo.y = y0 + (h - simbolo.ladoPt) / 2 + q;
    } else {
      simbolo.x = x0 + (w - simbolo.ladoPt) / 2 + q;
      simbolo.y = cursor + q;
      cursor += simbolo.ladoPt;
    }
  } else {
    const q = QUIET_BARRAS * simbolo.modulo;
    // Centrado en la etiqueta, o pegado a la izquierda sin comerse la zona muda.
    simbolo.x = izquierda ? Math.max(x0, q) : (wPt - simbolo.ancho) / 2;
    simbolo.y = cursor;
    cursor += simbolo.alto;
  }

  // Código legible, siempre. Debajo del símbolo (apilado) o en la columna de
  // texto (lateral).
  texto('codigo', item.codigo, { mono: true });
  if (activo.precio) texto('precio', item.precio, { bold: true, esPrecio: true });
  if (activo.pie)    texto('pie', textoPie, { gris: true });

  const minimo = simbologia === 'qr' ? MODULO_MIN_QR_MM : MODULO_MIN_MM;
  if (moduloMm < minimo) avisos.push('modulo_estrecho');

  return { pad, bloques, simbolo, moduloMm, minimoMm: minimo, puntosModulo, avisos, simbologia, lateral };
};

// ─────────────────────────────────────────────────────────────────────────────
// La página
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dónde cae la casilla `indice` de una página, en puntos, SIN calibración.
 *
 * Vive aquí y no dentro del que dibuja para que la prueba pueda comprobar la
 * retícula REAL: es la aritmética que decide si las etiquetas caen sobre el
 * troquel o media hoja corrida, y un error aquí no se ve en pantalla — se ve
 * cuando ya se gastó la plancha.
 */
const celda = (formato, indice) => {
  const col = indice % formato.columnas;
  const fil = Math.floor(indice / formato.columnas);
  return {
    x: (formato.margen.izquierda + col * (formato.etiqueta.ancho + formato.separacion.x)) * MM,
    y: (formato.margen.arriba    + fil * (formato.etiqueta.alto  + formato.separacion.y)) * MM,
  };
};

/**
 * La casilla con el desvío de la impresora sumado (`ajuste`, en milímetros).
 * Se conserva por compatibilidad: es la forma en que la prueba de la retícula
 * siempre lo ha medido. El PDF ya no lo usa directo: aplica `matrizPagina`, que
 * además gira y escala.
 */
const posicionEnHoja = (formato, indice, ajuste = { x: 0, y: 0 }) => {
  const c = celda(formato, indice);
  return {
    x: c.x + (Number(ajuste.x) || 0) * MM,
    y: c.y + (Number(ajuste.y) || 0) * MM,
  };
};

const ROTACIONES = [0, 90, 180, 270];
const ESCALA = { min: 50, max: 150 };      // %
const AJUSTE_MAX = 30;                     // mm de desvío en cualquier sentido

/** [a b c d e f] ∘ [a b c d e f]: primero `l`, después `r` (convención PDF). */
const componer = (r, l) => [
  r[0] * l[0] + r[2] * l[1],
  r[1] * l[0] + r[3] * l[1],
  r[0] * l[2] + r[2] * l[3],
  r[1] * l[2] + r[3] * l[3],
  r[0] * l[4] + r[2] * l[5] + r[4],
  r[1] * l[4] + r[3] * l[5] + r[5],
];

const aplicar = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

/**
 * Calibración de la impresora → la transformación de CADA página.
 *
 * Tres correcciones, porque son tres las formas en que una impresora real se
 * aparta del PDF:
 *
 *   · DESVÍO (`ajuste`, mm): la hoja entra corrida. Mueve la retícula entera,
 *     sin deformarla.
 *   · ESCALA (`impresora.escala`, %): el driver achica la página aunque se le
 *     pida tamaño real (pasa con planchas en impresoras que no imprimen hasta el
 *     borde). La hoja de prueba trae una regla: si los 50 mm miden 48,5, la
 *     escala que lo corrige es 50 / 48,5.
 *   · GIRO (`impresora.rotacion`, 0/90/180/270): el driver de la térmica tiene
 *     el papel definido de pie y la tira sale de lado, o el rollo sale al revés
 *     de como se lee. Con 90 y 270 la página física intercambia ancho y alto:
 *     eso es lo que hay que poner en el tamaño de papel de la impresora.
 *
 * El orden importa y es este: primero escala y desvío (en el espacio de la
 * etiqueta, donde el usuario los midió), después el giro de la página entera.
 *
 * @returns {{ matriz: number[], papel: {ancho:number, alto:number}, rotacion: number, escala: number }}
 *   `papel` en puntos: el tamaño de la página FÍSICA del PDF
 */
const matrizPagina = (formato, op = {}) => {
  const W = formato.pagina.ancho * MM;
  const H = formato.pagina.alto  * MM;
  const rotacion = ROTACIONES.includes(Number(op.impresora?.rotacion)) ? Number(op.impresora.rotacion) : 0;
  const escala   = clamp(Number(op.impresora?.escala) || 100, ESCALA.min, ESCALA.max) / 100;
  const dx = clamp(Number(op.ajuste?.x) || 0, -AJUSTE_MAX, AJUSTE_MAX) * MM;
  const dy = clamp(Number(op.ajuste?.y) || 0, -AJUSTE_MAX, AJUSTE_MAX) * MM;

  let giro;
  let papel;
  switch (rotacion) {
    case 90:  giro = [0, 1, -1, 0, H, 0];  papel = { ancho: H, alto: W }; break;
    case 180: giro = [-1, 0, 0, -1, W, H]; papel = { ancho: W, alto: H }; break;
    case 270: giro = [0, -1, 1, 0, 0, W];  papel = { ancho: H, alto: W }; break;
    default:  giro = [1, 0, 0, 1, 0, 0];   papel = { ancho: W, alto: H };
  }
  return { matriz: componer(giro, [escala, 0, 0, escala, dx, dy]), papel, rotacion, escala };
};

/**
 * La geometría de la primera página, en MILÍMETROS, para que la pantalla dibuje
 * el diagrama del rollo o de la plancha. Sale de las MISMAS funciones con las
 * que se dibuja el PDF: el diagrama no puede decir una cosa y el papel otra.
 *
 * `fuera` avisa cuando la calibración empuja alguna etiqueta fuera de la
 * página: esa parte no se imprime, y sin el aviso parecería un error de la
 * impresora.
 */
const geometria = (formato, op = {}, { desde = 1 } = {}) => {
  const porPagina = formato.columnas * formato.filas;
  const saltar = clamp((Number(desde) || 1) - 1, 0, porPagina - 1);
  const { papel, rotacion, escala } = matrizPagina(formato, op);

  const dx = clamp(Number(op.ajuste?.x) || 0, -AJUSTE_MAX, AJUSTE_MAX);
  const dy = clamp(Number(op.ajuste?.y) || 0, -AJUSTE_MAX, AJUSTE_MAX);
  const r2 = (n) => Math.round(n * 100) / 100;

  let fuera = false;
  const celdas = [];
  for (let i = 0; i < porPagina; i += 1) {
    const c = celda(formato, i);
    const x = c.x / MM;
    const y = c.y / MM;
    celdas.push({ indice: i, x: r2(x), y: r2(y), saltada: i < saltar });
    // Esquinas con escala y desvío, en el espacio de la página lógica.
    const x1 = x * escala + dx;
    const y1 = y * escala + dy;
    const x2 = (x + formato.etiqueta.ancho) * escala + dx;
    const y2 = (y + formato.etiqueta.alto)  * escala + dy;
    if (x1 < -0.3 || y1 < -0.3 || x2 > formato.pagina.ancho + 0.3 || y2 > formato.pagina.alto + 0.3) fuera = true;
  }

  return {
    medio: formato.medio,
    pagina:   { ancho: r2(formato.pagina.ancho), alto: r2(formato.pagina.alto) },
    papel:    { ancho: r2(papel.ancho / MM), alto: r2(papel.alto / MM), rotacion },
    etiqueta: { ancho: formato.etiqueta.ancho, alto: formato.etiqueta.alto },
    columnas: formato.columnas,
    filas:    formato.filas,
    margen:   formato.margen,
    separacion: formato.separacion,
    rollo:    formato.rollo || null,
    celdas,
    saltadas: saltar,
    fuera,
  };
};

// La regla de la hoja de prueba: el largo redondo más grande que cabe en la
// etiqueta con 1 mm de aire a cada lado. La pantalla lo necesita para preguntar
// «¿cuánto midió la regla de 50 mm?» y convertir esa medida en la escala; por
// eso vive aquí y no dentro del PDF.
const LARGOS_REGLA = [100, 80, 50, 40, 30, 20, 10];
const largoRegla = (anchoMm) => LARGOS_REGLA.find((l) => l <= anchoMm - 2) || null;

module.exports = {
  planear, celda, posicionEnHoja, matrizPagina, geometria, componer, aplicar, largoRegla,
  MODULO_MIN_MM, MODULO_MIN_QR_MM, MODULO_MAX_MM,
  QUIET_BARRAS, QUIET_QR,
  ALTO_BARRAS_MIN, LADO_QR_MIN,
  DISENO, ROTACIONES, ESCALA, AJUSTE_MAX, ORDEN_SACRIFICIO,
};
