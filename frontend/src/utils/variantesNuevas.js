// ── Variantes de un producto que todavía no existe ───────────────────────────
//
// Lógica pura del editor que aparece al CREAR un producto (EditorVariantesNuevas):
// el usuario elige una o dos características (Color; o Talla × Color) con sus
// valores, y de ahí salen las combinaciones. Vive aparte del componente para
// que el payload se pueda probar en node sin montar React
// (`frontend/scripts/prueba-variantes-nuevas.mjs`).
//
// El payload tiene la forma que espera `POST /productos-cantidad` → `variantes`,
// que es la misma de `getArbol` sin ids:
//   una característica  → [{ valor, tipo_id, precio, costo_unitario, codigo }]
//   dos características → [{ valor, tipo_id, variantes: [{ valor, tipo_id, … }] }]
// Con dos, el precio, el costo y el código van en la HOJA: es lo que se vende y
// lo que se etiqueta.

export const estadoVariantesVacio = () => ({
  activo: false,
  dims: [{ tipoId: '', valores: [] }],
  // Por combinación: { precio, costo, codigo }. Queda algo huérfano si se quita
  // un valor, y no importa: el payload se arma desde las combinaciones vigentes.
  filas: {},
});

const _k = (v) => String(v).trim().toLowerCase();

/** Clave estable de una combinación. Sin distinguir mayúsculas, igual que el backend. */
export const claveHoja = (v1, v2 = null) => (v2 == null ? _k(v1) : `${_k(v1)}|${_k(v2)}`);

/**
 * Agrega a la lista lo escrito, separado por comas. No repite (sin distinguir
 * mayúsculas): el backend rechazaría el producto entero por un «blanco» doble.
 */
export function agregarValores(lista, texto) {
  const out = [...lista];
  const vistos = new Set(out.map(_k));
  for (const parte of String(texto ?? '').split(',')) {
    const v = parte.trim();
    if (!v || vistos.has(_k(v))) continue;
    vistos.add(_k(v));
    out.push(v);
  }
  return out;
}

/** Las combinaciones que se van a crear, en el orden en que se escribieron. */
export function hojasVariantes(estado) {
  if (!estado?.activo) return [];
  const [d1, d2] = estado.dims;
  if (!d1?.valores.length) return [];
  if (!d2?.valores.length) return d1.valores.map((v) => ({ clave: claveHoja(v), label: v, v1: v, v2: null }));
  return d1.valores.flatMap((a) => d2.valores.map((b) => ({
    clave: claveHoja(a, b), label: `${a} / ${b}`, v1: a, v2: b,
  })));
}

const _numero = (x) => (x === '' || x == null ? undefined : Number(x));
const _tipo = (t) => (t ? Number(t) : null);

/**
 * El cuerpo para el backend, o `undefined` si el producto no lleva variantes
 * (así la clave ni viaja y el backend sigue el camino de siempre).
 *
 * `conCosto` / `conCodigo`: un campo que la pantalla no muestra no puede
 * viajar — mismo criterio que el modal de edición del árbol.
 */
export function armarVariantesPayload(estado, { conCosto = false, conCodigo = false } = {}) {
  const hojas = hojasVariantes(estado);
  if (!hojas.length) return undefined;

  const [d1, d2] = estado.dims;
  const datosHoja = (h, tipoId) => {
    const f = estado.filas[h.clave] || {};
    const nodo = { valor: h.v2 ?? h.v1, tipo_id: _tipo(tipoId) };
    const precio = _numero(f.precio);
    if (precio !== undefined) nodo.precio = precio;
    if (conCosto) { const c = _numero(f.costo); if (c !== undefined) nodo.costo_unitario = c; }
    if (conCodigo && f.codigo?.trim()) nodo.codigo = f.codigo.trim().toUpperCase();
    return nodo;
  };

  if (!d2?.valores.length) return hojas.map((h) => datosHoja(h, d1.tipoId));

  return d1.valores.map((a) => ({
    valor: a,
    tipo_id: _tipo(d1.tipoId),
    variantes: hojas.filter((h) => _k(h.v1) === _k(a)).map((h) => datosHoja(h, d2.tipoId)),
  }));
}

/** Por qué no se puede crear todavía, o `null`. */
export function errorVariantes(estado) {
  if (!estado?.activo) return null;
  if (!estado.dims[0]?.valores.length) return 'Agrega al menos una variante, o apaga «Tiene variantes».';
  const hojas = hojasVariantes(estado);
  if (hojas.length > MAX_HOJAS) return `Un producto puede nacer con hasta ${MAX_HOJAS} variantes.`;
  const codigos = hojas.map((h) => estado.filas[h.clave]?.codigo?.trim().toUpperCase()).filter(Boolean);
  const repetido = codigos.find((c, i) => codigos.indexOf(c) !== i);
  if (repetido) return `El código ${repetido} está repetido.`;
  return null;
}

// Mismo tope que `MAX_HOJAS_AL_CREAR` en productosCantidad.service.
export const MAX_HOJAS = 200;
