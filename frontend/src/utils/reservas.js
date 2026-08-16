// ─────────────────────────────────────────────────────────────────────────────
// BLOQUEO BLANDO DE BORRADORES (feature opt-in por negocio)
//
// Un borrador aparta mercancía sin tocar el inventario: el serial sigue
// vendible y el stock sigue completo. Lo único que existe es este índice, que
// responde «¿esto está apalabrado?» en memoria — la pregunta se hace en cada
// toque de la lista de inventario y no puede costar un viaje al servidor.
//
// Este módulo es PURO (sin React, sin red, sin store): la regla de
// disponibilidad es la decisión central de la feature y vive aquí para poder
// probarla aislada. Ver frontend/scripts/pruebas-reservas.mjs.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construye el índice de reservas: item_key → { total, entradas[] }
 *
 * `total` suma las cantidades de TODOS los borradores vigentes, porque la regla
 * de los productos por cantidad se mide contra el stock libre. `entradas` dice
 * en cuáles está, para poder ofrecer quitarlo del que sea.
 *
 * @param {Array}       borradores        lista del backend, con sus items
 * @param {number|null} excluirBorradorId borrador ya cargado en el carrito
 */
export function construirIndiceReservas(borradores, excluirBorradorId = null) {
  const indice = {};

  for (const b of borradores || []) {
    // El borrador que el carrito ya tiene cargado no cuenta contra sí mismo: si
    // no, agregar una unidad más de algo que ESE MISMO borrador aparta chocaría
    // con su propia reserva, y el vendedor tendría que pedirse permiso a sí
    // mismo para seguir trabajando el carrito que acaba de abrir.
    if (excluirBorradorId != null && b.id === excluirBorradorId) continue;

    for (const item of b.items || []) {
      const entrada = {
        borrador_id:    b.id,
        titulo:         b.titulo,
        usuario_nombre: b.usuario_nombre,
        creado_en:      b.creado_en,
        item_id:        item.id,
        cantidad:       Number(item.cantidad) || 1,
      };
      const previo = indice[item.item_key];
      if (previo) {
        previo.total += entrada.cantidad;
        previo.entradas.push(entrada);
      } else {
        indice[item.item_key] = { total: entrada.cantidad, entradas: [entrada] };
      }
    }
  }

  // Más antiguo primero: lleva más tiempo esperando y es el candidato natural a
  // liberar cuando el producto está en varios borradores.
  for (const r of Object.values(indice)) {
    r.entradas.sort((a, b) => new Date(a.creado_en) - new Date(b.creado_en));
  }
  return indice;
}

/**
 * ¿Agregar esto choca con lo apalabrado?
 *
 * La regla es DISTINTA por familia, y esa diferencia ES la feature:
 *
 *   serial   → binario. Un IMEI es una unidad física: si está en un borrador,
 *              está apartado, punto.
 *
 *   cantidad → contra el stock libre. Con 200 forros y 1 apartado no hay nada
 *              que avisar. Avisar igual convertiría la alerta en algo que el
 *              vendedor aprende a descartar sin leer, y ahí la feature entera
 *              deja de servir.
 *
 * @param {object} item    ítem del carrito (necesita `tipo` y, si es cantidad, `stock`)
 * @param {object} reserva entrada del índice, o undefined
 * @param {number} pedida  cuántas unidades quedarían en el carrito si esto
 *                         prospera — NO cuántas se suman. El escáner suma de a
 *                         una, y pasar 1 dejaría colar la última unidad libre
 *                         de a poquitos.
 */
export function choca(item, reserva, pedida = 1) {
  if (!reserva || !reserva.total) return false;
  if (item.tipo === 'serial') return true;

  // Sin stock conocido no se bloquea: es preferible dejar vender que frenar una
  // venta por un dato que no tenemos.
  const stock = Number(item.stock);
  if (!Number.isFinite(stock)) return false;

  const libre = stock - Number(reserva.total || 0);
  return pedida > libre;
}

/** Unidades que quedan sin apartar. null si el stock no se conoce. */
export function unidadesLibres(stock, reserva) {
  const s = Number(stock);
  if (!Number.isFinite(s)) return null;
  return s - Number(reserva?.total || 0);
}
