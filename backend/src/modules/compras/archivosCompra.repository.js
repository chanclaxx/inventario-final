const { pool } = require('../../config/db');

// Todo lo de aquí nombra `archivos_compra`: nadie lo llama sin haber pasado
// antes por `hayArchivosCompra()` (lo comprueba el candado de las rutas).
//
// NO HAY NINGÚN DELETE EN ESTE ARCHIVO, y no debe aparecer: un documento que no
// corresponde se anula. La suite 73 lo vigila.

// La compra, con el alcance de negocio DENTRO de la consulta. Sin JOIN a
// proveedores: una Entrada de bodega sin confirmar todavía no tiene proveedor,
// y con INNER JOIN simplemente no existiría.
const findCompra = async (compraId, negocioId) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.numero, c.proveedor_id, c.sucursal_id, c.estado
     FROM compras c
     JOIN sucursales s ON s.id = c.sucursal_id
     WHERE c.id = $1 AND s.negocio_id = $2`,
    [compraId, negocioId]
  );
  return rows[0] || null;
};

// Lo que ve la pantalla. La ruta del almacenamiento NO viaja: es interna, y el
// archivo solo sale por el endpoint de descarga.
// `fecha_documento` es DATE: se formatea en SQL, porque node-postgres lo
// devuelve como Date y la zona del servidor lo correría un día.
const COLUMNAS_FICHA = `
  a.id, a.compra_id, a.tipo, a.numero_documento,
  to_char(a.fecha_documento, 'YYYY-MM-DD') AS fecha_documento,
  a.nota, a.nombre_original, a.mime, a.bytes, a.creado_en,
  us.nombre AS subido_por_nombre,
  a.anulado, a.anulado_en, a.motivo_anulacion,
  ua.nombre AS anulado_por_nombre`;

const listar = async (compraId, negocioId, { conAnulados = false } = {}) => {
  const { rows } = await pool.query(
    `SELECT ${COLUMNAS_FICHA}
     FROM archivos_compra a
     LEFT JOIN usuarios us ON us.id = a.subido_por
     LEFT JOIN usuarios ua ON ua.id = a.anulado_por
     WHERE a.compra_id = $1 AND a.negocio_id = $2
       ${conAnulados ? '' : 'AND NOT a.anulado'}
     ORDER BY a.anulado, a.creado_en, a.id`,
    [compraId, negocioId]
  );
  return rows;
};

const findFicha = async (archivoId, negocioId) => {
  const { rows } = await pool.query(
    `SELECT ${COLUMNAS_FICHA}
     FROM archivos_compra a
     LEFT JOIN usuarios us ON us.id = a.subido_por
     LEFT JOIN usuarios ua ON ua.id = a.anulado_por
     WHERE a.id = $1 AND a.negocio_id = $2`,
    [archivoId, negocioId]
  );
  return rows[0] || null;
};

// La ficha completa, con dónde está guardado. Solo para el service.
const findInterno = async (archivoId, negocioId) => {
  const { rows } = await pool.query(
    `SELECT a.*, c.proveedor_id
     FROM archivos_compra a
     JOIN compras c ON c.id = a.compra_id
     WHERE a.id = $1 AND a.negocio_id = $2`,
    [archivoId, negocioId]
  );
  return rows[0] || null;
};

// Vigentes de la compra y si ya está este mismo archivo (por su huella).
const resumenCompra = async (compraId, sha256) => {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS vigentes,
            COUNT(*) FILTER (WHERE sha256 = $2)::int AS repetidos
     FROM archivos_compra
     WHERE compra_id = $1 AND NOT anulado`,
    [compraId, sha256]
  );
  return rows[0];
};

// Lo que ocupa el negocio. Cuenta también lo anulado: sigue guardado.
const bytesDelNegocio = async (negocioId) => {
  const { rows } = await pool.query(
    'SELECT COALESCE(SUM(bytes), 0)::bigint AS bytes FROM archivos_compra WHERE negocio_id = $1',
    [negocioId]
  );
  return Number(rows[0].bytes);
};

const insertar = async (f) => {
  const { rows } = await pool.query(
    `INSERT INTO archivos_compra
       (negocio_id, compra_id, tipo, numero_documento, fecha_documento, nota,
        nombre_original, mime, bytes, sha256,
        proveedor_storage, bucket, storage_path, subido_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id`,
    [f.negocio_id, f.compra_id, f.tipo, f.numero_documento, f.fecha_documento, f.nota,
     f.nombre_original, f.mime, f.bytes, f.sha256,
     f.proveedor_storage, f.bucket, f.storage_path, f.subido_por]
  );
  return rows[0].id;
};

// `AND NOT anulado` en el UPDATE: dos clics no pisan el motivo ni la fecha del
// primero. Devuelve false si ya estaba anulado.
const anular = async (archivoId, negocioId, { usuarioId, motivo }) => {
  const { rowCount } = await pool.query(
    `UPDATE archivos_compra
     SET anulado = TRUE, anulado_por = $3, anulado_en = NOW(), motivo_anulacion = $4
     WHERE id = $1 AND negocio_id = $2 AND NOT anulado`,
    [archivoId, negocioId, usuarioId, motivo]
  );
  return rowCount > 0;
};

module.exports = {
  findCompra, listar, findFicha, findInterno, resumenCompra, bytesDelNegocio, insertar, anular,
};
