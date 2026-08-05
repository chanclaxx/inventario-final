// ─────────────────────────────────────────────────────────────────────────────
// INTERÉS CORRIENTE (feature opt-in por negocio, independiente de la mora)
//
// El interés corriente —o remuneratorio, o "de plazo"— es el PRECIO DEL DINERO:
// lo que el negocio cobra por financiar, esté el cliente al día o no. Es un
// concepto distinto de la mora, que es una SANCIÓN por incumplir una fecha.
//
// Los dos son independientes en los dos sentidos:
//   · `interes_condicion IS NULL` ⇒ el documento nunca causa interés.
//   · `fecha_limite IS NULL`      ⇒ el documento nunca causa mora.
// Se puede tener uno, el otro, los dos, o ninguno. Ningún interruptor depende
// del otro, y los dos nacen apagados.
//
// QUÉ SE PUEDE PACTAR (la idea es que se pueda armar cualquier política real):
//
//   · Cuándo arranca      → desde la entrega, o después de N días.
//   · Cada cuánto         → diario, semanal, quincenal, mensual o cada N días.
//   · Cómo se causa       → proporcional al día, o a ESCALÓN (no cobra nada
//                           hasta cumplir el período, y ahí cobra el período
//                           entero). El escalón es lo que la gente pacta cuando
//                           dice "pasa el mes y sube un 2%".
//   · Cuánto              → un porcentaje, o un valor fijo en pesos.
//   · Sobre qué           → el saldo pendiente, o el valor original del crédito.
//   · Hasta cuándo        → tope de períodos y/o tope como % de la base.
//   · Qué pasa al vencer  → el interés SE DETIENE y entra la mora ('sustituye'),
//                           o los dos corren en paralelo ('continua').
//
// POR QUÉ 'sustituye' ES EL DEFAULT: en Colombia no se pueden cobrar intereses
// de plazo y de mora sobre la misma suma y el mismo período (lectura ortodoxa
// del Art. 65 de la Ley 45 de 1990). Además es más fácil de explicar —"mientras
// estás al día pagas el 2%; si te atrasas, pasas al 3%"— y como la tasa de mora
// suele ser mayor que la corriente, el negocio no pierde por elegir lo prudente.
//
// LO QUE NO SE IMPLEMENTA, a propósito: interés COMPUESTO. Capitalizar el
// interés causado es anatocismo y no es exigible en obligaciones civiles y de
// consumo. El motor lo ignora aunque la condición lo pida.
//
// El interés cobrado NUNCA entra en `total_abonado`: los reportes calculan la
// utilidad del producto como (abonado − costo), así que contarlo ahí lo volvería
// margen comercial. Vive en `movimientos_mora` con `concepto = 'interes'` y se
// reporta como ingreso financiero, igual que la mora.
//
// Módulo PURO: sin base de datos, sin red.
// ─────────────────────────────────────────────────────────────────────────────

const {
  hoyBogota, aFecha, aFechaAncla, sumarDias, diasEntre,
  calcularDevengo, diasDePeriodicidad, estadoPeriodos,
  TIPO_FIJO, TIPO_PORCENTAJE, DEVENGO_DIARIO, DEVENGO_PERIODO,
  BASE_SALDO, BASE_ORIGINAL,
} = require('./devengo.util');

const MAX_PLANES = 12;

/** Qué hace el interés cuando el documento se vence. */
const AL_VENCER_SUSTITUYE = 'sustituye';  // se detiene; de ahí en adelante solo mora
const AL_VENCER_CONTINUA  = 'continua';   // sigue corriendo en paralelo con la mora

const PERIODICIDADES = ['diaria', 'semanal', 'quincenal', 'mensual', 'cada_n_dias'];

const ETIQUETA_PERIODO = {
  diaria:    { singular: 'día',       adverbio: 'diario'     },
  semanal:   { singular: 'semana',    adverbio: 'semanal'    },
  quincenal: { singular: 'quincena',  adverbio: 'quincenal'  },
  mensual:   { singular: 'mes',       adverbio: 'mensual'    },
};

// ── Condiciones ──────────────────────────────────────────────────────────────

/**
 * Normaliza un plan de interés. Devuelve null si no es utilizable, para que el
 * llamador lo descarte en vez de calcular con basura.
 *
 * Los rangos son deliberadamente amplios: un negocio de barrio puede pactar 20%
 * mensual y no nos corresponde impedírselo — para eso está el techo de aviso.
 * Lo que sí se rechaza es lo que no puede ser un pacto real (valores negativos,
 * porcentajes de tres cifras, períodos de más de dos años).
 */
const normalizarPlanInteres = (cruda, indice = 0) => {
  if (!cruda || typeof cruda !== 'object' || Array.isArray(cruda)) return null;

  const nombre = typeof cruda.nombre === 'string' ? cruda.nombre.trim() : '';
  if (!nombre) return null;

  const tipo = cruda.tipo === TIPO_FIJO ? TIPO_FIJO : TIPO_PORCENTAJE;

  const valor = Number(cruda.valor);
  if (!Number.isFinite(valor) || valor <= 0) return null;
  if (tipo === TIPO_PORCENTAJE && valor > 100) return null;
  if (tipo === TIPO_FIJO && valor > 100_000_000) return null;

  const periodicidad = PERIODICIDADES.includes(cruda.periodicidad) ? cruda.periodicidad : 'mensual';
  const cadaDias = Number(cruda.cada_dias);
  const diasPeriodo = diasDePeriodicidad(
    periodicidad,
    Number.isFinite(cadaDias) ? cadaDias : null
  );
  if (!diasPeriodo) return null;

  const espera = Number(cruda.inicia_tras_dias);
  const maxP   = Number(cruda.max_periodos);
  const tope   = Number(cruda.tope_pct);

  return {
    id:     typeof cruda.id === 'string' && cruda.id.trim() ? cruda.id.trim() : `i${indice + 1}`,
    nombre: nombre.slice(0, 40),

    // Cuándo arranca, contado desde la entrega del crédito o del préstamo.
    inicia_tras_dias: Number.isFinite(espera) && espera >= 0 ? Math.floor(espera) : 0,

    periodicidad,
    cada_dias:    periodicidad === 'cada_n_dias' ? diasPeriodo : null,
    dias_periodo: diasPeriodo,
    devengo: cruda.devengo === DEVENGO_PERIODO ? DEVENGO_PERIODO : DEVENGO_DIARIO,

    tipo,
    valor,
    base: cruda.base === BASE_ORIGINAL ? BASE_ORIGINAL : BASE_SALDO,

    max_periodos: Number.isFinite(maxP) && maxP > 0 ? Math.floor(maxP) : null,
    tope_pct:     Number.isFinite(tope) && tope > 0 ? tope : null,

    al_vencer: cruda.al_vencer === AL_VENCER_CONTINUA ? AL_VENCER_CONTINUA : AL_VENCER_SUSTITUYE,

    // Se guarda para que el JSON tenga forma estable, pero el motor lo ignora:
    // capitalizar sería anatocismo.
    capitaliza: false,

    color: typeof cruda.color === 'string' ? cruda.color : 'teal',
  };
};

/** Lee `interes_lista` (string JSON). Nunca lanza: un JSON corrupto degrada a []. */
const parsearPlanes = (raw) => {
  let lista;
  try { lista = JSON.parse(raw || '[]'); } catch { return []; }
  if (!Array.isArray(lista)) return [];

  const vistos = new Set();
  const out = [];
  for (let i = 0; i < lista.length && out.length < MAX_PLANES; i++) {
    const p = normalizarPlanInteres(lista[i], i);
    if (!p || vistos.has(p.id)) continue;
    vistos.add(p.id);
    out.push(p);
  }
  return out;
};

/** Traduce el mapa de config_negocio a la configuración de interés. */
const leerConfigInteres = (config) => {
  const cfg = config || {};
  const planes = parsearPlanes(cfg.interes_lista);
  const def    = typeof cfg.interes_default_id === 'string' ? cfg.interes_default_id : null;
  const techo  = Number(cfg.interes_techo_mensual);

  return {
    // Activa solo si el negocio la encendió Y configuró al menos un plan:
    // encenderla sin planes dejaría un selector vacío en el POS.
    activa:     cfg.interes_activa === '1' && planes.length > 0,
    planes,
    default_id: planes.some((p) => p.id === def) ? def : null,
    // Techo de AVISO contra la tasa de usura. No bloquea: la tasa legal la
    // publica la Superfinanciera cada mes y la fija el negocio.
    techo_aviso: Number.isFinite(techo) && techo > 0 ? techo : null,
  };
};

/** Etiqueta legible del plan, para pantalla y documentos. */
const describirPlanInteres = (p) => {
  if (!p) return '';

  const et = ETIQUETA_PERIODO[p.periodicidad];
  const cadaCuanto = et ? et.adverbio : `cada ${p.dias_periodo} días`;
  const unidad     = et ? et.singular : `${p.dias_periodo} días`;

  const cuanto = p.tipo === TIPO_FIJO
    ? `$${Math.round(p.valor).toLocaleString('es-CO')} ${cadaCuanto}`
    : `${p.valor}% ${cadaCuanto}`;

  const sobre = p.base === BASE_ORIGINAL ? 'sobre el valor original' : 'sobre el saldo';

  const extras = [];
  if (p.inicia_tras_dias > 0) extras.push(`empieza a los ${p.inicia_tras_dias} días`);
  if (p.devengo === DEVENGO_PERIODO) extras.push(`se cobra completo al cumplir cada ${unidad}`);
  if (p.max_periodos)  extras.push(`máximo ${p.max_periodos}`);
  if (p.tope_pct)      extras.push(`tope ${p.tope_pct}%`);
  if (p.al_vencer === AL_VENCER_CONTINUA) extras.push('sigue corriendo en mora');

  return extras.length ? `${cuanto} ${sobre} (${extras.join(', ')})` : `${cuanto} ${sobre}`;
};

// ── Cálculo ──────────────────────────────────────────────────────────────────

/**
 * Hasta qué día corre el interés.
 *
 * Aquí vive la convivencia con la mora, y es una sola decisión: con
 * 'sustituye' el interés se DETIENE en la fecha límite y de ahí en adelante
 * solo corre la mora, para no cobrar plazo y mora sobre la misma suma y el
 * mismo período. Con 'continua' los dos siguen.
 */
const _corteDe = (plan, fechaLimite, hoy) => {
  if (plan.al_vencer !== AL_VENCER_SUSTITUYE) return hoy;
  const limite = aFecha(fechaLimite);
  if (!limite) return hoy;                       // sin plazo no hay nada que sustituir
  return diasEntre(limite, hoy) > 0 ? limite : hoy;
};

/**
 * Interés causado a la fecha.
 *
 * @param {number} saldo           saldo de capital HOY
 * @param {number} valor_original  valor financiado de origen (para base='valor_original')
 * @param {string|Date} fecha_inicio  emisión del documento (venta o entrega del préstamo)
 * @param {string|Date} [fecha_limite] plazo, si lo hay — define el corte con 'sustituye'
 * @param {object} condicion       el plan pactado, congelado en el documento
 * @param {Array}  [abonos]        abonos a capital `[{ fecha, valor }]`
 *
 * Devuelve 0 (nunca null ni NaN) cuando no aplica.
 */
const calcularInteresCausado = ({
  saldo, valor_original, fecha_inicio, fecha_limite, condicion, hoy, abonos = [],
} = {}) => {
  const plan = normalizarPlanInteres(condicion);
  if (!plan) return 0;

  const saldoHoy = Number(saldo);
  if (!Number.isFinite(saldoHoy) || saldoHoy < 0) return 0;

  // , no : la emisión puede venir de una columna TIMESTAMP
  // y leerla en UTC la correría un día. Ver la nota en devengo.util.
  const emision = aFechaAncla(fecha_inicio);
  if (!emision) return 0;

  const hoyF = aFecha(hoy) || hoyBogota();

  return calcularDevengo({
    // El interés arranca en la entrega + los días de espera pactados. Nunca
    // antes: igual que la mora, eso es lo que impide cargos retroactivos al
    // activar la feature sobre cartera vieja.
    inicio: sumarDias(emision, plan.inicia_tras_dias),
    hasta:  _corteDe(plan, fecha_limite, hoyF),
    saldo:  saldoHoy,
    valor_original,
    abonos,
    regla: {
      tipo:         plan.tipo,
      valor:        plan.valor,
      dias_periodo: plan.dias_periodo,
      devengo:      plan.devengo,
      base:         plan.base,
      max_periodos: plan.max_periodos,
      tope_pct:     plan.tope_pct,
    },
  });
};

/**
 * Estado completo del interés de un documento.
 *
 * `movimientos` son las filas de `movimientos_mora` del documento (la tabla
 * guarda los dos cargos, discriminados por `concepto`). El interés pendiente se
 * DERIVA: causado − cobrado − condonado. Si se devuelve un producto y el saldo
 * baja, se corrige solo.
 */
const resolverEstadoInteres = ({
  saldo, valor_original, fecha_inicio, fecha_limite, condicion,
  movimientos = [], hoy, abonos = [],
} = {}) => {
  const plan = normalizarPlanInteres(condicion);

  const sumar = (tipo) => (movimientos || [])
    .filter((m) => m && !m.anulado && m.tipo === tipo && m.concepto === 'interes')
    .reduce((s, m) => s + Number(m.valor || 0), 0);

  const cobrado   = Math.round(sumar('Cobro'));
  const condonado = Math.round(sumar('Condonacion'));

  // Sin plan pactado el documento simplemente no tiene interés. Se devuelve la
  // misma forma para que el frontend pinte sin condicionales por todos lados.
  if (!plan) {
    return {
      aplica: false, condicion: null,
      causado: 0, cobrado, condonado, pendiente: 0,
      descripcion: '', periodos_corridos: 0, dias_al_siguiente: null,
      detenido_por_mora: false, fecha_corte: null,
    };
  }

  const hoyF    = aFecha(hoy) || hoyBogota();
  const emision = aFechaAncla(fecha_inicio);
  const inicio  = emision ? sumarDias(emision, plan.inicia_tras_dias) : null;
  const corte   = _corteDe(plan, fecha_limite, hoyF);

  const causado = calcularInteresCausado({
    saldo, valor_original, fecha_inicio, fecha_limite, condicion: plan, hoy: hoyF, abonos,
  });

  // Nunca negativo: si se condonó/cobró más de lo causado (porque el saldo bajó
  // después), el pendiente es 0, no un saldo a favor sorpresa.
  const pendiente = Math.max(0, causado - cobrado - condonado);

  const periodos = inicio
    ? estadoPeriodos(inicio, { ...plan, dias_periodo: plan.dias_periodo }, corte)
    : { periodos: 0, dias_al_siguiente: null };

  return {
    aplica: true,
    condicion: plan,
    causado,
    cobrado,
    condonado,
    pendiente,
    descripcion: describirPlanInteres(plan),

    // Para explicarle al cliente por qué debe lo que debe.
    fecha_inicio_cobro: inicio,
    periodos_corridos:  periodos.periodos,
    dias_al_siguiente:  periodos.dias_al_siguiente,

    // El interés dejó de correr porque el documento se venció y el plan pactado
    // dice que la mora lo sustituye. La pantalla lo muestra para que nadie crea
    // que el cálculo se congeló por error.
    detenido_por_mora: plan.al_vencer === AL_VENCER_SUSTITUYE
                       && !!aFecha(fecha_limite)
                       && diasEntre(aFecha(fecha_limite), hoyF) > 0,
    fecha_corte: corte,
  };
};

module.exports = {
  MAX_PLANES, PERIODICIDADES,
  AL_VENCER_SUSTITUYE, AL_VENCER_CONTINUA,
  TIPO_PORCENTAJE, TIPO_FIJO,
  DEVENGO_DIARIO, DEVENGO_PERIODO,
  BASE_SALDO, BASE_ORIGINAL,
  normalizarPlanInteres, parsearPlanes, leerConfigInteres, describirPlanInteres,
  calcularInteresCausado, resolverEstadoInteres,
};
