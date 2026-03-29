import { CreditCard } from 'lucide-react';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { formatCOP }   from '../../utils/formatters';

// ── Estado inicial — usar en ModalFactura con useState ───────────────────────
export const CREDITO_VACIO = () => ({
  activo:        false,
  cuota_inicial: '',
});

// ── Componente ───────────────────────────────────────────────────────────────
export function SeccionCredito({ credito, totalNeto, onChange, disabled }) {
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