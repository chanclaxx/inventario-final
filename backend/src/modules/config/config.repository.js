const { pool } = require('../../config/db');

const getMap = async (negocioId) => {
  const { rows } = await pool.query(
    `SELECT clave, valor FROM config_negocio WHERE negocio_id = $1`,
    [negocioId]
  );
  return Object.fromEntries(rows.map((r) => [r.clave, r.valor]));
};

const updateMany = async (negocioId, datos) => {
  const entries = Object.entries(datos);
  for (const [clave, valor] of entries) {
    await pool.query(
      `INSERT INTO config_negocio(negocio_id, clave, valor)
       VALUES ($1, $2, $3)
       ON CONFLICT (negocio_id, clave) DO UPDATE SET valor = EXCLUDED.valor`,
      [negocioId, clave, valor]
    );
  }
  return getMap(negocioId);
};

module.exports = { getMap, updateMany };