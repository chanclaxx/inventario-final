// ─────────────────────────────────────────────────────────────────────────────
// MORA — helpers de PRESENTACIÓN para el frontend.
//
// OJO: aquí NO se calcula la mora. La fórmula vive SOLO en el backend
// (`backend/src/utils/mora.util.js`) y llega ya calculada en la clave `mora` de
// cada crédito o préstamo. Duplicarla en el navegador abriría la puerta a que
// pantalla y cobro mostraran números distintos, y en dinero eso no se perdona.
//
// Este módulo solo lee la configuración (para pintar el selector) y formatea.
// ─────────────────────────────────────────────────────────────────────────────

export const TIPO_MENSUAL     = 'mensual';
export const TIPO_DIARIA_FIJA = 'diaria_fija';

export const MAX_CONDICIONES = 12;

/** Modos de imputación de un abono, tal como los pidió el negocio. */
export const MODOS_ABONO = [
  { id: 'mora_capital',  label: 'Mora y capital', descripcion: 'Cubre primero los intereses y el resto baja la deuda' },
  { id: 'solo_capital',  label: 'Solo capital',   descripcion: 'Todo baja la deuda; la mora queda pendiente' },
  { id: 'personalizado', label: 'Personalizada',  descripcion: 'Tú decides cuánto va a mora' },
];

/** Lee `mora_lista` sin lanzar: un JSON corrupto degrada a lista vacía. */
export const parsearCondiciones = (raw) => {
  let lista;
  try { lista = JSON.parse(raw || '[]'); } catch { return []; }
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((c) => c && typeof c === 'object' && typeof c.nombre === 'string' && c.nombre.trim())
    .filter((c) => Number.isFinite(Number(c.valor)) && Number(c.valor) > 0)
    .slice(0, MAX_CONDICIONES)
    .map((c, i) => ({
      id:          typeof c.id === 'string' && c.id.trim() ? c.id.trim() : `m${i + 1}`,
      nombre:      String(c.nombre).trim().slice(0, 40),
      tipo:        c.tipo === TIPO_DIARIA_FIJA ? TIPO_DIARIA_FIJA : TIPO_MENSUAL,
      valor:       Number(c.valor),
      dias_gracia: Number.isFinite(Number(c.dias_gracia)) && Number(c.dias_gracia) > 0 ? Math.floor(Number(c.dias_gracia)) : 0,
      tope_pct:    Number.isFinite(Number(c.tope_pct)) && Number(c.tope_pct) > 0 ? Number(c.tope_pct) : null,
      color:       typeof c.color === 'string' ? c.color : 'amber',
    }));
};

/** Traduce el mapa de config del negocio a la config de mora. */
export const leerConfigMora = (config) => {
  const cfg = config || {};
  const condiciones = parsearCondiciones(cfg.mora_lista);
  const plazo = Number(cfg.mora_plazo_default_dias);
  const def   = typeof cfg.mora_default_id === 'string' ? cfg.mora_default_id : null;
  const techo = Number(cfg.mora_tope_tasa_mensual);

  return {
    // Igual que en el backend: encendida sin condiciones cuenta como apagada,
    // para no dejar un selector vacío en el POS.
    activa:        cfg.mora_activa === '1' && condiciones.length > 0,
    condiciones,
    defaultId:     condiciones.some((c) => c.id === def) ? def : null,
    plazoDefault:  Number.isFinite(plazo) && plazo > 0 ? Math.floor(plazo) : null,
    techoAviso:    Number.isFinite(techo) && techo > 0 ? techo : null,
  };
};

/** Texto de la condición, para pantalla y para el resumen del documento. */
export const describirCondicion = (c) => {
  if (!c) return '';
  const base = c.tipo === TIPO_DIARIA_FIJA
    ? `$${Math.round(c.valor).toLocaleString('es-CO')} por día de atraso`
    : `${c.valor}% mensual sobre el saldo`;
  const extras = [];
  if (c.dias_gracia > 0) extras.push(`${c.dias_gracia} día(s) de gracia`);
  if (c.tope_pct)        extras.push(`tope ${c.tope_pct}%`);
  return extras.length ? `${base} · ${extras.join(' · ')}` : base;
};

/** 'YYYY-MM-DD' → 'DD/MM/AAAA'. Sin objetos Date: no hay corrimiento de zona. */
export const fechaLegible = (iso) => {
  const f = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return '';
  const [a, m, d] = f.split('-');
  return `${d}/${m}/${a}`;
};

/** Hoy en Colombia como 'YYYY-MM-DD', para el mínimo del input date. */
export const hoyBogota = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

/** Suma días a 'YYYY-MM-DD' sin pasar por zonas horarias. */
export const sumarDias = (iso, dias) => {
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, d + Number(dias || 0)));
  return t.toISOString().slice(0, 10);
};

/**
 * Cómo se ve el estado de un documento con plazo. `mora` es el objeto que manda
 * el backend; nunca se recalcula nada aquí.
 */
export const estadoVisual = (mora) => {
  if (!mora?.aplica) return null;
  if (mora.pendiente > 0) {
    return { tono: 'rojo', texto: `Vencido hace ${mora.dias_vencidos} día(s)` };
  }
  if (mora.vencido) {
    // Vencido pero sin mora pendiente: ya se cobró o se condonó.
    return { tono: 'ambar', texto: `Vencido hace ${mora.dias_vencidos} día(s) · mora al día` };
  }
  return { tono: 'verde', texto: 'Al día' };
};
