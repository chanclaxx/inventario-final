const { pool } = require('../../config/db');

// ─── Consultas ────────────────────────────────────────────────────────────────

const findAll = async (negocioId, tipo = null) => {
  const params = [negocioId];
  let filtroTipo = '';

  if (tipo) {
    params.push(tipo);
    filtroTipo = `AND p.tipo = $${params.length}`;
  }

  const { rows } = await pool.query(`
    SELECT p.id, p.nombre, p.nit, p.telefono, p.email,
           p.direccion, p.contacto, p.tipo, p.activo, p.creado_en,
           COUNT(c.id) AS total_compras
    FROM proveedores p
    LEFT JOIN compras c ON c.proveedor_id = p.id
    WHERE p.negocio_id = $1 AND p.activo = TRUE ${filtroTipo}
    GROUP BY p.id
    ORDER BY p.nombre
  `, params);
  return rows;
};

const findById = async (negocioId, id) => {
  const { rows } = await pool.query(
    `SELECT * FROM proveedores WHERE id = $1 AND negocio_id = $2`,
    [id, negocioId]
  );
  return rows[0] || null;
};

const create = async (negocioId, { nombre, nit, telefono, email, direccion, contacto, tipo = 'proveedor' }) => {
  const { rows } = await pool.query(`
    INSERT INTO proveedores(negocio_id, nombre, nit, telefono, email, direccion, contacto, tipo)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `, [negocioId, nombre, nit, telefono, email, direccion, contacto, tipo]);
  return rows[0];
};

const update = async (negocioId, id, { nombre, nit, telefono, email, direccion, contacto, tipo }) => {
  // Si no viene tipo, no lo modificamos (mantiene el actual)
  const setClauses = [
    'nombre = $1', 'nit = $2', 'telefono = $3',
    'email = $4', 'direccion = $5', 'contacto = $6',
  ];
  const params = [nombre, nit, telefono, email, direccion, contacto];

  if (tipo) {
    params.push(tipo);
    setClauses.push(`tipo = $${params.length}`);
  }

  params.push(id, negocioId);
  const idIdx = params.length - 1;
  const negIdx = params.length;

  const { rows } = await pool.query(`
    UPDATE proveedores
    SET ${setClauses.join(', ')}
    WHERE id = $${idIdx} AND negocio_id = $${negIdx}
    RETURNING *
  `, params);
  return rows[0] || null;
};

const eliminar = async (negocioId, id) => {
  const { rowCount } = await pool.query(
    `UPDATE proveedores SET activo = FALSE WHERE id = $1 AND negocio_id = $2`,
    [id, negocioId]
  );
  return rowCount > 0;
};

const findByNit = async (negocioId, nit) => {
  const { rows } = await pool.query(
    `SELECT id FROM proveedores WHERE nit = $1 AND negocio_id = $2 AND activo = TRUE LIMIT 1`,
    [nit, negocioId]
  );
  return rows[0] || null;
};

const contarDependenciasActivas = async (negocioId, proveedorId) => {
  const { rows } = await pool.query(`
    SELECT
      COUNT(DISTINCT pc.id) FILTER (
        WHERE pc.proveedor_id = $1 AND pc.activo = TRUE
      ) AS productos_cantidad,
      COUNT(DISTINCT ps.id) FILTER (
        WHERE ps.proveedor_id = $1 AND ps.activo = TRUE
      ) AS productos_serial
    FROM sucursales su
    LEFT JOIN productos_cantidad pc ON pc.sucursal_id = su.id
    LEFT JOIN productos_serial   ps ON ps.sucursal_id = su.id
    WHERE su.negocio_id = $2
  `, [proveedorId, negocioId]);

  const row = rows[0];
  return {
    productos: Number(row.productos_cantidad) + Number(row.productos_serial),
  };
};

module.exports = {
  findAll, findById, findByNit,
  contarDependenciasActivas,
  create, update, eliminar,
};