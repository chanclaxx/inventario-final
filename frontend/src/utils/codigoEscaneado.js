// ─────────────────────────────────────────────────────────────────────────────
// EL LECTOR ESCRIBE CON TECLADO EN INGLÉS — y el computador está en español.
//
// Copia del navegador de `backend/src/utils/codigoEscaneado.util.js` (el
// frontend no puede importar del backend): la usa el atajo local del carrito,
// que resuelve el código en memoria antes de ir al servidor. Si cambia la
// lista de caracteres, cambian las dos; la suite 62 lo vigila.
//
// Opt-in por negocio: `escaneo_corregir_guiones === '1'`. Ausente = apagado.
// ─────────────────────────────────────────────────────────────────────────────

export const EN_LUGAR_DEL_GUION = /['´`’‘‚,]/g;

export const CLAVE_CORREGIR_GUIONES = 'escaneo_corregir_guiones';

/** El código con esos caracteres vueltos guion, o `null` si no hay nada que corregir. */
export function corregirGuiones(codigo) {
  const texto = String(codigo ?? '');
  const corregido = texto.replace(EN_LUGAR_DEL_GUION, '-');
  return corregido !== texto ? corregido : null;
}

export const correccionGuionesActiva = (config) => config?.[CLAVE_CORREGIR_GUIONES] === '1';
