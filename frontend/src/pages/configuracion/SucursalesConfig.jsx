import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/axios.config';
import { useAuth } from '../../context/useAuth';
import { Modal }   from '../../components/ui/Modal';
import { Button }  from '../../components/ui/Button';
import { Input }   from '../../components/ui/Input';
import { Badge }   from '../../components/ui/Badge';
import { Plus, Pencil, ToggleLeft, ToggleRight, Building2 } from 'lucide-react';

const FORM_INICIAL = { nombre: '', direccion: '', telefono: '' };

const fetchSucursales = () => api.get('/sucursales').then((r) => r.data.data);

function FilaSucursal({ sucursal, onEditar, onToggle }) {
  return (
    <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-gray-800 truncate">{sucursal.nombre}</p>
          {!sucursal.activa && <Badge variant="gray">Inactiva</Badge>}
        </div>
        {sucursal.direccion && (
          <p className="text-xs text-gray-400 truncate mt-0.5">{sucursal.direccion}</p>
        )}
      </div>
      <div className="flex gap-1 flex-shrink-0">
        <button
          onClick={() => onEditar(sucursal)}
          className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <Pencil size={14} />
        </button>
        <button
          onClick={() => onToggle(sucursal)}
          className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
          title={sucursal.activa ? 'Desactivar' : 'Activar'}
        >
          {sucursal.activa
            ? <ToggleRight size={14} className="text-green-500" />
            : <ToggleLeft  size={14} />
          }
        </button>
      </div>
    </div>
  );
}

export function SucursalesConfig() {
  const { esAdminNegocio } = useAuth();
  const queryClient        = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editando,  setEditando]  = useState(null);
  const [form,      setForm]      = useState(FORM_INICIAL);
  const [error,     setError]     = useState('');

  const { data: sucursales = [] } = useQuery({
    queryKey: ['sucursales'],
    queryFn: fetchSucursales,
  });

  const mutCrear = useMutation({
    mutationFn: () => api.post('/sucursales', form),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['sucursales'] }); cerrarModal(); },
    onError: (e) => setError(e.response?.data?.error || 'Error al crear sucursal'),
  });

  const mutEditar = useMutation({
    mutationFn: () => api.put(`/sucursales/${editando.id}`, form),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['sucursales'] }); cerrarModal(); },
    onError: (e) => setError(e.response?.data?.error || 'Error al actualizar sucursal'),
  });

  const mutToggle = useMutation({
    mutationFn: (id) => api.patch(`/sucursales/${id}/toggle`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sucursales'] }),
  });

  const abrirNuevo = () => {
    setEditando(null);
    setForm(FORM_INICIAL);
    setError('');
    setModalOpen(true);
  };

  const abrirEditar = (sucursal) => {
    setEditando(sucursal);
    setForm({ nombre: sucursal.nombre, direccion: sucursal.direccion || '', telefono: sucursal.telefono || '' });
    setError('');
    setModalOpen(true);
  };

  const cerrarModal = () => {
    setModalOpen(false);
    setEditando(null);
    setError('');
  };

  const handleGuardar = () => {
    setError('');
    if (!form.nombre.trim()) return setError('El nombre es requerido');
    editando ? mutEditar.mutate() : mutCrear.mutate();
  };

  if (!esAdminNegocio()) return null;

  const activas   = sucursales.filter((s) => s.activa);
  const inactivas = sucursales.filter((s) => !s.activa);

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Sucursales</h2>
          <Badge variant="gray">{activas.length} activas</Badge>
        </div>
        <button
          onClick={abrirNuevo}
          className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} className="text-white" />
        </button>
      </div>

      {sucursales.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-gray-400">
          <Building2 size={32} className="text-gray-200" />
          <p className="text-sm">Sin sucursales registradas</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {activas.map((s) => (
            <FilaSucursal
              key={s.id}
              sucursal={s}
              onEditar={abrirEditar}
              onToggle={(suc) => mutToggle.mutate(suc.id)}
            />
          ))}
          {inactivas.length > 0 && (
            <>
              <p className="text-xs text-gray-400 mt-2 px-1">Inactivas</p>
              {inactivas.map((s) => (
                <FilaSucursal
                  key={s.id}
                  sucursal={s}
                  onEditar={abrirEditar}
                  onToggle={(suc) => mutToggle.mutate(suc.id)}
                />
              ))}
            </>
          )}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={cerrarModal}
        title={editando ? 'Editar sucursal' : 'Nueva sucursal'}
        size="sm"
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Nombre"
            placeholder="Sucursal Centro"
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
          />
          <Input
            label="Dirección"
            placeholder="Calle 10 # 5-20"
            value={form.direccion}
            onChange={(e) => setForm({ ...form, direccion: e.target.value })}
          />
          <Input
            label="Teléfono"
            placeholder="3001234567"
            value={form.telefono}
            onChange={(e) => setForm({ ...form, telefono: e.target.value })}
          />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={cerrarModal}>Cancelar</Button>
            <Button
              className="flex-1"
              loading={mutCrear.isPending || mutEditar.isPending}
              onClick={handleGuardar}
            >
              {editando ? 'Guardar cambios' : 'Crear sucursal'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}