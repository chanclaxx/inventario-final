const { pool } = require('../../config/db');

const findAll = async (negocioId, filtro) => {
  let query = `
    SELECT c.id, c.nombre, c.cedula, c.celular, c.email,
           c.direccion, c.fecha_registro,
           COUNT(f.id) AS total_compras,
           COALESCE(SUM(l.subtotal), 0) AS total_gastado
    FROM clientes c
    LEFT JOIN facturas f
      ON f.cedula = c.cedula
      AND f.estado != 'Cancelada'
      AND f.sucursal_id IN (
        SELECT id FROM sucursales WHERE negocio_id = $1
      )
    LEFT JOIN lineas_factura l ON l.factura_id = f.id
    WHERE c.negocio_id = $1
  `;
  const params = [negocioId];

  if (filtro) {
    // ── Mismo escape que aplicamos en acreedores ──
    const filtroSeguro = filtro
      .toLowerCase()
      .replace(/[%_\\]/g, '\\$&')
      .slice(0, 100);

    params.push(`%${filtroSeguro}%`);
    query += ` AND (LOWER(c.nombre) LIKE $2 ESCAPE '\\' OR c.cedula LIKE $2 ESCAPE '\\' OR c.celular LIKE $2 ESCAPE '\\')`;
  }

  query += ` GROUP BY c.id ORDER BY c.nombre`;
  const { rows } = await pool.query(query, params);
  return rows;
};

const findById = async (negocioId, id) => {
  const { rows } = await pool.query(
    `SELECT * FROM clientes WHERE id = $1 AND negocio_id = $2`,
    [id, negocioId]
  );
  return rows[0] || null;
};

const findByCedula = async (negocioId, cedula) => {
  const { rows } = await pool.query(
    `SELECT * FROM clientes WHERE cedula = $1 AND negocio_id = $2`,
    [cedula, negocioId]
  );
  return rows[0] || null;
};

const getHistorialCompras = async (negocioId, cedula) => {
  const { rows } = await pool.query(`
    SELECT f.id, f.fecha, f.estado, f.sucursal_id,
           s.nombre AS sucursal_nombre,
           COALESCE(SUM(l.subtotal), 0) AS total
    FROM facturas f
    JOIN sucursales s ON s.id = f.sucursal_id
    LEFT JOIN lineas_factura l ON l.factura_id = f.id
    WHERE f.cedula = $1 AND s.negocio_id = $2
    GROUP BY f.id, s.nombre
    ORDER BY f.fecha DESC
  `, [cedula, negocioId]);
  return rows;
};

const create = async (negocioId, { nombre, cedula, celular, email, direccion }) => {
  const { rows } = await pool.query(`
    INSERT INTO clientes(negocio_id, nombre, cedula, celular, email, direccion)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [negocioId, nombre, cedula, celular, email, direccion]);
  return rows[0];
};

const update = async (negocioId, id, { nombre, celular, email, direccion }) => {
  const { rows } = await pool.query(`
    UPDATE clientes
    SET nombre = $1, celular = $2, email = $3, direccion = $4
    WHERE id = $5 AND negocio_id = $6
    RETURNING *
  `, [nombre, celular, email, direccion, id, negocioId]);
  return rows[0] || null;
};

const findFrecuentes = async (sucursalId) => {
  const { rows } = await pool.query(`
    SELECT c.id, c.nombre, c.cedula, c.celular, c.email, c.direccion
    FROM clientes_frecuentes cf
    JOIN clientes c ON c.id = cf.cliente_id
    WHERE cf.sucursal_id = $1
    ORDER BY c.nombre
  `, [sucursalId]);
  return rows;
};
 
const agregarFrecuente = async (sucursalId, clienteId) => {
  const { rows } = await pool.query(`
    INSERT INTO clientes_frecuentes(sucursal_id, cliente_id)
    VALUES ($1, $2)
    ON CONFLICT (sucursal_id, cliente_id) DO NOTHING
    RETURNING *
  `, [sucursalId, clienteId]);
  return rows[0] || null;
};
 
const quitarFrecuente = async (sucursalId, clienteId) => {
  const { rows } = await pool.query(`
    DELETE FROM clientes_frecuentes
    WHERE sucursal_id = $1 AND cliente_id = $2
    RETURNING id
  `, [sucursalId, clienteId]);
  return rows[0] || null;
};

module.exports = { findAll, findById, findByCedula, getHistorialCompras, create, update,findFrecuentes,agregarFrecuente,quitarFrecuente };