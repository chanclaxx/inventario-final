/**
 * Clave estable de un producto dentro de una revisión de destino.
 *
 * Vive en su propio archivo (y no junto al componente) porque exportar
 * funciones desde un módulo de componentes rompe el fast refresh de Vite.
 *
 * Los seriales se identifican por su `serial_id`, que es único. Los productos
 * de cantidad llevan además el índice: el mismo producto puede aparecer más de
 * una vez en un despacho y cada aparición se decide por separado.
 */
export function claveItem(item, indice) {
  return item.tipo === 'serial'
    ? `s-${item.serial_id}`
    : `c-${item.producto_id}-${indice}`;
}
