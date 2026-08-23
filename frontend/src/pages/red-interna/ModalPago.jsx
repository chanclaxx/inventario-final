import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { enviarRemesa, getCuentasParaRemesa } from '../../api/redInterna.api';
import { formatCOP } from '../../utils/formatters';
import { useClaveIdempotencia } from '../../utils/claveIdempotencia';
import { Modal }  from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { Send, Info, Truck, Layers } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// PAGARLE A LA BODEGA — un solo modal para los dos gestos
//
//   ABONAR A UN ENVÍO   se abre desde la tarjeta del envío y lleva `envio`.
//                       El pago entra ahí y nada más, como el abono a un
//                       crédito de un cliente.
//
//   PAGAR TODO          se abre desde la cabecera, sin `envio`. El backend lo
//                       reparte entre los envíos abiertos, del más viejo al más
//                       nuevo, y devuelve el reparto para poder contarlo.
//
// Lo que sobre en cualquiera de los dos casos queda como saldo a favor y se
// aplica solo cuando llegue el próximo envío.
// ─────────────────────────────────────────────────────────────────────────────

export function ModalPago({ envio = null, sugerido = 0, onCerrar, onListo }) {
  const tope = envio ? Number(envio.saldo || 0) : Number(sugerido || 0);
  const [valor, setValor] = useState(tope > 0 ? Math.round(tope) : '');
  const [notas, setNotas] = useState('');
  const [error, setError] = useState('');
  const [cuentaId, setCuentaId] = useState(null);
  // Evita pagos duplicados por doble toque o reintento de red.
  const clave = useClaveIdempotencia();

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
      remision_id: envio?.id || undefined,
      clave_idempotencia: clave(),
    }).then((r) => r.data),
    onSuccess: (res) => onListo(res?.message, res?.data),
    onError: (err) => setError(err.response?.data?.error || 'No se pudo enviar el pago'),
  });

  const monto = Number(valor) || 0;
  const excede = tope > 0 && monto > Math.round(tope);

  return (
    <Modal
      open onClose={onCerrar} size="sm"
      title={envio ? `Abonar al envío #${envio.numero ?? envio.id}` : 'Pagarle a la bodega'}
    >
      <div className="flex flex-col gap-4">
        {envio ? (
          <div className="flex items-center gap-2.5 bg-gray-50 rounded-xl px-3.5 py-2.5">
            <Truck size={15} className="text-gray-400 flex-shrink-0" />
            <div className="flex-1 min-w-0 text-xs text-gray-500">
              Este envío debe <strong className="text-gray-800">{formatCOP(envio.saldo)}</strong>
              {Number(envio.abonado) > 0 && <> · ya abonó {formatCOP(envio.abonado)}</>}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 bg-gray-50 rounded-xl px-3.5 py-2.5">
            <Layers size={15} className="text-gray-400 flex-shrink-0" />
            <div className="flex-1 min-w-0 text-xs text-gray-500">
              Se reparte entre tus envíos abiertos, del más viejo al más nuevo.
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">¿Cuánto envías?</label>
          <InputMoneda
            value={valor}
            onChange={(v) => { setValor(v); setError(''); }}
            autoFocus
          />
        </div>

        {tope > 0 && monto !== Math.round(tope) && (
          <button
            onClick={() => setValor(Math.round(tope))}
            className="text-xs text-blue-600 hover:text-blue-700 text-left"
          >
            {envio ? 'Pagar este envío completo' : 'Pagar todo lo que debes'}: {formatCOP(tope)}
          </button>
        )}

        {excede && (
          <p className="text-xs text-amber-600 flex items-start gap-1.5">
            <Info size={12} className="flex-shrink-0 mt-0.5" />
            Estás enviando {formatCOP(monto - Math.round(tope))} de más.
            {envio
              ? ' Lo que sobre pasará a tus otros envíos abiertos.'
              : ' Lo que sobre te queda a favor para el próximo envío.'}
          </p>
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
                ? <>Sale de tu caja ahora y queda <strong>en tránsito</strong> hasta que la bodega confirme que lo recibió.</>
                : <>Sale de <strong>{cuenta?.nombre || 'la cuenta'}</strong> y queda <strong>en tránsito</strong> hasta que la bodega confirme. No pasa por la caja física.</>}
            </span>
          </p>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onCerrar}>Cancelar</Button>
          <Button
            className="flex-1"
            disabled={!(monto > 0)}
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
