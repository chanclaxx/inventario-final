import { useState }                           from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, StickyNote }                from 'lucide-react';
import { actualizarSerial }                  from '../../api/productos.api';
import { getProveedores }                    from '../../api/proveedores.api';
import { Modal }       from '../../components/ui/Modal';
import { Input }       from '../../components/ui/Input';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { Button }      from '../../components/ui/Button';
import { useAuth }     from '../../context/useAuth';
import api             from '../../api/axios.config';

function parsearLista(raw) {
  try {
    const lista = JSON.parse(raw || '[]');
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

export function ModalEditarSerial({ serial, precioProducto, productoId, onClose }) {
  const { puedeEditarProductos, camposEdicionProductos } = useAuth();
  const campos = camposEdicionProductos();
  const tiene  = (c) => campos === null || campos.includes(c);
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    imei:            serial.imei         || '',
    precio:          serial.precio       != null ? Number(serial.precio)
                   : precioProducto      != null ? Number(precioProducto) : '',
    costo_compra:    serial.costo_compra != null ? Number(serial.costo_compra) : '',
    proveedor_id:    serial.proveedor_id != null ? String(serial.proveedor_id) : '',
    color:           serial.color        || '',
    caracteristicas: (serial.caracteristicas && typeof serial.caracteristicas === 'object')
      ? serial.caracteristicas
      : {},
    nota:            serial.nota          || '',
  });
  const [error, setError] = useState('');

  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
    enabled:  puedeEditarProductos(),
  });

  const coloresActivo          = configData?.colores_serial_activo === '1';
  const coloresConfig          = parsearLista(configData?.colores_serial_lista);
  const caracteristicasActivo  = configData?.caracteristicas_serial_activo === '1';
  const caracteristicasLista   = parsearLista(configData?.caracteristicas_serial_lista);

  const { data: proveedoresData } = useQuery({
    queryKey: ['proveedores'],
    queryFn:  () => getProveedores().then((r) => r.data.data),
    enabled:  puedeEditarProductos() && tiene('proveedor'),
  });

  const proveedores = proveedoresData || [];

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        imei:         form.imei.trim(),
        precio:       form.precio       !== '' ? Number(form.precio)       : undefined,
        costo_compra: form.costo_compra !== '' ? Number(form.costo_compra) : null,
        proveedor_id: form.proveedor_id !== '' ? Number(form.proveedor_id) : null,
        producto_id:  productoId,
        nota:         form.nota.trim() || null,
      };
      if (coloresActivo) {
        payload.color = form.color.trim() !== '' ? form.color.trim() : null;
      }
      if (caracteristicasActivo) {
        const noVacias = Object.fromEntries(
          Object.entries(form.caracteristicas).filter(([, v]) => String(v).trim())
        );
        payload.caracteristicas = Object.keys(noVacias).length > 0 ? noVacias : null;
      }
      return actualizarSerial(serial.id, payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['seriales', productoId], exact: false });
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

  const setCaracteristica = (nombre, valor) =>
    setForm((f) => ({ ...f, caracteristicas: { ...f.caracteristicas, [nombre]: valor } }));

  if (!puedeEditarProductos()) return null;

  return (
    <Modal open onClose={onClose} title="Editar serial" size="sm">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 bg-blue-50 rounded-xl px-3 py-2">
          <Pencil size={15} className="text-blue-500 flex-shrink-0" />
          <p className="text-xs text-blue-700">
            Edita el IMEI, costo de compra o precio de venta de este serial. El precio aplica solo a este serial.
          </p>
        </div>

        {tiene('imei') && (
          <Input
            id="edit-imei"
            label="IMEI / Serial"
            placeholder="Ej: 356789012345678"
            value={form.imei}
            onChange={(e) => setForm({ ...form, imei: e.target.value })}
            onKeyDown={(e) => handleKeyDown(e, 'edit-precio-serial')}
            autoFocus
          />
        )}

        {tiene('precio') && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">
              Precio de venta{' '}
              <span className="text-gray-400 font-normal text-xs">
                (solo este serial)
              </span>
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
        )}

        {tiene('costo') && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">
              Costo de compra{' '}
              <span className="text-gray-400 font-normal text-xs">(opcional)</span>
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
        )}

        {tiene('proveedor') && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">
              Proveedor{' '}
              <span className="text-gray-400 font-normal">(opcional)</span>
            </label>
            <select
              id="edit-proveedor-serial"
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
        )}

        {tiene('color') && coloresActivo && coloresConfig.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">
              Color{' '}
              <span className="text-gray-400 font-normal text-xs">(opcional)</span>
            </label>
            <select
              id="edit-color-serial"
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })}
              className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm
                focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
            >
              <option value="">Sin color</option>
              {coloresConfig.map((color) => (
                <option key={color} value={color}>{color}</option>
              ))}
            </select>
          </div>
        )}

        {tiene('caracteristicas') && caracteristicasActivo && caracteristicasLista.length > 0 && (
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-gray-700">Características</label>
            <div className="flex flex-col gap-2 bg-gray-50 rounded-xl p-3">
              {caracteristicasLista.map((nombre) => (
                <div key={nombre} className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-28 flex-shrink-0 truncate">
                    {nombre}
                  </span>
                  <input
                    type="text"
                    value={form.caracteristicas[nombre] || ''}
                    onChange={(e) => setCaracteristica(nombre, e.target.value)}
                    placeholder={`${nombre}...`}
                    className="flex-1 px-2 py-1.5 bg-white border border-gray-200 rounded-lg
                      text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
                  />
                </div>
              ))}
            </div>
          </div>
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
            placeholder="Ej: está donde el técnico, lo tiene Juan..."
            className="w-full px-3 py-2 bg-amber-50/60 border border-amber-200 rounded-xl
              text-sm text-gray-700 resize-none placeholder:text-amber-300
              focus:outline-none focus:ring-2 focus:ring-amber-400 transition-all"
          />
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
