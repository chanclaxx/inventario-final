// ─────────────────────────────────────────────────────────────────────────────
// Centro de gastos — la aritmética, sin base de datos.
//
// Todo lo que decide una cifra vive aquí como función pura: el total de un
// gasto, a qué mes contable pertenece, si un recurrente está vencido y el
// estado de resultados del mes. Lo usan el service y la suite 82, así que lo
// que la prueba comprueba es exactamente lo que corre.
// ─────────────────────────────────────────────────────────────────────────────

const TIPOS = ['fijo', 'variable'];

// El juego inicial de categorías. Cada negocio lo recibe la primera vez que
// entra, y después las renombra, las crea o las apaga a su gusto. `tipo` es el
// de por defecto del gasto (el gasto lo congela y se puede cambiar).
const CATEGORIAS_DEFECTO = [
  { nombre: 'Arriendo',                    tipo: 'fijo',     color: '#6366F1', icono: 'home' },
  { nombre: 'Nómina y prestaciones',       tipo: 'fijo',     color: '#8B5CF6', icono: 'users' },
  { nombre: 'Servicios públicos',          tipo: 'fijo',     color: '#0EA5E9', icono: 'zap' },
  { nombre: 'Internet y telefonía',        tipo: 'fijo',     color: '#06B6D4', icono: 'wifi' },
  { nombre: 'Software y suscripciones',    tipo: 'fijo',     color: '#14B8A6', icono: 'monitor' },
  { nombre: 'Contador y honorarios',       tipo: 'fijo',     color: '#64748B', icono: 'briefcase' },
  { nombre: 'Transporte y domicilios',     tipo: 'variable', color: '#F59E0B', icono: 'truck' },
  { nombre: 'Publicidad',                  tipo: 'variable', color: '#EC4899', icono: 'megaphone' },
  { nombre: 'Mantenimiento y reparaciones', tipo: 'variable', color: '#F97316', icono: 'wrench' },
  { nombre: 'Papelería y aseo',            tipo: 'variable', color: '#84CC16', icono: 'clipboard' },
  { nombre: 'Comisiones y datáfono',       tipo: 'variable', color: '#EF4444', icono: 'credit-card' },
  { nombre: 'Impuestos',                   tipo: 'variable', color: '#DC2626', icono: 'landmark' },
  { nombre: 'Cafetería y alimentación',    tipo: 'variable', color: '#A16207', icono: 'coffee' },
  { nombre: 'Otros',                       tipo: 'variable', color: '#9CA3AF', icono: 'tag' },
];

// A qué categoría va cada «gasto fijo» viejo de Proyección al convertirlo. Se
// mira el NOMBRE que el usuario le puso; lo que no encaja va a «Otros». El
// recurrente nace como FIJO en cualquier caso: en Proyección todos lo eran.
const PISTAS_CATEGORIA = [
  [/arriendo|arrendamiento|alquiler|local/, 'Arriendo'],
  [/n[oó]mina|salario|sueldo|prestaci|seguridad social|empleado|eps|pensi/, 'Nómina y prestaciones'],
  [/internet|telef|celular|plan de datos|claro|movistar|tigo/, 'Internet y telefonía'],
  [/\bluz\b|energ|\bagua\b|acueducto|\bgas\b|servicio/, 'Servicios públicos'],
  [/software|suscrip|licencia|programa|sistema|app/, 'Software y suscripciones'],
  [/contador|contab|honorario|abogad|asesor/, 'Contador y honorarios'],
  [/public|redes|marketing|anuncio/, 'Publicidad'],
  [/transporte|domicilio|envio|envío|flete|gasolina/, 'Transporte y domicilios'],
  [/impuesto|\bica\b|predial|\biva\b|retenci|dian/, 'Impuestos'],
];

const categoriaPorNombre = (nombre) => {
  const n = String(nombre || '').toLowerCase();
  for (const [re, cat] of PISTAS_CATEGORIA) if (re.test(n)) return cat;
  return 'Otros';
};

// ── Fechas (siempre texto 'YYYY-MM-DD', nunca Date: ver CLAUDE.md) ──────────
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const RE_MES   = /^\d{4}-\d{2}$/;

const hoyBogota = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

const esFechaValida = (f) => {
  if (!RE_FECHA.test(String(f || ''))) return false;
  const [y, m, d] = f.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

// 'YYYY-MM' o 'YYYY-MM-DD' → 'YYYY-MM-01'. null si no se entiende.
const mesContableDe = (valor) => {
  const v = String(valor || '');
  if (RE_MES.test(v)) {
    const m = Number(v.slice(5, 7));
    return m >= 1 && m <= 12 ? `${v}-01` : null;
  }
  if (esFechaValida(v)) return `${v.slice(0, 7)}-01`;
  return null;
};

const diasDelMes = (mes01) => {
  const [y, m] = mes01.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

const sumarMeses = (mes01, n) => {
  const [y, m] = mes01.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
};

const ultimoDia = (mes01) => `${mes01.slice(0, 8)}${String(diasDelMes(mes01)).padStart(2, '0')}`;

const diasEntre = (a, b) => {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
};

// ── El valor de un gasto ────────────────────────────────────────────────────
//
// La tabla del cliente tiene cantidad × valor unitario = subtotal, + IVA −
// retenciones = total. A veces llena todo y a veces solo el total, así que:
//   * con subtotal (escrito, o cantidad × unitario), el TOTAL se calcula;
//   * sin subtotal, manda el total que se escribió y el resto queda vacío.
// Devuelve null en lo que no se dio: un 0 inventado se ve como un dato.
const redondear = (v) => Math.round(Number(v) * 100) / 100;
const numOpc = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

const calcularValores = (d = {}) => {
  const cantidad       = numOpc(d.cantidad);
  const valorUnitario  = numOpc(d.valor_unitario);
  let   subtotal       = numOpc(d.subtotal);
  const iva            = numOpc(d.iva);
  const retenciones    = numOpc(d.retenciones);
  const totalEscrito   = numOpc(d.valor_total);

  for (const [k, v] of Object.entries({ cantidad, valor_unitario: valorUnitario, subtotal, iva, retenciones, valor_total: totalEscrito })) {
    if (Number.isNaN(v)) throw { status: 400, message: `El campo ${k} no es un número`, code: 'GASTO_NUMERO_INVALIDO' };
    if (v !== null && v < 0) throw { status: 400, message: `El campo ${k} no puede ser negativo`, code: 'GASTO_NUMERO_INVALIDO' };
  }

  if (subtotal === null && cantidad !== null && valorUnitario !== null) {
    subtotal = redondear(cantidad * valorUnitario);
  }

  const valorTotal = subtotal !== null
    ? redondear(subtotal + (iva ?? 0) - (retenciones ?? 0))
    : (totalEscrito !== null ? redondear(totalEscrito) : null);

  if (!(valorTotal > 0)) {
    throw { status: 400, message: 'El gasto necesita un valor mayor a cero', code: 'GASTO_SIN_VALOR' };
  }
  return {
    cantidad, valor_unitario: valorUnitario, subtotal,
    iva, retenciones, valor_total: valorTotal,
  };
};

// ── Recurrentes: ¿ya se pagó este mes, vence, se venció? ────────────────────
//
// `vence` es el día de pago dentro del mes contable (acotado al último día:
// «día 31» en febrero es el 28). Sin día de pago no hay vencimiento: queda
// «pendiente» a secas. Solo un mes que ya pasó, o el día que ya pasó dentro
// del mes en curso, cuenta como vencido.
const DIAS_POR_VENCER = 5;

const estadoRecurrente = ({ dia_pago, pagado }, mes01, hoy = hoyBogota()) => {
  const vence = dia_pago
    ? `${mes01.slice(0, 8)}${String(Math.min(Number(dia_pago), diasDelMes(mes01))).padStart(2, '0')}`
    : null;
  if (pagado) return { vence, estado: 'pagado', dias: null };
  const fin = ultimoDia(mes01);
  if (!vence) {
    return { vence, estado: hoy > fin ? 'vencido' : 'pendiente', dias: null };
  }
  const dias = diasEntre(hoy, vence);
  if (dias < 0) return { vence, estado: 'vencido', dias };
  if (dias <= DIAS_POR_VENCER) return { vence, estado: 'por_vencer', dias };
  return { vence, estado: 'pendiente', dias };
};

// ── El estado de resultados del mes ─────────────────────────────────────────
//
// La utilidad bruta NO se calcula aquí: es `utilidad_periodo` de Reportes →
// Ventas (contado + créditos saldados + préstamos saldados + servicios + lo
// cobrado de los despachos), la misma de Análisis, del PDF y de Proyección. A
// eso se le restan los gastos del MES CONTABLE y se le suma, aparte, el ingreso
// financiero (mora e interés), que nunca es margen comercial.
const armarEstadoResultados = ({ ventasRango, gastos }) => {
  const up = ventasRango?.utilidad_periodo || { total: 0, sin_costo: { total: 0 } };
  const resumen = ventasRango?.resumen || null;
  const ventasFacturadas = Number(resumen?.total_ventas || 0);
  const financieros = {
    mora:     Number(resumen?.ingresos_mora || ventasRango?.mora?.resumen?.cobrada || 0),
    interes:  Number(resumen?.ingresos_interes || ventasRango?.mora?.resumen?.interes_cobrado || 0),
    mora_red: Number(ventasRango?.red_interna?.mora?.cobrada || 0),
  };
  financieros.total = financieros.mora + financieros.interes + financieros.mora_red;

  const fijos     = Number(gastos?.fijos || 0);
  const variables = Number(gastos?.variables || 0);
  const totalGastos = fijos + variables;
  const utilidadBruta = Number(up.total || 0);
  const operacional = utilidadBruta - totalGastos;
  const neta = operacional + financieros.total;

  return {
    ventas_facturadas: ventasFacturadas,
    utilidad_bruta: {
      total: utilidadBruta,
      partes: {
        contado:   Number(up.contado || 0),
        creditos:  Number(up.creditos || 0),
        prestamos: Number(up.prestamos || 0),
        servicios: Number(up.servicios || 0),
        despachos: Number(up.despachos || 0),
      },
      sin_costo: Number(up.sin_costo?.total || 0),
    },
    gastos: { fijos, variables, total: totalGastos },
    utilidad_operacional: operacional,
    ingresos_financieros: financieros,
    utilidad_neta: neta,
    // «De cada $100 que vendiste, $X se fueron en gastos». Sin ventas no se
    // inventa una proporción.
    gasto_por_cada_100: ventasFacturadas > 0 ? Math.round((totalGastos / ventasFacturadas) * 100) : null,
  };
};

module.exports = {
  TIPOS, CATEGORIAS_DEFECTO, categoriaPorNombre,
  hoyBogota, esFechaValida, mesContableDe, diasDelMes, sumarMeses, ultimoDia, diasEntre,
  calcularValores, estadoRecurrente, armarEstadoResultados, DIAS_POR_VENCER,
};
