import { useState }            from 'react';
import { useNavigate, Link }   from 'react-router-dom';
import { useAuth }             from '../context/useAuth.js';
import { Button }              from '../components/ui/Button';
import { Input }               from '../components/ui/Input';
import { Modal }               from '../components/ui/Modal';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Códigos de plan que NO son error de credenciales ────────────────────────
const CODIGOS_PLAN = new Set(['PLAN_VENCIDO', 'CUENTA_PENDIENTE', 'CUENTA_SUSPENDIDA']);

// ─── Calcular días restantes desde fecha_vencimiento ─────────────────────────
function calcularDiasRestantes(fechaVencimiento) {
  if (!fechaVencimiento) return null;
  const hoy  = new Date();
  const venc = new Date(fechaVencimiento);
  hoy.setHours(0, 0, 0, 0);
  venc.setHours(0, 0, 0, 0);
  return Math.ceil((venc - hoy) / (1000 * 60 * 60 * 24));
}

// ─── Modal aviso días restantes ───────────────────────────────────────────────
function ModalDiasRestantes({ dias, onContinuar }) {
  const esUrgente  = dias <= 3;
  const esAdvertencia = dias <= 7 && dias > 3;

  const colorBg    = esUrgente ? 'bg-red-50 border-red-200' : esAdvertencia ? 'bg-yellow-50 border-yellow-200' : 'bg-blue-50 border-blue-200';
  const colorTexto = esUrgente ? 'text-red-700'             : esAdvertencia ? 'text-yellow-700'                : 'text-blue-700';
  const colorSub   = esUrgente ? 'text-red-500'             : esAdvertencia ? 'text-yellow-600'                : 'text-blue-500';
  const emoji      = esUrgente ? '⚠️' : esAdvertencia ? '🔔' : 'ℹ️';

  return (
    <Modal open onClose={onContinuar} title="Información de tu plan" size="sm">
      <div className="flex flex-col gap-4">
        <div className={`rounded-xl border px-4 py-4 text-center ${colorBg}`}>
          <p className="text-2xl mb-2">{emoji}</p>
          <p className={`text-sm font-semibold ${colorTexto}`}>
            {dias === 0
              ? 'Tu plan vence hoy'
              : dias === 1
              ? 'Te queda 1 día de plan'
              : `Te quedan ${dias} días de plan`}
          </p>
          <p className={`text-xs mt-1 ${colorSub}`}>
            {esUrgente
              ? 'Renueva pronto para no perder el acceso.'
              : esAdvertencia
              ? 'Considera renovar tu suscripción pronto.'
              : 'Tu plan está activo y al día.'}
          </p>
        </div>
        <Button className="w-full" onClick={onContinuar}>
          Entendido, continuar
        </Button>
      </div>
    </Modal>
  );
}

// ─── Página de Login ──────────────────────────────────────────────────────────

export default function Login() {
  const { login }    = useAuth();
  const navigate     = useNavigate();

  const [form,          setForm]          = useState({ email: '', password: '' });
  const [error,         setError]         = useState('');
  const [loading,       setLoading]       = useState(false);
  const [diasRestantes, setDiasRestantes] = useState(null); // null = no mostrar modal

  const handleContinuar = () => {
    setDiasRestantes(null);
    navigate('/');
  };

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
      const resultado = await login(form.email.trim().toLowerCase(), form.password);

      // Calcular días restantes si el backend los retorna en el usuario
      const fechaVenc = resultado?.usuario?.fecha_vencimiento;
      if (fechaVenc) {
        const dias = calcularDiasRestantes(fechaVenc);
        // Mostrar aviso si quedan 7 días o menos
        if (dias !== null && dias <= 7) {
          setDiasRestantes(dias);
          return; // no navegar todavía — esperar que cierren el modal
        }
      }

      navigate('/');
    } catch (err) {
      const code = err?.response?.data?.code;
      const msg  = err?.response?.data?.message || err?.response?.data?.error;

      // Errores de plan — mostrar mensaje real, no el genérico de credenciales
      if (CODIGOS_PLAN.has(code)) {
        setError(msg || 'Tu cuenta tiene un problema con el plan. Contacta al soporte.');
        return;
      }

      // Error real de credenciales
      setError(msg || 'Correo o contraseña incorrectos');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
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
                <div className="flex justify-end">
                  <Link to="/recuperar-contrasena" className="text-xs text-blue-600 hover:underline">
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

      {/* Modal días restantes — aparece después del login exitoso */}
      {diasRestantes !== null && (
        <ModalDiasRestantes dias={diasRestantes} onContinuar={handleContinuar} />
      )}
    </>
  );
}