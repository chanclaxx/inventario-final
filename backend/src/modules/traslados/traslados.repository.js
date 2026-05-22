const { pool } = require('../../config/db');

// ─── Utilidades de similitud ──────────────────────────────────────────────────

/** Normaliza un string: minúsculas, sin tildes, sin guiones, espacios simples */
const _norm = (s) =>
  (s || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ');

/** Divide en tokens de 2+ caracteres */
const _tokens = (s) => _norm(s).split(/\s+/).filter((t) => t.length >= 2);

/**
 * Calcula un score de similitud entre un producto destino y los datos del origen.
 * Insensible a: orden de palabras, tildes, mayúsculas, guiones.
 *
 * Escala:
 *  100 → cadena exacta
 *   99 → mismas palabras, distinto orden
 *  20–98 → superposición parcial de tokens + bonos de marca/modelo/línea
 *   0–19 → muy poca o ninguna similitud
 */
const _score = (prod, { nombre, marca, modelo, linea_id }) => {
  const n1 = _norm(nombre);
  const n2 = _norm(prod.nombre);

  if (n1 === n2) return 100;

  const t1 = _tokens(nombre);
  const t2 = _tokens(prod.nombre);

  // Mismas palabras, distinto orden → casi exacto
  if (
    t1.length > 0 &&
    t1.length === t2.length &&
    t1.every((t) => t2.includes(t)) &&
    t2.every((t) => t1.includes(t))
  ) return 99;

  let score = 0;

  if (t1.length && t2.length) {
    const hits = t1.filter((t) => t2.includes(t)).length;
    const union = new Set([...t1, ...t2]).size;
    score += (hits / union) * 60;
    if (hits === t1.length) score += 15; // todos los tokens del origen están en el destino
  }

  // Coincidencia de subcadena (bidireccional)
  if (n2.includes(n1) || n1.includes(n2)) score += 10;

  // Bono por marca y modelo
  if (marca && prod.marca && _norm(marca) === _norm(prod.marca))   score += 12;
  if (modelo && prod.modelo && _norm(modelo) === _norm(prod.modelo)) score += 10;

  // Bono por misma línea
  if (linea_id && prod.linea_id === linea_id) score += 5;

  return score;
};

/**
 * Scoring para búsqueda libre: usa coincidencia de prefijo/subcadena por token
 * para que "gal" encuentre "Galaxy".
 */
const _scoreQuery = (prod, q) => {
  const n1 = _norm(q);
  const n2 = _norm(prod.nombre);

  if (!n1) return 0;
  if (n1 === n2) return 100;
  if (n2.includes(n1)) return 80;
  if (n1.includes(n2)) return 70;

  const t1 = _tokens(q);
  const t2 = _tokens(prod.nombre);
  if (!t1.length || !t2.length) return n2.includes(n1) ? 30 : 0;

  let hits = 0;
  for (const qt of t1) {
    if (t2.some((pt) => pt.startsWith(qt) || qt.startsWith(pt))) hits++;
  }
  return (hits / Math.max(t1.length, 1)) * 60;
};

// ─── Búsqueda de equivalentes en sucursal destino ─────────────────────────────

/**
 * Trae todos los productos_serial de la sucursal destino y los rankea por
 * similitud con el producto origen usando _score (insensible a orden y tildes).
 * Devuelve { nivel, resultados } con el nivel de mejor coincidencia.
 */
const buscarEquivalentesSerial = async (negocioId, sucursalDestinoId, { nombre, marca, modelo, linea_id }) => {
  const { rows } = await pool.query(`
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
  `, [sucursalDestinoId, negocioId]);

  if (!rows.length) return { nivel: 'todos', resultados: [] };

  const scored = rows
    .map((p) => ({ ...p, _s: _score(p, { nombre, marca, modelo, linea_id }) }))
    .sort((a, b) => b._s - a._s);

  const best = scored[0]._s;

  let nivel, resultados;
  if (best >= 99) {
    nivel = 'exacto';
    resultados = scored.filter((p) => p._s >= 99);
  } else if (best >= 20) {
    nivel = 'parcial';
    resultados = scored.filter((p) => p._s >= 20).slice(0, 20);
  } else if (linea_id && rows.some((p) => p.linea_id === linea_id)) {
    nivel = 'linea';
    resultados = scored.filter((p) => p.linea_id === linea_id).slice(0, 30);
  } else {
    nivel = 'todos';
    resultados = scored.slice(0, 50);
  }

  return { nivel, resultados: resultados.map(({ _s, ...p }) => p) };
};

/**
 * Trae todos los productos_cantidad de la sucursal destino y los rankea por
 * similitud con el producto origen.
 */
const buscarEquivalentesCantidad = async (negocioId, sucursalDestinoId, { nombre, linea_id }) => {
  const { rows } = await pool.query(`
    SELECT pc.id, pc.nombre, pc.stock, pc.precio, pc.costo_unitario,
           pc.unidad_medida, pc.linea_id, lp.nombre AS linea_nombre
    FROM productos_cantidad pc
    JOIN sucursales su ON su.id = pc.sucursal_id
    LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
    WHERE pc.sucursal_id = $1 AND su.negocio_id = $2 AND pc.activo = true
    ORDER BY pc.nombre
  `, [sucursalDestinoId, negocioId]);

  if (!rows.length) return { nivel: 'todos', resultados: [] };

  const scored = rows
    .map((p) => ({ ...p, _s: _score(p, { nombre, linea_id }) }))
    .sort((a, b) => b._s - a._s);

  const best = scored[0]._s;

  let nivel, resultados;
  if (best >= 99) {
    nivel = 'exacto';
    resultados = scored.filter((p) => p._s >= 99);
  } else if (best >= 20) {
    nivel = 'parcial';
    resultados = scored.filter((p) => p._s >= 20).slice(0, 20);
  } else if (linea_id && rows.some((p) => p.linea_id === linea_id)) {
    nivel = 'linea';
    resultados = scored.filter((p) => p.linea_id === linea_id).slice(0, 30);
  } else {
    nivel = 'todos';
    resultados = scored.slice(0, 50);
  }

  return { nivel, resultados: resultados.map(({ _s, ...p }) => p) };
};

// ─── Búsqueda libre en sucursal destino (escape hatch) ───────────────────────

/**
 * Permite al usuario buscar cualquier producto en la sucursal destino con un
 * término libre, usando coincidencia de prefijo por token (_scoreQuery).
 * Usado cuando el algoritmo automático no encontró lo que el usuario quería.
 */
const buscarProductosEnSucursal = async (negocioId, sucursalId, tipo, q) => {
  if (tipo === 'serial') {
    const { rows } = await pool.query(`
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
    `, [sucursalId, negocioId]);

    if (!rows.length) return [];
    return rows
      .map((p) => ({ ...p, _s: _scoreQuery(p, q) }))
      .filter((p) => p._s > 0)
      .sort((a, b) => b._s - a._s)
      .slice(0, 30)
      .map(({ _s, ...p }) => p);
  }

  const { rows } = await pool.query(`
    SELECT pc.id, pc.nombre, pc.stock, pc.precio, pc.costo_unitario,
           pc.unidad_medida, pc.linea_id, lp.nombre AS linea_nombre
    FROM productos_cantidad pc
    JOIN sucursales su ON su.id = pc.sucursal_id
    LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
    WHERE pc.sucursal_id = $1 AND su.negocio_id = $2 AND pc.activo = true
    ORDER BY pc.nombre
  `, [sucursalId, negocioId]);

  if (!rows.length) return [];
  return rows
    .map((p) => ({ ...p, _s: _scoreQuery(p, q) }))
    .filter((p) => p._s > 0)
    .sort((a, b) => b._s - a._s)
    .slice(0, 30)
    .map(({ _s, ...p }) => p);
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

const moverSerial = async (client, serialId, productoDestinoId) => {
  const { rows } = await client.query(`
    UPDATE seriales SET producto_id = $1 WHERE id = $2 RETURNING *
  `, [productoDestinoId, serialId]);
  return rows[0];
};

const ajustarStockEnTransaccion = async (client, productoId, cantidad) => {
  const { rows } = await client.query(`
    UPDATE productos_cantidad SET stock = stock + $1 WHERE id = $2 RETURNING *
  `, [cantidad, productoId]);
  return rows[0];
};

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
           so.nombre   AS sucursal_origen_nombre,
           sd.nombre   AS sucursal_destino_nombre,
           u.nombre    AS usuario_nombre,
           u_rev.nombre AS revertido_por_nombre
    FROM traslados t
    JOIN sucursales so ON so.id = t.sucursal_origen_id
    JOIN sucursales sd ON sd.id = t.sucursal_destino_id
    LEFT JOIN usuarios u     ON u.id     = t.usuario_id
    LEFT JOIN usuarios u_rev ON u_rev.id = t.revertido_por_usuario_id
    WHERE t.id = $1 AND t.negocio_id = $2
  `, [id, negocioId]);
  return rows[0] || null;
};

const getLineas = async (trasladoId) => {
  const { rows } = await pool.query(`
    SELECT
      lt.*,
      ps_dest.nombre  AS nombre_producto_destino,
      ps_dest.marca   AS marca_destino,
      ps_dest.modelo  AS modelo_destino,
      pc_dest.nombre  AS nombre_cantidad_destino,
      u_rev.nombre    AS revertida_por_nombre
    FROM lineas_traslado lt
    LEFT JOIN productos_serial   ps_dest ON ps_dest.id = lt.producto_serial_destino_id
    LEFT JOIN productos_cantidad pc_dest ON pc_dest.id = lt.producto_cantidad_destino_id
    LEFT JOIN usuarios           u_rev   ON u_rev.id   = lt.revertida_por_usuario_id
    WHERE lt.traslado_id = $1
    ORDER BY lt.id
  `, [trasladoId]);
  return rows;
};

const marcarLineaRevertida = async (client, lineaId, usuarioId) => {
  await client.query(
    `UPDATE lineas_traslado
     SET revertida = true, revertida_por_usuario_id = $2, fecha_reversion = NOW()
     WHERE id = $1`,
    [lineaId, usuarioId]
  );
};

const marcarTrasladoCancelado = async (client, trasladoId, usuarioId) => {
  await client.query(
    `UPDATE traslados
     SET estado = 'Cancelado', revertido_por_usuario_id = $2, fecha_reversion = NOW()
     WHERE id = $1`,
    [trasladoId, usuarioId]
  );
};

// ─── Catálogo completo de una sucursal (para jalar traslado) ─────────────────

const getCatalogoSucursal = async (negocioId, sucursalId, tipo, q) => {
  if (tipo === 'serial') {
    const { rows } = await pool.query(`
      SELECT ps.id, ps.nombre, ps.marca, ps.modelo, ps.precio, ps.linea_id,
             lp.nombre AS linea_nombre,
             COUNT(s.id) FILTER (WHERE s.vendido = false AND s.prestado = false) AS disponibles
      FROM productos_serial ps
      JOIN sucursales su ON su.id = ps.sucursal_id
      LEFT JOIN lineas_producto lp ON lp.id = ps.linea_id
      LEFT JOIN seriales s ON s.producto_id = ps.id
      WHERE ps.sucursal_id = $1 AND su.negocio_id = $2
      GROUP BY ps.id, lp.nombre
      HAVING COUNT(s.id) FILTER (WHERE s.vendido = false AND s.prestado = false) > 0
      ORDER BY ps.nombre
    `, [sucursalId, negocioId]);

    if (!rows.length) return [];
    if (!q || q.trim().length < 2) return rows;
    return rows
      .map((p) => ({ ...p, _s: _scoreQuery(p, q) }))
      .filter((p) => p._s > 0)
      .sort((a, b) => b._s - a._s)
      .map(({ _s, ...p }) => p);
  }

  const { rows } = await pool.query(`
    SELECT pc.id, pc.nombre, pc.stock, pc.precio, pc.costo_unitario,
           pc.unidad_medida, pc.linea_id, lp.nombre AS linea_nombre
    FROM productos_cantidad pc
    JOIN sucursales su ON su.id = pc.sucursal_id
    LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
    WHERE pc.sucursal_id = $1 AND su.negocio_id = $2 AND pc.activo = true AND pc.stock > 0
    ORDER BY pc.nombre
  `, [sucursalId, negocioId]);

  if (!rows.length) return [];
  if (!q || q.trim().length < 2) return rows;
  return rows
    .map((p) => ({ ...p, _s: _scoreQuery(p, q) }))
    .filter((p) => p._s > 0)
    .sort((a, b) => b._s - a._s)
    .map(({ _s, ...p }) => p);
};

// ─── Seriales disponibles de un producto en una sucursal ─────────────────────

const buscarSerialesProducto = async (negocioId, sucursalId, productoSerialId) => {
  const { rows } = await pool.query(`
    SELECT s.id, s.imei
    FROM seriales s
    JOIN productos_serial ps ON ps.id = s.producto_id
    JOIN sucursales su ON su.id = ps.sucursal_id
    WHERE s.producto_id = $1 AND ps.sucursal_id = $2 AND su.negocio_id = $3
      AND s.vendido = false AND s.prestado = false
    ORDER BY s.imei
  `, [productoSerialId, sucursalId, negocioId]);
  return rows;
};

module.exports = {
  buscarEquivalentesSerial, buscarEquivalentesCantidad,
  buscarProductosEnSucursal, getCatalogoSucursal, buscarSerialesProducto,
  crearTraslado, insertarLineaTraslado,
  moverSerial, ajustarStockEnTransaccion, insertarHistorialEnTransaccion,
  findAll, findById, getLineas,
  marcarLineaRevertida, marcarTrasladoCancelado,
};
