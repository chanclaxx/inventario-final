import { useState, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getHistorialAcreedor, eliminarAbono as eliminarAbonoApi } from '../../api/acreedores.api';
import { formatCOP } from '../../utils/formatters';
import { Spinner } from '../../components/ui/Spinner';
import {
  XCircle, TrendingDown, TrendingUp, Wallet,
  ChevronLeft, ChevronRight, ArrowUpDown, ShoppingBag,
} from 'lucide-react';

const PAGE_SIZE = 20;

const TIPO_CONFIG = {
  cargo: {
    badge:      'bg-orange-100 text-orange-700',
    label:      'Cargo',
    Icn:        TrendingUp,
    lado:       'derecha',
    bubbleBg:   'bg-amber-50 border border-amber-200',
    montoClass: 'text-amber-700',
  },
  cargo_compra: {
    badge:      'bg-purple-100 text-purple-700',
    label:      'Compra',
    Icn:        ShoppingBag,
    lado:       'derecha',
    bubbleBg:   'bg-purple-50 border border-purple-200',
    montoClass: 'text-purple-700',
  },
  abono: {
    badge:      'bg-green-100 text-green-700',
    label:      'Abono',
    Icn:        TrendingDown,
    lado:       'izquierda',
    bubbleBg:   'bg-white border border-gray-200',
    montoClass: 'text-green-600',
  },
  saldo_favor: {
    badge:      'bg-teal-100 text-teal-700',
    label:      'Pago adelantado',
    Icn:        Wallet,
    lado:       'izquierda',
    bubbleBg:   'bg-teal-50 border border-teal-200',
    montoClass: 'text-teal-600',
  },
};

function resolverTipo(mov) {
  if (mov.tipo === 'Cargo') return mov.compra_id ? 'cargo_compra' : 'cargo';
  if (mov.tipo === 'Abono') return mov.cargo_id ? 'abono' : 'saldo_favor';
  return 'abono';
}

function formatFecha(fechaStr) {
  if (!fechaStr) return '—';
  return new Date(fechaStr).toLocaleDateString('es-CO', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function mismoDia(a, b) {
  if (!a || !b) return false;
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function SeparadorFecha({ fecha }) {
  return (
    <div className="flex items-center justify-center my-2">
      <span className="bg-white/80 backdrop-blur-sm text-gray-500 text-[11px] font-medium
        px-3 py-1 rounded-full shadow-sm border border-gray-100">
        {formatFecha(fecha)}
      </span>
    </div>
  );
}

function BurbujaMensaje({ mov, onAnular }) {
  const tipoKey = resolverTipo(mov);
  const cfg     = TIPO_CONFIG[tipoKey];
  const Icn     = cfg.Icn;
  const esDerecha = cfg.lado === 'derecha';
  const saldo   = Number(mov.saldo_despues);

  return (
    <div className={`flex ${esDerecha ? 'justify-end' : 'justify-start'} px-2`}>
      <div className={`max-w-[78%] flex flex-col ${esDerecha ? 'items-end' : 'items-start'}`}>
        <div className={`relative px-3.5 py-2.5 rounded-2xl shadow-sm ${cfg.bubbleBg} ${
          esDerecha ? 'rounded-tr-sm' : 'rounded-tl-sm'
        }`}>

          {/* Badge tipo */}
          <div className="flex items-center gap-1.5 mb-1">
            <Icn size={11} className="flex-shrink-0 opacity-50" />
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${cfg.badge}`}>
              {cfg.label}
            </span>
            {tipoKey === 'cargo_compra' && mov.compra_id && (
              <span className="text-[10px] text-purple-500 font-medium">
                #{String(mov.compra_id).padStart(5, '0')}
              </span>
            )}
          </div>

          {/* Concepto */}
          <p className="text-sm font-medium text-gray-800 leading-snug">
            {mov.descripcion || (mov.tipo === 'Cargo' ? 'Cargo' : 'Abono')}
          </p>

          {/* Monto */}
          <p className={`text-base font-bold mt-0.5 ${cfg.montoClass}`}>
            {mov.tipo === 'Cargo' ? `+${formatCOP(mov.valor)}` : `−${formatCOP(mov.valor)}`}
          </p>

          {/* Saldo resultante */}
          <p className={`text-xs mt-0.5 ${saldo > 0 ? 'text-red-400' : 'text-green-500'}`}>
            Saldo deuda:{' '}
            <span className="font-semibold">{formatCOP(saldo)}</span>
          </p>

          {/* Método de pago si aplica */}
          {mov.metodo && mov.tipo === 'Abono' && (
            <p className="text-[10px] text-gray-400 mt-0.5">{mov.metodo}</p>
          )}

          {/* Footer: fecha + acción anular */}
          <div className={`flex items-center gap-2 mt-1.5 ${esDerecha ? 'justify-end' : 'justify-start'}`}>
            <span className="text-[10px] text-gray-400">{formatFecha(mov.fecha)}</span>
            {mov.tipo === 'Abono' && onAnular && (
              <button
                onClick={() => onAnular(mov)}
                title="Eliminar abono"
                className="text-gray-300 hover:text-red-400 transition-colors">
                <XCircle size={13} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function EstadoCuentaAcreedor({ acreedorId, esAdmin }) {
  const queryClient = useQueryClient();
  const [confirmando, setConfirmando] = useState(null);
  const [fechaDesde,  setFechaDesde]  = useState('');
  const [fechaHasta,  setFechaHasta]  = useState('');
  const [sortDir,     setSortDir]     = useState('desc');
  const [pagina,      setPagina]      = useState(1);
  const [filtroTipo,  setFiltroTipo]  = useState('todos');

  const { data: movimientos = [], isLoading, isError, error } = useQuery({
    queryKey:  ['historial-acreedor', acreedorId],
    queryFn:   () => getHistorialAcreedor(acreedorId).then((r) => r.data.data),
    staleTime: 30_000,
    retry: 1,
  });

  const mutEliminar = useMutation({
    mutationFn: ({ id }) => eliminarAbonoApi(acreedorId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['historial-acreedor', acreedorId] });
      queryClient.invalidateQueries({ queryKey: ['compras-con-saldo', acreedorId], exact: false });
      queryClient.invalidateQueries({ queryKey: ['acreedores'],                    exact: false });
      queryClient.invalidateQueries({ queryKey: ['saldo-a-favor', acreedorId],     exact: false });
      setConfirmando(null);
    },
    onError: (err) => {
      alert(err.response?.data?.error || 'Error al eliminar el abono');
      setConfirmando(null);
    },
  });

  const filtrados = movimientos.filter((m) => {
    const tipoKey = resolverTipo(m);
    if (filtroTipo !== 'todos' && tipoKey !== filtroTipo) return false;
    const f = m.fecha ? new Date(m.fecha) : null;
    if (fechaDesde && f && f < new Date(fechaDesde)) return false;
    if (fechaHasta && f && f > new Date(fechaHasta + 'T23:59:59')) return false;
    return true;
  });

  const saldoFinal = filtrados.length > 0
    ? Number(filtrados[filtrados.length - 1]?.saldo_despues ?? 0)
    : null;

  const ordenados = sortDir === 'desc' ? [...filtrados].reverse() : filtrados;
  const total     = ordenados.length;
  const totalPag  = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pagActual = Math.min(pagina, totalPag);
  const pagItems  = ordenados.slice((pagActual - 1) * PAGE_SIZE, pagActual * PAGE_SIZE);

  if (isLoading) return <Spinner className="py-10" />;

  if (isError) {
    return (
      <div className="text-center py-10 flex flex-col items-center gap-2">
        <p className="text-sm text-red-500 font-medium">Error al cargar el historial</p>
        <p className="text-xs text-gray-400">
          {error?.response?.data?.error || error?.message || 'Intenta refrescar la página'}
        </p>
        <p className="text-xs text-gray-300 font-mono">
          {error?.response?.status ? `HTTP ${error.response.status}` : ''}
        </p>
      </div>
    );
  }

  if (!isLoading && movimientos.length === 0) {
    return (
      <div className="text-center py-10">
        <p className="text-sm text-gray-400">Sin movimientos registrados</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">

      {/* Filtros fecha + orden */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-400 whitespace-nowrap">Desde</label>
          <input type="date" value={fechaDesde}
            onChange={(e) => { setFechaDesde(e.target.value); setPagina(1); }}
            className="px-2 py-1 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-700
              focus:outline-none focus:ring-1 focus:ring-blue-400 transition-all" />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-400 whitespace-nowrap">Hasta</label>
          <input type="date" value={fechaHasta}
            onChange={(e) => { setFechaHasta(e.target.value); setPagina(1); }}
            className="px-2 py-1 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-700
              focus:outline-none focus:ring-1 focus:ring-blue-400 transition-all" />
        </div>
        {(fechaDesde || fechaHasta) && (
          <button
            onClick={() => { setFechaDesde(''); setFechaHasta(''); setPagina(1); }}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
            Limpiar
          </button>
        )}
        <button
          onClick={() => { setSortDir((d) => d === 'asc' ? 'desc' : 'asc'); setPagina(1); }}
          title={sortDir === 'asc' ? 'Más antiguo primero' : 'Más reciente primero'}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium
            bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors ml-auto">
          <ArrowUpDown size={12} />
          {sortDir === 'asc' ? 'Más antiguo' : 'Más reciente'}
        </button>
        <span className="text-xs text-gray-400">{filtrados.length} mov.</span>
      </div>

      {/* Filtro por tipo */}
      <div className="flex items-center gap-1 flex-wrap">
        <button
          onClick={() => { setFiltroTipo('todos'); setPagina(1); }}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all
            ${filtroTipo === 'todos' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
          Todos
        </button>
        {Object.entries(TIPO_CONFIG).map(([key, cfg]) => (
          <button key={key}
            onClick={() => { setFiltroTipo(key); setPagina(1); }}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all
              ${filtroTipo === key ? cfg.badge + ' ring-1 ring-current' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
            {cfg.label}
          </button>
        ))}
      </div>

      {/* Leyenda lados */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] text-gray-400 font-medium">← Negocio (pagos)</span>
        <span className="text-[11px] text-gray-400 font-medium">Acreedor (cargos) →</span>
      </div>

      {/* Ventana de chat */}
      <div
        className="flex flex-col gap-2 py-3 rounded-2xl overflow-y-auto"
        style={{ background: 'linear-gradient(160deg, #f0f4f8 0%, #eef2f7 100%)', minHeight: 180 }}>
        {pagItems.map((mov, idx) => {
          const prev         = idx > 0 ? pagItems[idx - 1] : null;
          const showSepFecha = !prev || !mismoDia(mov.fecha, prev?.fecha);
          return (
            <Fragment key={`${mov.tipo}-${mov.id}-${idx}`}>
              {showSepFecha && <SeparadorFecha fecha={mov.fecha} />}
              <BurbujaMensaje
                mov={mov}
                onAnular={esAdmin ? (m) => setConfirmando(m) : null}
              />
            </Fragment>
          );
        })}
      </div>

      {/* Paginación */}
      {totalPag > 1 && (
        <div className="flex items-center justify-between px-1">
          <button
            onClick={() => setPagina((p) => Math.max(1, p - 1))}
            disabled={pagActual === 1}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm text-gray-600
              border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            <ChevronLeft size={14} /> Anterior
          </button>
          <span className="text-xs text-gray-500">
            Página {pagActual} de {totalPag}
          </span>
          <button
            onClick={() => setPagina((p) => Math.min(totalPag, p + 1))}
            disabled={pagActual === totalPag}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm text-gray-600
              border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            Siguiente <ChevronRight size={14} />
          </button>
        </div>
      )}

      {/* Saldo final */}
      {saldoFinal != null && (
        <div className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 mt-1">
          <span className="text-sm font-semibold text-gray-600">Saldo actual de la deuda</span>
          <span className={`text-base font-bold ${saldoFinal > 0 ? 'text-red-500' : 'text-green-600'}`}>
            {formatCOP(saldoFinal)}
          </span>
        </div>
      )}

      {/* Confirmación eliminar abono */}
      {confirmando && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 flex flex-col gap-4 shadow-xl">
            <p className="text-sm font-semibold text-gray-800">¿Eliminar este abono?</p>
            <div className="bg-gray-50 rounded-xl px-3 py-2">
              <p className="text-xs text-gray-500">{confirmando.descripcion || 'Abono'}</p>
              <p className="text-sm font-bold text-gray-800 mt-0.5">
                {formatCOP(confirmando.valor)}
              </p>
            </div>
            <p className="text-xs text-red-400">Esta acción no se puede deshacer.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmando(null)}
                className="flex-1 py-2 rounded-xl text-sm border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                Cancelar
              </button>
              <button
                onClick={() => mutEliminar.mutate({ id: confirmando.id })}
                disabled={mutEliminar.isPending}
                className="flex-1 py-2 rounded-xl text-sm bg-red-500 hover:bg-red-600 text-white font-medium transition-colors disabled:opacity-50">
                {mutEliminar.isPending ? 'Eliminando…' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
