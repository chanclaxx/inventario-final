'use strict';

// ── Código con PATRÓN: CATEGORÍA-PRODUCTO-VARIANTE-consecutivo ───────────────
//
// El formato numérico (000121, 000122…) identifica pero no dice nada: con el
// patrón, quien mira la etiqueta sabe qué tiene en la mano sin escanearla.
//
//   producto sin variantes   ACC-CAR-001      (Accesorios · Cargador)
//   talla / color (atributo) ACC-AUD-BLA-002  (Accesorios · Audífonos · Blanco)
//   sub-variante             ACC-COR-NEG-007  (… · Correa · 38MM / Negro)
//
// La CATEGORÍA es la línea del producto (`lineas_producto`): es la única
// agrupación que el sistema tiene, y crear un producto ya la exige.
//
// El segmento de la variante es el valor del NODO que se etiqueta (la hoja).
// En una sub-variante eso es su propio valor, no el del atributo de arriba: el
// consecutivo ya la distingue de la misma sub-variante bajo otra talla, y un
// quinto segmento alargaría un código que ya no cabe en una etiqueta chica.
//
// ── EL CONSECUTIVO ES POR PRODUCTO (CAT-PRO), NO POR VARIANTE ────────────────
// Tres letras chocan: «Audífonos inalámbricos» y «Audífonos de cable» son los
// dos AUD, y «Blanco»/«Blanca» son los dos BLA. Si el número contara por
// CAT-PRO-VAR, los dos productos sacarían ACC-AUD-BLA-001 y el índice único lo
// rechazaría. Contando por CAT-PRO, todo lo que empieza igual comparte UNA
// numeración, así que el número por sí solo ya separa los códigos: la unicidad
// sale por construcción y no depende de que las letras sean distintas.
//
// Este archivo es puro (sin base de datos) para que la regla de las letras se
// pueda probar sola; el contador y la escritura viven en `codigoAuto.util`.

// Mínimo de cifras del consecutivo. Pasado 999 crece solo (1000, 1001…) y la
// unicidad no se pierde: el número se compara entero, no por su ancho.
const DIGITOS_PATRON = 3;

// Lo que ocupa un segmento cuando el texto no alcanza a tres caracteres
// («M» → «MXX»). Rellenar con cero se confundiría con el consecutivo.
const RELLENO = 'X';

// Categoría ausente (producto viejo sin línea, o una línea sin nombre).
const SIN_CATEGORIA = 'GEN';

/**
 * Las tres primeras letras (o cifras) de un texto, en mayúsculas y sin tildes.
 *
 * Se descartan espacios y símbolos ANTES de contar: «3D S» da «3DS» y
 * «iPhone 11» da «IPH». Las cifras cuentan porque en este negocio son
 * nombre («38MM», «25W»); tirarlas dejaría «38MM» y «42MM» como «MMX» los dos.
 *
 * `Ñ` pasa a `N` y no se descarta: Code 128 no la tiene, y «Niño» → «NIN» es
 * lo que alguien leería en la etiqueta.
 */
const tresLetras = (texto, relleno = RELLENO) => {
  const limpio = String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!limpio) return null;
  return limpio.slice(0, 3).padEnd(3, relleno);
};

/**
 * El ámbito del contador: CAT-PRO. Todo nodo cuyo código empiece así comparte
 * la numeración (ver arriba por qué).
 */
const raizPatron = ({ categoria, producto }) =>
  `${tresLetras(categoria) || SIN_CATEGORIA}-${tresLetras(producto) || SIN_CATEGORIA}`;

/**
 * El código completo. `variante` es el valor del nodo hoja; sin él (el propio
 * producto) no hay tercer segmento.
 */
const componerPatron = ({ categoria, producto, variante = null }, numero) => {
  const raiz = raizPatron({ categoria, producto });
  // Un valor hecho solo de símbolos («-», «/») no puede dejar la variante sin
  // segmento: se leería como el código del producto.
  const seg  = variante != null ? (tresLetras(variante) || RELLENO.repeat(3)) : null;
  const n    = String(numero).padStart(DIGITOS_PATRON, '0');
  return seg ? `${raiz}-${seg}-${n}` : `${raiz}-${n}`;
};

// El `tipo` en `contadores_documento` (columna TEXT libre, sin migración).
const tipoContadorPatron = (raiz) => `codigo_patron:${raiz}`;

// Regex POSIX de Postgres para leer los códigos que ya siguen la raíz: con o sin
// segmento de variante, y el consecutivo al final. La raíz solo trae [A-Z0-9-],
// así que no hay metacaracteres que escapar.
const regexRaiz = (raiz) => `^${raiz}(-[A-Z0-9]{3})?-[0-9]{1,9}$`;

// Ejemplo para la pantalla de Ajustes. Mismo `componerPatron` que el motor, así
// el texto de ayuda no puede prometer un formato distinto del que sale.
const EJEMPLOS_PATRON = [
  { categoria: 'Accesorios', producto: 'Cargador', variante: null, numero: 1 },
  { categoria: 'Accesorios', producto: 'Audífonos', variante: 'Blanco', numero: 2 },
].map((e) => componerPatron(e, e.numero));

module.exports = {
  DIGITOS_PATRON, SIN_CATEGORIA,
  tresLetras, raizPatron, componerPatron, tipoContadorPatron, regexRaiz, EJEMPLOS_PATRON,
};
