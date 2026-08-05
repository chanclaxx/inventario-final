// ─────────────────────────────────────────────────────────────────────────────
// MOTOR DE DEVENGO — el cálculo que comparten la mora y el interés corriente.
//
// Este archivo no sabe qué es una mora ni qué es un interés. Sabe una sola cosa:
// dado un punto de partida, una fecha de corte, una base que cambia con los
// abonos y una regla, cuánto se causó.
//
// Nació al separar los dos cargos: `calcularMoraCausada` ya era, sin nombrarlo,
// un motor genérico —reconstruía tramos de saldo constante y sumaba tramo × tasa—
// y lo único propio de la mora eran dos cosas: desde cuándo corre y con qué tasa.
// Duplicarlo para el interés habría significado mantener dos veces la parte
// delicada (la reconstrucción por tramos), que ya tuvo un bug grave: calcular
// sobre el saldo de hoy hacía DESAPARECER toda la mora causada cuando el cliente
// saldaba el capital. Lo encontró la suite adversaria; no se puede volver a abrir
// esa puerta por copiar el algoritmo.
//
// REGLAS DE DISEÑO:
//
//   1. PURO. Sin base de datos, sin red, sin `Date.now()` salvo `hoyBogota()`.
//      Todo se puede probar con valores literales.
//
//   2. Los días se cuentan en America/Bogota. A partir de las 19:00 de Colombia
//      `toISOString()` ya devuelve el día siguiente.
//
//   3. Interés SIMPLE. Nunca sobre lo ya causado — el anatocismo (interés sobre
//      interés) está prohibido. La regla acepta `capitaliza` para dejar el JSON
//      estable, pero el motor lo ignora a propósito.
//
//   4. La mora que existía antes de este archivo es un caso PARTICULAR EXACTO de
//      este motor, no una aproximación:
//        · 'mensual'     → dias_periodo 30, porcentaje, devengo diario
//                          ⇒ saldo × (v/100) × (dias/30)      ← idéntico
//        · 'diaria_fija' → dias_periodo  1, fijo,       devengo diario
//                          ⇒ v × (dias/1) = v × dias           ← idéntico
//      Es una identidad algebraica. Si algún día deja de serlo, las suites
//      09-mora-credito y 10-adversario-mora-tarifas lo cazan.
// ─────────────────────────────────────────────────────────────────────────────

const ZONA = 'America/Bogota';

// Cómo se causa dentro del período.
const DEVENGO_DIARIO = 'diario';            // proporcional: medio período, media tasa
const DEVENGO_PERIODO = 'periodo_cumplido'; // escalón: no cobra hasta cumplir el período

// Sobre qué se calcula.
const BASE_SALDO    = 'saldo';           // lo que se debe hoy; abonar baja la base
const BASE_ORIGINAL = 'valor_original';  // el valor de origen; abonar no la mueve

// Cómo se expresa el valor.
const TIPO_PORCENTAJE = 'porcentaje';
const TIPO_FIJO       = 'fijo';

// Periodicidades con nombre. Cualquier otro número de días va como `cada_n_dias`.
const PERIODOS = {
  diaria:     1,
  semanal:    7,
  quincenal: 15,
  mensual:   30,
};

// ── Fechas ───────────────────────────────────────────────────────────────────

/** Hoy en Colombia como 'YYYY-MM-DD'. */
const hoyBogota = () => new Date().toLocaleDateString('en-CA', { timeZone: ZONA });

/**
 * Normaliza una fecha de CALENDARIO a 'YYYY-MM-DD'. Acepta Date o string.
 *
 * OJO con los objetos Date: el driver de Postgres entrega las columnas `DATE`
 * como un Date a medianoche UTC. Convertirlo a la zona de Bogotá (UTC−5) lo
 * correría un día hacia atrás — un plazo del 29 se leería como del 28 y el
 * cargo saldría con un día extra. Por eso aquí se leen los componentes UTC.
 *
 * Para "ahora" NO se usa esta función: eso es `hoyBogota()`.
 */
const aFecha = (v) => {
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
 * Va aparte de `aFecha` a propósito, y la diferencia importa:
 *   · `fecha_limite` es un DATE → el driver lo entrega a medianoche UTC y hay
 *     que leer los componentes UTC (si no, se corre un día atrás).
 *   · la fecha de un abono es un TIMESTAMP → es un momento real, y el día que
 *     cuenta es el del negocio. A las 19:00 de Bogotá el UTC ya es el día
 *     siguiente, así que leerlo en UTC adelantaría el abono un día y lo dejaría
 *     "en el futuro" — con eso el abono quedaba fuera del cálculo y el cargo
 *     causado se perdía.
 */
const aFechaInstante = (v) => {
  if (!v) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return v.toLocaleDateString('en-CA', { timeZone: ZONA });
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

/**
 * Normaliza el ANCLA de un cargo (el día desde el que empieza a correr).
 *
 * POR QUÉ EXISTE, y por qué no basta con `aFecha`: un `Date` suelto es
 * AMBIGUO — no se puede saber si vino de una columna DATE (hay que leerla en
 * UTC) o TIMESTAMP (hay que leerla en Bogotá), y equivocarse corre el cálculo
 * un día. Esa confusión ya causó dos bugs de dinero en este módulo.
 *
 * La regla es: **quien conoce la columna normaliza**. `mora.service` resuelve
 * el ancla antes de llamar aquí (ver `_inicioInteres`), así que a esta función
 * le llegan strings 'YYYY-MM-DD' ya resueltos y solo tiene que validarlos.
 *
 * Si de todas formas llega un `Date`, se interpreta como TIMESTAMP (Bogotá),
 * que es el caso de las dos columnas de emisión que existen —
 * `prestamos.fecha` y `creditos.creado_en`— y por lo tanto el default seguro.
 * La única columna DATE del interés (`interes_desde`) siempre pasa por el
 * service, que la normaliza con `aFecha`.
 */
const aFechaAncla = (v) => (v instanceof Date ? aFechaInstante(v) : aFecha(v));

/** Suma días a 'YYYY-MM-DD' en aritmética de calendario (sin zonas ni DST). */
const sumarDias = (iso, dias) => {
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + Number(dias || 0))).toISOString().slice(0, 10);
};

/** Días calendario entre dos 'YYYY-MM-DD' (b − a). Sin horas: evita DST. */
const diasEntre = (a, b) => {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
};

// ── Reglas ───────────────────────────────────────────────────────────────────

/**
 * Normaliza una regla de devengo. Devuelve null si no es utilizable, para que
 * el llamador la descarte en vez de calcular con basura.
 *
 * Esta es la forma INTERNA del motor. Cada cargo (mora, interés) tiene su propio
 * normalizador de cara al usuario y traduce a esta.
 */
const normalizarRegla = (cruda) => {
  if (!cruda || typeof cruda !== 'object' || Array.isArray(cruda)) return null;

  const valor = Number(cruda.valor);
  if (!Number.isFinite(valor) || valor <= 0) return null;

  const tipo = cruda.tipo === TIPO_FIJO ? TIPO_FIJO : TIPO_PORCENTAJE;

  const dias = Number(cruda.dias_periodo);
  if (!Number.isFinite(dias) || dias < 1) return null;
  // Un período mayor a dos años no es un pacto creíble; casi siempre es un dedo.
  if (dias > 730) return null;

  const maxP = Number(cruda.max_periodos);
  const tope = Number(cruda.tope_pct);

  return {
    tipo,
    valor,
    dias_periodo: Math.floor(dias),
    devengo: cruda.devengo === DEVENGO_PERIODO ? DEVENGO_PERIODO : DEVENGO_DIARIO,
    base:    cruda.base === BASE_ORIGINAL ? BASE_ORIGINAL : BASE_SALDO,
    max_periodos: Number.isFinite(maxP) && maxP > 0 ? Math.floor(maxP) : null,
    // 0 o ausente = sin tope
    tope_pct:     Number.isFinite(tope) && tope > 0 ? tope : null,
    // Se acepta para que el JSON guardado tenga forma estable, pero el motor
    // NO capitaliza: sería anatocismo. Ver regla de diseño 3.
    capitaliza: false,
  };
};

/** Días que dura un período a partir de una periodicidad con nombre. */
const diasDePeriodicidad = (periodicidad, cadaDias = null) => {
  if (periodicidad === 'cada_n_dias') {
    const n = Number(cadaDias);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
  }
  return PERIODOS[periodicidad] ?? null;
};

// ── Historia del saldo ───────────────────────────────────────────────────────

/**
 * Reconstruye cuánto se debía en cada momento entre `inicio` y `hasta`.
 *
 * POR QUÉ SE RECONSTRUYE Y NO SE USA EL SALDO DE HOY: si se calculara sobre el
 * saldo actual, un cliente que se atrasa 35 días y después paga todo el capital
 * dejaría la base en 0 y el cargo ya causado DESAPARECERÍA. El negocio perdería
 * los intereses justo en el caso más común: el cliente que salda.
 *
 * Como entre dos abonos el saldo es constante, basta partir el tiempo en tramos.
 * No hace falta guardar nada: al saldo de hoy se le devuelven los abonos
 * posteriores al inicio.
 *
 * @returns {{ saldoInicial:number, tramos:Array, saldoEn:(fecha)=>number }}
 */
const reconstruirSaldo = ({ saldo, abonos = [], inicio, hasta, hoy }) => {
  const saldoHoy = Number(saldo) || 0;

  // Abonos posteriores al inicio del devengo y no futuros, en orden.
  const posteriores = (abonos || [])
    // `aFechaInstante`: la fecha de un abono es un TIMESTAMP, no un DATE.
    .map((a) => ({ fecha: aFechaInstante(a.fecha), valor: Number(a.valor) || 0 }))
    .filter((a) => a.fecha && a.valor > 0
                   && diasEntre(inicio, a.fecha) > 0
                   && diasEntre(a.fecha, hoy) >= 0)
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));

  const saldoInicial = saldoHoy + posteriores.reduce((s, a) => s + a.valor, 0);

  // Tramos de saldo constante, recortados en `hasta` (que puede ser anterior a
  // hoy si la regla tiene tope de períodos).
  const tramos = [];
  let cursor = inicio;
  let saldoTramo = saldoInicial;
  for (const ab of posteriores) {
    if (diasEntre(ab.fecha, hasta) < 0) break;   // el abono cae fuera de la ventana
    const dias = diasEntre(cursor, ab.fecha);
    if (dias > 0) tramos.push({ desde: cursor, hasta: ab.fecha, dias, saldo: saldoTramo });
    saldoTramo = Math.max(0, saldoTramo - ab.valor);
    cursor = ab.fecha;
  }
  const diasFinal = diasEntre(cursor, hasta);
  if (diasFinal > 0) tramos.push({ desde: cursor, hasta, dias: diasFinal, saldo: saldoTramo });

  /**
   * Cuánto se debía al CERRAR el día `fecha`. Los abonos hechos ese mismo día
   * ya bajaron el saldo: se cobra sobre lo que quedó debiendo, no sobre lo que
   * debía en la mañana. Es la lectura que favorece a quien paga.
   */
  const saldoEn = (fecha) => {
    let s = saldoInicial;
    for (const ab of posteriores) {
      if (diasEntre(ab.fecha, fecha) >= 0) s -= ab.valor;
    }
    return Math.max(0, s);
  };

  return { saldoInicial, tramos, saldoEn };
};

// ── Cálculo ──────────────────────────────────────────────────────────────────

/**
 * Cuánto se causó entre `inicio` y `hasta`.
 *
 * @param {string} inicio          'YYYY-MM-DD' — el día desde el que corre el cargo.
 * @param {string} [hasta]         corte; por defecto hoy en Bogotá.
 * @param {number} saldo           saldo de capital HOY.
 * @param {Array}  [abonos]        abonos a capital `[{ fecha, valor }]`.
 * @param {number} [valor_original] base cuando la regla usa `valor_original`.
 * @param {object} regla           regla ya normalizada (o normalizable).
 *
 * Devuelve 0 (nunca null ni NaN) cuando no aplica.
 */
const calcularDevengo = ({
  inicio, hasta, saldo, abonos = [], valor_original = null, regla,
} = {}) => {
  const r = normalizarRegla(regla) || (regla && regla.dias_periodo ? regla : null);
  if (!r) return 0;

  const desde = aFecha(inicio);
  if (!desde) return 0;

  const hoy   = aFecha(hasta) || hoyBogota();
  const total = diasEntre(desde, hoy);
  if (total <= 0) return 0;

  // Tope de períodos: el cargo deja de correr al cumplirlos. Se recorta la
  // ventana en vez de recortar el resultado, para que un abono posterior al
  // corte no siga moviendo la base.
  const diasVentana = r.max_periodos != null
    ? Math.min(total, r.max_periodos * r.dias_periodo)
    : total;
  if (diasVentana <= 0) return 0;
  const fin = sumarDias(desde, diasVentana);

  const original = Number(valor_original);
  const usaOriginal = r.base === BASE_ORIGINAL && Number.isFinite(original) && original > 0;

  const { saldoInicial, tramos, saldoEn } = reconstruirSaldo({
    saldo, abonos, inicio: desde, hasta: fin, hoy,
  });

  // La base contra la que se mide todo: el capital que estuvo debiéndose, o el
  // valor de origen si la regla lo pide.
  const baseTope = usaOriginal ? original : saldoInicial;
  if (baseTope <= 0) return 0;   // nunca hubo deuda

  let bruto = 0;

  if (r.devengo === DEVENGO_PERIODO) {
    // ESCALÓN. No cobra nada hasta cumplir el período completo, y entonces cobra
    // el período entero de una sola vez. Es lo que la gente pacta cuando dice
    // "pasa el mes y sube un 2%": no sube de a poquitos, sube el día 30.
    const periodos = Math.floor(diasVentana / r.dias_periodo);
    for (let k = 1; k <= periodos; k++) {
      const corte = sumarDias(desde, k * r.dias_periodo);
      const base  = usaOriginal ? original : saldoEn(corte);
      if (base <= 0 && !usaOriginal) continue;   // sin deuda al cerrar, no cobra
      bruto += r.tipo === TIPO_FIJO ? r.valor : base * (r.valor / 100);
    }
  } else {
    // PROPORCIONAL AL DÍA. Medio período cobra media tasa. Es lo que ya hacía la
    // mora, y por eso esta rama tiene que dar exactamente lo mismo que antes.
    for (const t of tramos) {
      const base = usaOriginal ? original : t.saldo;
      if (base <= 0) continue;                   // sin deuda ese tramo, no causa
      bruto += r.tipo === TIPO_FIJO
        ? r.valor * (t.dias / r.dias_periodo)
        : base * (r.valor / 100) * (t.dias / r.dias_periodo);
    }
  }

  if (!Number.isFinite(bruto) || bruto <= 0) return 0;

  // Tope opcional: se mide contra la base que estuvo vigente, no contra el saldo
  // de hoy (que puede ser 0 y anularía el tope).
  const conTope = r.tope_pct != null
    ? Math.min(bruto, baseTope * (r.tope_pct / 100))
    : bruto;

  return Math.round(conTope);
};

/**
 * Cuántos períodos completos han corrido, y cuánto falta para el siguiente.
 * Sirve para explicarle al usuario por qué debe lo que debe.
 */
const estadoPeriodos = (inicio, regla, hoy = hoyBogota()) => {
  const r = normalizarRegla(regla);
  const desde = aFecha(inicio);
  if (!r || !desde) return { periodos: 0, dias_corridos: 0, dias_al_siguiente: null };

  const dias = Math.max(0, diasEntre(desde, aFecha(hoy) || hoyBogota()));
  const periodos = Math.floor(dias / r.dias_periodo);
  return {
    periodos,
    dias_corridos: dias,
    dias_al_siguiente: r.dias_periodo - (dias % r.dias_periodo),
  };
};

module.exports = {
  ZONA,
  DEVENGO_DIARIO, DEVENGO_PERIODO,
  BASE_SALDO, BASE_ORIGINAL,
  TIPO_PORCENTAJE, TIPO_FIJO,
  PERIODOS,
  hoyBogota, aFecha, aFechaInstante, aFechaAncla, sumarDias, diasEntre,
  normalizarRegla, diasDePeriodicidad,
  reconstruirSaldo, calcularDevengo, estadoPeriodos,
};
