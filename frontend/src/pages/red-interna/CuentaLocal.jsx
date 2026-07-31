import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { getEstadoCuenta, recibirRemision } from '../../api/redInterna.api';
import { formatCOP, formatFechaHora } from '../../utils/formatters';
import { Button }     from '../../components/ui/Button';
import { Spinner }    from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { ModalRecibir } from './ModalRecibir';
import { ModalRemesa }  from './ModalRemesa';
import {
  TabResumen, TabMercancia, TabEnvios, TabPagos, TabExtracto,
} from './CuentaSecciones';
import {
  ChevronLeft, Package, Truck, Wallet, FileText, AlertTriangle, Store,
  LayoutDashboard, CheckCircle, Send, Info,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// LA CUENTA DE UN LOCAL CON LA BODEGA — una sola pantalla para los dos lados
//
// La usa el LOCAL para ver lo suyo (con los botones de recibir y pagar) y la
// BODEGA para revisar cualquier local (sin ellos). Antes eran dos componentes
// mostrando los mismos datos con layouts distintos, que es exactamente como se
// desincronizan las pantallas.
//
// ───────────────────────────────────────────────────────────────────────────
// LAS DOS CIFRAS, QUE NO SON LA MISMA
//
//   DEUDA        el valor de toda la mercancía que la bodega le entregó y que
//                todavía no ha saldado — esté vendida o siga en vitrina.
//                Sube cuando la bodega DESPACHA.
//
//   POR REMITIR  lo que tiene que entregar ya: solo lo vendido, menos lo
//                pagado. Sube cuando el local VENDE.
//
// Confundirlas era el problema: el local veía un solo número y no sabía si era
// lo que respondía o lo que debía pagar. Van juntas y separadas, siempre
// visibles, fuera de las pestañas.
// ─────────────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'resumen',   label: 'Resumen',   Icn: LayoutDashboard },
  { id: 'mercancia', label: 'Mercancía', Icn: Package },
  { id: 'envios',    label: 'Envíos',    Icn: Truck },
  { id: 'pagos',     label: 'Pagos',     Icn: Wallet },
  { id: 'extracto',  label: 'Extracto',  Icn: FileText },
];

// ── Envíos que la bodega mandó y todavía no se confirman ────────────────────
// Fuera de las pestañas: es una acción pendiente, no información. Un toque en
// "Recibí todo" y entra al inventario; "Revisar" es para cuando faltó algo.
function PorRecibir({ envios, onAviso, onRefrescar }) {
  const [revisando, setRevisando] = useState(null);

  const recibirTodo = useMutation({
    mutationFn: (id) => recibirRemision(id, {}),
    onSuccess: () => { onAviso('Envío recibido — ya está en tu inventario'); onRefrescar(); },
    onError: (e) => onAviso(e?.response?.data?.error || 'No se pudo recibir el envío'),
  });

  if (!envios.length) return null;

  return (
    <>
      <div className="border border-blue-200 bg-blue-50/60 rounded-2xl overflow-hidden mb-3">
        <div className="px-4 py-2.5 flex items-center gap-2 border-b border-blue-100">
          <Package size={15} className="text-blue-600" />
          <p className="text-sm font-semibold text-blue-900">
            {envios.length} envío{envios.length > 1 ? 's' : ''} por recibir
          </p>
        </div>
        {envios.map((r) => (
          <div key={r.id} className="px-4 py-3 bg-white/70 border-b border-blue-50 last:border-0">
            <p className="text-sm font-medium text-gray-900">
              Envío #{r.numero ?? r.id}
              <span className="font-normal text-gray-400"> · {r.total_items} producto(s)</span>
            </p>
            <p className="text-xs text-gray-400">{formatFechaHora(r.fecha_emision)}</p>
            {r.notas && <p className="text-xs text-gray-400 italic">{r.notas}</p>}
            <div className="flex gap-2 mt-2.5">
              <Button
                size="sm" variant="success" className="flex-1"
                loading={recibirTodo.isPending && recibirTodo.variables === r.id}
                onClick={() => recibirTodo.mutate(r.id)}
              >
                <CheckCircle size={14} /> Recibí todo
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRevisando(r.id)}>
                Revisar uno por uno
              </Button>
            </div>
          </div>
        ))}
      </div>

      {revisando && (
        <ModalRecibir
          remisionId={revisando}
          onCerrar={() => setRevisando(null)}
          onListo={(msg) => { setRevisando(null); onAviso(msg); onRefrescar(); }}
        />
      )}
    </>
  );
}

// ── La cabecera: las dos cifras ─────────────────────────────────────────────
function Cabecera({ t, propia, onPagar }) {
  const remitir = Number(t.saldo_por_liquidar || 0);
  const aFavor  = remitir < 0;
  // A un vendedor con costos ocultos le llega null: la deuda total es la suma
  // de los costos de la mercancía, justo lo que no puede ver.
  const hayDeuda = t.deuda_total != null;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden mb-4">
      {hayDeuda && (
        <div className="px-5 pt-4 pb-3">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">
            Deuda con la bodega
          </p>
          <p className="text-3xl font-bold text-gray-900 mt-0.5 leading-none">
            {formatCOP(t.deuda_total)}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            valor de la mercancía que tiene de la bodega, menos lo que ya pagó
          </p>
        </div>
      )}

      <div className={`px-5 py-3.5 border-t border-gray-100
        ${remitir > 0 ? 'bg-amber-50' : aFavor ? 'bg-blue-50' : 'bg-green-50'}`}>
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              {aFavor ? 'La bodega le debe' : 'Por remitir ahora'}
            </p>
            <p className={`text-2xl font-bold mt-0.5 leading-none
              ${remitir > 0 ? 'text-amber-700' : aFavor ? 'text-blue-700' : 'text-green-700'}`}>
              {formatCOP(Math.abs(remitir))}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {remitir > 0 ? 'de los equipos que ya vendió'
               : aFavor   ? 'remitió de más (o hubo una anulación)'
                          : 'está al día ✓'}
            </p>
          </div>
          {propia && (
            <Button onClick={onPagar} className="flex-shrink-0">
              <Send size={15} /> Pagar
            </Button>
          )}
        </div>

        {hayDeuda && t.por_vender > 0 && (
          <p className="text-xs text-gray-500 mt-2.5 flex items-start gap-1.5">
            <Info size={12} className="flex-shrink-0 mt-0.5" />
            Los otros {formatCOP(t.por_vender)} de la deuda todavía no se cobran:
            es mercancía en vitrina, prestada o vendida a crédito sin recaudar.
          </p>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════

export function CuentaLocal({
  sucursalId, nombre, propia = false, panel = null,
  onVolver = null, onRefrescar, onAviso,
}) {
  const [tab,    setTab]    = useState('resumen');
  const [remesa, setRemesa] = useState(false);
  const [estado, setEstado] = useState('');
  const [q,      setQ]      = useState('');
  const [qExt,   setQExt]   = useState('');
  const [desde,  setDesde]  = useState('');
  const [hasta,  setHasta]  = useState('');

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['red-estado-cuenta', sucursalId, q, estado, desde, hasta],
    queryFn:  () => getEstadoCuenta(sucursalId, {
      q: q.trim() || undefined,
      estado: estado || undefined,
      desde: desde || undefined,
      hasta: hasta ? `${hasta} 23:59:59` : undefined,
    }).then((r) => r.data.data),
    keepPreviousData: true,
  });

  if (isError) {
    return (
      <EmptyState icon={AlertTriangle} titulo="No se pudo cargar la cuenta"
        descripcion={error?.response?.data?.error || 'Intenta de nuevo.'} />
    );
  }
  if (isLoading && !data) {
    return <div className="py-16 flex justify-center"><Spinner /></div>;
  }

  const t = data.totales;
  const ocultos = data.costos_ocultos === true;

  // Ir a un estado concreto desde el resumen: filtra y cambia de pestaña.
  const verMercancia = (filtro) => { setEstado(filtro); setTab('mercancia'); };

  // El extracto filtra por texto en el cliente; la mercancía, en el servidor.
  const extractoVisible = qExt.trim()
    ? data.extracto.filter((f) =>
        [f.concepto, f.referencia, f.tercero, f.documento, f.detalle]
          .some((v) => String(v ?? '').toLowerCase().includes(qExt.toLowerCase())))
    : data.extracto;

  return (
    <div>
      {onVolver && (
        <button onClick={onVolver}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
          <ChevronLeft size={16} /> Volver
        </button>
      )}

      {!propia && (
        <div className="flex items-center gap-2 mb-4">
          <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center">
            <Store size={17} className="text-gray-500" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              {data.sucursal?.nombre || nombre}
            </h2>
            <p className="text-xs text-gray-400">Cuenta con la bodega</p>
          </div>
        </div>
      )}

      {propia && (
        <PorRecibir
          envios={panel?.por_recibir || []}
          onAviso={onAviso}
          onRefrescar={onRefrescar}
        />
      )}

      <Cabecera t={t} propia={propia} onPagar={() => setRemesa(true)} />

      {/* Pestañas */}
      <div className="flex gap-1 mb-3 border-b border-gray-100 overflow-x-auto">
        {TABS.map((x) => {
          // Variable local en vez de desestructurar en los parámetros: así el
          // linter la reconoce como componente.
          const Icono = x.Icn;
          return (
            <button key={x.id} onClick={() => setTab(x.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2
                transition-colors whitespace-nowrap
                ${tab === x.id ? 'border-blue-600 text-blue-600'
                               : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
              <Icono size={14} /> {x.label}
              {x.id === 'mercancia' && ` (${data.mercancia.total})`}
              {x.id === 'envios'    && ` (${(data.envios || []).length})`}
              {x.id === 'pagos'     && ` (${data.remesas.length +
                                            (data.movimientos_cuenta || []).length})`}
            </button>
          );
        })}
      </div>

      {tab === 'resumen' && <TabResumen data={data} onFiltrar={verMercancia} />}

      {tab === 'mercancia' && (
        <TabMercancia
          data={data.mercancia} conteos={data.conteo_estados}
          estado={estado} onEstado={setEstado}
          q={q} onQ={setQ} cargando={isFetching}
        />
      )}

      {tab === 'envios' && (
        <TabEnvios envios={data.envios || []} resumen={data.envios_resumen}
          ocultos={ocultos} />
      )}

      {tab === 'pagos' && (
        <TabPagos remesas={data.remesas} movimientos={data.movimientos_cuenta || []}
          totales={t} />
      )}

      {tab === 'extracto' && (
        <TabExtracto
          filas={extractoVisible} q={qExt} onQ={setQExt}
          desde={desde} hasta={hasta} onDesde={setDesde} onHasta={setHasta}
        />
      )}

      {ocultos && (
        <p className="text-xs text-gray-400 flex items-center gap-1.5 mt-4">
          <Info size={12} /> Los costos de la mercancía no se muestran en tu perfil.
        </p>
      )}

      {remesa && (
        <ModalRemesa
          sugerido={Math.max(0, t.saldo_por_liquidar)}
          onCerrar={() => setRemesa(false)}
          onListo={() => { setRemesa(false); onAviso('Pago enviado a la bodega'); onRefrescar(); }}
        />
      )}
    </div>
  );
}
