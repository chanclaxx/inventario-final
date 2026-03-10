import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { getConfig } from '../../api/config.api';

/**
 * Modal de confirmación con PIN de administrador.
 *
 * Props:
 *  - titulo:      string  — título del modal
 *  - descripcion: string  — texto de advertencia
 *  - onConfirm:   (pin) => Promise<void>  — se llama cuando el PIN es correcto
 *  - onClose:     () => void
 *  - extraContent: ReactNode — contenido adicional antes del PIN (ej: input cantidad)
 *  - loading:     boolean
 */
export function ModalPinEliminacion({ titulo, descripcion, onConfirm, onClose, extraContent, loading }) {
  const [pin, setPin]       = useState('');
  const [error, setError]   = useState('');
  const [verificando, setVerificando] = useState(false);

  const handleConfirmar = async () => {
    if (!pin) {
      setError('Ingresa el PIN');
      return;
    }
    setVerificando(true);
    setError('');
    try {
      const res = await getConfig();
      const config = res.data.data;
      const pinCorrecto = config?.pin_eliminacion || '1234';
      if (pin !== pinCorrecto) {
        setError('PIN incorrecto');
        setVerificando(false);
        return;
      }
      await onConfirm(pin);
    } catch {
      setError('Error al verificar el PIN');
    } finally {
      setVerificando(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={titulo} size="sm">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 bg-red-50 rounded-xl p-3">
          <ShieldAlert size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{descripcion}</p>
        </div>

        {extraContent}

        <Input
          label="PIN de administrador"
          type="password"
          placeholder="••••"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleConfirmar()}
          autoFocus
        />

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            loading={verificando || loading}
            onClick={handleConfirmar}
          >
            Confirmar
          </Button>
        </div>
      </div>
    </Modal>
  );
}