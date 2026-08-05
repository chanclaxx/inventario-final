import { useEffect } from 'react';
import { Percent, X } from 'lucide-react';
import { describirPlanCompleto, proyectar } from '../../utils/interes';
import { formatCOP } from '../../utils/formatters';

// ─────────────────────────────────────────────────────────────────────────────
// Plan de interés por financiar, al vender a crédito o al prestar.
//
// Va como HERMANO de `SelectorPlazo`, no dentro: el interés y la mora son
// independientes y la pantalla tiene que mostrarlo. Se puede dar plazo sin
// cobrar interés (venta a crédito normal), cobrar interés sin poner plazo
// (deuda abierta) o las dos cosas.
//
// Con la feature apagada no renderiza nada, así que ponerlo en un formulario no
// cambia nada para los negocios que no la usan.
//
// Reglas de uso:
//   · El plan llega PRESELECCIONADO con el que el admin marcó por defecto, y se
//     puede cambiar o quitar. Sin plan no se cobra interés: es la vía para no
//     cobrarle a un compañero.
//   · El vendedor elige entre los que pregrabó el admin; no puede inventar tasas.
// ─────────────────────────────────────────────────────────────────────────────

const COLORES = {
  teal:   'bg-teal-50 border-teal-300 text-teal-700',
  blue:   'bg-blue-50 border-blue-300 text-blue-700',
  green:  'bg-emerald-50 border-emerald-300 text-emerald-700',
  purple: 'bg-purple-50 border-purple-300 text-purple-700',
  gray:   'bg-gray-100 border-gray-300 text-gray-700',
};
const INACTIVO = 'bg-white border-gray-200 text-gray-500 hover:border-gray-300';

export function SelectorInteres({
  config,               // lo que devuelve useInteres()
  planId,               // id del plan elegido | ''
  onChange,             // (plan_id) => void
  valorBase = 0,        // para mostrar cuánto costaría de verdad
  titulo = 'Interés por financiar',
}) {
  const { activa, planes, defaultId } = config || {};

  // Preselección: al montar con la feature activa se sugiere el plan por
  // defecto. El vendedor puede quitarlo si esa venta no lleva interés.
  useEffect(() => {
    if (!activa || planId) return;
    if (!defaultId) return;
    onChange(defaultId);
    // Solo al activarse: no debe repisar lo que el vendedor elija después.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activa, defaultId]);

  if (!activa) return null;

  const plan = planes.find((p) => p.id === planId) || null;

  return (
    <div className="flex flex-col gap-2.5 p-3 bg-teal-50/40 border border-teal-100 rounded-xl">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Percent size={14} className="text-teal-500 flex-shrink-0" />
          <span className="text-xs font-semibold text-gray-700">{titulo}</span>
        </div>
        {plan && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={11} /> sin interés
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {planes.map((p) => {
          const sel = planId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange(p.id)}
              className={`rounded-full border text-[11px] font-medium px-2.5 py-1 transition-colors
                ${sel ? (COLORES[p.color] || COLORES.teal) : INACTIVO}`}
            >
              {p.nombre}
            </button>
          );
        })}
      </div>

      {plan ? (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-gray-500">{describirPlanCompleto(plan)}</span>
          {/* Lo que de verdad va a costar, con el valor de ESTA venta: un
              porcentaje suelto no le dice nada al cliente en el mostrador. */}
          {valorBase > 0 && (
            <span className="text-[11px] text-gray-600">
              Sobre {formatCOP(valorBase)}:
              {' '}<strong>{formatCOP(proyectar(plan, valorBase, 30))}</strong> al mes
              {' · '}<strong>{formatCOP(proyectar(plan, valorBase, 90))}</strong> a los 3 meses
            </span>
          )}
        </div>
      ) : (
        <span className="text-[11px] text-gray-400">
          Sin plan seleccionado no se cobra interés.
        </span>
      )}
    </div>
  );
}

export default SelectorInteres;
