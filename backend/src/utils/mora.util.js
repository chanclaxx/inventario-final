// ─────────────────────────────────────────────────────────────────────────────
// MORA POR PAGO TARDÍO (feature opt-in por negocio)
//
// El negocio pregraba condiciones de mora ("Suave 1% mensual", "Estricta 3%
// mensual", "Fija $2.000/día") y el vendedor elige una al otorgar el crédito,
// junto con la fecha límite de pago. Si el cliente se pasa del plazo, se causa
// mora sobre el SALDO DE CAPITAL pendiente.
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
// Este módulo es PURO: sin base de datos, sin red. Es la ÚNICA implementación
// de la fórmula — el frontend no la duplica, recibe los valores ya calculados.
// ─────────────────────────────────────────────────────────────────────────────

const ZONA = 'America/Bogota';

/** Tipos de condición soportados. */
const TIPO_MENSUAL     = 'mensual';      // % mensual sobre el saldo
const TIPO_DIARIA_FIJA = 'diaria_fija';  // valor fijo en pesos por día

const MAX_CONDICIONES = 12;

// ── Fechas ───────────────────────────────────────────────────────────────────

/** Hoy en Colombia como 'YYYY-MM-DD'. */
const hoyBogota = () => new Date().toLocaleDateString('en-CA', { timeZone: ZONA });

/**
 * Normaliza una fecha de CALENDARIO a 'YYYY-MM-DD'. Acepta Date o string.
 *
 * OJO con los objetos Date: el driver de Postgres entrega las columnas `DATE`
 * como un Date a medianoche UTC. Convertirlo a la zona de Bogotá (UTC−5) lo
 * correría un día hacia atrás — un plazo del 29 se leería como del 28 y la mora
 * saldría con un día extra. Por eso aquí se leen los componentes UTC.
 *
 * Para "ahora" NO se usa esta función: eso es `hoyBogota()`, que sí debe mirar
 * la zona del negocio.
 */
const _aFecha = (v) => {
  if (!v) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

/**
 * Normaliza un INSTANTE (columna TIMESTAMP: la fecha de un abono, de un
 * movimiento) al día de calendario en Bogotá.
 *
 * Va aparte de `_aFecha` a propósito, y la diferencia importa:
 *   · `fecha_limite` es un DATE → el driver lo entrega a medianoche UTC y hay
 *     que leer los componentes UTC (si no, se corre un día atrás).
 *   · la fecha de un abono es un TIMESTAMP → es un momento real, y el día que
 *     cuenta es el del negocio. A las 19:00 de Bogotá el UTC ya es el día
 *     siguiente, así que leerlo en UTC adelantaría el abono un día y lo dejaría
 *     "en el futuro" — con eso el abono quedaba fuera del cálculo y la mora
 *     causada se perdía.
 */
const _aFechaInstante = (v) => {
  if (!v) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return v.toLocaleDateString('en-CA', { timeZone: ZONA });
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

/** Suma días a 'YYYY-MM-DD' en aritmética de calendario (sin zonas ni DST). */
const _sumarDias = (iso, dias) => {
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + Number(dias || 0))).toISOString().slice(0, 10);
};

/** Días calendario entre dos 'YYYY-MM-DD' (b − a). Sin horas: evita DST. */
const _diasEntre = (a, b) => {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const ua = Date.UTC(ay, am - 1, ad);
  const ub = Date.UTC(by, bm - 1, bd);
  return Math.round((ub - ua) / 86400000);
};

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
 * OJO — por qué se reconstruye la historia y no se usa solo el saldo actual:
 * si se calculara sobre el saldo de hoy, un cliente que se atrasa 35 días y
 * después paga todo el capital dejaría la base en 0 y la mora ya causada
 * DESAPARECERÍA. El negocio perdería los intereses justo en el caso más común
 * (el cliente que salda). Por eso se acumula por tramos: entre dos abonos el
 * saldo es constante, así que basta sumar tramo × tasa.
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

  const hoyF   = _aFecha(hoy) || hoyBogota();
  // Día en que la mora empieza a correr (vencimiento + gracia).
  const inicio = _sumarDias(limite, cond.dias_gracia || 0);
  if (_diasEntre(inicio, hoyF) <= 0) return 0;

  // Abonos a capital posteriores al inicio del atraso, en orden.
  const posteriores = (abonos || [])
    // `_aFechaInstante`: la fecha de un abono es un TIMESTAMP, no un DATE.
    .map((a) => ({ fecha: _aFechaInstante(a.fecha), valor: Number(a.valor) || 0 }))
    .filter((a) => a.fecha && a.valor > 0 && _diasEntre(inicio, a.fecha) > 0
                   && _diasEntre(a.fecha, hoyF) >= 0)
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));

  // El saldo al inicio del atraso: al de hoy se le devuelven los abonos que se
  // hicieron después. Así no hace falta guardar nada.
  const saldoInicial = saldoHoy + posteriores.reduce((s, a) => s + a.valor, 0);
  if (saldoInicial <= 0) return 0;   // nunca hubo deuda vencida

  // Tramos de saldo constante entre abonos.
  const tramos = [];
  let cursor = inicio;
  let saldoTramo = saldoInicial;
  for (const ab of posteriores) {
    const dias = _diasEntre(cursor, ab.fecha);
    if (dias > 0) tramos.push({ dias, saldo: saldoTramo });
    saldoTramo = Math.max(0, saldoTramo - ab.valor);
    cursor = ab.fecha;
  }
  const diasFinal = _diasEntre(cursor, hoyF);
  if (diasFinal > 0) tramos.push({ dias: diasFinal, saldo: saldoTramo });

  let bruto = 0;
  for (const t of tramos) {
    if (t.saldo <= 0) continue;      // sin deuda ese tramo no causa mora
    bruto += cond.tipo === TIPO_DIARIA_FIJA
      ? cond.valor * t.dias                                  // fijo por día en mora
      : t.saldo * (cond.valor / 100) * (t.dias / 30);         // % mensual proporcional
  }

  if (!Number.isFinite(bruto) || bruto <= 0) return 0;

  // Tope opcional: se mide contra el capital que estuvo vencido, no contra el
  // saldo de hoy (que puede ser 0 y anularía el tope).
  const conTope = cond.tope_pct != null
    ? Math.min(bruto, saldoInicial * (cond.tope_pct / 100))
    : bruto;

  return Math.round(conTope);
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

  const sumar = (tipo) => (movimientos || [])
    .filter((m) => m && !m.anulado && m.tipo === tipo)
    .reduce((s, m) => s + Number(m.valor || 0), 0);

  const cobrada   = Math.round(sumar('Cobro'));
  const condonada = Math.round(sumar('Condonacion'));

  // Sin plazo o sin condición pactada: el documento simplemente no tiene mora.
  if (!limite || !cond) {
    return {
      aplica: false, fecha_limite: limite, condicion: cond,
      dias_vencidos: 0, dias_cobrables: 0,
      causada: 0, cobrada, condonada, pendiente: 0,
      vencido: false, descripcion: '',
    };
  }

  const { dias_vencidos, dias_cobrables } = diasDeAtraso(limite, cond, hoy);
  const causada = calcularMoraCausada({
    saldo, fecha_limite: limite, condicion: cond, hoy, abonos,
  });

  return {
    aplica:        true,
    fecha_limite:  limite,
    condicion:     cond,
    dias_vencidos,
    dias_cobrables,
    causada,
    cobrada,
    condonada,
    // Nunca negativa: si se condonó/cobró más de lo causado (porque el saldo
    // bajó después), el pendiente es 0, no un saldo a favor sorpresa.
    pendiente:     Math.max(0, causada - cobrada - condonada),
    vencido:       dias_vencidos > 0,
    descripcion:   describirCondicion(cond),
  };
};

/**
 * Reparte un abono entre mora y capital según el modo elegido.
 *
 * Modos (los tres que pidió el negocio):
 *   'mora_capital' → paga primero la mora y el resto a capital. Es el orden que
 *                    fija el Art. 1653 del Código Civil.
 *   'solo_capital' → todo a capital; la mora queda pendiente (NO condonada:
 *                    sigue debiéndose y visible).
 *   'personalizado'→ el usuario dice cuánto va a mora; el resto a capital.
 *
 * @returns {{ a_mora: number, a_capital: number, excedente: number }}
 */
const repartirAbono = ({ valor, mora_pendiente = 0, saldo_capital = 0, modo = 'mora_capital', valor_mora = 0 } = {}) => {
  const total = Math.max(0, Math.round(Number(valor) || 0));
  const mora  = Math.max(0, Math.round(Number(mora_pendiente) || 0));
  const cap   = Math.max(0, Math.round(Number(saldo_capital) || 0));

  let aMora = 0;
  if (modo === 'solo_capital') {
    aMora = 0;
  } else if (modo === 'personalizado') {
    aMora = Math.min(Math.max(0, Math.round(Number(valor_mora) || 0)), mora, total);
  } else {
    aMora = Math.min(mora, total);
  }

  const aCapital  = Math.min(cap, total - aMora);
  const excedente = total - aMora - aCapital;   // va a saldo a favor

  return { a_mora: aMora, a_capital: aCapital, excedente };
};

module.exports = {
  ZONA, TIPO_MENSUAL, TIPO_DIARIA_FIJA, MAX_CONDICIONES,
  hoyBogota,
  normalizarCondicion, parsearCondiciones, leerConfigMora, describirCondicion,
  diasDeAtraso, calcularMoraCausada, resolverEstadoMora, repartirAbono,
};
