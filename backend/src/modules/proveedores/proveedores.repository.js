const { pool } = require('../../config/db');

const findAll = async (negocioId) => {
  const { rows } = await pool.query(`
    SELECT p.id, p.nombre, p.nit, p.telefono, p.email,
           p.direccion, p.contacto, p.activo, p.creado_en,
           COUNT(c.id) AS total_compras
    FROM proveedores p
    LEFT JOIN compras c ON c.proveedor_id = p.id
    WHERE p.negocio_id = $1 AND p.activo = TRUE
    GROUP BY p.id
    ORDER BY p.nombre
  `, [negocioId]);
  return rows;
};

const findById = async (negocioId, id) => {
  const { rows } = await pool.query(
    `SELECT * FROM proveedores WHERE id = $1 AND negocio_id = $2`,
    [id, negocioId]
  );
  return rows[0] || null;
};

const create = async (negocioId, { nombre, nit, telefono, email, direccion, contacto }) => {
  const { rows } = await pool.query(`
    INSERT INTO proveedores(negocio_id, nombre, nit, telefono, email, direccion, contacto)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `, [negocioId, nombre, nit, telefono, email, direccion, contacto]);
  return rows[0];
};

const update = async (negocioId, id, { nombre, nit, telefono, email, direccion, contacto }) => {
  const { rows } = await pool.query(`
    UPDATE proveedores
    SET nombre = $1, nit = $2, telefono = $3,
        email = $4, direccion = $5, contacto = $6
    WHERE id = $7 AND negocio_id = $8
    RETURNING *
  `, [nombre, nit, telefono, email, direccion, contacto, id, negocioId]);
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
  // Verificar por negocio_id para no cruzar tenants
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