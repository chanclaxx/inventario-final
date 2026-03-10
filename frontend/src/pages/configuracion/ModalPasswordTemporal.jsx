import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import api from '../../api/axios.config';
import { useAuth } from '../../context/useAuth';
import { Modal }  from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input }  from '../../components/ui/Input';
import { KeyRound } from 'lucide-react';

export function ModalPasswordTemporal() {
  const { usuario, login } = useAuth();
  const [form,  setForm]  = useState({ password_nueva: '', confirmar: '' });
  const [error, setError] = useState('');

  const abierto = !!usuario?.password_temporal;

  const mutation = useMutation({
    mutationFn: () => api.patch('/usuarios/me/password-temporal', {
      password_nueva: form.password_nueva,
    }),
    onSuccess: async () => {
      // Re-login silencioso para actualizar el token con password_temporal = false
      try {
        await login(usuario.email, form.password_nueva);
      } catch {
        // Si falla el re-login, recargar la página
        window.location.reload();
      }
    },
    onError: (e) => setError(e.response?.data?.error || 'Error al cambiar la contraseña'),
  });

  const handleGuardar = () => {
    setError('');
    if (!form.password_nueva.trim())  return setError('Ingresa una contraseña');
    if (form.password_nueva.length < 6) return setError('Mínimo 6 caracteres');
    if (form.password_nueva !== form.confirmar) return setError('Las contraseñas no coinciden');
    mutation.mutate();
  };

  return (
    <Modal open={abierto} onClose={() => {}} title="" size="sm" hideClose>
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center">
          <KeyRound size={28} className="text-blue-600" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900">Cambia tu contraseña</h2>
          <p className="text-sm text-gray-500 mt-1">
            Estás usando una contraseña temporal. Debes cambiarla antes de continuar.
          </p>
        </div>

        <div className="w-full flex flex-col gap-3 text-left">
          <Input
            label="Nueva contraseña"
            type="password"
            placeholder="Mínimo 6 caracteres"
            value={form.password_nueva}
            onChange={(e) => setForm({ ...form, password_nueva: e.target.value })}
          />
          <Input
            label="Confirmar contraseña"
            type="password"
            placeholder="Repite la contraseña"
            value={form.confirmar}
            onChange={(e) => setForm({ ...form, confirmar: e.target.value })}
          />
        </div>

        {error && <p className="text-sm text-red-500 w-full text-left">{error}</p>}

        <Button
          className="w-full"
          loading={mutation.isPending}
          onClick={handleGuardar}
        >
          Cambiar contraseña
        </Button>
      </div>
    </Modal>
  );
}