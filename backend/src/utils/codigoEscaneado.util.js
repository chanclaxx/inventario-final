// ─────────────────────────────────────────────────────────────────────────────
// EL LECTOR ESCRIBE CON TECLADO GRINGO — y el computador está en español.
//
// Un lector USB/Bluetooth no manda texto: manda TECLAS, como si fuera un teclado
// en inglés (EE. UU.). Windows las traduce con la distribución del computador.
// En un teclado español (España o Latinoamérica) la tecla donde el inglés tiene
// el guion `-` escribe un apóstrofo `'`, así que la etiqueta `ACC-AUD-001` llega
// al campo como `ACC'AUD'001` y «no existe» (reportado desde un cliente,
// sep-2026). Letras y números no cambian: solo la puntuación.
//
// La cura de raíz es configurar el LECTOR en el idioma del teclado (su manual
// trae un código de barras «Keyboard language → Spanish / Latin America»).
// Esto es la red de seguridad para cuando nadie lo ha hecho: si el código tal
// cual no existe, se prueba con esos caracteres convertidos en guion.
//
// Es SOLO un reintento: el código se busca primero exactamente como llegó, así
// que un código que de verdad lleve uno de estos caracteres sigue resolviendo
// igual que siempre.
//
// OPT-IN POR NEGOCIO (`config_negocio.escaneo_corregir_guiones`, AUSENTE =
// APAGADO; Ajustes → Código único): hay muchos negocios en la misma base y
// este es el problema de UNO. Apagado, escanear se comporta exactamente como
// antes. La clave se lee solo DESPUÉS de un «no encontrado», así que el escaneo
// que sí encuentra no paga ni una consulta más.
//
// `frontend/src/utils/codigoEscaneado.js` es la copia del navegador (el atajo
// local del carrito). Si cambia la lista, cambian las dos.
// ─────────────────────────────────────────────────────────────────────────────

// Apóstrofo (distribución española), acento agudo y grave (teclas muertas),
// comillas tipográficas y coma: lo que se ha visto llegar en lugar del guion.
const EN_LUGAR_DEL_GUION = /['´`’‘‚,]/g;

/**
 * El código con los caracteres que produce el choque de teclado vueltos guion,
 * o `null` si no hay nada que corregir.
 */
const corregirGuiones = (codigo) => {
  const texto = String(codigo ?? '');
  const corregido = texto.replace(EN_LUGAR_DEL_GUION, '-');
  return corregido !== texto ? corregido : null;
};

const CLAVE = 'escaneo_corregir_guiones';

/** ¿El negocio encendió la corrección? Ausente o cualquier cosa ≠ '1' = no. */
const correccionActiva = async (db, negocioId) => {
  const { rows } = await db.query(
    'SELECT valor FROM config_negocio WHERE negocio_id = $1 AND clave = $2',
    [negocioId, CLAVE]
  );
  return rows[0]?.valor === '1';
};

/**
 * El código a reintentar tras un «no encontrado», o `null` si no hay reintento
 * (feature apagada o nada que corregir). Primero mira el texto —gratis— y solo
 * consulta la configuración si de verdad hay algo que corregir.
 */
const codigoParaReintento = async (db, negocioId, codigo) => {
  const corregido = corregirGuiones(codigo);
  if (!corregido) return null;
  return (await correccionActiva(db, negocioId)) ? corregido : null;
};

module.exports = {
  corregirGuiones, correccionActiva, codigoParaReintento, EN_LUGAR_DEL_GUION, CLAVE,
};
