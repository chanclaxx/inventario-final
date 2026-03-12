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

export const formatFechaISO = (fecha) => {
  if (!fecha) return '';
  return new Date(fecha).toISOString().split('T')[0];
};