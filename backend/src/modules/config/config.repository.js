const { pool } = require('../../config/db');

const getMap = async (negocioId) => {
  const { rows } = await pool.query(
    'SELECT clave, valor FROM config_negocio WHERE negocio_id = $1',
    [negocioId]
  );
  return Object.fromEntries(rows.map(r => [r.clave, r.valor]));
};

const updateMany = async (negocioId, datos) => {
  const entries = Object.entries(datos);
  if (!entries.length) return getMap(negocioId);

  const claves  = entries.map(([k]) => k);
  const valores = entries.map(([, v]) => v);

  // Una sola query con unnest en lugar de N queries secuenciales
  await pool.query(
    `INSERT INTO config_negocio(negocio_id, clave, valor)
     SELECT $1, u.clave, u.valor
     FROM unnest($2::text[], $3::text[]) AS u(clave, valor)
     ON CONFLICT (negocio_id, clave) DO UPDATE SET valor = EXCLUDED.valor`,
    [negocioId, claves, valores]
  );

  return getMap(negocioId);
};

module.exports = { getMap, updateMany };