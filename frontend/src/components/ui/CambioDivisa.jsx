import { InputMoneda } from './InputMoneda';
import { formatCOP } from '../../utils/formatters';
import { recalcularCambio } from '../../utils/cambioDivisa';

// ─────────────────────────────────────────────────────────────────────────────
// CambioDivisa
//
// Captura una operación que cruza pesos ⇄ dólares con DOS modos válidos:
//   • "Por tasa" (predeterminado): el usuario escribe los dólares y la tasa
//     (pesos por dólar); los pesos se calculan solos.
//   • "Por montos": el usuario escribe dólares y pesos; la tasa se calcula sola.
//
// Siempre expone el trío completo { dolares, pesos, tasa } para que el llamador
// solo tenga que leer el resultado. La lógica pura vive en utils/cambioDivisa.js
// (cambioInicial, recalcularCambio, cambioCompleto).
// ─────────────────────────────────────────────────────────────────────────────

const formatTasa = (t) => Number(t).toLocaleString('es-CO', { maximumFractionDigits: 2 });

export function CambioDivisa({
  estado,
  onChange,
  labelDolares = '¿Cuántos dólares?',
  labelPesos   = '¿Cuántos pesos?',
  tasaSugerida = null,       // muestra un chip "usar tasa de hoy: X"
  autoFocus    = false,
}) {
  const { modo, dolares, pesos, tasa } = estado;

  const set    = (campo, val) => onChange(recalcularCambio(estado, campo, val));
  const setModo = (m) => onChange(recalcularCambio({ ...estado, modo: m }, 'modo', m));

  const inputBase = `w-full mt-1 border border-gray-200 rounded-xl px-3 py-2.5 text-lg font-semibold
    focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300`;

  return (
    <div className="flex flex-col gap-3">
      {/* Toggle de modo */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {[['tasa', 'Por tasa'], ['montos', 'Por montos']].map(([m, lbl]) => (
          <button key={m} type="button" onClick={() => setModo(m)}
            className={`flex-1 text-xs font-medium px-3 py-2 rounded-lg transition-colors
              ${modo === m ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}>
            {lbl}{m === 'tasa' ? ' ⭐' : ''}
          </button>
        ))}
      </div>

      {/* Dólares — siempre presente */}
      <div>
        <label className="text-xs font-semibold text-gray-500">{labelDolares}</label>
        <input type="number" min="0" step="0.01" inputMode="decimal" placeholder="0"
          value={dolares} autoFocus={autoFocus}
          onChange={(e) => set('dolares', e.target.value === '' ? '' : Number(e.target.value))}
          className={inputBase} />
      </div>

      {modo === 'tasa' ? (
        <>
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-gray-500">Tasa (pesos por dólar)</label>
              {tasaSugerida > 0 && Number(tasa) !== Number(tasaSugerida) && (
                <button type="button" onClick={() => set('tasa', Number(tasaSugerida))}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                  Usar tasa de hoy: {formatTasa(tasaSugerida)}
                </button>
              )}
            </div>
            <input type="number" min="0" step="0.01" inputMode="decimal" placeholder="0"
              value={tasa}
              onChange={(e) => set('tasa', e.target.value === '' ? '' : Number(e.target.value))}
              className={inputBase} />
          </div>
          <div className="text-sm bg-gray-50 rounded-xl p-3 flex justify-between">
            <span className="text-gray-500">Son en pesos</span>
            <span className="font-bold text-gray-800">{pesos > 0 ? formatCOP(pesos) : '—'}</span>
          </div>
        </>
      ) : (
        <>
          <div>
            <label className="text-xs font-semibold text-gray-500">{labelPesos}</label>
            <InputMoneda value={pesos} onChange={(v) => set('pesos', v)} className={inputBase} />
          </div>
          <div className="text-sm bg-gray-50 rounded-xl p-3 flex justify-between">
            <span className="text-gray-500">Tasa (pesos por dólar)</span>
            <span className="font-bold text-gray-800">{tasa > 0 ? formatTasa(tasa) : '—'}</span>
          </div>
        </>
      )}
    </div>
  );
}
