/**
 * Utilidad compartida: promedio ponderado móvil de costo unitario.
 *
 * Se usa en:
 *   - productosCantidad.service.js  (ajuste de stock manual / venta con retoma)
 *   - compras.service.js            (registro de compra por cantidad)
 *
 * Reglas:
 *   - Solo se llama cuando es una ENTRADA (cantidad > 0) con costo conocido.
 *   - Si el stock actual es 0 (o no hay costo previo), el nuevo costo se usa directo.
 *   - Devuelve un entero (Math.round) para evitar decimales en la BD.
 *
 * @param {number} stockActual   - Unidades actualmente en inventario
 * @param {number|null} costoActual - Costo unitario actual (puede ser null)
 * @param {number} cantidadNueva - Unidades que entran con esta compra
 * @param {number} costoNuevo    - Costo unitario de las unidades que entran
 * @returns {number}
 */
const calcularCostoPromedio = (stockActual, costoActual, cantidadNueva, costoNuevo) => {
  const stock  = Math.max(0, stockActual  || 0);
  const costo  = Number(costoActual  || 0);
  const cantN  = Number(cantidadNueva);
  const costoN = Number(costoNuevo);

  if (stock === 0) return costoN;
  return Math.round((stock * costo + cantN * costoN) / (stock + cantN));
};

/**
 * La INVERSA del promedio ponderado: saca del promedio las unidades que
 * entraron a un precio conocido.
 *
 * Existe para corregir una entrada de bodega. Revertir el stock sin revertir el
 * promedio dejaría el costo del nodo contando unidades que ya no están, y eso es
 * exactamente el "corregí algo y se dañó el inventario" que no puede pasar.
 *
 * ── La propiedad que la hace segura ─────────────────────────────────────────
 * Una entrada se valoriza al ÚLTIMO COSTO CONOCIDO del nodo, que es NEUTRO:
 * mezclar unidades al mismo costo deja el promedio idéntico. Con P == C esta
 * fórmula da exactamente C — es decir, no toca nada. Solo hace trabajo real
 * cuando la entrada se valorizó con el `precio_estimado` de una orden, que sí
 * movió el promedio.
 *
 *   C_ant = (stock * C_actual - cant * P) / (stock - cant)
 *
 * Es exacta mientras no haya habido otro movimiento sobre el nodo en medio. La
 * ventana entre recibir y corregir es de minutos y la entrada aún no está
 * confirmada, pero cuando el resultado no es coherente (menos stock del que se
 * saca, o un costo negativo) devuelve `null` en vez de escribir una cifra
 * inventada: quedarse con el promedio de antes es un error acotado; escribir
 * basura en el costo contamina la utilidad de cada venta futura.
 *
 * @returns {number|null} el costo anterior, o null si no se puede reconstruir
 */
const revertirCostoPromedio = (stockActual, costoActual, cantidadSale, costoSale) => {
  const stock  = Number(stockActual || 0);
  const costo  = Number(costoActual || 0);
  const cant   = Number(cantidadSale);
  const precio = Number(costoSale || 0);

  if (!(cant > 0))     return null;
  if (stock <  cant)   return null;
  // El nodo se queda en cero: no hay promedio que reconstruir y el que tiene
  // sirve como "último costo conocido" para la próxima entrada. Se deja igual.
  if (stock === cant)  return null;

  const anterior = (stock * costo - cant * precio) / (stock - cant);
  if (!Number.isFinite(anterior) || anterior < 0) return null;
  return Math.round(anterior);
};

module.exports = { calcularCostoPromedio, revertirCostoPromedio };