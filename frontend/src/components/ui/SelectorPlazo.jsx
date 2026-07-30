import { useEffect } from 'react';
import { CalendarClock, X } from 'lucide-react';
import { describirCondicion, fechaLegible, hoyBogota, sumarDias } from '../../utils/mora';

// ─────────────────────────────────────────────────────────────────────────────
// Fecha límite de pago + condición de mora.
//
// Se usa igual en la venta a crédito y en el préstamo, para que el vendedor vea
// siempre lo mismo. Con la feature apagada no renderiza nada.
//
// Reglas de uso, decididas con el negocio:
//   · La fecha llega PRECARGADA con el plazo sugerido, y se puede cambiar o
//     quitar. Sin fecha no hay mora: es la vía para no cobrarle a un compañero.
//   · La condición se elige entre las que pregrabó el admin; el vendedor no
//     puede inventar tasas.
// ─────────────────────────────────────────────────────────────────────────────

const COLORES = {
  green: 'bg-emerald-50 border-emerald-300 text-emerald-700',
  amber: 'bg-amber-50 border-amber-300 text-amber-700',
  red:   'bg-red-50 border-red-300 text-red-700',
  blue:  'bg-blue-50 border-blue-300 text-blue-700',
  gray:  'bg-gray-100 border-gray-300 text-gray-700',
};
const INACTIVO = 'bg-white border-gray-200 text-gray-500 hover:border-gray-300';

export function SelectorPlazo({
  config,               // lo que devuelve useMora()
  fechaLimite,          // 'YYYY-MM-DD' | ''
  condicionId,          // id de la condición elegida | ''
  onChange,             // ({ fecha_limite, condicion_id }) => void
  titulo = 'Plazo de pago',
}) {
  const { activa, condiciones, defaultId, plazoDefault } = config || {};

  // Precarga: al montar con la feature activa y sin fecha, se sugiere el plazo
  // configurado y la condición por defecto. Así el vendedor no tiene que
  // acordarse, pero puede borrarla si ese cliente no lleva plazo.
  useEffect(() => {
    if (!activa || fechaLimite) return;
    if (!plazoDefault) return;
    onChange({
      fecha_limite: sumarDias(hoyBogota(), plazoDefault),
      condicion_id: condicionId || defaultId || condiciones?.[0]?.id || '',
    });
    // Solo al activarse: no debe repisar lo que el vendedor escriba después.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activa, plazoDefault]);

  if (!activa) return null;

  const condicion = condiciones.find((c) => c.id === condicionId) || null;
  const conPlazo  = !!fechaLimite;

  return (
    <div className="flex flex-col gap-2.5 p-3 bg-amber-50/40 border border-amber-100 rounded-xl">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <CalendarClock size={14} className="text-amber-500 flex-shrink-0" />
          <span className="text-xs font-semibold text-gray-700">{titulo}</span>
        </div>
        {conPlazo && (
          <button
            type="button"
            onClick={() => onChange({ fecha_limite: '', condicion_id: '' })}
            className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={11} /> sin plazo
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <input
          type="date"
          value={fechaLimite || ''}
          min={hoyBogota()}
          onChange={(e) => onChange({
            fecha_limite: e.target.value,
            // Al poner fecha por primera vez se elige la condición por defecto.
            condicion_id: e.target.value
              ? (condicionId || defaultId || condiciones[0]?.id || '')
              : '',
          })}
          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-900
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <span className="text-[11px] text-gray-400">
          {conPlazo
            ? `Debe pagar antes del ${fechaLegible(fechaLimite)}.`
            : 'Sin fecha límite no se cobra mora.'}
        </span>
      </div>

      {conPlazo && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-gray-500">Si se pasa del plazo</span>
          <div className="flex flex-wrap gap-1.5">
            {condiciones.map((c) => {
              const sel = condicionId === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onChange({ fecha_limite: fechaLimite, condicion_id: c.id })}
                  className={`rounded-full border text-[11px] font-medium px-2.5 py-1 transition-colors
                    ${sel ? (COLORES[c.color] || COLORES.amber) : INACTIVO}`}
                >
                  {c.nombre}
                </button>
              );
            })}
          </div>
          {condicion && (
            <span className="text-[11px] text-gray-500">{describirCondicion(condicion)}</span>
          )}
          {!condicion && (
            <span className="text-[11px] text-red-500">Elige una condición de mora</span>
          )}
        </div>
      )}
    </div>
  );
}

export default SelectorPlazo;
