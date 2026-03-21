// ─── Helper interno ───────────────────────────────────────────────────────────
// Postgres devuelve TIMESTAMP sin zona como '2026-03-21 01:23:45.123' (sin T, sin Z)
// new Date() lo interpreta como hora local del browser → incorrecto en producción
// Normalizamos a ISO 8601 con Z para que siempre se interprete como UTC

const parseFecha = (fecha) => {
  if (!fecha) return null;
  if (fecha instanceof Date) return fecha;
  // Si ya tiene T y Z o + → es ISO válido
  if (typeof fecha === 'string' && (fecha.includes('T') || fecha.includes('+'))) {
    return new Date(fecha);
  }
  // Postgres TIMESTAMP sin zona: '2026-03-21 01:23:45.123' → agregar T y Z
  return new Date(fecha.replace(' ', 'T') + 'Z');
};

// ─── Formatters ───────────────────────────────────────────────────────────────

export const formatCOP = (valor) => {
  if (valor === null || valor === undefined) return '$0';
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(valor);
};

export const formatFecha = (fecha) => {
  const d = parseFecha(fecha);
  if (!d || isNaN(d)) return '';
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
};

export const formatFechaHora = (fecha) => {
  const d = parseFecha(fecha);
  if (!d || isNaN(d)) return '';
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
};

/**
 * Convierte una fecha a string YYYY-MM-DD en zona horaria de Colombia.
 * NUNCA usar .toISOString(): convierte a UTC y puede dar el día anterior/siguiente.
 */
export const formatFechaISO = (fecha) => {
  const d = parseFecha(fecha);
  if (!d || isNaN(d)) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
};

/**
 * Retorna la fecha de hoy en Colombia como string YYYY-MM-DD.
 */
export const fechaHoyBogota = () => formatFechaISO(new Date());