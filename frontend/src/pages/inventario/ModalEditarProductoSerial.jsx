import { useState }                          from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2, StickyNote }        from 'lucide-react';
import { actualizarProductoSerial }          from '../../api/productos.api';
import { getLineas }                         from '../../api/productos.api';
import { Modal }       from '../../components/ui/Modal';
import { Input }       from '../../components/ui/Input';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { InputUbicacion } from '../../components/ui/InputUbicacion';
import { Button }      from '../../components/ui/Button';
import { useAuth }     from '../../context/useAuth';
import { ModalEliminarProducto, TIPO_PRODUCTO_SERIAL } from './ModalEliminarProducto';

export function ModalEditarProductoSerial({ producto, pinEliminacion, ubicacionActiva, onClose, onSaved }) {
  const { esAdminNegocio, puedeEditarProductos, camposEdicionProductos } = useAuth();
  const esAdmin = esAdminNegocio();
  const campos  = camposEdicionProductos();
  const tiene   = (c) => campos === null || campos.includes(c);
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    nombre:   producto.nombre   || '',
    precio:   producto.precio   != null ? Number(producto.precio)   : '',
    linea_id: producto.linea_id != null ? String(producto.linea_id) : '',
    nota:     producto.nota     || '',
    ubicacion: producto.ubicacion || '',
  });
  const [error,         setError]         = useState('');
  const [modalEliminar, setModalEliminar] = useState(false);

  const { data: lineasData } = useQuery({
    queryKey: ['lineas'],
    queryFn:  () => getLineas().then((r) => r.data.data),
    enabled:  puedeEditarProductos() && tiene('linea'),
  });
  const lineas = lineasData || [];

  // ── Mutación de edición (lógica original intacta) ─────────────────────────
  const mutation = useMutation({
    mutationFn: () => actualizarProductoSerial(producto.id, {
      nombre:   form.nombre.trim(),
      precio:   form.precio   !== '' ? Number(form.precio)   : null,
      linea_id: form.linea_id !== '' ? Number(form.linea_id) : null,
      nota:     form.nota.trim() || null,
      // Solo si la feature está activa: sin la clave, el backend no toca la columna
      ...(ubicacionActiva ? { ubicacion: form.ubicacion.trim() || null } : {}),
    }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['productos-serial'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['seriales'],         exact: false });
      onSaved?.(response.data.data);
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al actualizar el producto'),
  });

  if (!puedeEditarProductos()) return null;

  return (
    <>
      <Modal open onClose={onClose} title="Editar producto" size="sm">
        <div className="flex flex-col gap-4">

          <div className="flex items-center gap-2 bg-blue-50 rounded-xl px-3 py-2">
            <Pencil size={15} className="text-blue-500 flex-shrink-0" />
            <p className="text-xs text-blue-700">
              Edita el nombre, línea y precio de venta del producto.
            </p>
          </div>

          {tiene('nombre') && (
            <Input
              label="Nombre"
              placeholder="Ej: iPhone 15 Pro"
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              autoFocus
            />
          )}

          {tiene('precio') && (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Precio de venta</label>
              <InputMoneda
                value={form.precio}
                onChange={(val) => setForm({ ...form, precio: val })}
                placeholder="0"
                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl
                  text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500
                  transition-all"
              />
            </div>
          )}

          {tiene('linea') && (
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
          )}

          {ubicacionActiva && (
            <InputUbicacion
              value={form.ubicacion}
              onChange={(val) => setForm({ ...form, ubicacion: val })}
            />
          )}

          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
              <StickyNote size={14} className="text-amber-500" />
              Nota / recordatorio <span className="text-gray-400 font-normal text-xs">(opcional)</span>
            </label>
            <textarea
              value={form.nota}
              onChange={(e) => setForm({ ...form, nota: e.target.value })}
              rows={2}
              maxLength={280}
              placeholder="Ej: modelo en exhibición, revisar con proveedor..."
              className="w-full px-3 py-2 bg-amber-50/60 border border-amber-200 rounded-xl
                text-sm text-gray-700 resize-none placeholder:text-amber-300
                focus:outline-none focus:ring-2 focus:ring-amber-400 transition-all"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

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

            {esAdmin && (
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
            )}
          </div>

        </div>
      </Modal>

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