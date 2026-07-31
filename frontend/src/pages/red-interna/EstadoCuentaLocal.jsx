import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getEstadoCuenta, getRemision } from '../../api/redInterna.api';
import { formatCOP, formatFecha, formatFechaHora } from '../../utils/formatters';
import { Badge }      from '../../components/ui/Badge';
import { Spinner }    from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { CardEquipo } from './CardEquipo';
import { VENDIDOS }   from './estados';
import {
  ChevronLeft, ChevronDown, Search, X, TrendingUp, TrendingDown, Package, Truck,
  Wallet, FileText, AlertTriangle, Receipt, Filter, Store, Info, HandCoins,
  ShoppingBag, Undo2, LayoutDashboard,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// ESTADO DE CUENTA DE UN LOCAL
//
// Pensado como un extracto bancario, pero contestando en este orden las tres
// preguntas que el local hace de verdad:
//
//   1. ¿Cuánto debo y por qué?          → Resumen
//   2. ¿De cuál envío viene esa deuda,
//      y qué pasó con cada equipo?      → Envíos  (el corazón de la pantalla)
//   3. ¿Qué he pagado y cuándo?         → Pagos
//
// Mercancía (unidad por unidad, con buscador) y Extracto (hecho por hecho, con
// saldo corrido) quedan detrás para quien necesite auditar.
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
  { id: 'resumen',   label: 'Resumen',   Icn: LayoutDashboard },
  { id: 'envios',    label: 'Envíos',    Icn: Truck    },
  { id: 'mercancia', label: 'Mercancía', Icn: Package  },
  { id: 'pagos',     label: 'Pagos',     Icn: Wallet   },
  { id: 'extracto',  label: 'Extracto',  Icn: FileText },
];

// Tailwind necesita las clases completas en el código: nada de `bg-${x}-50`,
// que el compilador no puede ver y termina sin generar.
const TONO = {
  amber: { icono: 'text-amber-500', chip: 'bg-amber-50 text-amber-700' },
  blue:  { icono: 'text-blue-500',  chip: 'bg-blue-50 text-blue-700'   },
  gray:  { icono: 'text-gray-400',  chip: 'bg-gray-100 text-gray-600'  },
  green: { icono: 'text-green-500', chip: 'bg-green-50 text-green-700' },
  red:   { icono: 'text-red-500',   chip: 'bg-red-50 text-red-700'     },
};

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
          {t.en_consignacion_valor != null
            ? formatCOP(t.en_consignacion_valor)
            : `${t.en_consignacion_unidades}`}
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
        {t.sin_ubicar_unidades > 0 && t.sin_ubicar_valor != null && (
          <p className="text-xs text-red-500">{formatCOP(t.sin_ubicar_valor)}</p>
        )}
      </div>
    </div>
  );
}

// ── Desglose: por qué debe lo que debe ──────────────────────────────────────
// La pregunta más común del local no es "cuánto" sino "por qué". Cada renglón
// suma o resta hasta llegar al saldo, y se dice explícitamente lo que NO debe.
function Desglose({ d, ocultos }) {
  if (!d) return null;
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 mb-4">
      <p className="text-xs font-semibold text-gray-400 uppercase mb-2">
        Por qué debe {formatCOP(Math.abs(d.saldo))}
      </p>
      <div className="flex flex-col gap-1.5">
        {d.lineas.map((l) => (
          <div key={l.clave} className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-700">{l.etiqueta}</p>
              {l.medios && Object.keys(l.medios).length > 0 && (
                <p className="text-xs text-gray-400">
                  {Object.entries(l.medios)
                    .map(([m, v]) => `${m}: ${ocultos ? '' : formatCOP(v)}`.trim())
                    .join(' · ')}
                  {l.ultima_fecha ? ` · última ${formatFecha(l.ultima_fecha)}` : ''}
                </p>
              )}
            </div>
            {!ocultos && (
              <span className={`text-sm font-semibold flex-shrink-0
                ${l.valor >= 0 ? 'text-amber-600' : 'text-green-600'}`}>
                {l.valor >= 0 ? '+' : '−'}{formatCOP(Math.abs(l.valor))}
              </span>
            )}
          </div>
        ))}
        <div className="border-t border-gray-100 mt-1 pt-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-900">Total</span>
          <span className="text-base font-bold text-gray-900">{formatCOP(d.saldo)}</span>
        </div>
      </div>

      <div className="mt-3 bg-gray-50 rounded-xl px-3 py-2">
        <p className="text-xs text-gray-500">
          <strong>No debe:</strong> {d.no_debe.unidades} equipo(s) en vitrina
          {d.no_debe.valor != null ? ` (${formatCOP(d.no_debe.valor)})` : ''} —
          solo se liquidan al venderlos.
        </p>
        {d.en_transito > 0 && (
          <p className="text-xs text-amber-600 mt-0.5">
            {formatCOP(d.en_transito)} en remesas sin confirmar.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Resumen: dónde está toda la mercancía que la bodega entregó ─────────────
// Cada bloque es un botón: lleva a la pestaña Mercancía ya filtrada, para que
// "tengo 4 prestados" se pueda convertir en "¿cuáles?" con un toque.
function Situacion({ conteos, porEstado, onFiltrar }) {
  const n = (k) => conteos[k] || 0;
  const valor = (k) => porEstado?.[k]?.valor_interno;

  const bloques = [
    {
      clave: VENDIDOS, Icn: ShoppingBag, color: 'amber',
      titulo: 'Vendidos', nota: 'generan la deuda',
      unidades: n('Por liquidar') + n('En recaudo'),
      valor: (valor('Por liquidar') ?? 0) + (valor('En recaudo') ?? 0),
      hayValor: valor('Por liquidar') != null || valor('En recaudo') != null,
      detalle: [
        n('Por liquidar') > 0 && `${n('Por liquidar')} de contado`,
        n('En recaudo')   > 0 && `${n('En recaudo')} a crédito`,
      ].filter(Boolean).join(' · '),
    },
    {
      clave: 'En prestamo', Icn: HandCoins, color: 'blue',
      titulo: 'Prestados', nota: 'no son deuda todavía',
      unidades: n('En prestamo'), valor: valor('En prestamo'),
      hayValor: valor('En prestamo') != null,
      detalle: 'Fuera del local, sin vender',
    },
    {
      clave: 'En consignacion', Icn: Store, color: 'gray',
      titulo: 'Disponibles', nota: 'en vitrina',
      unidades: n('En consignacion'), valor: valor('En consignacion'),
      hayValor: valor('En consignacion') != null,
      detalle: 'Se liquidan al venderlos',
    },
    {
      clave: 'Devuelta', Icn: Undo2, color: 'green',
      titulo: 'Devueltos', nota: 'volvieron a bodega',
      unidades: n('Devuelta'), valor: valor('Devuelta'),
      hayValor: valor('Devuelta') != null,
      detalle: 'Ya no responde por ellos',
    },
  ];

  const alerta = n('Sin ubicar') + n('Movida');

  return (
    <div className="mb-4">
      <p className="text-xs font-semibold text-gray-400 uppercase mb-2">
        Dónde está la mercancía de la bodega
      </p>
      <div className="grid grid-cols-2 gap-2">
        {bloques.map((b) => {
          const Icono = b.Icn;
          const vacio = b.unidades === 0;
          return (
            <button
              key={b.clave}
              disabled={vacio}
              onClick={() => onFiltrar(b.clave)}
              className={`text-left rounded-2xl border px-4 py-3 transition-all
                ${vacio ? 'bg-white border-gray-100 opacity-50 cursor-default'
                        : 'bg-white border-gray-100 hover:border-blue-300 hover:shadow-sm'}`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Icono size={13} className={TONO[b.color].icono} />
                <span className="text-xs font-medium text-gray-500">{b.titulo}</span>
              </div>
              <p className="text-2xl font-bold text-gray-900 leading-none">{b.unidades}</p>
              {b.hayValor && b.unidades > 0 && (
                <p className="text-xs text-gray-500 mt-1">{formatCOP(b.valor)}</p>
              )}
              <p className="text-xs text-gray-400 mt-0.5 truncate">
                {b.detalle || b.nota}
              </p>
            </button>
          );
        })}
      </div>

      {alerta > 0 && (
        <button
          onClick={() => onFiltrar('Sin ubicar')}
          className="mt-2 w-full flex items-center gap-2 bg-red-50 border border-red-200
            rounded-xl px-4 py-2.5 text-left hover:bg-red-100 transition-colors"
        >
          <AlertTriangle size={15} className="text-red-500 flex-shrink-0" />
          <span className="text-sm text-red-700 flex-1">
            {alerta} equipo(s) sin ubicar — entregados, pero no están en inventario
            ni aparecen vendidos
          </span>
        </button>
      )}
    </div>
  );
}

// ── Envíos: una tarjeta por cada "factura" que dio la bodega ────────────────
// Es la vista que el local pedía: de este envío, qué vendí, qué presté, qué me
// queda — y cuánto de ese envío sigo debiendo.
function ChipEstado({ n, label, color }) {
  if (!n) return null;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs
      font-medium ${TONO[color].chip}`}>
      <strong>{n}</strong> {label}
    </span>
  );
}

function DetalleEnvio({ remisionId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['red-remision', remisionId],
    queryFn:  () => getRemision(remisionId).then((r) => r.data.data),
    staleTime: 60 * 1000,
  });

  if (isLoading || !data) {
    return <div className="py-6 flex justify-center"><Spinner /></div>;
  }

  return (
    <div className="bg-gray-50/70 border-t border-gray-100">
      {/* El envío ya está en el encabezado del acordeón: no repetirlo por línea */}
      {data.lineas.map((l) => (
        <CardEquipo key={l.id} u={{ ...l, valor_interno: l.subtotal }} mostrarEnvio={false} />
      ))}

      {data.correcciones?.length > 0 && (
        <div className="px-4 py-2.5 bg-amber-50/60 border-t border-amber-100">
          <p className="text-xs font-semibold text-amber-700 mb-1">
            Correcciones de valor
          </p>
          {data.correcciones.map((c) => (
            <p key={c.id} className="text-xs text-amber-700">
              {c.nombre_producto}: {formatCOP(c.valor_anterior)} → {formatCOP(c.valor_nuevo)}
              {c.motivo ? ` · ${c.motivo}` : ''} · {formatFecha(c.fecha)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function Envios({ envios, resumen, ocultos }) {
  const [abierto, setAbierto] = useState(null);

  if (!envios.length) {
    return <EmptyState icon={Truck} titulo="Sin envíos"
      descripcion="Todavía no ha recibido mercancía de la bodega." />;
  }

  return (
    <div className="flex flex-col gap-2">
      {!ocultos && resumen && (
        <div className="bg-blue-50/60 border border-blue-100 rounded-xl px-4 py-2.5">
          <p className="text-xs text-blue-800">
            De estos {resumen.total} envío(s) quedan{' '}
            <strong>{formatCOP(resumen.pendiente_en_envios)}</strong> por liquidar.
            {resumen.accesorios_pendiente > 0 && (
              <> Más <strong>{formatCOP(resumen.accesorios_pendiente)}</strong> de
              accesorios, que no cuelgan de un envío concreto.</>
            )}
          </p>
          <p className="text-xs text-blue-600/70 mt-0.5">
            Los pagos cubren las ventas en orden cronológico, de la más antigua
            a la más reciente.
          </p>
        </div>
      )}

      {envios.map((e) => {
        const abre = abierto === e.id;
        const anulado = e.estado === 'Anulada';
        return (
          <div key={e.id}
            className={`border rounded-2xl overflow-hidden bg-white
              ${e.deuda_pendiente > 0 ? 'border-amber-200' : 'border-gray-100'}`}>
            <button
              onClick={() => setAbierto(abre ? null : e.id)}
              className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">
                    Envío #{e.numero ?? e.id}
                    <span className="font-normal text-gray-400">
                      {' · '}{e.unidades} equipo(s)
                      {e.accesorios_unidades > 0 && ` + ${e.accesorios_unidades} accesorio(s)`}
                    </span>
                  </p>
                  <p className="text-xs text-gray-400">
                    {formatFecha(e.fecha_emision)}
                    {e.fecha_recepcion ? ` · recibido ${formatFecha(e.fecha_recepcion)}` : ''}
                    {e.usuario_receptor_nombre ? ` por ${e.usuario_receptor_nombre}` : ''}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  {!ocultos && !anulado && (
                    <>
                      {e.deuda_pendiente > 0 ? (
                        <p className="text-sm font-bold text-amber-600">
                          debe {formatCOP(e.deuda_pendiente)}
                        </p>
                      ) : e.deuda_generada > 0 ? (
                        <p className="text-sm font-semibold text-green-600">al día</p>
                      ) : (
                        <p className="text-sm text-gray-300">sin deuda</p>
                      )}
                      {e.valor_recibido > 0 && (
                        <p className="text-xs text-gray-400">
                          recibió {formatCOP(e.valor_recibido)}
                        </p>
                      )}
                    </>
                  )}
                  {anulado && <Badge variant="red">Anulado</Badge>}
                  {e.estado === 'En transito' && <Badge variant="blue">En tránsito</Badge>}
                  {e.estado === 'Parcial' && <Badge variant="yellow">Parcial</Badge>}
                </div>
                <ChevronDown size={16}
                  className={`text-gray-300 flex-shrink-0 mt-0.5 transition-transform
                    ${abre ? 'rotate-180' : ''}`} />
              </div>

              {!anulado && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <ChipEstado n={e.vendidas}    label="vendidos"    color="amber" />
                  <ChipEstado n={e.prestadas}   label="prestados"   color="blue"  />
                  <ChipEstado n={e.disponibles} label="disponibles" color="gray"  />
                  <ChipEstado n={e.devueltas}   label="devueltos"   color="green" />
                  <ChipEstado n={e.en_transito} label="en tránsito" color="blue"  />
                  <ChipEstado n={e.faltantes}   label="no llegaron" color="red"   />
                  <ChipEstado n={e.sin_ubicar}  label="sin ubicar"  color="red"   />
                </div>
              )}

              {!ocultos && e.vendidas > 0 && e.vendidas_credito > 0 && (
                <p className="text-xs text-gray-400 mt-1.5">
                  {e.vendidas_contado > 0 && `${e.vendidas_contado} de contado`}
                  {e.vendidas_contado > 0 && e.vendidas_credito > 0 && ' · '}
                  {e.vendidas_credito > 0 &&
                    `${e.vendidas_credito} a crédito (liquida a medida que cobra)`}
                </p>
              )}

              {e.notas && (
                <p className="text-xs text-gray-400 italic mt-1">{e.notas}</p>
              )}
            </button>

            {abre && <DetalleEnvio remisionId={e.id} />}
          </div>
        );
      })}
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
              {esInfo || f.valor === null ? (
                <span className="text-xs text-gray-300">
                  {esInfo ? 'informativo' : (esCargo ? 'cargo' : 'abono')}
                </span>
              ) : (
                <p className={`text-sm font-semibold ${esCargo ? 'text-amber-600' : 'text-green-600'}`}>
                  {esCargo ? '+' : '−'}{formatCOP(Math.abs(f.valor))}
                </p>
              )}
              {f.saldo !== null && (
                <p className="text-xs text-gray-400">saldo {formatCOP(f.saldo)}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Mercancía: unidad por unidad ────────────────────────────────────────────
function Mercancia({ data, estado, onEstado, conteos }) {
  const vendidos = (conteos['Por liquidar'] || 0) + (conteos['En recaudo'] || 0);
  const chips = [
    ['',                 'Todo',         null],
    [VENDIDOS,           'Vendidos',     vendidos],
    ['En consignacion',  'En vitrina',   conteos['En consignacion'] || 0],
    ['En prestamo',      'Prestados',    conteos['En prestamo']     || 0],
    ['Por liquidar',     'De contado',   conteos['Por liquidar']    || 0],
    ['En recaudo',       'A crédito',    conteos['En recaudo']      || 0],
    ['Devuelta',         'Devueltos',    conteos['Devuelta']        || 0],
    ['Sin ubicar',       'Sin ubicar',   conteos['Sin ubicar']      || 0],
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1.5 flex-wrap">
        {chips.map(([valor, label, n]) => {
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
        {data.valor_total != null && (
          <span>
            valor {formatCOP(data.valor_total)}
            {data.liquidable_total > 0 && ` · por liquidar ${formatCOP(data.liquidable_total)}`}
          </span>
        )}
      </div>

      {data.items.length === 0 ? (
        <EmptyState icon={Package} titulo="Sin resultados"
          descripcion="Prueba con otro texto o quita los filtros." />
      ) : (
        <div className="border border-gray-100 rounded-2xl overflow-hidden bg-white">
          {data.items.map((u) => <CardEquipo key={u.linea_id} u={u} />)}
        </div>
      )}
    </div>
  );
}

// ── Pagos: todo lo que ha bajado la deuda, con su fecha ─────────────────────
// Remesas, gastos por cuenta de bodega y ajustes en una sola línea de tiempo:
// para el local los tres son "lo que ya no debo", aunque por dentro sean
// tablas distintas.
function Pagos({ remesas, movimientos, totales }) {
  const filas = useMemo(() => {
    const deRemesas = remesas.map((r) => ({
      clave:   `rem-${r.id}`,
      tipo:    'remesa',
      titulo:  `Remesa #${r.numero ?? r.id}`,
      valor:   Number(r.valor || 0),
      estado:  r.estado,
      fecha:   r.fecha_recepcion || r.fecha_envio,
      detalle: [
        r.metodo || 'Efectivo',
        `enviada ${formatFechaHora(r.fecha_envio)}`,
        r.usuario_envia_nombre && `por ${r.usuario_envia_nombre}`,
        r.fecha_recepcion && `confirmada ${formatFecha(r.fecha_recepcion)}`,
        r.usuario_recibe_nombre && `por ${r.usuario_recibe_nombre}`,
      ].filter(Boolean).join(' · '),
      notas: r.notas,
    }));

    const deMovimientos = movimientos.map((m) => ({
      clave:   `mov-${m.id}`,
      tipo:    m.tipo === 'GastoAutorizado' ? 'gasto' : 'ajuste',
      titulo:  m.concepto || (m.tipo === 'GastoAutorizado'
                 ? 'Gasto por cuenta de bodega' : 'Ajuste'),
      valor:   Number(m.valor || 0),
      estado:  'Recibida',
      fecha:   m.fecha,
      detalle: [
        m.tipo === 'GastoAutorizado' ? 'Gasto por cuenta de bodega' : 'Ajuste de la bodega',
        m.usuario_nombre && `registrado por ${m.usuario_nombre}`,
        formatFechaHora(m.fecha),
      ].filter(Boolean).join(' · '),
    }));

    return [...deRemesas, ...deMovimientos]
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  }, [remesas, movimientos]);

  if (!filas.length) {
    return <EmptyState icon={Wallet} titulo="Sin pagos"
      descripcion="Todavía no ha entregado dinero ni tiene gastos a favor." />;
  }

  const ICONO = { remesa: Wallet, gasto: TrendingDown, ajuste: Filter };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-gray-100 bg-white px-3 py-2">
          <p className="text-xs text-gray-400">Remesado</p>
          <p className="text-sm font-bold text-green-600">
            {formatCOP(totales.remesado_recibido)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white px-3 py-2">
          <p className="text-xs text-gray-400">En tránsito</p>
          <p className={`text-sm font-bold ${
            totales.remesas_en_transito > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
            {formatCOP(totales.remesas_en_transito)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white px-3 py-2">
          <p className="text-xs text-gray-400">Gastos a favor</p>
          <p className="text-sm font-bold text-gray-700">
            {formatCOP(totales.gastos_autorizados)}
          </p>
        </div>
      </div>

      <div className="border border-gray-100 rounded-2xl overflow-hidden bg-white">
        {filas.map((f) => {
          const Icn = ICONO[f.tipo] || Wallet;
          const pendiente = f.estado === 'En transito';
          const anulada   = f.estado === 'Anulada';
          return (
            <div key={f.clave}
              className="flex items-start gap-3 px-4 py-3 border-b border-gray-50 last:border-0">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5
                ${anulada ? 'bg-gray-100' : pendiente ? 'bg-amber-50' : 'bg-green-50'}`}>
                <Icn size={14} className={
                  anulada ? 'text-gray-400' : pendiente ? 'text-amber-600' : 'text-green-600'} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{f.titulo}</p>
                <p className="text-xs text-gray-400">{f.detalle}</p>
                {f.notas && <p className="text-xs text-gray-400 italic">{f.notas}</p>}
              </div>
              <div className="text-right flex-shrink-0">
                <p className={`text-sm font-semibold
                  ${anulada ? 'text-gray-300 line-through' : 'text-green-600'}`}>
                  {formatCOP(f.valor)}
                </p>
                {f.tipo === 'remesa' && (
                  <Badge variant={
                    f.estado === 'Recibida' ? 'green' :
                    f.estado === 'Anulada'  ? 'red' : 'yellow'}>
                    {f.estado === 'En transito' ? 'Sin confirmar' : f.estado}
                  </Badge>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-400 flex items-center gap-1.5">
        <Info size={12} />
        Una remesa solo baja la deuda cuando la bodega confirma que la recibió.
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════

export function EstadoCuentaLocal({ sucursalId, nombre, onVolver }) {
  const [tab,    setTab]    = useState('resumen');
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
  // El buscador y las fechas solo aplican donde hay volumen; en las demás
  // pestañas estorban.
  const conFiltros = tab === 'mercancia' || tab === 'extracto';

  const verMercancia = (filtro) => { setEstado(filtro); setTab('mercancia'); };

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

          {data.costos_ocultos && (
            <p className="text-xs text-gray-400 mb-3 flex items-center gap-1.5">
              <Info size={12} /> Los costos de la mercancía no se muestran en tu perfil.
            </p>
          )}

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
                  {t.id === 'envios'    && ` (${(data.envios || []).length})`}
                  {t.id === 'mercancia' && ` (${data.mercancia.total})`}
                  {t.id === 'pagos'     && ` (${data.remesas.length +
                                                (data.movimientos_cuenta || []).length})`}
                </button>
              );
            })}
          </div>

          {/* Controles — solo donde sirven */}
          {conFiltros && (
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
          )}

          {isLoading && <div className="py-2 flex justify-center"><Spinner /></div>}

          {tab === 'resumen' && (
            <>
              <Desglose d={data.desglose} ocultos={data.costos_ocultos === true} />
              <Situacion
                conteos={data.conteo_estados}
                porEstado={data.por_estado}
                onFiltrar={verMercancia}
              />
              <p className="text-xs text-gray-400 flex items-center gap-1.5">
                <TrendingUp size={12} />
                La deuda nace cuando el local vende; la mercancía en vitrina y la
                prestada todavía no se liquidan.
              </p>
            </>
          )}
          {tab === 'envios' && (
            <Envios
              envios={data.envios || []}
              resumen={data.envios_resumen}
              ocultos={data.costos_ocultos === true}
            />
          )}
          {tab === 'mercancia' && (
            <Mercancia data={data.mercancia} estado={estado} onEstado={setEstado}
              conteos={data.conteo_estados} />
          )}
          {tab === 'pagos' && (
            <Pagos remesas={data.remesas} movimientos={data.movimientos_cuenta || []}
              totales={data.totales} />
          )}
          {tab === 'extracto' && <Extracto filas={data.extracto} q={q} />}

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
