// El nombre del producto con su variante pegada, para los textos de una sola
// línea y para lo que se GUARDA: la factura, el préstamo y sus PDF ya no tienen
// el carrito al lado para desambiguar dos líneas del mismo producto.
//
// La versión visual (chips azul/morado) es `components/ui/ChipsVariante`.
export const nombreConVariante = (item) => {
  const variante = [item?.atributo_label, item?.variante_label].filter(Boolean).join(' / ');
  return variante ? `${item.nombre} (${variante})` : item?.nombre;
};
