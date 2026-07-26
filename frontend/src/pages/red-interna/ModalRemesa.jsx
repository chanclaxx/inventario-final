import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { enviarRemesa, getCuentasParaRemesa } from '../../api/redInterna.api';
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
  const [cuentaId, setCuentaId] = useState(null);
  // Evita remesas duplicadas por doble toque o reintento de red.
  const clave = useClaveIdempotencia();

  // Cuentas del local: efectivo, Nequi, banco… Antes toda remesa asumía
  // efectivo y un local que remitía por transferencia no tenía cómo registrarlo.
  const { data: cuentas = [] } = useQuery({
    queryKey: ['red-cuentas-remesa'],
    queryFn:  () => getCuentasParaRemesa().then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
  });
  // La selección se DERIVA en vez de guardarse con un efecto: mientras el
  // usuario no elija, manda la cuenta de efectivo (el caso más común).
  const porDefecto = cuentas.find((c) => c.es_efectivo) || cuentas[0] || null;
  const cuenta = cuentas.find((c) => c.id === cuentaId) || porDefecto;

  const enviar = useMutation({
    mutationFn: () => enviarRemesa({
      valor: Number(valor),
      notas: notas.trim() || null,
      cuenta_origen_id: cuenta?.id || undefined,
      metodo: cuenta?.metodo_sugerido || undefined,
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

        {cuentas.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">¿Cómo lo envías?</label>
            <div className="flex flex-wrap gap-1.5">
              {cuentas.map((c) => (
                <button
                  key={c.id} onClick={() => setCuentaId(c.id)}
                  className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all
                    ${cuenta?.id === c.id ? 'bg-blue-600 border-blue-600 text-white'
                                        : 'bg-white border-gray-200 text-gray-700 hover:border-blue-300'}`}
                >
                  {c.nombre}
                </button>
              ))}
            </div>
          </div>
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
              {cuenta?.es_efectivo
                ? <>Sale de tu caja ahora y queda <strong>en tránsito</strong> hasta que la bodega confirme que la recibió.</>
                : <>Sale de <strong>{cuenta?.nombre || 'la cuenta'}</strong> y queda <strong>en tránsito</strong> hasta que la bodega confirme. No pasa por la caja física.</>}
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
