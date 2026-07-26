import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { enviarRemesa } from '../../api/redInterna.api';
import { formatCOP } from '../../utils/formatters';
import { useClaveIdempotencia } from '../../utils/claveIdempotencia';
import { Modal }  from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { Send, Info } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// ENVIAR REMESA — el efectivo del local vuelve a la bodega.
//
// Un solo campo. El sugerido viene precargado con lo que el local debe
// liquidar, así el caso normal es: abrir, confirmar.
// ─────────────────────────────────────────────────────────────────────────────

export function ModalRemesa({ sugerido = 0, onCerrar, onListo }) {
  const [valor, setValor] = useState(sugerido > 0 ? Math.round(sugerido) : '');
  const [notas, setNotas] = useState('');
  const [error, setError] = useState('');
  // Evita remesas duplicadas por doble toque o reintento de red.
  const clave = useClaveIdempotencia();

  const enviar = useMutation({
    mutationFn: () => enviarRemesa({
      valor: Number(valor),
      notas: notas.trim() || null,
      clave_idempotencia: clave(),
    }).then((r) => r.data.data),
    onSuccess: onListo,
    onError: (err) => setError(err.response?.data?.error || 'No se pudo enviar la remesa'),
  });

  return (
    <Modal open onClose={onCerrar} title="Enviar efectivo a bodega" size="sm">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">¿Cuánto envías?</label>
          <InputMoneda
            value={valor}
            onChange={(v) => { setValor(v); setError(''); }}
            autoFocus
          />
        </div>

        {sugerido > 0 && Number(valor) !== Math.round(sugerido) && (
          <button
            onClick={() => setValor(Math.round(sugerido))}
            className="text-xs text-blue-600 hover:text-blue-700 text-left"
          >
            Usar lo pendiente por liquidar: {formatCOP(sugerido)}
          </button>
        )}

        <input
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          placeholder="Nota (opcional) — quién lo lleva…"
          className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm
            placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <div className="bg-blue-50 rounded-xl px-4 py-3">
          <p className="text-xs text-blue-700 flex items-start gap-2">
            <Info size={14} className="mt-0.5 flex-shrink-0" />
            <span>
              Sale de tu caja ahora y queda <strong>en tránsito</strong> hasta que
              la bodega confirme que la recibió.
            </span>
          </p>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onCerrar}>Cancelar</Button>
          <Button
            className="flex-1"
            disabled={!(Number(valor) > 0)}
            loading={enviar.isPending}
            onClick={() => enviar.mutate()}
          >
            <Send size={15} /> Enviar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
