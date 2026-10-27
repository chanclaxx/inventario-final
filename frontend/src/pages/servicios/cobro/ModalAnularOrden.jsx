import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { anularOrdenServicio } from '../../../api/servicios.api';
import { useAuth } from '../../../context/useAuth';
import { formatCOP } from '../../../utils/formatters';
import { netoRecibido } from '../../../utils/servicioCobro';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { SelectorMetodo } from './piezasServicio';
import { AlertTriangle } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Anular una orden de servicio (una equivocación). La orden no se borra: queda
// «Anulada» con el motivo. Si ya recibió plata, se decide aquí qué pasa con
// ella (decisión del usuario): se le DEVUELVE al cliente (sale de la caja) o
// los abonos FUERON UN ERROR (se anulan y la caja deja de contarlos). Si la
// orden generó su factura, la factura queda cancelada. Admin directo; los
// demás con el PIN (el backend lo vuelve a verificar).
// ─────────────────────────────────────────────────────────────────────────────

export function ModalAnularOrden({ orden, onClose, onExito }) {
  const { esAdminNegocio } = useAuth();
  const esAdmin = esAdminNegocio();
  const [motivo, setMotivo] = useState('');
  const [plata, setPlata] = useState(null);       // 'devolver' | 'anular_abonos'
  const [metodo, setMetodo] = useState('Efectivo');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const neto = netoRecibido(orden.abonos || []);
  const hayPlata = neto > 0;
  const listo = motivo.trim().length >= 3 && (!hayPlata || plata) && (esAdmin || pin.trim());

  const mut = useMutation({
    mutationFn: () => anularOrdenServicio(orden.id, {
      motivo: motivo.trim(),
      ...(hayPlata ? { plata, metodo } : {}),
      ...(esAdmin ? {} : { pin: pin.trim() }),
    }),
    onSuccess: () => { onExito?.(); onClose(); },
    onError: (err) => setError(err.response?.data?.error || 'No se pudo anular la orden'),
  });

  const opcion = (id, titulo, texto) => (
    <button type="button" onClick={() => setPlata(id)}
      className={`text-left p-3 rounded-xl border transition-all
        ${plata === id ? 'bg-red-50 border-red-300' : 'bg-gray-50 border-gray-200 hover:border-gray-300'}`}>
      <p className={`text-sm font-medium ${plata === id ? 'text-red-700' : 'text-gray-700'}`}>{titulo}</p>
      <p className="text-xs text-gray-500 mt-0.5">{texto}</p>
    </button>
  );

  return (
    <Modal open onClose={onClose} title="Anular orden" size="sm">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
          <AlertTriangle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-red-700">
            <p className="font-semibold">#OS-{String(orden.numero ?? orden.id).padStart(4, '0')} · {orden.cliente_nombre}</p>
            <p className="text-xs mt-0.5">
              La orden no se borra: queda anulada con el motivo y deja de contar en reportes.
              {orden.factura_id ? ' Su factura de servicio queda cancelada.' : ''}
            </p>
          </div>
        </div>

        {hayPlata && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-gray-700">
              La orden tiene {formatCOP(neto)} recibidos. ¿Qué pasa con esa plata?
            </p>
            {opcion('devolver', 'Se le devuelve al cliente', `Sale de la caja una devolución de ${formatCOP(neto)}.`)}
            {opcion('anular_abonos', 'Los abonos fueron un error', 'La plata nunca entró: se anulan los abonos y la caja deja de contarlos.')}
            {plata === 'devolver' && (
              <SelectorMetodo value={metodo} onChange={setMetodo} label="¿Cómo se le devuelve?" />
            )}
          </div>
        )}

        <Input label="Motivo *" placeholder="Ej: la orden se creó dos veces"
          value={motivo} onChange={(e) => setMotivo(e.target.value)} />

        {!esAdmin && (
          <Input label="PIN de administrador *" type="password" inputMode="numeric"
            value={pin} onChange={(e) => { setPin(e.target.value); setError(''); }} />
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button variant="danger" className="flex-1" loading={mut.isPending} disabled={!listo}
            onClick={() => { setError(''); mut.mutate(); }}>
            Anular orden
          </Button>
        </div>
      </div>
    </Modal>
  );
}
