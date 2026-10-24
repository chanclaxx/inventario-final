// ─────────────────────────────────────────────────────────────────────────────
// FOTOS DE UNA GARANTÍA — la prueba que pide el proveedor (pantalla rota,
// humedad, el sello, la caja). Ver migrations/20261024_reclamos_garantia_fase2.sql.
//
// Mismo almacenamiento PRIVADO y mismas reglas que los documentos de las
// compras (`archivos/archivos.storage.js`, `compras/archivosCompra.service.js`):
//   · nada tiene URL: el archivo solo sale por el backend, con sesión;
//   · el tipo lo decide el CONTENIDO (aquí solo imágenes y PDF);
//   · se guarda dónde quedó y su huella, y al descargar se comprueba;
//   · NO HAY BORRADO: lo que no corresponde se anula con motivo.
// Sin la migración o sin almacenamiento configurado, apagado (la fase 1 igual).
// ─────────────────────────────────────────────────────────────────────────────

const { pool } = require('../../config/db');
const storage = require('../archivos/archivos.storage');
const { hayReclamosFase2 } = require('../../config/columnas');

const MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const MAX_POR_CASO = 12;

const activas = () => hayReclamosFase2() && storage.estaActivo();

const _exigirActivas = () => {
  if (!hayReclamosFase2()) throw { status: 404, message: 'Las fotos de garantía no están instaladas' };
  if (!storage.estaActivo()) throw { status: 503, message: storage.SIN_ALMACENAMIENTO };
};

const _exigirCaso = async (user, reclamoId) => {
  const { rows } = await pool.query(
    'SELECT id, sucursal_id, anulado FROM reclamos_garantia WHERE id = $1 AND negocio_id = $2', [reclamoId, user.negocio_id]);
  const r = rows[0];
  if (!r) throw { status: 404, message: 'Garantía no encontrada' };
  if (user.rol !== 'admin_negocio' && Number(user.sucursal_id) !== Number(r.sucursal_id)) {
    throw { status: 403, message: 'Esta garantía es de otra sucursal' };
  }
  return r;
};

const _nombre = (v) => {
  const t = String(v || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 150);
  return t || 'foto';
};

/** Adjunta una foto (o PDF). Todo se valida ANTES de subir: lo subido no se borra. */
const adjuntar = async (user, reclamoId, archivo, { nota = null } = {}) => {
  _exigirActivas();
  const r = await _exigirCaso(user, Number(reclamoId));
  if (r.anulado) throw { status: 409, message: 'La garantía está anulada' };
  if (!archivo?.buffer?.length) throw { status: 400, message: 'Elige la foto que vas a adjuntar' };
  if (archivo.buffer.length > storage.MAX_BYTES) {
    throw { status: 400, message: `La foto supera los ${Math.round(storage.MAX_BYTES / 1024 / 1024)} MB` };
  }
  const tipo = storage.detectarTipo(archivo.buffer, archivo.originalname);
  if (!tipo || !MIMES.has(tipo.mime)) {
    throw { status: 400, message: 'Solo se aceptan fotos (JPG, PNG, WebP) o un PDF' };
  }
  const { rows: cuenta } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM reclamos_garantia_archivos WHERE reclamo_id = $1 AND NOT anulado', [r.id]);
  if (cuenta[0].n >= MAX_POR_CASO) throw { status: 409, message: `Una garantía admite hasta ${MAX_POR_CASO} fotos` };
  const sha = storage.huella(archivo.buffer);
  const { rows: igual } = await pool.query(
    'SELECT id FROM reclamos_garantia_archivos WHERE reclamo_id = $1 AND sha256 = $2 AND NOT anulado', [r.id, sha]);
  if (igual.length) throw { status: 409, message: 'Esa misma foto ya está en esta garantía' };

  const donde = await storage.subir(archivo.buffer, {
    negocioId: user.negocio_id, carpeta: `garantia_${r.id}`, ext: tipo.ext, mime: tipo.mime,
  });
  try {
    const { rows } = await pool.query(`
      INSERT INTO reclamos_garantia_archivos
        (negocio_id, reclamo_id, nombre_original, mime, extension, tamano_bytes, sha256,
         proveedor_storage, bucket, storage_path, nota, usuario_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING id, nombre_original, mime, tamano_bytes, nota, fecha, anulado
    `, [user.negocio_id, r.id, _nombre(archivo.originalname), tipo.mime, tipo.ext, archivo.buffer.length, sha,
      donde.proveedor, donde.bucket, donde.path, nota ? String(nota).slice(0, 300) : null, user.id]);
    return rows[0];
  } catch (err) {
    // El doble clic que pasó la revisión: el índice único lo frena. El archivo
    // ya subido queda huérfano en el bucket (no se borra nada, por regla).
    if (err?.code === '23505') throw { status: 409, message: 'Esa misma foto ya está en esta garantía' };
    throw err;
  }
};

const _exigirArchivo = async (user, archivoId) => {
  const { rows } = await pool.query(`
    SELECT a.*, r.sucursal_id FROM reclamos_garantia_archivos a JOIN reclamos_garantia r ON r.id = a.reclamo_id
    WHERE a.id = $1 AND a.negocio_id = $2`, [archivoId, user.negocio_id]);
  const a = rows[0];
  if (!a) throw { status: 404, message: 'Foto no encontrada' };
  if (user.rol !== 'admin_negocio' && Number(user.sucursal_id) !== Number(a.sucursal_id)) {
    throw { status: 403, message: 'Esta foto es de otra sucursal' };
  }
  return a;
};

/** Devuelve { buffer, mime, nombre }. Comprueba la huella antes de entregar. */
const descargar = async (user, archivoId) => {
  if (!hayReclamosFase2()) throw { status: 404, message: 'Las fotos de garantía no están instaladas' };
  const a = await _exigirArchivo(user, Number(archivoId));
  if (a.anulado && user.rol !== 'admin_negocio') throw { status: 404, message: 'La foto está anulada' };
  const buffer = await storage.descargar({ proveedor: a.proveedor_storage, bucket: a.bucket, path: a.storage_path });
  if (storage.huella(buffer) !== a.sha256) {
    throw { status: 502, code: 'ARCHIVO_ALTERADO', message: 'El archivo guardado no coincide con el original: no se entrega' };
  }
  return { buffer, mime: a.mime, nombre: a.nombre_original };
};

const anular = async (user, archivoId, motivo) => {
  if (!hayReclamosFase2()) throw { status: 404, message: 'Las fotos de garantía no están instaladas' };
  const texto = String(motivo || '').trim().slice(0, 300);
  if (texto.length < 3) throw { status: 400, message: 'Escribe por qué anulas esta foto' };
  const a = await _exigirArchivo(user, Number(archivoId));
  if (a.anulado) throw { status: 409, message: 'La foto ya está anulada' };
  await pool.query(`
    UPDATE reclamos_garantia_archivos SET anulado = true, anulado_motivo = $2, anulado_por = $3, anulado_en = NOW()
    WHERE id = $1`, [a.id, texto, user.id]);
  return { id: a.id, anulado: true, anulado_motivo: texto };
};

module.exports = { activas, adjuntar, descargar, anular, MAX_POR_CASO };
