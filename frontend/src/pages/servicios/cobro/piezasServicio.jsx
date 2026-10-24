import { useTecnicosServicio } from './tecnicosServicio';
import { useMetodosPago } from '../../../hooks/useMetodosPago';
import { HardHat } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Piezas compartidas por los modales de Servicios para cobrar y para decir
// quién reparó. La regla de la plata vive en utils/servicioCobro.js (espejo del
// backend); aquí solo se pinta.
// ─────────────────────────────────────────────────────────────────────────────

/** Chips de método de pago (los del negocio). */
export function SelectorMetodo({ value, onChange, label = 'Método' }) {
  const metodosPago = useMetodosPago();
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-sm font-medium text-gray-700">{label}</label>}
      <div className="flex gap-2 flex-wrap">
        {metodosPago.map((m) => {
          const mId = m.id;
          return (
            <button key={mId} type="button" onClick={() => onChange(mId)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all
                ${value === mId ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'}`}>
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Selector del técnico interno. No pinta nada si el negocio no encendió la
 * lista. `externo` = el técnico de afuera que ya lo reparó (se informa).
 */
export function SelectorTecnico({ value, onChange, requerido = false, externo = null, label }) {
  const { activa, tecnicos } = useTecnicosServicio();
  if (!activa) return null;
  const titulo = label || (requerido ? '¿Quién lo reparó?' : 'Técnico asignado');
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
        <HardHat size={13} className="text-gray-400" />
        {titulo}{requerido && !externo ? ' *' : ''}
        {!requerido && <span className="text-gray-400 font-normal">(opcional)</span>}
      </label>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-700
          focus:outline-none focus:ring-2 focus:ring-blue-500">
        <option value="">{requerido ? (externo ? 'El técnico externo' : 'Elige el técnico') : 'Sin asignar'}</option>
        {tecnicos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
      </select>
      {externo && (
        <p className="text-xs text-gray-400">Lo reparó el técnico externo {externo}.</p>
      )}
      {!tecnicos.length && (
        <p className="text-xs text-amber-600">No hay técnicos activos. Agrégalos en Ajustes → Catálogo → Técnicos.</p>
      )}
    </div>
  );
}
