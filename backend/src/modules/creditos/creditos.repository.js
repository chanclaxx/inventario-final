const { pool } = require('../../config/db');

const findAll = async (sucursalId, negocioId) => {
  const filtro = sucursalId ? 'c.sucursal_id = $1' : 'su.negocio_id = $1';
  const param  = sucursalId ?? negocioId;

  const { rows } = await pool.query(`
    SELECT
      c.id, c.valor_total, c.total_abonado, c.num_cuotas,
      c.estado, c.fecha_limite, c.creado_en, c.sucursal_id,
      su.nombre AS sucursal_nombre,
      (c.valor_total - c.total_abonado) AS saldo_pendiente,
      f.nombre_cliente, f.cedula, f.celular
    FROM creditos c
    JOIN facturas   f  ON f.id  = c.factura_id
    JOIN sucursales su ON su.id = c.sucursal_id
    WHERE ${filtro}
    ORDER BY
      CASE c.estado WHEN 'Activo' THEN 0 WHEN 'Vencido' THEN 1 ELSE 2 END,
      c.creado_en DESC
  `, [param]);
  return rows;
};

const findById = async (id) => {
  const { rows } = await pool.query(`
    SELECT c.*, f.nombre_cliente, f.cedula, f.celular, su.nombre AS sucursal_nombre
    FROM creditos   c
    JOIN facturas   f  ON f.id  = c.factura_id
    JOIN sucursales su ON su.id = c.sucursal_id
    WHERE c.id = $1
  `, [id]);
  return rows[0] || null;
};

const perteneceAlNegocio = async (id, negocioId) => {
  const { rows } = await pool.query(`
    SELECT c.id FROM creditos c
    JOIN sucursales s ON s.id = c.sucursal_id
    WHERE c.id = $1 AND s.negocio_id = $2
  `, [id, negocioId]);
  return rows.length > 0;
};

const getAbonos = async (creditoId) => {
  const { rows } = await pool.query(
    'SELECT * FROM abonos_credito WHERE credito_id = $1 ORDER BY fecha',
    [creditoId]
  );
  return rows;
};

const create = async (client, { factura_id, cliente_id, sucursal_id, valor_total, num_cuotas, fecha_limite }) => {
  const { rows } = await client.query(`
    INSERT INTO creditos(factura_id, cliente_id, sucursal_id, valor_total, num_cuotas, fecha_limite)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [factura_id, cliente_id, sucursal_id, valor_total, num_cuotas, fecha_limite]);
  return rows[0];
};

const insertarAbono = async (client, { credito_id, usuario_id, valor, metodo, notas }) => {
  await client.query(`
    INSERT INTO abonos_credito(credito_id, usuario_id, valor, metodo, notas)
    VALUES ($1, $2, $3, $4, $5)
  `, [credito_id, usuario_id, valor, metodo, notas]);

  const { rows } = await client.query(`
    UPDATE creditos SET total_abonado = total_abonado + $1
    WHERE id = $2
    RETURNING valor_total, total_abonado
  `, [valor, credito_id]);
  return rows[0];
};

const updateEstado = async (client, id, estado) => {
  await client.query('UPDATE creditos SET estado = $1 WHERE id = $2', [estado, id]);
};

module.exports = {
  findAll, findById, perteneceAlNegocio,
  getAbonos, create, insertarAbono, updateEstado,
};