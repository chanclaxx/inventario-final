import { useState }        from 'react';
import { Link }             from 'react-router-dom';
import { Button }           from '../components/ui/Button';
import { Input }            from '../components/ui/Input';
import api                  from '../api/axios.config';
import { CheckCircle }      from 'lucide-react';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RecuperarPassword() {
  const [email,   setEmail]   = useState('');
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const [enviado, setEnviado] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!EMAIL_REGEX.test(email.trim())) {
      setError('Ingresa un correo electrónico válido');
      return;
    }

    setLoading(true);
    try {
      await api.post('/auth/recuperar-password', {
        email: email.trim().toLowerCase(),
      });
      // Siempre mostramos éxito — el backend no revela si el email existe
      setEnviado(true);
    } catch {
      setError('Ocurrió un error. Intenta de nuevo en unos minutos.');
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
          <h1 className="text-2xl font-bold text-gray-900">Recuperar contraseña</h1>
          <p className="text-gray-500 text-sm mt-1">
            Te enviaremos un enlace para restablecer tu contraseña
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          {enviado ? (
            // ── Estado de éxito ──────────────────────────────────────────────
            <div className="flex flex-col items-center gap-4 py-2 text-center">
              <div className="w-14 h-14 rounded-full bg-green-50 border-2 border-green-200
                flex items-center justify-center">
                <CheckCircle size={26} className="text-green-500" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Revisa tu correo</p>
                <p className="text-sm text-gray-500 mt-1">
                  Si la cuenta existe, recibirás las instrucciones en los próximos minutos.
                  El enlace expira en <strong>1 hora</strong>.
                </p>
              </div>
              <p className="text-xs text-gray-400">
                ¿No llegó? Revisa tu carpeta de spam.
              </p>
              <Link to="/login"
                className="text-sm text-blue-600 font-medium hover:underline mt-1">
                Volver al inicio de sesión
              </Link>
            </div>
          ) : (
            // ── Formulario ───────────────────────────────────────────────────
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                label="Correo electrónico"
                type="email"
                placeholder="admin@inventario.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />

              {error && (
                <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              <Button type="submit" loading={loading} className="w-full mt-1">
                Enviar enlace
              </Button>

              <p className="text-center text-sm text-gray-500">
                <Link to="/login" className="text-blue-600 font-medium hover:underline">
                  Volver al inicio de sesión
                </Link>
              </p>
            </form>
          )}
        </div>

      </div>
    </div>
  );
}