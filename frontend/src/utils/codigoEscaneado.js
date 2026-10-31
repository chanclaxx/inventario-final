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

/**
 * ¿El código escaneado deja elegir QUÉ se vende, o hay que pedir la variante?
 *
 * Con «Variantes» encendida, el código de un producto CON tallas (o de una talla
 * con colores) es un contenedor: no dice cuál se vende. Pero un producto SIN
 * tallas —un cargador, un case— se vende entero aunque la feature esté
 * encendida; antes se rechazaban todos («no tiene variantes activas»).
 * `tiene_hijos` lo manda el backend (`/busqueda/escaneo`). Sin esa clave (un
 * backend anterior) el código de producto conserva la regla de siempre.
 */
export function nodoPideVariante(nodo, variantesActivo) {
  if (!nodo) return false;
  if (nodo.variante_id) return false;
  if (nodo.atributo_id) return nodo.tiene_hijos === true;
  return !!variantesActivo && nodo.tiene_hijos !== false;
}
