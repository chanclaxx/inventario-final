import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { getRemision, recibirRemision } from '../../api/redInterna.api';
import { formatCOP, formatFechaHora } from '../../utils/formatters';
import { Modal }   from '../../components/ui/Modal';
import { Button }  from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { PackageCheck, AlertTriangle } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// RECIBIR — una lista de checks y un botón.
//
// Todo llega marcado. Lo que el usuario DESMARCA queda reportado como "no
// llegó": no se mueve al local, no se le cobra y sigue siendo inventario de la
// bodega. El default hace lo correcto sin que haya que aprender nada.
// ─────────────────────────────────────────────────────────────────────────────

export function ModalRecibir({ remisionId, onCerrar, onListo }) {
  // Se guardan las DESMARCADAS, no las marcadas: así el estado inicial es un
  // Set vacío (todo llega recibido) y no hace falta sincronizarlo con un
  // efecto cuando la remisión termina de cargar.
  const [desmarcadas, setDesmarcadas] = useState(() => new Set());
  const [error, setError] = useState('');

  const { data: remision, isLoading } = useQuery({
    queryKey: ['red-remision', remisionId],
    queryFn:  () => getRemision(remisionId).then((r) => r.data.data),
  });

  const idsRecibidos = () => (remision?.lineas || [])
    .map((l) => Number(l.id))
    .filter((id) => !desmarcadas.has(id));

  const confirmar = useMutation({
    mutationFn: () => recibirRemision(remisionId, {
      lineas_recibidas: idsRecibidos(),
    }).then((r) => r.data),
    onSuccess: (res) => onListo(res.message),
    onError: (err) => setError(err.response?.data?.error || 'No se pudo confirmar'),
  });

  if (isLoading || !remision) {
    return (
      <Modal open onClose={onCerrar} title="Revisar envío" size="md">
        <div className="py-10 flex justify-center"><Spinner /></div>
      </Modal>
    );
  }

  const toggle = (id) => setDesmarcadas((prev) => {
    const s = new Set(prev);
    if (s.has(id)) s.delete(id); else s.add(id);
    return s;
  });

  const marcadasCount = remision.lineas.length - desmarcadas.size;
  const faltantes     = desmarcadas.size;
  const total = remision.lineas
    .filter((l) => !desmarcadas.has(Number(l.id)))
    .reduce((s, l) => s + Number(l.valor_interno || 0) * (l.tipo === 'cantidad' ? l.cantidad : 1), 0);

  return (
    <Modal open onClose={onCerrar} title={`Envío #${remision.numero ?? remision.id}`} size="md">
      <div className="flex flex-col gap-4">
        <div className="bg-blue-50 rounded-xl px-4 py-3">
          <p className="text-sm text-blue-900 font-medium">
            De {remision.sucursal_origen_nombre}
          </p>
          <p className="text-xs text-blue-600 mt-0.5">
            Enviado {formatFechaHora(remision.fecha_emision)}
            {remision.usuario_emisor_nombre ? ` por ${remision.usuario_emisor_nombre}` : ''}
          </p>
          {remision.notas && (
            <p className="text-xs text-blue-700 mt-1.5 italic">{remision.notas}</p>
          )}
        </div>

        <div>
          <p className="text-xs text-gray-400 mb-2">
            Desmarca lo que <strong>no</strong> haya llegado.
          </p>
          <div className="border border-gray-100 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
            {remision.lineas.map((l) => {
              const id = Number(l.id);
              const ok = !desmarcadas.has(id);
              return (
                <label
                  key={id}
                  className={`flex items-center gap-3 px-3 py-3 border-b border-gray-50 last:border-0
                    cursor-pointer transition-colors ${ok ? '' : 'bg-amber-50'}`}
                >
                  <input
                    type="checkbox"
                    checked={ok}
                    onChange={() => toggle(id)}
                    className="w-5 h-5 rounded accent-blue-600 flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${ok ? 'text-gray-800' : 'text-amber-700 line-through'}`}>
                      {l.nombre_producto}
                    </p>
                    <p className="text-xs text-gray-400 font-mono">
                      {l.imei || `${l.cantidad} unidad(es)`}
                    </p>
                  </div>
                  <span className="text-sm text-gray-500">{formatCOP(l.valor_interno)}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="flex justify-between items-center px-1">
          <span className="text-sm text-gray-500">{marcadasCount} recibido(s)</span>
          <span className="text-base font-bold text-gray-900">{formatCOP(total)}</span>
        </div>

        {faltantes > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <p className="text-sm text-amber-700 flex items-start gap-2">
              <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
              <span>
                {faltantes} producto(s) quedarán reportados como <strong>no llegados</strong>.
                Siguen en el inventario de la bodega y no se te cobran.
              </span>
            </p>
          </div>
        )}

        <p className="text-xs text-gray-400 px-1">
          Esta mercancía queda <strong>en consignación</strong>: no es una deuda.
          Solo tendrás que liquidarla cuando la vendas.
        </p>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onCerrar}>Cancelar</Button>
          <Button
            className="flex-1"
            disabled={marcadasCount === 0}
            loading={confirmar.isPending}
            onClick={() => confirmar.mutate()}
          >
            <PackageCheck size={15} /> Confirmar recepción
          </Button>
        </div>
      </div>
    </Modal>
  );
}
