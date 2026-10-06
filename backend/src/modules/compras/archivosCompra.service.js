const repo    = require('./archivosCompra.repository');
const storage = require('../archivos/archivos.storage');

// ─────────────────────────────────────────────────────────────────────────────
// ARCHIVOS DE UNA COMPRA — el manifiesto de importación y sus papeles
// (opt-in `compras_archivos_activo`, AUSENTE = apagado; ver
// migrations/20261006_archivos_compra.sql, que lleva el diseño).
//
// La regla que manda es que NO SE PIERDA:
//   · no hay borrado: lo que no corresponde se ANULA con motivo y sigue guardado;
//   · cancelar la compra no toca sus documentos (se siguen viendo y bajando);
//   · apagar la feature tampoco: al volver a encenderla está todo;
//   · cada archivo se lee de donde se escribió y se comprueba su huella.
//
// Quién: ver y descargar exigen el permiso de VER COMPRAS (un manifiesto trae
// proveedor y precios — por eso el bodeguero de Entradas no entra aquí);
// adjuntar, además, supervisor; anular, solo `admin_negocio`. Las rutas lo
// imponen; aquí va el alcance por negocio y por proveedor.
// ─────────────────────────────────────────────────────────────────────────────

const CLAVE_CONFIG = 'compras_archivos_activo';
const activo = (config) => config?.[CLAVE_CONFIG] === '1';

// La misma lista está en el CHECK de la migración y en
// frontend/src/utils/archivosCompra.js. La suite 73 compara las tres.
const TIPOS_DOCUMENTO = {
  manifiesto:  'Manifiesto de importación',
  declaracion: 'Declaración de importación',
  factura:     'Factura del proveedor',
  empaque:     'Lista de empaque',
  otro:        'Otro documento',
};

const MAX_POR_COMPRA = 20;

// Tope de lo que guarda un negocio. El almacenamiento es compartido entre
// todos: sin tope, uno solo podría llenarlo y dejar a los demás sin poder
// adjuntar. Se puede subir con ARCHIVOS_CUPO_MB_NEGOCIO.
const cupoBytes = () => {
  const mb = Number(process.env.ARCHIVOS_CUPO_MB_NEGOCIO);
  return (Number.isFinite(mb) && mb > 0 ? mb : 300) * 1024 * 1024;
};

const limites = () => ({
  max_bytes:      storage.MAX_BYTES,
  max_por_compra: MAX_POR_COMPRA,
  tipos_archivo:  storage.TIPOS_LEGIBLES,
});

const _mb = (bytes) => `${Math.round(bytes / 1024 / 1024)} MB`;

// ── Validación de lo que escribe la persona ──────────────────────────────────

const _texto = (v, max, etiqueta) => {
  if (v === undefined || v === null) return null;
  const t = String(v).replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (t.length > max) throw { status: 400, message: `${etiqueta} no puede pasar de ${max} caracteres` };
  return t;
};

const _fecha = (v) => {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const t = String(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  // Se arma en UTC y se compara de vuelta: así «2026-02-31» no pasa.
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  if (!d || d.toISOString().slice(0, 10) !== t) {
    throw { status: 400, message: 'La fecha del documento no es válida' };
  }
  return t;
};

// El nombre es solo para mostrarlo y para la descarga: nunca decide dónde se
// guarda (la ruta lleva un UUID) ni cómo se sirve (el tipo sale del contenido).
const _nombre = (v) => {
  const t = String(v || '')
    .replace(/^.*[\\/]/, '')                 // sin carpetas
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"]/g, '')  // sin caracteres de control ni comillas
    .replace(/\s+/g, ' ')
    .trim();
  return (t || 'documento').slice(0, 150);
};

// ── Alcance ──────────────────────────────────────────────────────────────────

// `proveedorIds` es la lista de proveedores que el usuario puede ver (null =
// sin restricción): el mismo recorte que ya aplica el historial de compras.
const _exigirCompra = async (negocioId, compraId, proveedorIds) => {
  const id = Number(compraId);
  if (!Number.isInteger(id) || id < 1) throw { status: 400, message: 'Compra inválida' };
  const compra = await repo.findCompra(id, negocioId);
  if (!compra) throw { status: 404, message: 'Compra no encontrada' };
  if (Array.isArray(proveedorIds) && !proveedorIds.includes(Number(compra.proveedor_id))) {
    throw { status: 403, message: 'Sin acceso a las compras de este proveedor' };
  }
  return compra;
};

// ── Operaciones ──────────────────────────────────────────────────────────────

const listar = async (negocioId, compraId, { proveedorIds = null, conAnulados = false } = {}) => {
  const compra = await _exigirCompra(negocioId, compraId, proveedorIds);
  const archivos = await repo.listar(compra.id, negocioId, { conAnulados });
  return {
    archivos,
    limites: limites(),
    // La pantalla lo usa para decir POR QUÉ no se puede adjuntar, en vez de
    // ofrecer un botón que va a fallar.
    almacenamiento: storage.estaActivo(),
  };
};

const adjuntar = async (negocioId, compraId, {
  usuarioId, proveedorIds = null, buffer, nombre, tipo, numero_documento, fecha_documento, nota,
}) => {
  const compra = await _exigirCompra(negocioId, compraId, proveedorIds);

  if (!storage.estaActivo()) throw { status: 503, message: storage.SIN_ALMACENAMIENTO };
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw { status: 400, message: 'No llegó ningún archivo' };
  }
  if (buffer.length > storage.MAX_BYTES) {
    throw { status: 400, message: `El archivo supera los ${_mb(storage.MAX_BYTES)}` };
  }

  const nombreLimpio = _nombre(nombre);
  const real = storage.detectarTipo(buffer, nombreLimpio);
  if (!real) {
    throw { status: 400, message: `Ese archivo no se puede adjuntar. Se aceptan: ${storage.TIPOS_LEGIBLES}.` };
  }

  const tipoDoc = tipo === undefined || tipo === null || tipo === '' ? 'manifiesto' : String(tipo);
  if (!Object.prototype.hasOwnProperty.call(TIPOS_DOCUMENTO, tipoDoc)) {
    throw { status: 400, message: 'Tipo de documento inválido' };
  }
  const ficha = {
    negocio_id:       negocioId,
    compra_id:        compra.id,
    tipo:             tipoDoc,
    numero_documento: _texto(numero_documento, 60, 'El número del documento'),
    fecha_documento:  _fecha(fecha_documento),
    nota:             _texto(nota, 300, 'La nota'),
    nombre_original:  nombreLimpio,
    mime:             real.mime,
    bytes:            buffer.length,
    sha256:           storage.huella(buffer),
    subido_por:       usuarioId,
  };

  // Todo lo que puede rechazarse se rechaza ANTES de subir: lo subido no se
  // borra, así que un rechazo tardío dejaría un archivo suelto en el bucket.
  const { vigentes, repetidos } = await repo.resumenCompra(compra.id, ficha.sha256);
  if (repetidos > 0) {
    throw { status: 409, code: 'ARCHIVO_DUPLICADO', message: 'Ese mismo archivo ya está adjunto a esta compra' };
  }
  if (vigentes >= MAX_POR_COMPRA) {
    throw { status: 400, message: `Una compra admite hasta ${MAX_POR_COMPRA} archivos` };
  }
  const usado = await repo.bytesDelNegocio(negocioId);
  if (usado + buffer.length > cupoBytes()) {
    throw {
      status: 400, code: 'CUPO_ARCHIVOS',
      message: `Tu negocio llegó al tope de documentos guardados (${_mb(cupoBytes())}). `
        + 'Escríbenos para ampliarlo: lo que ya está guardado no se toca.',
    };
  }

  const donde = await storage.subir(buffer, {
    negocioId, compraId: compra.id, ext: real.ext, mime: real.mime,
  });

  let id;
  try {
    id = await repo.insertar({
      ...ficha, proveedor_storage: donde.proveedor, bucket: donde.bucket, storage_path: donde.path,
    });
  } catch (err) {
    // El doble clic que se coló entre la comprobación y el INSERT: lo ataja el
    // índice único. El segundo archivo queda suelto en el bucket (no se borra
    // nada); se deja escrito dónde.
    console.error(`[archivos-compra] Ficha no guardada; el archivo quedó en ${donde.proveedor}/${donde.bucket}/${donde.path}:`, err?.message);
    if (err?.code === '23505') {
      throw { status: 409, code: 'ARCHIVO_DUPLICADO', message: 'Ese mismo archivo ya está adjunto a esta compra' };
    }
    throw err;
  }

  const guardado = await repo.findFicha(id, negocioId);
  return { ...guardado, compra_numero: compra.numero, sucursal_id: compra.sucursal_id };
};

const _exigirArchivo = async (negocioId, archivoId, proveedorIds) => {
  const id = Number(archivoId);
  if (!Number.isInteger(id) || id < 1) throw { status: 400, message: 'Archivo inválido' };
  const a = await repo.findInterno(id, negocioId);
  if (!a) throw { status: 404, message: 'Archivo no encontrado' };
  if (Array.isArray(proveedorIds) && !proveedorIds.includes(Number(a.proveedor_id))) {
    throw { status: 403, message: 'Sin acceso a las compras de este proveedor' };
  }
  return a;
};

/**
 * Devuelve { ficha, buffer }. Un archivo anulado solo lo baja quien puede ver
 * los anulados (`conAnulados`, el admin): sigue guardado justo para eso.
 */
const descargar = async (negocioId, archivoId, { proveedorIds = null, conAnulados = false } = {}) => {
  const a = await _exigirArchivo(negocioId, archivoId, proveedorIds);
  if (a.anulado && !conAnulados) throw { status: 404, message: 'Archivo no encontrado' };

  const buffer = await storage.descargar({
    proveedor: a.proveedor_storage, bucket: a.bucket, path: a.storage_path,
  });

  // Lo que vuelve tiene que ser lo que se subió. Si no coincide, entregarlo
  // como si nada sería peor que decirlo: es un documento de soporte.
  if (storage.huella(buffer) !== a.sha256) {
    console.error(`[archivos-compra] HUELLA DISTINTA en el archivo ${a.id} (${a.proveedor_storage}/${a.bucket}/${a.storage_path})`);
    throw {
      status: 502, code: 'ARCHIVO_ALTERADO',
      message: 'El archivo guardado no coincide con el que se subió. No se entrega; avísanos para revisarlo.',
    };
  }
  return { ficha: a, buffer };
};

const anular = async (negocioId, archivoId, { usuarioId, motivo }) => {
  const a = await _exigirArchivo(negocioId, archivoId, null);
  const razon = _texto(motivo, 300, 'El motivo');
  if (!razon) throw { status: 400, message: 'Escribe por qué se anula este archivo' };
  if (a.anulado) throw { status: 409, message: 'Ese archivo ya estaba anulado' };

  const hecho = await repo.anular(a.id, negocioId, { usuarioId, motivo: razon });
  if (!hecho) throw { status: 409, message: 'Ese archivo ya estaba anulado' };
  return repo.findFicha(a.id, negocioId);
};

module.exports = {
  CLAVE_CONFIG, activo, TIPOS_DOCUMENTO, MAX_POR_COMPRA, limites,
  listar, adjuntar, descargar, anular,
};
