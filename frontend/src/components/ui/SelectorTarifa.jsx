import { Percent } from 'lucide-react';
import { etiquetaTarifa, motivoNoAplicable } from '../../utils/tarifas';

// ─────────────────────────────────────────────────────────────────────────────
// Chips de tarifa porcentual.
//
// Se usa en dos escalas:
//   · `compacto = false` → barra del carrito, aplica a todos los ítems.
//   · `compacto = true`  → chip por ítem (carrito, resumen de factura/préstamo).
//
// `valor` es el id de la tarifa activa, o null = precio manual / de lista.
// Volver a tocar la tarifa activa la deselecciona (vuelve al precio de lista).
// ─────────────────────────────────────────────────────────────────────────────

const COLORES = {
  green:  'bg-emerald-50 border-emerald-300 text-emerald-700',
  blue:   'bg-blue-50 border-blue-300 text-blue-700',
  purple: 'bg-purple-50 border-purple-300 text-purple-700',
  amber:  'bg-amber-50 border-amber-300 text-amber-700',
  gray:   'bg-gray-100 border-gray-300 text-gray-700',
};

const INACTIVO = 'bg-white border-gray-200 text-gray-500 hover:border-gray-300';

export function SelectorTarifa({
  tarifas,
  valor,
  onChange,
  verPorcentaje = false,
  disabled = false,
  motivoDisabled = '',
  compacto = false,
  label,
}) {
  if (!tarifas?.length) return null;

  const tamano = compacto
    ? 'text-[11px] px-2 py-0.5'
    : 'text-xs px-2.5 py-1';

  return (
    <div className="flex flex-col gap-1.5" title={disabled ? motivoDisabled : undefined}>
      {label && (
        <div className="flex items-center gap-1.5">
          <Percent size={12} className="text-gray-400 flex-shrink-0" />
          <span className="text-xs font-medium text-gray-500">{label}</span>
        </div>
      )}
      <div className={`flex flex-wrap gap-1.5 ${disabled ? 'opacity-40' : ''}`}>
        {tarifas.map((t) => {
          const activo = valor === t.id;
          return (
            <button
              key={t.id}
              type="button"
              disabled={disabled}
              // Tocar la tarifa activa la quita: devuelve el precio de lista.
              onClick={() => onChange(activo ? null : t)}
              className={`rounded-full border font-medium transition-colors
                disabled:cursor-not-allowed ${tamano}
                ${activo ? (COLORES[t.color] || COLORES.blue) : INACTIVO}`}
            >
              {etiquetaTarifa(t, verPorcentaje)}
            </button>
          );
        })}
      </div>
      {disabled && motivoDisabled && (
        <span className="text-[11px] text-gray-400">{motivoDisabled}</span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Chip de tarifa para UN ítem del carrito.
//
// Concentra la lógica que si no habría que repetir en el carrito, en el modal
// de factura y en el de préstamo: resolver si el ítem admite tarifa, con qué
// motivo no, y mostrar el aviso de precio bajo el costo.
// ─────────────────────────────────────────────────────────────────────────────
export function TarifaItem({ item, config, onAplicar }) {
  const { tarifas, modo, redondeo, verPorcentaje, avisarBajoCosto } = config;

  // Basta con evaluar la primera: el motivo depende del costo del ítem, que es
  // el mismo para todas las tarifas de la lista.
  //
  // `motivo_sin_tarifa` gana cuando existe: el genérico "no tiene costo" sería
  // engañoso para una unidad propia de un local de la red, que sí tiene costo
  // pero no uno comparable con el de la mercancía consignada.
  const motivo = item.motivo_sin_tarifa
    || motivoNoAplicable(item.costo, tarifas[0], { modo });

  const bajoCosto = avisarBajoCosto
    && item.costo != null
    && Number(item.precioFinal) > 0
    && Number(item.precioFinal) < Number(item.costo);

  return (
    <div className="flex flex-col gap-1">
      <SelectorTarifa
        compacto
        tarifas={tarifas}
        valor={item.tarifa_id || null}
        verPorcentaje={verPorcentaje}
        disabled={!!motivo}
        motivoDisabled={motivo || ''}
        onChange={(t) => onAplicar(item.key, t, { modo, redondeo })}
      />
      {bajoCosto && (
        <span className="text-[11px] text-red-500">
          El precio está por debajo del costo
        </span>
      )}
    </div>
  );
}

export default SelectorTarifa;
