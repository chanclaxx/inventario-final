// ─────────────────────────────────────────────────────────────────────────────
// ETIQUETAS IMPRIMIBLES (código de barras y QR) para productos por cantidad
//
// Un código de barras mal generado NO se ve mal. Se ve perfecto, se imprime
// perfecto, se pega en 400 productos, y no escanea — o peor: escanea otra cosa.
// No hay forma de detectarlo mirando el PDF, así que esta prueba hace lo único
// que sirve: DECODIFICA lo que el generador produce, igual que haría un lector,
// y compara contra el texto original.
//
// Las otras dos cosas que solo se descubren cuando ya se gastó la plancha
// adhesiva —y que por eso se comprueban aquí— son la retícula (¿caen las
// etiquetas sobre el troquel?) y el ancho del módulo (¿es la barra fina lo
// bastante ancha para que el lector la resuelva?).
//
// Las secciones 1-10 son aritmética y geometría puras. Las 11-12 corren el SQL
// contra un Postgres de verdad (PGlite) y se omiten solas si no está instalado.
//
//   node scripts/pruebas-red-interna/35-etiquetas.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');

const code128  = require(path.join(RAIZ, 'src/utils/code128.util'));
const qrUtil   = require(path.join(RAIZ, 'src/utils/qr.util'));
const formatos = require(path.join(RAIZ, 'src/modules/etiquetas/etiquetas.formatos'));
const layout   = require(path.join(RAIZ, 'src/modules/etiquetas/etiquetas.layout'));
const { generarPdfEtiquetas } = require(path.join(RAIZ, 'src/modules/etiquetas/etiquetas.pdf'));

const { MM } = formatos;

let fallos = 0, pasados = 0;
const check = (etiqueta, cond, detalle = '') => {
  if (cond) { pasados++; console.log(`  ✓ ${etiqueta}`); }
  else { fallos++; console.log(`  ✗ ${etiqueta}${detalle ? `\n      ${detalle}` : ''}`); }
};
const checkEq = (etiqueta, real, esperado) =>
  check(etiqueta, JSON.stringify(real) === JSON.stringify(esperado),
    `real      ${JSON.stringify(real)}\n      esperado  ${JSON.stringify(esperado)}`);

// ─────────────────────────────────────────────────────────────────────────────
// EL LECTOR: decodificador Code 128 independiente
//
// Escrito a partir del estándar y NO a partir del codificador: si compartieran
// código, un error compartido pasaría inadvertido. Hace lo mismo que un lector
// láser — mide anchos, los agrupa de a seis, busca el patrón en la tabla,
// verifica el dígito de control y reconstruye el texto siguiendo los cambios de
// juego.
// ─────────────────────────────────────────────────────────────────────────────
const decodificar = (barras) => {
  // El último grupo es el STOP: 7 anchos, así que el troceado de a 6 lo parte.
  // Se reconstruye desde el final, que es como lo hace un lector.
  const stop = barras.slice(barras.length - 7).join('');
  if (stop !== code128.PATRONES[code128.STOP]) throw new Error(`STOP inválido: ${stop}`);

  const cuerpo = barras.slice(0, barras.length - 7);
  if (cuerpo.length % 6 !== 0) throw new Error('El símbolo no es múltiplo de 6 anchos');

  const valores = [];
  for (let i = 0; i < cuerpo.length; i += 6) {
    const patron = cuerpo.slice(i, i + 6).join('');
    const v = code128.PATRONES.indexOf(patron);
    if (v < 0) throw new Error(`Patrón desconocido: ${patron}`);
    valores.push(v);
  }

  // Dígito de control: el penúltimo valor.
  const control = valores.pop();
  let suma = valores[0];
  for (let k = 1; k < valores.length; k += 1) suma += k * valores[k];
  if (suma % 103 !== control) throw new Error(`Dígito de control ${control} ≠ ${suma % 103}`);

  const inicio = valores.shift();
  if (![code128.START_B, code128.START_C].includes(inicio)) throw new Error(`Inicio inválido: ${inicio}`);

  let modo = inicio === code128.START_C ? 'C' : 'B';
  let texto = '';
  for (const v of valores) {
    if (modo === 'C') {
      if (v === code128.CODE_B) { modo = 'B'; continue; }
      if (v > 99) throw new Error(`Valor ${v} imposible en juego C`);
      texto += String(v).padStart(2, '0');
    } else {
      if (v === code128.CODE_C) { modo = 'C'; continue; }
      if (v > 94) throw new Error(`Valor ${v} imposible en juego B`);
      texto += String.fromCharCode(v + 32);
    }
  }
  return texto;
};

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n1. El código de barras se puede volver a leer');
// La comprobación que sostiene toda la feature. Si esto pasa, lo que se imprime
// es lo que está en la base de datos.

const CASOS = [
  '1',                    // un solo carácter
  '12',                   // dos dígitos: el caso límite del arranque en juego C
  '100001',               // el que genera la asignación masiva
  '000001',               // con ceros a la izquierda (por eso la columna es TEXT)
  '1234567',              // corrida impar: gasta un dígito en B y entra a C
  'ABC',                  // solo letras
  'ABC123',               // corrida corta al final: se queda en B
  'SKU-0001',             // el formato que más se escribe a mano
  'A1B2C3D4',             // alternando: nunca conviene el juego C
  'X1234567Y',            // corrida impar EN MEDIO del texto
  'AB123456CD',           // corrida par en medio: sí conviene C
  '0000000012345678',     // 16 dígitos, todo en juego C
  'ITEM.2026/AC:01',      // puntuación del juego B
  'a1b2',                 // minúsculas (el juego B las cubre)
];

for (const texto of CASOS) {
  let leido = null, error = null;
  try { leido = decodificar(code128.codificar(texto).barras); }
  catch (e) { error = e.message; }
  check(`"${texto}" → "${leido ?? error}"`, leido === texto, error || `leído "${leido}"`);
}

// Barrido exhaustivo: todos los códigos numéricos de 1 a 6 dígitos con formas
// distintas, más alfanuméricos aleatorios. Un error de paridad en el cambio de
// juego solo aparece en ciertas longitudes.
{
  const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.';
  let corridas = 0, malas = 0;
  for (let n = 1; n <= 12; n += 1) {
    for (let semilla = 0; semilla < 40; semilla += 1) {
      let t = '';
      for (let k = 0; k < n; k += 1) {
        t += ALFABETO[(semilla * 7 + k * 13 + n * 3) % ALFABETO.length];
      }
      corridas += 1;
      try { if (decodificar(code128.codificar(t).barras) !== t) malas += 1; }
      catch { malas += 1; }
    }
    // Y el mismo largo, solo dígitos: es donde vive el juego C.
    for (let semilla = 0; semilla < 40; semilla += 1) {
      let t = '';
      for (let k = 0; k < n; k += 1) t += String((semilla * 3 + k * 7) % 10);
      corridas += 1;
      try { if (decodificar(code128.codificar(t).barras) !== t) malas += 1; }
      catch { malas += 1; }
    }
  }
  check(`★ barrido de ${corridas} códigos: todos vuelven a leerse igual`, malas === 0, `${malas} fallaron`);
}

console.log('\n2. El juego C es lo que hace que el código quepa');
// No es una optimización cosmética: en una etiqueta de 38 mm, un código numérico
// codificado carácter a carácter da una barra fina por debajo de lo que un
// lector láser resuelve.
{
  const numerico = code128.codificar('12345678').modulos;
  const mixto    = code128.codificar('1234567A').modulos;
  check(`8 dígitos (${numerico} módulos) es más angosto que 7 dígitos + letra (${mixto})`, numerico < mixto);
  checkEq('★ 8 dígitos = inicio + 4 parejas + control + stop', numerico, 11 + 4 * 11 + 11 + 13);
  checkEq('6 dígitos = inicio + 3 parejas + control + stop', code128.codificar('100001').modulos, 11 + 3 * 11 + 11 + 13);
}

console.log('\n3. Lo que Code 128 no puede representar, se dice');
// Un código con eñe o tilde no es codificable, y "aproximarlo" imprimiría algo
// que escanea distinto de lo que está en la base. Se rechaza con mensaje.
for (const malo of ['ÑOÑO', 'CAFÉ-1', 'ABC€']) {
  let msg = null;
  try { code128.codificar(malo); } catch (e) { msg = e.message; }
  check(`"${malo}" se rechaza y sugiere QR`, !!msg && /QR/.test(msg), msg || 'no lanzó');
}
check('en cambio el QR sí los admite (es UTF-8)', qrUtil.codificar('ÑOÑO').lado > 0);

console.log('\n4. El QR sale bien formado');
{
  const { matriz, lado } = qrUtil.codificar('100001');
  check(`versión 1 para un código corto (${lado} módulos)`, lado === 21);
  check('la matriz es cuadrada', matriz.length === lado && matriz.every((f) => f.length === lado));
  // Los tres patrones de posición: un cuadro 7×7 con borde oscuro en cada
  // esquina menos la inferior derecha. Es lo que la cámara busca primero.
  const ojo = (f0, c0) => matriz[f0][c0] && matriz[f0 + 6][c0] && matriz[f0][c0 + 6]
    && !matriz[f0 + 1][c0 + 1] && matriz[f0 + 2][c0 + 2];
  check('★ tiene los tres patrones de posición', ojo(0, 0) && ojo(0, lado - 7) && ojo(lado - 7, 0));

  // El modo compacto importa: numérico ocupa menos que el mismo largo en bytes.
  const num = qrUtil.codificar('1234567890123456789012345').lado;
  const byt = qrUtil.codificar('abcdefghijklmnopqrstuvwxy').lado;
  check(`25 dígitos (${num}) no ocupa más que 25 minúsculas (${byt})`, num <= byt);
}

console.log('\n5. La barra fina tiene que ser lo bastante ancha');
// El aviso que le ahorra al usuario la plancha entera. Es el MISMO cálculo que
// hace el PDF, no una estimación paralela.
{
  const chica = formatos.resolver('a4-5x13');   // 38 × 21 mm, la más pequeña del catálogo
  const plan = (codigo, simbologia) => layout.planear(
    chica.etiqueta.ancho * MM, chica.etiqueta.alto * MM,
    { nombre: 'Producto', codigo, precio: 45000 },
    { simbologia, mostrar: { precio: true } },
  );

  const corto = plan('100001', 'barras');
  check(`un código de 6 dígitos escanea (${corto.moduloMm.toFixed(2)} mm ≥ ${layout.MODULO_MIN_MM})`,
    corto.moduloMm >= layout.MODULO_MIN_MM && !corto.avisos.includes('modulo_estrecho'));

  const largo = plan('SKU-ACCESORIOS-BOGOTA-0001', 'barras');
  check(`★ uno de 26 caracteres AVISA (${largo.moduloMm.toFixed(2)} mm)`,
    largo.avisos.includes('modulo_estrecho'));

  const qr = plan('SKU-ACCESORIOS-BOGOTA-0001', 'qr');
  check(`y en QR el mismo código sí cabe (${qr.moduloMm.toFixed(2)} mm)`,
    !qr.avisos.includes('modulo_estrecho'));
}

console.log('\n6. Cuando no cabe todo, lo que se sacrifica es el TEXTO');
// Nunca el símbolo: una etiqueta con nombre y precio pero con el código
// ilegible no sirve para nada; una con solo el código sí.
{
  const mini = { ancho: 25, alto: 12 };   // más pequeña que cualquier formato real
  const plan = layout.planear(mini.ancho * MM, mini.alto * MM,
    { nombre: 'Producto con un nombre bastante largo', variante_label: 'Talla: XL', codigo: '100001', precio: 45000 },
    { simbologia: 'barras', mostrar: { nombre: true, variante: true, precio: true, encabezado: true }, encabezado: 'MI TIENDA' });

  check('★ el símbolo sigue ahí', !!plan.simbolo && plan.simbolo.barras.length > 0);
  check('★ el código legible NUNCA se cae', plan.bloques.some((b) => b.mono && b.texto === '100001'));
  check('se avisa de cada cosa que se quitó', plan.avisos.some((a) => a.startsWith('sin_espacio_')));
  // El encabezado es decoración; el precio es lo que el cliente busca. Con el
  // orden anterior una tira de 32 × 25 con los dos pedidos salía sin precio.
  checkEq('★ el encabezado es lo primero que se suelta, antes que el precio', plan.avisos[0], 'sin_espacio_encabezado');
  const tira = layout.planear(32 * MM, 25 * MM,
    { nombre: 'Correa silicona reloj', variante_label: '38MM', codigo: '000124', precio: 30000 },
    { simbologia: 'barras', mostrar: { nombre: true, variante: true, precio: true, encabezado: true }, encabezado: 'MI TIENDA' });
  check('★ en la tira de 3 columnas (32 × 25) el precio sobrevive y el encabezado se va',
    tira.bloques.some((b) => b.esPrecio) && tira.avisos.includes('sin_espacio_encabezado'), JSON.stringify(tira.avisos));

  // Y al revés: en una etiqueta grande no se sacrifica nada.
  const grande = formatos.resolver('rollo-100x50');
  const holgado = layout.planear(grande.etiqueta.ancho * MM, grande.etiqueta.alto * MM,
    { nombre: 'Producto', variante_label: 'Talla: XL', codigo: '100001', precio: 45000 },
    { simbologia: 'barras', mostrar: { nombre: true, variante: true, precio: true, encabezado: true }, encabezado: 'MI TIENDA' });
  checkEq('en 100 × 50 mm cabe todo', holgado.avisos, []);
  checkEq('y son cinco bloques de texto', holgado.bloques.length, 5);
}

console.log('\n7. El símbolo cabe DENTRO de la etiqueta, con su zona muda');
// Si el símbolo se sale, pisa la etiqueta de al lado y ninguna de las dos
// escanea. La zona muda es blanco obligatorio: sin ella el lector no encuentra
// dónde empieza el código.
{
  let malos = [];
  for (const f of formatos.FORMATOS) {
    for (const simbologia of ['barras', 'qr']) {
      const w = f.etiqueta.ancho * MM, h = f.etiqueta.alto * MM;
      const p = layout.planear(w, h,
        { nombre: 'Producto de prueba', variante_label: 'Talla: 38MM', codigo: '100042', precio: 45000 },
        { simbologia, mostrar: { nombre: true, variante: true, precio: true } });

      const s = p.simbolo;
      const anchoS = s.tipo === 'barras'
        ? s.barras.reduce((a, b) => a + b, 0) * s.modulo
        : s.lado * s.modulo;
      const altoS = s.tipo === 'barras' ? s.alto : s.lado * s.modulo;

      const quiet = (s.tipo === 'barras' ? layout.QUIET_BARRAS : layout.QUIET_QR) * s.modulo;
      const dentro = s.x - quiet >= -0.01 && s.y >= -0.01
        && s.x + anchoS + quiet <= w + 0.01 && s.y + altoS <= h + 0.01;
      if (!dentro) malos.push(`${f.id}/${simbologia}`);

      // Y todo bloque de texto también.
      for (const b of p.bloques) {
        if (b.x < -0.01 || b.x + b.w > w + 0.01) malos.push(`${f.id}/${simbologia} texto`);
      }
    }
  }
  checkEq(`★ los ${formatos.FORMATOS.length} formatos × 2 simbologías caben`, malos, []);
}

console.log('\n8. La retícula de la plancha');
// La aritmética que decide si las etiquetas caen sobre el troquel. Un error
// aquí no se ve en pantalla: se ve cuando ya se gastó la hoja adhesiva.
{
  let desbordan = [];
  for (const f of formatos.FORMATOS) {
    const ultima = layout.posicionEnHoja(f, f.columnas * f.filas - 1);
    const finX = ultima.x + f.etiqueta.ancho * MM;
    const finY = ultima.y + f.etiqueta.alto  * MM;
    if (finX > f.pagina.ancho * MM + 0.5 || finY > f.pagina.alto * MM + 0.5) {
      desbordan.push(`${f.id} → ${(finX / MM).toFixed(1)} × ${(finY / MM).toFixed(1)} mm`);
    }
  }
  checkEq('★ ninguna casilla se sale de su página', desbordan, []);

  const a4 = formatos.resolver('a4-5x13');
  const c0 = layout.posicionEnHoja(a4, 0);
  const c1 = layout.posicionEnHoja(a4, 1);
  const c5 = layout.posicionEnHoja(a4, 5);
  check('la casilla 0 respeta el margen',
    Math.abs(c0.x - a4.margen.izquierda * MM) < 0.01 && Math.abs(c0.y - a4.margen.arriba * MM) < 0.01);
  check('la siguiente columna avanza ancho + separación',
    Math.abs((c1.x - c0.x) - (a4.etiqueta.ancho + a4.separacion.x) * MM) < 0.01);
  check('la casilla 5 (fila 2, columna 1) baja de fila y vuelve al margen',
    Math.abs(c5.x - c0.x) < 0.01 && c5.y > c0.y);

  // Calibración: el desvío mueve TODA la retícula, no la deforma.
  const aj = layout.posicionEnHoja(a4, 7, { x: 1.5, y: -2 });
  const sin = layout.posicionEnHoja(a4, 7);
  check('★ el ajuste de impresora desplaza la retícula entera',
    Math.abs((aj.x - sin.x) - 1.5 * MM) < 0.01 && Math.abs((aj.y - sin.y) + 2 * MM) < 0.01);
}

console.log('\n9. Formato a medida: se valida la geometría, no el gusto');
{
  const ok = formatos.resolver('personalizado', { medio: 'hoja', ancho: 50, alto: 30, columnas: 4, filas: 9, margen: { arriba: 5, izquierda: 4 } });
  checkEq('4 × 9 de 50 × 30 mm cabe en A4', ok.porHoja, 36);

  const intentar = (p) => { try { formatos.resolver('personalizado', p); return null; } catch (e) { return e.message; } };
  check('★ una retícula que NO cabe se rechaza con las medidas',
    /no cabe/i.test(intentar({ medio: 'hoja', ancho: 80, alto: 30, columnas: 4, filas: 9 }) || ''));
  check('una etiqueta de 2 mm se rechaza',
    /menos de/i.test(intentar({ medio: 'rollo', ancho: 2, alto: 2 }) || ''));
  check('un formato desconocido se rechaza',
    (() => { try { formatos.resolver('inventado'); return false; } catch (e) { return /desconocido/.test(e.message); } })());
}

console.log('\n10. El PDF se genera de verdad, en todos los formatos');
// Que el plano sea correcto no basta: pdfkit tiene que poder ejecutarlo. Aquí se
// atrapó el fallo de `desde > 1`, que dejaba el documento sin ninguna página.
{
  const items = [
    { nombre: 'Correa silicona reloj deportivo', variante_label: 'Talla: 38MM', codigo: '100042', precio: '45000.00' },
    { nombre: 'Cargador 3DS', variante_label: null, codigo: '100043', precio: '22000.00' },
    { nombre: 'Gafas polarizadas aviador clásico', variante_label: 'Color: Negro / M', codigo: '100044', precio: '89900.00' },
  ];

  const generar = (formato, opciones, n) => new Promise((ok, ko) => {
    const trozos = [];
    const falso = {
      setHeader: () => {},
      write: (c) => { trozos.push(Buffer.from(c)); return true; },
      end:   () => ok(Buffer.concat(trozos)),
      on: () => {}, once: () => {}, emit: () => {}, removeListener: () => {},
    };
    const etiquetas = Array.from({ length: n }, (_, i) => items[i % items.length]);
    try { generarPdfEtiquetas({ etiquetas, formato, opciones, res: falso }); } catch (e) { ko(e); }
  });

  let malos = [];
  for (const f of formatos.FORMATOS) {
    for (const simbologia of ['barras', 'qr']) {
      // `desde: 3` a propósito: empezar en media plancha es el caso que rompía.
      const buf = await generar(f, { simbologia, desde: 3, marco: true,
        mostrar: { nombre: true, variante: true, precio: true } }, 8);
      const cabecera = buf.subarray(0, 5).toString('latin1');
      if (cabecera !== '%PDF-' || buf.length < 500) malos.push(`${f.id}/${simbologia} (${buf.length} B)`);
    }
  }
  checkEq(`★ ${formatos.FORMATOS.length * 2} PDF generados sin reventar`, malos, []);

  const vacio = await generar(formatos.resolver('a4-5x13'), { simbologia: 'barras' }, 0);
  check('sin etiquetas sale una hoja que EXPLICA por qué, no un PDF en blanco',
    vacio.subarray(0, 5).toString('latin1') === '%PDF-' && vacio.length > 500);
}

// ─────────────────────────────────────────────────────────────────────────────
// Herramientas para medir el PDF DE VERDAD
//
// `trazos` instrumenta pdfkit y anota, de cada rectángulo que se dibuja, dónde
// cae en la PÁGINA FÍSICA —aplicando la matriz de transformación vigente, que
// es lo que hace el visor y lo que hace el driver de la impresora—. Así se
// comprueba el giro, la escala y el desvío sobre el mismo código que imprime,
// no sobre una copia de la aritmética.
// ─────────────────────────────────────────────────────────────────────────────
const PDFDocument = require('pdfkit');
const { generarPdfPrueba, largoRegla } = require(path.join(RAIZ, 'src/modules/etiquetas/etiquetas.pdf'));

const resFalso = (ok) => {
  const trozos = [];
  return {
    setHeader: () => {},
    write: (c) => { trozos.push(Buffer.from(c)); return true; },
    end:   () => ok(Buffer.concat(trozos)),
    on: () => {}, once: () => {}, emit: () => {}, removeListener: () => {},
  };
};
const pdfEtiquetas = (formato, opciones, etiquetas) => new Promise((ok, ko) => {
  try { generarPdfEtiquetas({ etiquetas, formato, opciones, res: resFalso(ok) }); } catch (e) { ko(e); }
});
const pdfPrueba = (formato, opciones) => new Promise((ok, ko) => {
  try { generarPdfPrueba({ formato, opciones, res: resFalso(ok) }); } catch (e) { ko(e); }
});
const paginasDe = (buf) => (buf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) || []).length;

// `_ctm` de pdfkit incluye el volteo de la página: lleva al espacio NATIVO del
// PDF, con el origen ABAJO. Aquí se devuelve a «desde arriba», que es como mide
// una persona con la regla sobre el papel.
const trazos = async (generador) => {
  const original = PDFDocument.prototype.rect;
  const lista = [];
  PDFDocument.prototype.rect = function (x, y, w, h) {
    const m = this._ctm;
    const xs = [], ys = [];
    for (const px of [x, x + w]) for (const py of [y, y + h]) {
      xs.push(m[0] * px + m[2] * py + m[4]);
      ys.push(this.page.height - (m[1] * px + m[3] * py + m[5]));
    }
    lista.push({
      x1: Math.min(...xs) / MM, x2: Math.max(...xs) / MM,
      y1: Math.min(...ys) / MM, y2: Math.max(...ys) / MM,
      w: w / MM, h: h / MM,
      pagW: this.page.width / MM, pagH: this.page.height / MM,
    });
    return original.call(this, x, y, w, h);
  };
  try { await generador(); } finally { PDFDocument.prototype.rect = original; }
  return lista;
};
const cerca = (a, b, tol = 0.15) => Math.abs(a - b) <= tol;
const ITEM = { nombre: 'Correa silicona', variante_label: '38MM', codigo: '100042', precio: '45000.00' };

console.log('\n13. Rollos de VARIAS columnas: la página es una fila del rollo');
// El caso que se reportó: una tira de 3 columnas no había forma de cuadrarla.
// La versión anterior solo sabía hacer rollos de 1 columna y el formato a
// medida no dejaba decir el ancho del rollo, los márgenes ni la separación.
{
  const r3 = formatos.resolver('rollo3-32x25');
  checkEq('★ la página mide lo que el rollo: 104 × 25 mm', [r3.pagina.ancho, r3.pagina.alto], [104, 25]);
  checkEq('tres etiquetas por página (una fila)', r3.porHoja, 3);
  const xs = [0, 1, 2].map((i) => Number((layout.celda(r3, i).x / MM).toFixed(2)));
  checkEq('★ centradas sobre el rollo, con 2 mm entre columnas', xs, [2, 36, 70]);
  checkEq('la última termina a 2 mm del borde', Number((xs[2] + 32).toFixed(2)), 102);

  const pers = (p) => formatos.construirPersonalizado({ medio: 'rollo', ancho: 32, alto: 25, columnas: 3, separacion: { x: 2, y: 3 }, ...p });
  const centrado = pers({ anchoRollo: 106 });
  checkEq('a medida: sin margen, se centra (106 − 100) / 2', centrado.margen.izquierda, 3);
  checkEq('a medida: margen escrito a mano', pers({ anchoRollo: 106, margen: { izquierda: 1.5 } }).margen.izquierda, 1.5);
  checkEq('sin ancho de rollo: retícula + margen a cada lado', pers({ margen: { izquierda: 1 } }).pagina.ancho, 102);

  let msg = null;
  try { pers({ anchoRollo: 90 }); } catch (e) { msg = e.message; }
  check('★ si no caben, lo dice con las medidas', /no caben en el rollo/i.test(msg || '') && /90/.test(msg || ''), msg || 'no lanzó');

  checkEq('papel continuo (sin sensor de hueco): la página incluye la separación',
    pers({ anchoRollo: 104, incluirSeparacion: true }).pagina.alto, 28);
  const tresFilas = pers({ anchoRollo: 104, filasPorPagina: 3 });
  checkEq('varias filas por página: 3 × 25 + 2 × 3', tresFilas.pagina.alto, 81);
  checkEq('y la fila 2 empieza después del hueco', Number((layout.celda(tresFilas, 3).y / MM).toFixed(2)), 28);
  checkEq('con una columna la separación horizontal no cuenta',
    formatos.construirPersonalizado({ medio: 'rollo', ancho: 50, alto: 25, separacion: { x: 9 } }).pagina.ancho, 50);
}

console.log('\n14. Hojas a medida: cualquier papel, márgenes centrados si no se miden');
{
  const hojaA = (p) => formatos.construirPersonalizado({ medio: 'hoja', ...p });
  const a4 = hojaA({ papel: 'a4', ancho: 70, alto: 37, columnas: 3, filas: 8 });
  checkEq('A4 3 × 8 de 70 × 37 centrado = el formato del catálogo',
    [a4.margen.izquierda, a4.margen.arriba], [formatos.resolver('a4-3x8').margen.izquierda, formatos.resolver('a4-3x8').margen.arriba]);
  const carta = hojaA({ papel: 'carta', ancho: 101.6, alto: 50.8, columnas: 2, filas: 5, separacion: { x: 4.76 } });
  checkEq('Carta 2 × 5 centrada = la referencia de papelería', carta.margen.izquierda, 3.97);
  checkEq('Oficio es de 330 mm', hojaA({ papel: 'oficio', ancho: 70, alto: 27, columnas: 3, filas: 12 }).pagina.alto, 330.2);
  checkEq('papel de cualquier medida',
    hojaA({ papel: 'personalizado', pagina: { ancho: 100, alto: 150 }, ancho: 45, alto: 35, columnas: 2, filas: 4 }).porHoja, 8);
  const cat = formatos.catalogo();
  checkEq('el catálogo trae formatos, papeles y topes',
    [Array.isArray(cat.formatos), cat.papeles.map((p) => p.id), typeof cat.limites.maxColumnas],
    [true, ['a4', 'carta', 'oficio', 'a5'], 'number']);
}

console.log('\n15. Calibración: giro, escala y desvío — medidos sobre el PDF de verdad');
{
  const r3 = formatos.resolver('rollo3-32x25');
  const tres = [ITEM, ITEM, ITEM];
  // El marco dibuja un rectángulo de (ancho − 0,5 pt) × (alto − 0,5 pt) por etiqueta:
  // es la forma de encontrar cada etiqueta entre los cientos de barras.
  const marcos = (lista) => lista.filter((t) =>
    cerca(t.w, (32 * MM - 0.5) / MM, 0.01) && cerca(t.h, (25 * MM - 0.5) / MM, 0.01));
  const medir = async (impresora, extra = {}) =>
    trazos(() => pdfEtiquetas(r3, { simbologia: 'barras', marco: true, impresora, ...extra }, tres));

  const g0 = await medir({ rotacion: 0 });
  const m0 = marcos(g0);
  checkEq('sin giro: página 104 × 25', [g0[0].pagW, g0[0].pagH].map((n) => Number(n.toFixed(2))), [104, 25]);
  check('sin giro: la etiqueta 1 cae en x 2–34 mm', cerca(m0[0].x1, 2.09) && cerca(m0[0].x2, 33.91), JSON.stringify(m0[0]));

  // 90 y 270 ya no existen: Chrome/Edge giran solos toda página cruzada con el
  // papel del driver, así que intercambiar ancho y alto se deshacía al imprimir
  // (y la pantalla mandaba a crear un papel de 25 × 104 que hace saltar
  // etiquetas en una térmica). Un valor viejo guardado tiene que caer a 0.
  for (const rotacion of [90, 270]) {
    const g = await medir({ rotacion });
    const m = marcos(g);
    checkEq(`★ ${rotacion}° (valor viejo) se ignora: la página sigue siendo 104 × 25`,
      [g[0].pagW, g[0].pagH].map((n) => Number(n.toFixed(2))), [104, 25]);
    check(`${rotacion}° (valor viejo): la etiqueta 1 cae donde sin giro`, cerca(m[0].x1, 2.09) && cerca(m[0].x2, 33.91), JSON.stringify(m[0]));
  }

  const g180 = await medir({ rotacion: 180 });
  const m180 = marcos(g180);
  checkEq('180° conserva el tamaño de la página (no la cruza con el papel)',
    [g180[0].pagW, g180[0].pagH].map((n) => Number(n.toFixed(2))), [104, 25]);
  check('★ de cabeza (180°): la etiqueta 1 pasa al extremo derecho (x 70–102)', cerca(m180[0].x1, 70.09) && cerca(m180[0].x2, 101.91), JSON.stringify(m180[0]));

  let fuera = [];
  for (const rotacion of [0, 180]) {
    for (const t of await medir({ rotacion })) {
      if (t.x1 < -0.01 || t.y1 < -0.01 || t.x2 > t.pagW + 0.01 || t.y2 > t.pagH + 0.01) fuera.push(`${rotacion}°`);
    }
  }
  checkEq('★ normal y de cabeza, ni una barra cae fuera de la página física', [...new Set(fuera)], []);

  const ms = marcos(await medir({ rotacion: 0, escala: 102 }, { ajuste: { x: 1, y: -0.5 } }));
  check('★ escala 102 % y desvío (1, −0,5): la etiqueta 1 empieza en 2 × 1,02 + 1 mm',
    cerca(ms[0].x1, 0.088 * 1.02 + 2 * 1.02 + 1, 0.05) && cerca(ms[0].x2 - ms[0].x1, (32 - 0.176) * 1.02, 0.05),
    JSON.stringify(ms[0]));

  // Con la página volteada, "el borde" para pdfkit ya no es el de la etiqueta: si
  // algún texto se saliera de su alto fijo, pdfkit abriría páginas de más.
  const a4 = formatos.resolver('a4-3x8');
  const buf = await pdfEtiquetas(a4, { simbologia: 'barras', impresora: { rotacion: 180 },
    mostrar: { nombre: true, variante: true, precio: true } }, Array.from({ length: 30 }, () => ITEM));
  checkEq('★ A4 girada: 30 etiquetas = 2 páginas, ni una más', paginasDe(buf), 2);
}

console.log('\n16. Resolución de la impresora: el módulo cae en puntos ENTEROS del cabezal');
// Una térmica de 203 dpi pinta en pasos de 0,125 mm. Un módulo de 0,28 mm son
// 2,24 puntos y el driver redondea cada barra a 2 o a 3: barras que deberían
// medir igual salen distintas. Con el módulo en puntos enteros, todas iguales.
{
  const w = 32 * MM, h = 25 * MM;
  for (const dpi of [203, 300]) {
    const p = layout.planear(w, h, ITEM, { simbologia: 'barras', dpi });
    const puntos = p.moduloMm * dpi / 25.4;
    check(`${dpi} dpi: el módulo son ${p.puntosModulo} puntos exactos (${p.moduloMm.toFixed(4)} mm)`,
      Number.isInteger(p.puntosModulo) && Math.abs(puntos - p.puntosModulo) < 1e-6);
    check(`${dpi} dpi: y sigue leyéndose igual`, decodificar(p.simbolo.barras) === ITEM.codigo);
    const q = layout.QUIET_BARRAS * p.simbolo.modulo;
    check(`${dpi} dpi: con su zona muda dentro de la etiqueta`,
      p.simbolo.x - q >= -0.01 && p.simbolo.x + p.simbolo.ancho + q <= w + 0.01);
  }
  check('sin resolución no se ajusta nada', layout.planear(w, h, ITEM, { simbologia: 'barras' }).puntosModulo === null);
  const imposible = layout.planear(20 * MM, 12 * MM, { ...ITEM, codigo: 'SKU-ACCESORIOS-BOGOTA-0001' },
    { simbologia: 'barras', dpi: 203 });
  check('★ si ni un punto por módulo cabe, se AVISA en vez de fingir',
    imposible.avisos.includes('resolucion_insuficiente') && imposible.avisos.includes('modulo_estrecho'));
}

console.log('\n17. La zona muda puede ocupar el margen interior');
// La zona muda es blanco, no tinta. Contarla DENTRO del área útil encogía el
// módulo un 10 % en las etiquetas pequeñas, que son las que están al límite.
{
  const f = formatos.resolver('a4-5x13');
  const w = f.etiqueta.ancho * MM, h = f.etiqueta.alto * MM;
  const p = layout.planear(w, h, { ...ITEM, codigo: '100001' }, { simbologia: 'barras' });
  const util = (w - 2 * p.pad) / MM;
  const modulos = code128.codificar('100001').modulos;
  check(`★ módulo ${p.moduloMm.toFixed(3)} mm > ${(util / (modulos + 20)).toFixed(3)} mm de la regla anterior`,
    p.moduloMm > util / (modulos + 20) + 0.01);
  const q = layout.QUIET_BARRAS * p.simbolo.modulo;
  check('y la zona muda sigue dentro de la etiqueta', p.simbolo.x - q >= -0.01 && p.simbolo.x + p.simbolo.ancho + q <= w + 0.01);
  check('las barras, dentro del área útil', p.simbolo.x >= p.pad - 0.01 && p.simbolo.x + p.simbolo.ancho <= w - p.pad + 0.01);

  // Y el techo: en una etiqueta de 100 mm el código ya no se estira a 10 cm,
  // que un lector de mano no alcanza a barrer entero.
  const ancha = layout.planear(100 * MM, 50 * MM, { ...ITEM, codigo: '100001' }, { simbologia: 'barras' });
  check(`★ en 100 × 50 el módulo se queda en ${ancha.moduloMm.toFixed(2)} mm (techo ${layout.MODULO_MAX_MM})`,
    ancha.moduloMm <= layout.MODULO_MAX_MM + 1e-9);
  check('y el símbolo queda centrado', cerca((ancha.simbolo.x + ancha.simbolo.ancho / 2) / MM, 50, 0.01));
}

console.log('\n18. El diseño se ajusta: letra, renglones, alineación, alto del símbolo, pie');
{
  const w = 100 * MM, h = 50 * MM;
  const base = { simbologia: 'barras', mostrar: { nombre: true, variante: true, precio: true } };
  const nombreDe = (p) => p.bloques.find((b) => b.bold && !b.esPrecio);
  const normal = layout.planear(w, h, ITEM, base);
  const grande = layout.planear(w, h, ITEM, { ...base, diseno: { escalaTexto: 1.3 } });
  check('letra al 130 %', cerca(nombreDe(grande).size, nombreDe(normal).size * 1.3, 0.01));
  checkEq('tres renglones para el nombre', nombreDe(layout.planear(w, h, ITEM, { ...base, diseno: { lineasNombre: 3 } })).lineas, 3);

  const izq = layout.planear(w, h, ITEM, { ...base, diseno: { alinear: 'izquierda' } });
  check('alineado a la izquierda', izq.bloques.every((b) => b.align === 'left'));

  const tope = layout.planear(w, h, ITEM, { ...base, diseno: { altoSimbolo: 8 } });
  check('★ alto de barras a mano: 8 mm', cerca(tope.simbolo.alto / MM, 8, 0.01));
  check('y el bloque queda centrado, no pegado arriba', tope.bloques[0].y > tope.pad + MM);

  const conPie = layout.planear(38 * MM, 21 * MM, ITEM,
    { ...base, mostrar: { ...base.mostrar, pie: true }, pie: 'Garantía 3 meses' });
  checkEq('★ en una etiqueta chica el pie es lo PRIMERO que se suelta', conPie.avisos[0], 'sin_espacio_pie');
  const pieHolgado = layout.planear(w, h, ITEM, { ...base, mostrar: { ...base.mostrar, pie: true }, pie: 'Garantía 3 meses' });
  checkEq('en una grande el pie va al final', pieHolgado.bloques.at(-1).texto, 'Garantía 3 meses');

  checkEq('margen interior a mano: 0', layout.planear(w, h, ITEM, { ...base, diseno: { margenInterior: 0 } }).pad, 0);
  check('margen interior a mano: 5 mm', cerca(layout.planear(w, h, ITEM, { ...base, diseno: { margenInterior: 5 } }).pad / MM, 5, 0.001));
  check('un margen absurdo no se come la etiqueta (tope: ¼ del lado corto)',
    layout.planear(20 * MM, 12 * MM, ITEM, { ...base, diseno: { margenInterior: 8 } }).pad <= 3 * MM + 0.01);
}

console.log('\n19. La hoja de prueba de alineación');
{
  checkEq('la regla más larga que cabe', [largoRegla(32), largoRegla(50), largoRegla(100), largoRegla(11)], [30, 40, 80, null]);
  let malos = [];
  for (const f of formatos.FORMATOS) {
    for (const rotacion of [0, 180]) {
      const buf = await pdfPrueba(f, { impresora: { rotacion } });
      const esperadas = f.medio === 'rollo' ? 2 : 1;
      if (buf.subarray(0, 5).toString('latin1') !== '%PDF-' || paginasDe(buf) !== esperadas) {
        malos.push(`${f.id}/${rotacion}° (${paginasDe(buf)} pág.)`);
      }
    }
  }
  checkEq(`★ ${formatos.FORMATOS.length * 2} hojas de prueba: una página por plancha, dos por rollo`, malos, []);

  const r3 = formatos.resolver('rollo3-32x25');
  const t = await trazos(() => pdfPrueba(r3, { impresora: { rotacion: 0 } }));
  const contornos = t.filter((x) => cerca(x.w, 32, 0.01) && cerca(x.h, 25, 0.01));
  checkEq('★ la prueba dibuja el contorno EXACTO de cada etiqueta (3 por fila × 2 filas)', contornos.length, 6);
  check('en el mismo sitio donde caerán las etiquetas', cerca(contornos[0].x1, 2) && cerca(contornos[2].x1, 70));
}


// ═════════════════════════════════════════════════════════════════════════════
// Secciones contra Postgres de verdad (PGlite).
//
// Lo de arriba es aritmética y geometría; esto es SQL, y el SQL solo falla al
// ejecutarse. Un UNION con las columnas descuadradas, un nombre de columna que
// no existe o —lo que ya pasó una vez— una comilla invertida dentro de un
// comentario SQL que cierra el template literal de JS a media consulta, no se
// ven leyendo el archivo: se ven cuando el backend ya no arranca.
// ═════════════════════════════════════════════════════════════════════════════
let PGlite = null;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { /* sin pglite */ }

if (!PGlite) {
  console.log('\n11-12. omitidas — falta @electric-sql/pglite  (pnpm add -D @electric-sql/pglite)');
} else {
  const { readFileSync } = await import('node:fs');
  const db = new PGlite();
  await db.exec(readFileSync(path.join(AQUI, 'esquema.sql'), 'utf8'));

  const conectar = (t) => ({ query: (sql, p) => t.query(sql, p ?? []) });
  const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
  require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] = {
    id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} },
  };

  const repo    = require(path.join(RAIZ, 'src/modules/etiquetas/etiquetas.repository'));
  const service = require(path.join(RAIZ, 'src/modules/etiquetas/etiquetas.service'));
  const q = async (sql, p = []) => (await db.query(sql, p)).rows;

  // Negocio 1: dos sedes. Negocio 2: ajeno, para probar el aislamiento.
  await db.exec(`
    INSERT INTO negocios (nombre) VALUES ('Bodega Central'), ('Ajeno');
    INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Principal'), (1,'Sur'), (2,'De otro');
    INSERT INTO lineas_producto (negocio_id, nombre) VALUES (1,'Accesorios');
    INSERT INTO config_negocio (negocio_id, clave, valor) VALUES (1,'codigo_producto_activo','1');

    -- Sede 1
    INSERT INTO productos_cantidad (nombre, sucursal_id, linea_id, codigo, stock, precio) VALUES
      ('Cargador', 1, 1, '100001', 5, 20000),
      ('Correa',   1, 1, NULL,     7, 30000),
      ('Gafas',    1, NULL, NULL,  3, 90000);
    INSERT INTO atributos_producto (producto_id, sucursal_id, valor, codigo, stock, precio) VALUES
      (2, 1, '38MM', '100002', 3, NULL),
      (2, 1, '42MM', NULL,     0, 35000),
      (3, 1, 'Negro', NULL,    3, NULL);
    INSERT INTO variantes_atributo (atributo_id, valor, codigo, stock) VALUES
      (3, 'M', '100003', 2),
      (3, 'L', NULL,     1);

    -- Sede 2 del MISMO negocio: los mismos nodos lógicos, todavía sin código.
    INSERT INTO productos_cantidad (nombre, sucursal_id, codigo, stock, precio) VALUES
      ('Cargador', 2, NULL, 4, 20000),
      ('Correa',   2, NULL, 6, 30000);
    INSERT INTO atributos_producto (producto_id, sucursal_id, valor, codigo, stock) VALUES
      (5, 2, '42MM', NULL, 9);

    -- Negocio ajeno
    INSERT INTO productos_cantidad (nombre, sucursal_id, codigo, stock) VALUES
      ('Cargador', 3, '999999', 1);
  `);

  console.log('\n11. La consulta de nodos etiquetables');

  const etiqueta = (n) => n.nombre + (n.variante_label ? ' · ' + n.variante_label : '');
  const nodos = await repo.listarNodos(1, 1, {});

  checkEq('★ solo salen las HOJAS, nunca los contenedores',
    nodos.map(etiqueta).sort(),
    ['Cargador', 'Correa · 38MM', 'Correa · 42MM', 'Gafas · Negro / L', 'Gafas · Negro / M']);

  const porEtiqueta = Object.fromEntries(nodos.map((n) => [etiqueta(n), n]));
  checkEq('el precio se hereda del padre cuando el nodo no tiene',
    Number(porEtiqueta['Correa · 38MM'].precio), 30000);
  checkEq('y el propio manda sobre el del padre',
    Number(porEtiqueta['Correa · 42MM'].precio), 35000);

  const m = porEtiqueta['Gafas · Negro / M'];
  checkEq('★ la identidad lógica viaja en columnas separadas',
    [m.nivel, m.atributo_valor, m.variante_valor], ['variante', 'Negro', 'M']);
  checkEq('la línea acompaña al nodo', porEtiqueta['Correa · 38MM'].linea_nombre, 'Accesorios');

  checkEq('filtro "sin código"',
    (await repo.listarNodos(1, 1, { codigo: 'sin' })).map(etiqueta).sort(),
    ['Correa · 42MM', 'Gafas · Negro / L']);
  checkEq('filtro "solo con stock"',
    (await repo.listarNodos(1, 1, { soloConStock: true })).map(etiqueta).sort(),
    ['Cargador', 'Correa · 38MM', 'Gafas · Negro / L', 'Gafas · Negro / M']);
  checkEq('filtro por línea',
    (await repo.listarNodos(1, 1, { lineaId: 1 })).map(etiqueta).sort(),
    ['Cargador', 'Correa · 38MM', 'Correa · 42MM']);
  checkEq('búsqueda por código',
    (await repo.listarNodos(1, 1, { q: '100002' })).map(etiqueta), ['Correa · 38MM']);
  checkEq('la otra sede no se mezcla',
    (await repo.listarNodos(1, 2, {})).map(etiqueta).sort(), ['Cargador', 'Correa · 42MM']);

  // El aislamiento entre negocios es lo que impide que una selección manipulada
  // saque nodos ajenos: la consulta filtra por negocio_id y no confía en los ids.
  checkEq('★ una selección con un id de OTRO negocio no devuelve nada',
    await repo.nodosPorSeleccion(1, 1, [{ nivel: 'producto', producto_id: 6 }]), []);

  const ctx = await repo.contextoImpresion(1, 1);
  checkEq('el encabezado sale de la sucursal del negocio', ctx.sucursal_nombre, 'Principal');
  checkEq('y una sucursal ajena no se resuelve', await repo.contextoImpresion(1, 3), null);

  console.log('\n12. Generación masiva de códigos');

  const idsDe = (lista) => lista.map((n) => ({
    nivel: n.nivel, producto_id: n.producto_id,
    atributo_id: n.atributo_id, variante_id: n.variante_id,
  }));
  const codigosDe = async (suc) =>
    (await repo.listarNodos(1, suc, {})).map((n) => [etiqueta(n), n.codigo]);

  const r1 = await service.generarCodigos(1, 1, {
    seleccion: idsDe(await repo.listarNodos(1, 1, { codigo: 'sin' })), longitud: 6,
  });
  checkEq('se asignan los dos que faltaban', r1.asignados, 2);

  checkEq('★ los códigos nuevos continúan la numeración (el máximo era 100003)',
    (await codigosDe(1)).map(([, c]) => c).sort(),
    ['100001', '100002', '100003', '100004', '100005']);
  checkEq('★ NINGÚN código existente se pisó',
    (await codigosDe(1)).filter(([e]) => ['Cargador', 'Correa · 38MM', 'Gafas · Negro / M'].includes(e)).sort(),
    [['Cargador', '100001'], ['Correa · 38MM', '100002'], ['Gafas · Negro / M', '100003']]);

  const [{ ultimo_numero: contador }] = await q(
    "SELECT ultimo_numero FROM contadores_documento WHERE negocio_id = 1 AND tipo = 'codigo_producto'");
  checkEq('el contador del negocio queda en el último repartido', Number(contador), 100005);

  // El mismo nodo lógico en la otra sede lleva el mismo código a propósito, o el
  // lector deja de funcionar allá.
  checkEq('★ el mismo nodo en la otra sede recibió el MISMO código',
    (await codigosDe(2)).find(([e]) => e === 'Correa · 42MM')[1],
    (await codigosDe(1)).find(([e]) => e === 'Correa · 42MM')[1]);

  // Y al revés: generar en la otra sede HEREDA lo que ya existe en la primera,
  // en vez de quemar un número nuevo para el mismo producto.
  await service.generarCodigos(1, 2, {
    seleccion: idsDe(await repo.listarNodos(1, 2, { codigo: 'sin' })), longitud: 6,
  });
  checkEq('★ el Cargador de la otra sede HEREDA 100001, no inventa uno nuevo',
    (await codigosDe(2)).find(([e]) => e === 'Cargador')[1], '100001');

  // Volver a correr no puede hacer nada: es lo que garantiza que pulsar el botón
  // dos veces no invalide una etiqueta ya pegada al producto.
  const r2 = await service.generarCodigos(1, 1, { seleccion: idsDe(await repo.listarNodos(1, 1, {})), longitud: 6 });
  checkEq('★ una segunda pasada no cambia nada', [r2.asignados, r2.omitidos], [0, 5]);

  // Un código = un nodo por sucursal, y la regla cruza los TRES niveles (la BD
  // solo puede garantizarla dentro de cada tabla).
  const { buscarCodigoEnUso } = require(path.join(RAIZ, 'src/utils/codigo.util'));
  let choques = 0;
  for (const [, codigo] of await codigosDe(1)) {
    if ((await buscarCodigoEnUso(null, { sucursalId: 1, codigo })).length !== 1) choques += 1;
  }
  checkEq('★ ningún código quedó repetido entre los tres niveles', choques, 0);

  // Y lo que se genera tiene que poder imprimirse: numérico puro, que es lo que
  // deja el código de barras más angosto.
  let noImprimibles = 0;
  for (const [, codigo] of await codigosDe(1)) if (!code128.esImprimible(codigo)) noImprimibles += 1;
  checkEq('★ todo código generado es imprimible como código de barras', noImprimibles, 0);

  // La feature es opt-in: apagada, ni siquiera se puede generar.
  await db.exec("UPDATE config_negocio SET valor = '0' WHERE negocio_id = 1 AND clave = 'codigo_producto_activo'");
  let mensaje = null;
  try { await service.generarCodigos(1, 1, { seleccion: idsDe(await repo.listarNodos(1, 1, {})) }); }
  catch (e) { mensaje = e.message; }
  check('con la feature apagada se rechaza y dice qué activar', /Ajustes/.test(mensaje || ''), mensaje || 'no lanzó');

  console.log('\n20. El plan de la pantalla: geometría, avisos y hoja de prueba');

  // SIN selección: el editor de formato necesita la retícula mientras el
  // usuario mide su rollo, antes de marcar un solo producto.
  const g = await service.planear(1, 1, { formato: 'rollo3-32x25', seleccion: [] });
  checkEq('★ sin productos marcados igual responde la geometría', [g.total, g.geometria.celdas.length], [0, 3]);
  checkEq('papel que va en la impresora: 104 × 25', [g.geometria.papel.ancho, g.geometria.papel.alto], [104, 25]);
  const g90 = await service.planear(1, 1, { formato: 'rollo3-32x25', impresora: { rotacion: 90 } });
  checkEq('★ un 90° guardado ya no cruza el papel: sigue 104 × 25 y sin giro',
    [g90.geometria.papel.ancho, g90.geometria.papel.alto, g90.geometria.papel.rotacion], [104, 25, 0]);

  // El caso reportado con la DIG T451B: 3 × 3 de 30 × 25 en un rollo de 100,
  // armado como UNA página de 3 filas. Con sensor de hueco eso salta filas.
  const tresFilas = { medio: 'rollo', ancho: 30, alto: 25, columnas: 3, separacion: { x: 3, y: 0 }, anchoRollo: 100 };
  const mal = await service.planear(1, 1, { formato: 'personalizado', personalizado: { ...tresFilas, filasPorPagina: 3 } });
  check('★ rollo con 3 filas por página y sensor de hueco: se avisa', mal.avisos.includes('rollo_varias_filas'), JSON.stringify(mal.avisos));
  const bien = await service.planear(1, 1, { formato: 'personalizado', personalizado: { ...tresFilas, filasPorPagina: 1 } });
  checkEq('con 1 fila por página no hay aviso y el papel es 100 × 25',
    [bien.avisos, bien.geometria.papel.ancho, bien.geometria.papel.alto], [[], 100, 25]);
  const continuo = await service.planear(1, 1, { formato: 'personalizado',
    personalizado: { ...tresFilas, filasPorPagina: 3, incluirSeparacion: true } });
  check('en papel continuo varias filas son legítimas: sin aviso', !continuo.avisos.includes('rollo_varias_filas'));
  const preset = await service.planear(1, 1, { formato: 'rollo3-30x25' });
  checkEq('el formato del catálogo para ese rollo: 100 × 25, 3 columnas, sin avisos',
    [preset.geometria.papel.ancho, preset.geometria.papel.alto, preset.geometria.columnas, preset.avisos], [100, 25, 3, []]);

  const ancho = await service.planear(1, 1, { formato: 'personalizado',
    personalizado: { medio: 'rollo', ancho: 40, alto: 25, columnas: 3, separacion: { x: 3 }, anchoRollo: 130 } });
  check('un rollo de 130 mm avisa que una térmica de 4" no lo imprime entero', ancho.avisos.includes('rollo_ancho'));
  const corrido = await service.planear(1, 1, { formato: 'rollo-50x25', ajuste: { x: 3 } });
  check('★ un desvío que saca la etiqueta de la página se avisa', corrido.avisos.includes('calibracion_fuera'));
  const quieto = await service.planear(1, 1, { formato: 'rollo-50x25' });
  checkEq('sin calibración, ningún aviso de geometría', quieto.avisos, []);

  // Un navegador con el bundle viejo manda solo los campos de antes: tiene que
  // recibir el mismo resultado que siempre.
  const viejo = await service.planear(1, 1, {
    formato: 'a4-5x13', simbologia: 'barras', mostrar: { nombre: true, variante: true, precio: false },
    marco: false, ajuste: { x: 0, y: 0 }, desde: 1, cantidadModo: 'uno',
    seleccion: [{ nivel: 'producto', producto_id: 1 }],
  });
  checkEq('★ una petición vieja (sin diseño ni impresora) sigue funcionando', [viejo.total, viejo.avisos], [1, []]);

  const pdfDe = (body) => new Promise((ok, ko) => {
    service.construirPdf(1, 1, body, resFalso(ok)).catch(ko);
  });
  const prueba = await pdfDe({ prueba: true, formato: 'rollo3-32x25' });
  checkEq('★ la hoja de prueba sale por el mismo endpoint y sin productos', [prueba.subarray(0, 5).toString('latin1'), paginasDe(prueba)], ['%PDF-', 2]);
  const real = await pdfDe({ formato: 'rollo3-32x25', seleccion: [{ nivel: 'producto', producto_id: 1 }],
    diseno: { escalaTexto: 1.2, alinear: 'izquierda' }, impresora: { rotacion: 180, escala: 101, dpi: 203 },
    mostrar: { nombre: true, pie: true }, pieTexto: 'Garantía' });
  check('y el PDF con todas las opciones nuevas se genera', real.subarray(0, 5).toString('latin1') === '%PDF-' && real.length > 500);

  checkEq('los valores fuera de rango se acotan en vez de romper',
    (await service.planear(1, 1, { formato: 'rollo-50x25', impresora: { rotacion: 45, escala: 999, dpi: 5 },
      diseno: { escalaTexto: 9, lineasNombre: 0 } })).geometria.papel.rotacion, 0);
}

console.log('\n' + '─'.repeat(62));
if (fallos) { console.log(`✗ ${fallos} FALLO(S) de ${fallos + pasados}`); process.exit(1); }
console.log(`✓ TODO OK — ${pasados} verificaciones`);
