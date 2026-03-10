import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import {
  LayoutDashboard, Building2, CheckCircle, XCircle,
  Ban, RefreshCw, LogOut, Search, Users, TrendingUp
} from 'lucide-react';
import { Badge }  from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Input }  from '../components/ui/Input';
import { Spinner } from '../components/ui/Spinner';

// ── API helper con token propio de superadmin ─────────
const saApi = axios.create({ baseURL: '/api/superadmin' });

saApi.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('sa_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Helpers ───────────────────────────────────────────
const ESTADO_BADGE = {
  activo:     'green',
  pendiente:  'yellow',
  vencido:    'red',
  suspendido: 'gray',
};

const ESTADO_LABEL = {
  activo:     'Activo',
  pendiente:  'Pendiente',
  vencido:    'Vencido',
  suspendido: 'Suspendido',
};

function formatFecha(fecha) {
  if (!fecha) return '—';
  return new Date(fecha).toLocaleDateString('es-CO', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// ── Pantalla de login superadmin ──────────────────────
function LoginSuperadmin({ onLogin }) {
  const [form,    setForm]    = useState({ email: '', password: '' });
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setError('');
    setLoading(true);
    try {
      const { data } = await axios.post('/api/superadmin/login', form);
      sessionStorage.setItem('sa_token',   data.accessToken);
      sessionStorage.setItem('sa_usuario', JSON.stringify(data.usuario));
      onLogin(data.usuario);
    } catch (e) {
      setError(e.response?.data?.error || 'Credenciales incorrectas');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-white text-2xl font-bold">S</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Superadmin</h1>
          <p className="text-gray-400 text-sm mt-1">Panel de administración</p>
        </div>
        <div className="bg-gray-800 rounded-2xl border border-gray-700 p-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-300">Email</label>
            <input
              type="email"
              placeholder="super@admin.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full px-3 py-2.5 bg-gray-700 border-0 rounded-xl text-sm
                text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-300">Contraseña</label>
            <input
              type="password"
              placeholder="••••••••"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="w-full px-3 py-2.5 bg-gray-700 border-0 rounded-xl text-sm
                text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50
              text-white font-medium py-2.5 rounded-xl transition-colors mt-2"
          >
            {loading ? 'Entrando...' : 'Iniciar sesión'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tarjeta de estadística ────────────────────────────
function StatCard({ label, valor, icon, color }) {
  const Icon = icon;
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-2xl p-5 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
        <Icon size={22} className="text-white" />
      </div>
      <div>
        <p className="text-2xl font-bold text-white">{valor ?? '—'}</p>
        <p className="text-sm text-gray-400">{label}</p>
      </div>
    </div>
  );
}

// ── Fila de negocio ───────────────────────────────────
function FilaNegocio({ negocio, onAprobar, onCambiarEstado, cargando }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-white truncate">{negocio.nombre}</p>
          <Badge variant={ESTADO_BADGE[negocio.estado_plan]}>
            {ESTADO_LABEL[negocio.estado_plan]}
          </Badge>
        </div>
        <p className="text-xs text-gray-400 mt-0.5">{negocio.email}</p>
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          <span className="text-xs text-gray-500">
            {negocio.total_sucursales} sucursal{negocio.total_sucursales !== '1' ? 'es' : ''}
          </span>
          <span className="text-xs text-gray-500">
            {negocio.total_usuarios} usuario{negocio.total_usuarios !== '1' ? 's' : ''}
          </span>
          <span className="text-xs text-gray-500">
            Vence: {formatFecha(negocio.fecha_vencimiento)}
          </span>
        </div>
      </div>

      <div className="flex gap-2 flex-shrink-0 flex-wrap">
        {negocio.estado_plan === 'pendiente' && (
          <button
            onClick={() => onAprobar(negocio.id)}
            disabled={cargando}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700
              disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
          >
            <CheckCircle size={14} />
            Aprobar
          </button>
        )}
        {negocio.estado_plan === 'activo' && (
          <button
            onClick={() => onCambiarEstado(negocio.id, 'suspendido')}
            disabled={cargando}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700
              disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
          >
            <Ban size={14} />
            Suspender
          </button>
        )}
        {(negocio.estado_plan === 'suspendido' || negocio.estado_plan === 'vencido') && (
          <button
            onClick={() => onCambiarEstado(negocio.id, 'activo')}
            disabled={cargando}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700
              disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
          >
            <RefreshCw size={14} />
            Reactivar
          </button>
        )}
      </div>
    </div>
  );
}

// ── Panel principal ───────────────────────────────────
function Panel({ usuario, onLogout }) {
  const queryClient = useQueryClient();
  const [filtroEstado,   setFiltroEstado]   = useState('');
  const [filtroBusqueda, setFiltroBusqueda] = useState('');

  const { data: stats, isLoading: loadingStats } = useQuery({
    queryKey: ['sa_estadisticas'],
    queryFn: () => saApi.get('/estadisticas').then((r) => r.data.data),
  });

  const { data: negocios = [], isLoading: loadingNegocios } = useQuery({
    queryKey: ['sa_negocios', filtroEstado, filtroBusqueda],
    queryFn: () => saApi.get('/negocios', {
      params: { estado: filtroEstado || undefined, busqueda: filtroBusqueda || undefined },
    }).then((r) => r.data.data),
  });

  const mutAprobar = useMutation({
    mutationFn: (id) => saApi.post(`/negocios/${id}/aprobar`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sa_negocios'] });
      queryClient.invalidateQueries({ queryKey: ['sa_estadisticas'] });
    },
  });

  const mutEstado = useMutation({
    mutationFn: ({ id, estado }) => saApi.patch(`/negocios/${id}/estado`, { estado }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sa_negocios'] });
      queryClient.invalidateQueries({ queryKey: ['sa_estadisticas'] });
    },
  });

  const FILTROS = [
    { value: '',           label: 'Todos'      },
    { value: 'pendiente',  label: 'Pendientes' },
    { value: 'activo',     label: 'Activos'    },
    { value: 'vencido',    label: 'Vencidos'   },
    { value: 'suspendido', label: 'Suspendidos'},
  ];

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-3">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-600 rounded-xl flex items-center justify-center">
              <span className="text-white text-sm font-bold">S</span>
            </div>
            <div>
              <p className="text-sm font-semibold">Panel Superadmin</p>
              <p className="text-xs text-gray-400">{usuario.nombre}</p>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-700
              text-gray-400 hover:text-white text-sm transition-colors"
          >
            <LogOut size={16} />
            Salir
          </button>
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-4 py-8 flex flex-col gap-8">

        {/* Estadísticas */}
        {loadingStats ? <Spinner /> : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Total negocios"  valor={stats?.total}      icon={Building2}    color="bg-indigo-600" />
            <StatCard label="Activos"         valor={stats?.activos}    icon={TrendingUp}   color="bg-green-600"  />
            <StatCard label="Pendientes"      valor={stats?.pendientes} icon={LayoutDashboard} color="bg-yellow-600" />
            <StatCard label="Suspendidos"     valor={stats?.suspendidos} icon={Ban}          color="bg-red-600"    />
          </div>
        )}

        {/* Filtros */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Buscar por nombre o email..."
              value={filtroBusqueda}
              onChange={(e) => setFiltroBusqueda(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl
                text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex gap-1 flex-wrap">
            {FILTROS.map((f) => (
              <button
                key={f.value}
                onClick={() => setFiltroEstado(f.value)}
                className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
                  filtroEstado === f.value
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 border border-gray-700 text-gray-400 hover:text-white'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Lista de negocios */}
        {loadingNegocios ? <Spinner /> : (
          <div className="flex flex-col gap-3">
            {negocios.length === 0 ? (
              <p className="text-center text-gray-500 py-12">No hay negocios que mostrar</p>
            ) : (
              negocios.map((negocio) => (
                <FilaNegocio
                  key={negocio.id}
                  negocio={negocio}
                  onAprobar={(id) => mutAprobar.mutate(id)}
                  onCambiarEstado={(id, estado) => mutEstado.mutate({ id, estado })}
                  cargando={mutAprobar.isPending || mutEstado.isPending}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Componente raíz ───────────────────────────────────
export default function SuperAdminPage() {
  const [usuario, setUsuario] = useState(() => {
    try {
      const guardado = sessionStorage.getItem('sa_usuario');
      return guardado ? JSON.parse(guardado) : null;
    } catch { return null; }
  });

  const handleLogout = () => {
    sessionStorage.removeItem('sa_token');
    sessionStorage.removeItem('sa_usuario');
    setUsuario(null);
  };

  if (!usuario) return <LoginSuperadmin onLogin={setUsuario} />;
  return <Panel usuario={usuario} onLogout={handleLogout} />;
}