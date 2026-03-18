import { useState }                        from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 }                  from 'lucide-react';
import { actualizarProductoSerial }        from '../../api/productos.api';
import { getLineas }                       from '../../api/productos.api';
import { Modal }  from '../../components/ui/Modal';
import { Input }  from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { useAuth } from '../../context/useAuth';
import { ModalEliminarProducto, TIPO_PRODUCTO_SERIAL } from './ModalEliminarProducto';

// PIN de eliminación viene de config_negocio → se pasa como prop desde el padre
// para no duplicar la query. Si el padre no lo tiene, se pasa undefined y el
// modal de eliminación mostrará el aviso correspondiente.

export function ModalEditarProductoSerial({ producto, pinEliminacion, onClose }) {
  const { esAdminNegocio } = useAuth();
  const queryClient = useQueryClient();

  // ── Estado del formulario de edición (lógica original intacta) ────────────
  const [form, setForm] = useState({
    nombre:   producto.nombre   || '',
    precio:   producto.precio   != null ? String(producto.precio)   : '',
    linea_id: producto.linea_id != null ? String(producto.linea_id) : '',
  });
  const [error,          setError]          = useState('');
  const [modalEliminar,  setModalEliminar]  = useState(false);

  const { data: lineasData } = useQuery({
    queryKey: ['lineas'],
    queryFn:  () => getLineas().then((r) => r.data.data),
    enabled:  esAdminNegocio(),
  });
  const lineas = lineasData || [];

  // ── Mutación de edición (lógica original intacta) ─────────────────────────
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
    <>
      <Modal open onClose={onClose} title="Editar producto" size="sm">
        <div className="flex flex-col gap-4">

          {/* ── Aviso informativo (original) ── */}
          <div className="flex items-center gap-2 bg-blue-50 rounded-xl px-3 py-2">
            <Pencil size={15} className="text-blue-500 flex-shrink-0" />
            <p className="text-xs text-blue-700">
              Edita el nombre, línea y precio de venta del producto.
            </p>
          </div>

          {/* ── Campos del formulario (originales) ── */}
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

          {/* ── Acciones: separador visual + botón eliminar ── */}
          <div className="border-t border-gray-100 pt-3 flex flex-col gap-2">
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

            {/* Botón eliminar — solo admin, separado visualmente */}
            <button
              type="button"
              onClick={() => setModalEliminar(true)}
              className="flex items-center justify-center gap-1.5 w-full py-2 rounded-xl
                text-xs font-medium text-red-400 hover:text-red-600
                hover:bg-red-50 transition-colors border border-dashed border-red-200
                hover:border-red-300"
            >
              <Trash2 size={13} />
              Eliminar producto
            </button>
          </div>

        </div>
      </Modal>

      {/* ── Modal de eliminación — se monta encima del modal de edición ── */}
      {modalEliminar && (
        <ModalEliminarProducto
          producto={producto}
          tipo={TIPO_PRODUCTO_SERIAL}
          pinConfig={pinEliminacion}
          onClose={() => setModalEliminar(false)}
          onSuccess={onClose}
        />
      )}
    </>
  );
}