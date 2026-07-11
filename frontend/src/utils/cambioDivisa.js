// ─────────────────────────────────────────────────────────────────────────────
// Lógica pura del cambio pesos ⇄ dólares (compartida por el componente
// <CambioDivisa /> y sus llamadores). Vive fuera del archivo del componente
// para no romper el fast-refresh (react-refresh/only-export-components).
//
// Dos modos válidos:
//   • 'tasa'   (preferido): dólares + tasa (pesos por dólar) → pesos calculados.
//   • 'montos'            : dólares + pesos → tasa calculada.
//
// La tasa que el usuario escribe se conserva EXACTA (no se re-deriva de una
// división), que es justo el punto del cambio.
// ─────────────────────────────────────────────────────────────────────────────

const n = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v));

// Pesos = dólares × tasa (enteros; COP no maneja centavos aquí)
export const calcPesos = (dolares, tasa) =>
  n(dolares) > 0 && n(tasa) > 0 ? Math.round(n(dolares) * n(tasa)) : '';

// Tasa = pesos ÷ dólares (2 decimales para mostrar; la BD guarda 4)
export const calcTasa = (pesos, dolares) =>
  n(pesos) > 0 && n(dolares) > 0 ? Math.round((n(pesos) / n(dolares)) * 100) / 100 : '';

/** Estado inicial del cambio. `modo` por defecto 'tasa' (el preferido). */
export const cambioInicial = (extra = {}) => ({
  modo: 'tasa', dolares: '', pesos: '', tasa: '', ...extra,
});

/** Recalcula el campo derivado tras editar dólares/pesos/tasa o cambiar de modo. */
export const recalcularCambio = (estado, campo, valor) => {
  const next = { ...estado, [campo]: valor };
  if (next.modo === 'tasa') {
    next.pesos = calcPesos(next.dolares, next.tasa);
  } else {
    next.tasa = calcTasa(next.pesos, next.dolares);
  }
  return next;
};

/** ¿El cambio está completo? (los dos lados resueltos) */
export const cambioCompleto = (estado) => n(estado.dolares) > 0 && n(estado.pesos) > 0;
