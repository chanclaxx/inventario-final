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

module.exports = { calcularCostoPromedio };