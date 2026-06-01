import { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal }       from '../../components/ui/Modal';
import { Button }      from '../../components/ui/Button';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { formatCOP }   from '../../utils/formatters';
import { registrarAbonoTotal, modificarAbonoTotal } from '../../api/prestamos.api';
import { useMetodosPago } from '../../hooks/useMetodosPago';
import { CheckCircle, ArrowRight } from 'lucide-react';

// Simula la distribución FIFO igual que el backend
function simularDistribucion(prestamosActivos, valorTotal) {
  let remaining = valorTotal;
  return prestamosActivos
    .filter((p) => p.estado === 'Activo')
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
    .map((p) => {
      const saldo = Number(p.valor_prestamo) - Number(p.total_abonado);
      if (saldo <= 0 || remaining <= 0) return null;
      const abono   = Math.min(remaining, saldo);
      remaining    -= abono;
      const saldado = abono >= saldo;
      return { prestamo: p, abono, saldo, saldado };
    })
    .filter(Boolean);
}

// ─── ModalAbonoTotal ──────────────────────────────────────────────────────────
// mode: 'crear' | 'editar'
// Si mode='editar' se requieren: abonoTotalId, valorActual, metodoActual

export function ModalAbonoTotal({ nombre, tipo, personaId, prestamos, onClose, mode = 'crear', abonoTotalId, valorActual = '', metodoActual = 'Efectivo' }) {
  const queryClient = useQueryClient();
  const metodosPago = useMetodosPago();

  const [valor,  setValor]  = useState(mode === 'editar' ? String(valorActual) : '');
  const [metodo, setMetodo] = useState(mode === 'editar' ? metodoActual : 'Efectivo');
  const [error,  setError]  = useState('');

  // Préstamos activos en orden FIFO (más antiguo primero)
  const prestamosActivos = useMemo(
    () =>
      [...prestamos]
        .filter((p) => p.estado === 'Activo')
        .sort((a, b) => new Date(a.fecha) - new Date(b.fecha)),
    [prestamos]
  );

  const totalPendiente = prestamosActivos.reduce(
    (s, p) => s + Number(p.valor_prestamo) - Number(p.total_abonado), 0
  );

  const valorNum    = Number(valor) || 0;
  const distribucion = valorNum > 0 ? simularDistribucion(prestamosActivos, valorNum) : [];

  const tipoApi = tipo === 'companero' ? 'prestatario' : 'cliente';

  const mutation = useMutation({
    mutationFn: () =>
      mode === 'crear'
        ? registrarAbonoTotal(tipoApi, personaId, valorNum, metodo)
        : modificarAbonoTotal(abonoTotalId, valorNum, metodo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prestamos'],    exact: false });
      queryClient.invalidateQueries({ queryKey: ['facturas'],     exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al registrar el abono total'),
  });

  const handleConfirmar = () => {
    setError('');
    if (!valorNum || valorNum <= 0) return setError('El valor debe ser mayor a 0');
    if (mode === 'crear' && valorNum > totalPendiente)
      return setError(`El valor supera el saldo total pendiente (${formatCOP(totalPendiente)})`);
    if (mode === 'editar' && valorNum >= Number(valorActual))
      return setError(`Solo puedes disminuir el valor. El pago actual es ${formatCOP(valorActual)}`);
    mutation.mutate();
  };

  return (
    <Modal open onClose={onClose} title={mode === 'crear' ? 'Abono total' : 'Modificar abono total'} size="md">
      <div className="flex flex-col gap-4">

        {/* Persona + saldo total */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-blue-500">Persona</p>
            <p className="text-sm font-semibold text-blue-900">{nombre}</p>
          </div>
          {mode === 'crear' && (
            <div className="text-right">
              <p className="text-xs text-blue-500">Saldo total pendiente</p>
              <p className="text-base font-bold text-red-500">{formatCOP(totalPendiente)}</p>
            </div>
          )}
          {mode === 'editar' && (
            <div className="text-right">
              <p className="text-xs text-blue-500">Pago actual</p>
              <p className="text-base font-bold text-indigo-600">{formatCOP(valorActual)}</p>
            </div>
          )}
        </div>

        {/* Info de funcionamiento */}
        <p className="text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-2">
          El pago se distribuye automáticamente desde el préstamo más antiguo al más reciente.
        </p>

        {/* Valor */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Valor del pago total</label>
          <InputMoneda
            value={valor}
            onChange={setValor}
            placeholder="0"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleConfirmar()}
            className="w-full px-3 py-2 bg-gray-100 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
          />
        </div>

        {/* Método */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Método de pago</label>
          <div className="flex flex-wrap gap-2">
            {metodosPago.map((m) => (
              <button key={m.id} type="button" onClick={() => setMetodo(m.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all
                  ${metodo === m.id
                    ? 'bg-blue-50 border-blue-300 text-blue-700'
                    : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Preview de distribución — solo en modo crear */}
        {mode === 'editar' && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-xs text-amber-700">
            Solo puedes <strong>reducir</strong> el valor del pago. El nuevo valor debe ser menor a {formatCOP(valorActual)}.
            {valorNum > 0 && valorNum < Number(valorActual) && (
              <span className="block mt-1 text-indigo-700">
                El sistema redistribuirá <strong>{formatCOP(valorNum)}</strong> desde el préstamo más antiguo al más reciente.
              </span>
            )}
          </div>
        )}

        {mode === 'crear' && distribucion.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Distribución del pago
            </p>
            <div className="flex flex-col gap-1 max-h-52 overflow-y-auto">
              {distribucion.map(({ prestamo, abono, saldo, saldado }) => (
                <div key={prestamo.id}
                  className={`flex items-center justify-between px-3 py-2 rounded-xl text-sm
                    ${saldado ? 'bg-green-50 border border-green-100' : 'bg-gray-50 border border-gray-100'}`}>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-800 truncate">{prestamo.nombre_producto}</p>
                    <p className="text-xs text-gray-400">
                      Saldo pendiente: {formatCOP(saldo)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                    <span className="text-green-600 font-semibold text-xs">
                      <ArrowRight size={11} className="inline" /> {formatCOP(abono)}
                    </span>
                    {saldado && (
                      <span className="flex items-center gap-0.5 text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                        <CheckCircle size={10} /> Saldado
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Resumen */}
            <div className="flex justify-between text-xs text-gray-500 pt-1 border-t border-gray-100 mt-1">
              <span>Total a pagar</span>
              <span className="font-semibold text-blue-700">{formatCOP(valorNum)}</span>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button
            className="flex-1"
            loading={mutation.isPending}
            onClick={handleConfirmar}
            disabled={!valorNum || valorNum <= 0}
          >
            {mode === 'crear' ? 'Registrar pago total' : 'Guardar cambios'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
