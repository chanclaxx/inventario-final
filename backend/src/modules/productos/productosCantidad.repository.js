const { pool } = require('../../config/db');
const { hayUbicacion } = require('../../config/columnas');

// Ubicación espacial (feature opt-in). Se interpola solo si la columna existe
// en la BD: si la migración no llegó a aplicarse, estas consultas quedan
// exactamente como estaban en vez de reventar el inventario entero.
// No es entrada de usuario — es un literal SQL fijo.
const selUbicacion = (alias) => (hayUbicacion() ? `${alias}.ubicacion,` : '');

const findAll = async (sucursalId, negocioId, lineaId) => {
  if (sucursalId) {
    const { rows } = await pool.query(`
      SELECT
        pc.id, pc.nombre, pc.stock, pc.stock_minimo,
        pc.unidad_medida, pc.costo_unitario, pc.precio,
        pc.cliente_origen, pc.activo, pc.sucursal_id, pc.proveedor_id,
        pc.linea_id, pc.creado_en, pc.nota, pc.codigo,
        ${selUbicacion('pc')}
        lp.nombre AS linea_nombre,
        p.nombre  AS proveedor_nombre,
        su.nombre AS sucursal_nombre,
        CASE WHEN pc.stock <= pc.stock_minimo THEN true ELSE false END AS stock_bajo,
        -- Días que el producto lleva en el inventario (calculado en zona America/Bogota)
        (CURRENT_DATE - pc.creado_en::date)::int AS dias_en_inventario,
        -- Última venta y días transcurridos desde ella (para detectar productos que no rotan)
        uv.ultima_venta,
        (CURRENT_DATE - uv.ultima_venta::date)::int AS dias_sin_venta
      FROM productos_cantidad pc
      LEFT JOIN proveedores    p  ON p.id  = pc.proveedor_id
      LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
      JOIN  sucursales         su ON su.id = pc.sucursal_id
      LEFT JOIN LATERAL (
        SELECT MAX(f.fecha) AS ultima_venta
        FROM lineas_factura lf
        JOIN facturas f ON f.id = lf.factura_id AND f.estado <> 'Cancelada'
        WHERE lf.producto_id = pc.id
      ) uv ON true
      WHERE pc.sucursal_id = $1
        AND pc.activo = true
        AND ($2::int IS NULL OR pc.linea_id = $2)
      ORDER BY pc.nombre
    `, [sucursalId, lineaId ?? null]);
    return { modo: 'sucursal', items: rows };
  }

  // Vista global
  const { rows } = await pool.query(`
    SELECT
      pc.nombre,
      pc.linea_id,
      lp.nombre AS linea_nombre,
      MIN(pc.codigo)                       AS codigo,
      SUM(pc.stock)                        AS stock_total,
      BOOL_OR(pc.stock <= pc.stock_minimo) AS stock_bajo,
      -- Antigüedad: días del registro más viejo del grupo (el que lleva más tiempo)
      (CURRENT_DATE - MIN(pc.creado_en)::date)::int AS dias_en_inventario,
      JSON_AGG(
        JSON_BUILD_OBJECT(
          'id',               pc.id,
          'sucursal_id',      pc.sucursal_id,
          'sucursal_nombre',  su.nombre,
          'stock',            pc.stock,
          'stock_minimo',     pc.stock_minimo,
          'costo_unitario',   pc.costo_unitario,
          'precio',           pc.precio,
          'proveedor_id',     pc.proveedor_id,
          'proveedor_nombre', p.nombre,
          'codigo',           pc.codigo,
          ${hayUbicacion() ? `'ubicacion', pc.ubicacion,` : ''}
          'stock_bajo',       pc.stock <= pc.stock_minimo
        ) ORDER BY su.nombre
      ) AS sucursales
    FROM productos_cantidad pc
    JOIN  sucursales         su ON su.id = pc.sucursal_id
    LEFT JOIN proveedores    p  ON p.id  = pc.proveedor_id
    LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
    WHERE su.negocio_id = $1
      AND pc.activo = true
      AND ($2::int IS NULL OR pc.linea_id = $2)
    GROUP BY pc.nombre, pc.linea_id, lp.nombre
    ORDER BY pc.nombre
  `, [negocioId, lineaId ?? null]);
  return { modo: 'global', items: rows };
};

const findById = async (id) => {
  const { rows } = await pool.query(`
    SELECT pc.*, p.nombre AS proveedor_nombre, su.nombre AS sucursal_nombre,
           lp.nombre AS linea_nombre
    FROM productos_cantidad pc
    LEFT JOIN proveedores    p  ON p.id  = pc.proveedor_id
    LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
    JOIN  sucursales         su ON su.id = pc.sucursal_id
    WHERE pc.id = $1
  `, [id]);
  return rows[0] || null;
};

const perteneceAlNegocio = async (id, negocioId) => {
  const { rows } = await pool.query(`
    SELECT pc.id FROM productos_cantidad pc
    JOIN sucursales s ON s.id = pc.sucursal_id
    WHERE pc.id = $1 AND s.negocio_id = $2
  `, [id, negocioId]);
  return rows.length > 0;
};

// ── linea_id incluido en create ───────────────────────────────────────────
const create = async ({
  nombre, stock, stock_minimo, unidad_medida,
  costo_unitario, precio, sucursal_id, proveedor_id, linea_id, codigo, ubicacion,
}) => {
  const conUbicacion = hayUbicacion();
  const { rows } = await pool.query(`
    INSERT INTO productos_cantidad
      (nombre, stock, stock_minimo, unidad_medida,
       costo_unitario, precio, sucursal_id, proveedor_id, linea_id, codigo${conUbicacion ? ', ubicacion' : ''})
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10${conUbicacion ? ', $11' : ''})
    RETURNING *
  `, [
    nombre, stock || 0, stock_minimo || 0, unidad_medida || 'unidad',
    costo_unitario || null, precio || null,
    sucursal_id, proveedor_id || null, linea_id || null,
    codigo || null,
    ...(conUbicacion ? [ubicacion || null] : []),
  ]);
  return rows[0];
};

// ── linea_id incluido en update ───────────────────────────────────────────
const update = async (id, {
  nombre, stock_minimo, unidad_medida,
  costo_unitario, precio, proveedor_id, linea_id, nota, codigo, ubicacion,
}) => {
  // Misma escritura condicional que `nota` y `codigo`: si el campo no viene en
  // el payload no se toca. Así un guardado parcial nunca borra la ubicación.
  const conUbicacion = hayUbicacion();
  const { rows } = await pool.query(`
    UPDATE productos_cantidad
    SET nombre         = $1,
        stock_minimo   = $2,
        unidad_medida  = $3,
        costo_unitario = $4,
        precio         = $5,
        proveedor_id   = $6,
        linea_id       = $7,
        nota           = CASE WHEN $8::boolean  THEN $9  ELSE nota   END,
        codigo         = CASE WHEN $10::boolean THEN $11 ELSE codigo END
        ${conUbicacion ? ', ubicacion = CASE WHEN $13::boolean THEN $14 ELSE ubicacion END' : ''}
    WHERE id = $12
    RETURNING *
  `, [
    nombre, stock_minimo, unidad_medida,
    costo_unitario || null, precio || null,
    proveedor_id || null, linea_id || null,
    nota !== undefined,
    nota != null && String(nota).trim() ? String(nota).trim() : null,
    codigo !== undefined,
    codigo || null,
    id,
    ...(conUbicacion ? [ubicacion !== undefined, ubicacion || null] : []),
  ]);
  return rows[0] || null;
};

// ── Código único de producto (feature opt-in tipo supermercado) ───────────
// Un código dentro del negocio solo puede apuntar a UN producto lógico
// (= un nombre). Devuelve el producto en conflicto, si existe.
const codigoEnConflicto = async (negocioId, codigo, nombre, excluirId = null) => {
  const { rows } = await pool.query(`
    SELECT pc.id, pc.nombre, su.nombre AS sucursal_nombre
    FROM productos_cantidad pc
    JOIN sucursales su ON su.id = pc.sucursal_id
    WHERE su.negocio_id = $1
      AND pc.activo = true
      AND pc.codigo = $2
      AND LOWER(pc.nombre) <> LOWER($3)
      AND ($4::int IS NULL OR pc.id <> $4)
    LIMIT 1
  `, [negocioId, codigo, nombre, excluirId]);
  return rows[0] || null;
};

// El mismo producto lógico (mismo nombre) creado en otra sucursal debe usar
// el mismo código: devuelve el código ya asignado a ese nombre en el negocio.
// Solo lo hereda si en la sucursal destino ese código está libre (evita chocar
// con el índice único ante datos heredados inconsistentes).
const codigoHeredado = async (negocioId, nombre, sucursalId) => {
  const { rows } = await pool.query(`
    SELECT pc.codigo
    FROM productos_cantidad pc
    JOIN sucursales su ON su.id = pc.sucursal_id
    WHERE su.negocio_id = $1
      AND pc.activo = true
      AND pc.codigo IS NOT NULL
      AND LOWER(pc.nombre) = LOWER($2)
      AND NOT EXISTS (
        SELECT 1 FROM productos_cantidad x
        WHERE x.sucursal_id = $3 AND x.activo = true AND x.codigo = pc.codigo
      )
    LIMIT 1
  `, [negocioId, nombre, sucursalId]);
  return rows[0]?.codigo || null;
};

// Propaga el código a las filas hermanas del mismo producto lógico
// (mismo nombre) en las demás sucursales del negocio, para que el escaneo
// funcione en todas. Best-effort: nunca debe tumbar la operación principal.
const sincronizarCodigoPorNombre = async (negocioId, nombre, codigo) => {
  try {
    await pool.query(`
      UPDATE productos_cantidad pc
      SET codigo = $3
      FROM sucursales su
      WHERE su.id = pc.sucursal_id
        AND su.negocio_id = $1
        AND LOWER(pc.nombre) = LOWER($2)
        AND pc.activo = true
        AND pc.codigo IS DISTINCT FROM $3
    `, [negocioId, nombre, codigo ?? null]);
  } catch (err) {
    console.warn('⚠️ No se pudo sincronizar el código entre sucursales:', err.message);
  }
};

const ajustarStock = async (id, cantidad, { costo_unitario, proveedor_id, cliente_origen } = {}) => {
  const sets   = ['stock = stock + $1'];
  const params = [cantidad, id];

  if (costo_unitario != null) {
    sets.push(`costo_unitario = $${params.length}`);
    params.splice(params.length - 1, 0, costo_unitario);
  }
  if (proveedor_id != null) {
    sets.push(`proveedor_id = $${params.length}`);
    params.splice(params.length - 1, 0, proveedor_id);
  }
  if (cliente_origen != null) {
    sets.push(`cliente_origen = $${params.length}`);
    params.splice(params.length - 1, 0, cliente_origen);
  }

  const { rows } = await pool.query(
    `UPDATE productos_cantidad SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  return rows[0] || null;
};

const eliminar = async (id) => {
  const { rowCount } = await pool.query(
    'UPDATE productos_cantidad SET activo = false WHERE id = $1',
    [id]
  );
  return rowCount > 0;
};

const insertarHistorial = async ({
  producto_id, sucursal_id, cantidad, costo_unitario,
  tipo, cliente_origen, cedula_cliente, proveedor_id, notas,
}) => {
  await pool.query(`
    INSERT INTO historial_stock_cantidad
      (producto_id, sucursal_id, cantidad, costo_unitario,
       tipo, cliente_origen, cedula_cliente, proveedor_id, notas)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
  `, [
    producto_id, sucursal_id, cantidad,
    costo_unitario ?? null,
    tipo           || 'ajuste',
    cliente_origen || null,
    cedula_cliente || null,
    proveedor_id   || null,
    notas          || null,
  ]);
};

const findByIdYNegocio = async (id, negocioId) => {
  const { rows } = await pool.query(`
    SELECT pc.*, p.nombre AS proveedor_nombre, su.nombre AS sucursal_nombre,
           lp.nombre AS linea_nombre
    FROM productos_cantidad pc
    LEFT JOIN proveedores    p  ON p.id  = pc.proveedor_id
    LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
    JOIN  sucursales         su ON su.id = pc.sucursal_id
    WHERE pc.id = $1 AND su.negocio_id = $2
  `, [id, negocioId]);
  return rows[0] || null;
};

const normalizarBusqueda = (str) =>
  (str || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');

const SA = "'áéíóúüñàèìòùâêîôûãõäëïöç'";
const TA = "'aeiouunaeioaeiouaaoaeioc'";
const sn = (col) => `translate(LOWER(${col}), ${SA}, ${TA})`;

const getHistorialStock = async (negocioId, q) => {
  const qNorm  = normalizarBusqueda(q);
  const filtro = qNorm
    ? `%${qNorm.replace(/[%_\\]/g, '\\$&').slice(0, 100)}%`
    : '%';

  const { rows } = await pool.query(`
    SELECT
      h.id, h.cantidad, h.costo_unitario, h.tipo,
      h.cliente_origen, h.cedula_cliente,
      h.creado_en AS fecha,
      pc.nombre   AS nombre_producto,
      pc.unidad_medida,
      su.nombre   AS sucursal_nombre,
      p.nombre    AS proveedor_nombre
    FROM historial_stock_cantidad h
    JOIN productos_cantidad pc ON pc.id = h.producto_id
    JOIN sucursales         su ON su.id = h.sucursal_id
    LEFT JOIN proveedores   p  ON p.id  = h.proveedor_id
    WHERE su.negocio_id = $1
      AND (
        ${sn('COALESCE(h.cliente_origen,   \'\')')} LIKE $2 ESCAPE '\\'
        OR LOWER(COALESCE(h.cedula_cliente, ''))    LIKE $2 ESCAPE '\\'
        OR ${sn('pc.nombre')}                       LIKE $2 ESCAPE '\\'
        OR LOWER(h.tipo)                            LIKE $2 ESCAPE '\\'
      )
    ORDER BY h.creado_en DESC
    LIMIT 200
  `, [negocioId, filtro]);
  return rows;
};

module.exports = {
  findAll, findById, findByIdYNegocio,
  perteneceAlNegocio,
  create, update, ajustarStock, eliminar,
  insertarHistorial, getHistorialStock,
  codigoEnConflicto, sincronizarCodigoPorNombre, codigoHeredado,
};