import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  getRemision, anularMovimientoCuenta, anularRemesa, moverAbono,
  corregirValorLinea,
} from '../../api/redInterna.api';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { ModalReportarFaltante } from './ModalReportarFaltante';
import { formatCOP, formatFecha, formatFechaHora } from '../../utils/formatters';
import { Badge }      from '../../components/ui/Badge';
import { Button }     from '../../components/ui/Button';
import { Spinner }    from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { CardEquipo } from './CardEquipo';
import { CHIPS, contar, VENDIDOS } from './estados';
import {
  ChevronDown, Search, X, TrendingUp, TrendingDown, Package, Truck,
  Wallet, FileText, Receipt, Filter, Info, HandCoins, ShoppingBag, Undo2,
  Store, AlertTriangle, CheckCircle2, Send, PiggyBank, Undo2 as Deshacer,
  Clock, XCircle, ArrowRightLeft, PackageX, Pencil, SlidersHorizontal,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// EL CONTENIDO DE CADA PESTAÑA DE LA CUENTA CON LA BODEGA
//
// El armazón (las cifras de arriba y las pestañas) vive en CuentaLocal.jsx.
//
// LA IDEA DE TODA LA PANTALLA, desde el cambio de modelo de agosto 2026:
// cada ENVÍO es una cuenta, igual que una factura a crédito de un cliente.
// Tiene su cargo, sus abonos y su saldo, y se paga envío por envío. Que la
// mercancía esté vendida o siga en vitrina se muestra, pero es INFORMATIVO:
// no mueve un peso. Donde algo diga "informativo", quiere decir eso.
// ─────────────────────────────────────────────────────────────────────────────

// Tailwind necesita las clases completas en el código: nada de `bg-${x}-50`,
// que el compilador no puede ver y termina sin generar.
const TONO = {
  amber: { icono: 'text-amber-500', chip: 'bg-amber-50 text-amber-700' },
  blue:  { icono: 'text-blue-500',  chip: 'bg-blue-50 text-blue-700'   },
  gray:  { icono: 'text-gray-400',  chip: 'bg-gray-100 text-gray-600'  },
  green: { icono: 'text-green-500', chip: 'bg-green-50 text-green-700' },
  red:   { icono: 'text-red-500',   chip: 'bg-red-50 text-red-700'     },
};

const ICONO_ORIGEN = {
  venta: Receipt, remesa: Wallet, gasto: TrendingDown,
  ajuste: Filter, remision: Truck, devolucion: Undo2, correccion: Filter,
};

const ICONO_ABONO = {
  remesa: Wallet, gasto: TrendingDown, ajuste: Filter, saldo_favor: PiggyBank,
};

const ETIQUETA_ABONO = {
  remesa: 'Pago', gasto: 'Gasto por cuenta de bodega',
  ajuste: 'Abono de la bodega', saldo_favor: 'Saldo a favor aplicado',
};

// ═══════════════════════════════════════════════════════════════════════════
// RESUMEN — de qué está hecha la deuda y de dónde va a salir la plata
// ═══════════════════════════════════════════════════════════════════════════

// La deuda, renglón por renglón. Es la respuesta a "¿por qué debo esto?"
// contada con los mismos hechos que la calculan.
function ComposicionDeuda({ t }) {
  const filas = [
    { clave: 'envios', etiqueta: 'Mercancía que te entregó la bodega',
      detalle: 'lo devuelto ya está descontado', valor: t.cargo_total },
    { clave: 'pagos', etiqueta: 'Lo que ya le pagaste',
      detalle: 'pagos, gastos y abonos', valor: -t.abonado_total },
  ];
  if (t.cargos_sueltos > 0) {
    filas.push({ clave: 'cargos', etiqueta: 'Cargos que te hizo aparte',
      detalle: 'roturas, faltantes u otros ajustes en contra', valor: t.cargos_sueltos });
  }

  if (t.cargo_total == null) return null;

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 mb-3">
      <p className="text-xs font-semibold text-gray-400 uppercase mb-2">
        De qué está hecha la deuda
      </p>
      <div className="flex flex-col gap-1.5">
        {filas.map((f) => (
          <div key={f.clave} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-gray-700">{f.etiqueta}</p>
              {f.detalle && <p className="text-xs text-gray-400">{f.detalle}</p>}
            </div>
            <span className={`text-sm font-semibold flex-shrink-0
              ${f.valor >= 0 ? 'text-amber-600' : 'text-green-600'}`}>
              {f.valor >= 0 ? '+' : '−'}{formatCOP(Math.abs(f.valor))}
            </span>
          </div>
        ))}
        <div className="border-t border-gray-100 mt-1 pt-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-900">Deuda</span>
          <span className="text-base font-bold text-gray-900">{formatCOP(t.deuda_total)}</span>
        </div>
        {t.saldo_a_favor > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-blue-700">Saldo a favor sin usar</span>
            <span className="text-sm font-semibold text-blue-700">
              −{formatCOP(t.saldo_a_favor)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// De lo que debe, de dónde va a salir la plata. Es informativo y es la duda más
// común del local ahora que paga todo lo que recibe.
function Respaldo({ t, ocultos }) {
  if (ocultos || t.vendido_valor == null) return null;
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 mb-3">
      <p className="text-xs font-semibold text-gray-400 uppercase mb-2">
        De esa deuda, dónde está la plata
      </p>
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-green-700">Ya lo vendiste</p>
            <p className="text-xs text-gray-400">
              {t.vendido_unidades} equipo(s) · la plata ya entró (o está por cobrar)
            </p>
          </div>
          <span className="text-sm font-bold text-green-700 flex-shrink-0">
            {formatCOP(t.vendido_valor)}
          </span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-gray-600">Sigue en vitrina o prestado</p>
            <p className="text-xs text-gray-400">
              lo debes igual, pero todavía no lo has convertido en plata
            </p>
          </div>
          <span className="text-sm font-semibold text-gray-500 flex-shrink-0">
            {formatCOP(Number(t.en_vitrina_valor || 0) + Number(t.prestado_valor || 0))}
          </span>
        </div>
      </div>
      {t.remesas_en_transito > 0 && (
        <p className="text-xs text-amber-600 mt-2.5 flex items-center gap-1.5">
          <Info size={12} />
          {formatCOP(t.remesas_en_transito)} enviados, esperando que la bodega confirme.
        </p>
      )}
    </div>
  );
}

// Dónde está la mercancía. Cada bloque lleva a la lista ya filtrada: "tengo 4
// prestados" se vuelve "¿cuáles?" con un toque.
function Situacion({ conteos, porEstado, onFiltrar }) {
  const n = (k) => conteos[k] || 0;
  const valor = (k) => porEstado?.[k]?.valor_interno;

  const bloques = [
    {
      clave: VENDIDOS, Icn: ShoppingBag, color: 'amber', titulo: 'Vendidos',
      unidades: n('Por liquidar') + n('En recaudo'),
      valor: (valor('Por liquidar') ?? 0) + (valor('En recaudo') ?? 0),
      hayValor: valor('Por liquidar') != null || valor('En recaudo') != null,
      detalle: [
        n('Por liquidar') > 0 && `${n('Por liquidar')} de contado`,
        n('En recaudo')   > 0 && `${n('En recaudo')} a crédito`,
      ].filter(Boolean).join(' · ') || 'ya salieron',
    },
    {
      clave: 'En prestamo', Icn: HandCoins, color: 'blue', titulo: 'Prestados',
      unidades: n('En prestamo'), valor: valor('En prestamo'),
      hayValor: valor('En prestamo') != null,
      detalle: 'fuera del local, sin vender',
    },
    {
      clave: 'En consignacion', Icn: Store, color: 'gray', titulo: 'Disponibles',
      unidades: n('En consignacion'), valor: valor('En consignacion'),
      hayValor: valor('En consignacion') != null,
      detalle: 'en vitrina',
    },
    {
      clave: 'Devuelta', Icn: Undo2, color: 'green', titulo: 'Devueltos',
      unidades: n('Devuelta'), valor: valor('Devuelta'),
      hayValor: valor('Devuelta') != null,
      detalle: 'ya no los debes',
    },
  ];

  const alerta = n('Sin ubicar') + n('Movida');

  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase mb-2">
        Dónde está la mercancía de la bodega
      </p>
      <div className="grid grid-cols-2 gap-2">
        {bloques.map((b) => {
          const Icono = b.Icn;
          const vacio = b.unidades === 0;
          return (
            <button
              key={b.clave} disabled={vacio} onClick={() => onFiltrar(b.clave)}
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
              <p className="text-xs text-gray-400 mt-0.5 truncate">{b.detalle}</p>
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
            ni aparecen vendidos. Los debes igual.
          </span>
        </button>
      )}
    </div>
  );
}

export function TabResumen({ data, onFiltrar }) {
  const ocultos = data.costos_ocultos === true;
  return (
    <>
      <ComposicionDeuda t={data.totales} />
      <Respaldo t={data.totales} ocultos={ocultos} />
      <Situacion
        conteos={data.conteo_estados}
        porEstado={data.por_estado}
        onFiltrar={onFiltrar}
      />
      <p className="text-xs text-gray-400 mt-3 flex items-center gap-1.5">
        <TrendingUp size={12} />
        La deuda sube cuando recibes un envío y baja cuando pagas o devuelves.
        Vender no la mueve.
      </p>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MERCANCÍA — equipo por equipo
// ═══════════════════════════════════════════════════════════════════════════

export function TabMercancia({ data, conteos, estado, onEstado, q, onQ, cargando }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1.5 flex-wrap">
        {CHIPS.map((c) => {
          const n = contar(conteos, c.clave);
          if (c.valor && !n) return null;
          const activo = estado === c.valor;
          return (
            <button key={c.valor || 'todo'} onClick={() => onEstado(c.valor)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                ${activo ? 'bg-blue-600 border-blue-600 text-white'
                         : 'bg-white border-gray-200 text-gray-600 hover:border-blue-300'}`}>
              {c.label}{n != null ? ` (${n})` : ''}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 bg-gray-100 rounded-xl px-3 py-2">
        <Search size={15} className="text-gray-400 flex-shrink-0" />
        <input
          value={q} onChange={(e) => onQ(e.target.value)}
          placeholder="Buscar por producto, IMEI, cliente o documento…"
          className="flex-1 bg-transparent text-sm focus:outline-none placeholder-gray-400"
        />
        {q && <button onClick={() => onQ('')}><X size={14} className="text-gray-400" /></button>}
      </div>

      <div className="flex items-center justify-between text-xs text-gray-400 px-1">
        <span>{data.total} unidad(es)</span>
        {data.valor_total != null && <span>valor {formatCOP(data.valor_total)}</span>}
      </div>

      {cargando && <div className="py-2 flex justify-center"><Spinner /></div>}

      {data.items.length === 0 ? (
        <EmptyState icon={Package} titulo="Sin resultados"
          descripcion="Prueba con otro texto o quita los filtros." />
      ) : (
        <div className="border border-gray-100 rounded-2xl overflow-hidden bg-white">
          {data.items.map((u) => <CardEquipo key={u.linea_id} u={u} />)}
        </div>
      )}

      {data.items.length > 0 && data.items.length < data.total && (
        <p className="text-xs text-gray-400 text-center">
          Mostrando {data.items.length} de {data.total} — filtra o busca para acotar.
        </p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ENVÍOS — la pantalla principal: una cuenta por envío
// ═══════════════════════════════════════════════════════════════════════════

function ChipEstado({ n, label, color }) {
  if (!n) return null;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs
      font-medium ${TONO[color].chip}`}>
      <strong>{n}</strong> {label}
    </span>
  );
}

// Barra de avance del pago. Es la misma lectura de un crédito: cuánto de esta
// deuda ya está cubierto.
function Avance({ cargo, abonado }) {
  if (!cargo) return null;
  const pct = Math.min(100, Math.round((Number(abonado) / Number(cargo)) * 100));
  return (
    <div className="mt-2">
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-green-500' : 'bg-amber-400'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-gray-400 mt-1">
        {formatCOP(abonado)} de {formatCOP(cargo)} · {pct}%
      </p>
    </div>
  );
}

// El estado de cuenta de UN envío: el cargo arriba, los abonos debajo. Es la
// conversación del envío, y responde "¿por qué debo esto todavía?".
function MovimientosEnvio({ envio, abonos }) {
  const efectivos = abonos.filter(
    (a) => !a.anulado && (a.origen !== 'remesa' || a.remesa_estado === 'Recibida')
  );
  const pendientes = abonos.filter(
    (a) => !a.anulado && a.origen === 'remesa' && a.remesa_estado === 'En transito'
  );

  return (
    <div className="px-4 py-3 border-b border-gray-100">
      <p className="text-xs font-semibold text-gray-400 uppercase mb-2">
        Movimientos de este envío
      </p>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
            <Truck size={13} className="text-amber-500" /> Mercancía recibida
          </span>
          <span className="text-sm font-semibold text-amber-600">
            +{formatCOP(envio.cargo)}
          </span>
        </div>

        {efectivos.map((a) => {
          const Icn = ICONO_ABONO[a.origen] || Wallet;
          return (
            <div key={a.id} className="flex items-start justify-between gap-3">
              <span className="inline-flex items-start gap-1.5 text-sm text-gray-700 min-w-0">
                <Icn size={13} className="text-green-500 flex-shrink-0 mt-0.5" />
                <span className="min-w-0">
                  {ETIQUETA_ABONO[a.origen] || 'Abono'}
                  {a.remesa_numero != null && ` #${a.remesa_numero}`}
                  <span className="block text-xs text-gray-400">
                    {formatFecha(a.fecha)}
                    {a.metodo ? ` · ${a.metodo}` : ''}
                    {a.movimiento_concepto ? ` · ${a.movimiento_concepto}` : ''}
                  </span>
                </span>
              </span>
              <span className="text-sm font-semibold text-green-600 flex-shrink-0">
                −{formatCOP(a.valor)}
              </span>
            </div>
          );
        })}

        {pendientes.map((a) => (
          <div key={a.id} className="flex items-start justify-between gap-3 opacity-60">
            <span className="inline-flex items-start gap-1.5 text-sm text-gray-500 min-w-0">
              <Wallet size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <span>
                Pago #{a.remesa_numero ?? a.remesa_id}
                <span className="block text-xs text-gray-400">
                  sin confirmar por la bodega
                </span>
              </span>
            </span>
            <span className="text-sm text-gray-400 flex-shrink-0">
              ({formatCOP(a.valor)})
            </span>
          </div>
        ))}

        <div className="border-t border-gray-100 mt-1 pt-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-900">
            {envio.saldo > 0 ? 'Queda debiendo' : 'Saldo'}
          </span>
          <span className={`text-base font-bold
            ${envio.saldo > 0 ? 'text-amber-700' : 'text-green-600'}`}>
            {formatCOP(envio.saldo)}
          </span>
        </div>
        {envio.excedente > 0 && (
          <p className="text-xs text-blue-600 flex items-center gap-1.5">
            <PiggyBank size={12} />
            Pagaste {formatCOP(envio.excedente)} de más (devolviste mercancía ya
            pagada). Se aplica al próximo envío.
          </p>
        )}
      </div>
    </div>
  );
}

// Un renglón por producto del envío. Compacto a propósito: la tarjeta muestra
// TODOS sus productos sin desplegar nada, así que cada uno tiene que caber en
// una línea. La ficha completa de un equipo vive en la pestaña Mercancía.
const PUNTO_ESTADO = {
  'Por liquidar':    'bg-amber-500',
  'En recaudo':      'bg-purple-500',
  'En prestamo':     'bg-blue-500',
  'En consignacion': 'bg-gray-300',
  'Devuelta':        'bg-green-500',
  'En transito':     'bg-blue-400',
  'Faltante':        'bg-red-500',
  'Sin ubicar':      'bg-red-500',
  'Movida':          'bg-red-500',
};

function LineaEnvio({ l }) {
  const devuelta = l.estado_linea === 'Devuelta';
  const faltante = l.estado_linea === 'Faltante';
  const tachado  = devuelta || faltante;
  return (
    <div className={`flex items-center gap-2.5 px-4 py-1.5 text-sm ${tachado ? 'opacity-55' : ''}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0
        ${PUNTO_ESTADO[l.estado_unidad] || 'bg-gray-300'}`} />
      <span className="flex-1 min-w-0 truncate text-gray-800">
        {l.nombre_producto}
        {l.tipo === 'cantidad' && l.cantidad > 1 && (
          <span className="text-gray-400"> × {l.cantidad}</span>
        )}
      </span>
      {l.imei && (
        <span className="hidden md:inline text-xs text-gray-400 font-mono truncate max-w-[9rem]">
          {l.imei}
        </span>
      )}
      <span className="hidden sm:block text-xs text-gray-500 w-28 text-right truncate">
        {faltante ? 'no llegó' : devuelta ? 'devuelto' : l.etiqueta_estado}
      </span>
      {l.subtotal != null && (
        <span className={`text-xs w-24 text-right tabular-nums
          ${tachado ? 'text-gray-400 line-through' : 'text-gray-600'}`}>
          {formatCOP(l.subtotal)}
        </span>
      )}
    </div>
  );
}

// El desplegable ya NO guarda los productos —esos están siempre a la vista—
// sino la CUENTA del envío: su cargo y sus abonos. Se pide al abrir porque solo
// se miran cuando alguien pregunta "¿por qué debo esto todavía?".
// Corregir el valor de un producto ya entregado.
//
// El backend lo soporta desde julio —con nota de quién, cuándo y por qué— y
// nunca tuvo pantalla: `getRemision` devolvía `puede_corregir` y no lo leía
// nadie. Era el único mecanismo limpio para arreglar un precio mal puesto, y
// estaba inalcanzable desde la aplicación.
function CorregirLinea({ linea, enTransito, onListo }) {
  const [abierto, setAbierto] = useState(false);
  const [valor,   setValor]   = useState(Math.round(Number(linea.valor_interno || 0)));
  const [motivo,  setMotivo]  = useState('');
  const [error,   setError]   = useState('');

  const guardar = useMutation({
    mutationFn: () => corregirValorLinea(linea.id, {
      valor_nuevo: Number(valor), motivo: motivo.trim() || undefined,
    }),
    onSuccess: () => { setAbierto(false); onListo?.(); },
    onError: (e) => setError(e?.response?.data?.error || 'No se pudo corregir'),
  });

  if (!abierto) {
    return (
      <button
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-1 text-xs text-gray-400
          hover:text-blue-600 transition-colors"
      >
        <Pencil size={11} /> Corregir valor
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 bg-white border border-blue-200 rounded-xl p-3 mt-1">
      <p className="text-xs text-gray-500">
        {linea.nombre_producto} · hoy vale {formatCOP(linea.valor_interno)}
      </p>
      <InputMoneda
        value={valor} onChange={(v) => { setValor(v === '' ? 0 : Number(v)); setError(''); }}
        className="w-full px-3 py-2 bg-gray-100 border-0 rounded-lg text-sm text-right
          tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {/* En tránsito se edita limpio; ya recibido, el motivo es obligatorio y
          queda la nota de corrección en el extracto. */}
      {!enTransito && (
        <input
          value={motivo} onChange={(e) => { setMotivo(e.target.value); setError(''); }}
          maxLength={200}
          placeholder="¿Por qué se corrige? (obligatorio)"
          className="w-full px-3 py-2 bg-gray-100 border-0 rounded-lg text-sm
            placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      )}
      {!enTransito && (
        <p className="text-xs text-amber-600">
          Cambia lo que el local debe por este producto. Queda la nota de quién y
          por qué.
        </p>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" className="flex-1"
          onClick={() => setAbierto(false)}>Cancelar</Button>
        <Button size="sm" className="flex-1"
          disabled={!enTransito && !motivo.trim()}
          loading={guardar.isPending} onClick={() => guardar.mutate()}>
          Guardar
        </Button>
      </div>
    </div>
  );
}

function CuentaDelEnvio({ envio, onCambio }) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['red-remision', envio.id],
    queryFn:  () => getRemision(envio.id).then((r) => r.data.data),
    staleTime: 30 * 1000,
  });

  if (isLoading || !data) {
    return <div className="py-6 flex justify-center"><Spinner /></div>;
  }

  const puedeCorregir = data.puede_corregir || data.puede_editar_valores;

  return (
    <div className="bg-gray-50/70 border-t border-gray-100">
      <MovimientosEnvio envio={envio} abonos={data.abonos || []} />

      {puedeCorregir && (
        <div className="px-4 py-3 border-t border-gray-100">
          <p className="text-xs font-semibold text-gray-400 uppercase mb-2">
            Corregir el valor de un producto
          </p>
          <div className="flex flex-col gap-2">
            {(data.lineas || []).filter((l) => l.estado_linea !== 'Faltante').map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-3">
                <span className="text-sm text-gray-700 truncate min-w-0">
                  {l.nombre_producto}
                  {l.valor_interno != null && (
                    <span className="text-gray-400"> · {formatCOP(l.valor_interno)}</span>
                  )}
                </span>
                <CorregirLinea
                  linea={l}
                  enTransito={data.puede_editar_valores === true}
                  onListo={() => { refetch(); onCambio?.(); }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {data.correcciones?.length > 0 && (
        <div className="px-4 py-2.5 bg-amber-50/60 border-t border-amber-100">
          <p className="text-xs font-semibold text-amber-700 mb-1">Correcciones de valor</p>
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

// Un cargo que la bodega le hizo al local (una rotura, un faltante). Se muestra
// entre los envíos, con su saldo y su botón de abonar, porque es exactamente lo
// mismo: una deuda con su documento.
//
// Antes era una línea suelta en el resumen que decía "tienes este cargo" y ya:
// no se podía pagar y ni siquiera se veía de dónde salía. Peor, convivía con el
// saldo a favor — "debes $830.000" y "tienes $586.010 a tu favor" a la vez.
function TarjetaCargo({ c, propia, onAbonar }) {
  const debe = c.saldo > 0;
  return (
    <div className={`border rounded-2xl overflow-hidden bg-white
      ${debe ? 'border-red-200' : 'border-gray-100'}`}>
      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
            <SlidersHorizontal size={16} className="text-red-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">
              {c.concepto || 'Cargo de la bodega'}
            </p>
            <p className="text-xs text-gray-400">
              Cargo · {formatFecha(c.fecha)}
              {c.usuario_nombre ? ` · ${c.usuario_nombre}` : ''}
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            {debe ? (
              <>
                <p className="text-lg font-bold text-red-600">{formatCOP(c.saldo)}</p>
                <p className="text-xs text-gray-400">por pagar</p>
              </>
            ) : (
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-green-600">
                <CheckCircle2 size={14} /> Pagado
              </span>
            )}
          </div>
        </div>
        <Avance cargo={c.cargo} abonado={c.abonado} />
      </div>
      {propia && debe && (
        <div className="px-4 py-2.5 border-t border-gray-50">
          <Button size="sm" onClick={() => onAbonar(c)}>
            <Send size={14} /> Abonar
          </Button>
        </div>
      )}
    </div>
  );
}

export function TabEnvios({
  envios, cargos = [], resumen, ocultos, propia, onAbonar, onAbonarCargo, onCambio,
}) {
  const [abierto, setAbierto] = useState(null);
  const [verPagados, setVerPagados] = useState(false);
  // "Recibí todo" y faltaba una caja: el error más caro del día a día del local
  // desde que recibir genera la deuda.
  const [reclamando, setReclamando] = useState(null);

  if (!envios.length) {
    return <EmptyState icon={Truck} titulo="Sin envíos"
      descripcion="Todavía no ha recibido mercancía de la bodega." />;
  }

  // Igual que en créditos: primero lo que está abierto, y el historial de lo
  // saldado se despliega aparte para que no compita por la atención.
  const abiertos = envios.filter((e) => e.saldo > 0 || e.estado === 'En transito');
  const cerrados = envios.filter((e) => !(e.saldo > 0 || e.estado === 'En transito'));
  const cargosAbiertos = cargos.filter((c) => c.saldo > 0);
  const cargosCerrados = cargos.filter((c) => c.saldo <= 0);

  const tarjeta = (e) => {
    const abre = abierto === e.id;
    const anulado = e.estado === 'Anulada';
    const debe = e.saldo > 0;
    const lineas = e.lineas || [];
    return (
      <div key={e.id}
        className={`border rounded-2xl overflow-hidden bg-white
          ${debe ? 'border-amber-200' : 'border-gray-100'}`}>
        <div className="px-4 py-3">
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
              {anulado ? <Badge variant="red">Anulado</Badge>
               : e.estado === 'En transito' ? <Badge variant="blue">En tránsito</Badge>
               : debe ? (
                  <>
                    <p className="text-lg font-bold text-amber-700">{formatCOP(e.saldo)}</p>
                    <p className="text-xs text-gray-400">por pagar</p>
                  </>
                ) : e.cargo > 0 ? (
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-green-600">
                    <CheckCircle2 size={14} /> Pagado
                  </span>
                ) : <p className="text-sm text-gray-300">sin cargo</p>}
            </div>
          </div>

          {!anulado && e.cargo > 0 && <Avance cargo={e.cargo} abonado={e.abonado} />}

          {/* Informativo: qué pasó con la mercancía. No mueve la cuenta. */}
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

          {e.notas && <p className="text-xs text-gray-400 italic mt-1">{e.notas}</p>}
        </div>

        {/* Los productos, SIEMPRE a la vista. "¿Qué me mandaron?" es lo primero
            que el local pregunta; esconderlo tras un desplegable costaba un
            clic por envío para el dato más consultado de la pantalla. */}
        {lineas.length > 0 && (
          <div className="border-t border-gray-50 bg-gray-50/40 py-1">
            {lineas.map((l) => <LineaEnvio key={l.linea_id} l={l} />)}
          </div>
        )}

        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-gray-50">
          {propia && debe && (
            <Button size="sm" onClick={() => onAbonar(e)}>
              <Send size={14} /> Abonar
            </Button>
          )}
          {propia && !anulado && e.cargo > 0 && (
            <button
              onClick={() => setReclamando(e)}
              className="inline-flex items-center gap-1 text-xs text-gray-400
                hover:text-amber-600 transition-colors"
            >
              <PackageX size={12} /> ¿Algo no llegó?
            </button>
          )}
          {e.cargo > 0 && (
            <button
              onClick={() => setAbierto(abre ? null : e.id)}
              className="ml-auto flex items-center gap-1 text-xs font-medium text-gray-500
                hover:text-gray-700 transition-colors"
            >
              {abre ? 'Ocultar' : 'Ver'} movimientos
              <ChevronDown size={13}
                className={`transition-transform ${abre ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>

        {abre && <CuentaDelEnvio envio={e} onCambio={onCambio} />}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {!ocultos && resumen && (
        <div className="bg-blue-50/60 border border-blue-100 rounded-xl px-4 py-2.5">
          <p className="text-xs text-blue-800">
            {resumen.abiertos > 0 || cargosAbiertos.length > 0
              ? <>Tienes <strong>{resumen.abiertos}</strong> envío(s) sin pagar por{' '}
                 <strong>{formatCOP(resumen.saldo_total)}</strong>.</>
              : <>Todos tus envíos están pagados.</>}
            {resumen.cargos_sueltos > 0 && (
              <> Más <strong>{formatCOP(resumen.cargos_sueltos)}</strong> de cargos
              que la bodega te hizo aparte — abajo, con su tarjeta.</>
            )}
            {resumen.saldo_a_favor > 0 && (
              <> Y <strong>{formatCOP(resumen.saldo_a_favor)}</strong> a tu favor
              para el próximo.</>
            )}
          </p>
        </div>
      )}

      {/* Los cargos abiertos van con los envíos abiertos: es la misma deuda y
          se paga igual. Separarlos era lo que hacía que un cargo pareciera un
          aviso y no algo que hay que pagar. */}
      {cargosAbiertos.map((c) => (
        <TarjetaCargo key={`c-${c.cargo_id}`} c={c} propia={propia} onAbonar={onAbonarCargo} />
      ))}

      {abiertos.map(tarjeta)}

      {abiertos.length + cargosAbiertos.length === 0 && (
        <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3 text-center">
          <p className="text-green-700 text-sm font-medium">✓ Sin envíos por pagar</p>
        </div>
      )}

      {reclamando && (
        <ModalReportarFaltante
          envio={reclamando}
          onCerrar={() => setReclamando(null)}
          onListo={(msg) => { setReclamando(null); onCambio?.(msg); }}
        />
      )}

      {cerrados.length + cargosCerrados.length > 0 && (
        <div className="border border-gray-100 rounded-2xl overflow-hidden">
          <button
            onClick={() => setVerPagados((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3
              bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Cerrados ({cerrados.length + cargosCerrados.length})
            </span>
            <ChevronDown size={15}
              className={`text-gray-400 transition-transform ${verPagados ? 'rotate-180' : ''}`} />
          </button>
          {verPagados && (
            <div className="flex flex-col gap-2 p-3">
              {cargosCerrados.map((c) => (
                <TarjetaCargo key={`c-${c.cargo_id}`} c={c} propia={false} />
              ))}
              {cerrados.map(tarjeta)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGOS — cada pago con los envíos que tapó
// ═══════════════════════════════════════════════════════════════════════════

export function TabPagos({
  remesas, movimientos, abonos, totales, envios = [], esBodega, onHecho,
}) {
  // Todo lo que se puede deshacer pasa por aquí. La regla de quién puede qué la
  // decide el backend; la pantalla solo ofrece lo que tiene sentido ofrecer.
  const [moviendo, setMoviendo] = useState(null);   // abono a reimputar

  const deshacer = useMutation({
    mutationFn: ({ tipo, id }) => (tipo === 'remesa'
      ? anularRemesa(id)
      : anularMovimientoCuenta(id, {})),
    onSuccess: () => onHecho?.('Movimiento deshecho'),
    onError: (e) => onHecho?.(e?.response?.data?.error || 'No se pudo deshacer', true),
  });

  const reimputar = useMutation({
    mutationFn: ({ abonoId, remisionId }) => moverAbono(abonoId, remisionId),
    onSuccess: () => { setMoviendo(null); onHecho?.('Abono movido al otro envío'); },
    onError: (e) => onHecho?.(e?.response?.data?.error || 'No se pudo mover', true),
  });

  // Los abonos vienen sueltos, uno por envío. Se agrupan por su remesa para
  // mostrar el pago tal como lo hizo el usuario: "entregué $2M y cubrió tres
  // envíos". El total NO se guarda en ninguna parte, se suma aquí — es el
  // mismo criterio que en el pago total a un acreedor.
  const porRemesa = useMemo(() => {
    const m = new Map();
    for (const a of abonos || []) {
      if (a.origen !== 'remesa' || a.remesa_id == null) continue;
      if (!m.has(a.remesa_id)) m.set(a.remesa_id, []);
      m.get(a.remesa_id).push(a);
    }
    return m;
  }, [abonos]);

  const porMovimiento = useMemo(() => {
    const m = new Map();
    for (const a of abonos || []) {
      if (a.origen === 'remesa' || a.movimiento_id == null) continue;
      if (!m.has(a.movimiento_id)) m.set(a.movimiento_id, []);
      m.get(a.movimiento_id).push(a);
    }
    return m;
  }, [abonos]);

  const destino = (lista) => {
    if (!lista?.length) return null;
    if (lista.length === 1) return `al envío #${lista[0].remision_numero ?? lista[0].remision_id}`;
    return `repartido entre ${lista.length} envíos`;
  };

  const filas = useMemo(() => [
    ...remesas.map((r) => ({
      clave: `rem-${r.id}`, tipo: 'remesa',
      titulo: `Pago #${r.numero ?? r.id}`,
      valor: Number(r.valor || 0), estado: r.estado,
      fecha: r.fecha_recepcion || r.fecha_envio,
      reparto: destino(porRemesa.get(Number(r.id)) || porRemesa.get(r.id)),
      abonos:  porRemesa.get(Number(r.id)) || porRemesa.get(r.id) || [],
      // En tránsito lo anula cualquiera de los dos; ya confirmado, solo la
      // bodega — es la que dijo que lo tenía.
      puedeDeshacer: r.estado === 'En transito' || (r.estado === 'Recibida' && esBodega),
      ref: r.id,
      detalle: [
        r.metodo || 'Efectivo',
        `enviado ${formatFechaHora(r.fecha_envio)}`,
        r.usuario_envia_nombre && `por ${r.usuario_envia_nombre}`,
        r.fecha_recepcion && `confirmado ${formatFecha(r.fecha_recepcion)}`,
      ].filter(Boolean).join(' · '),
      notas: r.notas,
    })),
    ...movimientos.map((m) => ({
      clave: `mov-${m.id}`,
      tipo: m.tipo === 'GastoAutorizado' ? 'gasto' : 'ajuste',
      titulo: m.concepto || (m.tipo === 'GastoAutorizado'
        ? 'Gasto por cuenta de bodega' : 'Ajuste'),
      valor: Number(m.valor || 0), estado: 'Recibida', fecha: m.fecha,
      reparto: destino(porMovimiento.get(Number(m.id)) || porMovimiento.get(m.id)),
      abonos:  [],
      estadoAprobacion: m.estado,
      aprobadoPor: m.aprobado_por,
      // Un ajuste solo lo anula la bodega. Un gasto lo anula ella siempre, y el
      // local solo mientras nadie lo haya aprobado.
      puedeDeshacer: m.tipo === 'Ajuste'
        ? esBodega
        : (esBodega || m.estado !== 'Aprobado'),
      ref: m.id,
      detalle: [
        m.tipo === 'GastoAutorizado' ? 'Gasto por cuenta de bodega'
          : Number(m.valor) < 0 ? 'Cargo de la bodega' : 'Abono de la bodega',
        m.usuario_nombre && `registrado por ${m.usuario_nombre}`,
        formatFechaHora(m.fecha),
      ].filter(Boolean).join(' · '),
    })),
  ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha)),
  // `esBodega` entra en las dependencias porque decide `puedeDeshacer`: una
  // remesa ya confirmada solo la revierte la bodega.
  [remesas, movimientos, porRemesa, porMovimiento, esBodega]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-gray-100 bg-white px-3 py-2">
          <p className="text-xs text-gray-400">Abonado</p>
          <p className="text-sm font-bold text-green-600">
            {formatCOP(totales.abonado_total)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white px-3 py-2">
          <p className="text-xs text-gray-400">Sin confirmar</p>
          <p className={`text-sm font-bold ${
            totales.remesas_en_transito > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
            {formatCOP(totales.remesas_en_transito)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white px-3 py-2">
          <p className="text-xs text-gray-400">A tu favor</p>
          <p className={`text-sm font-bold ${
            totales.saldo_a_favor > 0 ? 'text-blue-600' : 'text-gray-300'}`}>
            {formatCOP(totales.saldo_a_favor)}
          </p>
        </div>
      </div>

      {filas.length === 0 ? (
        <EmptyState icon={Wallet} titulo="Sin pagos"
          descripcion="Todavía no le ha entregado dinero a la bodega." />
      ) : (
        <div className="border border-gray-100 rounded-2xl overflow-hidden bg-white">
          {filas.map((f) => {
            const Icn = ICONO_ABONO[f.tipo] || Wallet;
            const pendiente = f.estado === 'En transito';
            const anulada   = f.estado === 'Anulada';
            const enContra  = f.valor < 0;
            return (
              <div key={f.clave}
                className="flex items-start gap-3 px-4 py-3 border-b border-gray-50 last:border-0">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5
                  ${anulada ? 'bg-gray-100' : pendiente ? 'bg-amber-50'
                    : enContra ? 'bg-red-50' : 'bg-green-50'}`}>
                  <Icn size={14} className={
                    anulada ? 'text-gray-400' : pendiente ? 'text-amber-600'
                      : enContra ? 'text-red-500' : 'text-green-600'} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{f.titulo}</p>
                  <p className="text-xs text-gray-400">{f.detalle}</p>
                  {f.reparto && !anulada && f.estadoAprobacion !== 'Rechazado' && (
                    <p className="text-xs text-blue-600">{f.reparto}</p>
                  )}
                  {f.notas && <p className="text-xs text-gray-400 italic">{f.notas}</p>}

                  {/* Acciones de deshacer. Se ofrecen aquí, junto al movimiento
                      que hay que corregir, y no en un menú aparte. */}
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    {f.puedeDeshacer && (
                      <button
                        onClick={() => deshacer.mutate({ tipo: f.tipo, id: f.ref })}
                        disabled={deshacer.isPending}
                        className="inline-flex items-center gap-1 text-xs text-gray-400
                          hover:text-red-500 transition-colors disabled:opacity-50"
                      >
                        <Deshacer size={11} />
                        {f.tipo === 'remesa' && f.estado === 'Recibida' ? 'Revertir' : 'Anular'}
                      </button>
                    )}
                    {f.abonos.length === 1 && f.estado === 'Recibida' && (
                      <button
                        onClick={() => setMoviendo(f.abonos[0])}
                        className="inline-flex items-center gap-1 text-xs text-gray-400
                          hover:text-blue-600 transition-colors"
                      >
                        <ArrowRightLeft size={11} /> Cambiar de envío
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`text-sm font-semibold
                    ${anulada ? 'text-gray-300 line-through'
                      : enContra ? 'text-red-500' : 'text-green-600'}`}>
                    {formatCOP(Math.abs(f.valor))}
                  </p>
                  {f.tipo === 'remesa' && (
                    <Badge variant={
                      f.estado === 'Recibida' ? 'green' :
                      f.estado === 'Anulada'  ? 'red' : 'yellow'}>
                      {f.estado === 'En transito' ? 'Sin confirmar' : f.estado}
                    </Badge>
                  )}
                  {/* Un gasto no baja la deuda hasta que la bodega lo apruebe:
                      el local tiene que ver en qué quedó el suyo. */}
                  {f.estadoAprobacion === 'Por aprobar' && (
                    <Badge variant="yellow">
                      <Clock size={10} /> Por aprobar
                    </Badge>
                  )}
                  {f.estadoAprobacion === 'Rechazado' && (
                    <Badge variant="red">
                      <XCircle size={10} /> Rechazado
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-gray-400 flex items-center gap-1.5">
        <Info size={12} />
        Un pago solo baja la deuda cuando la bodega confirma que lo recibió, y un
        gasto cuando ella lo aprueba.
      </p>

      {moviendo && (
        <ModalMoverAbono
          abono={moviendo}
          envios={envios}
          cargando={reimputar.isPending}
          onCerrar={() => setMoviendo(null)}
          onMover={(remisionId) => reimputar.mutate({ abonoId: moviendo.id, remisionId })}
        />
      )}
    </div>
  );
}

// ── Mover un abono al envío correcto ────────────────────────────────────────
// El arreglo del pago que entró a la tarjeta equivocada: la plata estaba bien
// contada en el total y mal en el detalle. No toca tesorería ni caja.
function ModalMoverAbono({ abono, envios, cargando, onCerrar, onMover }) {
  const candidatos = envios.filter(
    (e) => e.id !== abono.remision_id && e.estado !== 'Anulada' && e.cargo > 0
  );
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center
      bg-black/40 p-0 sm:p-4" onClick={onCerrar}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md
        max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100">
          <p className="text-base font-bold text-gray-900">Mover este abono</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {formatCOP(abono.valor)} · hoy está en el envío
            #{abono.remision_numero ?? abono.remision_id}
          </p>
        </div>
        {candidatos.length === 0 ? (
          <p className="px-5 py-8 text-sm text-gray-400 text-center">
            No hay otro envío al que moverlo.
          </p>
        ) : (
          <div className="divide-y divide-gray-50">
            {candidatos.map((e) => (
              <button
                key={e.id} disabled={cargando}
                onClick={() => onMover(e.id)}
                className="w-full flex items-center gap-3 px-5 py-3 hover:bg-gray-50
                  transition-colors text-left disabled:opacity-50"
              >
                <Truck size={15} className="text-gray-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    Envío #{e.numero ?? e.id}
                  </p>
                  <p className="text-xs text-gray-400">
                    {formatFecha(e.fecha_emision)} · debe {formatCOP(e.saldo)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
        <div className="px-5 py-3 border-t border-gray-100">
          <Button variant="secondary" className="w-full" onClick={onCerrar}>Cancelar</Button>
        </div>
      </div>
    </div>
  );
}
