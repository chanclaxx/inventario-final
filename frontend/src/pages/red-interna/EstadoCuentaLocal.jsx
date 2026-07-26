import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getEstadoCuenta } from '../../api/redInterna.api';
import { formatCOP, formatFecha, formatFechaHora } from '../../utils/formatters';
import { Badge }      from '../../components/ui/Badge';
import { Spinner }    from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import {
  ChevronLeft, Search, X, TrendingUp, TrendingDown, Package, Truck,
  Wallet, FileText, AlertTriangle, Receipt, Filter, Store,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// ESTADO DE CUENTA DE UN LOCAL
//
// Pensado como un extracto bancario: arriba el saldo, y debajo el detalle de
// cómo se llegó a él. Cuatro pestañas para que nada quede escondido:
//
//   Extracto   — cada hecho con su fecha y el saldo corrido después de él
//   Mercancía  — unidad por unidad, con buscador y filtro por estado
//   Envíos     — las remisiones recibidas
//   Remesas    — el efectivo enviado y su estado
//
// El buscador y el rango de fechas aplican a Extracto y Mercancía, que es donde
// se acumula el volumen.
// ─────────────────────────────────────────────────────────────────────────────

const COLOR_ESTADO = {
  'En consignacion': 'gray',   'Por liquidar': 'yellow',
  'En recaudo':      'purple', 'En prestamo':  'blue',
  'Devuelta':        'green',  'Faltante':     'red',
  'Sin ubicar':      'red',    'Movida':       'red',
  'En transito':     'blue',
};

const ICONO_ORIGEN = {
  venta:      Receipt,
  remesa:     Wallet,
  gasto:      TrendingDown,
  ajuste:     Filter,
  remision:   Truck,
  devolucion: Package,
};

const TABS = [
  { id: 'extracto',  label: 'Extracto',  Icn: FileText },
  { id: 'mercancia', label: 'Mercancía', Icn: Package  },
  { id: 'envios',    label: 'Envíos',    Icn: Truck    },
  { id: 'remesas',   label: 'Remesas',   Icn: Wallet   },
];

// ── Tarjetas de resumen ─────────────────────────────────────────────────────
function Kpis({ t }) {
  const debe = t.saldo_por_liquidar;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
      <div className={`rounded-2xl px-4 py-3 border
        ${debe > 0 ? 'bg-amber-50 border-amber-200'
         : debe < 0 ? 'bg-blue-50 border-blue-200'
                    : 'bg-green-50 border-green-200'}`}>
        <p className="text-xs text-gray-500">
          {debe < 0 ? 'La bodega le debe' : 'Saldo por liquidar'}
        </p>
        <p className="text-xl font-bold text-gray-900 mt-0.5">{formatCOP(Math.abs(debe))}</p>
      </div>
      <div className="rounded-2xl px-4 py-3 border border-gray-100 bg-white">
        <p className="text-xs text-gray-500">En consignación</p>
        <p className="text-xl font-bold text-gray-700 mt-0.5">
          {formatCOP(t.en_consignacion_valor)}
        </p>
        <p className="text-xs text-gray-400">{t.en_consignacion_unidades} equipo(s)</p>
      </div>
      <div className="rounded-2xl px-4 py-3 border border-gray-100 bg-white">
        <p className="text-xs text-gray-500">Remesado</p>
        <p className="text-xl font-bold text-green-600 mt-0.5">
          {formatCOP(t.remesado_recibido)}
        </p>
        {t.remesas_en_transito > 0 && (
          <p className="text-xs text-amber-600">
            +{formatCOP(t.remesas_en_transito)} en tránsito
          </p>
        )}
      </div>
      <div className={`rounded-2xl px-4 py-3 border
        ${t.sin_ubicar_unidades > 0 ? 'bg-red-50 border-red-200' : 'border-gray-100 bg-white'}`}>
        <p className="text-xs text-gray-500">Sin ubicar</p>
        <p className={`text-xl font-bold mt-0.5
          ${t.sin_ubicar_unidades > 0 ? 'text-red-600' : 'text-gray-300'}`}>
          {t.sin_ubicar_unidades}
        </p>
        {t.sin_ubicar_unidades > 0 && (
          <p className="text-xs text-red-500">{formatCOP(t.sin_ubicar_valor)}</p>
        )}
      </div>
    </div>
  );
}

// ── Extracto: cada hecho con su saldo corrido ───────────────────────────────
function Extracto({ filas, q }) {
  const visibles = useMemo(() => {
    if (!q.trim()) return filas;
    const t = q.toLowerCase();
    return filas.filter((f) =>
      [f.concepto, f.referencia, f.tercero, f.documento, f.detalle]
        .some((v) => String(v ?? '').toLowerCase().includes(t))
    );
  }, [filas, q]);

  if (!visibles.length) {
    return <EmptyState icon={FileText} titulo="Sin movimientos"
      descripcion="No hay hechos registrados en este periodo." />;
  }

  return (
    <div className="border border-gray-100 rounded-2xl overflow-hidden bg-white">
      {visibles.map((f, n) => {
        const Icn = ICONO_ORIGEN[f.origen] || Receipt;
        const esCargo = f.clase === 'cargo';
        const esInfo  = f.clase === 'info';
        return (
          <div key={n}
            className="flex items-start gap-3 px-4 py-3 border-b border-gray-50 last:border-0">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5
              ${esInfo ? 'bg-gray-100' : esCargo ? 'bg-amber-50' : 'bg-green-50'}`}>
              <Icn size={14} className={
                esInfo ? 'text-gray-400' : esCargo ? 'text-amber-600' : 'text-green-600'} />
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{f.concepto}</p>
              <p className="text-xs text-gray-400 truncate">
                {formatFecha(f.fecha)}
                {f.documento  ? ` · #${f.documento}` : ''}
                {f.referencia ? ` · ${f.referencia}` : ''}
                {f.tercero    ? ` · ${f.tercero}`    : ''}
                {f.detalle && f.origen !== 'venta' ? ` · ${f.detalle}` : ''}
              </p>
            </div>

            <div className="text-right flex-shrink-0">
              {esInfo ? (
                <span className="text-xs text-gray-300">informativo</span>
              ) : (
                <p className={`text-sm font-semibold ${esCargo ? 'text-amber-600' : 'text-green-600'}`}>
                  {esCargo ? '+' : '−'}{formatCOP(Math.abs(f.valor))}
                </p>
              )}
              <p className="text-xs text-gray-400">saldo {formatCOP(f.saldo)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Mercancía: unidad por unidad ────────────────────────────────────────────
function Mercancia({ data, estado, onEstado, conteos }) {
  const chips = [
    ['',                 'Todo'],
    ['En consignacion',  'En vitrina'],
    ['Por liquidar',     'Por liquidar'],
    ['En recaudo',       'A crédito'],
    ['En prestamo',      'Prestado'],
    ['Devuelta',         'Devuelto'],
    ['Sin ubicar',       'Sin ubicar'],
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1.5 flex-wrap">
        {chips.map(([valor, label]) => {
          const n = valor ? (conteos[valor] || 0) : null;
          if (valor && !n) return null;
          const activo = estado === valor;
          return (
            <button key={valor || 'todo'} onClick={() => onEstado(valor)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                ${activo ? 'bg-blue-600 border-blue-600 text-white'
                         : 'bg-white border-gray-200 text-gray-600 hover:border-blue-300'}`}>
              {label}{n != null ? ` (${n})` : ''}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between text-xs text-gray-400 px-1">
        <span>{data.total} unidad(es)</span>
        <span>
          valor {formatCOP(data.valor_total)}
          {data.liquidable_total > 0 && ` · por liquidar ${formatCOP(data.liquidable_total)}`}
        </span>
      </div>

      {data.items.length === 0 ? (
        <EmptyState icon={Package} titulo="Sin resultados"
          descripcion="Prueba con otro texto o quita los filtros." />
      ) : (
        <div className="border border-gray-100 rounded-2xl overflow-hidden bg-white">
          {data.items.map((u) => (
            <div key={u.linea_id}
              className="flex items-start gap-3 px-4 py-3 border-b border-gray-50 last:border-0">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{u.nombre_producto}</p>
                <p className="text-xs text-gray-400 font-mono truncate">{u.imei}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Envío #{u.remision_numero ?? u.remision_id}
                  {u.fecha_recepcion ? ` · recibido ${formatFecha(u.fecha_recepcion)}` : ''}
                  {u.factura_numero  ? ` · vendido en #${u.factura_numero}` : ''}
                  {u.nombre_cliente  ? ` a ${u.nombre_cliente}` : ''}
                </p>
              </div>
              <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
                <Badge variant={COLOR_ESTADO[u.estado_unidad] || 'gray'}>
                  {u.etiqueta_estado}
                </Badge>
                <p className="text-sm font-semibold text-gray-700">{formatCOP(u.valor_interno)}</p>
                {u.liquidable > 0 && (
                  <p className="text-xs text-amber-600">debe {formatCOP(u.liquidable)}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Envíos y remesas ────────────────────────────────────────────────────────
function Envios({ remisiones }) {
  if (!remisiones.length) {
    return <EmptyState icon={Truck} titulo="Sin envíos" descripcion="Todavía no ha recibido mercancía." />;
  }
  return (
    <div className="border border-gray-100 rounded-2xl overflow-hidden bg-white">
      {remisiones.map((r) => (
        <div key={r.id} className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900">
              Envío #{r.numero ?? r.id} · {r.total_items} producto(s)
            </p>
            <p className="text-xs text-gray-400">
              De {r.sucursal_origen_nombre} · {formatFechaHora(r.fecha_emision)}
              {r.fecha_recepcion ? ` · recibido ${formatFecha(r.fecha_recepcion)}` : ''}
            </p>
            {r.notas && <p className="text-xs text-gray-400 italic mt-0.5">{r.notas}</p>}
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-sm font-semibold text-gray-700">{formatCOP(r.valor_total)}</p>
            <Badge variant={
              r.estado === 'Recibida' ? 'green' :
              r.estado === 'Parcial'  ? 'yellow' :
              r.estado === 'Anulada'  ? 'red' : 'blue'}>
              {r.estado}
            </Badge>
          </div>
        </div>
      ))}
    </div>
  );
}

function Remesas({ remesas }) {
  if (!remesas.length) {
    return <EmptyState icon={Wallet} titulo="Sin remesas" descripcion="Todavía no ha enviado efectivo." />;
  }
  return (
    <div className="border border-gray-100 rounded-2xl overflow-hidden bg-white">
      {remesas.map((r) => (
        <div key={r.id} className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900">
              Remesa #{r.numero ?? r.id}
            </p>
            <p className="text-xs text-gray-400">
              Enviada {formatFechaHora(r.fecha_envio)}
              {r.usuario_envia_nombre ? ` por ${r.usuario_envia_nombre}` : ''}
              {r.fecha_recepcion ? ` · confirmada ${formatFecha(r.fecha_recepcion)}` : ''}
              {r.usuario_recibe_nombre ? ` por ${r.usuario_recibe_nombre}` : ''}
            </p>
            {r.notas && <p className="text-xs text-gray-400 italic mt-0.5">{r.notas}</p>}
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-sm font-semibold text-green-600">{formatCOP(r.valor)}</p>
            <Badge variant={
              r.estado === 'Recibida' ? 'green' :
              r.estado === 'Anulada'  ? 'red' : 'yellow'}>
              {r.estado === 'En transito' ? 'En tránsito' : r.estado}
            </Badge>
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════

export function EstadoCuentaLocal({ sucursalId, nombre, onVolver }) {
  const [tab,    setTab]    = useState('extracto');
  const [q,      setQ]      = useState('');
  const [estado, setEstado] = useState('');
  const [desde,  setDesde]  = useState('');
  const [hasta,  setHasta]  = useState('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['red-estado-cuenta', sucursalId, q, estado, desde, hasta],
    queryFn:  () => getEstadoCuenta(sucursalId, {
      q: q.trim() || undefined,
      estado: estado || undefined,
      desde: desde || undefined,
      hasta: hasta ? `${hasta} 23:59:59` : undefined,
    }).then((r) => r.data.data),
    keepPreviousData: true,
  });

  const hayFiltro = q.trim() || estado || desde || hasta;

  return (
    <div>
      <button onClick={onVolver}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <ChevronLeft size={16} /> Volver
      </button>

      <div className="flex items-center gap-2 mb-4">
        <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center">
          <Store size={17} className="text-gray-500" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900">{data?.sucursal?.nombre || nombre}</h2>
          <p className="text-xs text-gray-400">Estado de cuenta con la bodega</p>
        </div>
      </div>

      {isError ? (
        <EmptyState icon={AlertTriangle} titulo="No se pudo cargar"
          descripcion={error?.response?.data?.error || 'Intenta de nuevo.'} />
      ) : isLoading && !data ? (
        <div className="py-16 flex justify-center"><Spinner /></div>
      ) : (
        <>
          <Kpis t={data.totales} />

          {/* Controles */}
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <div className="flex-1 flex items-center gap-2 bg-gray-100 rounded-xl px-3 py-2">
              <Search size={15} className="text-gray-400 flex-shrink-0" />
              <input
                value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por producto, IMEI, cliente o número de documento…"
                className="flex-1 bg-transparent text-sm focus:outline-none placeholder-gray-400"
              />
              {q && <button onClick={() => setQ('')}><X size={14} className="text-gray-400" /></button>}
            </div>
            <div className="flex items-center gap-1.5">
              <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
                className="px-2.5 py-2 bg-gray-100 rounded-xl text-sm focus:outline-none
                  focus:ring-2 focus:ring-blue-500 text-gray-600" />
              <span className="text-gray-300 text-sm">–</span>
              <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
                className="px-2.5 py-2 bg-gray-100 rounded-xl text-sm focus:outline-none
                  focus:ring-2 focus:ring-blue-500 text-gray-600" />
              {hayFiltro && (
                <button
                  onClick={() => { setQ(''); setEstado(''); setDesde(''); setHasta(''); }}
                  className="px-2.5 py-2 text-xs text-blue-600 hover:text-blue-700 whitespace-nowrap"
                >
                  Limpiar
                </button>
              )}
            </div>
          </div>

          {/* Pestañas */}
          <div className="flex gap-1 mb-3 border-b border-gray-100 overflow-x-auto">
            {TABS.map((t) => {
              // Se asigna a una variable local en vez de desestructurarla en los
              // parámetros: así el linter reconoce que se usa como componente.
              const Icono = t.Icn;
              return (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2
                    transition-colors whitespace-nowrap
                    ${tab === t.id ? 'border-blue-600 text-blue-600'
                                   : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                  <Icono size={14} /> {t.label}
                  {t.id === 'mercancia' && ` (${data.mercancia.total})`}
                  {t.id === 'envios'    && ` (${data.remisiones.length})`}
                  {t.id === 'remesas'   && ` (${data.remesas.length})`}
                </button>
              );
            })}
          </div>

          {isLoading && <div className="py-2 flex justify-center"><Spinner /></div>}

          {tab === 'extracto'  && <Extracto filas={data.extracto} q={q} />}
          {tab === 'mercancia' && (
            <Mercancia data={data.mercancia} estado={estado} onEstado={setEstado}
              conteos={data.conteo_estados} />
          )}
          {tab === 'envios'  && <Envios remisiones={data.remisiones} />}
          {tab === 'remesas' && <Remesas remesas={data.remesas} />}

          {tab === 'extracto' && data.extracto.length > 0 && (
            <p className="text-xs text-gray-400 mt-3 flex items-center gap-1.5">
              <TrendingUp size={12} />
              Los cargos nacen cuando el local vende; los abonos, cuando la bodega
              confirma la remesa. La mercancía en vitrina no genera deuda.
            </p>
          )}
        </>
      )}
    </div>
  );
}
