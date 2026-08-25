const { pool } = require('../../config/db');
const { hayUbicacion } = require('../../config/columnas');

// Ubicación espacial (feature opt-in). En serial la ubicación pertenece a la
// REFERENCIA, no a cada IMEI: un modelo vive en un estante, no cada unidad.
// Solo se interpola si la columna existe — ver src/config/columnas.js.
// No es entrada de usuario: es un literal SQL fijo.
const selUbicacion = (alias) => (hayUbicacion() ? `${alias}.ubicacion,` : '');

// ── linea_id incluido en findAll con filtro opcional ─────────────────────
const findAll = async (sucursalId, negocioId, lineaId) => {
  const { rows } = await pool.query(`
    SELECT
      ps.id, ps.nombre, ps.marca, ps.modelo, ps.precio,
      ps.sucursal_id, ps.proveedor_id, ps.linea_id, ps.nota,
      ${selUbicacion('ps')}
      su.nombre  AS sucursal_nombre,
      lp.nombre  AS linea_nombre,
      COUNT(s.id) FILTER (WHERE s.vendido = false AND s.prestado = false) AS disponibles,
      -- Días de la unidad disponible más antigua (la que lleva más tiempo sin venderse)
      (CURRENT_DATE - MIN(s.fecha_entrada)
        FILTER (WHERE s.vendido = false AND s.prestado = false))::int AS dias_en_inventario
    FROM productos_serial ps
    JOIN  sucursales         su ON su.id  = ps.sucursal_id
    LEFT JOIN lineas_producto lp ON lp.id = ps.linea_id
    LEFT JOIN seriales        s  ON s.producto_id = ps.id
    WHERE su.negocio_id = $1
      AND ($2::int IS NULL OR ps.sucursal_id = $2)
      AND ($3::int IS NULL OR ps.linea_id    = $3)
    GROUP BY ps.id, su.nombre, lp.nombre
    ORDER BY ps.nombre ASC
  `, [negocioId, sucursalId ?? null, lineaId ?? null]);
  return rows;
};

const findById = async (id) => {
  const { rows } = await pool.query(`
    SELECT ps.*, su.nombre AS sucursal_nombre, lp.nombre AS linea_nombre
    FROM productos_serial ps
    JOIN  sucursales         su ON su.id  = ps.sucursal_id
    LEFT JOIN lineas_producto lp ON lp.id = ps.linea_id
    WHERE ps.id = $1
  `, [id]);
  return rows[0] || null;
};

const findByIdYNegocio = async (id, negocioId) => {
  const { rows } = await pool.query(`
    SELECT ps.*, su.nombre AS sucursal_nombre, lp.nombre AS linea_nombre
    FROM productos_serial ps
    JOIN  sucursales         su ON su.id  = ps.sucursal_id
    LEFT JOIN lineas_producto lp ON lp.id = ps.linea_id
    WHERE ps.id = $1 AND su.negocio_id = $2
  `, [id, negocioId]);
  return rows[0] || null;
};

const findSerialByIdYNegocio = async (serialId, negocioId) => {
  const { rows } = await pool.query(`
    SELECT s.*, ps.sucursal_id, ps.nombre AS producto_nombre, su.negocio_id
    FROM seriales s
    JOIN productos_serial ps ON ps.id = s.producto_id
    JOIN sucursales        su ON su.id = ps.sucursal_id
    WHERE s.id = $1 AND su.negocio_id = $2
  `, [serialId, negocioId]);
  return rows[0] || null;
};

const perteneceAlNegocio = async (productoId, negocioId) => {
  const { rows } = await pool.query(`
    SELECT ps.id, ps.nombre, ps.sucursal_id FROM productos_serial ps
    JOIN sucursales s ON s.id = ps.sucursal_id
    WHERE ps.id = $1 AND s.negocio_id = $2
  `, [productoId, negocioId]);
  return rows[0] || null;
};

// ── linea_id incluido en create ───────────────────────────────────────────
const create = async ({ nombre, marca, modelo, precio, sucursal_id, proveedor_id, linea_id, ubicacion }) => {
  const conUbicacion = hayUbicacion();
  const { rows } = await pool.query(`
    INSERT INTO productos_serial(nombre, marca, modelo, precio, sucursal_id, proveedor_id, linea_id${conUbicacion ? ', ubicacion' : ''})
    VALUES ($1, $2, $3, $4, $5, $6, $7${conUbicacion ? ', $8' : ''})
    RETURNING *
  `, [
    nombre, marca || null, modelo || null, precio, sucursal_id, proveedor_id || null, linea_id || null,
    ...(conUbicacion ? [ubicacion || null] : []),
  ]);
  return rows[0];
};

// ── linea_id incluido en update ───────────────────────────────────────────
const update = async (id, datos) => {
  // Ubicación con la misma escritura condicional que `nota`: si no viene en el
  // payload no se toca, así un guardado parcial nunca la borra.
  const conUbicacion = hayUbicacion();
  const { rows } = await pool.query(`
    UPDATE productos_serial
    SET nombre       = COALESCE($1, nombre),
        marca        = COALESCE($2, marca),
        modelo       = COALESCE($3, modelo),
        precio       = COALESCE($4, precio),
        proveedor_id = COALESCE($5, proveedor_id),
        linea_id     = $6,
        nota         = CASE WHEN $7::boolean THEN $8 ELSE nota END
        ${conUbicacion ? ', ubicacion = CASE WHEN $10::boolean THEN $11 ELSE ubicacion END' : ''}
    WHERE id = $9
    RETURNING *
  `, [
    datos.nombre, datos.marca, datos.modelo, datos.precio, datos.proveedor_id,
    datos.linea_id || null,
    datos.nota !== undefined,
    datos.nota != null && String(datos.nota).trim() ? String(datos.nota).trim() : null,
    id,
    ...(conUbicacion ? [datos.ubicacion !== undefined, datos.ubicacion || null] : []),
  ]);
  return rows[0] || null;
};

const updatePrecio = async (productoId, precio) => {
  await pool.query(
    'UPDATE productos_serial SET precio = $1 WHERE id = $2',
    [precio, productoId]
  );
};

const getSeriales = async (productoId, vendido) => {
  const { rows } = await pool.query(`
    SELECT s.*,
      -- Días que esta unidad lleva en el inventario (desde su fecha de entrada)
      (CURRENT_DATE - s.fecha_entrada)::int AS dias_en_inventario,
      CASE
        WHEN s.prestado = true
        THEN COALESCE(pr.nombre, c.nombre, p.prestatario)
        ELSE NULL
      END AS prestado_a,
      -- Hasta cuándo responde el PROVEEDOR por esta unidad (feature opt-in).
      --
      -- Se DERIVA, nunca se guarda, igual que en el panel de procedencia: el
      -- plazo se congela en la línea de compra y el vencimiento se calcula.
      -- El AT TIME ZONE no es decorativo: compras.fecha es TIMESTAMP leído en
      -- Bogotá y el resultado es DATE leído en UTC; sin él una compra de las
      -- 8 p.m. vence un día antes.
      --
      -- LATERAL y no JOIN: un mismo IMEI tiene varias filas de compra (re-import,
      -- retoma, reactivación) y un JOIN plano multiplicaría la unidad y mezclaría
      -- garantías viejas. Manda la compra más reciente.
      g.garantia_hasta,
      g.garantia_dias
    FROM seriales s
    LEFT JOIN prestamos      p  ON p.imei  = s.imei AND p.estado = 'Activo'
    LEFT JOIN prestatarios   pr ON pr.id   = p.prestatario_id
    LEFT JOIN clientes       c  ON c.id    = p.cliente_id
    LEFT JOIN LATERAL (
      SELECT lc.garantia_dias,
             (cc.fecha AT TIME ZONE 'America/Bogota')::date + lc.garantia_dias AS garantia_hasta
      FROM lineas_compra lc
      JOIN compras cc ON cc.id = lc.compra_id
      WHERE UPPER(BTRIM(lc.imei)) = UPPER(BTRIM(s.imei))
        AND lc.garantia_dias IS NOT NULL
        AND cc.estado <> 'Cancelada'
      ORDER BY cc.fecha DESC, lc.id DESC
      LIMIT 1
    ) g ON TRUE
    WHERE s.producto_id = $1
      AND ($2::boolean IS NULL OR s.vendido = $2)
    ORDER BY s.fecha_entrada DESC
  `, [productoId, vendido ?? null]);
  return rows;
};

const findSerialByIMEI = async (imei) => {
  const { rows } = await pool.query(
    'SELECT id FROM seriales WHERE imei = $1',
    [imei]
  );
  return rows[0] || null;
};

const findSerialByIMEIEnNegocio = async (imei, negocioId) => {
  const { rows } = await pool.query(`
    SELECT
      s.id, s.imei, s.vendido, s.prestado,
      s.fecha_entrada, s.fecha_salida, s.cliente_origen,
      ps.id     AS producto_id,
      ps.nombre AS producto_nombre,
      ps.marca,  ps.modelo,
      su.id     AS sucursal_id,
      su.nombre AS sucursal_nombre
    FROM seriales s
    JOIN productos_serial ps ON ps.id = s.producto_id
    JOIN sucursales        su ON su.id = ps.sucursal_id
    WHERE UPPER(TRIM(s.imei)) = UPPER(TRIM($1)) AND su.negocio_id = $2
    LIMIT 1
  `, [imei, negocioId]);
  return rows[0] || null;
};

const insertarSerial = async ({
  producto_id, imei, fecha_entrada, costo_compra, cliente_origen, proveedor_id, color, caracteristicas,
}) => {
  const { rows } = await pool.query(`
    INSERT INTO seriales(producto_id, imei, fecha_entrada, costo_compra, cliente_origen, proveedor_id, color, caracteristicas)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `, [
    producto_id, imei, fecha_entrada,
    costo_compra ?? null, cliente_origen || null, proveedor_id || null, color || null,
    caracteristicas != null ? JSON.stringify(caracteristicas) : null,
  ]);
  return rows[0];
};

const reactivarSerial = async (serialId, { costo_compra, proveedor_id } = {}) => {
  const { rows } = await pool.query(`
    UPDATE seriales
    SET vendido      = false,
        prestado     = false,
        fecha_salida = NULL,
        costo_compra = COALESCE($1, costo_compra),
        proveedor_id = COALESCE($2, proveedor_id)
    WHERE id = $3
    RETURNING *
  `, [costo_compra ?? null, proveedor_id || null, serialId]);
  if (!rows[0]) throw { status: 404, message: 'Serial no encontrado para reactivar' };
  return rows[0];
};

const actualizarSerial = async (serialId, datos) => {
  const { imei, costo_compra, color, caracteristicas, precio, nota } = datos;

  // Build SET clause dynamically — only touch optional columns when explicitly sent
  const sets   = ['imei = COALESCE($1, imei)', 'costo_compra = COALESCE($2, costo_compra)'];
  const params = [imei || null, costo_compra ?? null];

  if (nota !== undefined) {
    params.push(nota != null && String(nota).trim() ? String(nota).trim() : null);
    sets.push(`nota = $${params.length}`);
  }
  if (color !== undefined) {
    params.push(color);
    sets.push(`color = $${params.length}`);
  }
  if (caracteristicas !== undefined) {
    params.push(caracteristicas != null ? JSON.stringify(caracteristicas) : null);
    sets.push(`caracteristicas = $${params.length}`);
  }
  if (precio !== undefined) {
    params.push(precio != null ? Number(precio) : null);
    sets.push(`precio = $${params.length}`);
  }
  params.push(serialId);

  const { rows } = await pool.query(
    `UPDATE seriales SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params,
  );
  return rows[0] || null;
};

const resetPreciosSeriales = async (productoId) => {
  await pool.query(
    'UPDATE seriales SET precio = NULL WHERE producto_id = $1',
    [productoId]
  );
};

const eliminarSerial = async (serialId) => {
  await pool.query('UPDATE lineas_traslado SET serial_id = NULL WHERE serial_id = $1', [serialId]);
  const { rows } = await pool.query(
    'DELETE FROM seriales WHERE id = $1 RETURNING id',
    [serialId]
  );
  return rows[0] || null;
};

// Normaliza texto en Node.js: quita acentos, minúsculas, colapsa espacios
const normalizarBusqueda = (str) =>
  (str || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');

// Expresión SQL reutilizable: quita acentos comunes (español/colombiano) + minúsculas
const SA = "'áéíóúüñàèìòùâêîôûãõäëïöç'";
const TA = "'aeiouunaeioaeiouaaoaeioc'";
const sn = (col) => `translate(LOWER(${col}), ${SA}, ${TA})`;

const findComprasCliente = async (negocioId, q) => {
  const qNorm  = normalizarBusqueda(q);
  const filtro = qNorm
    ? `%${qNorm.replace(/[%_\\]/g, '\\$&').slice(0, 100)}%`
    : '%';

  const { rows: seriales } = await pool.query(`
    SELECT
      'compra' AS tipo, s.id, s.imei,
      s.cliente_origen AS nombre_cliente,
      NULL AS cedula_cliente, NULL AS cliente_id,
      ps.nombre AS nombre_producto, ps.marca, ps.modelo,
      s.creado_en AS fecha, s.costo_compra AS valor,
      su.nombre AS sucursal_nombre, NULL AS factura_id
    FROM seriales s
    JOIN productos_serial ps ON ps.id = s.producto_id
    JOIN sucursales        su ON su.id = ps.sucursal_id
    WHERE su.negocio_id = $1
      AND s.cliente_origen IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM retomas r
        JOIN facturas f ON f.id = r.factura_id
        JOIN sucursales sf ON sf.id = f.sucursal_id
        WHERE r.imei = s.imei AND sf.negocio_id = $1
      )
      AND (
        ${sn('s.cliente_origen')} LIKE $2 ESCAPE '\\'
        OR ${sn('ps.nombre')}     LIKE $2 ESCAPE '\\'
        OR LOWER(s.imei)          LIKE $2 ESCAPE '\\'
      )
    ORDER BY s.creado_en DESC
  `, [negocioId, filtro]);

  const { rows: retomas } = await pool.query(`
    SELECT
      'retoma' AS tipo, r.id, r.imei,
      f.nombre_cliente, f.cedula AS cedula_cliente, f.cliente_id,
      r.nombre_producto, NULL AS marca, NULL AS modelo,
      r.fecha, r.valor_retoma AS valor,
      su.nombre AS sucursal_nombre, f.id AS factura_id
    FROM retomas r
    JOIN facturas   f  ON f.id  = r.factura_id
    JOIN sucursales su ON su.id = f.sucursal_id
    WHERE su.negocio_id = $1
      AND (
        ${sn('f.nombre_cliente')}          LIKE $2 ESCAPE '\\'
        OR LOWER(f.cedula)                 LIKE $2 ESCAPE '\\'
        OR ${sn('r.nombre_producto')}      LIKE $2 ESCAPE '\\'
        OR LOWER(COALESCE(r.imei, ''))     LIKE $2 ESCAPE '\\'
      )
    ORDER BY r.fecha DESC
  `, [negocioId, filtro]);

  return { seriales, retomas };
};


const contarSerialesDetalle = async (productoId) => {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE vendido = false AND prestado = false) AS disponibles,
      COUNT(*) FILTER (WHERE prestado = true  AND vendido = false) AS prestados,
      COUNT(*) FILTER (WHERE vendido = true)                       AS vendidos,
      COUNT(*)                                                      AS total
    FROM seriales
    WHERE producto_id = $1
  `, [productoId]);
  return {
    disponibles: Number(rows[0].disponibles),
    prestados:   Number(rows[0].prestados),
    vendidos:    Number(rows[0].vendidos),
    total:       Number(rows[0].total),
  };
};

const eliminarSerialesDeProducto = async (client, productoId) => {
  await client.query(
    'UPDATE lineas_traslado SET serial_id = NULL WHERE serial_id IN (SELECT id FROM seriales WHERE producto_id = $1)',
    [productoId]
  );
  await client.query('DELETE FROM seriales WHERE producto_id = $1', [productoId]);
};

// Elimina el producto serial. Solo se llama si contarSeriales devuelve 0.
const eliminarProductoSerial = async (id) => {
  const { rows } = await pool.query(
    'DELETE FROM productos_serial WHERE id = $1 RETURNING id',
    [id]
  );
  return rows[0] || null;
};

// ── Añadir al module.exports existente: ──────────────────────────────────────
// contarSeriales, eliminarProductoSerial

const buscarPorImei = async (q, sucursalId, negocioId) => {
  const filtro = `%${q.replace(/[%_\\]/g, '\\$&').slice(0, 60)}%`;
  const { rows } = await pool.query(`
    SELECT
      s.id   AS serial_id,
      s.imei,
      s.vendido,
      s.prestado,
      ps.id   AS producto_id,
      ps.nombre AS producto_nombre,
      ps.precio
    FROM seriales s
    JOIN productos_serial ps ON ps.id = s.producto_id
    JOIN sucursales        su ON su.id = ps.sucursal_id
    WHERE su.negocio_id = $1
      AND ($2::int IS NULL OR ps.sucursal_id = $2)
      AND s.vendido  = false
      AND LOWER(s.imei) LIKE LOWER($3) ESCAPE '\\'
    ORDER BY s.prestado ASC, s.imei ASC
    LIMIT 30
  `, [negocioId, sucursalId ?? null, filtro]);
  return rows;
};

module.exports = {
  findAll, findById, findByIdYNegocio,
  perteneceAlNegocio, findSerialByIdYNegocio,
  create, update, updatePrecio,
  getSeriales, findSerialByIMEI, findSerialByIMEIEnNegocio,
  insertarSerial, reactivarSerial, actualizarSerial, eliminarSerial,
  resetPreciosSeriales,
  findComprasCliente, eliminarProductoSerial, contarSerialesDetalle, eliminarSerialesDeProducto,
  buscarPorImei,
};