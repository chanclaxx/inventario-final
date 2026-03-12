import { useState, useContext } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { actualizarSerial } from '../../api/productos.api';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { AuthContext } from '../../context/AuthContext';

/**
 * Modal para editar un serial individual (IMEI, precio de venta, costo de compra).
 * Solo accesible para admin_negocio.
 *
 * Props:
 *  - serial:     { id, imei, costo_compra, precio }
 *  - productoId: number
 *  - onClose:    () => void
 */
export function ModalEditarSerial({ serial, productoId, onClose }) {
  const { esAdminNegocio } = useContext(AuthContext);
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    imei:         serial.imei         || '',
    precio:       serial.precio       != null ? String(serial.precio)       : '',
    costo_compra: serial.costo_compra != null ? String(serial.costo_compra) : '',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
  mutationFn: () => actualizarSerial(serial.id, {
    imei:         form.imei.trim(),
    precio:       form.precio       !== '' ? Number(form.precio)       : undefined,
    costo_compra: form.costo_compra !== '' ? Number(form.costo_compra) : null,
    producto_id:  productoId,
  }),
  onSuccess: () => {
    queryClient.invalidateQueries(['seriales', productoId]);
    queryClient.invalidateQueries(['productos-serial']); // refresca precio en la lista
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

  // Guarda de seguridad: aunque el padre ya bloquea el doble click,
  // el modal no se renderiza si el usuario no es admin.
  if (!esAdminNegocio()) return null;

  return (
    <Modal open onClose={onClose} title="Editar serial" size="sm">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 bg-blue-50 rounded-xl px-3 py-2">
          <Pencil size={15} className="text-blue-500 flex-shrink-0" />
          <p className="text-xs text-blue-700">
            Edita el IMEI, precio de venta o costo de compra del serial seleccionado.
          </p>
        </div>

        <Input
          id="edit-imei"
          label="IMEI / Serial"
          placeholder="Ej: 356789012345678"
          value={form.imei}
          onChange={(e) => setForm({ ...form, imei: e.target.value })}
          onKeyDown={(e) => handleKeyDown(e, 'edit-precio-serial')}
          autoFocus
        />

        <Input
          id="edit-precio-serial"
          label="Precio de venta"
          type="number"
          min="0"
          placeholder="0"
          value={form.precio}
          onChange={(e) => setForm({ ...form, precio: e.target.value })}
          onKeyDown={(e) => handleKeyDown(e, 'edit-costo-serial')}
        />

        <Input
          id="edit-costo-serial"
          label="Costo de compra (opcional)"
          type="number"
          min="0"
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