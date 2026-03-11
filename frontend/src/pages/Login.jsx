import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/useAuth.js';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─────────────────────────────────────────────
// Vista 1 — Formulario email + password
// ─────────────────────────────────────────────
function FormularioCredenciales({ onSubmit, loading, error }) {
  const [form, setForm] = useState({ email: '', password: '' });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(form.email.trim().toLowerCase(), form.password);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Input
        label="Correo electrónico"
        type="email"
        placeholder="admin@inventario.com"
        value={form.email}
        onChange={(e) => setForm({ ...form, email: e.target.value })}
        required
      />
      <Input
        label="Contraseña"
        type="password"
        placeholder="••••••••"
        value={form.password}
        onChange={(e) => setForm({ ...form, password: e.target.value })}
        required
      />
      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}
      <Button type="submit" loading={loading} className="w-full mt-2" size="lg">
        Iniciar sesión
      </Button>
      <p className="text-center text-sm text-gray-500 mt-4">
        ¿No tienes cuenta?{' '}
        <Link to="/registro" className="text-blue-600 font-medium hover:underline">
          Registrar negocio
        </Link>
      </p>
    </form>
  );
}

// ─────────────────────────────────────────────
// Vista 2 — Selector de negocio
// ─────────────────────────────────────────────
function SelectorNegocio({ negocios, onSeleccionar, onVolver, loading, error }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-500 text-center">
        Tu correo está asociado a varios negocios. Elige a cuál deseas entrar.
      </p>

      <div className="flex flex-col gap-2">
        {negocios.map((n) => (
          <button
            key={n.negocio_id}
            onClick={() => onSeleccionar(n.negocio_id)}
            disabled={loading}
            className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors disabled:opacity-50"
          >
            <span className="font-medium text-gray-900">{n.negocio_nombre}</span>
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <button
        onClick={onVolver}
        disabled={loading}
        className="text-sm text-gray-400 hover:text-gray-600 text-center mt-1 disabled:opacity-50"
      >
        ← Volver
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────
// Página principal
// ─────────────────────────────────────────────
export default function Login() {
  const { login, loginNegocio } = useAuth();
  const navigate = useNavigate();

  const [paso, setPaso]           = useState('credenciales'); // 'credenciales' | 'selector'
  const [credenciales, setCredenciales] = useState({ email: '', password: '' });
  const [negocios, setNegocios]   = useState([]);
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);

  // ── Paso 1 ──
  const handleCredenciales = async (email, password) => {
    setError('');

    if (!EMAIL_REGEX.test(email)) {
      setError('Ingresa un correo electrónico válido');
      return;
    }
    if (password.length < 4) {
      setError('La contraseña es demasiado corta');
      return;
    }

    setLoading(true);
    try {
      const resultado = await login(email, password);

      if (resultado.requiere_seleccion) {
        setCredenciales({ email, password });
        setNegocios(resultado.negocios);
        setPaso('selector');
      } else {
        navigate('/');
      }
    } catch (err) {
      const msg = err?.response?.data?.message;
      setError(msg || 'Correo o contraseña incorrectos');
    } finally {
      setLoading(false);
    }
  };

  // ── Paso 2 ──
  const handleSeleccionarNegocio = async (negocio_id) => {
    setError('');
    setLoading(true);
    try {
      await loginNegocio(credenciales.email, credenciales.password, negocio_id);
      navigate('/');
    } catch (err) {
      const msg = err?.response?.data?.message;
      setError(msg || 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  const handleVolver = () => {
    setError('');
    setNegocios([]);
    setPaso('credenciales');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-white text-2xl font-bold">I</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Inventario</h1>
          <p className="text-gray-500 text-sm mt-1">
            {paso === 'credenciales' ? 'Inicia sesión para continuar' : 'Selecciona tu negocio'}
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          {paso === 'credenciales' ? (
            <FormularioCredenciales
              onSubmit={handleCredenciales}
              loading={loading}
              error={error}
            />
          ) : (
            <SelectorNegocio
              negocios={negocios}
              onSeleccionar={handleSeleccionarNegocio}
              onVolver={handleVolver}
              loading={loading}
              error={error}
            />
          )}
        </div>
      </div>
    </div>
  );
}