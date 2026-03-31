const { pool } = require('../../config/db');

// ── Métodos de pago por defecto ──────────────────────────────────────────────
// Estos son los que usan todos los negocios que no han personalizado.
// NUNCA se eliminan de la BD — solo se agregan nuevos o se reordenan.
const METODOS_PAGO_DEFAULT = ['Efectivo', 'Nequi', 'Daviplata', 'Transferencia', 'Tarjeta'];

// ── Leer métodos de pago de un negocio ───────────────────────────────────────
// Devuelve el array configurado o los defaults si no hay configuración.
const getMetodosPago = async (negocioId) => {
  const { rows } = await pool.query(
    `SELECT valor FROM config_negocio WHERE negocio_id = $1 AND clave = 'metodos_pago'`,
    [negocioId]
  );

  if (!rows.length || !rows[0].valor) return METODOS_PAGO_DEFAULT;

  try {
    const parsed = JSON.parse(rows[0].valor);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : METODOS_PAGO_DEFAULT;
  } catch {
    return METODOS_PAGO_DEFAULT;
  }
};

// ── Validar que un método pertenece al negocio ───────────────────────────────
const esMetodoValido = async (metodo, negocioId) => {
  const metodos = await getMetodosPago(negocioId);
  return metodos.includes(metodo);
};

module.exports = { METODOS_PAGO_DEFAULT, getMetodosPago, esMetodoValido };