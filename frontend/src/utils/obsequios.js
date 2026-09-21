// ─────────────────────────────────────────────────────────────────────────────
// OBSEQUIOS — lo que se regala con la venta (vidrio templado, estuche) va en la
// factura a $0 y su COSTO sigue contando en la utilidad.
//
// Va de la mano del precio mínimo (`precio_minimo_activo`): sin ese candado, un
// vendedor que quiera regalar algo simplemente escribe 0 y ya. Con el candado
// encendido esa puerta se cierra, y la marca de obsequio es la ÚNICA salida —
// una salida que deja rastro, a diferencia de un 0 tecleado.
//
// Aquí no se calcula ninguna cifra de la factura: el precio de un obsequio es
// 0 y **lo pone el backend** (`backend/src/utils/obsequios.util.js`), nunca el
// navegador. Lo de este archivo es el vocabulario que comparten el carrito, el
// modal de factura y el de préstamo.
//
// **NUNCA se calcula ni se muestra un COSTO desde aquí.** Estas pantallas son
// el punto de venta: las ven el vendedor y el cliente al otro lado del
// mostrador. Lo que costó un regalo es un dato de Reportes, y allá pasa por la
// regla única de costos del backend (`utils/costos.util.js`).
// ─────────────────────────────────────────────────────────────────────────────

/** Origen del precio de un ítem del carrito, cuando es un regalo. */
export const ORIGEN_OBSEQUIO = 'obsequio';

/** La marca es explícita: un precio en 0 NO convierte nada en obsequio. */
export const esObsequio = (item) => item?.obsequio === true;

/** Cuántas unidades del carrito van de regalo. */
export const unidadesObsequio = (items) =>
  (items || []).reduce((s, i) => (esObsequio(i) ? s + (i.cantidad || 1) : s), 0);
