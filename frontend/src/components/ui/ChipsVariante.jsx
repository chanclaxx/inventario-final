// ─────────────────────────────────────────────────────────────────────────────
// Qué variante es esta línea — el único dato que distingue dos líneas del mismo
// producto.
//
// Con la feature «Variantes» activa el carrito puede llevar dos veces «Camiseta
// Nike» y ser cosas distintas (talla M y talla L). El nombre es el mismo en las
// dos, así que sin estos chips las pantallas que solo muestran `nombre` mienten
// por omisión: el vendedor no puede revisar lo que está a punto de facturar.
//
// Azul = atributo (la talla), morado = variante (el color dentro de esa talla).
// Es el mismo par de colores del árbol de variantes y del carrito: cambiarlo
// aquí lo cambia en todas partes, que es justo por lo que vive en un solo sitio.
//
// Devuelve null cuando el ítem no tiene variantes, así que se puede montar sin
// condicional en cualquier lista de ítems.
// ─────────────────────────────────────────────────────────────────────────────
export function ChipsVariante({ item, className = '' }) {
  if (!item?.atributo_label && !item?.variante_label) return null;

  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {item.atributo_label && (
        <span className="text-xs bg-blue-50 text-blue-600 border border-blue-100 px-2 py-0.5 rounded-full">
          {item.atributo_label}
        </span>
      )}
      {item.variante_label && (
        <span className="text-xs bg-purple-50 text-purple-600 border border-purple-100 px-2 py-0.5 rounded-full">
          {item.variante_label}
        </span>
      )}
    </div>
  );
}
