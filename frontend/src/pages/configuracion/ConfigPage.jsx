import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/axios.config';
import { getGarantias, crearGarantia, actualizarGarantia, eliminarGarantia } from '../../api/garantias.api';
import { UsuariosConfig }   from './UsuariosConfig';
import { SucursalesConfig } from './SucursalesConfig';
import { PasswordConfig }   from './PasswordConfig';
import { Button }  from '../../components/ui/Button';
import { Input }   from '../../components/ui/Input';
import { Modal }   from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import { Badge }   from '../../components/ui/Badge';
import { Settings, Save, Eye, EyeOff, Plus, Trash2, GripVertical } from 'lucide-react';

function useConfigQuery() {
  return useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
  });
}

function GarantiasConfig() {
  const queryClient               = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editando,  setEditando]  = useState(null);
  const [form,      setForm]      = useState({ titulo: '', texto: '', orden: 0 });
  const [error,     setError]     = useState('');

  const { data: garantias = [] } = useQuery({
    queryKey: ['garantias'],
    queryFn:  () => getGarantias().then((r) => r.data.data),
  });

  const mutCrear = useMutation({
    mutationFn: () => crearGarantia(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['garantias'], exact: false });
      cerrarModal();
    },
    onError: (e) => setError(e.response?.data?.error || 'Error'),
  });

  const mutEditar = useMutation({
    mutationFn: () => actualizarGarantia(editando.id, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['garantias'], exact: false });
      cerrarModal();
    },
    onError: (e) => setError(e.response?.data?.error || 'Error'),
  });

  const mutEliminar = useMutation({
    mutationFn: (id) => eliminarGarantia(id),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['garantias'], exact: false }),
  });

  const abrirNuevo = () => {
    setEditando(null);
    setForm({ titulo: '', texto: '', orden: garantias.length });
    setError('');
    setModalOpen(true);
  };

  const abrirEditar = (g) => {
    setEditando(g);
    setForm({ titulo: g.titulo, texto: g.texto, orden: g.orden });
    setError('');
    setModalOpen(true);
  };

  const cerrarModal  = () => { setModalOpen(false); setEditando(null); setError(''); };

  const handleGuardar = () => {
    if (!form.titulo.trim()) return setError('El título es requerido');
    if (!form.texto.trim())  return setError('El texto es requerido');
    editando ? mutEditar.mutate() : mutCrear.mutate();
  };

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Garantías y Términos</h2>
        <button
          onClick={abrirNuevo}
          className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} className="text-white" />
        </button>
      </div>

      {garantias.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">Sin garantías configuradas</p>
      ) : (
        <div className="flex flex-col gap-2">
          {[...garantias].sort((a, b) => a.orden - b.orden).map((g) => (
            <div key={g.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
              <GripVertical size={16} className="text-gray-300 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800">{g.titulo}</p>
                <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{g.texto}</p>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button
                  onClick={() => abrirEditar(g)}
                  className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <Settings size={14} />
                </button>
                <button
                  onClick={() => mutEliminar.mutate(g.id)}
                  className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={cerrarModal} title={editando ? 'Editar Garantía' : 'Nueva Garantía'} size="md">
        <div className="flex flex-col gap-4">
          <Input
            label="Título"
            placeholder="Ej: Garantía de Celulares"
            value={form.titulo}
            onChange={(e) => setForm({ ...form, titulo: e.target.value })}
          />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Texto de garantía</label>
            <textarea
              rows={6}
              placeholder="Escribe los términos y condiciones..."
              value={form.texto}
              onChange={(e) => setForm({ ...form, texto: e.target.value })}
              className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm text-gray-900
                placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500
                focus:bg-white transition-all resize-none"
            />
          </div>
          <Input
            label="Orden (número)"
            type="number"
            value={form.orden}
            onChange={(e) => setForm({ ...form, orden: Number(e.target.value) })}
          />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={cerrarModal}>Cancelar</Button>
            <Button
              className="flex-1"
              loading={mutCrear.isPending || mutEditar.isPending}
              onClick={handleGuardar}
            >
              {editando ? 'Guardar cambios' : 'Crear garantía'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default function ConfigPage() {
  const queryClient                   = useQueryClient();
  const { data: config, isLoading }   = useConfigQuery();
  const [form,     setForm]           = useState({});
  const [verPin,   setVerPin]         = useState(false);
  const [guardado, setGuardado]       = useState(false);

  const mutation = useMutation({
    mutationFn: (payload) => api.put('/config', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'], exact: false });
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2000);
    },
  });

  if (isLoading) return <Spinner className="py-32" />;

  const valores = { ...config, ...form };
  const set     = (clave, valor) => setForm((f) => ({ ...f, [clave]: valor }));

  const campos = [
    { clave: 'nombre_negocio', label: 'Nombre del negocio', placeholder: 'Mi Tienda' },
    { clave: 'nit',            label: 'NIT',                placeholder: '900123456-1' },
    { clave: 'direccion',      label: 'Dirección',          placeholder: 'Calle 10 # 5-20' },
    { clave: 'telefono',       label: 'Teléfono',           placeholder: '3001234567' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center">
          <Settings size={20} className="text-gray-500" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-gray-900">Configuración</h1>
          <p className="text-xs text-gray-400">Datos del negocio y preferencias</p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">

        {/* Columna izquierda */}
        <div className="w-full lg:max-w-sm flex flex-col gap-6">
          <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-gray-700">Datos del negocio</h2>
            {campos.map(({ clave, label, placeholder }) => (
              <Input
                key={clave}
                label={label}
                placeholder={placeholder}
                value={valores[clave] || ''}
                onChange={(e) => set(clave, e.target.value)}
              />
            ))}
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-gray-700">Seguridad</h2>
            <div className="relative">
              <Input
                label="PIN de eliminación"
                type={verPin ? 'text' : 'password'}
                placeholder="••••"
                value={valores['pin_eliminacion'] || ''}
                onChange={(e) => set('pin_eliminacion', e.target.value)}
              />
              <button
                onClick={() => setVerPin(!verPin)}
                className="absolute right-3 top-8 text-gray-400 hover:text-gray-600"
              >
                {verPin ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button className="flex-1" loading={mutation.isPending} onClick={() => mutation.mutate(form)}>
              <Save size={16} />
              Guardar cambios
            </Button>
            {guardado && <Badge variant="green">✓ Guardado</Badge>}
          </div>

          <PasswordConfig />
        </div>

        {/* Columna derecha */}
        <div className="w-full lg:flex-1 flex flex-col gap-6">
          <SucursalesConfig />
          <GarantiasConfig />
          <UsuariosConfig />
        </div>

      </div>
    </div>
  );
}