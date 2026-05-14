import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal }       from '../../components/ui/Modal';
import { Button }      from '../../components/ui/Button';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { formatCOP }   from '../../utils/formatters';
import { editarValorPrestamo } from '../../api/prestamos.api';

export function ModalEditarValorPrestamo({ open, onClose, mov, tipoApi, personaId }) {
  const queryClient = useQueryClient();
  const [nuevoValor, setNuevoValor] = useState(mov?.cargo ?? '');
  const [error,      setError]      = useState('');

  const mutation = useMutation({
    mutationFn: (valor) => editarValorPrestamo(mov.referencia_id, valor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estado-cuenta', tipoApi, personaId] });
      queryClient.invalidateQueries({ queryKey: ['prestamos'], exact: false });
      onClose();
    },
    onError: (err) => {
      setError(err.response?.data?.error || 'Error al actualizar el valor');
    },
  });

  const handleSubmit = () => {
    setError('');
    if (!nuevoValor || Number(nuevoValor) <= 0) {
      setError('El valor debe ser mayor a 0');
      return;
    }
    mutation.mutate(Number(nuevoValor));
  };

  return (
    <Modal open={open} onClose={onClose} title="Editar valor del préstamo" size="sm">
      <div className="flex flex-col gap-4">

        {/* Info del préstamo */}
        <div className="bg-gray-50 rounded-xl px-3 py-2.5">
          <p className="text-xs text-gray-500 truncate">{mov?.concepto}</p>
          <p className="text-sm text-gray-400 mt-0.5">
            Valor actual:{' '}
            <span className="font-semibold text-gray-700">{formatCOP(mov?.cargo)}</span>
          </p>
        </div>

        {/* Input nuevo valor */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Nuevo valor
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
            <InputMoneda
              value={nuevoValor}
              onChange={setNuevoValor}
              autoFocus
              className="w-full pl-7 pr-3 py-2.5 bg-white border border-gray-200 rounded-xl
                text-sm font-semibold text-gray-800
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <p className="text-[11px] text-gray-400">
            No puede ser menor al total ya abonado.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            className="flex-1"
            loading={mutation.isPending}
            onClick={handleSubmit}
            disabled={!nuevoValor || Number(nuevoValor) <= 0}
          >
            Guardar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
