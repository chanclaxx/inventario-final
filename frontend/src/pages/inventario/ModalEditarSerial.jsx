import { useState, useContext } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { actualizarSerial } from '../../api/productos.api';
import { getProveedores } from '../../api/proveedores.api';
import { Modal }   from '../../components/ui/Modal';
import { Input }   from '../../components/ui/Input';
import { Button }  from '../../components/ui/Button';
import { AuthContext } from '../../context/AuthContext';

/**
 * Props:
 *  - serial:         { id, imei, costo_compra, proveedor_id }
 *  - precioProducto: number | null  — precio actual del producto padre
 *  - productoId:     number
 *  - onClose:        () => void
 */
export function ModalEditarSerial({ serial, precioProducto, productoId, onClose }) {
  const { esAdminNegocio } = useContext(AuthContext);
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    imei:         serial.imei         || '',
    precio:       precioProducto      != null ? String(precioProducto)      : '',
    costo_compra: serial.costo_compra != null ? String(serial.costo_compra) : '',
    proveedor_id: serial.proveedor_id != null ? String(serial.proveedor_id) : '',
  });
  const [error, setError] = useState('');

  const { data: proveedoresData } = useQuery({
    queryKey: ['proveedores'],
    queryFn:  () => getProveedores().then((r) => r.data.data),
    enabled:  esAdminNegocio(),
  });

  const proveedores = proveedoresData || [];

  const mutation = useMutation({
    mutationFn: () => actualizarSerial(serial.id, {
      imei:         form.imei.trim(),
      precio:       form.precio       !== '' ? Number(form.precio)       : undefined,
      costo_compra: form.costo_compra !== '' ? Number(form.costo_compra) : null,
      proveedor_id: form.proveedor_id !== '' ? Number(form.proveedor_id) : null,
      producto_id:  productoId,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries(['seriales', productoId]);
      queryClient.invalidateQueries(['productos-serial']);
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

  if (!esAdminNegocio()) return null;

  return (
    <Modal open onClose={onClose} title="Editar serial" size="sm">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 bg-blue-50 rounded-xl px-3 py-2">
          <Pencil size={15} className="text-blue-500 flex-shrink-0" />
          <p className="text-xs text-blue-700">
            Edita el IMEI o costo de compra de este serial. El precio de venta aplica a todos los seriales del modelo.
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
          label="Precio de venta (aplica a todos los seriales del modelo)"
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
          onKeyDown={(e) => handleKeyDown(e, 'edit-proveedor-serial')}
        />

        {/* Selector de proveedor */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            Proveedor <span className="text-gray-400 font-normal">(opcional)</span>
          </label>
          <select
            id="edit-proveedor-serial"
            value={form.proveedor_id}
            onChange={(e) => setForm({ ...form, proveedor_id: e.target.value })}
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
          >
            <option value="">Sin proveedor</option>
            {proveedores.map((p) => {
              const nombre = p.nombre;
              return (
                <option key={p.id} value={p.id}>{nombre}</option>
              );
            })}
          </select>
        </div>

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