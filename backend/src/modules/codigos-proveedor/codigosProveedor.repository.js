const { pool } = require('../../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// CÓDIGOS DEL PROVEEDOR ↔ CÓDIGO INTERNO
//
// La equivalencia apunta al CÓDIGO INTERNO, no al producto_id. Un proveedor le
// vende al NEGOCIO, pero `productos_cantidad` tiene una fila por sucursal: el
// mismo producto lógico vive en N filas. Con producto_id harían falta N filas
// por equivalencia y a la primera sucursal nueva empezarían a derivar.
//
// La resolución a la sucursal concreta es el ÚLTIMO paso:
//   codigo_proveedor → codigo_interno → productos_cantidad (sucursal, activo)
// ─────────────────────────────────────────────────────────────────────────────

const findByProveedor = async (negocioId, proveedorId) => {
  const { rows } = await pool.query(`
    SELECT cp.*, u.nombre AS usuario_nombre
    FROM      codigos_proveedor cp
    LEFT JOIN usuarios u ON u.id = cp.usuario_id
    WHERE cp.negocio_id = $1 AND cp.proveedor_id = $2
    ORDER BY cp.codigo_proveedor
  `, [negocioId, proveedorId]);
  return rows;
};

/**
 * Cómo llama CADA proveedor a un producto tuyo. La búsqueda inversa.
 * Devuelve varias filas a propósito: tres proveedores venden el mismo cargador
 * con tres referencias distintas, y esa es justamente la información que se
 * quiere guardar.
 */
const findByCodigoInterno = async (negocioId, codigoInterno) => {
  const { rows } = await pool.query(`
    SELECT cp.*, p.nombre AS proveedor_nombre
    FROM codigos_proveedor cp
    JOIN proveedores p ON p.id = cp.proveedor_id
    WHERE cp.negocio_id = $1 AND cp.codigo_interno = $2
    ORDER BY p.nombre
  `, [negocioId, codigoInterno]);
  return rows;
};

/**
 * Resuelve la referencia de un proveedor al producto de UNA sucursal.
 *
 * Devuelve `null` si el código no está mapeado, y un objeto con
 * `producto_id: null` si está mapeado pero el producto no existe (o está
 * inactivo) en esa sucursal. La diferencia importa: "no lo conozco" pide
 * enseñarle la equivalencia, "lo conozco pero aquí no está" pide crear el
 * producto en esta sede.
 */
const resolver = async (negocioId, proveedorId, codigoProveedor, sucursalId) => {
  const { rows } = await pool.query(`
    SELECT cp.id, cp.codigo_proveedor, cp.codigo_interno, cp.descripcion_proveedor,
           pc.id     AS producto_id,
           pc.nombre AS producto_nombre,
           pc.stock,
           pc.costo_unitario
    FROM      codigos_proveedor cp
    LEFT JOIN productos_cantidad pc
           ON pc.codigo = cp.codigo_interno
          AND pc.sucursal_id = $4
          AND pc.activo
    WHERE cp.negocio_id = $1
      AND cp.proveedor_id = $2
      AND UPPER(BTRIM(cp.codigo_proveedor)) = UPPER(BTRIM($3))
    LIMIT 1
  `, [negocioId, proveedorId, codigoProveedor, sucursalId]);
  return rows[0] || null;
};

/**
 * Guarda (o corrige) una equivalencia. Idempotente por
 * (proveedor, codigo_proveedor) en mayúsculas — así se aprende al recibir sin
 * que el usuario tenga que saber si ya existía.
 *
 * El ON CONFLICT apunta al índice funcional de la migración: si aquí se pusiera
 * la columna a secas, dos remisiones con distinta capitalización crearían dos
 * filas y la resolución se volvería impredecible.
 */
const guardar = async (client, {
  negocio_id, proveedor_id, codigo_proveedor, codigo_interno,
  descripcion_proveedor, usuario_id,
}) => {
  const { rows } = await client.query(`
    INSERT INTO codigos_proveedor(
      negocio_id, proveedor_id, codigo_proveedor, codigo_interno,
      descripcion_proveedor, usuario_id
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (proveedor_id, UPPER(BTRIM(codigo_proveedor)))
    DO UPDATE SET
      codigo_interno        = EXCLUDED.codigo_interno,
      descripcion_proveedor = COALESCE(EXCLUDED.descripcion_proveedor, codigos_proveedor.descripcion_proveedor),
      usuario_id            = EXCLUDED.usuario_id
    RETURNING *
  `, [
    negocio_id, proveedor_id,
    String(codigo_proveedor).trim(),
    String(codigo_interno).trim(),
    descripcion_proveedor || null,
    usuario_id || null,
  ]);
  return rows[0];
};

const eliminar = async (negocioId, id) => {
  const { rowCount } = await pool.query(
    'DELETE FROM codigos_proveedor WHERE id = $1 AND negocio_id = $2',
    [id, negocioId]
  );
  return rowCount > 0;
};

/** Verifica que el código interno exista en algún producto activo del negocio. */
const codigoInternoExiste = async (negocioId, codigoInterno) => {
  const { rows } = await pool.query(`
    SELECT pc.id, pc.nombre
    FROM productos_cantidad pc
    JOIN sucursales su ON su.id = pc.sucursal_id
    WHERE su.negocio_id = $1 AND pc.codigo = $2 AND pc.activo
    LIMIT 1
  `, [negocioId, codigoInterno]);
  return rows[0] || null;
};

module.exports = {
  findByProveedor, findByCodigoInterno, resolver,
  guardar, eliminar, codigoInternoExiste,
};
