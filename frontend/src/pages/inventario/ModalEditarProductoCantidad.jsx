import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { actualizarProductoCantidad } from '../../api/productos.api';
import { getProveedores }             from '../../api/proveedores.api';
import { getLineas }                  from '../../api/productos.api';
import { Modal }   from '../../components/ui/Modal';
import { Input }   from '../../components/ui/Input';
import { Button }  from '../../components/ui/Button';
import { useAuth } from '../../context/useAuth';

export function ModalEditarProductoCantidad({ producto, onClose }) {
  const { esAdminNegocio } = useAuth();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    nombre        : producto.nombre         || '',
    unidad_medida : producto.unidad_medida  || 'unidad',
    stock_minimo  : producto.stock_minimo   != null ? String(producto.stock_minimo)   : '0',
    precio        : producto.precio         != null ? String(producto.precio)         : '',
    costo_unitario: producto.costo_unitario != null ? String(producto.costo_unitario) : '',
    proveedor_id  : producto.proveedor_id   != null ? String(producto.proveedor_id)   : '',
    linea_id      : producto.linea_id       != null ? String(producto.linea_id)       : '',
  });
  const [error, setError] = useState('');

  const { data: proveedoresData } = useQuery({
    queryKey: ['proveedores'],
    queryFn:  () => getProveedores().then((r) => r.data.data),
    enabled:  esAdminNegocio(),
  });

  const { data: lineasData } = useQuery({
    queryKey: ['lineas'],
    queryFn:  () => getLineas().then((r) => r.data.data),
    enabled:  esAdminNegocio(),
  });

  const proveedores = proveedoresData || [];
  const lineas      = lineasData      || [];

  const mutation = useMutation({
    mutationFn: () => actualizarProductoCantidad(producto.id, {
      nombre        : form.nombre.trim(),
      unidad_medida : form.unidad_medida.trim() || 'unidad',
      stock_minimo  : Number(form.stock_minimo)  || 0,
      precio        : form.precio         !== '' ? Number(form.precio)         : null,
      costo_unitario: form.costo_unitario !== '' ? Number(form.costo_unitario) : null,
      proveedor_id  : form.proveedor_id   !== '' ? Number(form.proveedor_id)   : null,
      linea_id      : form.linea_id       !== '' ? Number(form.linea_id)       : null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'], exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al actualizar el producto'),
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
    <Modal open onClose={onClose} title="Editar producto" size="sm">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 bg-blue-50 rounded-xl px-3 py-2">
          <Pencil size={15} className="text-blue-500 flex-shrink-0" />
          <p className="text-xs text-blue-700">
            Edita los datos del producto. El stock se ajusta desde el botón de reducir stock.
          </p>
        </div>

        <Input
          id="edit-nombre-cant"
          label="Nombre"
          placeholder="Ej: Cable USB-C"
          value={form.nombre}
          onChange={(e) => setForm({ ...form, nombre: e.target.value })}
          onKeyDown={(e) => handleKeyDown(e, 'edit-unidad-cant')}
          autoFocus
        />

        <Input
          id="edit-unidad-cant"
          label="Unidad de medida"
          placeholder="Ej: unidad, caja, metro"
          value={form.unidad_medida}
          onChange={(e) => setForm({ ...form, unidad_medida: e.target.value })}
          onKeyDown={(e) => handleKeyDown(e, 'edit-stock-min-cant')}
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            id="edit-stock-min-cant"
            label="Stock mínimo"
            type="number" min="0" placeholder="0"
            value={form.stock_minimo}
            onChange={(e) => setForm({ ...form, stock_minimo: e.target.value })}
            onKeyDown={(e) => handleKeyDown(e, 'edit-precio-cant')}
          />
          <Input
            id="edit-precio-cant"
            label="Precio de venta"
            type="number" min="0" placeholder="0"
            value={form.precio}
            onChange={(e) => setForm({ ...form, precio: e.target.value })}
            onKeyDown={(e) => handleKeyDown(e, 'edit-costo-cant')}
          />
        </div>

        <Input
          id="edit-costo-cant"
          label="Costo unitario"
          type="number" min="0" placeholder="0"
          value={form.costo_unitario}
          onChange={(e) => setForm({ ...form, costo_unitario: e.target.value })}
          onKeyDown={(e) => handleKeyDown(e, 'edit-proveedor-cant')}
        />

        {/* Línea */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Línea</label>
          <select
            id="edit-linea-cant"
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

        {/* Proveedor */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            Proveedor <span className="text-gray-400 font-normal">(opcional)</span>
          </label>
          <select
            id="edit-proveedor-cant"
            value={form.proveedor_id}
            onChange={(e) => setForm({ ...form, proveedor_id: e.target.value })}
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
          >
            <option value="">Sin proveedor</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre}</option>
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