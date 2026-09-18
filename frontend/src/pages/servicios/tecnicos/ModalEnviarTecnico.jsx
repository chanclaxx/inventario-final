import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Search, X, Wrench } from 'lucide-react';
import {
  getTecnicos, buscarDisponibles, enviarATecnico, enviarOrdenATecnico,
} from '../../../api/tecnicos.api';
import { Modal }       from '../../../components/ui/Modal';
import { Button }      from '../../../components/ui/Button';
import { InputMoneda } from '../../../components/ui/InputMoneda';
import { Spinner }     from '../../../components/ui/Spinner';
import { useMetodosPago } from '../../../hooks/useMetodosPago';
import { formatCOP }   from '../../../utils/formatters';

// ─────────────────────────────────────────────────────────────────────────────
// Mandar equipos a un técnico externo. Dos puertas, un solo modal:
//   · desde Técnicos: equipos DEL INVENTARIO (sin vender, sin prestar), uno o
//     varios, cada uno con su trabajo.
//   · desde una orden de cliente (`orden`): su equipo, que puede ser uno que
//     vendimos (queda bloqueado) o uno del cliente.
// El anticipo es opcional y solo aparece si el usuario puede pagar.
// ─────────────────────────────────────────────────────────────────────────────
export function ModalEnviarTecnico({ orden = null, puedePagar = false, onClose, onEnviado }) {
  const metodos = useMetodosPago();
  const [tecnicoId, setTecnicoId] = useState('');
  const [busqueda, setBusqueda]   = useState('');
  const [equipos, setEquipos]     = useState([]);          // [{ serial_id, imei, producto_nombre, trabajo }]
  const [trabajoOrden, setTrabajoOrden] = useState(orden?.falla_reportada ?? '');
  const [notas, setNotas]         = useState('');
  const [anticipo, setAnticipo]   = useState('');
  const [metodo, setMetodo]       = useState('Efectivo');
  const [error, setError]         = useState('');

  const { data: tecnicos = [], isLoading: cargandoTec } = useQuery({
    queryKey: ['tecnicos'],
    queryFn:  () => getTecnicos().then((r) => r.data.data),
  });

  const q = busqueda.trim();
  const { data: encontrados = [], isFetching } = useQuery({
    queryKey: ['tecnicos-disponibles', q],
    queryFn:  () => buscarDisponibles(q).then((r) => r.data.data),
    enabled:  !orden && q.length >= 2,
  });

  const agregar = (s) => {
    if (equipos.some((e) => e.serial_id === s.id)) return;
    setEquipos((l) => [...l, { serial_id: s.id, imei: s.imei, producto_nombre: s.producto_nombre, trabajo: '' }]);
    setBusqueda('');
  };
  const quitar = (id) => setEquipos((l) => l.filter((e) => e.serial_id !== id));
  const setTrabajo = (id, t) => setEquipos((l) => l.map((e) => (e.serial_id === id ? { ...e, trabajo: t } : e)));

  const mut = useMutation({
    mutationFn: () => {
      const extra = {
        tecnico_id: Number(tecnicoId),
        notas:      notas || null,
        anticipo:   puedePagar && Number(anticipo) > 0 ? { valor: Number(anticipo), metodo } : null,
      };
      return orden
        ? enviarOrdenATecnico(orden.id, { ...extra, trabajo: trabajoOrden })
        : enviarATecnico({ ...extra, equipos: equipos.map(({ serial_id, trabajo }) => ({ serial_id, trabajo })) });
    },
    onSuccess: (r) => { onEnviado?.(r.data.data); onClose(); },
    onError:   (err) => setError(err.response?.data?.error || 'No se pudo enviar al técnico'),
  });

  const listo = tecnicoId && (orden
    ? trabajoOrden.trim()
    : equipos.length > 0 && equipos.every((e) => e.trabajo.trim()));

  return (
    <Modal open onClose={onClose} size="lg"
      title={orden ? `Enviar la orden #OS-${String(orden.numero ?? orden.id).padStart(4, '0')} a un técnico` : 'Enviar equipos a un técnico'}>
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-700">Técnico *</span>
          {cargandoTec ? <Spinner className="py-2" /> : (
            <select value={tecnicoId} onChange={(e) => setTecnicoId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white">
              <option value="">Elige un técnico…</option>
              {tecnicos.filter((t) => t.activo).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}{t.especialidad ? ` · ${t.especialidad}` : ''}
                  {t.resumen?.equipos_en_tecnico ? ` · tiene ${t.resumen.equipos_en_tecnico}` : ''}
                </option>
              ))}
            </select>
          )}
          {!cargandoTec && !tecnicos.some((t) => t.activo) && (
            <span className="text-xs text-amber-600">Todavía no hay técnicos. Créalos en la pestaña Técnicos.</span>
          )}
        </label>

        {orden ? (
          <div className="flex flex-col gap-2">
            <div className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700">
              <p className="font-medium">{[orden.equipo_tipo, orden.equipo_nombre].filter(Boolean).join(' ') || 'Equipo del cliente'}</p>
              <p className="text-xs text-gray-500">{orden.cliente_nombre}{orden.equipo_serial ? ` · IMEI ${orden.equipo_serial}` : ''}</p>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-gray-700">Trabajo a realizar *</span>
              <textarea rows={2} value={trabajoOrden} onChange={(e) => setTrabajoOrden(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" />
            </label>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-gray-700">Equipos *</span>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Busca por IMEI o por nombre del equipo…"
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm" />
            </div>
            {q.length >= 2 && (
              <div className="border border-gray-100 rounded-xl max-h-44 overflow-y-auto divide-y divide-gray-50">
                {isFetching ? <Spinner className="py-3" /> : encontrados.length === 0 ? (
                  <p className="text-xs text-gray-400 px-3 py-2">
                    Sin equipos disponibles con ese texto. Solo aparecen los que no están vendidos, prestados ni ya donde un técnico.
                  </p>
                ) : encontrados.map((s) => (
                  <button key={s.id} onClick={() => agregar(s)}
                    disabled={equipos.some((e) => e.serial_id === s.id)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 disabled:opacity-40">
                    <span className="font-medium text-gray-800">{s.producto_nombre}</span>
                    <span className="text-xs text-gray-500 font-mono ml-2">{s.imei}</span>
                  </button>
                ))}
              </div>
            )}
            {equipos.map((e) => (
              <div key={e.serial_id} className="border border-gray-100 rounded-xl p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{e.producto_nombre}</p>
                    <p className="text-xs text-gray-500 font-mono">{e.imei}</p>
                  </div>
                  <button onClick={() => quitar(e.serial_id)} className="p-1 rounded-lg text-gray-400 hover:text-red-500">
                    <X size={15} />
                  </button>
                </div>
                <input value={e.trabajo} onChange={(ev) => setTrabajo(e.serial_id, ev.target.value)}
                  placeholder="Trabajo: cambio de batería, pantalla…"
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" />
              </div>
            ))}
          </div>
        )}

        {puedePagar && (
          <div className="flex flex-col gap-2 rounded-xl border border-gray-100 p-3">
            <span className="text-sm font-medium text-gray-700">Anticipo (opcional)</span>
            <div className="grid grid-cols-2 gap-2">
              <InputMoneda value={anticipo} onChange={setAnticipo} placeholder="$0"
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" />
              <select value={metodo} onChange={(e) => setMetodo(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white">
                {metodos.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
            {Number(anticipo) > 0 && (
              <p className="text-xs text-gray-500">
                Sale {formatCOP(Number(anticipo))} de la caja ahora. Se descuenta de lo que cobre el técnico;
                si sobra, queda a favor o él lo devuelve.
              </p>
            )}
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-700">Notas</span>
          <input value={notas} onChange={(e) => setNotas(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" />
        </label>

        <p className="text-xs text-gray-500 flex items-start gap-1.5">
          <Wrench size={13} className="mt-0.5 flex-shrink-0" />
          Mientras esté donde el técnico, el equipo no se puede vender, prestar ni despachar.
        </p>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={mut.isPending} disabled={!listo} onClick={() => mut.mutate()}>
            Enviar al técnico
          </Button>
        </div>
      </div>
    </Modal>
  );
}
