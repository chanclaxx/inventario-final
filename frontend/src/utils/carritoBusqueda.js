// ─────────────────────────────────────────────────────────────────────────────
// Buscar DENTRO del carrito.
//
// El carrito es una columna angosta al lado del inventario, y una venta de
// mayoreo o un despacho a un local pueden tener cuarenta líneas. Para corregir
// el precio de una —o para ver si ese producto ya está— hay que scrollear la
// lista entera, y con variantes activas el nombre se repite: «Camiseta Nike»
// aparece cinco veces y lo único que las distingue es un chip de talla.
//
// Reglas del buscador:
//
//   1. FILTRA LO QUE SE VE, NUNCA LO QUE SE VENDE. El total, el contador y los
//      botones de abajo siguen siendo los del carrito COMPLETO. Un buscador que
//      además recortara el total sería la forma más rápida de facturar de menos.
//   2. Se busca por TODO lo que el ítem sabe de sí mismo —nombre, talla, color,
//      IMEI, código, marca, modelo y las características del serial—, porque el
//      vendedor no se acuerda de por cuál de esos datos lo agregó.
//   3. Varias palabras = TODAS tienen que aparecer, en cualquier orden y en
//      cualquier campo: «nike verde» encuentra la Camiseta Nike / Color: Verde
//      sin que «nike verde» sea un texto que exista en ninguna parte.
//   4. Sin tildes y sin mayúsculas: nadie escribe «Audífonos» con tilde cuando
//      está de afán en el mostrador. La Ñ SÍ se conserva — no es una vocal con
//      tilde sino otra letra, y borrarla haría que «año» y «ano» fueran la
//      misma búsqueda.
//
// Los ítems que llevan días en `localStorage` no traen las claves nuevas
// (`codigo`, `color`, `caracteristicas`). No revientan: simplemente se buscan
// por lo que sí traen, igual que antes de que esto existiera.
// ─────────────────────────────────────────────────────────────────────────────

// Desde cuántos ítems aparece la barra. Con tres productos a la vista, un campo
// de búsqueda es ruido que estorba justo encima de lo que se quiere mirar.
export const MINIMO_PARA_BUSCAR = 6;

// Desde cuántas letras un término puede encontrarse EN MEDIO de una palabra.
//
// Esto no es un detalle: buscar «Talla: M» partía en los términos «talla» y
// «m», y una «m» suelta está dentro de «ca-m-iseta», así que la búsqueda que
// debía dejar UNA línea las dejaba las cinco. Por eso la regla normal es que el
// término EMPIECE una palabra del producto.
//
// La excepción son los IMEI: a un equipo se le buscan los últimos dígitos, que
// van en mitad del número. Tres letras es lo que separa un dato que alguien
// tecleó a propósito de una letra que cae por casualidad dentro de otra palabra.
const MINIMO_EN_MEDIO = 3;

// Lo que NO es letra ni dígito separa palabras: así «Talla: M» son «talla» y
// «m», y escribir los dos puntos o no da igual. La ñ va en la lista de letras
// porque `normalizar` la conserva.
const SEPARADORES = /[^a-z0-9ñ]+/;

/** minúsculas + sin tildes (pero con Ñ) + sin espacios de sobra. */
export const normalizar = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    // En NFD la Ñ es una «n» con una tilde encima, así que el barrido de la
    // línea siguiente se la comería: se vuelve a armar ANTES de barrer.
    .replace(/ñ/gi, 'ñ')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/**
 * Todo lo que un ítem del carrito sabe de sí mismo, en una sola cadena
 * normalizada. De las características del serial entran la CLAVE y el VALOR:
 * buscar «ram» tiene que traer los equipos que la tengan anotada, aunque el
 * vendedor no se acuerde de cuánta.
 *
 * Lo que NO entra: precio, costo y stock. Buscar «40» tiene que traer lo que
 * diga 40 en su nombre o su código, no todo lo que valga $40.000. Y el costo,
 * además, es justo el dato que `costos_solo_admin` existe para esconder.
 */
export function textoBuscableItem(item) {
  if (!item) return '';

  const partes = [
    item.nombre,
    item.atributo_label,   // la talla
    item.variante_label,   // el color dentro de esa talla
    item.imei,
    item.codigo,           // el que está impreso en la etiqueta
    item.marca,
    item.modelo,
    item.color,            // color del serial (config `colores_serial_*`)
  ];

  // `caracteristicas` es un jsonb libre: {"RAM": "8GB", "Almacenamiento": "128"}
  const caracteristicas = item.caracteristicas;
  if (caracteristicas && typeof caracteristicas === 'object') {
    for (const [clave, valor] of Object.entries(caracteristicas)) {
      partes.push(clave, valor);
    }
  }

  return partes
    .filter((p) => p !== null && p !== undefined && p !== '')
    .map(normalizar)
    .filter(Boolean)
    .join(' ');
}

/** Un texto partido en palabras buscables. */
export const tokenizar = (texto) =>
  normalizar(texto).split(SEPARADORES).filter(Boolean);

/** La consulta partida en términos. Sirve también para saber si hay búsqueda. */
export const terminosDeBusqueda = (consulta) => tokenizar(consulta);

/** ¿Alguna palabra del ítem responde a este término? */
const _coincide = (palabras, termino) =>
  palabras.some((p) => p.startsWith(termino))
  || (termino.length >= MINIMO_EN_MEDIO && palabras.some((p) => p.includes(termino)));

/**
 * Los ítems que coinciden con la consulta.
 *
 * Sin consulta devuelve EL MISMO arreglo (la misma referencia, no una copia):
 * el carrito se renderiza en cada toque de la lista de inventario y el caso
 * normal —nadie está buscando— no puede costar un recorrido.
 */
export function filtrarCarrito(items, consulta) {
  const terminos = terminosDeBusqueda(consulta);
  if (terminos.length === 0) return items;

  return (items || []).filter((item) => {
    const palabras = tokenizar(textoBuscableItem(item));
    return terminos.every((t) => _coincide(palabras, t));
  });
}
