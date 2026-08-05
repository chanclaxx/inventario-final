import { CreditCard } from 'lucide-react';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { formatCOP }   from '../../utils/formatters';
import { SelectorPlazo } from '../../components/ui/SelectorPlazo';
import { SelectorInteres } from '../../components/ui/SelectorInteres';

// ── Estado inicial — usar en ModalFactura con useState ───────────────────────
export const CREDITO_VACIO = () => ({
  activo:        false,
  cuota_inicial: '',
  // Plazo de pago (feature opt-in `mora_activa`). Vacíos = sin plazo = sin mora.
  fecha_limite:  '',
  condicion_id:  '',
  // Plan de interés (feature opt-in `interes_activa`), INDEPENDIENTE del plazo:
  // se puede financiar sin fecha límite y poner fecha límite sin cobrar interés.
  interes_plan_id: '',
});

// ── Componente ───────────────────────────────────────────────────────────────
// `configMora`/`configInteres` son lo que devuelven useMora() y useInteres(); si
// una feature está apagada su selector no se renderiza y esta sección queda
// igual que antes.
export function SeccionCredito({ credito, totalNeto, onChange, disabled, configMora, configInteres }) {
  const cuotaInicial  = Number(credito.cuota_inicial || 0);
  const saldoACredito = Math.max(0, totalNeto - cuotaInicial);

  const set = (campo, valor) => onChange({ ...credito, [campo]: valor });

  return (
    <div className="flex flex-col gap-2">
      {/* Toggle */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange({ ...CREDITO_VACIO(), activo: !credito.activo })}
        className={`w-full flex items-center gap-2 py-2.5 rounded-xl text-sm font-medium
          border transition-all
          ${disabled
            ? 'bg-gray-50 border-gray-200 text-gray-300 cursor-not-allowed'
            : credito.activo
              ? 'bg-yellow-50 border-yellow-300 text-yellow-700'
              : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'}`}
      >
        <CreditCard size={15} className="ml-3" />
        {disabled
          ? 'Crédito no disponible'
          : credito.activo ? '✓ Venta a crédito' : '+ Venta a crédito'}
      </button>

      {/* Panel detalle */}
      {credito.activo && (
        <div className="flex flex-col gap-3 p-3 bg-yellow-50 rounded-xl border border-yellow-100">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">
              Cuota inicial <span className="text-gray-400 font-normal">(opcional)</span>
            </label>
            <InputMoneda
              value={credito.cuota_inicial}
              onChange={(val) => set('cuota_inicial', val)}
              placeholder="0"
              className="w-full px-3 py-2 bg-white border border-yellow-200 rounded-xl
                text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 transition-all"
            />
          </div>

          {/* Resumen */}
          <div className="flex flex-col gap-1.5 bg-white rounded-xl border border-yellow-100 p-3">
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Total de la venta</span>
              <span className="font-medium text-gray-700">{formatCOP(totalNeto)}</span>
            </div>

            {cuotaInicial > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-green-600">Cuota inicial</span>
                <span className="font-medium text-green-600">- {formatCOP(cuotaInicial)}</span>
              </div>
            )}

            <div className="flex justify-between text-sm border-t border-yellow-100 pt-1.5 mt-0.5">
              <span className="font-medium text-yellow-700">Saldo a crédito</span>
              <span className="font-bold text-yellow-700">{formatCOP(saldoACredito)}</span>
            </div>
          </div>

          {/* Plazo de pago y mora (solo si el negocio activó la feature) */}
          <SelectorPlazo
            config={configMora}
            fechaLimite={credito.fecha_limite}
            condicionId={credito.condicion_id}
            onChange={({ fecha_limite, condicion_id }) =>
              onChange({ ...credito, fecha_limite, condicion_id })}
            titulo="Fecha límite de pago"
          />

          {/* Interés por financiar (independiente del plazo) */}
          <SelectorInteres
            config={configInteres}
            planId={credito.interes_plan_id}
            onChange={(interes_plan_id) => onChange({ ...credito, interes_plan_id })}
            valorBase={saldoACredito}
          />

          {cuotaInicial > totalNeto && totalNeto > 0 && (
            <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-1.5">
              La cuota inicial no puede superar el total de la venta.
            </p>
          )}
        </div>
      )}
    </div>
  );
}