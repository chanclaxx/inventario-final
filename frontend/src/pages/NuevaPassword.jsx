import { useState, useEffect }  from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { Button }                from '../components/ui/Button';
import { Input }                 from '../components/ui/Input';
import api                       from '../api/axios.config';
import { CheckCircle, XCircle }  from 'lucide-react';

export default function NuevaPassword() {
  const [searchParams]          = useSearchParams();
  const navigate                = useNavigate();
  const token                   = searchParams.get('token') || '';

  const [password,        setPassword]        = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error,           setError]           = useState('');
  const [loading,         setLoading]         = useState(false);
  const [exito,           setExito]           = useState(false);

  // Si no hay token en la URL redirigir a recuperar contraseña
  useEffect(() => {
    if (!token) navigate('/recuperar-contrasena', { replace: true });
  }, [token, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres');
      return;
    }
    if (password !== passwordConfirm) {
      setError('Las contraseñas no coinciden');
      return;
    }

    setLoading(true);
    try {
      await api.post('/auth/resetear-password', {
        token,
        password_nueva: password,
      });
      setExito(true);
      // Redirigir al login después de 3 segundos
      setTimeout(() => navigate('/login'), 3000);
    } catch (err) {
      const msg = err?.response?.data?.error || err?.response?.data?.message;
      setError(msg || 'El enlace es inválido o ya expiró. Solicita uno nuevo.');
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
          <h1 className="text-2xl font-bold text-gray-900">Nueva contraseña</h1>
          <p className="text-gray-500 text-sm mt-1">
            Elige una contraseña segura para tu cuenta
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          {exito ? (
            // ── Éxito ────────────────────────────────────────────────────────
            <div className="flex flex-col items-center gap-4 py-2 text-center">
              <div className="w-14 h-14 rounded-full bg-green-50 border-2 border-green-200
                flex items-center justify-center">
                <CheckCircle size={26} className="text-green-500" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  ¡Contraseña actualizada!
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  Serás redirigido al inicio de sesión en unos segundos.
                </p>
              </div>
              <Link to="/login"
                className="text-sm text-blue-600 font-medium hover:underline">
                Ir al inicio de sesión
              </Link>
            </div>
          ) : (
            // ── Formulario ───────────────────────────────────────────────────
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                label="Nueva contraseña"
                type="password"
                placeholder="Mínimo 6 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
              <Input
                label="Confirmar contraseña"
                type="password"
                placeholder="Repite la contraseña"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
              />

              {error && (
                <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2
                  flex items-start gap-2">
                  <XCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              <Button type="submit" loading={loading} className="w-full mt-1">
                Guardar contraseña
              </Button>

              <p className="text-center text-sm text-gray-500">
                <Link to="/recuperar-contrasena"
                  className="text-blue-600 font-medium hover:underline">
                  Solicitar un nuevo enlace
                </Link>
              </p>
            </form>
          )}
        </div>

      </div>
    </div>
  );
}