import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getEstadoCuenta } from '../../api/prestamos.api';
import { anularAbono as anularAbonoApi, anularRetomaDirecta as anularRetomaDirectaApi } from '../../api/prestamos.api';
import { formatCOP } from '../../utils/formatters';
import { Spinner }   from '../../components/ui/Spinner';
import { XCircle, TrendingDown, TrendingUp, ArrowLeftRight, Wallet, ChevronLeft, ChevronRight, ArrowUpDown } from 'lucide-react';

const PAGE_SIZE_MOVS = 20;

// ─── Mapa visual por tipo de movimiento ──────────────────────────────────────

const TIPO_CONFIG = {
  prestamo: {
    rowClass:  'bg-orange-50 border-l-2 border-orange-300',
    badge:     'bg-orange-100 text-orange-700',
    label:     'Préstamo',
    Icn:       TrendingUp,
    iconClass: 'text-orange-500',
  },
  abono: {
    rowClass:  'bg-green-50 border-l-2 border-green-300',
    badge:     'bg-green-100 text-green-700',
    label:     'Abono',
    Icn:       TrendingDown,
    iconClass: 'text-green-500',
  },
  pago_producto: {
    rowClass:  'bg-blue-50 border-l-2 border-blue-300',
    badge:     'bg-blue-100 text-blue-700',
    label:     'Pago en producto',
    Icn:       ArrowLeftRight,
    iconClass: 'text-blue-500',
  },
  saldo_aplicado: {
    rowClass:  'bg-teal-50 border-l-2 border-teal-300',
    badge:     'bg-teal-100 text-teal-700',
    label:     'Saldo aplicado',
    Icn:       Wallet,
    iconClass: 'text-teal-500',
  },
  compra_directa: {
    rowClass:  'bg-purple-50 border-l-2 border-purple-300',
    badge:     'bg-purple-100 text-purple-700',
    label:     'Compra de artículo',
    Icn:       ArrowLeftRight,
    iconClass: 'text-purple-500',
  },
};

function formatFecha(fechaStr) {
  if (!fechaStr) return '—';
  const d = new Date(fechaStr);
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Fila de movimiento ───────────────────────────────────────────────────────

function FilaMovimiento({ mov, onAnular }) {
  const cfg = TIPO_CONFIG[mov.tipo] || TIPO_CONFIG.abono;
  const Icn = cfg.Icn;

  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-xl ${cfg.rowClass}`}>
      {/* Ícono tipo */}
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 bg-white/70 ${cfg.iconClass}`}>
        <Icn size={14} />
      </div>

      {/* Descripción */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 leading-tight truncate">{mov.concepto}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs text-gray-400">{formatFecha(mov.fecha)}</span>
          <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${cfg.badge}`}>
            {cfg.label}
          </span>
          {mov.tipo === 'compra_directa' && (
            <span className="text-xs text-purple-600 font-medium">→ saldo a favor</span>
          )}
        </div>
      </div>

      {/* Valores */}
      <div className="flex items-center gap-3 flex-shrink-0 text-right">
        <div className="min-w-[80px]">
          {mov.cargo  && <p className="text-sm font-semibold text-orange-600">+{formatCOP(mov.cargo)}</p>}
          {mov.abono  && <p className="text-sm font-semibold text-green-600">−{formatCOP(mov.abono)}</p>}
        </div>
        <div className="min-w-[80px]">
          {mov.saldo != null
            ? <p className={`text-sm font-bold ${mov.saldo > 0 ? 'text-red-500' : 'text-green-600'}`}>
                {formatCOP(mov.saldo)}
              </p>
            : <p className="text-xs text-gray-400">—</p>
          }
        </div>
        {mov.anulable && (
          <button
            onClick={() => onAnular(mov)}
            title="Anular movimiento"
            className="text-gray-300 hover:text-red-400 transition-colors">
            <XCircle size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── EstadoDeCuenta ───────────────────────────────────────────────────────────

export function EstadoDeCuenta({ tipo, personaId }) {
  const queryClient = useQueryClient();
  const [confirmando, setConfirmando] = useState(null); // { mov }
  const [fechaDesde, setFechaDesde]   = useState('');
  const [fechaHasta, setFechaHasta]   = useState('');
  const [sortDir,    setSortDir]      = useState('asc');  // 'asc' | 'desc'
  const [paginaMov,  setPaginaMov]    = useState(1);

  const tipoApi = tipo === 'companero' ? 'prestatario' : tipo;

  const { data: movimientos = [], isLoading } = useQuery({
    queryKey:  ['estado-cuenta', tipoApi, personaId],
    queryFn:   () => getEstadoCuenta(tipoApi, personaId).then((r) => r.data.data),
    staleTime: 30_000,
  });

  const mutAnularAbono = useMutation({
    mutationFn: ({ referencia_id, prestamo_id }) =>
      anularAbonoApi(prestamo_id, referencia_id, null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estado-cuenta', tipoApi, personaId] });
      queryClient.invalidateQueries({ queryKey: ['prestamos'], exact: false });
      setConfirmando(null);
    },
    onError: (err) => {
      alert(err.response?.data?.error || 'Error al anular el movimiento');
      setConfirmando(null);
    },
  });

  const mutAnularCompra = useMutation({
    mutationFn: ({ referencia_id }) => anularRetomaDirectaApi(referencia_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estado-cuenta',      tipoApi, personaId] });
      queryClient.invalidateQueries({ queryKey: ['retomas-directas',   tipoApi, personaId] });
      queryClient.invalidateQueries({ queryKey: ['prestamos'], exact: false });
      setConfirmando(null);
    },
    onError: (err) => {
      alert(err.response?.data?.error || 'Error al anular la compra');
      setConfirmando(null);
    },
  });

  const handleAnular = (mov) => setConfirmando(mov);

  const confirmarAnulacion = () => {
    if (!confirmando) return;
    if (confirmando.tipo === 'compra_directa') {
      mutAnularCompra.mutate({ referencia_id: confirmando.referencia_id });
    } else {
      mutAnularAbono.mutate({
        referencia_id: confirmando.referencia_id,
        prestamo_id:   confirmando.prestamo_id,
      });
    }
  };

  // Filtrar por fechas si se especifica
  const filtrados = movimientos.filter((m) => {
    const f = m.fecha ? new Date(m.fecha) : null;
    if (fechaDesde && f && f < new Date(fechaDesde)) return false;
    if (fechaHasta && f && f > new Date(fechaHasta + 'T23:59:59')) return false;
    return true;
  });

  // saldoFinal siempre sobre el último movimiento cronológico
  const saldoFinal = filtrados.length > 0
    ? filtrados[filtrados.length - 1]?.saldo ?? null
    : null;

  const filtradosOrdenados = sortDir === 'desc' ? [...filtrados].reverse() : filtrados;

  const totalMovs      = filtradosOrdenados.length;
  const totalPagMovs   = Math.max(1, Math.ceil(totalMovs / PAGE_SIZE_MOVS));
  const paginaMovActual = Math.min(paginaMov, totalPagMovs);
  const movsPagina = filtradosOrdenados.slice(
    (paginaMovActual - 1) * PAGE_SIZE_MOVS,
    paginaMovActual * PAGE_SIZE_MOVS,
  );

  if (isLoading) return <Spinner className="py-10" />;

  if (movimientos.length === 0) {
    return (
      <div className="text-center py-10">
        <p className="text-sm text-gray-400">Sin movimientos registrados</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">

      {/* Filtros de fecha + orden */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-400 whitespace-nowrap">Desde</label>
          <input type="date" value={fechaDesde}
            onChange={(e) => { setFechaDesde(e.target.value); setPaginaMov(1); }}
            className="px-2 py-1 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-700
              focus:outline-none focus:ring-1 focus:ring-blue-400 transition-all" />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-400 whitespace-nowrap">Hasta</label>
          <input type="date" value={fechaHasta}
            onChange={(e) => { setFechaHasta(e.target.value); setPaginaMov(1); }}
            className="px-2 py-1 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-700
              focus:outline-none focus:ring-1 focus:ring-blue-400 transition-all" />
        </div>
        {(fechaDesde || fechaHasta) && (
          <button
            onClick={() => { setFechaDesde(''); setFechaHasta(''); setPaginaMov(1); }}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
            Limpiar
          </button>
        )}
        <button
          onClick={() => { setSortDir((d) => d === 'asc' ? 'desc' : 'asc'); setPaginaMov(1); }}
          title={sortDir === 'asc' ? 'Mostrando más antiguo primero' : 'Mostrando más reciente primero'}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium
            bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors ml-auto">
          <ArrowUpDown size={12} />
          {sortDir === 'asc' ? 'Más antiguo' : 'Más reciente'}
        </button>
        <span className="text-xs text-gray-400">
          {filtrados.length} mov.
        </span>
      </div>

      {/* Cabecera de columnas */}
      <div className="grid text-xs font-semibold text-gray-400 uppercase tracking-wide px-4"
        style={{ gridTemplateColumns: '1fr 40px 80px 80px 28px' }}>
        <span>Concepto</span>
        <span />
        <span className="text-right">Movimiento</span>
        <span className="text-right">Saldo deuda</span>
        <span />
      </div>

      {/* Lista de movimientos */}
      <div className="flex flex-col gap-1.5">
        {movsPagina.map((mov, idx) => (
          <FilaMovimiento
            key={`${mov.tipo}-${mov.referencia_id}-${idx}`}
            mov={mov}
            onAnular={handleAnular}
          />
        ))}
      </div>

      {/* Paginación */}
      {totalPagMovs > 1 && (
        <div className="flex items-center justify-between px-1">
          <button
            onClick={() => setPaginaMov((p) => Math.max(1, p - 1))}
            disabled={paginaMovActual === 1}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm text-gray-600
              border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            <ChevronLeft size={14} /> Anterior
          </button>
          <span className="text-xs text-gray-500">
            Página {paginaMovActual} de {totalPagMovs}
          </span>
          <button
            onClick={() => setPaginaMov((p) => Math.min(totalPagMovs, p + 1))}
            disabled={paginaMovActual === totalPagMovs}
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

      {/* Modal confirmación anulación */}
      {confirmando && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 flex flex-col gap-4 shadow-xl">
            <p className="text-sm font-semibold text-gray-800">
              ¿Anular este movimiento?
            </p>
            <div className="bg-gray-50 rounded-xl px-3 py-2">
              <p className="text-xs text-gray-500">{confirmando.concepto}</p>
              <p className="text-sm font-bold text-gray-800 mt-0.5">
                {formatCOP(confirmando.cargo || confirmando.abono)}
              </p>
            </div>
            {confirmando.tipo === 'compra_directa' && (
              <p className="text-xs text-red-500">
                Se reducirá el saldo a favor en {formatCOP(confirmando.abono)}.
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmando(null)}
                className="flex-1 py-2 rounded-xl text-sm border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                Cancelar
              </button>
              <button
                onClick={confirmarAnulacion}
                disabled={mutAnularAbono.isPending || mutAnularCompra.isPending}
                className="flex-1 py-2 rounded-xl text-sm bg-red-500 hover:bg-red-600 text-white font-medium transition-colors disabled:opacity-50">
                {(mutAnularAbono.isPending || mutAnularCompra.isPending) ? 'Anulando…' : 'Sí, anular'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
