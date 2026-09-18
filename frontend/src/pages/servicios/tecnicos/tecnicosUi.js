// Constantes y textos compartidos por las pantallas de técnicos externos. Van en
// un .js aparte (no en un .jsx) porque react-refresh solo admite componentes
// exportados desde un archivo de componentes.

export const ESTADOS_EQUIPO = {
  En_tecnico:  { badge: 'yellow', label: 'Donde el técnico' },
  Reparado:    { badge: 'green',  label: 'Reparado' },
  Sin_reparar: { badge: 'red',    label: 'Sin reparar' },
  Anulado:     { badge: 'gray',   label: 'Anulado' },
};

export const ORIGEN_EQUIPO = {
  inventario: 'Inventario',
  vendido:    'Vendido (garantía del cliente)',
  cliente:    'Equipo del cliente',
};

/** «Garantía hasta 2026-10-18 · vigente» — la fecha ya viene calculada del backend. */
export const etiquetaGarantia = (e) => {
  if (e.estado !== 'Reparado') return null;
  if (e.garantia_dias == null) return 'Sin garantía del técnico';
  if (!e.garantia_hasta) return null;
  return `Garantía hasta ${e.garantia_hasta} · ${e.en_garantia ? 'vigente' : 'vencida'}`;
};
