import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import api from '../../api/axios.config';
import { useAuth } from '../../context/useAuth';
import { Button } from '../../components/ui/Button';
import { Input }  from '../../components/ui/Input';
import { Badge }  from '../../components/ui/Badge';
import { KeyRound } from 'lucide-react';

export function PasswordConfig() {
  useAuth();
  const [form,     setForm]     = useState({ password_actual: '', password_nueva: '', confirmar: '' });
  const [error,    setError]    = useState('');
  const [guardado, setGuardado] = useState(false);

  const mutation = useMutation({
    mutationFn: () => api.patch('/usuarios/me/password', {
      password_actual: form.password_actual,
      password_nueva:  form.password_nueva,
    }),
    onSuccess: () => {
      setForm({ password_actual: '', password_nueva: '', confirmar: '' });
      setError('');
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2000);
    },
    onError: (e) => setError(e.response?.data?.error || 'Error al cambiar la contraseña'),
  });

  const handleGuardar = () => {
    setError('');
    if (!form.password_actual.trim()) return setError('Ingresa tu contraseña actual');
    if (form.password_nueva.length < 6) return setError('Mínimo 6 caracteres');
    if (form.password_nueva !== form.confirmar) return setError('Las contraseñas no coinciden');
    mutation.mutate();
  };

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <KeyRound size={16} className="text-gray-400" />
        <h2 className="text-sm font-semibold text-gray-700">Cambiar contraseña</h2>
      </div>

      <Input
        label="Contraseña actual"
        type="password"
        placeholder="••••••••"
        value={form.password_actual}
        onChange={(e) => setForm({ ...form, password_actual: e.target.value })}
      />
      <Input
        label="Nueva contraseña"
        type="password"
        placeholder="Mínimo 6 caracteres"
        value={form.password_nueva}
        onChange={(e) => setForm({ ...form, password_nueva: e.target.value })}
      />
      <Input
        label="Confirmar nueva contraseña"
        type="password"
        placeholder="Repite la contraseña"
        value={form.confirmar}
        onChange={(e) => setForm({ ...form, confirmar: e.target.value })}
      />

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex items-center gap-3">
        <Button className="flex-1" loading={mutation.isPending} onClick={handleGuardar}>
          Cambiar contraseña
        </Button>
        {guardado && <Badge variant="green">✓ Actualizada</Badge>}
      </div>
    </div>
  );
}