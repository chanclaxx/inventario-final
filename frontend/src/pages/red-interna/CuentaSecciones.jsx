import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getRemision } from '../../api/redInterna.api';
import { formatCOP, formatFecha, formatFechaHora } from '../../utils/formatters';
import { Badge }      from '../../components/ui/Badge';
import { Spinner }    from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { CardEquipo } from './CardEquipo';
import { CHIPS, contar, VENDIDOS } from './estados';
import {
  ChevronDown, Search, X, TrendingUp, TrendingDown, Package, Truck,
  Wallet, FileText, Receipt, Filter, Info, HandCoins, ShoppingBag, Undo2,
  Store, AlertTriangle,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// EL CONTENIDO DE CADA PESTAÑA DE LA CUENTA CON LA BODEGA
//
// El armazón (las dos cifras y las pestañas) vive en CuentaLocal.jsx. Aquí solo
// están los cuerpos, uno por pestaña, para que ninguno de los dos archivos se
// vuelva ilegible.
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
  ajuste: Filter, remision: Truck, devolucion: Package,
};

// ═══════════════════════════════════════════════════════════════════════════
// RESUMEN — de qué está hecha la deuda y dónde está la mercancía
// ═══════════════════════════════════════════════════════════════════════════

// La deuda total, renglón por renglón. Es la respuesta a "¿por qué debo esto?"
// contada con los mismos hechos que la calculan: te entregaron, devolviste,
// pagaste.
function ComposicionDeuda({ t, ocultos }) {
  if (ocultos || t.deuda_total == null) return null;

  const filas = [
    { clave: 'poder',  etiqueta: 'Mercancía que tienes de la bodega',
      detalle: 'vitrina, prestados y lo vendido sin pagar', valor: t.valor_en_poder },
    { clave: 'pagos',  etiqueta: 'Lo que ya le pagaste',
      detalle: 'remesas confirmadas', valor: -t.remesado_recibido },
  ];
  if (t.gastos_autorizados > 0) {
    filas.push({ clave: 'gastos', etiqueta: 'Gastos que pagaste por cuenta de la bodega',
      valor: -t.gastos_autorizados });
  }
  if (t.ajustes !== 0) {
    filas.push({ clave: 'ajustes', etiqueta: 'Ajustes de la bodega', valor: -t.ajustes });
  }

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
          <span className="text-sm font-semibold text-gray-900">Deuda total</span>
          <span className="text-base font-bold text-gray-900">{formatCOP(t.deuda_total)}</span>
        </div>
      </div>
    </div>
  );
}

// De esa deuda, qué parte hay que entregar ya y qué parte todavía no.
function ExigibleVsNo({ t, ocultos }) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 mb-3">
      <p className="text-xs font-semibold text-gray-400 uppercase mb-2">
        Cuánto de eso hay que entregar ya
      </p>
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-amber-700">Por remitir ahora</p>
            <p className="text-xs text-gray-400">
              lo que ya vendiste y todavía no has pagado
            </p>
          </div>
          <span className="text-sm font-bold text-amber-700 flex-shrink-0">
            {formatCOP(t.saldo_por_liquidar)}
          </span>
        </div>
        {!ocultos && t.por_vender != null && (
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-gray-600">Todavía no se cobra</p>
              <p className="text-xs text-gray-400">
                lo que sigue en vitrina, lo prestado y los créditos sin recaudar
              </p>
            </div>
            <span className="text-sm font-semibold text-gray-500 flex-shrink-0">
              {formatCOP(t.por_vender)}
            </span>
          </div>
        )}
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
      ].filter(Boolean).join(' · ') || 'generan lo exigible',
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
      detalle: 'ya no responde por ellos',
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
            ni aparecen vendidos
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
      <ComposicionDeuda t={data.totales} ocultos={ocultos} />
      <ExigibleVsNo     t={data.totales} ocultos={ocultos} />
      <Situacion
        conteos={data.conteo_estados}
        porEstado={data.por_estado}
        onFiltrar={onFiltrar}
      />
      <p className="text-xs text-gray-400 mt-3 flex items-center gap-1.5">
        <TrendingUp size={12} />
        La deuda sube cuando la bodega despacha; lo exigible sube cuando el local
        vende.
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
        {data.valor_total != null && (
          <span>
            valor {formatCOP(data.valor_total)}
            {data.liquidable_total > 0 && ` · exigible ${formatCOP(data.liquidable_total)}`}
          </span>
        )}
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
// ENVÍOS — una tarjeta por cada "factura" que dio la bodega
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

export function TabEnvios({ envios, resumen, ocultos }) {
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
            <strong>{formatCOP(resumen.pendiente_en_envios)}</strong> por remitir.
            {resumen.accesorios_pendiente > 0 && (
              <> Más <strong>{formatCOP(resumen.accesorios_pendiente)}</strong> de
              accesorios, que no cuelgan de un envío concreto.</>
            )}
          </p>
          <p className="text-xs text-blue-600/70 mt-0.5">
            Los pagos cubren las ventas en orden cronológico, de la más antigua a
            la más reciente.
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
                          remitir {formatCOP(e.deuda_pendiente)}
                        </p>
                      ) : e.deuda_generada > 0 ? (
                        <p className="text-sm font-semibold text-green-600">al día</p>
                      ) : (
                        <p className="text-sm text-gray-300">nada exigible</p>
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

              {e.notas && <p className="text-xs text-gray-400 italic mt-1">{e.notas}</p>}
            </button>

            {abre && <DetalleEnvio remisionId={e.id} />}
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGOS — remesas, gastos y ajustes en una sola línea de tiempo
// ═══════════════════════════════════════════════════════════════════════════

const ICONO_PAGO = { remesa: Wallet, gasto: TrendingDown, ajuste: Filter };

export function TabPagos({ remesas, movimientos, totales }) {
  const filas = useMemo(() => [
    ...remesas.map((r) => ({
      clave: `rem-${r.id}`, tipo: 'remesa',
      titulo: `Remesa #${r.numero ?? r.id}`,
      valor: Number(r.valor || 0), estado: r.estado,
      fecha: r.fecha_recepcion || r.fecha_envio,
      detalle: [
        r.metodo || 'Efectivo',
        `enviada ${formatFechaHora(r.fecha_envio)}`,
        r.usuario_envia_nombre && `por ${r.usuario_envia_nombre}`,
        r.fecha_recepcion && `confirmada ${formatFecha(r.fecha_recepcion)}`,
        r.usuario_recibe_nombre && `por ${r.usuario_recibe_nombre}`,
      ].filter(Boolean).join(' · '),
      notas: r.notas,
    })),
    ...movimientos.map((m) => ({
      clave: `mov-${m.id}`,
      tipo: m.tipo === 'GastoAutorizado' ? 'gasto' : 'ajuste',
      titulo: m.concepto || (m.tipo === 'GastoAutorizado'
        ? 'Gasto por cuenta de bodega' : 'Ajuste'),
      valor: Number(m.valor || 0), estado: 'Recibida', fecha: m.fecha,
      detalle: [
        m.tipo === 'GastoAutorizado' ? 'Gasto por cuenta de bodega' : 'Ajuste de la bodega',
        m.usuario_nombre && `registrado por ${m.usuario_nombre}`,
        formatFechaHora(m.fecha),
      ].filter(Boolean).join(' · '),
    })),
  ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha)), [remesas, movimientos]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-gray-100 bg-white px-3 py-2">
          <p className="text-xs text-gray-400">Confirmado</p>
          <p className="text-sm font-bold text-green-600">
            {formatCOP(totales.remesado_recibido)}
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
          <p className="text-xs text-gray-400">Gastos a favor</p>
          <p className="text-sm font-bold text-gray-700">
            {formatCOP(totales.gastos_autorizados)}
          </p>
        </div>
      </div>

      {filas.length === 0 ? (
        <EmptyState icon={Wallet} titulo="Sin pagos"
          descripcion="Todavía no le ha entregado dinero a la bodega." />
      ) : (
        <div className="border border-gray-100 rounded-2xl overflow-hidden bg-white">
          {filas.map((f) => {
            const Icn = ICONO_PAGO[f.tipo] || Wallet;
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
      )}

      <p className="text-xs text-gray-400 flex items-center gap-1.5">
        <Info size={12} />
        Una remesa solo baja la deuda cuando la bodega confirma que la recibió.
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// EXTRACTO — hecho por hecho, con el saldo corrido
// ═══════════════════════════════════════════════════════════════════════════

export function TabExtracto({ filas, q, onQ, desde, hasta, onDesde, onHasta }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 flex items-center gap-2 bg-gray-100 rounded-xl px-3 py-2">
          <Search size={15} className="text-gray-400 flex-shrink-0" />
          <input
            value={q} onChange={(e) => onQ(e.target.value)}
            placeholder="Buscar en los movimientos…"
            className="flex-1 bg-transparent text-sm focus:outline-none placeholder-gray-400"
          />
          {q && <button onClick={() => onQ('')}><X size={14} className="text-gray-400" /></button>}
        </div>
        <div className="flex items-center gap-1.5">
          <input type="date" value={desde} onChange={(e) => onDesde(e.target.value)}
            className="px-2.5 py-2 bg-gray-100 rounded-xl text-sm focus:outline-none
              focus:ring-2 focus:ring-blue-500 text-gray-600" />
          <span className="text-gray-300 text-sm">–</span>
          <input type="date" value={hasta} onChange={(e) => onHasta(e.target.value)}
            className="px-2.5 py-2 bg-gray-100 rounded-xl text-sm focus:outline-none
              focus:ring-2 focus:ring-blue-500 text-gray-600" />
        </div>
      </div>

      {filas.length === 0 ? (
        <EmptyState icon={FileText} titulo="Sin movimientos"
          descripcion="No hay hechos registrados en este periodo." />
      ) : (
        <div className="border border-gray-100 rounded-2xl overflow-hidden bg-white">
          {filas.map((f, n) => {
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
      )}

      <p className="text-xs text-gray-400 flex items-center gap-1.5">
        <TrendingUp size={12} />
        Este extracto sigue lo EXIGIBLE: los cargos nacen cuando el local vende y
        los abonos cuando la bodega confirma la remesa.
      </p>
    </div>
  );
}
