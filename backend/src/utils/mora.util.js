// ─────────────────────────────────────────────────────────────────────────────
// MORA POR PAGO TARDÍO (feature opt-in por negocio)
//
// El negocio pregraba condiciones de mora ("Suave 1% mensual", "Estricta 3%
// mensual", "Fija $2.000/día") y el vendedor elige una al otorgar el crédito,
// junto con la fecha límite de pago. Si el cliente se pasa del plazo, se causa
// mora sobre el SALDO DE CAPITAL pendiente.
//
// EL CÁLCULO YA NO VIVE AQUÍ. Desde que se agregó el interés corriente, la
// fórmula está en `devengo.util.js`, que la comparten los dos cargos. Este
// archivo se quedó con lo que sí es propio de la mora: sus condiciones, su
// vocabulario y su ancla temporal (la fecha límite + los días de gracia).
// La traducción a la regla del motor es una identidad exacta, no una
// aproximación — ver `_reglaDe()`.
//
// REGLAS DE DISEÑO, en orden de importancia:
//
//   1. La mora NUNCA entra en `total_abonado` ni en `cuota_inicial`. Los reportes
//      calculan la utilidad del producto como (abonado − costo), así que meterla
//      ahí la contaría como margen comercial. La mora es un ingreso FINANCIERO
//      y vive en `movimientos_mora`.
//
//   2. `fecha_limite IS NULL` ⇒ no hay plazo ⇒ no hay mora. Jamás. Es lo que
//      hace la feature 100% aditiva: los créditos y préstamos que ya existen no
//      cambian al activarla, y un compañero al que no se le pone plazo no paga
//      mora.
//
//   3. La condición pactada se CONGELA en el documento (`mora_condicion` jsonb).
//      Subir la tasa en Ajustes mañana no puede aplicarse a lo ya otorgado —
//      además de injusto, sería inexigible.
//
//   4. Interés SIMPLE sobre el capital vencido. Nunca sobre capital + mora
//      acumulada: el anatocismo (interés sobre interés) está prohibido.
//
//   5. Los días se cuentan en America/Bogota, no en UTC. A partir de las 19:00
//      de Colombia `toISOString()` ya devuelve el día siguiente.
//
//   6. Capital y mora son deudas SEPARADAS, y la obligación no se cierra hasta
//      que las dos estén en cero. El abono baja el capital; la mora se cobra
//      con su propia acción. Un préstamo con el producto pagado pero con
//      intereses pendientes sigue Activo (`solo_falta_mora`), y es al cobrar o
//      condonar esa mora cuando queda saldado y se genera su factura.
//
// Este módulo es PURO: sin base de datos, sin red. El frontend no duplica la
// fórmula, recibe los valores ya calculados.
// ─────────────────────────────────────────────────────────────────────────────

const {
  ZONA, hoyBogota, aFecha, aFechaInstante, sumarDias, diasEntre,
  calcularDevengo, TIPO_FIJO, TIPO_PORCENTAJE, DEVENGO_DIARIO, BASE_SALDO,
} = require('./devengo.util');

/** Tipos de condición soportados. */
const TIPO_MENSUAL     = 'mensual';      // % mensual sobre el saldo
const TIPO_DIARIA_FIJA = 'diaria_fija';  // valor fijo en pesos por día

const MAX_CONDICIONES = 12;

// Se conservan los nombres privados históricos: el resto del archivo ya los usaba
// así y renombrarlos solo agregaría ruido al diff.
const _aFecha         = aFecha;
const _aFechaInstante = aFechaInstante;
const _sumarDias      = sumarDias;
const _diasEntre      = diasEntre;

// ── Condiciones ──────────────────────────────────────────────────────────────

/**
 * Normaliza una condición cruda. Devuelve null si no es utilizable, para que el
 * llamador la descarte en vez de calcular con basura.
 */
const normalizarCondicion = (cruda, indice = 0) => {
  if (!cruda || typeof cruda !== 'object' || Array.isArray(cruda)) return null;

  const nombre = typeof cruda.nombre === 'string' ? cruda.nombre.trim() : '';
  if (!nombre) return null;

  const tipo = cruda.tipo === TIPO_DIARIA_FIJA ? TIPO_DIARIA_FIJA : TIPO_MENSUAL;

  const valor = Number(cruda.valor);
  if (!Number.isFinite(valor) || valor <= 0) return null;
  // Un % mensual por encima de 100 no es un error de dedo creíble; en pesos/día
  // el tope es alto a propósito (una deuda grande puede justificarlo).
  if (tipo === TIPO_MENSUAL && valor > 100) return null;
  if (tipo === TIPO_DIARIA_FIJA && valor > 10_000_000) return null;

  const gracia = Number(cruda.dias_gracia);
  const tope   = Number(cruda.tope_pct);

  return {
    id:          typeof cruda.id === 'string' && cruda.id.trim() ? cruda.id.trim() : `m${indice + 1}`,
    nombre:      nombre.slice(0, 40),
    tipo,
    valor,
    dias_gracia: Number.isFinite(gracia) && gracia >= 0 ? Math.floor(gracia) : 0,
    // 0 o ausente = sin tope
    tope_pct:    Number.isFinite(tope) && tope > 0 ? tope : null,
    color:       typeof cruda.color === 'string' ? cruda.color : 'amber',
  };
};

/**
 * Traduce una condición de mora a la regla del motor de devengo.
 *
 * ESTA ES LA IDENTIDAD QUE HAY QUE PRESERVAR. Las dos condiciones que existen
 * son casos particulares exactos del motor, no aproximaciones:
 *
 *   'mensual'     → 30 días de período, porcentaje, proporcional al día
 *                   ⇒ saldo × (v/100) × (dias/30)
 *   'diaria_fija' →  1 día  de período, valor fijo,  proporcional al día
 *                   ⇒ v × (dias/1) = v × dias
 *
 * La mora siempre corre sobre el SALDO (nunca sobre el valor original): es
 * indemnizatoria, y lo que indemniza es el dinero que sigue retenido. Y siempre
 * es proporcional al día — nadie pacta que la mora suba a escalones.
 */
const _reglaDe = (cond) => ({
  tipo:         cond.tipo === TIPO_DIARIA_FIJA ? TIPO_FIJO : TIPO_PORCENTAJE,
  valor:        cond.valor,
  dias_periodo: cond.tipo === TIPO_DIARIA_FIJA ? 1 : 30,
  devengo:      DEVENGO_DIARIO,
  base:         BASE_SALDO,
  max_periodos: null,
  tope_pct:     cond.tope_pct,
});

/** Lee `mora_lista` (string JSON). Nunca lanza: un JSON corrupto degrada a []. */
const parsearCondiciones = (raw) => {
  let lista;
  try { lista = JSON.parse(raw || '[]'); } catch { return []; }
  if (!Array.isArray(lista)) return [];

  const vistos = new Set();
  const out = [];
  for (let i = 0; i < lista.length && out.length < MAX_CONDICIONES; i++) {
    const c = normalizarCondicion(lista[i], i);
    if (!c || vistos.has(c.id)) continue;
    vistos.add(c.id);
    out.push(c);
  }
  return out;
};

/** Traduce el mapa de config_negocio a la configuración de mora. */
const leerConfigMora = (config) => {
  const cfg = config || {};
  const condiciones = parsearCondiciones(cfg.mora_lista);
  const plazo = Number(cfg.mora_plazo_default_dias);
  const techo = Number(cfg.mora_tope_tasa_mensual);
  const def   = typeof cfg.mora_default_id === 'string' ? cfg.mora_default_id : null;

  return {
    // Activa solo si el negocio la encendió Y configuró al menos una condición:
    // encenderla sin condiciones dejaría un selector vacío en el POS.
    activa:        cfg.mora_activa === '1' && condiciones.length > 0,
    condiciones,
    default_id:    condiciones.some((c) => c.id === def) ? def : null,
    plazo_default: Number.isFinite(plazo) && plazo > 0 ? Math.floor(plazo) : null,
    // Techo de AVISO para no pasarse de la tasa de usura. No bloquea: la tasa
    // legal la publica la Superfinanciera cada mes y la fija el negocio.
    techo_aviso:   Number.isFinite(techo) && techo > 0 ? techo : null,
  };
};

/** Etiqueta legible de una condición, para pantalla y documentos. */
const describirCondicion = (c) => {
  if (!c) return '';
  return c.tipo === TIPO_DIARIA_FIJA
    ? `$${Math.round(c.valor).toLocaleString('es-CO')} por día de atraso`
    : `${c.valor}% mensual sobre el saldo`;
};

// ── Cálculo ──────────────────────────────────────────────────────────────────

/**
 * Días de atraso ya descontados los de gracia.
 * @returns {{ dias_vencidos: number, dias_cobrables: number }}
 */
const diasDeAtraso = (fechaLimite, condicion, hoy = hoyBogota()) => {
  const limite = _aFecha(fechaLimite);
  if (!limite) return { dias_vencidos: 0, dias_cobrables: 0 };

  const vencidos = Math.max(0, _diasEntre(limite, _aFecha(hoy) || hoyBogota()));
  const gracia   = condicion?.dias_gracia || 0;
  return { dias_vencidos: vencidos, dias_cobrables: Math.max(0, vencidos - gracia) };
};

/**
 * Mora causada a la fecha. Interés SIMPLE sobre el capital que ESTUVO vencido.
 *
 * El cómo lo hace el motor (`devengo.util.js`); lo que aporta esta función es
 * el ANCLA: la mora arranca en la fecha límite + los días de gracia, nunca antes.
 * Eso es lo que impide que activar la feature genere cargos retroactivos sobre
 * la cartera vieja.
 *
 * `abonos` son los abonos a CAPITAL con su fecha ([{ fecha, valor }]). Si no se
 * pasan, se asume que el saldo actual estuvo vigente todo el atraso (que es lo
 * correcto cuando no hubo pagos).
 *
 * Devuelve 0 (nunca null ni NaN) cuando no aplica.
 */
const calcularMoraCausada = ({ saldo, fecha_limite, condicion, hoy, abonos = [] } = {}) => {
  const cond = normalizarCondicion(condicion);
  if (!cond) return 0;

  const saldoHoy = Number(saldo);
  if (!Number.isFinite(saldoHoy) || saldoHoy < 0) return 0;

  const limite = _aFecha(fecha_limite);
  if (!limite) return 0;

  return calcularDevengo({
    // Día en que la mora empieza a correr (vencimiento + gracia).
    inicio: _sumarDias(limite, cond.dias_gracia || 0),
    hasta:  hoy,
    saldo:  saldoHoy,
    abonos,
    regla:  _reglaDe(cond),
  });
};

/**
 * Estado completo de la mora de un documento.
 *
 * `movimientos` son las filas de `movimientos_mora` NO anuladas del documento.
 * La mora pendiente se DERIVA: causada − cobrada − condonada. Si se cancela la
 * factura o se devuelve un producto (y el saldo baja), se corrige sola.
 */
const resolverEstadoMora = ({ saldo, fecha_limite, condicion, movimientos = [], hoy, abonos = [] } = {}) => {
  const cond   = normalizarCondicion(condicion);
  const limite = _aFecha(fecha_limite);

  // Solo los movimientos de MORA. Desde que `movimientos_mora` guarda también
  // los del interés corriente, un movimiento sin `concepto` es de mora: así se
  // leen correctamente las filas que existían antes de la columna.
  const sumar = (tipo) => (movimientos || [])
    .filter((m) => m && !m.anulado && m.tipo === tipo
                   && (m.concepto == null || m.concepto === 'mora'))
    .reduce((s, m) => s + Number(m.valor || 0), 0);

  const cobrada   = Math.round(sumar('Cobro'));
  const condonada = Math.round(sumar('Condonacion'));

  // El capital que queda debiéndose. Se expone junto al estado de mora porque
  // de los dos juntos depende si la obligación puede cerrarse: desde julio de
  // 2026 un documento con mora pendiente NO queda saldado aunque el capital
  // esté en cero (ver `solo_falta_mora`).
  const capital = Math.max(0, Math.round(Number(saldo) || 0));

  // Sin plazo o sin condición pactada: el documento simplemente no tiene mora.
  if (!limite || !cond) {
    return {
      aplica: false, fecha_limite: limite, condicion: cond,
      dias_vencidos: 0, dias_cobrables: 0,
      causada: 0, cobrada, condonada, pendiente: 0,
      vencido: false, descripcion: '',
      saldo_capital: capital, total_a_pagar: capital, solo_falta_mora: false,
    };
  }

  const { dias_vencidos, dias_cobrables } = diasDeAtraso(limite, cond, hoy);
  const causada = calcularMoraCausada({
    saldo, fecha_limite: limite, condicion: cond, hoy, abonos,
  });

  // Nunca negativa: si se condonó/cobró más de lo causado (porque el saldo
  // bajó después), el pendiente es 0, no un saldo a favor sorpresa.
  const pendiente = Math.max(0, causada - cobrada - condonada);

  return {
    aplica:        true,
    fecha_limite:  limite,
    condicion:     cond,
    dias_vencidos,
    dias_cobrables,
    causada,
    cobrada,
    condonada,
    pendiente,
    vencido:       dias_vencidos > 0,
    descripcion:   describirCondicion(cond),

    // Capital y mora, separados y sumados. `solo_falta_mora` es el caso nuevo:
    // el cliente ya pagó todo el producto pero debe los intereses, así que el
    // documento sigue abierto y no se le puede dar paz y salvo.
    saldo_capital:   capital,
    total_a_pagar:   capital + pendiente,
    solo_falta_mora: capital <= 0 && pendiente > 0,
  };
};

/**
 * Reparte un abono entre mora, interés corriente y capital.
 *
 * ORDEN DE IMPUTACIÓN — el Art. 1653 del Código Civil manda pagar primero
 * intereses y luego capital. Con los dos cargos separados el orden canónico es
 * mora → interés → capital: se salda antes lo que penaliza que lo que remunera.
 *
 * Modos:
 *   'mora_capital'  → cascada completa. Es el default legal. (Nombre histórico:
 *                     nació cuando solo había dos cubetas y se conserva para no
 *                     romper a quien ya lo manda desde el frontend.)
 *   'solo_capital'  → todo a capital; los cargos quedan pendientes (NO
 *                     condonados: siguen debiéndose y visibles).
 *   'personalizado' → el usuario dice cuánto va a cada cargo; el resto a capital.
 *
 * COMPATIBILIDAD: si no se pasa `interes_pendiente`, el reparto es exactamente
 * el de dos cubetas que había antes. Ningún llamador viejo cambia de conducta.
 *
 * @returns {{ a_mora:number, a_interes:number, a_capital:number, excedente:number }}
 */
const repartirAbono = ({
  valor, mora_pendiente = 0, interes_pendiente = 0, saldo_capital = 0,
  modo = 'mora_capital', valor_mora = 0, valor_interes = 0,
} = {}) => {
  const total   = Math.max(0, Math.round(Number(valor) || 0));
  const mora    = Math.max(0, Math.round(Number(mora_pendiente) || 0));
  const interes = Math.max(0, Math.round(Number(interes_pendiente) || 0));
  const cap     = Math.max(0, Math.round(Number(saldo_capital) || 0));

  let aMora = 0;
  let aInteres = 0;

  if (modo === 'solo_capital') {
    aMora = 0;
    aInteres = 0;
  } else if (modo === 'personalizado') {
    aMora    = Math.min(Math.max(0, Math.round(Number(valor_mora) || 0)), mora, total);
    aInteres = Math.min(Math.max(0, Math.round(Number(valor_interes) || 0)), interes, total - aMora);
  } else {
    // Cascada: primero la mora, después el interés, lo que sobre a capital.
    aMora    = Math.min(mora, total);
    aInteres = Math.min(interes, total - aMora);
  }

  const aCapital  = Math.min(cap, total - aMora - aInteres);
  const excedente = total - aMora - aInteres - aCapital;   // va a saldo a favor

  return { a_mora: aMora, a_interes: aInteres, a_capital: aCapital, excedente };
};

module.exports = {
  ZONA, TIPO_MENSUAL, TIPO_DIARIA_FIJA, MAX_CONDICIONES,
  hoyBogota,
  normalizarCondicion, parsearCondiciones, leerConfigMora, describirCondicion,
  diasDeAtraso, calcularMoraCausada, resolverEstadoMora, repartirAbono,
};
