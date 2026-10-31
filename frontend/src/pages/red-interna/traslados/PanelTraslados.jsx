import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getPanelTraslados, getTraslado, anularTraslado,
} from '../../../api/redInterna.api';
import { formatCOP, formatFechaHora } from '../../../utils/formatters';
import { Modal }   from '../../../components/ui/Modal';
import { Button }  from '../../../components/ui/Button';
import { Spinner } from '../../../components/ui/Spinner';
import { ModalRecibirTraslado } from './ModalRecibirTraslado';
import { ModalDocumentoEnvio } from '../documentos/ModalDocumentoEnvio';
import {
  ArrowRightLeft, PackageCheck, Truck, Printer, XCircle, ChevronRight, Info, Store,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// TRASLADOS — lo que esta sucursal tiene por recibir, lo que mandó y lo último
//
// Vive en la pantalla Bodega: arriba del panel de la bodega y como cara entera
// de una sede propia. No tiene botón «Trasladar» propio: la lista se arma en el
// CARRITO del inventario (que ya es la lista compartida para vender, prestar y
// despachar), y aquí solo se dice cómo llegar.
// Sin un peso: solo el admin ve, en el detalle, lo que costó lo trasladado.
// ─────────────────────────────────────────────────────────────────────────────

const ESTADO = {
  'En transito': { texto: 'En camino',        clase: 'bg-amber-100 text-amber-700' },
  Recibida:      { texto: 'Recibido',         clase: 'bg-green-100 text-green-700' },
  Parcial:       { texto: 'Recibido parcial', clase: 'bg-blue-100 text-blue-700' },
  Anulada:       { texto: 'Anulado',          clase: 'bg-gray-100 text-gray-500' },
};
const ESTADO_LINEA = { Pendiente: 'En camino', Recibida: 'Llegó', Faltante: 'No llegó', Devuelta: 'Anulado' };

const T = (t) => `T-${t.numero ?? t.id}`;

function Chip({ estado }) {
  const e = ESTADO[estado] || { texto: estado, clase: 'bg-gray-100 text-gray-500' };
  return <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${e.clase}`}>{e.texto}</span>;
}

function FilaTraslado({ t, sucursalId, onAbrir, accion }) {
  const sale = Number(t.sucursal_origen_id) === Number(sucursalId);
  return (
    <div className="flex items-center gap-3 px-3 py-3 border-b border-gray-50 last:border-0">
      <button type="button" onClick={() => onAbrir(t.id)} className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-800">{T(t)}</span>
          <Chip estado={t.estado} />
        </div>
        <p className="text-xs text-gray-500 truncate mt-0.5">
          {sale ? `→ ${t.sucursal_destino_nombre}` : `← ${t.sucursal_origen_nombre}`}
          {' · '}{t.unidades} ud{t.unidades !== 1 ? 's' : ''} · {formatFechaHora(t.fecha_emision)}
        </p>
        {t.productos && <p className="text-[11px] text-gray-400 truncate">{t.productos}</p>}
        {t.lineas_faltantes > 0 && (
          <p className="text-[11px] text-amber-600">{t.lineas_faltantes} producto(s) no llegaron</p>
        )}
      </button>
      {accion}
      {!accion && <ChevronRight size={15} className="text-gray-300 flex-shrink-0" />}
    </div>
  );
}

export function ModalDetalleTraslado({ trasladoId, puedeTrasladar, onCerrar, onCambio }) {
  const [imprimir, setImprimir] = useState(false);
  const [recibir, setRecibir]   = useState(false);
  const [error, setError] = useState('');
  const { data: t, isLoading } = useQuery({
    queryKey: ['red-traslado', trasladoId],
    queryFn:  () => getTraslado(trasladoId).then((r) => r.data.data),
  });
  const anular = useMutation({
    mutationFn: () => anularTraslado(trasladoId),
    onSuccess: () => { onCambio?.('Traslado anulado: la mercancía quedó libre'); onCerrar(); },
    onError: (err) => setError(err.response?.data?.error || 'No se pudo anular'),
  });

  if (imprimir) return <ModalDocumentoEnvio remisionId={trasladoId} onClose={() => setImprimir(false)} />;
  if (recibir) {
    return <ModalRecibirTraslado trasladoId={trasladoId} onCerrar={() => setRecibir(false)}
      onListo={() => { onCambio?.('Traslado recibido: ya está en tu inventario'); onCerrar(); }} />;
  }

  return (
    <Modal open onClose={onCerrar} title={t ? `Traslado ${T(t)}` : 'Traslado'} size="md">
      {isLoading || !t ? <div className="py-10 flex justify-center"><Spinner /></div> : (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <ArrowRightLeft size={15} className="text-gray-500" />
              <p className="text-sm font-semibold text-gray-800 flex-1">
                {t.sucursal_origen_nombre} → {t.sucursal_destino_nombre}
              </p>
              <Chip estado={t.estado} />
            </div>
            <p className="text-xs text-gray-500">
              Envió {t.usuario_emisor_nombre || '—'} · {formatFechaHora(t.fecha_emision)}
            </p>
            {t.fecha_recepcion && (
              <p className="text-xs text-gray-500">Recibió {t.usuario_receptor_nombre || '—'} · {formatFechaHora(t.fecha_recepcion)}</p>
            )}
            {t.notas && <p className="text-xs text-gray-600 italic">{t.notas}</p>}
            {t.valor_costo != null && (
              <p className="text-[11px] text-gray-400 pt-1 border-t border-gray-200 mt-1">
                Costo de lo trasladado: {formatCOP(t.valor_costo)} (solo lo ves tú, como administrador)
              </p>
            )}
          </div>

          <div className="border border-gray-100 rounded-xl overflow-hidden max-h-[45vh] overflow-y-auto">
            {t.lineas.map((l) => (
              <div key={l.id} className="flex items-center gap-3 px-3 py-2.5 border-b border-gray-50 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 truncate">
                    {l.tipo === 'cantidad' && <b>{l.cantidad_recibida != null && l.cantidad_recibida !== l.cantidad
                      ? `${l.cantidad_recibida}/${l.cantidad}` : l.cantidad} × </b>}
                    {l.nombre_producto}
                  </p>
                  <p className="text-xs text-gray-400 font-mono truncate">{l.imei || l.codigo || ''}</p>
                </div>
                <span className={`text-[11px] ${l.estado_linea === 'Faltante' ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
                  {ESTADO_LINEA[l.estado_linea] || l.estado_linea}
                </span>
              </div>
            ))}
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" className="flex-1 min-w-[8rem]" onClick={() => setImprimir(true)}>
              <Printer size={15} /> Imprimir
            </Button>
            {t.estado === 'En transito' && t.es_destino && (
              <Button className="flex-1 min-w-[8rem]" onClick={() => setRecibir(true)}>
                <PackageCheck size={15} /> Revisar y recibir
              </Button>
            )}
            {t.estado === 'En transito' && t.es_origen && puedeTrasladar && (
              <Button variant="secondary" className="flex-1 min-w-[8rem] text-red-600" loading={anular.isPending}
                onClick={() => { setError(''); anular.mutate(); }}>
                <XCircle size={15} /> Anular
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * @param {{ contexto: object, sedesPropias?: {sucursal_id:number, sucursal_nombre:string}[],
 *           onVerCuenta?: Function, onAviso: Function, compacto?: boolean }} props
 */
export function PanelTraslados({ contexto, sedesPropias = [], onVerCuenta, onAviso, compacto = false }) {
  const qc = useQueryClient();
  const [abierto, setAbierto]   = useState(null);
  const [recibir, setRecibir]   = useState(null);
  const [verTodos, setVerTodos] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['red-traslados-panel'],
    queryFn:  () => getPanelTraslados().then((r) => r.data.data),
  });
  const tr = contexto?.traslados || {};

  const refrescar = (msg) => {
    qc.invalidateQueries({ queryKey: ['red-traslados-panel'] });
    qc.invalidateQueries({ queryKey: ['red-traslado'] });
    qc.invalidateQueries({ queryKey: ['red-en-transito'] });
    qc.invalidateQueries({ queryKey: ['inventario'] });
    if (msg) onAviso?.(msg);
  };

  if (isLoading) return <div className="py-6 flex justify-center"><Spinner /></div>;
  if (isError || !data) {
    return <p className="text-sm text-red-500 py-4">No se pudieron cargar los traslados.</p>;
  }

  // Lo que va en camino ya sale arriba (por recibir / enviados): repetirlo en
  // «Últimos» hacía ver dos traslados donde hay uno.
  const cerrados = data.recientes.filter((t) => t.estado !== 'En transito');
  const recientes = verTodos ? cerrados : cerrados.slice(0, compacto ? 3 : 6);

  return (
    <div className="flex flex-col gap-4">
      {/* Por recibir: es una acción, va primero y resaltada. */}
      {data.por_recibir.length > 0 && (
        <div className="bg-white border-2 border-blue-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 bg-blue-50 flex items-center gap-2">
            <PackageCheck size={16} className="text-blue-600" />
            <p className="text-sm font-semibold text-blue-900">Traslados por recibir ({data.por_recibir.length})</p>
          </div>
          {data.por_recibir.map((t) => (
            <FilaTraslado key={t.id} t={t} sucursalId={data.sucursal_id} onAbrir={setAbierto}
              accion={<Button size="sm" onClick={() => setRecibir(t.id)}>Revisar</Button>} />
          ))}
        </div>
      )}

      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 flex items-center gap-2 border-b border-gray-50">
          <ArrowRightLeft size={16} className="text-gray-500" />
          <p className="text-sm font-semibold text-gray-800 flex-1">Traslados entre tus sedes</p>
          <span className="text-[11px] text-gray-400">sin cuenta</span>
        </div>

        {data.en_camino.length > 0 && (
          <div className="border-b border-gray-50">
            <p className="px-4 pt-2.5 text-[11px] font-semibold text-gray-400 uppercase flex items-center gap-1">
              <Truck size={11} /> Enviados, sin recibir
            </p>
            {data.en_camino.map((t) => (
              <FilaTraslado key={t.id} t={t} sucursalId={data.sucursal_id} onAbrir={setAbierto} />
            ))}
          </div>
        )}

        {recientes.length > 0 ? (
          <div>
            <p className="px-4 pt-2.5 text-[11px] font-semibold text-gray-400 uppercase">Últimos</p>
            {recientes.map((t) => (
              <FilaTraslado key={t.id} t={t} sucursalId={data.sucursal_id} onAbrir={setAbierto} />
            ))}
            {cerrados.length > recientes.length && (
              <button type="button" onClick={() => setVerTodos(true)}
                className="w-full py-2.5 text-xs text-blue-600 hover:bg-gray-50">Ver más</button>
            )}
          </div>
        ) : !data.en_camino.length && (
          <p className="text-sm text-gray-400 text-center py-6 px-4">Todavía no hay traslados.</p>
        )}

        <div className="px-4 py-3 bg-gray-50 flex items-start gap-2">
          <Info size={13} className="text-gray-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-gray-500 leading-snug">
            {tr.puede_trasladar ? (
              <>Para trasladar, agrega los productos al carrito en{' '}
                <Link to="/inventario" className="text-blue-600 font-medium">Inventario</Link> y toca{' '}
                <b>{tr.es_sede_propia ? 'Trasladar' : 'Enviar'}</b>.{' '}
                {data.confirmar ? 'El destino confirma lo que le llegó.' : 'Entra directo al inventario del destino.'}</>
            ) : (
              <>Tu usuario no tiene el permiso «Traslados»: puedes recibir, pero no enviar. Lo da el administrador en Ajustes → Usuarios.</>
            )}
          </p>
        </div>
      </div>

      {/* La bodega ve sus sedes propias aparte de los locales: no tienen deuda,
          pero su cuenta vieja (cerrada en $0) se puede seguir consultando. */}
      {sedesPropias.length > 0 && onVerCuenta && (
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
          <p className="px-4 pt-3 pb-1 text-[11px] font-semibold text-gray-400 uppercase">Tus sedes (reciben traslados)</p>
          {sedesPropias.map((s) => (
            <button key={s.sucursal_id} type="button" onClick={() => onVerCuenta(s.sucursal_id, s.sucursal_nombre)}
              className="w-full flex items-center gap-3 px-4 py-2.5 border-t border-gray-50 text-left hover:bg-gray-50">
              <Store size={15} className="text-gray-400" />
              <span className="text-sm text-gray-700 flex-1">{s.sucursal_nombre}</span>
              <span className="text-[11px] text-gray-400">Cuenta anterior</span>
              <ChevronRight size={14} className="text-gray-300" />
            </button>
          ))}
        </div>
      )}

      {abierto && (
        <ModalDetalleTraslado trasladoId={abierto} puedeTrasladar={!!tr.puede_trasladar}
          onCerrar={() => { setAbierto(null); refrescar(); }} onCambio={refrescar} />
      )}
      {recibir && (
        <ModalRecibirTraslado trasladoId={recibir} onCerrar={() => setRecibir(null)}
          onListo={() => { setRecibir(null); refrescar('Traslado recibido: ya está en tu inventario'); }} />
      )}
    </div>
  );
}
