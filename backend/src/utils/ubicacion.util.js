// ── Ubicación espacial de productos (feature opt-in) ─────────────────────────
//
// Normalización compartida por productos de cantidad y de serial, para que la
// misma ubicación escrita en dos sitios distintos quede idéntica en la BD y el
// agrupado por estante no se parta en dos.
//
// Semántica de los tres casos, igual que `codigo` y `nota`:
//   undefined → no tocar (un cliente que no envía el campo no lo borra)
//   '' / null → limpiar
//   texto     → trim + espacios internos colapsados
//
// El tope de 60 caracteres es de forma, no de contenido: "Estante A-3" o
// "Bodega 2 · fondo izquierda" caben de sobra; 60 evita que alguien pegue un
// párrafo y rompa el ancho de las tarjetas y el Excel.

const MAX_UBICACION = 60;

const normalizarUbicacion = (valor) => {
  if (valor === undefined) return undefined;

  const limpio = String(valor ?? '').trim().replace(/\s+/g, ' ');
  if (!limpio) return null;

  if (limpio.length > MAX_UBICACION) {
    throw {
      status: 400,
      message: `La ubicación no puede superar ${MAX_UBICACION} caracteres`,
    };
  }
  return limpio;
};

module.exports = { normalizarUbicacion, MAX_UBICACION };
