// Lo que cambia tras cualquier operación de garantía: la propia pestaña, el
// chip del inventario, el stock, la factura y el préstamo de donde salió la
// unidad, y la caja si movió dinero. Las claves son las mismas de esas
// pantallas; prefijo, para que se refresquen todas sus variantes.
const CLAVES = [
  'garantias-proveedor', 'garantia-proveedor', 'garantia-envio', 'garantias-en-inventario', 'garantias-candidatos',
  'productos-serial', 'seriales', 'productos-cantidad', 'arbol-producto', 'inventario',
  'facturas', 'factura-detalle', 'prestamos', 'prestamo-detalle', 'creditos', 'credito-detalle',
  'caja-activa', 'caja-resumen', 'acreedores',
];

export const refrescarTrasGarantia = (queryClient) => {
  for (const k of CLAVES) queryClient.invalidateQueries({ queryKey: [k], exact: false });
};
