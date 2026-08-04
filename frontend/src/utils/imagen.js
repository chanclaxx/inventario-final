// ─────────────────────────────────────────────────────────────────────────────
// Compresión de imágenes EN EL NAVEGADOR, antes de subirlas.
//
// Por qué aquí y no en el servidor:
//   1. Evita `sharp` en el backend. Es una dependencia nativa pesada, con
//      historial de problemas de build en contenedores, y la instalación en
//      Railway ya es delicada (pnpm con --config.package-manager-strict=false).
//   2. Sube ~10× más rápido por datos móviles, que es la conexión real del
//      vendedor que toma la foto con el celular en el local.
//
// Una foto de 4 MB del celular sale de aquí pesando ~150-250 KB sin diferencia
// visible en una vitrina.
//
// El backend NO confía en esto: valida el tipo real por magic bytes y el tamaño
// otra vez. Esto es una optimización, no un control de seguridad.
// ─────────────────────────────────────────────────────────────────────────────

const LADO_MAXIMO = 1600;   // px del lado mayor
const CALIDAD     = 0.82;   // WebP a 0,82 es indistinguible del original en pantalla

/** Tipos que aceptamos como entrada. El backend acepta exactamente los mismos. */
const TIPOS_VALIDOS = ['image/jpeg', 'image/png', 'image/webp'];

export const esImagenValida = (file) =>
  Boolean(file) && TIPOS_VALIDOS.includes(file.type);

const _cargarImagen = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
  img.src = url;
});

const _aBlob = (canvas, tipo, calidad) => new Promise((resolve, reject) => {
  canvas.toBlob(
    (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo procesar la imagen'))),
    tipo,
    calidad
  );
});

/**
 * Redimensiona y comprime. Devuelve { blob, nombre }.
 *
 * Degrada con elegancia: si el navegador no soporta WebP (Safari viejo), cae a
 * JPEG, que el backend también acepta. Nunca devuelve el archivo sin tocar
 * salvo que ya sea más pequeño que el resultado.
 */
export const comprimirImagen = async (file) => {
  if (!esImagenValida(file)) {
    throw new Error('Solo se aceptan imágenes JPG, PNG o WebP');
  }

  const img = await _cargarImagen(file);

  const escala = Math.min(1, LADO_MAXIMO / Math.max(img.width, img.height));
  const ancho  = Math.round(img.width  * escala);
  const alto   = Math.round(img.height * escala);

  const canvas = document.createElement('canvas');
  canvas.width  = ancho;
  canvas.height = alto;

  const ctx = canvas.getContext('2d');
  // Fondo blanco: un PNG con transparencia sobre WebP/JPEG saldría con el
  // canal alfa en negro, y una foto de producto con bordes negros se ve mal.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ancho, alto);
  ctx.drawImage(img, 0, 0, ancho, alto);

  let blob   = await _aBlob(canvas, 'image/webp', CALIDAD);
  let ext    = 'webp';

  // toBlob ignora el tipo pedido si no lo soporta y devuelve PNG, que pesa más
  // que el original. En ese caso se reintenta con JPEG.
  if (!blob || blob.type !== 'image/webp') {
    blob = await _aBlob(canvas, 'image/jpeg', CALIDAD);
    ext  = 'jpg';
  }

  // Si comprimir no ayudó (imagen ya pequeña y optimizada), se manda la original.
  if (blob.size >= file.size && file.size <= 1024 * 1024) {
    return { blob: file, nombre: file.name || `foto.${ext}` };
  }

  const base = (file.name || 'foto').replace(/\.[^.]+$/, '');
  return { blob, nombre: `${base}.${ext}` };
};
