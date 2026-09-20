// ─────────────────────────────────────────────────────────────────────────────
// OBSEQUIOS — lo que se regala con la venta va en la factura a $0, y su COSTO
// sigue contando en la utilidad.
//
// Ver migrations/20260920_obsequios.sql para el diseño completo. Lo que vive
// aquí son las dos reglas que comparten la facturación y los reportes:
//
//   1. QUÉ ES UN OBSEQUIO. La marca es explícita (`lineas_factura.obsequio`),
//      nunca deducida de que el precio quedó en cero: un 0 tecleado por error
//      se ve exactamente igual que un regalo, y el precio mínimo tiene que
//      dejar pasar el segundo sin abrirle la puerta al primero. Mismo criterio
//      que `es_entrada` y que `esExtra` en las entradas de bodega.
//   2. EL PRECIO LO PONE EL SERVIDOR, NO EL NAVEGADOR. Un obsequio vale 0 y
//      punto: si se confiara en el número que llega, «obsequio + precio 100»
//      sería una venta de 100 que se saltó el precio mínimo.
//
// LO QUE NO SE GUARDA, a propósito:
//   · el costo del obsequio — es el del nodo, el mismo que el reporte ya
//     resuelve para cualquier línea;
//   · «lo que se dejó de cobrar» — el precio de venta vive en el nodo y cambia
//     con el tiempo; congelarlo aquí crearía una segunda verdad sobre el precio
//     que nadie sabría explicar seis meses después.
//
// Sin la columna (`hayObsequios()` en falso) la marca se ignora entera: el
// precio mínimo vuelve a mandar sobre todas las líneas. Es deliberado —
// aceptar el $0 sin poder escribir POR QUÉ sería abrir el candado sin rastro.
// ─────────────────────────────────────────────────────────────────────────────
const { hayObsequios } = require('../config/columnas');

/**
 * ¿Esta línea que llega del navegador es un obsequio?
 * Solo `true` estricto, y solo si hay dónde escribirlo.
 */
const esObsequio = (linea) => hayObsequios() && linea?.obsequio === true;

/**
 * Un obsequio tiene que ser un PRODUCTO del inventario (por cantidad o por
 * IMEI). Una línea de texto libre no descuenta stock ni tiene costo, así que
 * «regalarla» no significaría nada: no hay nada que sacar ni nada que contar
 * en la utilidad, que es justo el punto de la feature.
 */
const exigirProducto = (linea) => {
  if (linea?.imei || linea?.producto_id) return;
  throw {
    status: 400,
    code: 'OBSEQUIO_SIN_PRODUCTO',
    message: `"${linea?.nombre_producto || 'La línea'}" no se puede marcar como obsequio: `
      + 'solo un producto del inventario puede serlo, porque lo que cuenta de un '
      + 'obsequio es el costo de la unidad que sale de la bodega.',
  };
};

/**
 * El precio con el que se escribe la línea. Un obsequio es 0 SIEMPRE.
 */
const precioDeLinea = (linea) => (esObsequio(linea) ? 0 : linea.precio);

/**
 * Fragmento SQL para leer la marca. Sin la columna devuelve un FALSE literal,
 * así la consulta conserva la MISMA forma —y el mismo tipo— en las dos bases.
 * No es entrada de usuario: `alias` lo pone el código que arma la consulta.
 */
const selObsequio = (alias = 'l', as = 'obsequio') =>
  `${hayObsequios() ? `${alias}.obsequio` : 'FALSE'} AS ${as}`;

/** Fragmento para usar dentro de un CASE/SUM, sin alias de salida. */
const sqlEsObsequio = (alias = 'l') => (hayObsequios() ? `${alias}.obsequio` : 'FALSE');

module.exports = { esObsequio, exigirProducto, precioDeLinea, selObsequio, sqlEsObsequio };
