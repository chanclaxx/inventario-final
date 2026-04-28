// src/utils/fecha.util.js
// ─────────────────────────────────────────────────────────────────────────────
// Utilidades de fecha en zona horaria de Colombia (UTC-5 / America/Bogota).
// Úsalas en cualquier lugar donde necesites la fecha/hora actual del negocio.
// ─────────────────────────────────────────────────────────────────────────────

const ZONA = 'America/Bogota';

/**
 * Retorna la fecha actual en Colombia como string YYYY-MM-DD.
 * Usar en lugar de: new Date().toISOString().split('T')[0]
 */
function fechaHoyColombia() {
  return new Date().toLocaleDateString('en-CA', { timeZone: ZONA });
  // en-CA usa formato YYYY-MM-DD nativamente
}

/**
 * Retorna un objeto Date ajustado a medianoche hora colombiana.
 * Útil para comparaciones de fechas.
 */
function ahoraEnColombia() {
  const ahora = new Date();
  return new Date(ahora.toLocaleString('en-US', { timeZone: ZONA }));
}

module.exports = { fechaHoyColombia, ahoraEnColombia };