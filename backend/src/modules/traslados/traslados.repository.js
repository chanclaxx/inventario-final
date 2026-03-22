const { pool } = require('../../config/db');

// ─── Búsqueda de equivalentes en sucursal destino ─────────────────────────────

/**
 * Busca productos_serial equivalentes en la sucursal destino.
 * Cascada: exacto → parcial → misma línea → todos
 */
const buscarEquivalentesSerial = async (negocioId, sucursalDestinoId, { nombre, marca, modelo, linea_id }) => {
  // 1. Coincidencia exacta: nombre + marca + modelo
  const { rows: exactos } = await pool.query(`
    SELECT ps.id, ps.nombre, ps.marca, ps.modelo, ps.precio, ps.linea_id,
           lp.nombre AS linea_nombre,
           COUNT(s.id) FILTER (WHERE s.vendido = false AND s.prestado = false) AS disponibles
    FROM productos_serial ps
    JOIN sucursales su ON su.id = ps.sucursal_id
    LEFT JOIN lineas_producto lp ON lp.id = ps.linea_id
    LEFT JOIN seriales s ON s.producto_id = ps.id
    WHERE ps.sucursal_id = $1 AND su.negocio_id = $2
      AND LOWER(TRIM(ps.nombre)) = LOWER(TRIM($3))
      AND ($4::text IS NULL OR LOWER(TRIM(ps.marca)) = LOWER(TRIM($4)))
      AND ($5::text IS NULL OR LOWER(TRIM(ps.modelo)) = LOWER(TRIM($5)))
    GROUP BY ps.id, lp.nombre
    ORDER BY ps.nombre
  `, [sucursalDestinoId, negocioId, nombre, marca || null, modelo || null]);

  if (exactos.length > 0) return { nivel: 'exacto', resultados: exactos };

  // 2. Parcial: nombre contiene o marca coincide + misma línea
  const { rows: parciales } = await pool.query(`
    SELECT ps.id, ps.nombre, ps.marca, ps.modelo, ps.precio, ps.linea_id,
           lp.nombre AS linea_nombre,
           COUNT(s.id) FILTER (WHERE s.vendido = false AND s.prestado = false) AS disponibles
    FROM productos_serial ps
    JOIN sucursales su ON su.id = ps.sucursal_id
    LEFT JOIN lineas_producto lp ON lp.id = ps.linea_id
    LEFT JOIN seriales s ON s.producto_id = ps.id
    WHERE ps.sucursal_id = $1 AND su.negocio_id = $2
      AND (
        LOWER(ps.nombre) LIKE '%' || LOWER(TRIM($3)) || '%'
        OR ($4::text IS NOT NULL AND LOWER(TRIM(ps.marca)) = LOWER(TRIM($4)))
      )
    GROUP BY ps.id, lp.nombre
    ORDER BY ps.nombre
    LIMIT 20
  `, [sucursalDestinoId, negocioId, nombre, marca || null]);

  if (parciales.length > 0) return { nivel: 'parcial', resultados: parciales };

  // 3. Misma línea de producto
  if (linea_id) {
    const { rows: porLinea } = await pool.query(`
      SELECT ps.id, ps.nombre, ps.marca, ps.modelo, ps.precio, ps.linea_id,
             lp.nombre AS linea_nombre,
             COUNT(s.id) FILTER (WHERE s.vendido = false AND s.prestado = false) AS disponibles
      FROM productos_serial ps
      JOIN sucursales su ON su.id = ps.sucursal_id
      LEFT JOIN lineas_producto lp ON lp.id = ps.linea_id
      LEFT JOIN seriales s ON s.producto_id = ps.id
      WHERE ps.sucursal_id = $1 AND su.negocio_id = $2 AND ps.linea_id = $3
      GROUP BY ps.id, lp.nombre
      ORDER BY ps.nombre
      LIMIT 30
    `, [sucursalDestinoId, negocioId, linea_id]);

    if (porLinea.length > 0) return { nivel: 'linea', resultados: porLinea };
  }

  // 4. Todos los productos serial de la sucursal destino
  const { rows: todos } = await pool.query(`
    SELECT ps.id, ps.nombre, ps.marca, ps.modelo, ps.precio, ps.linea_id,
           lp.nombre AS linea_nombre,
           COUNT(s.id) FILTER (WHERE s.vendido = false AND s.prestado = false) AS disponibles
    FROM productos_serial ps
    JOIN sucursales su ON su.id = ps.sucursal_id
    LEFT JOIN lineas_producto lp ON lp.id = ps.linea_id
    LEFT JOIN seriales s ON s.producto_id = ps.id
    WHERE ps.sucursal_id = $1 AND su.negocio_id = $2
    GROUP BY ps.id, lp.nombre
    ORDER BY ps.nombre
    LIMIT 50
  `, [sucursalDestinoId, negocioId]);

  return { nivel: 'todos', resultados: todos };
};

/**
 * Busca productos_cantidad equivalentes en la sucursal destino.
 * Cascada: exacto → parcial → misma línea → todos
 */
const buscarEquivalentesCantidad = async (negocioId, sucursalDestinoId, { nombre, linea_id }) => {
  // 1. Coincidencia exacta por nombre
  const { rows: exactos } = await pool.query(`
    SELECT pc.id, pc.nombre, pc.stock, pc.precio, pc.costo_unitario,
           pc.unidad_medida, pc.linea_id, lp.nombre AS linea_nombre
    FROM productos_cantidad pc
    JOIN sucursales su ON su.id = pc.sucursal_id
    LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
    WHERE pc.sucursal_id = $1 AND su.negocio_id = $2
      AND pc.activo = true
      AND LOWER(TRIM(pc.nombre)) = LOWER(TRIM($3))
    ORDER BY pc.nombre
  `, [sucursalDestinoId, negocioId, nombre]);

  if (exactos.length > 0) return { nivel: 'exacto', resultados: exactos };

  // 2. Parcial: nombre contiene
  const { rows: parciales } = await pool.query(`
    SELECT pc.id, pc.nombre, pc.stock, pc.precio, pc.costo_unitario,
           pc.unidad_medida, pc.linea_id, lp.nombre AS linea_nombre
    FROM productos_cantidad pc
    JOIN sucursales su ON su.id = pc.sucursal_id
    LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
    WHERE pc.sucursal_id = $1 AND su.negocio_id = $2
      AND pc.activo = true
      AND LOWER(pc.nombre) LIKE '%' || LOWER(TRIM($3)) || '%'
    ORDER BY pc.nombre
    LIMIT 20
  `, [sucursalDestinoId, negocioId, nombre]);

  if (parciales.length > 0) return { nivel: 'parcial', resultados: parciales };

  // 3. Misma línea
  if (linea_id) {
    const { rows: porLinea } = await pool.query(`
      SELECT pc.id, pc.nombre, pc.stock, pc.precio, pc.costo_unitario,
             pc.unidad_medida, pc.linea_id, lp.nombre AS linea_nombre
      FROM productos_cantidad pc
      JOIN sucursales su ON su.id = pc.sucursal_id
      LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
      WHERE pc.sucursal_id = $1 AND su.negocio_id = $2
        AND pc.activo = true AND pc.linea_id = $3
      ORDER BY pc.nombre
      LIMIT 30
    `, [sucursalDestinoId, negocioId, linea_id]);

    if (porLinea.length > 0) return { nivel: 'linea', resultados: porLinea };
  }

  // 4. Todos
  const { rows: todos } = await pool.query(`
    SELECT pc.id, pc.nombre, pc.stock, pc.precio, pc.costo_unitario,
           pc.unidad_medida, pc.linea_id, lp.nombre AS linea_nombre
    FROM productos_cantidad pc
    JOIN sucursales su ON su.id = pc.sucursal_id
    LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
    WHERE pc.sucursal_id = $1 AND su.negocio_id = $2 AND pc.activo = true
    ORDER BY pc.nombre
    LIMIT 50
  `, [sucursalDestinoId, negocioId]);

  return { nivel: 'todos', resultados: todos };
};

// ─── Ejecución del traslado (dentro de transacción) ───────────────────────────

const crearTraslado = async (client, { negocio_id, sucursal_origen_id, sucursal_destino_id, usuario_id, notas }) => {
  const { rows } = await client.query(`
    INSERT INTO traslados(negocio_id, sucursal_origen_id, sucursal_destino_id, usuario_id, notas)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [negocio_id, sucursal_origen_id, sucursal_destino_id, usuario_id, notas || null]);
  return rows[0];
};

const insertarLineaTraslado = async (client, linea) => {
  const { rows } = await client.query(`
    INSERT INTO lineas_traslado(
      traslado_id, tipo,
      serial_id, producto_serial_origen_id, producto_serial_destino_id, imei,
      producto_cantidad_origen_id, producto_cantidad_destino_id, cantidad,
      nombre_producto
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `, [
    linea.traslado_id, linea.tipo,
    linea.serial_id || null,
    linea.producto_serial_origen_id || null,
    linea.producto_serial_destino_id || null,
    linea.imei || null,
    linea.producto_cantidad_origen_id || null,
    linea.producto_cantidad_destino_id || null,
    linea.cantidad || null,
    linea.nombre_producto,
  ]);
  return rows[0];
};

// Mover serial: cambiar producto_id al producto destino
const moverSerial = async (client, serialId, productoDestinoId) => {
  const { rows } = await client.query(`
    UPDATE seriales SET producto_id = $1 WHERE id = $2 RETURNING *
  `, [productoDestinoId, serialId]);
  return rows[0];
};

// Ajustar stock de producto_cantidad dentro de transacción
const ajustarStockEnTransaccion = async (client, productoId, cantidad) => {
  const { rows } = await client.query(`
    UPDATE productos_cantidad SET stock = stock + $1 WHERE id = $2 RETURNING *
  `, [cantidad, productoId]);
  return rows[0];
};

// Insertar historial de stock dentro de transacción
const insertarHistorialEnTransaccion = async (client, datos) => {
  await client.query(`
    INSERT INTO historial_stock_cantidad
      (producto_id, sucursal_id, cantidad, costo_unitario, tipo, notas)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [
    datos.producto_id, datos.sucursal_id, datos.cantidad,
    datos.costo_unitario ?? null, 'traslado', datos.notas || null,
  ]);
};

// ─── Consultas de traslados ───────────────────────────────────────────────────

const findAll = async (negocioId, limit = 50) => {
  const { rows } = await pool.query(`
    SELECT t.*,
           so.nombre AS sucursal_origen_nombre,
           sd.nombre AS sucursal_destino_nombre,
           u.nombre  AS usuario_nombre,
           (SELECT COUNT(*) FROM lineas_traslado lt WHERE lt.traslado_id = t.id) AS total_items
    FROM traslados t
    JOIN sucursales so ON so.id = t.sucursal_origen_id
    JOIN sucursales sd ON sd.id = t.sucursal_destino_id
    LEFT JOIN usuarios u ON u.id = t.usuario_id
    WHERE t.negocio_id = $1
    ORDER BY t.fecha DESC
    LIMIT $2
  `, [negocioId, limit]);
  return rows;
};

const findById = async (negocioId, id) => {
  const { rows } = await pool.query(`
    SELECT t.*,
           so.nombre AS sucursal_origen_nombre,
           sd.nombre AS sucursal_destino_nombre,
           u.nombre  AS usuario_nombre
    FROM traslados t
    JOIN sucursales so ON so.id = t.sucursal_origen_id
    JOIN sucursales sd ON sd.id = t.sucursal_destino_id
    LEFT JOIN usuarios u ON u.id = t.usuario_id
    WHERE t.id = $1 AND t.negocio_id = $2
  `, [id, negocioId]);
  return rows[0] || null;
};

const getLineas = async (trasladoId) => {
  const { rows } = await pool.query(`
    SELECT lt.*
    FROM lineas_traslado lt
    WHERE lt.traslado_id = $1
    ORDER BY lt.id
  `, [trasladoId]);
  return rows;
};

module.exports = {
  buscarEquivalentesSerial, buscarEquivalentesCantidad,
  crearTraslado, insertarLineaTraslado,
  moverSerial, ajustarStockEnTransaccion, insertarHistorialEnTransaccion,
  findAll, findById, getLineas,
};