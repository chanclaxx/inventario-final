const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────────────────────
// Almacenamiento PRIVADO de documentos (el manifiesto de importación de una
// compra y sus papeles).
//
// NO ES EL DEL CATÁLOGO, y no puede serlo: `catalogo.storage.js` sube a un
// bucket que se sirve por un dominio PÚBLICO (R2_PUBLIC_URL) con caché de un
// año. Un manifiesto trae proveedor, cantidades y precios de compra: en ese
// bucket quedaría a un enlace de distancia de cualquiera. Aquí nada tiene URL:
// el archivo solo sale por el backend, con sesión y con el permiso de ver
// compras.
//
// DOS PROVEEDORES, y cada archivo recuerda el suyo:
//
//   · r2        Cloudflare R2, en un bucket PRIVADO propio. Se activa con las
//               credenciales R2_* de siempre MÁS `R2_BUCKET_DOCUMENTOS`, que
//               hay que escribir a propósito: sin esa variable no se adivina un
//               nombre, y si coincide con el bucket del catálogo se rechaza.
//   · supabase  Supabase Storage, bucket privado (`SUPABASE_BUCKET_DOCUMENTOS`,
//               por defecto «documentos-compras»; se crea solo si no existe).
//               Son las mismas credenciales del backup, que ya están puestas.
//               Sirve porque estos archivos se suben una vez y se abren muy de
//               vez en cuando: no es el perfil de un catálogo viral, que es lo
//               que hizo descartar Supabase para las fotos.
//
// R2 gana cuando está configurado. La ficha de cada archivo guarda proveedor,
// bucket y ruta, y `descargar` lee de ahí: cambiar de proveedor mañana NO deja
// huérfano lo que ya se subió — siempre que las credenciales viejas sigan
// puestas, que es lo único que hay que conservar.
//
// NO HAY `borrar`, y es a propósito: un documento que no corresponde se anula
// en la base y el archivo se queda donde está.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_BYTES = 15 * 1024 * 1024;

// ── Tipos aceptados, decididos por el CONTENIDO ──────────────────────────────
//
// El `mimetype` de multer lo escribe el navegador y la extensión la escribe el
// usuario: ninguno decide. Los primeros bytes sí. Los formatos de Office
// comparten firma entre ellos (un .xlsx y un .docx son los dos un ZIP), así que
// ahí —y solo ahí— la extensión desempata, entre opciones que ya pasaron la
// firma.
const _empieza = (b, bytes) => b.length >= bytes.length && bytes.every((x, i) => b[i] === x);
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const TIPOS = [
  { ext: 'pdf',  mime: 'application/pdf', test: (b) => _empieza(b, [0x25, 0x50, 0x44, 0x46, 0x2d]) },
  { ext: 'jpg',  mime: 'image/jpeg',      test: (b) => _empieza(b, [0xff, 0xd8, 0xff]) },
  { ext: 'png',  mime: 'image/png',       test: (b) => _empieza(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  {
    ext: 'webp', mime: 'image/webp',
    test: (b) => b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF'
              && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    test: (b, ext) => ext === 'xlsx' && _empieza(b, ZIP),
  },
  {
    ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    test: (b, ext) => ext === 'docx' && _empieza(b, ZIP),
  },
  { ext: 'xls',  mime: 'application/vnd.ms-excel', test: (b, ext) => ext === 'xls' && _empieza(b, OLE) },
  { ext: 'doc',  mime: 'application/msword',       test: (b, ext) => ext === 'doc' && _empieza(b, OLE) },
];

const TIPOS_LEGIBLES = 'PDF, imagen (JPG, PNG, WebP), Excel o Word';

const _extension = (nombre) => {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(String(nombre || '').trim());
  return m ? m[1].toLowerCase() : '';
};

/** El tipo REAL del archivo, o null si no es uno de los aceptados. */
const detectarTipo = (buffer, nombre) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null;
  const ext = _extension(nombre);
  const t = TIPOS.find((x) => x.test(buffer, ext));
  return t ? { ext: t.ext, mime: t.mime } : null;
};

const huella = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

// ── Proveedores ──────────────────────────────────────────────────────────────

const _bucketCatalogo = () => process.env.R2_BUCKET || 'catalogo';

const _r2 = {
  nombre: 'r2',
  bucket: () => String(process.env.R2_BUCKET_DOCUMENTOS || '').trim(),
  // Leer solo necesita las credenciales: el bucket lo dice la ficha del archivo.
  puedeLeer: () => Boolean(
    process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY
  ),
  activo() {
    const b = this.bucket();
    // El bucket del catálogo es PÚBLICO: jamás se escribe un documento ahí.
    return this.puedeLeer() && Boolean(b) && b !== _bucketCatalogo();
  },
  _cliente: null,
  cliente() {
    if (!this._cliente) {
      const { S3Client } = require('@aws-sdk/client-s3');
      this._cliente = new S3Client({
        region:   'auto',
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId:     process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
      });
    }
    return this._cliente;
  },
  async subir({ bucket, path, buffer, mime }) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await this.cliente().send(new PutObjectCommand({
      Bucket: bucket, Key: path, Body: buffer, ContentType: mime,
    }));
  },
  async descargar({ bucket, path }) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const r = await this.cliente().send(new GetObjectCommand({ Bucket: bucket, Key: path }));
    return Buffer.from(await r.Body.transformToByteArray());
  },
};

const _supabase = {
  nombre: 'supabase',
  bucket: () => String(process.env.SUPABASE_BUCKET_DOCUMENTOS || 'documentos-compras').trim(),
  activo: () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY),
  puedeLeer() { return this.activo(); },
  _cliente: null,
  _bucketsListos: new Set(),
  cliente() {
    if (!this._cliente) {
      const { createClient } = require('@supabase/supabase-js');
      this._cliente = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    }
    return this._cliente;
  },
  // El bucket se crea PRIVADO la primera vez. «Ya existe» no es un error; y
  // cualquier otro fallo se deja pasar: si de verdad no hay bucket, el upload
  // que viene lo dirá con un mensaje mejor.
  async _asegurarBucket(bucket) {
    if (this._bucketsListos.has(bucket)) return;
    try {
      await this.cliente().storage.createBucket(bucket, { public: false });
    } catch { /* se intenta el upload igual */ }
    this._bucketsListos.add(bucket);
  },
  async subir({ bucket, path, buffer, mime }) {
    await this._asegurarBucket(bucket);
    const { error } = await this.cliente().storage.from(bucket)
      .upload(path, buffer, { contentType: mime, upsert: false });
    if (error) throw new Error(error.message);
  },
  async descargar({ bucket, path }) {
    const { data, error } = await this.cliente().storage.from(bucket).download(path);
    if (error || !data) throw new Error(error?.message || 'sin contenido');
    return Buffer.from(await data.arrayBuffer());
  },
};

const PROVEEDORES = { r2: _r2, supabase: _supabase };

// Solo para pruebas: proveedores en memoria, para no tocar ningún bucket real.
// El que se pasa queda ACTIVO (null = ninguno) y todos los que se hayan pasado
// siguen siendo legibles por su nombre — igual que un proveedor real del que
// ya no se escribe pero del que todavía se lee.
let _dePrueba = null;
const _registradosPrueba = {};
const _setProveedorPrueba = (p) => {
  _dePrueba = p || null;
  if (p) _registradosPrueba[p.nombre] = p;
};

/** El proveedor donde se escribe HOY. null = almacenamiento sin configurar. */
const proveedorActivo = () => {
  if (_dePrueba) return _dePrueba;
  if (_r2.activo()) return _r2;
  if (_supabase.activo()) return _supabase;
  return null;
};

const estaActivo = () => proveedorActivo() !== null;

// Lo lee el dueño de una tienda, no quien administra el servidor: qué
// variables faltan está en el comentario de arriba y en CLAUDE.md.
const SIN_ALMACENAMIENTO = 'El almacenamiento de documentos no está configurado en el servidor. '
  + 'Escríbenos para activarlo.';

/**
 * Sube el archivo y devuelve dónde quedó: { proveedor, bucket, path }.
 * La ruta lleva un UUID: nunca pisa otro archivo ni depende del nombre que
 * escribió el usuario. Lanza { status, message }.
 */
const subir = async (buffer, { negocioId, compraId, ext, mime }) => {
  const prov = proveedorActivo();
  if (!prov) throw { status: 503, message: SIN_ALMACENAMIENTO };

  const bucket = prov.bucket();
  const path = `negocio_${negocioId}/compra_${compraId}/${crypto.randomUUID()}.${ext}`;
  try {
    await prov.subir({ bucket, path, buffer, mime });
  } catch (err) {
    console.error(`[archivos.storage] No se pudo subir a ${prov.nombre}/${bucket}:`, err?.name, err?.message);
    throw {
      status: 502,
      message: 'No se pudo guardar el archivo en el almacenamiento. No se adjuntó nada: intenta de nuevo.',
    };
  }
  return { proveedor: prov.nombre, bucket, path };
};

/**
 * Lee un archivo de DONDE SE ESCRIBIÓ (lo dice su ficha), no del proveedor
 * activo de hoy. Lanza { status, message }.
 */
const descargar = async ({ proveedor, bucket, path }) => {
  const dePrueba = _registradosPrueba[proveedor] || null;
  const prov = dePrueba || PROVEEDORES[proveedor];
  if (!prov) {
    throw { status: 500, message: `Este archivo está en un almacenamiento que el servidor no conoce (${proveedor}).` };
  }
  if (!dePrueba && !prov.puedeLeer()) {
    throw {
      status: 503,
      message: `El archivo sigue guardado en ${proveedor}, pero el servidor ya no tiene las credenciales para leerlo.`,
    };
  }
  try {
    return await prov.descargar({ bucket, path });
  } catch (err) {
    console.error(`[archivos.storage] No se pudo leer ${proveedor}/${bucket}/${path}:`, err?.name, err?.message);
    throw { status: 502, message: 'No se pudo leer el archivo del almacenamiento. Intenta de nuevo en un momento.' };
  }
};

module.exports = {
  estaActivo, proveedorActivo, subir, descargar, detectarTipo, huella,
  MAX_BYTES, TIPOS_LEGIBLES, SIN_ALMACENAMIENTO, _setProveedorPrueba,
};
