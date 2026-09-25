'use strict';

// ── Etiquetas como COMANDOS de impresora (TSPL y ZPL) ────────────────────────
//
// El PDF llega a una térmica pasando por el navegador y por el driver de
// Windows, y los dos deciden cosas que la aplicación no controla: Chrome/Edge
// GIRAN la página cuando no calza con el papel del driver (PDFium,
// `rotate_dst_page`), y el driver avanza el rollo según SU papel, no el del
// PDF. Con una DIG T451B eso fue: una tira de 3 columnas impresa como 3 filas,
// y en «hoja» filas en blanco entre impresiones (reportado sep-2026). Ningún
// ajuste de la aplicación lo arreglaba porque el problema no estaba en el PDF.
//
// Aquí no hay papel que elegir ni página que girar: el tamaño de la etiqueta,
// el hueco entre filas y la dirección van DENTRO del trabajo, en el idioma de la
// impresora. Es lo que hacen BarTender y el «Barcode» que el cliente usaba.
//
//   · TSPL  → TSC y casi todas las térmicas genéricas de 4" (DIG, Xprinter,
//             HPRT, 3nStar, Beeprt…). Es el que usa la T451B.
//   · ZPL   → Zebra y las que la emulan. Segunda opción si la impresora no
//             entiende TSPL (imprime el texto de los comandos en vez de etiquetas).
//
// NO se decide nada aquí: el reparto de la etiqueta sale de `layout.planear` y
// la retícula de `layout.celda`, las mismas funciones del PDF. Lo que cambia es
// cómo se dibuja:
//
//   · El símbolo va barra por barra como RECTÁNGULOS (`BAR` / `^GB`) en puntos
//     ENTEROS del cabezal, con el mismo codificador Code 128 / QR del PDF (el que
//     la suite 35 decodifica de vuelta). Usar el `BARCODE "128"` del firmware
//     dejaría el ancho del símbolo en manos de su propio reparto de juegos B/C, y
//     el plano calculó el espacio con el nuestro.
//   · El texto usa las fuentes internas de la impresora: TSPL con las de mapa de
//     bits (monoespaciadas, así que se sabe EXACTAMENTE cuántas letras caben) y
//     ZPL con la fuente 0 y `^FB`, que parte y centra en la impresora.
//
// La calibración se traduce así: el desvío suma puntos; el volteo de 180° es
// `DIRECTION` / `^PO`; la ESCALA no aplica — aquí no hay driver que achique,
// un punto es un punto.

const { MM }        = require('./etiquetas.formatos');
const layout        = require('./etiquetas.layout');
const { formatCOP } = require('../../utils/pdf.base');

const DPI_DEFECTO = 203;

// Fuentes de mapa de bits de TSPL: [alto, ancho] de la celda en puntos. Las de
// 203 dpi son las del manual de TSPL; las de 300 dpi, las equivalentes. Son
// monoespaciadas: el ancho por letra es fijo.
const FUENTES_TSPL = {
  203: { 1: [12, 8], 2: [20, 12], 3: [24, 16], 4: [32, 24], 5: [48, 32] },
  300: { 1: [20, 12], 2: [28, 16], 3: [36, 20], 4: [44, 28], 5: [64, 36] },
};

// Página de códigos 850: la que traen las fuentes internas de TSPL con las
// letras del español. Lo que no está aquí se escribe sin tilde (NFD) o como «?».
const CP850 = {
  'á': 0xA0, 'é': 0x82, 'í': 0xA1, 'ó': 0xA2, 'ú': 0xA3, 'ñ': 0xA4, 'Ñ': 0xA5,
  'Á': 0xB5, 'É': 0x90, 'Í': 0xD6, 'Ó': 0xE0, 'Ú': 0xE9, 'ü': 0x81, 'Ü': 0x9A,
  '¿': 0xA8, '¡': 0xAD, '°': 0xF8, 'º': 0xA7, 'ª': 0xA6, 'ç': 0x87, 'Ç': 0x80,
};

const _limpio = (s) => String(s ?? '')
  .replace(/[  ]/g, ' ')          // formatCOP pone un espacio duro tras el $
  .replace(/[\r\n\t]+/g, ' ')
  .replace(/"/g, "'");                       // TSPL cierra la cadena con la comilla doble

/** Texto → bytes CP850 para TSPL. */
const _cp850 = (s) => {
  const out = [];
  for (const ch of _limpio(s)) {
    const c = ch.codePointAt(0);
    if (c >= 0x20 && c < 0x7F) { out.push(c); continue; }
    if (CP850[ch] !== undefined) { out.push(CP850[ch]); continue; }
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    const b = base.codePointAt(0);
    out.push(base.length === 1 && b >= 0x20 && b < 0x7F ? b : 0x3F);
  }
  return Buffer.from(out);
};

const _textoDe = (b) => (b.esPrecio ? formatCOP(b.texto) : String(b.texto ?? ''));

/** Parte en renglones de a `max` letras, por palabras; lo que no cabe en el último se corta con «.». */
const _renglones = (texto, max, lineas) => {
  const palabras = _limpio(texto).trim().split(/\s+/).filter(Boolean);
  if (!palabras.length || max < 1) return [];
  const out = [];
  let actual = '';
  for (let i = 0; i < palabras.length; i += 1) {
    let p = palabras[i];
    // Una palabra más larga que el renglón se parte: si no, se sale de la etiqueta.
    while (p.length > max) {
      if (actual) { out.push(actual); actual = ''; }
      out.push(p.slice(0, max));
      p = p.slice(max);
    }
    const junto = actual ? `${actual} ${p}` : p;
    if (junto.length <= max) actual = junto;
    else { out.push(actual); actual = p; }
  }
  if (actual) out.push(actual);
  if (out.length > lineas) {
    const cortado = out.slice(0, lineas);
    const ult = cortado[lineas - 1];
    cortado[lineas - 1] = `${ult.slice(0, Math.max(0, max - 1))}.`;
    return cortado;
  }
  return out;
};

// ─────────────────────────────────────────────────────────────────────────────
// Dibujo común: una etiqueta → rectángulos y textos en PUNTOS del cabezal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los rectángulos del símbolo, en puntos de la impresora, relativos a la
 * esquina de la etiqueta. El módulo ya viene en puntos enteros cuando el plano
 * se calculó con `dpi` (`puntosModulo`); si la etiqueta no da ni un punto por
 * módulo, se redondea a 1 y el plano ya dejó el aviso.
 */
const _rectsSimbolo = (s, k, puntosModulo) => {
  const mod = puntosModulo || Math.max(1, Math.round(s.modulo * k));
  const rects = [];
  if (s.tipo === 'barras') {
    let x = Math.round(s.x * k);
    const y = Math.round(s.y * k);
    const alto = Math.max(1, Math.round(s.alto * k));
    for (let i = 0; i < s.barras.length; i += 1) {
      const ancho = s.barras[i] * mod;
      if (i % 2 === 0) rects.push({ x, y, w: ancho, h: alto });
      x += ancho;
    }
  } else {
    const x0 = Math.round(s.x * k);
    const y0 = Math.round(s.y * k);
    for (let f = 0; f < s.lado; f += 1) {
      let inicio = -1;
      for (let c = 0; c <= s.lado; c += 1) {
        const oscuro = c < s.lado && s.matriz[f][c];
        if (oscuro && inicio < 0) inicio = c;
        if (!oscuro && inicio >= 0) {
          rects.push({ x: x0 + inicio * mod, y: y0 + f * mod, w: (c - inicio) * mod, h: mod });
          inicio = -1;
        }
      }
    }
  }
  return rects;
};

// ─────────────────────────────────────────────────────────────────────────────
// TSPL
// ─────────────────────────────────────────────────────────────────────────────

const _tablaTspl = (dpi) => FUENTES_TSPL[dpi >= 250 ? 300 : 203];

/** La fuente más grande que no se pasa del alto del renglón. */
const _fuenteTspl = (dpi, altoObjetivo) => {
  const tabla = _tablaTspl(dpi);
  let elegida = '1';
  for (const [id, [alto]] of Object.entries(tabla)) {
    if (alto <= altoObjetivo * 1.2) elegida = id;
  }
  return elegida;
};

const _cabe = (texto, max, lineas) => max >= 1 && _renglones(texto, max, Infinity).length <= lineas;

const _tspl = (partes) => {
  const linea = (s) => partes.push(Buffer.from(`${s}\r\n`, 'latin1'));

  return {
    linea,
    bar: (x, y, w, h) => linea(`BAR ${x},${y},${w},${h}`),
    box: (x, y, x2, y2, t) => linea(`BOX ${x},${y},${x2},${y2},${t}`),
    texto: (x, y, fuente, contenido) => {
      partes.push(Buffer.from(`TEXT ${x},${y},"${fuente}",0,1,1,"`, 'latin1'));
      partes.push(_cp850(contenido));
      partes.push(Buffer.from('"\r\n', 'latin1'));
    },
  };
};

/** Un bloque de texto del plano → TEXT de TSPL, partido, alineado y (si es negrita) repasado. */
const _textoTspl = (t, b, ox, oy, k, dpi) => {
  const lineaH = b.size * 1.18 * k;
  const anchoPt = Math.max(0, b.w * k);
  const texto = _textoDe(b);
  const tabla = _tablaTspl(dpi);

  // Como `_texto` del PDF: se encoge la letra hasta que el texto quepa en sus
  // renglones, y solo con la fuente más chica se corta. El código legible es la
  // salida de emergencia cuando el símbolo no escanea: cortarlo lo inutiliza.
  let id = Number(_fuenteTspl(dpi, b.size * k));
  while (id > 1 && !_cabe(texto, Math.floor(anchoPt / tabla[id][1]), b.lineas || 1)) id -= 1;
  const f = { id: String(id), alto: tabla[id][0], ancho: tabla[id][1] };
  const max = Math.floor(anchoPt / f.ancho);
  const lineas = _renglones(texto, max, b.lineas || 1);

  lineas.forEach((ln, i) => {
    const anchoTexto = ln.length * f.ancho;
    const libre = Math.max(0, anchoPt - anchoTexto);
    const dx = b.align === 'center' ? libre / 2 : (b.align === 'right' ? libre : 0);
    const x = Math.round(ox + b.x * k + dx);
    const y = Math.round(oy + b.y * k + i * lineaH + Math.max(0, (lineaH - f.alto) / 2));
    t.texto(x, y, f.id, ln);
    // Negrita: el mismo texto corrido un punto. Las fuentes internas no traen
    // variante negrita y el nombre del producto es lo primero que se busca.
    if (b.bold) t.texto(x + 1, y, f.id, ln);
  });
};

/**
 * Encabezado del trabajo TSPL. Va UNA vez: la impresora lo recuerda para todas
 * las filas que siguen.
 */
const _encabezadoTspl = (t, formato, op, ctx) => {
  const W = formato.pagina.ancho;
  const H = formato.pagina.alto;
  const continuo = !!formato.rollo?.incluirSeparacion || formato.medio !== 'rollo';
  const gap = continuo ? 0 : Math.max(0, Number(formato.separacion?.y) || 0);

  t.linea(`SIZE ${W} mm,${H} mm`);
  // Con hueco la impresora se realinea en CADA fila con su sensor: un rollo que
  // mide medio milímetro distinto no acumula error. Sin hueco (papel continuo)
  // la página ya trae la separación incluida.
  t.linea(continuo ? 'GAP 0 mm,0 mm' : `GAP ${gap} mm,0 mm`);
  t.linea(`DIRECTION ${op.impresora?.rotacion === 180 ? 0 : 1},0`);
  t.linea('REFERENCE 0,0');
  t.linea('OFFSET 0 mm');
  // El desvío VERTICAL va con SHIFT y no sumado a las coordenadas: si la
  // impresora arranca a imprimir más abajo que el troquel (sensor sin calibrar,
  // hueco distinto al real), subir la impresión exige coordenadas NEGATIVAS, y
  // la impresora las descarta porque su punto 0 ya es su borde. SHIFT mueve la
  // etiqueta entera y acepta negativos. Se manda SIEMPRE (0 incluido) porque la
  // impresora lo recuerda entre trabajos. Reportado con la DIG T451B, 25-sep.
  t.linea(`SHIFT ${ctx.desvioY}`);
  t.linea('SET TEAR ON');
  t.linea('CODEPAGE 850');
  t.linea('DENSITY 8');
  t.linea('SPEED 4');
};

// ─────────────────────────────────────────────────────────────────────────────
// ZPL
// ─────────────────────────────────────────────────────────────────────────────

const _zplTexto = (s) => _limpio(s).replace(/[\^~\\]/g, ' ');

const _zpl = (partes) => {
  const linea = (s) => partes.push(Buffer.from(`${s}\n`, 'utf8'));
  return {
    linea,
    bar: (x, y, w, h) => linea(`^FO${x},${y}^GB${w},${h},${Math.max(1, Math.min(w, h))},B,0^FS`),
    box: (x, y, x2, y2, t) => linea(`^FO${x},${y}^GB${Math.max(1, x2 - x)},${Math.max(1, y2 - y)},${t},B,0^FS`),
  };
};

const _textoZpl = (z, b, ox, oy, k) => {
  const alto = Math.max(10, Math.round(b.size * k));
  const x = Math.round(ox + b.x * k);
  const y = Math.round(oy + b.y * k + Math.max(0, (b.size * 1.18 * k - alto) / 2));
  const ancho = Math.max(1, Math.round(b.w * k));
  const align = b.align === 'center' ? 'C' : (b.align === 'right' ? 'R' : 'L');
  // `^FB` parte y alinea EN la impresora: la fuente 0 es proporcional y aquí no
  // se sabe cuánto mide cada letra.
  z.linea(`^FO${x},${y}^A0N,${alto},${Math.round(alto * 0.9)}^FB${ancho},${b.lineas || 1},0,${align}^FD${_zplTexto(_textoDe(b))}^FS`);
};

const _inicioZpl = (z, formato, op, k, desvioY = 0) => {
  const continuo = !!formato.rollo?.incluirSeparacion || formato.medio !== 'rollo';
  z.linea('^XA');
  z.linea('^CI28');
  z.linea(continuo ? '^MNN' : '^MNY');
  z.linea(`^PW${Math.round(formato.pagina.ancho * MM * k)}`);
  z.linea(`^LL${Math.round(formato.pagina.alto * MM * k)}`);
  z.linea('^LH0,0');
  // Igual que SHIFT en TSPL: ^LT mueve la etiqueta entera, negativo = arriba.
  z.linea(`^LT${Math.max(-120, Math.min(120, desvioY))}`);
  z.linea(op.impresora?.rotacion === 180 ? '^POI' : '^PON');
};

// ─────────────────────────────────────────────────────────────────────────────
// Recorrido de páginas, común a los dos idiomas
// ─────────────────────────────────────────────────────────────────────────────

const _contexto = (formato, op) => {
  const dpi = Number(op.dpi) || DPI_DEFECTO;
  const k = dpi / 72;                       // puntos PDF → puntos del cabezal
  const dx = (Number(op.ajuste?.x) || 0) * MM * k;
  // El vertical NO entra en las coordenadas: va como SHIFT / ^LT (ver el
  // encabezado de TSPL). Topado a una pulgada, el rango del comando.
  const desvioY = Math.max(-dpi, Math.min(dpi, Math.round((Number(op.ajuste?.y) || 0) * MM * k)));
  const dy = 0;
  // El plano se calcula con la resolución REAL del cabezal para que el módulo
  // sea un número entero de puntos, igual que en el PDF con dpi puesto.
  const opPlano = { ...op, dpi };
  return { dpi, k, dx, dy, desvioY, opPlano };
};

/** Dibuja UNA etiqueta con el traductor del idioma. */
const _etiqueta = (lenguaje, out, formato, ctx, indice, item) => {
  const etW = formato.etiqueta.ancho * MM;
  const etH = formato.etiqueta.alto * MM;
  const plano = layout.planear(etW, etH, item, ctx.opPlano);
  const c = layout.celda(formato, indice);
  const ox = c.x * ctx.k + ctx.dx;
  const oy = c.y * ctx.k + ctx.dy;

  if (ctx.opPlano.marco) {
    out.box(Math.round(ox), Math.round(oy), Math.round(ox + etW * ctx.k), Math.round(oy + etH * ctx.k), 1);
  }
  for (const r of _rectsSimbolo(plano.simbolo, ctx.k, plano.puntosModulo)) {
    out.bar(Math.round(ox) + r.x, Math.round(oy) + r.y, r.w, r.h);
  }
  for (const b of plano.bloques) {
    if (lenguaje === 'zpl') _textoZpl(out, b, ox, oy, ctx.k);
    else _textoTspl(out, b, ox, oy, ctx.k, ctx.dpi);
  }
};

/** La casilla de la hoja de prueba: contorno, cruz, número, medida y (en la primera) una regla. */
const _pruebaCelda = (lenguaje, out, formato, ctx, indice, numero, conRegla) => {
  const k = ctx.k;
  const c = layout.celda(formato, indice);
  const x = Math.round(c.x * k + ctx.dx);
  const y = Math.round(c.y * k + ctx.dy);
  const w = Math.round(formato.etiqueta.ancho * MM * k);
  const h = Math.round(formato.etiqueta.alto * MM * k);

  out.box(x, y, x + w, y + h, 2);
  const cx = x + Math.round(w / 2);
  const cy = y + Math.round(h / 2);
  const brazo = Math.round(Math.min(w, h) * 0.12);
  out.bar(cx - brazo, cy - 1, brazo * 2, 2);
  out.bar(cx - 1, cy - brazo, 2, brazo * 2);

  const bloque = (texto, bx, by, bw, size, align = 'left') => ({ texto, x: bx / k, y: by / k, w: bw / k, size, align, lineas: 1 });
  const tam = Math.max(5, Math.min(8, (h / k) / 7));
  const medida = `${String(formato.etiqueta.ancho).replace('.', ',')}x${String(formato.etiqueta.alto).replace('.', ',')}mm`;
  const textos = [bloque(`#${numero}`, x + 6, y + 6, w / 2, tam)];

  const L = conRegla ? layout.largoRegla(formato.etiqueta.ancho) : null;
  if (L) {
    // La regla: una línea de L mm con marcas cada milímetro. Con impresión
    // directa DEBE medir exacto (no hay driver que escale); si no mide, la
    // resolución elegida no es la de la impresora.
    const largo = Math.round(L * (k * MM));
    const xr = x + Math.round((w - largo) / 2);
    const yr = cy + Math.round(Math.min(h * 0.28, 6 * MM * k));
    out.bar(xr, yr, largo, 2);
    for (let m = 0; m <= L; m += 1) {
      const t = Math.round((m % 10 === 0 ? 2.2 : (m % 5 === 0 ? 1.4 : 0.7)) * MM * k);
      out.bar(xr + Math.round(m * MM * k), yr - t, 2, t);
    }
    textos.push(bloque(`${L} mm`, xr, yr + 4, largo, tam * 0.85, 'center'));
  } else {
    textos.push(bloque(medida, x + 6, y + h - Math.round(tam * 1.4 * k) - 6, w - 12, tam * 0.85, 'right'));
  }
  for (const b of textos) {
    if (lenguaje === 'zpl') _textoZpl(out, b, 0, 0, k);
    else _textoTspl(out, b, 0, 0, k, ctx.dpi);
  }
};

/**
 * Genera el trabajo completo.
 *
 * @param {object} p
 * @param {'tspl'|'zpl'} p.lenguaje
 * @param {object[]} p.etiquetas ya expandidas (una por etiqueta física); se ignora con `prueba`
 * @param {object} p.formato
 * @param {object} p.opciones las mismas del PDF (`_opciones` del service)
 * @param {boolean} [p.prueba] hoja de prueba: dos filas con contorno, cruz y regla
 * @returns {Buffer}
 */
const generarComandos = ({ lenguaje = 'tspl', etiquetas = [], formato, opciones: op = {}, prueba = false }) => {
  const partes = [];
  const zpl = lenguaje === 'zpl';
  const out = zpl ? _zpl(partes) : _tspl(partes);
  const ctx = _contexto(formato, op);
  const porPagina = formato.columnas * formato.filas;

  if (!zpl) _encabezadoTspl(out, formato, op, ctx);

  const abrir  = () => (zpl ? _inicioZpl(out, formato, op, ctx.k, ctx.desvioY) : out.linea('CLS'));
  const cerrar = () => out.linea(zpl ? '^PQ1^XZ' : 'PRINT 1,1');

  if (prueba) {
    const paginas = formato.medio === 'rollo' ? 2 : 1;
    let numero = 1;
    for (let pag = 0; pag < paginas; pag += 1) {
      abrir();
      for (let i = 0; i < porPagina; i += 1) {
        _pruebaCelda(lenguaje, out, formato, ctx, i, numero, pag === 0 && i === 0);
        numero += 1;
      }
      cerrar();
    }
    return Buffer.concat(partes);
  }

  const saltar = Math.max(0, Math.min(porPagina - 1, (Number(op.desde) || 1) - 1));
  let celda = saltar;
  let abierta = false;
  for (const item of etiquetas) {
    const indice = celda % porPagina;
    if (indice === 0 && abierta) { cerrar(); abierta = false; }
    if (!abierta) { abrir(); abierta = true; }
    _etiqueta(lenguaje, out, formato, ctx, indice, item);
    celda += 1;
  }
  if (abierta) cerrar();
  return Buffer.concat(partes);
};

module.exports = { generarComandos, _renglones, _cp850, FUENTES_TSPL, DPI_DEFECTO };
