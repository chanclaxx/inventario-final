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
  if (!fecha) return '';
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(fecha));
};

export const formatFechaHora = (fecha) => {
  if (!fecha) return '';
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(fecha));
};

/**
 * Convierte una fecha a string YYYY-MM-DD en zona horaria de Colombia (America/Bogota).
 * NUNCA usar .toISOString() para esto: convierte a UTC y puede dar el día anterior/siguiente.
 */
export const formatFechaISO = (fecha) => {
  if (!fecha) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(fecha));
};

/**
 * Retorna la fecha de hoy en Colombia como string YYYY-MM-DD.
 * Usar esta función (no un módulo-nivel `const hoy`) para que siempre sea el día actual.
 */
export const fechaHoyBogota = () => formatFechaISO(new Date());