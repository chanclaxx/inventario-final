// ─────────────────────────────────────────────────────────────────────────────
// BUSCAR UN PRODUCTO POR NOMBRE O POR SU CÓDIGO — en las pantallas donde ENTRA
// mercancía (pedido del usuario, 16-oct-2026: «los buscadores deben poder buscar
// desde el código de producto que tenemos para pistolear»).
//
// Compra a proveedor, pedido, Entrada de bodega y los pasos de «Agregar» del
// Inventario buscaban SOLO por nombre: con la caja en la mano y la etiqueta
// pegada, había que leer el nombre y teclearlo. El inventario ya buscaba por
// código (`ProductosCantidad.jsx`); aquí está la misma regla para todos.
//
// Un producto por cantidad trae `codigo` (el suyo) y `codigos_variantes` (los de
// sus tallas y colores, separados por espacio; los arma `findAll` del backend):
// con variantes activas el código que se escanea es casi siempre el de la HOJA.
//
// El lector es un teclado: escribe el código y manda Enter. Por eso, además del
// filtro, `elegirConEnter` decide qué producto tomar: el que tiene ESE código
// exacto y, si no, el único que quedó en la lista.
// ─────────────────────────────────────────────────────────────────────────────
import { normalizarTexto } from './texto.js';
import { corregirGuiones } from './codigoEscaneado.js';

const normalizarCodigo = (c) => String(c ?? '').trim().toLowerCase();

/** El código del producto y los de sus variantes, normalizados. */
const codigosDe = (p) => [p?.codigo, ...String(p?.codigos_variantes ?? '').split(/\s+/)]
  .map(normalizarCodigo)
  .filter(Boolean);

/** Cómo se compara la consulta contra los CÓDIGOS: tal cual y, con la corrección
 *  del lector encendida (`escaneo_corregir_guiones`), también con el `'` vuelto guion. */
const consultasDeCodigo = (consulta, corregir) => {
  const q = normalizarCodigo(consulta);
  if (!q) return [];
  const corregida = corregir ? corregirGuiones(q) : null;
  return corregida ? [q, corregida] : [q];
};

/** ¿El producto coincide con lo escrito? Nombre sin tildes ni mayúsculas, o código. */
export const coincideProducto = (p, consulta, { corregir = false } = {}) => {
  const q = normalizarTexto(consulta);
  if (!q) return true;
  if (normalizarTexto(p?.nombre).includes(q)) return true;
  const codigos = codigosDe(p);
  return consultasDeCodigo(consulta, corregir).some((c) => codigos.some((cod) => cod.includes(c)));
};

/** Los productos que coinciden. Sin texto devuelve EL MISMO arreglo. */
export const filtrarProductos = (productos, consulta, opciones) => {
  if (!normalizarTexto(consulta)) return productos;
  return productos.filter((p) => coincideProducto(p, consulta, opciones));
};

/**
 * El producto cuyo código (o el de una de sus variantes) es EXACTAMENTE lo
 * escrito. `codigoVariante` dice qué variante se leyó, para que el selector de
 * tallas llegue ya con ella elegida; es null si el código es del producto.
 * Si el código apareciera en dos productos no se adivina: null.
 */
export const productoPorCodigo = (productos, consulta, { corregir = false } = {}) => {
  for (const q of consultasDeCodigo(consulta, corregir)) {
    const hallados = (productos ?? []).filter((p) => codigosDe(p).includes(q));
    if (hallados.length === 1) {
      const p = hallados[0];
      return { producto: p, codigoVariante: normalizarCodigo(p.codigo) === q ? null : q };
    }
  }
  return null;
};

/**
 * Qué tomar al pulsar Enter en el buscador: el código exacto (en TODO el
 * catálogo, aunque haya un filtro de línea puesto: lo leyó el lector) y, si no,
 * la única coincidencia visible. Con varias no adivina.
 */
export const elegirConEnter = (todos, visibles, consulta, opciones) => {
  const exacto = productoPorCodigo(todos, consulta, opciones);
  if (exacto) return exacto;
  if (normalizarTexto(consulta) && visibles?.length === 1) return { producto: visibles[0], codigoVariante: null };
  return null;
};
