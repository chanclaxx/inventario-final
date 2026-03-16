import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/axios.config';
import { getGarantias, crearGarantia, actualizarGarantia, eliminarGarantia } from '../../api/garantias.api';
import { getLineas, crearLinea, actualizarLinea, eliminarLinea }             from '../../api/productos.api';
import { UsuariosConfig }   from './UsuariosConfig';
import { SucursalesConfig } from './SucursalesConfig';
import { PasswordConfig }   from './PasswordConfig';
import { Button }  from '../../components/ui/Button';
import { Input }   from '../../components/ui/Input';
import { Modal }   from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import { Badge }   from '../../components/ui/Badge';
import {
  Settings, Save, Eye, EyeOff, Plus, Trash2,
  GripVertical, ToggleLeft, ToggleRight, Tag, Lock,
} from 'lucide-react';

// ─── Hook compartido de config ────────────────────────────────────────────────
function useConfigQuery() {
  return useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
  });
}

// ─── Toggle reutilizable ──────────────────────────────────────────────────────
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

// ─── Toggle solo lectura — no interactivo ─────────────────────────────────────
// Muestra el estado actual pero no permite modificarlo.
// Usado para features controladas exclusivamente por el superadmin.

function ToggleReadOnly({ enabled, label, description }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-gray-700">{label}</span>
          <Lock size={11} className="text-gray-300" />
        </div>
        {description && <span className="text-xs text-gray-400">{description}</span>}
        <span className="text-xs text-gray-300 mt-0.5">
          Solo puede ser modificado por el administrador del sistema
        </span>
      </div>
      <div className="flex-shrink-0 cursor-not-allowed opacity-60">
        {enabled
          ? <ToggleRight size={28} className="text-blue-400" />
          : <ToggleLeft  size={28} className="text-gray-300" />}
      </div>
    </div>
  );
}

// ─── Líneas de producto ───────────────────────────────────────────────────────
function LineasConfig() {
  const queryClient               = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editando,  setEditando]  = useState(null);
  const [nombre,    setNombre]    = useState('');
  const [error,     setError]     = useState('');

  const { data: lineas = [] } = useQuery({
    queryKey: ['lineas'],
    queryFn:  () => getLineas().then((r) => r.data.data),
  });

  const mutCrear = useMutation({
    mutationFn: () => crearLinea(nombre),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lineas'], exact: false });
      cerrarModal();
    },
    onError: (e) => setError(e.response?.data?.error || 'Error al crear la línea'),
  });

  const mutEditar = useMutation({
    mutationFn: () => actualizarLinea(editando.id, nombre),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lineas'], exact: false });
      cerrarModal();
    },
    onError: (e) => setError(e.response?.data?.error || 'Error al actualizar la línea'),
  });

  const mutEliminar = useMutation({
    mutationFn: (id) => eliminarLinea(id),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['lineas'], exact: false }),
    onError:    (e) => alert(e.response?.data?.error || 'Error al eliminar la línea'),
  });

  const abrirNuevo = () => {
    setEditando(null);
    setNombre('');
    setError('');
    setModalOpen(true);
  };

  const abrirEditar = (l) => {
    setEditando(l);
    setNombre(l.nombre);
    setError('');
    setModalOpen(true);
  };

  const cerrarModal = () => {
    setModalOpen(false);
    setEditando(null);
    setNombre('');
    setError('');
  };

  const handleGuardar = () => {
    if (!nombre.trim()) return setError('El nombre es requerido');
    editando ? mutEditar.mutate() : mutCrear.mutate();
  };

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag size={16} className="text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-700">Líneas de producto</h2>
        </div>
        <button
          onClick={abrirNuevo}
          className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center
            hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} className="text-white" />
        </button>
      </div>

      <p className="text-xs text-gray-400 -mt-2">
        Agrupa tus productos por línea. Ej: Consolas, Videojuegos, Accesorios.
      </p>

      {lineas.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">Sin líneas configuradas</p>
      ) : (
        <div className="flex flex-col gap-2">
          {lineas.map((l) => (
            <div key={l.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
              <GripVertical size={15} className="text-gray-300 flex-shrink-0" />
              <p className="text-sm font-medium text-gray-800 flex-1 min-w-0 truncate">
                {l.nombre}
              </p>
              <div className="flex gap-1 flex-shrink-0">
                <button
                  onClick={() => abrirEditar(l)}
                  className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400
                    hover:text-gray-600 transition-colors"
                  title="Editar línea"
                >
                  <Settings size={14} />
                </button>
                <button
                  onClick={() => mutEliminar.mutate(l.id)}
                  disabled={mutEliminar.isPending}
                  className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400
                    hover:text-red-500 transition-colors disabled:opacity-50"
                  title="Eliminar línea"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={cerrarModal}
        title={editando ? 'Editar línea' : 'Nueva línea'}
        size="sm"
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Nombre de la línea"
            placeholder="Ej: Consolas, Videojuegos, Accesorios..."
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleGuardar(); }}
            autoFocus
          />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={cerrarModal}>
              Cancelar
            </Button>
            <Button
              className="flex-1"
              loading={mutCrear.isPending || mutEditar.isPending}
              onClick={handleGuardar}
              disabled={!nombre.trim()}
            >
              {editando ? 'Guardar cambios' : 'Crear línea'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Garantías ────────────────────────────────────────────────────────────────
function GarantiasConfig() {
  const queryClient               = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editando,  setEditando]  = useState(null);
  const [form,      setForm]      = useState({ titulo: '', texto: '', orden: 0, lineas: [] });
  const [error,     setError]     = useState('');

  const { data: garantias = [] } = useQuery({
    queryKey: ['garantias'],
    queryFn:  () => getGarantias().then((r) => r.data.data),
  });

  const { data: lineas = [] } = useQuery({
    queryKey: ['lineas'],
    queryFn:  () => getLineas().then((r) => r.data.data),
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
    setForm({ titulo: '', texto: '', orden: garantias.length, lineas: [] });
    setError('');
    setModalOpen(true);
  };

  const abrirEditar = (g) => {
    setEditando(g);
    setForm({
      titulo: g.titulo,
      texto:  g.texto,
      orden:  g.orden,
      lineas: g.lineas || [],
    });
    setError('');
    setModalOpen(true);
  };

  const cerrarModal = () => {
    setModalOpen(false);
    setEditando(null);
    setError('');
  };

  const handleGuardar = () => {
    if (!form.titulo.trim()) return setError('El título es requerido');
    if (!form.texto.trim())  return setError('El texto es requerido');
    if (!form.lineas.length) return setError('Selecciona al menos una línea');
    editando ? mutEditar.mutate() : mutCrear.mutate();
  };

  const toggleLinea = (lineaId) => {
    setForm((f) => {
      const yaEsta = f.lineas.includes(lineaId);
      return {
        ...f,
        lineas: yaEsta
          ? f.lineas.filter((id) => id !== lineaId)
          : [...f.lineas, lineaId],
      };
    });
  };

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Garantías y Términos</h2>
        <button
          onClick={abrirNuevo}
          className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center
            hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} className="text-white" />
        </button>
      </div>

      {garantias.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">Sin garantías configuradas</p>
      ) : (
        <div className="flex flex-col gap-2">
          {[...garantias].sort((a, b) => a.orden - b.orden).map((g) => {
            const lineasAsignadas = lineas
              .filter((l) => g.lineas?.includes(l.id))
              .map((l) => l.nombre);

            return (
              <div key={g.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
                <GripVertical size={16} className="text-gray-300 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{g.titulo}</p>
                  <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{g.texto}</p>
                  {lineasAsignadas.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {lineasAsignadas.map((nombre) => (
                        <span key={nombre}
                          className="text-xs bg-blue-50 text-blue-600 border border-blue-100
                            px-2 py-0.5 rounded-full">
                          {nombre}
                        </span>
                      ))}
                    </div>
                  )}
                  {!lineasAsignadas.length && (
                    <p className="text-xs text-yellow-500 mt-1">Sin líneas asignadas</p>
                  )}
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button
                    onClick={() => abrirEditar(g)}
                    className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400
                      hover:text-gray-600 transition-colors"
                  >
                    <Settings size={14} />
                  </button>
                  <button
                    onClick={() => mutEliminar.mutate(g.id)}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400
                      hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={cerrarModal}
        title={editando ? 'Editar Garantía' : 'Nueva Garantía'}
        size="md"
      >
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

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-gray-700">
              Líneas que aplican
              <span className="text-gray-400 font-normal text-xs ml-1">
                (la garantía aparecerá en facturas con productos de estas líneas)
              </span>
            </label>
            {lineas.length === 0 ? (
              <p className="text-xs text-gray-400">
                No hay líneas configuradas. Crea líneas primero en la sección anterior.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {lineas.map((l) => {
                  const lineaId     = l.id;
                  const lineaNombre = l.nombre;
                  const marcada     = form.lineas.includes(lineaId);
                  return (
                    <label
                      key={lineaId}
                      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer
                        transition-colors
                        ${marcada
                          ? 'bg-blue-50 border-blue-200'
                          : 'bg-gray-50 border-gray-100 hover:border-gray-200'}`}
                    >
                      <input
                        type="checkbox"
                        checked={marcada}
                        onChange={() => toggleLinea(lineaId)}
                        className="accent-blue-600 w-4 h-4 flex-shrink-0"
                      />
                      <span className={`text-sm font-medium ${marcada ? 'text-blue-700' : 'text-gray-700'}`}>
                        {lineaNombre}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

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

// ─── Campos opcionales del formulario de venta ────────────────────────────────
// campo_email_cliente es controlado exclusivamente por el superadmin como
// servicio de pago — se muestra en solo lectura con ToggleReadOnly.
// Los demás campos siguen siendo configurables por el negocio.

const CAMPOS_EDITABLES = [
  {
    clave:       'campo_direccion_cliente',
    label:       'Dirección del cliente',
    description: 'Muestra el campo de dirección al registrar una venta',
  },
];

const CAMPOS_READONLY = [
  {
    clave:       'campo_email_cliente',
    label:       'Envío de facturas por email',
    description: 'Envía automáticamente la factura al correo del cliente',
  },
];

function CamposFormularioConfig({ valores, set }) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-gray-700">Campos del formulario de venta</h2>
      <p className="text-xs text-gray-400 -mt-2">
        Activa los campos adicionales que quieres recolectar al facturar
      </p>
      <div className="flex flex-col gap-4">
        {/* Campos editables por el negocio */}
        {CAMPOS_EDITABLES.map((campo) => {
          const clave   = campo.clave;
          const enabled = valores[clave] === '1';
          return (
            <Toggle
              key={clave}
              label={campo.label}
              description={campo.description}
              enabled={enabled}
              onChange={(val) => set(clave, val ? '1' : '0')}
            />
          );
        })}

        {/* Campos controlados por superadmin — solo lectura */}
        {CAMPOS_READONLY.length > 0 && (
          <div className="border-t border-gray-100 pt-4 flex flex-col gap-4">
            {CAMPOS_READONLY.map((campo) => {
              const clave   = campo.clave;
              const enabled = valores[clave] === '1';
              return (
                <ToggleReadOnly
                  key={clave}
                  label={campo.label}
                  description={campo.description}
                  enabled={enabled}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function ConfigPage() {
  const queryClient                 = useQueryClient();
  const { data: config, isLoading } = useConfigQuery();
  const [form,     setForm]         = useState({});
  const [verPin,   setVerPin]       = useState(false);
  const [guardado, setGuardado]     = useState(false);

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

  const camposNegocio = [
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

        {/* ── Columna izquierda ── */}
        <div className="w-full lg:max-w-sm flex flex-col gap-6">
          <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-gray-700">Datos del negocio</h2>
            {camposNegocio.map(({ clave, label, placeholder }) => (
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

          <CamposFormularioConfig valores={valores} set={set} />

          <div className="flex items-center gap-3">
            <Button
              className="flex-1"
              loading={mutation.isPending}
              onClick={() => mutation.mutate(form)}
            >
              <Save size={16} />
              Guardar cambios
            </Button>
            {guardado && <Badge variant="green">✓ Guardado</Badge>}
          </div>

          <PasswordConfig />
        </div>

        {/* ── Columna derecha ── */}
        <div className="w-full lg:flex-1 flex flex-col gap-6">
          <SucursalesConfig />
          <LineasConfig />
          <GarantiasConfig />
          <UsuariosConfig />
        </div>

      </div>
    </div>
  );
}