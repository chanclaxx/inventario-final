import { useState, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getEstadoCuenta } from '../../api/prestamos.api';
import { anularAbono as anularAbonoApi, anularRetomaDirecta as anularRetomaDirectaApi } from '../../api/prestamos.api';
import { formatCOP } from '../../utils/formatters';
import { Spinner }   from '../../components/ui/Spinner';
import { XCircle, TrendingDown, TrendingUp, ArrowLeftRight, Wallet, ChevronLeft, ChevronRight, ArrowUpDown, Pencil, MessageSquare, Table2, Layers } from 'lucide-react';
import { ModalEditarValorPrestamo }      from './ModalEditarValorPrestamo';

const PAGE_SIZE_MOVS = 20;

// lado: 'derecha' = acción del negocio | 'izquierda' = acción del deudor
const TIPO_CONFIG = {
  prestamo: {
    badge:      'bg-orange-100 text-orange-700',
    label:      'Préstamo',
    Icn:        TrendingUp,
    lado:       'derecha',
    bubbleBg:   'bg-amber-50 border border-amber-200',
    montoClass: 'text-amber-700',
  },
  abono: {
    badge:      'bg-green-100 text-green-700',
    label:      'Abono',
    Icn:        TrendingDown,
    lado:       'izquierda',
    bubbleBg:   'bg-white border border-gray-200',
    montoClass: 'text-green-600',
  },
  pago_producto: {
    badge:      'bg-blue-100 text-blue-700',
    label:      'Pago en producto',
    Icn:        ArrowLeftRight,
    lado:       'izquierda',
    bubbleBg:   'bg-white border border-gray-200',
    montoClass: 'text-blue-600',
  },
  saldo_aplicado: {
    badge:      'bg-teal-100 text-teal-700',
    label:      'Saldo aplicado',
    Icn:        Wallet,
    lado:       'izquierda',
    bubbleBg:   'bg-white border border-gray-200',
    montoClass: 'text-teal-600',
  },
  compra_directa: {
    badge:      'bg-purple-100 text-purple-700',
    label:      'Compra de artículo',
    Icn:        ArrowLeftRight,
    lado:       'derecha',
    bubbleBg:   'bg-purple-50 border border-purple-200',
    montoClass: 'text-purple-700',
  },
  abono_total: {
    badge:      'bg-indigo-100 text-indigo-700',
    label:      'Pago total',
    Icn:        Layers,
    lado:       'izquierda',
    bubbleBg:   'bg-indigo-50 border border-indigo-200',
    montoClass: 'text-indigo-700',
  },
};

function formatFecha(fechaStr) {
  if (!fechaStr) return '—';
  const d = new Date(fechaStr);
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function mismoDia(fechaA, fechaB) {
  if (!fechaA || !fechaB) return false;
  return new Date(fechaA).toDateString() === new Date(fechaB).toDateString();
}

// ─── Separador de fecha entre días distintos ──────────────────────────────────

function SeparadorFecha({ fecha }) {
  return (
    <div className="flex items-center justify-center my-2">
      <span className="bg-white/80 backdrop-blur-sm text-gray-500 text-[11px] font-medium px-3 py-1 rounded-full shadow-sm border border-gray-100">
        {formatFecha(fecha)}
      </span>
    </div>
  );
}

// ─── Burbuja de chat por movimiento ──────────────────────────────────────────

function BurbujaMensaje({ mov, onAnular, onEditar, onEditarAbonoTotal }) {
  const cfg = TIPO_CONFIG[mov.tipo] || TIPO_CONFIG.abono;
  const Icn = cfg.Icn;
  const esDerecha = cfg.lado === 'derecha';

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
            {mov.tipo === 'compra_directa' && (
              <span className="text-[10px] text-purple-500 font-medium">→ saldo a favor</span>
            )}
          </div>

          {/* Concepto */}
          <p className="text-sm font-medium text-gray-800 leading-snug">{mov.concepto}</p>

          {/* Monto */}
          <p className={`text-base font-bold mt-0.5 ${cfg.montoClass}`}>
            {mov.cargo ? `+${formatCOP(mov.cargo)}` : ''}
            {mov.abono ? `−${formatCOP(mov.abono)}` : ''}
          </p>

          {/* Saldo resultante */}
          {mov.saldo != null && (
            <p className={`text-xs mt-0.5 ${mov.saldo > 0 ? 'text-red-400' : 'text-green-500'}`}>
              Saldo deuda:{' '}
              <span className="font-semibold">{formatCOP(mov.saldo)}</span>
            </p>
          )}

          {/* Footer: fecha + acciones */}
          <div className={`flex items-center gap-2 mt-1.5 ${esDerecha ? 'justify-end' : 'justify-start'}`}>
            <span className="text-[10px] text-gray-400">{formatFecha(mov.fecha)}</span>
            {mov.tipo === 'prestamo' && mov.prestamo_estado === 'Activo' && onEditar && (
              <button
                onClick={() => onEditar(mov)}
                title="Editar valor"
                className="text-gray-300 hover:text-blue-400 transition-colors">
                <Pencil size={13} />
              </button>
            )}
            {mov.tipo === 'abono_total' && onEditarAbonoTotal && (
              <button
                onClick={() => onEditarAbonoTotal(mov)}
                title="Modificar pago total"
                className="text-gray-300 hover:text-indigo-500 transition-colors">
                <Pencil size={13} />
              </button>
            )}
            {mov.anulable && (
              <button
                onClick={() => onAnular(mov)}
                title="Anular movimiento"
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

// ─── Fila de cuadrícula contable ─────────────────────────────────────────────

function FilaTabla({ mov, onAnular, onEditar, onEditarAbonoTotal, isOdd }) {
  const cfg = TIPO_CONFIG[mov.tipo] || TIPO_CONFIG.abono;

  return (
    <tr className={isOdd ? 'bg-gray-50/60' : 'bg-white'}>
      <td className="px-3 py-2 text-xs text-gray-400 whitespace-nowrap align-middle">
        {formatFecha(mov.fecha)}
      </td>
      <td className="px-3 py-2 align-middle">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${cfg.badge}`}>
            {cfg.label}
          </span>
          <span className="text-xs text-gray-700 leading-tight">{mov.concepto}</span>
        </div>
      </td>
      <td className="px-3 py-2 text-right text-xs font-semibold text-green-600 whitespace-nowrap align-middle">
        {mov.abono ? formatCOP(mov.abono) : <span className="text-gray-200">—</span>}
      </td>
      <td className="px-3 py-2 text-right text-xs font-semibold text-amber-700 whitespace-nowrap align-middle">
        {mov.cargo ? formatCOP(mov.cargo) : <span className="text-gray-200">—</span>}
      </td>
      <td className={`px-3 py-2 text-right text-xs font-bold whitespace-nowrap align-middle ${
        mov.saldo > 0 ? 'text-red-500' : 'text-green-600'
      }`}>
        {mov.saldo != null ? formatCOP(mov.saldo) : '—'}
      </td>
      <td className="px-2 py-2 align-middle">
        <div className="flex items-center gap-1 justify-end">
          {mov.tipo === 'prestamo' && mov.prestamo_estado === 'Activo' && onEditar && (
            <button onClick={() => onEditar(mov)} title="Editar valor"
              className="text-gray-300 hover:text-blue-400 transition-colors">
              <Pencil size={12} />
            </button>
          )}
          {mov.tipo === 'abono_total' && onEditarAbonoTotal && (
            <button onClick={() => onEditarAbonoTotal(mov)} title="Modificar pago total"
              className="text-gray-300 hover:text-indigo-500 transition-colors">
              <Pencil size={12} />
            </button>
          )}
          {mov.anulable && (
            <button onClick={() => onAnular(mov)} title="Anular"
              className="text-gray-300 hover:text-red-400 transition-colors">
              <XCircle size={12} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── EstadoDeCuenta ───────────────────────────────────────────────────────────

export function EstadoDeCuenta({ tipo, personaId, onEditarAbonoTotal }) {
  const queryClient = useQueryClient();
  const [confirmando, setConfirmando] = useState(null);
  const [editando,    setEditando]    = useState(null);
  const [fechaDesde, setFechaDesde]   = useState('');
  const [fechaHasta, setFechaHasta]   = useState('');
  const [sortDir,    setSortDir]      = useState('desc');
  const [paginaMov,  setPaginaMov]    = useState(1);
  const [filtroTipo, setFiltroTipo]   = useState('todos');
  const [vista,      setVista]        = useState('tabla'); // 'tabla' | 'chat'

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
      queryClient.invalidateQueries({ queryKey: ['estado-cuenta',    tipoApi, personaId] });
      queryClient.invalidateQueries({ queryKey: ['retomas-directas', tipoApi, personaId] });
      queryClient.invalidateQueries({ queryKey: ['prestamos'], exact: false });
      setConfirmando(null);
    },
    onError: (err) => {
      alert(err.response?.data?.error || 'Error al anular la compra');
      setConfirmando(null);
    },
  });

  const handleAnular = (mov) => setConfirmando(mov);
  const handleEditar = (mov) => setEditando(mov);
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

  const filtrados = movimientos.filter((m) => {
    if (filtroTipo !== 'todos' && m.tipo !== filtroTipo) return false;
    const f = m.fecha ? new Date(m.fecha) : null;
    if (fechaDesde && f && f < new Date(fechaDesde)) return false;
    if (fechaHasta && f && f > new Date(fechaHasta + 'T23:59:59')) return false;
    return true;
  });

  const saldoFinal = filtrados.length > 0
    ? filtrados[filtrados.length - 1]?.saldo ?? null
    : null;

  const filtradosOrdenados = sortDir === 'desc' ? [...filtrados].reverse() : filtrados;

  const totalMovs       = filtradosOrdenados.length;
  const totalPagMovs    = Math.max(1, Math.ceil(totalMovs / PAGE_SIZE_MOVS));
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
          title={sortDir === 'asc' ? 'Más antiguo primero' : 'Más reciente primero'}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium
            bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors ml-auto">
          <ArrowUpDown size={12} />
          {sortDir === 'asc' ? 'Más antiguo' : 'Más reciente'}
        </button>
        {/* Toggle de vista */}
        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
          <button
            onClick={() => setVista('chat')}
            title="Vista conversación"
            className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors
              ${vista === 'chat' ? 'bg-gray-800 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
            <MessageSquare size={12} />
          </button>
          <button
            onClick={() => setVista('tabla')}
            title="Vista cuadrícula"
            className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors
              ${vista === 'tabla' ? 'bg-gray-800 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
            <Table2 size={12} />
          </button>
        </div>
        <span className="text-xs text-gray-400">{filtrados.length} mov.</span>
      </div>

      {/* Filtro por tipo */}
      <div className="flex items-center gap-1 flex-wrap">
        <button
          onClick={() => { setFiltroTipo('todos'); setPaginaMov(1); }}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all
            ${filtroTipo === 'todos' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
          Todos
        </button>
        {Object.entries(TIPO_CONFIG).map(([key, cfg]) => (
          <button key={key}
            onClick={() => { setFiltroTipo(key); setPaginaMov(1); }}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all
              ${filtroTipo === key ? cfg.badge + ' ring-1 ring-current' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
            {cfg.label}
          </button>
        ))}
      </div>

      {/* Vista chat */}
      {vista === 'chat' && (
        <>
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] text-gray-400 font-medium">← Deudor</span>
            <span className="text-[11px] text-gray-400 font-medium">Negocio →</span>
          </div>
          <div
            className="flex flex-col gap-2 py-3 rounded-2xl overflow-y-auto"
            style={{ background: 'linear-gradient(160deg, #e8f4f0 0%, #eef2f7 100%)', minHeight: 180 }}>
            {movsPagina.map((mov, idx) => {
              const prev         = idx > 0 ? movsPagina[idx - 1] : null;
              const showSepFecha = !prev || !mismoDia(mov.fecha, prev?.fecha);
              return (
                <Fragment key={`${mov.tipo}-${mov.referencia_id}-${idx}`}>
                  {showSepFecha && <SeparadorFecha fecha={mov.fecha} />}
                  <BurbujaMensaje mov={mov} onAnular={handleAnular} onEditar={handleEditar} onEditarAbonoTotal={onEditarAbonoTotal} />
                </Fragment>
              );
            })}
          </div>
        </>
      )}

      {/* Vista cuadrícula */}
      {vista === 'tabla' && (
        <div className="overflow-x-auto rounded-2xl border border-gray-100 shadow-sm">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-3 py-2.5 text-xs font-semibold text-gray-500 whitespace-nowrap">Fecha</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-gray-500">Justificación</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-green-600 text-right whitespace-nowrap">−</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-amber-600 text-right whitespace-nowrap">+</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-gray-500 text-right whitespace-nowrap">Saldo</th>
                <th className="px-2 py-2.5 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {movsPagina.map((mov, idx) => (
                <FilaTabla
                  key={`${mov.tipo}-${mov.referencia_id}-${idx}`}
                  mov={mov}
                  onAnular={handleAnular}
                  onEditar={handleEditar}
                  onEditarAbonoTotal={onEditarAbonoTotal}
                  isOdd={idx % 2 !== 0}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

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

      {/* Modal editar valor del préstamo */}
      {editando && (
        <ModalEditarValorPrestamo
          key={editando.referencia_id}
          open
          onClose={() => setEditando(null)}
          mov={editando}
          tipoApi={tipoApi}
          personaId={personaId}
        />
      )}

      {/* Modal confirmación anulación */}
      {confirmando && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 flex flex-col gap-4 shadow-xl">
            <p className="text-sm font-semibold text-gray-800">¿Anular este movimiento?</p>
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
