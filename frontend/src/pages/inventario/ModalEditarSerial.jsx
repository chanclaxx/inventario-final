import { useState, useContext }              from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil }                            from 'lucide-react';
import { actualizarSerial }                  from '../../api/productos.api';
import { getProveedores }                    from '../../api/proveedores.api';
import { Modal }       from '../../components/ui/Modal';
import { Input }       from '../../components/ui/Input';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { Button }      from '../../components/ui/Button';
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

  // ── Estado del formulario ─────────────────────────────────────────────────
  // CAMBIO: precio y costo_compra se inicializan como NUMBER en vez de String.
  //   • Postgres devuelve '850000.00' — Number('850000.00') → 850000 ✓
  //   • InputMoneda espera number o '' (string vacío = sin valor)
  //   • La mutación hace Number(form.precio): Number(850000) = 850000 ✓
  //   • precio usa precioProducto (prop), no serial.precio
  //   • costo_compra usa serial.costo_compra
  const [form, setForm] = useState({
    imei:         serial.imei         || '',
    precio:       precioProducto      != null ? Number(precioProducto)      : '',
    costo_compra: serial.costo_compra != null ? Number(serial.costo_compra) : '',
    proveedor_id: serial.proveedor_id != null ? String(serial.proveedor_id) : '',
  });
  const [error, setError] = useState('');

  const { data: proveedoresData } = useQuery({
    queryKey: ['proveedores'],
    queryFn:  () => getProveedores().then((r) => r.data.data),
    enabled:  esAdminNegocio(),
  });

  const proveedores = proveedoresData || [];

  // ── Mutación de edición (lógica original intacta) ─────────────────────────
  // precio vacío → undefined (no null) — igual que el original
  // costo_compra vacío → null — igual que el original
  const mutation = useMutation({
    mutationFn: () => actualizarSerial(serial.id, {
      imei:         form.imei.trim(),
      precio:       form.precio       !== '' ? Number(form.precio)       : undefined,
      costo_compra: form.costo_compra !== '' ? Number(form.costo_compra) : null,
      proveedor_id: form.proveedor_id !== '' ? Number(form.proveedor_id) : null,
      producto_id:  productoId,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['seriales', productoId], exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-serial'],     exact: false });
      onClose();
    },
    onError: (err) => {
      setError(err.response?.data?.error || 'Error al actualizar el serial');
    },
  });

  // ── Navegación Enter (original intacta) ───────────────────────────────────
  // InputMoneda acepta prop id y lo aplica al <input> interno,
  // así que document.getElementById funciona igual que con Input estándar.
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

        {/* IMEI — sin cambios (es texto, no precio) */}
        <Input
          id="edit-imei"
          label="IMEI / Serial"
          placeholder="Ej: 356789012345678"
          value={form.imei}
          onChange={(e) => setForm({ ...form, imei: e.target.value })}
          onKeyDown={(e) => handleKeyDown(e, 'edit-precio-serial')}
          autoFocus
        />

        {/* CAMBIO: Input type=number → InputMoneda */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            Precio de venta <span className="text-gray-400 font-normal text-xs">(aplica a todos los seriales del modelo)</span>
          </label>
          <InputMoneda
            id="edit-precio-serial"
            value={form.precio}
            onChange={(val) => setForm({ ...form, precio: val })}
            placeholder="0"
            onKeyDown={(e) => handleKeyDown(e, 'edit-costo-serial')}
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl
              text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500
              transition-all"
          />
        </div>

        {/* CAMBIO: Input type=number → InputMoneda */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            Costo de compra <span className="text-gray-400 font-normal text-xs">(opcional)</span>
          </label>
          <InputMoneda
            id="edit-costo-serial"
            value={form.costo_compra}
            onChange={(val) => setForm({ ...form, costo_compra: val })}
            placeholder="0"
            onKeyDown={(e) => handleKeyDown(e, 'edit-proveedor-serial')}
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl
              text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500
              transition-all"
          />
        </div>

        {/* Proveedor — sin cambios */}
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