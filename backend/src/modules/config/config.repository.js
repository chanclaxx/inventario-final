const { pool } = require('../../config/db');

// ── Claves que nunca se exponen en getMap ─────────────────────────────────────
// Añadir aquí cualquier clave futura que deba mantenerse privada.
const CLAVES_PRIVADAS = new Set(['pin_eliminacion']);

const getMap = async (negocioId) => {
  const { rows } = await pool.query(
    'SELECT clave, valor FROM config_negocio WHERE negocio_id = $1',
    [negocioId]
  );
  // Filtrar claves privadas — el frontend nunca recibe su valor
  return Object.fromEntries(
    rows
      .filter((r) => !CLAVES_PRIVADAS.has(r.clave))
      .map((r) => [r.clave, r.valor])
  );
};

// Obtiene el valor raw de una clave (incluidas las privadas).
// Solo para uso interno del service — nunca exponer directamente al cliente.
const getValorPrivado = async (negocioId, clave) => {
  const { rows } = await pool.query(
    'SELECT valor FROM config_negocio WHERE negocio_id = $1 AND clave = $2',
    [negocioId, clave]
  );
  return rows[0]?.valor ?? null;
};

const updateMany = async (negocioId, datos) => {
  const entries = Object.entries(datos);
  if (!entries.length) return getMap(negocioId);

  const claves  = entries.map(([k]) => k);
  const valores = entries.map(([, v]) => v);

  await pool.query(
    `INSERT INTO config_negocio(negocio_id, clave, valor)
     SELECT $1, u.clave, u.valor
     FROM unnest($2::text[], $3::text[]) AS u(clave, valor)
     ON CONFLICT (negocio_id, clave) DO UPDATE SET valor = EXCLUDED.valor`,
    [negocioId, claves, valores]
  );

  return getMap(negocioId);
};

module.exports = { getMap, getValorPrivado, updateMany, CLAVES_PRIVADAS };