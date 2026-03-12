import { useState, useContext } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { actualizarProductoCantidad } from '../../api/productos.api';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { AuthContext } from '../../context/AuthContext';

/**
 * Modal para editar un producto por cantidad (nombre, unidad, stock mínimo, precio, costo).
 * Solo accesible para admin_negocio.
 *
 * Props:
 *  - producto: { id, nombre, unidad_medida, stock_minimo, precio, costo_unitario }
 *  - onClose:  () => void
 */
export function ModalEditarProductoCantidad({ producto, onClose }) {
  const { esAdminNegocio } = useContext(AuthContext);
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    nombre:         producto.nombre         || '',
    unidad_medida:  producto.unidad_medida  || 'unidad',
    stock_minimo:   producto.stock_minimo   != null ? String(producto.stock_minimo)   : '0',
    precio:         producto.precio         != null ? String(producto.precio)         : '',
    costo_unitario: producto.costo_unitario != null ? String(producto.costo_unitario) : '',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => actualizarProductoCantidad(producto.id, {
      nombre:         form.nombre.trim(),
      unidad_medida:  form.unidad_medida.trim() || 'unidad',
      stock_minimo:   Number(form.stock_minimo)  || 0,
      precio:         form.precio         !== '' ? Number(form.precio)         : null,
      costo_unitario: form.costo_unitario !== '' ? Number(form.costo_unitario) : null,
      proveedor_id:   producto.proveedor_id || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries(['productos-cantidad']);
      onClose();
    },
    onError: (err) => {
      setError(err.response?.data?.error || 'Error al actualizar el producto');
    },
  });

  const handleKeyDown = (e, siguienteId) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (siguienteId) document.getElementById(siguienteId)?.focus();
      else mutation.mutate();
    }
  };

  // Guarda de seguridad: el padre ya bloquea el doble click,
  // pero el modal se defiende por su cuenta también.
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
            type="number"
            min="0"
            placeholder="0"
            value={form.stock_minimo}
            onChange={(e) => setForm({ ...form, stock_minimo: e.target.value })}
            onKeyDown={(e) => handleKeyDown(e, 'edit-precio-cant')}
          />
          <Input
            id="edit-precio-cant"
            label="Precio de venta"
            type="number"
            min="0"
            placeholder="0"
            value={form.precio}
            onChange={(e) => setForm({ ...form, precio: e.target.value })}
            onKeyDown={(e) => handleKeyDown(e, 'edit-costo-cant')}
          />
        </div>

        <Input
          id="edit-costo-cant"
          label="Costo unitario"
          type="number"
          min="0"
          placeholder="0"
          value={form.costo_unitario}
          onChange={(e) => setForm({ ...form, costo_unitario: e.target.value })}
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
            disabled={!form.nombre.trim()}
          >
            Guardar
          </Button>
        </div>
      </div>
    </Modal>
  );
}