import { useMutation, useQueryClient } from '@tanstack/react-query';
import { aplicarSaldoActivos } from '../../api/prestamos.api';
import { formatCOP }           from '../../utils/formatters';
import { Button }              from '../../components/ui/Button';
import { Modal }               from '../../components/ui/Modal';
import { Wallet, CheckCircle } from 'lucide-react';

function calcularDistribucion(prestamosActivos, saldoAFavor) {
  let restante = saldoAFavor;
  return prestamosActivos.map((p) => {
    const pendiente = Number(p.saldo_pendiente ?? (p.valor_prestamo - p.total_abonado));
    const abono     = Math.min(restante, pendiente);
    restante        = Math.max(0, restante - abono);
    return { ...p, abono_preview: abono, quedara_saldado: abono >= pendiente };
  });
}

export function ModalAplicarSaldo({ persona, saldoAFavor, prestamosActivos, onClose, onSuccess }) {
  const queryClient = useQueryClient();

  const tipoApi = persona.tipo === 'companero' ? 'prestatario' : persona.tipo;

  const distribucion   = calcularDistribucion(prestamosActivos, saldoAFavor);
  const totalAplicar   = distribucion.reduce((s, p) => s + p.abono_preview, 0);
  const saldoRestante  = Math.max(0, saldoAFavor - totalAplicar);

  const mutation = useMutation({
    mutationFn: () => aplicarSaldoActivos(tipoApi, persona.id),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['prestamos'], exact: false });
      onSuccess(res.data?.data);
    },
    onError: (err) => {
      alert(err.response?.data?.error || 'Error al aplicar el saldo');
    },
  });

  return (
    <Modal open onClose={onClose} title="Aplicar saldo a préstamos activos" size="md">
      <div className="flex flex-col gap-4">

        {/* Encabezado persona + saldo */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-emerald-600">Saldo a favor de</p>
            <p className="text-sm font-semibold text-emerald-900">{persona.nombre}</p>
          </div>
          <div className="flex items-center gap-2">
            <Wallet size={16} className="text-emerald-600" />
            <span className="text-lg font-bold text-emerald-700">{formatCOP(saldoAFavor)}</span>
          </div>
        </div>

        {/* Vista previa de distribución FIFO */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Distribución (préstamos más antiguos primero)
          </p>
          {distribucion.map((p) => (
            <div key={p.id}
              className={`rounded-xl border p-3 flex flex-col gap-1.5
                ${p.abono_preview > 0 ? 'border-emerald-200 bg-emerald-50/50' : 'border-gray-100 bg-gray-50'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{p.nombre_producto}</p>
                  {p.imei && <p className="text-xs text-gray-400 font-mono">{p.imei}</p>}
                </div>
                {p.quedara_saldado && p.abono_preview > 0 && (
                  <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium flex-shrink-0">
                    <CheckCircle size={12} /> Saldado
                  </span>
                )}
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>Pendiente:</span>
                <span className="font-medium text-red-500">
                  {formatCOP(Number(p.saldo_pendiente ?? (p.valor_prestamo - p.total_abonado)))}
                </span>
              </div>
              {p.abono_preview > 0 && (
                <div className="flex justify-between text-xs font-semibold text-emerald-700">
                  <span>Abono a aplicar:</span>
                  <span>− {formatCOP(p.abono_preview)}</span>
                </div>
              )}
              {p.abono_preview === 0 && (
                <p className="text-xs text-gray-400">Sin saldo suficiente para este préstamo</p>
              )}
            </div>
          ))}
        </div>

        {/* Resumen final */}
        <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-1.5">
          <div className="flex justify-between text-xs text-gray-500">
            <span>Total a aplicar:</span>
            <span className="font-medium text-emerald-700">− {formatCOP(totalAplicar)}</span>
          </div>
          <div className="flex justify-between text-sm font-semibold border-t border-gray-200 pt-1.5 mt-0.5">
            <span>Saldo restante después:</span>
            <span className={saldoRestante > 0 ? 'text-emerald-600' : 'text-gray-500'}>
              {formatCOP(saldoRestante)}
            </span>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button
            className="flex-1 bg-emerald-600 hover:bg-emerald-700"
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
            disabled={totalAplicar <= 0}>
            <Wallet size={14} /> Aplicar {formatCOP(totalAplicar)}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
