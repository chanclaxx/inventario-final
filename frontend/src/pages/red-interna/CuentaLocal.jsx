import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { getEstadoCuenta, recibirRemision } from '../../api/redInterna.api';
import { formatCOP, formatFechaHora } from '../../utils/formatters';
import { Button }     from '../../components/ui/Button';
import { Spinner }    from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { ModalRecibir } from './ModalRecibir';
import { ModalPago }    from './ModalPago';
import { ModalMovimientoCuenta } from './ModalMovimientoCuenta';
import {
  TabResumen, TabMercancia, TabEnvios, TabPagos, TabExtracto,
} from './CuentaSecciones';
import {
  ChevronLeft, Package, Truck, Wallet, FileText, AlertTriangle, Store,
  LayoutDashboard, CheckCircle, Send, Info, PiggyBank, Receipt, SlidersHorizontal,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// LA CUENTA DE UN LOCAL CON LA BODEGA — una sola pantalla para los dos lados
//
// La usa el LOCAL para ver lo suyo (con los botones de recibir y pagar) y la
// BODEGA para revisar cualquier local (con los de ajustar). Antes eran dos
// componentes mostrando los mismos datos con layouts distintos, que es
// exactamente como se desincronizan las pantallas.
//
// ───────────────────────────────────────────────────────────────────────────
// UNA SOLA CIFRA, Y ES LA QUE SE PAGA
//
// Hasta agosto de 2026 había dos números peleándose el encabezado: la deuda
// (mercancía en poder) y lo exigible (solo lo vendido). El local nunca sabía
// cuál de los dos tenía que entregar. Con el modelo de envío a crédito son el
// mismo: el local paga TODO lo que recibe, así que arriba va la deuda y punto.
//
// Debajo, cuando existe, el saldo a favor — que no es plata que la bodega deba
// sino crédito que se descuenta del próximo envío.
// ─────────────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'envios',    label: 'Envíos',    Icn: Truck },
  { id: 'resumen',   label: 'Resumen',   Icn: LayoutDashboard },
  { id: 'mercancia', label: 'Mercancía', Icn: Package },
  { id: 'pagos',     label: 'Pagos',     Icn: Wallet },
  { id: 'extracto',  label: 'Extracto',  Icn: FileText },
];

// ── Envíos que la bodega mandó y todavía no se confirman ────────────────────
// Fuera de las pestañas: es una acción pendiente, no información. Un toque en
// "Recibí todo" y entra al inventario; "Revisar" es para cuando faltó algo.
function PorRecibir({ envios, onAviso, onRefrescar }) {
  const [revisando, setRevisando] = useState(null);

  const recibirTodo = useMutation({
    mutationFn: (id) => recibirRemision(id, {}).then((r) => r.data.data),
    onSuccess: (res) => {
      const favor = Number(res?.saldo_favor_aplicado || 0);
      onAviso(favor > 0
        ? `Envío recibido — se le aplicaron ${formatCOP(favor)} de tu saldo a favor`
        : 'Envío recibido — ya está en tu inventario');
      onRefrescar();
    },
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
            {/* Recibirlo genera la deuda: decirlo antes, no después. */}
            <p className="text-xs text-blue-700 mt-1">
              Al recibirlo entra a tu inventario y pasa a tu cuenta con la bodega.
            </p>
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

// ── La cabecera: lo que debe, y su crédito si lo tiene ──────────────────────
function Cabecera({ t, propia, onPagar }) {
  const debe   = Number(t.saldo_por_liquidar || 0);
  const aFavor = Number(t.saldo_a_favor || 0);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden mb-4">
      <div className={`px-5 py-4 ${debe > 0 ? 'bg-amber-50' : 'bg-green-50'}`}>
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Deuda con la bodega
            </p>
            <p className={`text-3xl font-bold mt-0.5 leading-none
              ${debe > 0 ? 'text-amber-700' : 'text-green-700'}`}>
              {formatCOP(debe)}
            </p>
            <p className="text-xs text-gray-500 mt-1.5">
              {debe > 0
                ? `${t.envios_abiertos ?? 0} envío(s) por pagar`
                : 'está al día ✓'}
            </p>
          </div>
          {propia && debe > 0 && (
            <Button onClick={onPagar} className="flex-shrink-0">
              <Send size={15} /> Pagar
            </Button>
          )}
        </div>
      </div>

      {aFavor > 0 && (
        <div className="px-5 py-3 border-t border-gray-100 bg-blue-50/60 flex items-start gap-2">
          <PiggyBank size={15} className="text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-blue-800">
              {formatCOP(aFavor)} a favor
            </p>
            <p className="text-xs text-blue-600/80">
              se descuenta solo del próximo envío que reciba
            </p>
          </div>
        </div>
      )}

      {t.remesas_en_transito > 0 && (
        <div className="px-5 py-2.5 border-t border-gray-100 flex items-center gap-2">
          <Info size={13} className="text-amber-500 flex-shrink-0" />
          <p className="text-xs text-gray-500">
            {formatCOP(t.remesas_en_transito)} enviados, esperando que la bodega confirme.
          </p>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════

export function CuentaLocal({
  sucursalId, nombre, propia = false, panel = null,
  onVolver = null, onRefrescar, onAviso, esBodega = false,
}) {
  const [tab,    setTab]    = useState('envios');
  const [pago,   setPago]   = useState(null);   // null | { envio? }
  const [movim,  setMovim]  = useState(null);   // null | 'gasto' | 'ajuste'
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

  const cerrarPago = (msg) => {
    setPago(null);
    onAviso(msg || 'Pago enviado a la bodega');
    onRefrescar();
  };

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

      <Cabecera t={t} propia={propia} onPagar={() => setPago({})} />

      {/* Acciones que antes no tenían pantalla: el backend las soportaba desde
          julio y no había forma de llegar a ellas. El local registra lo que
          pagó por cuenta de la bodega; la bodega abona o cobra a mano. */}
      <div className="flex gap-2 mb-3">
        {propia && (
          <Button variant="secondary" size="sm" onClick={() => setMovim('gasto')}>
            <Receipt size={14} /> Gasto por cuenta de bodega
          </Button>
        )}
        {esBodega && !propia && (
          <Button variant="secondary" size="sm" onClick={() => setMovim('ajuste')}>
            <SlidersHorizontal size={14} /> Ajustar cuenta
          </Button>
        )}
      </div>

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
              {x.id === 'envios'    && ` (${(data.envios || []).length})`}
              {x.id === 'mercancia' && ` (${data.mercancia.total})`}
              {x.id === 'pagos'     && ` (${data.remesas.length +
                                            (data.movimientos_cuenta || []).length})`}
            </button>
          );
        })}
      </div>

      {tab === 'envios' && (
        <TabEnvios
          envios={data.envios || []} resumen={data.envios_resumen}
          ocultos={ocultos} propia={propia}
          onAbonar={(envio) => setPago({ envio })}
        />
      )}

      {tab === 'resumen' && <TabResumen data={data} onFiltrar={verMercancia} />}

      {tab === 'mercancia' && (
        <TabMercancia
          data={data.mercancia} conteos={data.conteo_estados}
          estado={estado} onEstado={setEstado}
          q={q} onQ={setQ} cargando={isFetching}
        />
      )}

      {tab === 'pagos' && (
        <TabPagos remesas={data.remesas} movimientos={data.movimientos_cuenta || []}
          abonos={data.abonos || []} totales={t} />
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

      {pago && (
        <ModalPago
          envio={pago.envio || null}
          sugerido={t.saldo_por_liquidar}
          onCerrar={() => setPago(null)}
          onListo={cerrarPago}
        />
      )}

      {movim && (
        <ModalMovimientoCuenta
          tipo={movim}
          sucursalId={sucursalId}
          nombreLocal={data.sucursal?.nombre || nombre}
          onCerrar={() => setMovim(null)}
          onListo={(msg) => { setMovim(null); onAviso(msg); onRefrescar(); }}
        />
      )}
    </div>
  );
}
