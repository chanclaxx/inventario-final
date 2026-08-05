import { Percent, CalendarClock, Check } from 'lucide-react';
import { describirCondicion, fechaLegible, hoyBogota, sumarDias } from '../../utils/mora';
import { describirPlanCompleto, proyectar, unidadPeriodo } from '../../utils/interes';
import { formatCOP } from '../../utils/formatters';

// ─────────────────────────────────────────────────────────────────────────────
// CONDICIONES DE PAGO de una venta a crédito o un préstamo.
//
// Reemplaza a los dos selectores sueltos. El flujo es en DOS PASOS a propósito:
//
//   1. El vendedor marca qué cobros lleva esta operación: mora, interés, los dos
//      o ninguno. Nada viene marcado.
//   2. Solo entonces aparecen las opciones que el admin pregrabó en Ajustes.
//
// POR QUÉ NO VIENE PRESELECCIONADO: cobrar un interés que el vendedor no
// escogió es la clase de error que se descubre cuando el cliente reclama. Un
// clic de más es barato; cobrar de más no lo es. (La fecha límite sí llega
// sugerida DENTRO del paso 2, cuando ya se decidió que hay mora.)
//
// Los dos cobros son independientes: se puede dar plazo sin cobrar interés,
// cobrar interés sin poner plazo, o las dos cosas. Cuando van juntos se muestra
// un resumen en palabras, que es lo que el vendedor le lee al cliente.
// ─────────────────────────────────────────────────────────────────────────────

const COLORES_MORA = {
  green: 'bg-emerald-50 border-emerald-300 text-emerald-700',
  amber: 'bg-amber-50 border-amber-300 text-amber-700',
  red:   'bg-red-50 border-red-300 text-red-700',
  blue:  'bg-blue-50 border-blue-300 text-blue-700',
  gray:  'bg-gray-100 border-gray-300 text-gray-700',
};
const COLORES_INT = {
  teal:   'bg-teal-50 border-teal-300 text-teal-700',
  blue:   'bg-blue-50 border-blue-300 text-blue-700',
  green:  'bg-emerald-50 border-emerald-300 text-emerald-700',
  purple: 'bg-purple-50 border-purple-300 text-purple-700',
  gray:   'bg-gray-100 border-gray-300 text-gray-700',
};
const INACTIVO = 'bg-white border-gray-200 text-gray-500 hover:border-gray-300';

/** Chip de paso 1: enciende o apaga un tipo de cobro. */
function ChipCobro({ activo, onClick, icono, titulo, subtitulo, tono }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={`flex-1 min-w-[8.5rem] flex items-start gap-2 p-2.5 rounded-xl border text-left transition-colors
        ${activo ? tono : 'bg-white border-gray-200 hover:border-gray-300'}`}
    >
      <span className={`mt-0.5 w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0
        ${activo ? 'bg-current border-current' : 'border-gray-300'}`}>
        {activo && <Check size={11} className="text-white" strokeWidth={3} />}
      </span>
      <span className="flex flex-col min-w-0">
        <span className="flex items-center gap-1">
          {icono}
          <span className="text-[11px] font-semibold">{titulo}</span>
        </span>
        <span className={`text-[10px] leading-tight ${activo ? 'opacity-80' : 'text-gray-400'}`}>
          {subtitulo}
        </span>
      </span>
    </button>
  );
}

export function SelectorCargos({
  configMora,           // useMora()
  configInteres,        // useInteres()
  valor,                // { fecha_limite, condicion_id, interes_plan_id }
  onChange,             // (siguiente) => void
  valorBase = 0,        // el monto financiado, para mostrar cuánto costaría
  titulo = 'Condiciones de pago',
}) {
  const moraActiva = !!configMora?.activa;
  const intActiva  = !!configInteres?.activa;

  // Con las dos features apagadas esto no existe: el formulario queda como antes.
  if (!moraActiva && !intActiva) return null;

  const { fecha_limite = '', condicion_id = '', interes_plan_id = '' } = valor || {};
  const conMora    = !!fecha_limite;
  const conInteres = !!interes_plan_id;

  const set = (parcial) => onChange({ ...valor, ...parcial });

  const condicion = (configMora?.condiciones || []).find((c) => c.id === condicion_id) || null;
  const plan      = (configInteres?.planes || []).find((p) => p.id === interes_plan_id) || null;

  // Al encender la mora se sugiere el plazo configurado; al apagarla se limpia
  // todo, que es lo que garantiza que no quede una fecha suelta sin condición.
  const toggleMora = () => {
    if (conMora) return set({ fecha_limite: '', condicion_id: '' });
    set({
      fecha_limite: sumarDias(hoyBogota(), configMora.plazoDefault || 30),
      condicion_id: configMora.defaultId || configMora.condiciones?.[0]?.id || '',
    });
  };

  const toggleInteres = () => {
    if (conInteres) return set({ interes_plan_id: '' });
    set({ interes_plan_id: configInteres.defaultId || configInteres.planes?.[0]?.id || '' });
  };

  return (
    <div className="flex flex-col gap-3 p-3 bg-gray-50 border border-gray-200 rounded-xl">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-gray-700">{titulo}</span>
        <span className="text-[11px] text-gray-400">
          Marca lo que lleva esta operación. Si no marcas nada, no se le cobra nada de más.
        </span>
      </div>

      {/* ── Paso 1: qué cobros lleva ── */}
      <div className="flex flex-wrap gap-2">
        {intActiva && (
          <ChipCobro
            activo={conInteres}
            onClick={toggleInteres}
            icono={<Percent size={12} className="flex-shrink-0" />}
            titulo="Interés por financiar"
            subtitulo="Se cobra por dar plazo, esté al día o no"
            tono="bg-teal-50 border-teal-300 text-teal-700"
          />
        )}
        {moraActiva && (
          <ChipCobro
            activo={conMora}
            onClick={toggleMora}
            icono={<CalendarClock size={12} className="flex-shrink-0" />}
            titulo="Mora por atraso"
            subtitulo="Solo si se pasa de la fecha límite"
            tono="bg-amber-50 border-amber-300 text-amber-700"
          />
        )}
      </div>

      {/* ── Paso 2a: opciones del interés ── */}
      {conInteres && (
        <div className="flex flex-col gap-2 p-2.5 bg-white rounded-xl border border-teal-100">
          <span className="text-[11px] font-medium text-gray-500">¿Qué plan de interés?</span>
          <div className="flex flex-wrap gap-1.5">
            {configInteres.planes.map((p) => (
              <button key={p.id} type="button"
                onClick={() => set({ interes_plan_id: p.id })}
                className={`rounded-full border text-[11px] font-medium px-2.5 py-1 transition-colors
                  ${interes_plan_id === p.id ? (COLORES_INT[p.color] || COLORES_INT.teal) : INACTIVO}`}>
                {p.nombre}
              </button>
            ))}
          </div>
          {plan && (
            <>
              <span className="text-[11px] text-gray-500">{describirPlanCompleto(plan)}</span>
              {valorBase > 0 && (
                <span className="text-[11px] text-gray-600">
                  Sobre {formatCOP(valorBase)}:
                  {' '}<strong>{formatCOP(proyectar(plan, valorBase, 30))}</strong> al mes
                  {' · '}<strong>{formatCOP(proyectar(plan, valorBase, 90))}</strong> a los 3 meses
                </span>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Paso 2b: opciones de la mora ── */}
      {conMora && (
        <div className="flex flex-col gap-2 p-2.5 bg-white rounded-xl border border-amber-100">
          <span className="text-[11px] font-medium text-gray-500">¿Hasta cuándo tiene plazo?</span>
          <input
            type="date"
            value={fecha_limite || ''}
            min={hoyBogota()}
            onChange={(e) => set({
              fecha_limite: e.target.value,
              // Borrar la fecha apaga la mora: no tiene sentido una condición
              // sin plazo desde el que contar el atraso.
              condicion_id: e.target.value
                ? (condicion_id || configMora.defaultId || configMora.condiciones?.[0]?.id || '')
                : '',
            })}
            className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900
              focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
          />
          <span className="text-[11px] font-medium text-gray-500 mt-1">Si se pasa de esa fecha</span>
          <div className="flex flex-wrap gap-1.5">
            {configMora.condiciones.map((c) => (
              <button key={c.id} type="button"
                onClick={() => set({ condicion_id: c.id })}
                className={`rounded-full border text-[11px] font-medium px-2.5 py-1 transition-colors
                  ${condicion_id === c.id ? (COLORES_MORA[c.color] || COLORES_MORA.amber) : INACTIVO}`}>
                {c.nombre}
              </button>
            ))}
          </div>
          {condicion
            ? <span className="text-[11px] text-gray-500">{describirCondicion(condicion)}</span>
            : <span className="text-[11px] text-red-500">Elige una condición de mora</span>}
        </div>
      )}

      {/* ── Resumen de lo pactado, en palabras ──
          Es lo que el vendedor le lee al cliente antes de que firme. Aparece
          apenas hay algo pactado, y es el único lugar donde los dos cobros se
          explican juntos y en orden. */}
      {(conInteres || conMora) && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5">
          <p className="text-[11px] font-medium text-blue-800 mb-1">Lo que se le va a cobrar al cliente</p>
          <ul className="flex flex-col gap-1">
            {conInteres && plan && (
              <li className="text-[11px] text-blue-700">
                • <strong>{plan.valor}{plan.tipo === 'fijo' ? ' pesos' : '%'}</strong>{' '}
                por cada {unidadPeriodo(plan)}
                {plan.base === 'valor_original' ? ' sobre el valor total' : ' sobre lo que aún deba'}
                {plan.inicia_tras_dias > 0
                  ? `, empezando a los ${plan.inicia_tras_dias} días.`
                  : ', desde hoy.'}
                {valorBase > 0 && (
                  <> Serían <strong>{formatCOP(proyectar(plan, valorBase, 30))}</strong> el primer mes.</>
                )}
              </li>
            )}
            {conMora && condicion && (
              <li className="text-[11px] text-blue-700">
                • Tiene plazo hasta el <strong>{fechaLegible(fecha_limite)}</strong>. Si se pasa,
                se le suma <strong>{describirCondicion(condicion)}</strong>.
              </li>
            )}
            {conInteres && conMora && plan?.al_vencer === 'sustituye' && (
              <li className="text-[11px] text-blue-600">
                • Mientras esté al día paga el interés; si se atrasa, el interés se detiene y
                empieza a correr la mora. Nunca las dos cosas a la vez.
              </li>
            )}
            {conInteres && conMora && plan?.al_vencer === 'continua' && (
              <li className="text-[11px] text-amber-700">
                • Ojo: con este plan, si se atrasa se le cobran <strong>las dos cosas</strong> al
                mismo tiempo sobre la misma deuda.
              </li>
            )}
          </ul>
          <p className="text-[10px] text-blue-500 mt-1.5">
            Queda impreso en el comprobante con línea de firma. Sin eso no es exigible.
          </p>
        </div>
      )}
    </div>
  );
}

export default SelectorCargos;
