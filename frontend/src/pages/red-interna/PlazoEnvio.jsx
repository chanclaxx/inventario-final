import { describirCondicion } from '../../utils/mora';
import { estadoPlazo } from './moraEnvio';
import { CalendarClock, AlertTriangle, CheckCircle2 } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// PLAZO DE PAGO DE LOS ENVÍOS — piezas compartidas de la pantalla
//
// Aquí NO se calcula la mora: llega calculada del backend en la clave `mora` de
// cada envío (el mismo motor de créditos). Este archivo solo lee la
// configuración para pintar el selector y formatea lo que ya viene resuelto.
// ─────────────────────────────────────────────────────────────────────────────

export function SelectorPlazoEnvio({ mora, valor, onChange, ayuda = null }) {
  if (!mora?.activa) return null;
  const sinPlazo = !valor;
  const cond = valor ? mora.condiciones.find((c) => c.id === valor.condicion_id) : null;

  return (
    <div className="flex flex-col gap-2 bg-gray-50 rounded-xl px-3.5 py-3">
      <div className="flex items-center gap-2">
        <CalendarClock size={14} className="text-gray-400" />
        <span className="text-sm font-medium text-gray-700">Plazo de pago</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => onChange(null)}
          className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all
            ${sinPlazo ? 'bg-gray-800 border-gray-800 text-white' : 'bg-white border-gray-200 text-gray-600'}`}>
          Sin plazo
        </button>
        {mora.condiciones.map((c) => (
          <button key={c.id} type="button"
            onClick={() => onChange({
              condicion_id: c.id,
              plazo_dias: valor?.plazo_dias || mora.plazoDefault || 15,
            })}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all
              ${valor?.condicion_id === c.id ? 'bg-blue-600 border-blue-600 text-white'
                                             : 'bg-white border-gray-200 text-gray-600'}`}>
            {c.nombre}
          </button>
        ))}
      </div>
      {!sinPlazo && (
        <div className="flex items-center gap-2">
          <input type="number" min="1" max="365"
            value={valor.plazo_dias ?? ''}
            onChange={(e) => onChange({ ...valor, plazo_dias: e.target.value === '' ? '' : Number(e.target.value) })}
            className="w-20 px-2.5 py-1.5 bg-white border-0 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <span className="text-xs text-gray-500">
            días desde que el local lo reciba{cond ? ` · ${describirCondicion(cond)}` : ''}
          </span>
        </div>
      )}
      {ayuda && <p className="text-[11px] text-gray-400">{ayuda}</p>}
    </div>
  );
}

const TONO_PLAZO = {
  rojo:  'bg-red-50 text-red-700',
  ambar: 'bg-amber-50 text-amber-700',
  gris:  'bg-gray-100 text-gray-600',
  verde: 'bg-green-50 text-green-700',
};

export function ChipPlazo({ mora, enTransito = false }) {
  const e = estadoPlazo(mora, { enTransito });
  if (!e) return null;
  const Icono = e.tono === 'rojo' ? AlertTriangle : e.tono === 'verde' ? CheckCircle2 : CalendarClock;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium ${TONO_PLAZO[e.tono]}`}>
      <Icono size={11} /> {e.texto}
    </span>
  );
}
