const { pool } = require('../../config/db');

// ── Árbol completo de un producto (atributos + variantes anidadas) ────────────

const getArbol = async (productoId, sucursalId) => {
  const { rows: atributos } = await pool.query(
    `SELECT
       ap.id, ap.tipo_id, tc.nombre AS tipo_nombre, ap.valor,
       ap.stock, ap.stock_minimo, ap.precio, ap.costo_unitario, ap.activo
     FROM atributos_producto ap
     LEFT JOIN tipos_caracteristica tc ON tc.id = ap.tipo_id
     WHERE ap.producto_id = $1 AND ap.sucursal_id = $2 AND ap.activo = true
     ORDER BY tc.orden ASC NULLS LAST, ap.valor ASC`,
    [productoId, sucursalId]
  );
  if (!atributos.length) return [];

  const atributoIds = atributos.map((a) => a.id);
  const { rows: variantes } = await pool.query(
    `SELECT
       v.id, v.atributo_id, v.tipo_id, tc.nombre AS tipo_nombre, v.valor,
       v.stock, v.stock_minimo, v.precio, v.costo_unitario, v.activo
     FROM variantes_atributo v
     LEFT JOIN tipos_caracteristica tc ON tc.id = v.tipo_id
     WHERE v.atributo_id = ANY($1) AND v.activo = true
     ORDER BY tc.orden ASC NULLS LAST, v.valor ASC`,
    [atributoIds]
  );

  const varsByAtributo = {};
  for (const v of variantes) {
    if (!varsByAtributo[v.atributo_id]) varsByAtributo[v.atributo_id] = [];
    varsByAtributo[v.atributo_id].push(v);
  }
  return atributos.map((a) => ({ ...a, variantes: varsByAtributo[a.id] || [] }));
};

// ── Verificaciones de pertenencia al negocio ──────────────────────────────────

const verificarProductoNegocio = async (productoId, negocioId) => {
  const { rows } = await pool.query(
    `SELECT pc.id, pc.sucursal_id, pc.stock, pc.costo_unitario
     FROM productos_cantidad pc
     JOIN sucursales su ON su.id = pc.sucursal_id
     WHERE pc.id = $1 AND su.negocio_id = $2 AND pc.activo = true`,
    [productoId, negocioId]
  );
  return rows[0] || null;
};

const verificarAtributoNegocio = async (atributoId, negocioId) => {
  const { rows } = await pool.query(
    `SELECT ap.id, ap.producto_id, ap.sucursal_id, ap.stock, ap.costo_unitario
     FROM atributos_producto ap
     JOIN sucursales su ON su.id = ap.sucursal_id
     WHERE ap.id = $1 AND su.negocio_id = $2 AND ap.activo = true`,
    [atributoId, negocioId]
  );
  return rows[0] || null;
};

const verificarVarianteNegocio = async (varianteId, negocioId) => {
  const { rows } = await pool.query(
    `SELECT v.id, v.atributo_id, v.stock, v.costo_unitario,
            ap.producto_id, ap.sucursal_id
     FROM variantes_atributo v
     JOIN atributos_producto ap ON ap.id = v.atributo_id
     JOIN sucursales su ON su.id = ap.sucursal_id
     WHERE v.id = $1 AND su.negocio_id = $2 AND v.activo = true`,
    [varianteId, negocioId]
  );
  return rows[0] || null;
};

// ── CRUD de atributos ─────────────────────────────────────────────────────────

const crearAtributo = async (productoId, sucursalId, { tipo_id, valor, stock = 0, stock_minimo = 0, precio, costo_unitario }) => {
  const { rows } = await pool.query(
    `INSERT INTO atributos_producto (producto_id, sucursal_id, tipo_id, valor, stock, stock_minimo, precio, costo_unitario)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, tipo_id, valor, stock, stock_minimo, precio, costo_unitario, activo`,
    [productoId, sucursalId, tipo_id || null, valor.trim(), stock, stock_minimo, precio || null, costo_unitario || null]
  );
  return rows[0];
};

const actualizarAtributo = async (id, { valor, stock_minimo, precio, costo_unitario }) => {
  const sets = [];
  const params = [id];
  if (valor !== undefined) { sets.push(`valor = $${params.length + 1}`); params.push(valor.trim()); }
  if (stock_minimo !== undefined) { sets.push(`stock_minimo = $${params.length + 1}`); params.push(stock_minimo); }
  if (precio !== undefined) { sets.push(`precio = $${params.length + 1}`); params.push(precio || null); }
  if (costo_unitario !== undefined) { sets.push(`costo_unitario = $${params.length + 1}`); params.push(costo_unitario || null); }
  if (!sets.length) return null;
  const { rows } = await pool.query(
    `UPDATE atributos_producto SET ${sets.join(', ')}
     WHERE id = $1
     RETURNING id, valor, stock, stock_minimo, precio, costo_unitario`,
    params
  );
  return rows[0] || null;
};

const eliminarAtributo = async (id) => {
  await pool.query('UPDATE atributos_producto SET activo = false WHERE id = $1', [id]);
};

// ── CRUD de variantes ─────────────────────────────────────────────────────────

const crearVariante = async (atributoId, { tipo_id, valor, stock = 0, stock_minimo = 0, precio, costo_unitario }) => {
  const { rows } = await pool.query(
    `INSERT INTO variantes_atributo (atributo_id, tipo_id, valor, stock, stock_minimo, precio, costo_unitario)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, tipo_id, valor, stock, stock_minimo, precio, costo_unitario, activo`,
    [atributoId, tipo_id || null, valor.trim(), stock, stock_minimo, precio || null, costo_unitario || null]
  );
  return rows[0];
};

const actualizarVariante = async (id, { valor, stock_minimo, precio, costo_unitario }) => {
  const sets = [];
  const params = [id];
  if (valor !== undefined) { sets.push(`valor = $${params.length + 1}`); params.push(valor.trim()); }
  if (stock_minimo !== undefined) { sets.push(`stock_minimo = $${params.length + 1}`); params.push(stock_minimo); }
  if (precio !== undefined) { sets.push(`precio = $${params.length + 1}`); params.push(precio || null); }
  if (costo_unitario !== undefined) { sets.push(`costo_unitario = $${params.length + 1}`); params.push(costo_unitario || null); }
  if (!sets.length) return null;
  const { rows } = await pool.query(
    `UPDATE variantes_atributo SET ${sets.join(', ')}
     WHERE id = $1
     RETURNING id, valor, stock, stock_minimo, precio, costo_unitario`,
    params
  );
  return rows[0] || null;
};

const eliminarVariante = async (id) => {
  await pool.query('UPDATE variantes_atributo SET activo = false WHERE id = $1', [id]);
};

// ── Ajustes de stock con historial ───────────────────────────────────────────

const ajustarStockAtributo = async (atributoId, cantidad, productoId, sucursalId, opciones = {}) => {
  let updateQ, updateP;
  if (opciones._costo_nuevo != null) {
    updateQ = `UPDATE atributos_producto SET stock = stock + $1, costo_unitario = $3 WHERE id = $2 RETURNING stock`;
    updateP = [cantidad, atributoId, opciones._costo_nuevo];
  } else {
    updateQ = `UPDATE atributos_producto SET stock = stock + $1 WHERE id = $2 RETURNING stock`;
    updateP = [cantidad, atributoId];
  }
  const { rows } = await pool.query(updateQ, updateP);
  await pool.query(
    `INSERT INTO historial_stock_cantidad
       (producto_id, sucursal_id, cantidad, costo_unitario, tipo,
        cliente_origen, cedula_cliente, proveedor_id, notas, atributo_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      productoId, sucursalId, cantidad,
      opciones.costo_unitario || null,
      opciones.tipo || 'ajuste',
      opciones.cliente_origen || null,
      opciones.cedula_cliente || null,
      opciones.proveedor_id   || null,
      opciones.notas          || null,
      atributoId,
    ]
  );
  return rows[0];
};

const ajustarStockVariante = async (varianteId, atributoId, cantidad, productoId, sucursalId, opciones = {}) => {
  let updateQ, updateP;
  if (opciones._costo_nuevo != null) {
    updateQ = `UPDATE variantes_atributo SET stock = stock + $1, costo_unitario = $3 WHERE id = $2 RETURNING stock`;
    updateP = [cantidad, varianteId, opciones._costo_nuevo];
  } else {
    updateQ = `UPDATE variantes_atributo SET stock = stock + $1 WHERE id = $2 RETURNING stock`;
    updateP = [cantidad, varianteId];
  }
  const { rows } = await pool.query(updateQ, updateP);
  await pool.query(
    `INSERT INTO historial_stock_cantidad
       (producto_id, sucursal_id, cantidad, costo_unitario, tipo,
        cliente_origen, cedula_cliente, proveedor_id, notas, variante_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      productoId, sucursalId, cantidad,
      opciones.costo_unitario || null,
      opciones.tipo || 'ajuste',
      opciones.cliente_origen || null,
      opciones.cedula_cliente || null,
      opciones.proveedor_id   || null,
      opciones.notas          || null,
      varianteId,
    ]
  );
  return rows[0];
};

// ── Sincronización de stock en cascada ───────────────────────────────────────
// Recalcula: variantes → atributo → producto

const sincronizarStockProducto = async (productoId) => {
  // Paso 1: atributos que tienen variantes activas → stock = SUM(variantes)
  await pool.query(
    `UPDATE atributos_producto ap
     SET stock = sub.total
     FROM (
       SELECT v.atributo_id, COALESCE(SUM(v.stock), 0) AS total
       FROM variantes_atributo v
       WHERE v.activo = true
       GROUP BY v.atributo_id
     ) sub
     WHERE ap.id = sub.atributo_id
       AND ap.producto_id = $1
       AND ap.activo = true`,
    [productoId]
  );
  // Paso 2: producto → stock = SUM(atributos), solo si tiene atributos activos
  await pool.query(
    `UPDATE productos_cantidad pc
     SET stock = sub.total
     FROM (
       SELECT ap.producto_id, COALESCE(SUM(ap.stock), 0) AS total
       FROM atributos_producto ap
       WHERE ap.activo = true AND ap.producto_id = $1
       GROUP BY ap.producto_id
     ) sub
     WHERE pc.id = sub.producto_id
       AND EXISTS (
         SELECT 1 FROM atributos_producto ap
         WHERE ap.producto_id = $1 AND ap.activo = true
       )`,
    [productoId]
  );
};

// ── Sincroniza costo del producto padre con el de la última variante modificada ──
// Cuando variantes está activo, el producto padre refleja el último costo registrado.

const sincronizarCostoProducto = async (productoId, costoNuevo) => {
  if (costoNuevo == null) return;
  await pool.query(
    'UPDATE productos_cantidad SET costo_unitario = $1 WHERE id = $2',
    [costoNuevo, productoId]
  );
};

// ── Versiones dentro de transacción (para facturas) ──────────────────────────

const ajustarStockAtributoEnTx = async (client, atributoId, cantidad) => {
  await client.query(
    'UPDATE atributos_producto SET stock = stock + $1 WHERE id = $2',
    [cantidad, atributoId]
  );
};

const ajustarStockVarianteEnTx = async (client, varianteId, cantidad) => {
  await client.query(
    'UPDATE variantes_atributo SET stock = stock + $1 WHERE id = $2',
    [cantidad, varianteId]
  );
};

const sincronizarStockProductoEnTx = async (client, productoId) => {
  await client.query(
    `UPDATE atributos_producto ap
     SET stock = sub.total
     FROM (
       SELECT v.atributo_id, COALESCE(SUM(v.stock), 0) AS total
       FROM variantes_atributo v
       WHERE v.activo = true
       GROUP BY v.atributo_id
     ) sub
     WHERE ap.id = sub.atributo_id
       AND ap.producto_id = $1
       AND ap.activo = true`,
    [productoId]
  );
  await client.query(
    `UPDATE productos_cantidad pc
     SET stock = sub.total
     FROM (
       SELECT ap.producto_id, COALESCE(SUM(ap.stock), 0) AS total
       FROM atributos_producto ap
       WHERE ap.activo = true AND ap.producto_id = $1
       GROUP BY ap.producto_id
     ) sub
     WHERE pc.id = sub.producto_id
       AND EXISTS (
         SELECT 1 FROM atributos_producto ap
         WHERE ap.producto_id = $1 AND ap.activo = true
       )`,
    [productoId]
  );
};

module.exports = {
  getArbol,
  verificarProductoNegocio,
  verificarAtributoNegocio,
  verificarVarianteNegocio,
  crearAtributo, actualizarAtributo, eliminarAtributo,
  crearVariante, actualizarVariante, eliminarVariante,
  ajustarStockAtributo, ajustarStockVariante,
  sincronizarStockProducto, sincronizarCostoProducto,
  ajustarStockAtributoEnTx, ajustarStockVarianteEnTx, sincronizarStockProductoEnTx,
};
