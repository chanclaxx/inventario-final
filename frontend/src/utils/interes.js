// ─────────────────────────────────────────────────────────────────────────────
// INTERÉS CORRIENTE — helpers de PRESENTACIÓN para el frontend.
//
// OJO: aquí NO se calcula el interés que se cobra. La fórmula vive SOLO en el
// backend (`backend/src/utils/devengo.util.js` + `interes.util.js`) y llega ya
// calculada en la clave `interes` de cada crédito o préstamo. Duplicarla en el
// navegador abriría la puerta a que pantalla y cobro mostraran números
// distintos, y en dinero eso no se perdona.
//
// La ÚNICA excepción es `proyectar()`, que es una réplica de la fórmula usada
// exclusivamente para la vista previa de Ajustes — el mismo permiso que ya tiene
// `_moraEjemplo` en MoraConfig. Nunca se usa para cobrar.
//
// Diferencia con la mora, que es lo que hay que tener claro al pintar:
//   · INTERÉS = precio del plazo. Corre esté el cliente al día o no.
//   · MORA    = sanción por atraso. Solo corre si se pasó de la fecha.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_PLANES = 12;

export const TIPO_PORCENTAJE = 'porcentaje';
export const TIPO_FIJO       = 'fijo';

export const DEVENGO_DIARIO  = 'diario';
export const DEVENGO_PERIODO = 'periodo_cumplido';

export const BASE_SALDO    = 'saldo';
export const BASE_ORIGINAL = 'valor_original';

export const AL_VENCER_SUSTITUYE = 'sustituye';
export const AL_VENCER_CONTINUA  = 'continua';

/** Días que dura cada período. Un "mes" son 30 días, igual que en la mora. */
export const PERIODOS = { diaria: 1, semanal: 7, quincenal: 15, mensual: 30 };

export const PERIODICIDADES = [
  { id: 'diaria',      label: 'Diario',      adverbio: 'diario',     singular: 'día'      },
  { id: 'semanal',     label: 'Semanal',     adverbio: 'semanal',    singular: 'semana'   },
  { id: 'quincenal',   label: 'Quincenal',   adverbio: 'quincenal',  singular: 'quincena' },
  { id: 'mensual',     label: 'Mensual',     adverbio: 'mensual',    singular: 'mes'      },
  { id: 'cada_n_dias', label: 'Cada N días', adverbio: null,         singular: null       },
];

/** Días de un período, o null si la periodicidad no es utilizable. */
export const diasDePeriodo = (periodicidad, cadaDias) => {
  if (periodicidad === 'cada_n_dias') {
    const n = Number(cadaDias);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
  }
  return PERIODOS[periodicidad] ?? null;
};

/** Lee `interes_lista` sin lanzar: un JSON corrupto degrada a lista vacía. */
export const parsearPlanes = (raw) => {
  let lista;
  try { lista = JSON.parse(raw || '[]'); } catch { return []; }
  if (!Array.isArray(lista)) return [];

  return lista
    .filter((p) => p && typeof p === 'object' && typeof p.nombre === 'string' && p.nombre.trim())
    .filter((p) => Number.isFinite(Number(p.valor)) && Number(p.valor) > 0)
    .slice(0, MAX_PLANES)
    .map((p, i) => {
      const periodicidad = PERIODICIDADES.some((x) => x.id === p.periodicidad) ? p.periodicidad : 'mensual';
      const diasPeriodo  = diasDePeriodo(periodicidad, p.cada_dias) ?? 30;
      const num = (v, min = 0) => {
        const n = Number(v);
        return Number.isFinite(n) && n > min ? n : null;
      };
      return {
        id:     typeof p.id === 'string' && p.id.trim() ? p.id.trim() : `i${i + 1}`,
        nombre: String(p.nombre).trim().slice(0, 40),
        inicia_tras_dias: Math.max(0, Math.floor(Number(p.inicia_tras_dias) || 0)),
        periodicidad,
        cada_dias:    periodicidad === 'cada_n_dias' ? diasPeriodo : null,
        dias_periodo: diasPeriodo,
        devengo: p.devengo === DEVENGO_PERIODO ? DEVENGO_PERIODO : DEVENGO_DIARIO,
        tipo:    p.tipo === TIPO_FIJO ? TIPO_FIJO : TIPO_PORCENTAJE,
        valor:   Number(p.valor),
        base:    p.base === BASE_ORIGINAL ? BASE_ORIGINAL : BASE_SALDO,
        max_periodos: num(p.max_periodos) ? Math.floor(Number(p.max_periodos)) : null,
        tope_pct:     num(p.tope_pct),
        al_vencer: p.al_vencer === AL_VENCER_CONTINUA ? AL_VENCER_CONTINUA : AL_VENCER_SUSTITUYE,
        color: typeof p.color === 'string' ? p.color : 'teal',
      };
    });
};

/** Traduce el mapa de config del negocio a la config de interés. */
export const leerConfigInteres = (config) => {
  const cfg = config || {};
  const planes = parsearPlanes(cfg.interes_lista);
  const def    = typeof cfg.interes_default_id === 'string' ? cfg.interes_default_id : null;
  const techo  = Number(cfg.interes_techo_mensual);

  return {
    // Igual que en el backend: encendida sin planes cuenta como apagada, para no
    // dejar un selector vacío en el POS.
    activa:     cfg.interes_activa === '1' && planes.length > 0,
    planes,
    defaultId:  planes.some((p) => p.id === def) ? def : null,
    techoAviso: Number.isFinite(techo) && techo > 0 ? techo : null,
  };
};

/** Cada cuánto, en palabras. */
export const cadaCuanto = (p) => {
  if (!p) return '';
  const meta = PERIODICIDADES.find((x) => x.id === p.periodicidad);
  return meta?.adverbio || `cada ${p.dias_periodo} días`;
};

/** La unidad del período, en singular ("mes", "semana", "10 días"). */
export const unidadPeriodo = (p) => {
  if (!p) return '';
  const meta = PERIODICIDADES.find((x) => x.id === p.periodicidad);
  return meta?.singular || `${p.dias_periodo} días`;
};

/** Texto corto del plan, para el selector y las listas. */
export const describirPlan = (p) => {
  if (!p) return '';
  const cuanto = p.tipo === TIPO_FIJO
    ? `$${Math.round(p.valor).toLocaleString('es-CO')} ${cadaCuanto(p)}`
    : `${p.valor}% ${cadaCuanto(p)}`;
  return `${cuanto} ${p.base === BASE_ORIGINAL ? 'sobre el valor total' : 'sobre el saldo'}`;
};

/** Texto largo, con todas las condiciones. Para el detalle y los documentos. */
export const describirPlanCompleto = (p) => {
  if (!p) return '';
  const extras = [];
  if (p.inicia_tras_dias > 0) extras.push(`empieza a los ${p.inicia_tras_dias} días`);
  if (p.devengo === DEVENGO_PERIODO) extras.push(`se cobra completo al cumplir cada ${unidadPeriodo(p)}`);
  else extras.push('proporcional al día');
  if (p.max_periodos) extras.push(`máximo ${p.max_periodos} período(s)`);
  if (p.tope_pct)     extras.push(`tope ${p.tope_pct}%`);
  if (p.al_vencer === AL_VENCER_CONTINUA) extras.push('sigue corriendo aunque se venza');
  else extras.push('se detiene al vencerse y entra la mora');
  return `${describirPlan(p)} · ${extras.join(' · ')}`;
};

/**
 * RÉPLICA de la fórmula del backend, SOLO para la vista previa de Ajustes.
 *
 * Asume que no hubo abonos, que es lo correcto para una proyección: muestra
 * cuánto costaría el crédito si el cliente no paga nada hasta ese día. El cobro
 * real siempre lo calcula el servidor sobre los abonos que de verdad ocurrieron.
 */
export const proyectar = (plan, base, diasTotales) => {
  if (!plan || !(base > 0)) return 0;

  // El interés no corre antes de su fecha de arranque.
  let dias = Math.max(0, Number(diasTotales) - (plan.inicia_tras_dias || 0));
  if (dias <= 0) return 0;

  // Tope de períodos: deja de causar al cumplirlos.
  if (plan.max_periodos) dias = Math.min(dias, plan.max_periodos * plan.dias_periodo);

  let bruto;
  if (plan.devengo === DEVENGO_PERIODO) {
    // Escalón: nada hasta cumplir el período, y ahí el período entero.
    const periodos = Math.floor(dias / plan.dias_periodo);
    bruto = plan.tipo === TIPO_FIJO
      ? plan.valor * periodos
      : base * (plan.valor / 100) * periodos;
  } else {
    bruto = plan.tipo === TIPO_FIJO
      ? plan.valor * (dias / plan.dias_periodo)
      : base * (plan.valor / 100) * (dias / plan.dias_periodo);
  }

  const conTope = plan.tope_pct ? Math.min(bruto, base * (plan.tope_pct / 100)) : bruto;
  return Math.round(conTope);
};

/**
 * Plantillas: la respuesta al problema de que doce opciones son la profundidad
 * correcta para el motor y la equivocada para la pantalla. El admin elige una y
 * ajusta el número; lo demás queda bien por defecto.
 */
export const PLANTILLAS = [
  {
    id: 'financiacion',
    nombre: 'Financiación mensual',
    resumen: '2% mensual sobre el saldo, desde la entrega',
    para: 'Préstamo de dinero: si el cliente abona, el interés baja con la deuda.',
    plan: {
      tipo: TIPO_PORCENTAJE, valor: 2, periodicidad: 'mensual',
      devengo: DEVENGO_DIARIO, base: BASE_SALDO, inicia_tras_dias: 0,
    },
  },
  {
    id: 'primer-mes-gratis',
    nombre: 'Primer mes sin interés',
    resumen: '30 días de plazo y después 3% mensual',
    para: 'Crédito de almacén: se da un mes para pagar sin recargo.',
    plan: {
      tipo: TIPO_PORCENTAJE, valor: 3, periodicidad: 'mensual',
      devengo: DEVENGO_DIARIO, base: BASE_SALDO, inicia_tras_dias: 30,
    },
  },
  {
    id: 'escalon',
    nombre: 'Sube de una vez al mes',
    resumen: '2% del valor total cada mes cumplido',
    para: 'No sube de a poquitos: el día 30 sube el 2% completo y ahí se queda hasta el día 60.',
    plan: {
      tipo: TIPO_PORCENTAJE, valor: 2, periodicidad: 'mensual',
      devengo: DEVENGO_PERIODO, base: BASE_ORIGINAL, inicia_tras_dias: 0,
    },
  },
  {
    id: 'diario',
    nombre: 'Cobro diario',
    resumen: '10% mensual sobre el saldo, proporcional al día',
    para: 'Préstamo de ruta: abonos frecuentes y pequeños.',
    plan: {
      tipo: TIPO_PORCENTAJE, valor: 10, periodicidad: 'mensual',
      devengo: DEVENGO_DIARIO, base: BASE_SALDO, inicia_tras_dias: 0,
    },
  },
  {
    id: 'cuota-fija',
    nombre: 'Valor fijo por mes',
    resumen: '$50.000 cada mes cumplido',
    para: 'Se pacta en pesos y no en porcentaje. Más fácil de explicar en el mostrador.',
    plan: {
      tipo: TIPO_FIJO, valor: 50000, periodicidad: 'mensual',
      devengo: DEVENGO_PERIODO, base: BASE_SALDO, inicia_tras_dias: 0,
    },
  },
];

/**
 * Modos de imputación de un abono, ahora con tres cubetas.
 *
 * El orden de la cascada (mora → interés → capital) es el del Art. 1653 del
 * Código Civil. `solo_capital` sigue siendo el default: el abono paga el
 * producto y los cargos se cobran aparte, para que el vendedor no tenga que
 * adivinar en qué se convirtió el pago que acaba de recibir.
 */
export const MODOS_ABONO_CARGOS = [
  { id: 'solo_capital',  label: 'Solo la deuda',   descripcion: 'Todo baja el capital; los intereses se cobran aparte' },
  { id: 'mora_capital',  label: 'Cargos primero',  descripcion: 'Cubre mora, luego interés, y el resto baja la deuda' },
  { id: 'personalizado', label: 'Personalizada',   descripcion: 'Tú decides cuánto va a cada cosa' },
];

/**
 * Cómo se ve el estado del interés de un documento. `interes` es lo que manda
 * el backend; nunca se recalcula nada aquí.
 */
export const estadoInteresVisual = (interes) => {
  if (!interes?.aplica) return null;
  if (interes.detenido_por_mora) {
    return { tono: 'ambar', texto: 'Detenido: el documento se venció y entró la mora' };
  }
  if (interes.pendiente > 0) {
    return { tono: 'teal', texto: `${interes.periodos_corridos} período(s) causados` };
  }
  return { tono: 'verde', texto: 'Intereses al día' };
};
