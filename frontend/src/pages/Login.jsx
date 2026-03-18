import { useState }       from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth }        from '../context/useAuth.js';
import { Button }         from '../components/ui/Button';
import { Input }          from '../components/ui/Input';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Login() {
  const { login }    = useAuth();
  const navigate     = useNavigate();
  const [form,    setForm]    = useState({ email: '', password: '' });
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!EMAIL_REGEX.test(form.email)) {
      setError('Ingresa un correo electrónico válido');
      return;
    }
    if (form.password.length < 4) {
      setError('La contraseña es demasiado corta');
      return;
    }

    setLoading(true);
    try {
      await login(form.email.trim().toLowerCase(), form.password);
      navigate('/');
    } catch (err) {
      const msg = err?.response?.data?.message;
      setError(msg || 'Correo o contraseña incorrectos');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-white text-2xl font-bold">I</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">InBio</h1>
          <p className="text-gray-500 text-sm mt-1">Inicia sesión para continuar</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input
              label="Correo electrónico"
              type="email"
              placeholder="admin@inventario.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />

            <div className="flex flex-col gap-1">
              <Input
                label="Contraseña"
                type="password"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
              {/* Link de recuperación — alineado a la derecha bajo el input */}
              <div className="flex justify-end">
                <Link
                  to="/recuperar-contrasena"
                  className="text-xs text-blue-600 hover:underline"
                >
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>
            </div>

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
        </div>
      </div>
    </div>
  );
}