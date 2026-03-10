import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { actualizarSerial } from '../../api/productos.api';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';

/**
 * Modal para editar un serial individual (IMEI + costo de compra).
 * Se abre con doble click en la fila del serial.
 *
 * Props:
 *  - serial:          { id, imei, costo_compra }
 *  - productoId:      number  — para invalidar la query correcta
 *  - onClose:         () => void
 */
export function ModalEditarSerial({ serial, productoId, onClose }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    imei:         serial.imei        || '',
    costo_compra: serial.costo_compra != null ? String(serial.costo_compra) : '',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => actualizarSerial(serial.id, {
      imei:         form.imei.trim(),
      costo_compra: form.costo_compra !== '' ? Number(form.costo_compra) : null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries(['seriales', productoId]);
      onClose();
    },
    onError: (err) => {
      setError(err.response?.data?.error || 'Error al actualizar el serial');
    },
  });

  const handleKeyDown = (e, siguienteId) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (siguienteId) document.getElementById(siguienteId)?.focus();
      else mutation.mutate();
    }
  };

  return (
    <Modal open onClose={onClose} title="Editar serial" size="sm">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 bg-blue-50 rounded-xl px-3 py-2">
          <Pencil size={15} className="text-blue-500 flex-shrink-0" />
          <p className="text-xs text-blue-700">
            Edita el IMEI o el costo de compra del serial seleccionado.
          </p>
        </div>

        <Input
          id="edit-imei"
          label="IMEI / Serial"
          placeholder="Ej: 356789012345678"
          value={form.imei}
          onChange={(e) => setForm({ ...form, imei: e.target.value })}
          onKeyDown={(e) => handleKeyDown(e, 'edit-costo')}
          autoFocus
        />

        <Input
          id="edit-costo"
          label="Costo de compra (opcional)"
          type="number"
          placeholder="0"
          value={form.costo_compra}
          onChange={(e) => setForm({ ...form, costo_compra: e.target.value })}
          onKeyDown={(e) => handleKeyDown(e, null)}
        />

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            className="flex-1"
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
            disabled={!form.imei.trim()}
          >
            Guardar
          </Button>
        </div>
      </div>
    </Modal>
  );
}