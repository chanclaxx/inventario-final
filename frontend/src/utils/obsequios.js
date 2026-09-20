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
// ─────────────────────────────────────────────────────────────────────────────

/** Origen del precio de un ítem del carrito, cuando es un regalo. */
export const ORIGEN_OBSEQUIO = 'obsequio';

/** La marca es explícita: un precio en 0 NO convierte nada en obsequio. */
export const esObsequio = (item) => item?.obsequio === true;

/** Cuántas unidades del carrito van de regalo. */
export const unidadesObsequio = (items) =>
  (items || []).reduce((s, i) => (esObsequio(i) ? s + (i.cantidad || 1) : s), 0);

/**
 * Lo que cuestan esos regalos, o `null` si no se puede saber.
 *
 * El ítem del carrito solo trae `costo` cuando este usuario puede ver costos
 * (`costos_solo_admin` lo recorta en el BACKEND). Si falta el costo de alguno,
 * se devuelve null en vez de una suma a medias: media cifra sobre dinero se
 * lee como la cifra completa. Esto es solo un aviso en pantalla — la utilidad
 * de verdad la calcula el reporte contra el costo real del inventario.
 */
export const costoObsequios = (items) => {
  const regalos = (items || []).filter(esObsequio);
  if (!regalos.length) return 0;
  if (regalos.some((i) => !Number.isFinite(Number(i.costo)) || Number(i.costo) <= 0)) return null;
  return regalos.reduce((s, i) => s + Number(i.costo) * (i.cantidad || 1), 0);
};
