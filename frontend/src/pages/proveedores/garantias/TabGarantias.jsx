import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Plus, PackageOpen, Truck, Hourglass, AlarmClock, CheckCircle2, ShieldAlert, ChevronRight, Building2, FileText,
} from 'lucide-react';
import { getGarantias } from '../../../api/garantiasProveedor.api';
import { Button }      from '../../../components/ui/Button';
import { Spinner }     from '../../../components/ui/Spinner';
import { EmptyState }  from '../../../components/ui/EmptyState';
import { SearchInput } from '../../../components/ui/SearchInput';
import { useGarantiasProveedor } from '../../../hooks/useEnGarantia';
import useSucursalStore from '../../../store/sucursalStore';
import { formatCOP, formatFecha } from '../../../utils/formatters';
import { ESTADO_PROVEEDOR, ESTADO_CLIENTE, numFactura } from './garantiasUi';
import { ModalNuevaGarantia }     from './ModalNuevaGarantia';
import { ModalDetalleGarantia }   from './ModalDetalleGarantia';
import { ModalDocumentoGarantia } from './ModalDocumentoGarantia';
import { ModalEnviarProveedor }   from './ModalEnviarProveedor';
import { ModalEstadoCuentaGarantias } from './ModalEstadoCuentaGarantias';

// ─────────────────────────────────────────────────────────────────────────────
// Proveedores → Garantías. La pregunta que responde primero: ¿QUÉ TENEMOS
// AFUERA y QUÉ FALTA HACER? Las tarjetas de arriba son los pendientes y filtran
// al tocarlas; abajo, agrupado por proveedor (la caja que se le arma a cada
// uno) o caso por caso. Todo estado lo calcula el backend; aquí solo se pinta.
// ─────────────────────────────────────────────────────────────────────────────

const TARJETAS = [
  { id: 'por_enviar',        label: 'Por enviar',          icono: PackageOpen, clase: 'text-amber-700 bg-amber-50 border-amber-200',  cifra: (r) => r.por_enviar,        sub: (r) => `${r.unidades_por_enviar} unidad(es)` },
  { id: 'afuera',            label: 'Con proveedores',     icono: Truck,       clase: 'text-blue-700 bg-blue-50 border-blue-200',     cifra: (r) => r.afuera,            sub: (r) => (r.valor_afuera != null ? formatCOP(r.valor_afuera) : `${r.unidades_afuera} unidad(es)`) },
  { id: 'cliente_pendiente', label: 'Clientes esperando',  icono: Hourglass,   clase: 'text-orange-700 bg-orange-50 border-orange-200', cifra: (r) => r.cliente_pendiente, sub: () => 'por entregar o devolver' },
  { id: 'demoradas',         label: 'Demoradas',           icono: AlarmClock,  clase: 'text-red-700 bg-red-50 border-red-200',        cifra: (r) => r.demoradas,         sub: (r, d) => `más de ${d} días afuera` },
  { id: 'resueltas',         label: 'Resueltas este mes',  icono: CheckCircle2, clase: 'text-green-700 bg-green-50 border-green-200', cifra: (r) => r.resueltas_mes,     sub: () => 'el proveedor respondió' },
];

const VISTAS_LISTA = [
  { id: 'abiertas', label: 'Abiertas' },
  { id: 'resueltas', label: 'Resueltas' },
  { id: 'anuladas', label: 'Anuladas' },
  { id: 'todas', label: 'Todas' },
];

function Fila({ l, onAbrir, diasDemora }) {
  const demorada = l.dias_afuera != null && l.dias_afuera >= diasDemora;
  const ep = ESTADO_PROVEEDOR[l.estado_proveedor];
  const ec = ESTADO_CLIENTE[l.estado_cliente];
  return (
    <button type="button" onClick={() => onAbrir(l.reclamo_id)}
      className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">
          {l.cantidad > 1 ? `${l.cantidad} × ` : ''}{l.nombre_producto}
          {l.variante_texto && <span className="font-normal text-gray-500"> · {l.variante_texto}</span>}
          {l.imei && <span className="font-mono font-normal text-gray-500"> · {l.imei}</span>}
        </p>
        <p className="text-xs text-gray-500 truncate">
          #{l.reclamo_numero} · {formatFecha(l.reclamo_fecha)} · {l.falla}
          {l.factura_numero ? ` · fact. #${numFactura(l.factura_numero)}` : l.prestamo_numero ? ` · prést. #${l.prestamo_numero}` : ''}
          {l.cliente_nombre ? ` · ${l.cliente_nombre}` : ''}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          {ep && <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md border ${ep.clase}`}>{ep.texto}</span>}
          {ec && <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md border ${ec.clase}`}>{ec.texto}</span>}
          {l.dias_afuera != null && (
            <span className={`text-[10px] ${demorada ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
              {l.dias_afuera} día(s) afuera{l.envio_numero ? ` · envío #${l.envio_numero}` : ''}
            </span>
          )}
        </div>
      </div>
      <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
    </button>
  );
}

export function TabGarantias({ filtroInicial = null }) {
  const { puede } = useGarantiasProveedor();
  const sucursalActiva = useSucursalStore((s) => s.sucursalActiva);
  // Una de las tarjetas, o null. Un aviso puede abrir la pestaña ya filtrada.
  const [filtro, setFiltro]   = useState(() => (TARJETAS.some((t) => t.id === filtroInicial) ? filtroInicial : null));
  const [vista, setVista]     = useState('abiertas');
  const [agrupar, setAgrupar] = useState('proveedor');
  const [busqueda, setBusqueda] = useState('');
  const [modal, setModal]     = useState(null);

  // «Demoradas» es «afuera» con el umbral (el mismo cálculo del resumen).
  const vistaApi = filtro === 'demoradas' ? 'afuera' : filtro === 'resueltas' ? 'resueltas_mes' : (filtro || vista);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['garantias-proveedor', sucursalActiva, vistaApi, busqueda],
    queryFn:  () => getGarantias({ vista: vistaApi, q: busqueda || undefined }).then((r) => r.data.data),
  });
  const diasDemora = data?.dias_demora || 15;
  const items = useMemo(() => {
    const todos = data?.items || [];
    if (filtro === 'demoradas') return todos.filter((l) => l.dias_afuera != null && l.dias_afuera >= diasDemora);
    return todos;
  }, [data, filtro, diasDemora]);

  const grupos = useMemo(() => {
    const m = new Map();
    for (const l of items) {
      const k = l.proveedor_id ?? 'sin';
      if (!m.has(k)) m.set(k, { id: l.proveedor_id, nombre: l.proveedor_nombre || 'Sin proveedor definido', lineas: [] });
      m.get(k).lineas.push(l);
    }
    return [...m.values()].sort((a, b) => (a.id == null) - (b.id == null) || a.nombre.localeCompare(b.nombre));
  }, [items]);

  const resumen = data?.resumen;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex-1">
          <p className="text-sm text-gray-500">
            Lo que salió dañado y se le reclama al proveedor. Mientras está en garantía, no cuenta en el stock.
          </p>
        </div>
        {puede('recibir') && (
          <Button onClick={() => setModal({ tipo: 'nueva' })}><Plus size={16} /> Recibir en garantía</Button>
        )}
      </div>

      {resumen && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {TARJETAS.map((t) => {
            const Icono = t.icono;
            const activa = filtro === t.id;
            return (
              <button key={t.id} type="button" onClick={() => setFiltro(activa ? null : t.id)} aria-pressed={activa}
                className={`text-left p-3 rounded-xl border transition-all ${activa ? `${t.clase} ring-2 ring-offset-1 ring-current` : 'bg-white border-gray-100 hover:border-gray-200'}`}>
                <div className="flex items-center gap-1.5">
                  <Icono size={14} className={activa ? '' : 'text-gray-400'} />
                  <span className={`text-xs ${activa ? 'font-semibold' : 'text-gray-500'}`}>{t.label}</span>
                </div>
                <p className="text-xl font-bold text-gray-900 mt-1">{t.cifra(resumen)}</p>
                <p className="text-[11px] text-gray-400 truncate">{t.sub(resumen, diasDemora)}</p>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1">
          <SearchInput value={busqueda} onChange={setBusqueda} placeholder="Buscar por IMEI, producto, cliente o # de garantía…" />
        </div>
        {!filtro && (
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
            {VISTAS_LISTA.map((v) => (
              <button key={v.id} type="button" onClick={() => setVista(v.id)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium ${vista === v.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                {v.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          {[['proveedor', 'Por proveedor'], ['caso', 'Por caso']].map(([id, label]) => (
            <button key={id} type="button" onClick={() => setAgrupar(id)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium ${agrupar === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {filtro && (
        <p className="text-xs text-gray-500">
          Mostrando: <b>{TARJETAS.find((t) => t.id === filtro)?.label}</b> ·{' '}
          <button type="button" className="text-blue-600 hover:underline" onClick={() => setFiltro(null)}>quitar filtro</button>
        </p>
      )}

      {isLoading ? <Spinner className="py-10" /> : isError ? (
        <p className="text-sm text-red-600 text-center py-6">No se pudieron cargar las garantías.</p>
      ) : items.length === 0 ? (
        <EmptyState icon={ShieldAlert} titulo={busqueda || filtro ? 'Nada con ese filtro' : 'No hay garantías abiertas'}
          descripcion="Cuando un producto salga dañado, recíbelo aquí o desde la factura, el préstamo o el inventario." />
      ) : agrupar === 'caso' ? (
        <div className="bg-white border border-gray-100 rounded-2xl divide-y divide-gray-50 overflow-hidden">
          {items.map((l) => <Fila key={l.id} l={l} diasDemora={diasDemora} onAbrir={(id) => setModal({ tipo: 'detalle', id })} />)}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {grupos.map((g) => {
            const porEnviar = g.lineas.filter((l) => l.estado_proveedor === 'por_enviar');
            const afuera = g.lineas.filter((l) => ['afuera', 'parcial'].includes(l.estado_proveedor));
            const masVieja = Math.max(0, ...afuera.map((l) => l.dias_afuera || 0));
            return (
              <div key={g.id ?? 'sin'} className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50/60">
                  <Building2 size={15} className="text-gray-400" />
                  <p className="text-sm font-semibold text-gray-800 flex-1 min-w-0 truncate">{g.nombre}</p>
                  <span className="text-xs text-gray-500">
                    {porEnviar.length ? `${porEnviar.length} por enviar` : ''}
                    {porEnviar.length && afuera.length ? ' · ' : ''}
                    {afuera.length ? `${afuera.length} afuera${masVieja ? ` · la más vieja ${masVieja} día(s)` : ''}` : ''}
                  </span>
                  {g.id != null && (
                    <Button size="sm" variant="secondary" onClick={() => setModal({ tipo: 'cuenta', proveedor: { id: g.id, nombre: g.nombre } })}>
                      <FileText size={14} /> Estado de cuenta
                    </Button>
                  )}
                  {porEnviar.length > 0 && puede('enviar') && (
                    <Button size="sm" onClick={() => setModal({ tipo: 'enviar', lineas: porEnviar, proveedorId: g.id })}>
                      <Truck size={14} /> Enviar {porEnviar.length > 1 ? `las ${porEnviar.length}` : ''}
                    </Button>
                  )}
                </div>
                <div className="divide-y divide-gray-50">
                  {g.lineas.map((l) => <Fila key={l.id} l={l} diasDemora={diasDemora} onAbrir={(id) => setModal({ tipo: 'detalle', id })} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal?.tipo === 'nueva' && (
        <ModalNuevaGarantia onClose={() => setModal(null)}
          onImprimir={(id) => setModal({ tipo: 'doc', reclamoId: id })} />
      )}
      {modal?.tipo === 'detalle' && (
        <ModalDetalleGarantia reclamoId={modal.id} onClose={() => setModal(null)}
          onImprimir={(id) => setModal({ tipo: 'doc', reclamoId: id, volver: modal.id })}
          onImprimirEnvio={(id) => setModal({ tipo: 'doc', envioId: id, volver: modal.id })} />
      )}
      {modal?.tipo === 'enviar' && (
        <ModalEnviarProveedor lineas={modal.lineas} proveedorId={modal.proveedorId}
          onClose={() => setModal(null)}
          onEnviado={(e) => setModal({ tipo: 'doc', envioId: e.id })} />
      )}
      {modal?.tipo === 'cuenta' && (
        <ModalEstadoCuentaGarantias proveedor={modal.proveedor} onClose={() => setModal(null)} />
      )}
      {modal?.tipo === 'doc' && (
        <ModalDocumentoGarantia reclamoId={modal.reclamoId} envioId={modal.envioId}
          onClose={() => setModal(modal.volver ? { tipo: 'detalle', id: modal.volver } : null)} />
      )}
    </div>
  );
}
