import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/useAuth';
import { getSucursales } from '../../api/sucursales.api';
import { getVendedores, crearVendedor, actualizarVendedor } from '../../api/vendedores.api';
import { Modal }  from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input }  from '../../components/ui/Input';
import { Badge }  from '../../components/ui/Badge';
import {
  Plus, Pencil, UserX, UserCheck, BadgeCheck,
  ToggleLeft, ToggleRight, Store,
} from 'lucide-react';

// ─── Toggle (mismo estilo que ConfigPage) ─────────────────────────────────────
function Toggle({ enabled, onChange, label, description }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {description && <span className="text-xs text-gray-400">{description}</span>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!enabled)}
        className="flex-shrink-0 transition-colors"
        aria-pressed={enabled}
      >
        {enabled
          ? <ToggleRight size={28} className="text-blue-600" />
          : <ToggleLeft  size={28} className="text-gray-300" />}
      </button>
    </div>
  );
}

// ─── Modal crear / editar vendedor ────────────────────────────────────────────
function ModalVendedor({ open, onClose, editando, sucursales, onGuardar, cargando, error }) {
  const [nombre,     setNombre]     = useState(editando?.nombre ?? '');
  const [sucursalId, setSucursalId] = useState(editando?.sucursal_id ?? '');

  const handleGuardar = () => onGuardar({ nombre, sucursal_id: sucursalId });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editando ? 'Editar vendedor' : 'Nuevo vendedor'}
      size="sm"
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Nombre del vendedor"
          placeholder="Ej: Juan Pérez"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          autoFocus
        />

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Sucursal asignada</label>
          <select
            value={sucursalId}
            onChange={(e) => setSucursalId(e.target.value)}
            className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm
              text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500
              focus:bg-white transition-all"
          >
            <option value="">Selecciona una sucursal</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
          <p className="text-xs text-gray-400">
            El vendedor solo aparecerá al facturar en esta sucursal.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={cargando} onClick={handleGuardar}>
            {editando ? 'Guardar cambios' : 'Crear vendedor'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Fila de vendedor ─────────────────────────────────────────────────────────
function FilaVendedor({ vendedor, onEditar, onToggleActivo }) {
  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border transition-all
      ${vendedor.activo ? 'bg-gray-50 border-gray-100' : 'bg-gray-50/50 border-gray-100 opacity-60'}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-gray-800 truncate">{vendedor.nombre}</p>
          {!vendedor.activo && <Badge variant="red">Inactivo</Badge>}
        </div>
        <div className="flex items-center gap-1.5 mt-1 text-xs text-gray-400">
          <Store size={11} />
          <span>{vendedor.sucursal_nombre}</span>
        </div>
      </div>
      <div className="flex gap-1 flex-shrink-0">
        <button
          onClick={() => onEditar(vendedor)}
          className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
          title="Editar vendedor"
        >
          <Pencil size={14} />
        </button>
        <button
          onClick={() => onToggleActivo(vendedor)}
          className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
          title={vendedor.activo ? 'Desactivar' : 'Activar'}
        >
          {vendedor.activo ? <UserX size={14} /> : <UserCheck size={14} />}
        </button>
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export function VendedoresConfig({ valores, set }) {
  const { esAdminNegocio } = useAuth();
  const queryClient        = useQueryClient();
  const activo             = valores['vendedores_activo'] === '1';

  const [modalOpen, setModalOpen] = useState(false);
  const [editando,  setEditando]  = useState(null);
  const [error,     setError]     = useState('');

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn:  () => getVendedores().then((r) => r.data.data),
    enabled:  activo,
  });

  const { data: sucursales = [] } = useQuery({
    queryKey: ['sucursales'],
    queryFn:  () => getSucursales().then((r) => r.data.data),
    enabled:  activo,
  });

  const mutCrear = useMutation({
    mutationFn: (payload) => crearVendedor(payload),
    onSuccess:  () => { queryClient.invalidateQueries({ queryKey: ['vendedores'] }); cerrarModal(); },
    onError:    (e) => setError(e.response?.data?.error || 'Error al crear el vendedor'),
  });

  const mutEditar = useMutation({
    mutationFn: (payload) => actualizarVendedor(editando.id, payload),
    onSuccess:  () => { queryClient.invalidateQueries({ queryKey: ['vendedores'] }); cerrarModal(); },
    onError:    (e) => setError(e.response?.data?.error || 'Error al actualizar el vendedor'),
  });

  const mutToggleActivo = useMutation({
    mutationFn: (vendedor) => actualizarVendedor(vendedor.id, { activo: !vendedor.activo }),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['vendedores'] }),
  });

  const abrirNuevo  = () => { setEditando(null); setError(''); setModalOpen(true); };
  const abrirEditar = (v) => { setEditando(v); setError(''); setModalOpen(true); };
  const cerrarModal = () => { setModalOpen(false); setEditando(null); setError(''); };

  const handleGuardar = ({ nombre, sucursal_id }) => {
    setError('');
    if (!nombre?.trim())  return setError('El nombre es requerido');
    if (!sucursal_id)     return setError('Debes asignar una sucursal');
    const payload = { nombre: nombre.trim(), sucursal_id: Number(sucursal_id) };
    editando ? mutEditar.mutate(payload) : mutCrear.mutate(payload);
  };

  const activos   = vendedores.filter((v) => v.activo);
  const inactivos = vendedores.filter((v) => !v.activo);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <BadgeCheck size={15} className="text-gray-400" />
        <h3 className="text-sm font-semibold text-gray-700">Vendedores en facturas</h3>
      </div>
      <p className="text-xs text-gray-400 -mt-2">
        Al activarlo, cada factura pedirá indicar qué vendedor realizó la venta.
        Los vendedores se muestran según la sucursal activa.
      </p>

      <Toggle
        label="Exigir vendedor al facturar"
        description="Muestra un desplegable obligatorio de vendedores en cada venta"
        enabled={activo}
        onChange={(val) => set('vendedores_activo', val ? '1' : '0')}
      />

      {activo && !esAdminNegocio() && (
        <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
          Solo el administrador del negocio puede gestionar la lista de vendedores.
        </p>
      )}

      {activo && esAdminNegocio() && (
        <div className="flex flex-col gap-3 border-t border-gray-100 pt-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-gray-700">Lista de vendedores</h4>
              <Badge variant="gray">{activos.length} activos</Badge>
            </div>
            <button
              onClick={abrirNuevo}
              disabled={sucursales.length === 0}
              className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center
                hover:bg-blue-700 transition-colors disabled:opacity-40"
            >
              <Plus size={16} className="text-white" />
            </button>
          </div>

          {vendedores.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">
              Sin vendedores registrados. Crea el primero con el botón +.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {activos.map((v) => (
                <FilaVendedor key={v.id} vendedor={v}
                  onEditar={abrirEditar}
                  onToggleActivo={(vv) => mutToggleActivo.mutate(vv)} />
              ))}
              {inactivos.length > 0 && (
                <>
                  <p className="text-xs text-gray-400 mt-2 px-1">Inactivos</p>
                  {inactivos.map((v) => (
                    <FilaVendedor key={v.id} vendedor={v}
                      onEditar={abrirEditar}
                      onToggleActivo={(vv) => mutToggleActivo.mutate(vv)} />
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {modalOpen && (
        <ModalVendedor
          key={editando?.id ?? 'nuevo'}
          open={modalOpen}
          onClose={cerrarModal}
          editando={editando}
          sucursales={sucursales}
          onGuardar={handleGuardar}
          cargando={mutCrear.isPending || mutEditar.isPending}
          error={error}
        />
      )}
    </div>
  );
}
