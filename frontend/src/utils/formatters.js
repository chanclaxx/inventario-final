/**
 * Formatea un número como moneda COP sin decimales.
 * Usa regex manual para evitar inconsistencias de Intl.NumberFormat entre navegadores/SO.
 * Ej: 1200000 → "$ 1.200.000"
 */
export const formatCOP = (valor) => {
  if (valor === null || valor === undefined) return '$ 0';
  const numero = Math.round(Number(valor));
  if (isNaN(numero)) return '$ 0';
  return '$ ' + numero.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
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

export const formatFechaISO = (fecha) => {
  if (!fecha) return '';
  return new Date(fecha).toISOString().split('T')[0];
};