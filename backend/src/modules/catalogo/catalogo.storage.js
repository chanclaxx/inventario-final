const crypto = require('crypto');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

// ─────────────────────────────────────────────────────────────────────────────
// Almacenamiento de las fotos del catálogo en Cloudflare R2.
//
// POR QUÉ R2 Y NO SUPABASE STORAGE (decisión de 3-ago-2026):
//
// La base de datos vive en Supabase con plan gratuito, cuyo cupo de salida
// (~5 GB/mes) es COMPARTIDO entre el storage y la base de datos — la misma que
// corre la facturación de todos los negocios. Un catálogo de fotos consume ese
// cupo rapidísimo: una visita con scroll son ~10 MB, y un enlace compartido en
// un grupo grande de WhatsApp puede gastar cientos de MB en una tarde.
//
// El riesgo no era el costo: era que un catálogo viral hiciera que Supabase
// restringiera el proyecto y con él el punto de venta.
//
// R2 no cobra salida. Por más que un enlace se viralice, no toca el cupo de
// Supabase ni genera factura. Es el perfil exacto de esta feature: pocos
// archivos, muchas lecturas.
//
// Sin las variables R2_* el módulo queda apagado: se pueden publicar productos
// sin foto y el resto del catálogo funciona igual.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_BYTES = 5 * 1024 * 1024;   // el navegador ya comprime a ~200 KB; esto es el techo

const BUCKET = process.env.R2_BUCKET || 'catalogo';

// R2 necesita las cuatro: sin cualquiera de ellas no se puede ni subir ni
// construir la URL pública, así que la feature se apaga entera en vez de
// dejar fotos subidas que nadie puede ver.
const estaActivo = () => Boolean(
  process.env.R2_ACCOUNT_ID &&
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  process.env.R2_PUBLIC_URL
);

let _cliente = null;
const _getCliente = () => {
  if (!_cliente) {
    _cliente = new S3Client({
      region:   'auto',   // R2 no tiene regiones; 'auto' es lo que espera su API
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId:     process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return _cliente;
};

// Los objetos de R2 no son públicos por sí solos: se exponen a través de un
// dominio propio conectado al bucket en Cloudflare. Esa es R2_PUBLIC_URL.
const _urlPublica = (path) =>
  `${process.env.R2_PUBLIC_URL.replace(/\/+$/, '')}/${path}`;

// ── Validación por contenido real, no por lo que declara el cliente ─────────
//
// El `mimetype` de multer es texto que manda el navegador: se puede falsificar.
// Un .php renombrado a .jpg pasaría ese filtro y quedaría alojado en un bucket
// público. Por eso el tipo se decide leyendo los primeros bytes del archivo.
const FIRMAS = [
  { ext: 'jpg',  mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png',  mime: 'image/png',  test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  {
    ext: 'webp', mime: 'image/webp',
    test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF'
              && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

/**
 * Detecta el tipo real de la imagen. Devuelve null si no es una de las tres
 * permitidas — el llamador responde 400.
 */
const detectarTipo = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  return FIRMAS.find((f) => f.test(buffer)) || null;
};

/**
 * Sube una imagen y devuelve { storage_path, url, bytes }.
 * Lanza { status, message } — el errorHandler del sistema lo traduce.
 */
const subir = async (buffer, { negocioId, itemId }) => {
  if (!estaActivo()) {
    throw {
      status: 503,
      message: 'El almacenamiento de imágenes no está configurado. Faltan las variables R2_*.',
    };
  }
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw { status: 400, message: 'El archivo llegó vacío' };
  }
  if (buffer.length > MAX_BYTES) {
    throw { status: 400, message: 'La imagen supera los 5 MB' };
  }

  const tipo = detectarTipo(buffer);
  if (!tipo) {
    throw { status: 400, message: 'Solo se aceptan imágenes JPG, PNG o WebP' };
  }

  // La extensión sale del contenido detectado, no del nombre que mandó el
  // cliente: así un nombre malicioso no puede decidir cómo se sirve el archivo.
  const path = `negocio_${negocioId}/item_${itemId}/${crypto.randomUUID()}.${tipo.ext}`;

  try {
    await _getCliente().send(new PutObjectCommand({
      Bucket:       BUCKET,
      Key:          path,
      Body:         buffer,
      ContentType:  tipo.mime,
      // El nombre lleva UUID, así que el archivo nunca cambia: se puede cachear
      // para siempre. Esto es lo que hace que las visitas repetidas no cuesten.
      CacheControl: 'public, max-age=31536000, immutable',
    }));
  } catch (err) {
    // El caso más común en la primera instalación: el bucket todavía no existe
    // o las llaves son de otra cuenta.
    const pista = /NoSuchBucket|NotFound/i.test(err.name || err.message || '')
      ? ` Verifica que exista el bucket "${BUCKET}" en Cloudflare R2.`
      : /Forbidden|InvalidAccessKeyId|SignatureDoesNotMatch/i.test(err.name || err.message || '')
        ? ' Revisa R2_ACCESS_KEY_ID y R2_SECRET_ACCESS_KEY.'
        : '';
    console.error('[catalogo.storage] Error al subir:', err.name, err.message);
    throw { status: 502, message: `No se pudo subir la imagen.${pista}` };
  }

  return { storage_path: path, url: _urlPublica(path), bytes: buffer.length };
};

/**
 * Borra del bucket. Best-effort a propósito: si el archivo ya no está, la fila
 * de la BD igual debe poder eliminarse — quedarse con una foto fantasma en la
 * vitrina es peor que dejar un huérfano en el bucket.
 */
const borrar = async (storagePath) => {
  if (!estaActivo() || !storagePath) return false;
  try {
    await _getCliente().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: storagePath }));
    return true;
  } catch (err) {
    console.warn('⚠️  No se pudo borrar la imagen del catálogo:', err.message);
    return false;
  }
};

module.exports = { estaActivo, subir, borrar, detectarTipo, BUCKET, MAX_BYTES };
