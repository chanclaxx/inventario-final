import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { getEstadoCuenta, recibirRemision } from '../../api/redInterna.api';
import { formatCOP, formatFecha, formatFechaHora } from '../../utils/formatters';
import { Button }     from '../../components/ui/Button';
import { Badge }      from '../../components/ui/Badge';
import { Spinner }    from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { ModalRecibir } from './ModalRecibir';
import { ModalRemesa }  from './ModalRemesa';
import { CardEquipo }   from './CardEquipo';
import { CHIPS, contar } from './estados';
import {
  Package, Send, Wallet, Clock, CheckCircle, Search, X, ChevronRight,
  AlertTriangle, TrendingDown, Filter, Store,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// LA PÁGINA DEL LOCAL — tres bloques, sin pestañas
//
//   1. DEUDA          cuánto le debe a la bodega, y los envíos por recibir
//   2. LO QUE TENGO   equipo por equipo: en qué estado está y a dónde fue
//   3. PAGOS          lo que ya entregó, con su fecha y su estado
//
// Todo se ve haciendo scroll. Nada vive detrás de una pestaña: el vendedor que
// abre esta página en el mostrador ve la deuda sin tocar nada, y el detalle de
// cualquier equipo está a un scroll de distancia, no a dos clics.
//
// El estado de cuenta completo (extracto con saldo corrido y envío por envío)
// sigue existiendo para quien tenga que auditar, al final del bloque 3.
// ─────────────────────────────────────────────────────────────────────────────

function Bloque({ titulo, sub, children, accion }) {
  return (
    <section className="mb-5">
      <div className="flex items-end justify-between mb-2 px-1">
        <div>
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">{titulo}</h2>
          {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
        </div>
        {accion}
      </div>
      {children}
    </section>
  );
}

// ── 1 · Envíos que la bodega mandó y todavía no se confirman ────────────────
// Van DENTRO del bloque de deuda porque es lo que está por convertirse en
// deuda. Un toque en "Recibí todo" y entra al inventario; "Revisar" es para
// cuando faltó algo.
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
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">
                  Envío #{r.numero ?? r.id}
                  <span className="font-normal text-gray-400"> · {r.total_items} producto(s)</span>
                </p>
                <p className="text-xs text-gray-400">{formatFechaHora(r.fecha_emision)}</p>
                {r.notas && <p className="text-xs text-gray-400 italic">{r.notas}</p>}
              </div>
            </div>
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

// ── 1 · La deuda ────────────────────────────────────────────────────────────
function BloqueDeuda({ t, desglose, ocultos, porRecibir, onPagar, onAviso, onRefrescar }) {
  const debe   = Number(t.saldo_por_liquidar || 0);
  const aFavor = debe < 0;

  return (
    <Bloque titulo="Deuda con la bodega">
      <PorRecibir envios={porRecibir} onAviso={onAviso} onRefrescar={onRefrescar} />

      <div className={`rounded-2xl border p-5
        ${debe > 0 ? 'bg-amber-50 border-amber-200'
         : aFavor  ? 'bg-blue-50 border-blue-200'
                   : 'bg-green-50 border-green-200'}`}>
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          {aFavor ? 'La bodega te debe' : 'Debes'}
        </p>
        <p className="text-4xl font-bold text-gray-900 mt-1 leading-none">
          {formatCOP(Math.abs(debe))}
        </p>
        <p className="text-sm text-gray-500 mt-1.5">
          {debe > 0 ? 'de los productos que ya vendiste'
           : aFavor ? 'remitiste de más (o hubo una anulación)'
                    : 'Estás al día ✓'}
        </p>

        {/* Cómo se llegó a ese número, sin entrar a ninguna parte */}
        {!ocultos && desglose && (
          <div className="mt-3 pt-3 border-t border-black/5 flex flex-col gap-1">
            {desglose.lineas.map((l) => (
              <div key={l.clave} className="flex items-center justify-between gap-3">
                <span className="text-xs text-gray-500">{l.etiqueta}</span>
                <span className={`text-xs font-semibold flex-shrink-0
                  ${l.valor >= 0 ? 'text-amber-700' : 'text-green-700'}`}>
                  {l.valor >= 0 ? '+' : '−'}{formatCOP(Math.abs(l.valor))}
                </span>
              </div>
            ))}
          </div>
        )}

        {t.remesas_en_transito > 0 && (
          <p className="text-xs text-amber-700 mt-2.5 flex items-center gap-1.5">
            <Clock size={13} />
            {formatCOP(t.remesas_en_transito)} enviados, esperando que la bodega confirme
          </p>
        )}

        <Button className="mt-4 w-full" onClick={onPagar}>
          <Send size={15} /> Pagar a la bodega
        </Button>
      </div>

      {desglose?.no_debe?.unidades > 0 && (
        <p className="text-xs text-gray-400 mt-2 px-1">
          No entran en la deuda los {desglose.no_debe.unidades} equipo(s) que siguen
          en vitrina ni los prestados: solo se liquidan al venderlos.
        </p>
      )}
    </Bloque>
  );
}

// ── 2 · Lo que tiene el local ───────────────────────────────────────────────
function BloqueMercancia({ mercancia, conteos, estado, onEstado, q, onQ, cargando }) {
  return (
    <Bloque
      titulo="Lo que tengo de la bodega"
      sub={`${mercancia.total} equipo(s) en esta vista`}
    >
      <div className="flex gap-1.5 flex-wrap mb-2">
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

      <div className="flex items-center gap-2 bg-gray-100 rounded-xl px-3 py-2 mb-2">
        <Search size={15} className="text-gray-400 flex-shrink-0" />
        <input
          value={q} onChange={(e) => onQ(e.target.value)}
          placeholder="Buscar por producto, IMEI o cliente…"
          className="flex-1 bg-transparent text-sm focus:outline-none placeholder-gray-400"
        />
        {q && <button onClick={() => onQ('')}><X size={14} className="text-gray-400" /></button>}
      </div>

      {cargando && <div className="py-2 flex justify-center"><Spinner /></div>}

      {mercancia.items.length === 0 ? (
        <EmptyState icon={Package} titulo="Sin equipos"
          descripcion={q || estado
            ? 'Prueba con otro texto o quita el filtro.'
            : 'Todavía no has recibido mercancía de la bodega.'} />
      ) : (
        <div className="border border-gray-100 rounded-2xl overflow-hidden bg-white">
          {mercancia.items.map((u) => <CardEquipo key={u.linea_id} u={u} />)}
        </div>
      )}

      {mercancia.items.length > 0 && mercancia.items.length < mercancia.total && (
        <p className="text-xs text-gray-400 text-center mt-2">
          Mostrando {mercancia.items.length} de {mercancia.total} — filtra o busca
          para acotar la lista.
        </p>
      )}
    </Bloque>
  );
}

// ── 3 · Los pagos hechos ────────────────────────────────────────────────────
// Remesas, gastos por cuenta de bodega y ajustes juntos: para el local los tres
// son "lo que ya no debo", aunque por dentro sean tablas distintas.
const ICONO_PAGO = { remesa: Wallet, gasto: TrendingDown, ajuste: Filter };

function BloquePagos({ remesas, movimientos, totales, onVerCuenta }) {
  const filas = [
    ...remesas.map((r) => ({
      clave: `rem-${r.id}`, tipo: 'remesa',
      titulo: `Remesa #${r.numero ?? r.id}`,
      valor: Number(r.valor || 0), estado: r.estado,
      fecha: r.fecha_recepcion || r.fecha_envio,
      detalle: [
        r.metodo || 'Efectivo',
        `enviada ${formatFecha(r.fecha_envio)}`,
        r.usuario_envia_nombre && `por ${r.usuario_envia_nombre}`,
        r.fecha_recepcion && `confirmada ${formatFecha(r.fecha_recepcion)}`,
      ].filter(Boolean).join(' · '),
      notas: r.notas,
    })),
    ...movimientos.map((m) => ({
      clave: `mov-${m.id}`,
      tipo: m.tipo === 'GastoAutorizado' ? 'gasto' : 'ajuste',
      titulo: m.concepto || (m.tipo === 'GastoAutorizado'
        ? 'Gasto por cuenta de bodega' : 'Ajuste de la bodega'),
      valor: Number(m.valor || 0), estado: 'Recibida', fecha: m.fecha,
      detalle: [
        m.tipo === 'GastoAutorizado' ? 'Gasto por cuenta de bodega' : 'Ajuste de la bodega',
        m.usuario_nombre && `registrado por ${m.usuario_nombre}`,
        formatFecha(m.fecha),
      ].filter(Boolean).join(' · '),
    })),
  ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  return (
    <Bloque titulo="Lo que he pagado" sub={`${filas.length} movimiento(s)`}>
      <div className="grid grid-cols-3 gap-2 mb-2">
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
          descripcion="Todavía no le has entregado dinero a la bodega." />
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

      <button
        onClick={onVerCuenta}
        className="w-full mt-2 flex items-center justify-between px-4 py-3 bg-white
          border border-gray-100 rounded-2xl hover:bg-gray-50 transition-colors"
      >
        <span className="text-sm text-blue-600 font-medium">
          Ver estado de cuenta completo (envío por envío y extracto)
        </span>
        <ChevronRight size={16} className="text-gray-300" />
      </button>
    </Bloque>
  );
}

// ═══════════════════════════════════════════════════════════════════════════

export function PanelLocal({ panel, onRefrescar, onAviso, onVerCuenta }) {
  const [remesa, setRemesa] = useState(false);
  const [estado, setEstado] = useState('');
  const [q,      setQ]      = useState('');

  const sucursalId = panel.sucursal_id;

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['red-estado-cuenta', sucursalId, q, estado, '', ''],
    queryFn:  () => getEstadoCuenta(sucursalId, {
      q: q.trim() || undefined,
      estado: estado || undefined,
    }).then((r) => r.data.data),
    keepPreviousData: true,
  });

  if (isError) {
    return (
      <EmptyState icon={AlertTriangle} titulo="No se pudo cargar tu cuenta"
        descripcion={error?.response?.data?.error || 'Intenta de nuevo.'} />
    );
  }
  if (isLoading && !data) {
    return <div className="py-16 flex justify-center"><Spinner /></div>;
  }

  const t = data.totales;
  const ocultos = data.costos_ocultos === true;

  return (
    <>
      <BloqueDeuda
        t={t}
        desglose={data.desglose}
        ocultos={ocultos}
        porRecibir={panel.por_recibir || []}
        onPagar={() => setRemesa(true)}
        onAviso={onAviso}
        onRefrescar={onRefrescar}
      />

      <BloqueMercancia
        mercancia={data.mercancia}
        conteos={data.conteo_estados}
        estado={estado} onEstado={setEstado}
        q={q} onQ={setQ}
        cargando={isFetching}
      />

      {t.sin_ubicar_unidades > 0 && (
        <button
          onClick={() => setEstado('Sin ubicar')}
          className="w-full mb-5 flex items-center gap-2 bg-red-50 border border-red-200
            rounded-2xl px-4 py-3 text-left hover:bg-red-100 transition-colors"
        >
          <AlertTriangle size={16} className="text-red-500 flex-shrink-0" />
          <span className="text-sm text-red-700 flex-1">
            <strong>{t.sin_ubicar_unidades} equipo(s) sin ubicar.</strong> La bodega
            te los entregó, pero no están en tu inventario ni aparecen vendidos.
          </span>
        </button>
      )}

      <BloquePagos
        remesas={data.remesas}
        movimientos={data.movimientos_cuenta || []}
        totales={t}
        onVerCuenta={() => onVerCuenta(sucursalId)}
      />

      {ocultos && (
        <p className="text-xs text-gray-400 flex items-center gap-1.5 px-1 mb-4">
          <Store size={12} /> Los costos de la mercancía no se muestran en tu perfil.
        </p>
      )}

      {remesa && (
        <ModalRemesa
          sugerido={Math.max(0, t.saldo_por_liquidar)}
          onCerrar={() => setRemesa(false)}
          onListo={() => { setRemesa(false); onAviso('Pago enviado a la bodega'); onRefrescar(); }}
        />
      )}
    </>
  );
}
