import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { getTraslado, recibirRemision, mensajeErrorRecepcion } from '../../../api/redInterna.api';
import { formatFechaHora } from '../../../utils/formatters';
import { Modal }   from '../../../components/ui/Modal';
import { Button }  from '../../../components/ui/Button';
import { Spinner } from '../../../components/ui/Spinner';
import { PackageCheck, AlertTriangle, ScanLine, CheckCircle } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// RECIBIR UN TRASLADO — revisar que lo enviado sí llegó
//
// Todo llega marcado, como en un envío: lo que se DESMARCA no entra y sigue en
// la sucursal que lo mandó. Además se puede ESCANEAR: cada IMEI o código leído
// se marca como revisado, y el contador dice cuánto falta por pasar por el
// lector. Lo de cantidad se puede bajar si llegaron menos.
// Recibe por la misma ruta que un envío (`/remisiones/:id/recibir`). Sin un
// peso en pantalla: un traslado no genera cuenta.
// ─────────────────────────────────────────────────────────────────────────────

export function ModalRecibirTraslado({ trasladoId, onCerrar, onListo }) {
  const [desmarcadas, setDesmarcadas] = useState(() => new Set());
  const [cantidades, setCantidades]   = useState({});
  const [revisadas, setRevisadas]     = useState(() => new Set());
  const [texto, setTexto] = useState('');
  const [aviso, setAviso] = useState('');
  const [error, setError] = useState('');

  const { data: t, isLoading } = useQuery({
    queryKey: ['red-traslado', trasladoId],
    queryFn:  () => getTraslado(trasladoId).then((r) => r.data.data),
  });

  const recibir = useMutation({
    mutationFn: () => {
      const lineas = (t?.lineas || []).filter((l) => !desmarcadas.has(l.id));
      return recibirRemision(trasladoId, {
        lineas_recibidas: lineas.map((l) => l.id),
        cantidades: Object.fromEntries(lineas
          .filter((l) => l.tipo === 'cantidad' && cantidades[l.id] != null)
          .map((l) => [l.id, cantidades[l.id]])),
      }).then((r) => r.data);
    },
    onSuccess: () => onListo(),
    onError: (err) => setError(mensajeErrorRecepcion(err, 'No se pudo recibir el traslado')),
  });

  if (isLoading || !t) {
    return (
      <Modal open onClose={onCerrar} title="Revisar traslado" size="md">
        <div className="py-10 flex justify-center"><Spinner /></div>
      </Modal>
    );
  }

  const toggle = (id) => setDesmarcadas((prev) => {
    const s = new Set(prev);
    if (s.has(id)) s.delete(id); else s.add(id);
    return s;
  });

  // El lector es un teclado: lo leído se busca por IMEI o código en ESTE
  // traslado. Si no está, se dice — puede ser justo lo que llegó de más.
  const escanear = () => {
    const q = texto.trim().toUpperCase();
    if (!q) return;
    const l = t.lineas.find((x) => (x.imei && x.imei.toUpperCase() === q) || (x.codigo && x.codigo.toUpperCase() === q));
    setTexto('');
    if (!l) { setAviso(''); setError(`"${texto.trim()}" no viene en este traslado`); return; }
    setError('');
    setRevisadas((prev) => new Set([...prev, l.id]));
    setDesmarcadas((prev) => { const s = new Set(prev); s.delete(l.id); return s; });
    setAviso(`✓ ${l.nombre_producto}${l.imei ? ` · ${l.imei}` : ''}`);
  };

  const marcadas  = t.lineas.filter((l) => !desmarcadas.has(l.id));
  const faltantes = t.lineas.length - marcadas.length;
  const menos = marcadas.filter((l) => l.tipo === 'cantidad' && cantidades[l.id] != null && Number(cantidades[l.id]) < l.cantidad);

  return (
    <Modal open onClose={onCerrar} title={`Traslado T-${t.numero ?? t.id}`} size="md">
      <div className="flex flex-col gap-4">
        <div className="bg-blue-50 rounded-xl px-4 py-3">
          <p className="text-sm text-blue-900 font-medium">De {t.sucursal_origen_nombre}</p>
          <p className="text-xs text-blue-600 mt-0.5">
            Enviado {formatFechaHora(t.fecha_emision)}{t.usuario_emisor_nombre ? ` por ${t.usuario_emisor_nombre}` : ''}
            {' '}· {t.unidades} unidad(es)
          </p>
          {t.notas && <p className="text-xs text-blue-700 mt-1.5 italic">{t.notas}</p>}
        </div>

        <div>
          <div className="flex items-center gap-2 px-3 bg-gray-100 rounded-xl">
            <ScanLine size={15} className="text-gray-400" />
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); escanear(); } }}
              placeholder="Escanea para revisar (opcional)"
              className="flex-1 bg-transparent py-2.5 text-sm focus:outline-none min-w-0"
            />
            {revisadas.size > 0 && (
              <span className="text-xs text-green-700 font-medium flex-shrink-0">{revisadas.size}/{t.lineas.length}</span>
            )}
          </div>
          {aviso && <p className="text-xs text-green-600 mt-1">{aviso}</p>}
        </div>

        <div>
          <p className="text-xs text-gray-400 mb-2">Desmarca lo que <strong>no</strong> haya llegado.</p>
          <div className="border border-gray-100 rounded-xl overflow-hidden max-h-[45vh] overflow-y-auto">
            {t.lineas.map((l) => {
              const ok = !desmarcadas.has(l.id);
              return (
                <div key={l.id}
                  className={`flex items-center gap-3 px-3 py-2.5 border-b border-gray-50 last:border-0 ${ok ? '' : 'bg-amber-50'}`}>
                  <input type="checkbox" checked={ok} onChange={() => toggle(l.id)}
                    className="w-5 h-5 rounded accent-blue-600 flex-shrink-0" aria-label={`Llegó ${l.nombre_producto}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${ok ? 'text-gray-800' : 'text-amber-700 line-through'}`}>
                      {l.nombre_producto}
                    </p>
                    <p className="text-xs text-gray-400 font-mono truncate">{l.imei || l.codigo || ''}</p>
                  </div>
                  {revisadas.has(l.id) && <CheckCircle size={15} className="text-green-500 flex-shrink-0" />}
                  {l.tipo === 'cantidad' && ok && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <input type="number" inputMode="numeric" min={1} max={l.cantidad}
                        value={cantidades[l.id] ?? l.cantidad}
                        onChange={(e) => {
                          const v = Math.floor(Number(e.target.value));
                          if (!Number.isFinite(v)) return;
                          setCantidades((prev) => ({ ...prev, [l.id]: Math.max(1, Math.min(l.cantidad, v)) }));
                        }}
                        className="w-12 text-center text-sm font-semibold border border-gray-200 rounded-lg py-1"
                        aria-label="Cantidad que llegó" />
                      <span className="text-xs text-gray-400">/{l.cantidad}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {(faltantes > 0 || menos.length > 0) && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <p className="text-sm text-amber-700 flex items-start gap-2">
              <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
              <span>
                Lo que no llegó queda en <strong>{t.sucursal_origen_nombre}</strong> y se le avisa para que lo revise.
              </span>
            </p>
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onCerrar}>Cancelar</Button>
          <Button className="flex-1" disabled={!marcadas.length} loading={recibir.isPending}
            onClick={() => recibir.mutate()}>
            <PackageCheck size={15} /> Confirmar llegada
          </Button>
        </div>
      </div>
    </Modal>
  );
}
