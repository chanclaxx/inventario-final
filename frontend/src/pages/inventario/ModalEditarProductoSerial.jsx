import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { actualizarProductoSerial } from '../../api/productos.api';
import { getLineas }                from '../../api/productos.api';
import { Modal }   from '../../components/ui/Modal';
import { Input }   from '../../components/ui/Input';
import { Button }  from '../../components/ui/Button';
import { useAuth } from '../../context/useAuth';

export function ModalEditarProductoSerial({ producto, onClose }) {
  const { esAdminNegocio } = useAuth();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    nombre:   producto.nombre  || '',
    precio:   producto.precio  != null ? String(producto.precio) : '',
    linea_id: producto.linea_id != null ? String(producto.linea_id) : '',
  });
  const [error, setError] = useState('');

  const { data: lineasData } = useQuery({
    queryKey: ['lineas'],
    queryFn:  () => getLineas().then((r) => r.data.data),
    enabled:  esAdminNegocio(),
  });
  const lineas = lineasData || [];

  const mutation = useMutation({
    mutationFn: () => actualizarProductoSerial(producto.id, {
      nombre:   form.nombre.trim(),
      precio:   form.precio   !== '' ? Number(form.precio)   : null,
      linea_id: form.linea_id !== '' ? Number(form.linea_id) : null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productos-serial'], exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al actualizar el producto'),
  });

  if (!esAdminNegocio()) return null;

  return (
    <Modal open onClose={onClose} title="Editar producto" size="sm">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 bg-blue-50 rounded-xl px-3 py-2">
          <Pencil size={15} className="text-blue-500 flex-shrink-0" />
          <p className="text-xs text-blue-700">
            Edita el nombre, línea y precio de venta del producto.
          </p>
        </div>

        <Input
          label="Nombre"
          placeholder="Ej: iPhone 15 Pro"
          value={form.nombre}
          onChange={(e) => setForm({ ...form, nombre: e.target.value })}
          autoFocus
        />

        <Input
          label="Precio de venta"
          type="number"
          min="0"
          placeholder="0"
          value={form.precio}
          onChange={(e) => setForm({ ...form, precio: e.target.value })}
        />

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Línea</label>
          <select
            value={form.linea_id}
            onChange={(e) => setForm({ ...form, linea_id: e.target.value })}
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
          >
            <option value="">Sin línea</option>
            {lineas.map((l) => (
              <option key={l.id} value={l.id}>{l.nombre}</option>
            ))}
          </select>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button
            className="flex-1"
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
            disabled={!form.nombre.trim()}
          >
            Guardar
          </Button>
        </div>
      </div>
    </Modal>
  );
}