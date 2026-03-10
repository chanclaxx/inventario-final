import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { formatCOP } from '../../utils/formatters';
import { crearPrestamo } from '../../api/prestamos.api';
import useCarritoStore from '../../store/carritoStore';
import { User, Users } from 'lucide-react';

export function ModalPrestamo({ open, onClose }) {
  const queryClient = useQueryClient();
  const { items, totalCarrito, limpiarCarrito } = useCarritoStore();
  const total = totalCarrito();

  const [tipoCliente, setTipoCliente] = useState('cliente');
  const [form, setForm] = useState({
    nombre: '', cedula: '', telefono: '', valor_prestamo: total,
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: crearPrestamo,
    onSuccess: () => {
      queryClient.invalidateQueries(['productos-serial']);
      queryClient.invalidateQueries(['productos-cantidad']);
      queryClient.invalidateQueries(['prestamos']);
      limpiarCarrito();
      onClose();
      resetForm();
    },
    onError: (err) => {
      setError(err.response?.data?.error || 'Error al registrar el préstamo');
    },
  });

  const resetForm = () => {
    setForm({ nombre: '', cedula: '', telefono: '', valor_prestamo: 0 });
    setError('');
    setTipoCliente('cliente');
  };

  const handleSubmit = () => {
    setError('');
    if (!form.nombre.trim()) return setError('El nombre es requerido');
    if (items.length === 0) return setError('El carrito está vacío');
    if (items.length > 1) return setError('Solo se puede prestar un producto a la vez');

    const item = items[0];

    mutation.mutate({
      prestatario:      form.nombre,
      cedula:           tipoCliente === 'cliente' ? form.cedula : 'COMPANERO',
      telefono:         tipoCliente === 'cliente' ? form.telefono : '0000000000',
      nombre_producto:  item.nombre,
      imei:             item.imei || null,
      producto_id:      item.producto_id || null,
      cantidad_prestada: item.cantidad || 1,
      valor_prestamo:   Number(form.valor_prestamo || total),
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="Registrar Préstamo" size="md">
      <div className="flex flex-col gap-5">

        {/* Tipo */}
        <div className="flex gap-2">
          <button
            onClick={() => setTipoCliente('companero')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border transition-all
              ${tipoCliente === 'companero' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-gray-50 border-gray-200 text-gray-600'}`}
          >
            <User size={16} /> Compañero
          </button>
          <button
            onClick={() => setTipoCliente('cliente')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border transition-all
              ${tipoCliente === 'cliente' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-gray-50 border-gray-200 text-gray-600'}`}
          >
            <Users size={16} /> Cliente
          </button>
        </div>

        {/* Producto seleccionado */}
        {items.length > 0 && (
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-xs font-medium text-gray-500 mb-1">Producto a prestar</p>
            <p className="text-sm font-medium text-gray-800">{items[0].nombre}</p>
            {items[0].imei && (
              <p className="text-xs text-gray-400 font-mono">{items[0].imei}</p>
            )}
          </div>
        )}

        {/* Datos */}
        <div className="flex flex-col gap-3">
          <Input
            label="Nombre"
            placeholder={tipoCliente === 'companero' ? 'Nombre del compañero' : 'Nombre completo'}
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
          />
          {tipoCliente === 'cliente' && (
            <>
              <Input
                label="Cédula"
                placeholder="123456789"
                value={form.cedula}
                onChange={(e) => setForm({ ...form, cedula: e.target.value })}
              />
              <Input
                label="Teléfono"
                placeholder="3001234567"
                value={form.telefono}
                onChange={(e) => setForm({ ...form, telefono: e.target.value })}
              />
            </>
          )}
          <Input
            label="Valor del préstamo"
            type="number"
            value={form.valor_prestamo || total}
            onChange={(e) => setForm({ ...form, valor_prestamo: e.target.value })}
          />
        </div>

        <div className="bg-gray-50 rounded-xl p-3 flex justify-between">
          <span className="text-sm text-gray-600">Valor sugerido</span>
          <span className="text-sm font-bold text-gray-900">{formatCOP(total)}</span>
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
          >
            Registrar Préstamo
          </Button>
        </div>
      </div>
    </Modal>
  );
}