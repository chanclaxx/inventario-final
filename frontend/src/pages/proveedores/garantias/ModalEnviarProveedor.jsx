import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Truck } from 'lucide-react';
import api from '../../../api/axios.config';
import { crearEnvioGarantia } from '../../../api/garantiasProveedor.api';
import { Modal }   from '../../../components/ui/Modal';
import { Button }  from '../../../components/ui/Button';
import { mensajeError } from './garantiasUi';
import { refrescarTrasGarantia } from './refrescar';

// ─────────────────────────────────────────────────────────────────────────────
// Armar la caja que sale hacia el proveedor: varias unidades de varios casos,
// UNA guía. Llega con las unidades ya elegidas (las «por enviar» de un
// proveedor); aquí se confirma a quién, con qué transportadora y qué guía.
// Al guardar se ofrece imprimir la guía (POS, PDF o compartir por WhatsApp).
// ─────────────────────────────────────────────────────────────────────────────
export function ModalEnviarProveedor({ lineas, proveedorId: proveedorInicial = null, onClose, onEnviado }) {
  const queryClient = useQueryClient();
  const [proveedorId, setProveedorId] = useState(proveedorInicial ? String(proveedorInicial) : '');
  const [marcadas, setMarcadas] = useState(() => new Set(lineas.map((l) => l.id)));
  const [transportadora, setTransportadora] = useState('');
  const [guia, setGuia]   = useState('');
  const [notas, setNotas] = useState('');
  const [error, setError] = useState('');

  const { data: proveedores = [] } = useQuery({
    queryKey: ['proveedores'],
    queryFn:  () => api.get('/proveedores').then((r) => r.data.data),
    retry: false,
  });

  // Una línea que ya tiene proveedor solo puede ir con ese.
  const compatibles = lineas.filter((l) => !l.proveedor_id || String(l.proveedor_id) === proveedorId);
  const aEnviar = compatibles.filter((l) => marcadas.has(l.id));
  const toggle = (id) => setMarcadas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const mut = useMutation({
    mutationFn: () => crearEnvioGarantia({
      proveedor_id: Number(proveedorId), linea_ids: aEnviar.map((l) => l.id),
      transportadora: transportadora.trim() || null, guia: guia.trim() || null, notas: notas.trim() || null,
    }),
    onSuccess: (r) => { refrescarTrasGarantia(queryClient); onEnviado?.(r.data.data); },
    onError: (err) => setError(mensajeError(err, 'No se pudo registrar el envío')),
  });

  return (
    <Modal open onClose={onClose} title="Enviar al proveedor" size="lg">
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-700">Proveedor *</span>
          <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white">
            <option value="">Elige el proveedor…</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-gray-700">Unidades que van en la caja ({aEnviar.length})</span>
          <div className="border border-gray-100 rounded-xl divide-y divide-gray-50 max-h-64 overflow-y-auto">
            {lineas.map((l) => {
              const ok = !l.proveedor_id || String(l.proveedor_id) === proveedorId;
              return (
                <label key={l.id} className={`flex items-start gap-3 px-3 py-2 ${ok ? 'cursor-pointer' : 'opacity-50'}`}>
                  <input type="checkbox" disabled={!ok} checked={ok && marcadas.has(l.id)} onChange={() => toggle(l.id)} className="mt-1" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">
                      {l.cantidad - l.cantidad_resuelta} × {l.nombre_producto}{l.imei ? ` · ${l.imei}` : ''}
                    </p>
                    <p className="text-xs text-gray-500 truncate">Garantía #{l.reclamo_numero} · {l.falla}</p>
                    {!ok && <p className="text-[11px] text-amber-700">Es de {l.proveedor_nombre}</p>}
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input value={transportadora} onChange={(e) => setTransportadora(e.target.value)} placeholder="Transportadora (opcional)"
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" />
          <input value={guia} onChange={(e) => setGuia(e.target.value)} placeholder="Número de guía (opcional)"
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" />
        </div>
        <input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Notas para el proveedor (opcional)"
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" />

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mut.isPending} disabled={!proveedorId || aEnviar.length === 0}
            onClick={() => { setError(''); mut.mutate(); }}>
            <Truck size={16} /> Registrar envío{aEnviar.length ? ` (${aEnviar.length})` : ''}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

