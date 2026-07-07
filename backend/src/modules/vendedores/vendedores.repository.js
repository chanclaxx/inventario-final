const { pool } = require('../../config/db');

// ── findAll ───────────────────────────────────────────────────────────────────
// Todos los vendedores del negocio (gestión del admin). Incluye sucursal.
// Filtro opcional por sucursal_id.

const findAll = async (negocioId, { sucursalId, soloActivos } = {}) => {
  const condiciones = ['v.negocio_id = $1'];
  const params      = [negocioId];

  if (sucursalId) {
    params.push(sucursalId);
    condiciones.push(`v.sucursal_id = $${params.length}`);
  }
  if (soloActivos) {
    condiciones.push('v.activo = true');
  }

  const { rows } = await pool.query(
    `SELECT v.id, v.nombre, v.sucursal_id, v.activo, v.creado_en,
            s.nombre AS sucursal_nombre
     FROM vendedores v
     JOIN sucursales s ON s.id = v.sucursal_id
     WHERE ${condiciones.join(' AND ')}
     ORDER BY s.nombre ASC, v.nombre ASC`,
    params
  );
  return rows;
};

// ── findById ──────────────────────────────────────────────────────────────────
// Valida negocio_id para impedir lectura cruzada entre negocios.

const findById = async (id, negocioId) => {
  const { rows } = await pool.query(
    `SELECT id, nombre, sucursal_id, activo, creado_en
     FROM vendedores
     WHERE id = $1 AND negocio_id = $2`,
    [id, negocioId]
  );
  return rows[0] || null;
};

// ── create ────────────────────────────────────────────────────────────────────

const create = async ({ negocioId, sucursalId, nombre }) => {
  const { rows } = await pool.query(
    `INSERT INTO vendedores(negocio_id, sucursal_id, nombre)
     VALUES ($1, $2, $3)
     RETURNING id, nombre, sucursal_id, activo, creado_en`,
    [negocioId, sucursalId, nombre]
  );
  return rows[0];
};

// ── update ────────────────────────────────────────────────────────────────────

const update = async (id, negocioId, { nombre, sucursalId, activo }) => {
  const { rows } = await pool.query(
    `UPDATE vendedores
     SET nombre      = COALESCE($1, nombre),
         sucursal_id = COALESCE($2, sucursal_id),
         activo      = COALESCE($3, activo)
     WHERE id = $4 AND negocio_id = $5
     RETURNING id, nombre, sucursal_id, activo, creado_en`,
    [nombre || null, sucursalId ?? null, activo ?? null, id, negocioId]
  );
  return rows[0] || null;
};

// ── validarEnSucursalTx ───────────────────────────────────────────────────────
// Verifica dentro de una transacción que el vendedor pertenezca al negocio,
// a la sucursal indicada y esté activo. Se usa al crear/editar facturas.

const validarEnSucursalTx = async (client, vendedorId, negocioId, sucursalId) => {
  const { rows } = await client.query(
    `SELECT id FROM vendedores
     WHERE id = $1 AND negocio_id = $2 AND sucursal_id = $3 AND activo = true`,
    [vendedorId, negocioId, sucursalId]
  );
  return rows.length > 0;
};

module.exports = {
  findAll,
  findById,
  create,
  update,
  validarEnSucursalTx,
};
