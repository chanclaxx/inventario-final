import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../api/axios.config';
import { Button } from '../components/ui/Button';
import { Input }  from '../components/ui/Input';

const PLANES = [
  {
    id:          'basico',
    nombre:      'Plan Básico',
    precio:      '$59.900 COP/mes',
    sucursales:  1,
    usuarios:    5,
    descripcion: '1 sucursal, hasta 5 usuarios',
  },
  {
    id:          'pro',
    nombre:      'Plan Pro',
    precio:      '$99.900 COP/mes',
    sucursales:  4,
    usuarios:    15,
    descripcion: 'Hasta 4 sucursales, hasta 15 usuarios',
  },
];

const FORM_INICIAL = {
  nombre:    '',
  nit:       '',
  telefono:  '',
  direccion: '',
  email:     '',
  plan:      'basico',
};

export default function RegisterPage() {
  const navigate = useNavigate();
  const [form,    setForm]    = useState(FORM_INICIAL);
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const [exitoso, setExitoso] = useState(false);

  const set = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }));

  const handleSubmit = async () => {
    setError('');
    if (!form.nombre.trim())   return setError('El nombre del negocio es requerido');
    if (!form.email.trim())    return setError('El email es requerido');
    if (!form.telefono.trim()) return setError('El teléfono es requerido');
    if (!form.plan)            return setError('Selecciona un plan');

    setLoading(true);
    try {
      await api.post('/registro', form);
      setExitoso(true);
    } catch (e) {
      setError(e.response?.data?.error || 'Error al registrar. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  if (exitoso) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 flex flex-col items-center gap-4">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
              <span className="text-3xl">✓</span>
            </div>
            <h2 className="text-xl font-bold text-gray-900">¡Registro recibido!</h2>
            <p className="text-sm text-gray-500">
              Hemos recibido tu solicitud con el <strong>{PLANES.find(p => p.id === form.plan)?.nombre}</strong>.
              Te notificaremos a <strong>{form.email}</strong> cuando tu cuenta sea aprobada.
            </p>
            <Button className="w-full mt-2" onClick={() => navigate('/login')}>
              Volver al inicio de sesión
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-white text-2xl font-bold">I</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Crear cuenta</h1>
          <p className="text-gray-500 text-sm mt-1">Registra tu negocio para empezar</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col gap-5">

          {/* Selector de plan */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-gray-700">Selecciona tu plan</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {PLANES.map((plan) => {
                const seleccionado = form.plan === plan.id;
                return (
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => set('plan', plan.id)}
                    className={`text-left p-4 rounded-xl border-2 transition-all ${
                      seleccionado
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <p className={`font-semibold text-sm ${seleccionado ? 'text-blue-700' : 'text-gray-900'}`}>
                      {plan.nombre}
                    </p>
                    <p className={`text-xs mt-0.5 ${seleccionado ? 'text-blue-600' : 'text-gray-500'}`}>
                      {plan.descripcion}
                    </p>
                    <p className={`text-sm font-bold mt-2 ${seleccionado ? 'text-blue-700' : 'text-gray-700'}`}>
                      {plan.precio}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Separador */}
          <div className="border-t border-gray-100" />

          {/* Campos del formulario */}
          <Input
            label="Nombre del negocio"
            placeholder="Mi Tienda S.A.S"
            value={form.nombre}
            onChange={(e) => set('nombre', e.target.value)}
          />
          <Input
            label="NIT"
            placeholder="900123456-1"
            value={form.nit}
            onChange={(e) => set('nit', e.target.value)}
          />
          <Input
            label="Teléfono"
            placeholder="3001234567"
            value={form.telefono}
            onChange={(e) => set('telefono', e.target.value)}
          />
          <Input
            label="Dirección"
            placeholder="Calle 10 # 5-20"
            value={form.direccion}
            onChange={(e) => set('direccion', e.target.value)}
          />
          <Input
            label="Email de contacto"
            type="email"
            placeholder="admin@minegocio.com"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
          />

          {error && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <Button loading={loading} className="w-full mt-1" onClick={handleSubmit}>
            Enviar solicitud
          </Button>
        </div>

        <p className="text-center text-sm text-gray-500 mt-6">
          ¿Ya tienes cuenta?{' '}
          <Link to="/login" className="text-blue-600 font-medium hover:underline">
            Iniciar sesión
          </Link>
        </p>

      </div>
    </div>
  );
}