import { useState, Fragment } from 'react';
import { formatCOP, formatFecha } from '../../utils/formatters';
import { Spinner } from '../ui/Spinner';
import {
  XCircle, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  ArrowUpDown, MessageSquare, Table2,
} from 'lucide-react';

/**
 * Estado de cuenta — vista compartida por Préstamos y Facturas a Crédito.
 *
 * Es puramente presentacional: recibe los movimientos ya calculados por el
 * backend (con su `saldo` acumulado) y no vuelve a sumar nada. Cada módulo le
 * pasa su propio catálogo de tipos, de modo que la experiencia —filtros,
 * cuadrícula/conversación, paginación, saldo final— sea idéntica en los dos.
 *
 * Un movimiento tiene la forma:
 *   { fecha, tipo, concepto, cargo, abono, saldo, referencia_id, anulable,
 *     descripcion? }
 * `saldo: null` significa "no entra al acumulado" (informativo o anulado).
 * `descripcion` es la nota libre de quien registró el movimiento (hoy la del
 * pago total): se muestra si viene, y los módulos que no la mandan no cambian.
 *
 * Un PAGO TOTAL llega como UN solo movimiento (`es_pago_total`) con su reparto
 * en `detalle` — [{ id, factura, valor, anulado }] —, desplegable. El usuario
 * hizo un pago: verlo partido en varias filas lo manda a buscar una plata que
 * cree perdida. Los módulos que no mandan `detalle` no cambian en nada.
 */

// ─── Reparto de un pago total ────────────────────────────────────────────────
//
// Vive aquí, y no en cada módulo, porque la cuadrícula y la conversación tienen
// que contar lo mismo: si se duplicara, el primer arreglo dejaría a una de las
// dos mintiendo.

function lineasReparto(mov) {
  return Array.isArray(mov.detalle) ? mov.detalle : [];
}

function BotonReparto({ abierto, n }) {
  return (
    <span className="flex items-center gap-0.5 text-[10px] text-indigo-500 font-medium">
      {abierto ? 'ocultar reparto' : `ver a qué facturas (${n})`}
      {abierto ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
    </span>
  );
}

// Cada módulo reparte sobre documentos distintos —créditos entre FACTURAS,
// préstamos entre PRODUCTOS—, así que la línea usa lo que le manden en vez de
// imponer un nombre que en una de las dos pantallas sería mentira.
function LineaReparto({ d }) {
  const etiqueta = d.producto
    ? `préstamo #${d.factura ?? d.prestamo_id} · ${d.producto}`
    : `factura #${String(d.factura ?? '').padStart(6, '0')}`;

  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className={`text-[11px] truncate ${d.anulado ? 'text-gray-400 line-through' : 'text-indigo-600'}`}>
        ↳ {etiqueta}
      </span>
      <span className={`text-[11px] font-semibold whitespace-nowrap ${
        d.anulado ? 'text-gray-400 line-through' : 'text-indigo-700'
      }`}>
        {formatCOP(d.valor)}
      </span>
    </div>
  );
}

const PAGE_SIZE_MOVS = 20;

function mismoDia(fechaA, fechaB) {
  if (!fechaA || !fechaB) return false;
  return formatFecha(fechaA) === formatFecha(fechaB);
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

function BurbujaMensaje({ mov, cfg, etiqueta, onAnular, acciones }) {
  const Icn = cfg.Icn;
  const esDerecha = cfg.lado === 'derecha';
  const [abierto, setAbierto] = useState(false);
  const reparto = lineasReparto(mov);

  return (
    <div className={`flex ${esDerecha ? 'justify-end' : 'justify-start'} px-2`}>
      <div className={`max-w-[78%] flex flex-col ${esDerecha ? 'items-end' : 'items-start'}`}>
        <div className={`relative px-3.5 py-2.5 rounded-2xl shadow-sm ${cfg.bubbleBg} ${
          esDerecha ? 'rounded-tr-sm' : 'rounded-tl-sm'
        }`}>

          {/* Badge tipo */}
          <div className="flex items-center gap-1.5 mb-1">
            {Icn && <Icn size={11} className="flex-shrink-0 opacity-50" />}
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${cfg.badge}`}>
              {cfg.label}
            </span>
            {cfg.sufijo && (
              <span className="text-[10px] text-gray-400 font-medium">{cfg.sufijo}</span>
            )}
            {etiqueta && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                {etiqueta}
              </span>
            )}
          </div>

          {/* Concepto */}
          <p className="text-sm font-medium text-gray-800 leading-snug">{mov.concepto}</p>

          {/* Descripción escrita por quien registró el movimiento */}
          {mov.descripcion && (
            <p className="text-xs text-gray-500 italic leading-snug mt-0.5">{mov.descripcion}</p>
          )}

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

          {/* Reparto de un pago total */}
          {reparto.length > 0 && (
            <>
              <button type="button" onClick={() => setAbierto((v) => !v)}
                className="mt-1 hover:opacity-70 transition-opacity">
                <BotonReparto abierto={abierto} n={reparto.length} />
              </button>
              {abierto && (
                <div className="mt-1 pt-1 border-t border-indigo-100">
                  {reparto.map((d) => <LineaReparto key={d.id} d={d} />)}
                </div>
              )}
            </>
          )}

          {/* Footer: fecha + acciones */}
          <div className={`flex items-center gap-2 mt-1.5 ${esDerecha ? 'justify-end' : 'justify-start'}`}>
            <span className="text-[10px] text-gray-400">{formatFecha(mov.fecha)}</span>
            {acciones.map((a) => (
              <button
                key={a.id}
                onClick={() => a.onClick(mov)}
                title={a.title}
                className={`text-gray-300 transition-colors ${a.hoverClass}`}>
                <a.Icn size={13} />
              </button>
            ))}
            {mov.anulable && onAnular && (
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

function FilaTabla({ mov, cfg, etiqueta, onAnular, acciones, isOdd }) {
  const [abierto, setAbierto] = useState(false);
  const reparto = lineasReparto(mov);

  return (
    <>
    <tr className={isOdd ? 'bg-gray-50/60' : 'bg-white'}>
      <td className="px-3 py-2 text-xs text-gray-400 whitespace-nowrap align-middle">
        {formatFecha(mov.fecha)}
      </td>
      <td className="px-3 py-2 align-middle">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${cfg.badge}`}>
            {cfg.label}
          </span>
          {etiqueta && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap bg-gray-100 text-gray-500">
              {etiqueta}
            </span>
          )}
          <span className="text-xs text-gray-700 leading-tight">{mov.concepto}</span>
          {mov.descripcion && (
            <span className="text-xs text-gray-400 italic leading-tight">· {mov.descripcion}</span>
          )}
          {reparto.length > 0 && (
            <button type="button" onClick={() => setAbierto((v) => !v)}
              className="hover:opacity-70 transition-opacity">
              <BotonReparto abierto={abierto} n={reparto.length} />
            </button>
          )}
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
          {acciones.map((a) => (
            <button key={a.id} onClick={() => a.onClick(mov)} title={a.title}
              className={`text-gray-300 transition-colors ${a.hoverClass}`}>
              <a.Icn size={12} />
            </button>
          ))}
          {mov.anulable && onAnular && (
            <button onClick={() => onAnular(mov)} title="Anular"
              className="text-gray-300 hover:text-red-400 transition-colors">
              <XCircle size={12} />
            </button>
          )}
        </div>
      </td>
    </tr>

    {/* El reparto va en su propia fila para no romper la cuadrícula contable:
        las columnas de abono, cargo y saldo siguen alineadas. */}
    {abierto && reparto.length > 0 && (
      <tr className="bg-indigo-50/40">
        <td className="px-3 py-1.5" />
        <td className="px-3 py-1.5" colSpan={2}>
          <div className="pl-3 flex flex-col">
            {reparto.map((d) => <LineaReparto key={d.id} d={d} />)}
          </div>
        </td>
        <td className="px-3 py-1.5" colSpan={3} />
      </tr>
    )}
    </>
  );
}

// ─── EstadoCuentaBase ─────────────────────────────────────────────────────────

/**
 * @param {Array}    movimientos    — ya vienen con `saldo` desde el backend
 * @param {boolean}  isLoading
 * @param {object}   tipoConfig     — tipo → { label, badge, Icn, lado, bubbleBg, montoClass }
 * @param {function} [onAnular]     — recibe el movimiento a anular
 * @param {function} [getEtiqueta]  — badge extra por movimiento (ej. "Devuelto")
 * @param {function} [getAcciones]  — botones extra por movimiento
 * @param {string}   [labelIzquierda] / [labelDerecha] — encabezados de la vista chat
 * @param {node}     [children]     — modales del módulo (anulación, edición…)
 */
export function EstadoCuentaBase({
  movimientos = [],
  isLoading = false,
  tipoConfig,
  onAnular,
  getEtiqueta,
  getAcciones,
  labelIzquierda = '← Cliente',
  labelDerecha   = 'Negocio →',
  vacioTexto     = 'Sin movimientos registrados',
  children,
}) {
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [sortDir,    setSortDir]    = useState('desc');
  const [paginaMov,  setPaginaMov]  = useState(1);
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [vista,      setVista]      = useState('tabla'); // 'tabla' | 'chat'

  const cfgDe = (mov) => tipoConfig[mov.tipo] || Object.values(tipoConfig)[0];

  const filtrados = movimientos.filter((m) => {
    if (filtroTipo !== 'todos' && m.tipo !== filtroTipo) return false;
    const f = m.fecha ? new Date(m.fecha) : null;
    if (fechaDesde && f && f < new Date(fechaDesde)) return false;
    if (fechaHasta && f && f > new Date(fechaHasta + 'T23:59:59')) return false;
    return true;
  });

  // El saldo final es el del ÚLTIMO movimiento que participa del acumulado; no
  // se recalcula sumando cargos − abonos porque los informativos (mora, compras
  // de artículo, documentos anulados) no entran en la deuda.
  const conSaldo   = filtrados.filter((m) => m.saldo != null);
  const saldoFinal = conSaldo.length ? conSaldo[conSaldo.length - 1].saldo : null;

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
        <p className="text-sm text-gray-400">{vacioTexto}</p>
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
        {Object.entries(tipoConfig).map(([key, cfg]) => (
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
            <span className="text-[11px] text-gray-400 font-medium">{labelIzquierda}</span>
            <span className="text-[11px] text-gray-400 font-medium">{labelDerecha}</span>
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
                  <BurbujaMensaje
                    mov={mov}
                    cfg={cfgDe(mov)}
                    etiqueta={getEtiqueta?.(mov)}
                    acciones={getAcciones?.(mov) || []}
                    onAnular={onAnular}
                  />
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
                  cfg={cfgDe(mov)}
                  etiqueta={getEtiqueta?.(mov)}
                  acciones={getAcciones?.(mov) || []}
                  onAnular={onAnular}
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

      {children}
    </div>
  );
}
