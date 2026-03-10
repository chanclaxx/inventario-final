import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Clock, Ban, Phone } from 'lucide-react';

const CONFIG_POR_CODIGO = {
  PLAN_VENCIDO: {
    icono:     AlertTriangle,
    color:     'text-yellow-500',
    bg:        'bg-yellow-50 border-yellow-200',
    titulo:    'Tu plan ha vencido',
    subtitulo: 'Renueva tu suscripción para continuar usando el sistema.',
  },
  CUENTA_PENDIENTE: {
    icono:     Clock,
    color:     'text-blue-500',
    bg:        'bg-blue-50 border-blue-200',
    titulo:    'Cuenta pendiente de activación',
    subtitulo: 'Tu cuenta está siendo revisada. Te notificaremos cuando esté activa.',
  },
  CUENTA_SUSPENDIDA: {
    icono:     Ban,
    color:     'text-red-500',
    bg:        'bg-red-50 border-red-200',
    titulo:    'Cuenta suspendida',
    subtitulo: 'Tu cuenta ha sido suspendida. Contacta al soporte para más información.',
  },
};

const WHATSAPP_SOPORTE = '573001234567';

export default function PlanBloqueadoPage() {
  const navigate = useNavigate();
  const [error] = useState(() => {
    try {
      const guardado = sessionStorage.getItem('plan_error');
      return guardado ? JSON.parse(guardado) : null;
    } catch {
      return null;
    }
  });

  const cfg = CONFIG_POR_CODIGO[error?.code] || CONFIG_POR_CODIGO.PLAN_VENCIDO;
  const Icono = cfg.icono;

  const handleVerificar = () => {
    sessionStorage.removeItem('plan_error');
    navigate('/login');
  };

  const handleWhatsApp = () => {
    const texto = encodeURIComponent(`Hola, necesito ayuda con mi cuenta. Código: ${error?.code || 'PLAN_VENCIDO'}`);
    window.open(`https://wa.me/${WHATSAPP_SOPORTE}?text=${texto}`, '_blank');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className={`border rounded-2xl p-8 text-center ${cfg.bg}`}>
          <div className="flex justify-center mb-4">
            <Icono size={56} className={cfg.color} />
          </div>

          <h1 className="text-2xl font-bold text-gray-900 mb-2">{cfg.titulo}</h1>
          <p className="text-gray-600 mb-2">{cfg.subtitulo}</p>

          {error?.mensaje && error.mensaje !== cfg.titulo && (
            <p className="text-sm text-gray-500 mb-4">{error.mensaje}</p>
          )}

          {error?.fecha_vencimiento && (
            <p className="text-sm text-gray-500 mb-6">
              Venció el{' '}
              <span className="font-medium">
                {new Date(error.fecha_vencimiento).toLocaleDateString('es-CO', {
                  day: 'numeric', month: 'long', year: 'numeric',
                })}
              </span>
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-3 mt-6">
            <button
              onClick={handleWhatsApp}
              className="flex-1 flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white font-medium py-2.5 px-4 rounded-lg transition-colors"
            >
              <Phone size={18} />
              Contactar soporte
            </button>
            <button
              onClick={handleVerificar}
              className="flex-1 bg-white hover:bg-gray-50 text-gray-700 font-medium py-2.5 px-4 rounded-lg border border-gray-300 transition-colors"
            >
              Ya lo resolví
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}