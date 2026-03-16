import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/axios.config';
import { useAuth } from '../../context/useAuth';
import { Modal }   from '../../components/ui/Modal';
import { Button }  from '../../components/ui/Button';
import { Input }   from '../../components/ui/Input';
import { Badge }   from '../../components/ui/Badge';
import { Plus, Pencil, UserX, UserCheck, Users } from 'lucide-react';

// ── Constantes ────────────────────────────────────────
const ROLES = [
  { value: 'admin_negocio', label: 'Admin negocio' },
  { value: 'supervisor',    label: 'Supervisor'    },
  { value: 'vendedor',      label: 'Vendedor'      },
];

const FORM_INICIAL = {
  nombre:      '',
  email:       '',
  password:    '',
  rol:         'vendedor',
  sucursal_id: '',
};

// ── Queries / mutations ───────────────────────────────
const fetchUsuarios   = () => api.get('/usuarios').then((r) => r.data.data);
const fetchSucursales = () => api.get('/sucursales').then((r) => r.data.data);

// ── Sub-componente: fila de usuario ──────────────────
function FilaUsuario({ usuario, onEditar, onToggleActivo }) {
  const rolLabel = ROLES.find((r) => r.value === usuario.rol)?.label ?? usuario.rol;

  return (
    <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{usuario.nombre}</p>
        <p className="text-xs text-gray-400 truncate">{usuario.email}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <Badge variant="blue">{rolLabel}</Badge>
          {usuario.sucursal_nombre && (
            <Badge variant="gray">{usuario.sucursal_nombre}</Badge>
          )}
          {!usuario.activo && <Badge variant="red">Inactivo</Badge>}
        </div>
      </div>
      <div className="flex gap-1 flex-shrink-0">
        <button
          onClick={() => onEditar(usuario)}
          className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <Pencil size={14} />
        </button>
        <button
          onClick={() => onToggleActivo(usuario)}
          className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
          title={usuario.activo ? 'Desactivar' : 'Activar'}
        >
          {usuario.activo ? <UserX size={14} /> : <UserCheck size={14} />}
        </button>
      </div>
    </div>
  );
}

// ── Sub-componente: formulario modal ─────────────────
function ModalUsuario({ open, onClose, editando, sucursales, onGuardar, cargando, error }) {
  // El form se inicializa directo desde editando cada vez que el modal se monta.
  // Como el padre desmonta/monta el modal cambiando `open`, esto es suficiente
  // para prellenar los campos sin necesitar useEffect.
  const [form, setForm] = useState(() =>
    editando
      ? {
          nombre:      editando.nombre      || '',
          email:       editando.email       || '',
          password:    '',
          rol:         editando.rol         || 'vendedor',
          sucursal_id: editando.sucursal_id ?? '',
        }
      : FORM_INICIAL
  );

  const set = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }));

  const requiereSucursal = form.rol !== 'admin_negocio';

  const handleGuardar = () => {
    const payload = { ...form };
    // Si no escribió contraseña nueva, no la enviamos para no sobreescribir la existente
    if (!payload.password) delete payload.password;
    if (!requiereSucursal) payload.sucursal_id = null;
    onGuardar(payload);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editando ? 'Editar usuario' : 'Nuevo usuario'}
      size="md"
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Nombre"
          placeholder="Juan Pérez"
          value={form.nombre}
          onChange={(e) => set('nombre', e.target.value)}
        />
        <Input
          label="Email"
          type="email"
          placeholder="juan@ejemplo.com"
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
        />
        <Input
          label={editando
            ? 'Nueva contraseña (dejar vacío para no cambiar)'
            : 'Contraseña inicial'}
          type="password"
          placeholder="••••••••"
          value={form.password}
          onChange={(e) => set('password', e.target.value)}
        />

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Rol</label>
          <select
            value={form.rol}
            onChange={(e) => set('rol', e.target.value)}
            className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm
              text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500
              focus:bg-white transition-all"
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>

        {requiereSucursal && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Sucursal asignada</label>
            <select
              value={form.sucursal_id}
              onChange={(e) => set('sucursal_id', e.target.value)}
              className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm
                text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500
                focus:bg-white transition-all"
            >
              <option value="">Selecciona una sucursal</option>
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button className="flex-1" loading={cargando} onClick={handleGuardar}>
            {editando ? 'Guardar cambios' : 'Crear usuario'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Componente principal ──────────────────────────────
export function UsuariosConfig() {
  const { esAdminNegocio } = useAuth();
  const queryClient        = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editando,  setEditando]  = useState(null);
  const [error,     setError]     = useState('');

  const { data: usuarios   = [] } = useQuery({ queryKey: ['usuarios'],   queryFn: fetchUsuarios });
  const { data: sucursales = [] } = useQuery({ queryKey: ['sucursales'], queryFn: fetchSucursales });

  const mutCrear = useMutation({
    mutationFn: (payload) => api.post('/usuarios', payload),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['usuarios'] }); cerrarModal(); },
    onError: (e) => setError(e.response?.data?.error || 'Error al crear usuario'),
  });

  const mutEditar = useMutation({
    mutationFn: (payload) => api.put(`/usuarios/${editando.id}`, payload),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['usuarios'] }); cerrarModal(); },
    onError: (e) => setError(e.response?.data?.error || 'Error al actualizar usuario'),
  });

  const mutToggleActivo = useMutation({
    mutationFn: (usuario) => api.put(`/usuarios/${usuario.id}`, {
      nombre:      usuario.nombre,
      email:       usuario.email,
      rol:         usuario.rol,
      sucursal_id: usuario.sucursal_id,
      activo:      !usuario.activo,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['usuarios'] }),
  });

  const abrirNuevo = () => {
    setEditando(null);
    setError('');
    setModalOpen(true);
  };

  const abrirEditar = (usuario) => {
    setEditando(usuario);
    setError('');
    setModalOpen(true);
  };

  const cerrarModal = () => {
    setModalOpen(false);
    setEditando(null);
    setError('');
  };

  const handleGuardar = (payload) => {
    setError('');
    if (!payload.nombre?.trim()) return setError('El nombre es requerido');
    if (!payload.email?.trim())  return setError('El email es requerido');
    if (!editando && !payload.password?.trim()) return setError('La contraseña es requerida');
    if (payload.rol !== 'admin_negocio' && !payload.sucursal_id) {
      return setError('Debes asignar una sucursal');
    }
    editando ? mutEditar.mutate(payload) : mutCrear.mutate(payload);
  };

  if (!esAdminNegocio()) return null;

  const activos   = usuarios.filter((u) => u.activo);
  const inactivos = usuarios.filter((u) => !u.activo);

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Usuarios</h2>
          <Badge variant="gray">{activos.length} activos</Badge>
        </div>
        <button
          onClick={abrirNuevo}
          className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} className="text-white" />
        </button>
      </div>

      {usuarios.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-gray-400">
          <Users size={32} className="text-gray-200" />
          <p className="text-sm">Sin usuarios registrados</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {activos.map((u) => (
            <FilaUsuario
              key={u.id}
              usuario={u}
              onEditar={abrirEditar}
              onToggleActivo={(usr) => mutToggleActivo.mutate(usr)}
            />
          ))}

          {inactivos.length > 0 && (
            <>
              <p className="text-xs text-gray-400 mt-2 px-1">Inactivos</p>
              {inactivos.map((u) => (
                <FilaUsuario
                  key={u.id}
                  usuario={u}
                  onEditar={abrirEditar}
                  onToggleActivo={(usr) => mutToggleActivo.mutate(usr)}
                />
              ))}
            </>
          )}
        </div>
      )}

      <ModalUsuario
        key={editando?.id ?? 'nuevo'}
        open={modalOpen}
        onClose={cerrarModal}
        editando={editando}
        sucursales={sucursales}
        onGuardar={handleGuardar}
        cargando={mutCrear.isPending || mutEditar.isPending}
        error={error}
      />
    </div>
  );
}