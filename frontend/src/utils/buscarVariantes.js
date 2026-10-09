// ─────────────────────────────────────────────────────────────────────────────
// BUSCAR UNA VARIANTE DENTRO DE UN PRODUCTO
//
// Un producto con el árbol de variantes activo se compra, se recibe y se
// corrige eligiendo la HOJA (la talla, el color). Con cinco se elige a ojo; con
// veinte hay que leerlas todas (pedido del usuario, 6-oct-2026). Desde un
// mínimo, cada selector muestra un cuadro de búsqueda.
//
// Aquí vive lo puro —el umbral y el filtro— para que TODOS los selectores
// busquen igual; el estado está en `hooks/useBuscadorVariantes.js` y el cuadro
// en `components/ui/BuscadorVariantes.jsx`.
// ─────────────────────────────────────────────────────────────────────────────
import { normalizarTexto } from './texto.js';

// Con ESTAS variantes o más aparece el buscador. Por debajo la lista se abarca
// de un vistazo y un cuadro de más solo estorba: ahí ningún selector cambia.
//
// Es EL MISMO número de la vista de variantes del producto en Inventario
// (`VistaVariantesProducto`), que lo importa de aquí. Nació en 9 mientras esa
// vista ya usaba 6, y con un producto de 6 a 8 variantes (151 en la base, oct-
// 2026) el buscador salía al abrir el producto y NO al tocar «Agregar»: el
// mismo producto, con ayuda en una pantalla y sin ella en la de al lado.
export const MIN_VARIANTES_BUSCADOR = 6;

/** Minúsculas, sin tildes y sin espacios repetidos: «Café » y «cafe» son lo mismo. */
export const normalizarBusqueda = normalizarTexto;

// Por dónde se encuentra una hoja: su valor, el de su padre («Talla: 38MM»
// cuando la hoja es el color) y su código — así también sirve leer la
// etiqueta con el lector dentro del cuadro.
const textoDeHoja = (h) => normalizarBusqueda(`${h?.labelPadre ?? ''} ${h?.label ?? ''} ${h?.codigo ?? ''}`);

/**
 * Las hojas que coinciden con lo escrito. Cada PALABRA tiene que aparecer, en
 * cualquier orden: «38 negro» encuentra «Talla: 38MM / Color: Negro» aunque el
 * 38 esté en el padre y el negro en la hoja.
 * Sin texto devuelve EL MISMO arreglo (no una copia): quien no busca no nota
 * que el filtro existe.
 */
export const filtrarHojas = (hojas, consulta) => {
  const palabras = normalizarBusqueda(consulta).split(' ').filter(Boolean);
  if (!palabras.length) return hojas;
  return hojas.filter((h) => {
    const texto = textoDeHoja(h);
    return palabras.every((p) => texto.includes(p));
  });
};

/** ¿Esta lista es lo bastante larga para merecer el buscador? */
export const mereceBuscador = (hojas) => (hojas?.length ?? 0) >= MIN_VARIANTES_BUSCADOR;
