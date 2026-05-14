import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { anularMovimiento } from '../../api/prestatarios.api';
import { formatCOP, formatFechaHora } from '../../utils/formatters';
import { Modal }  from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { AlertTriangle } from 'lucide-react';

const TIPO_LABEL = {
  entrega_producto: 'Entrega de producto',
  recibo_producto:  'Recibo de producto',
  pago_recibido:    'Pago recibido',
  pago_enviado:     'Pago enviado',
  ajuste_manual:    'Ajuste manual',
};

export function ModalAnularMovimiento({ prestatario, movimiento, onClose }) {
  const queryClient = useQueryClient();
  const [motivo, setMotivo] = useState('');
  const [error,  setError]  = useState('');

  const tieneInventario =
    (movimiento.tipo === 'entrega_producto' || movimiento.tipo === 'recibo_producto') &&
    (movimiento.imei || movimiento.producto_cantidad_id);

  const mutation = useMutation({
    mutationFn: () => anularMovimiento(prestatario.id, movimiento.id, motivo.trim() || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['movimientos-prestatario', prestatario.id], exact: false });
      queryClient.invalidateQueries({ queryKey: ['prestatarios'],       exact: false });
      queryClient.invalidateQueries({ queryKey: ['inventario'],         exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-serial'],   exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'], exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al anular'),
  });

  return (
    <Modal open onClose={onClose} title="Anular movimiento" size="sm">
      <div className="flex flex-col gap-4">

        <div className="flex flex-col items-center gap-3 py-2">
          <div className="w-14 h-14 rounded-full bg-red-50 border-2 border-red-200
            flex items-center justify-center">
            <AlertTriangle size={26} className="text-red-500" />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-gray-900">
              {TIPO_LABEL[movimiento.tipo] || movimiento.tipo}
            </p>
            <p className="text-xl font-bold text-red-600 mt-1">{formatCOP(movimiento.valor)}</p>
            <p className="text-xs text-gray-400 mt-0.5">{formatFechaHora(movimiento.fecha)}</p>
          </div>
        </div>

        {tieneInventario && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <p className="text-xs font-semibold text-amber-700 mb-1">Advertencia de inventario</p>
            <p className="text-xs text-amber-700 leading-relaxed">
              {movimiento.tipo === 'entrega_producto'
                ? 'El producto volverá a estar disponible en inventario (IMEI / stock revertido).'
                : 'El producto será removido del inventario si fue ingresado al registrar.'}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Motivo (opcional)</label>
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej: Error de digitación..."
            className="w-full px-3 py-2 bg-gray-100 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-red-300 transition-all"
            onKeyDown={(e) => { if (e.key === 'Enter') mutation.mutate(); }}
          />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button
            className="flex-1 bg-red-600 hover:bg-red-700 text-white"
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Anular movimiento
          </Button>
        </div>
      </div>
    </Modal>
  );
}
