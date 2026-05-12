import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAcreedores,
  crearAcreedor,
  registrarMovimiento,
  eliminarAcreedor,
  getComprasConSaldo,
  getAbonosPorCargo,
} from '../../api/acreedores.api';
import { getConfig, verificarPin } from '../../api/config.api';
import { formatCOP, formatFechaHora } from '../../utils/formatters';
import { useAuth }      from '../../context/useAuth';
import { Button }       from '../../components/ui/Button';
import { Input }        from '../../components/ui/Input';
import { InputMoneda }  from '../../components/ui/InputMoneda';
import { Modal }        from '../../components/ui/Modal';
import { Badge }        from '../../components/ui/Badge';
import { Spinner }      from '../../components/ui/Spinner';
import { EmptyState }   from '../../components/ui/EmptyState';
import { SearchInput }  from '../../components/ui/SearchInput';
import { ReciboAcreedor } from '../../components/Reciboacreedor';
import {
  Users, Plus, ChevronDown, ChevronUp,
  Trash2, AlertTriangle, Calculator, PenLine,
} from 'lucide-react';
import api from '../../api/axios.config';
import { getCompraById } from '../../api/compras.api';

// ─── utils ────────────────────────────────────────────────────────────────────

const normalizarProductos = (data) => {
  if (Array.isArray(data)) return data;
  if (data?.items && Array.isArray(data.items)) return data.items;
  return [];
};

// ─── estado config ────────────────────────────────────────────────────────────

const ESTADO_CFG = {
  Saldada:  { variant: 'green',  ring: 'border-green-200 bg-green-50/40'  },
  Parcial:  { variant: 'yellow', ring: 'border-amber-200 bg-amber-50/40'  },
  Pendiente:{ variant: 'red',    ring: 'border-red-200   bg-red-50/40'    },
};

// ─── calculadora ──────────────────────────────────────────────────────────────

function CalcBtn({ ch, onClick, wide, accent, active }) {
  return (
    <button type="button" onClick={onClick}
      className={`h-11 rounded-xl text-sm font-semibold transition-all active:scale-95 select-none
        ${wide ? 'col-span-2' : ''}
        ${active  ? 'bg-blue-600 text-white shadow-sm'
          : accent ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
          : ch === 'C'  ? 'bg-red-50 text-red-600 hover:bg-red-100'
          : ch === '⌫'  ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          : ch === '='  ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
          : 'bg-white border border-gray-200 text-gray-800 hover:bg-gray-50'}`}>
      {ch}
    </button>
  );
}

function Calculadora({ onUsar }) {
  const [display,   setDisplay]   = useState('0');
  const [prevVal,   setPrevVal]   = useState(null);
  const [op,        setOp]        = useState(null);
  const [esperando, setEsperando] = useState(false);
  const [historial, setHistorial] = useState('');

  const fmtNum = (n) => String(Number.isInteger(n) ? n : parseFloat(n.toFixed(2)));
  const calcOp = (a, b, o) => {
    const r = o === '+' ? a + b : o === '-' ? a - b : o === '×' ? a * b : b !== 0 ? a / b : 0;
    return Math.round(r * 100) / 100;
  };
  const presNum = (n) => {
    if (esperando) { setDisplay(String(n)); setEsperando(false); }
    else setDisplay(display === '0' ? String(n) : display + n);
  };
  const presDecimal = () => {
    if (esperando) { setDisplay('0.'); setEsperando(false); return; }
    if (!display.includes('.')) setDisplay(display + '.');
  };
  const presOp = (o) => {
    const val = parseFloat(display);
    if (prevVal !== null && !esperando) {
      const res = calcOp(prevVal, val, op);
      setDisplay(fmtNum(res)); setHistorial(`${fmtNum(res)} ${o}`); setPrevVal(res);
    } else { setHistorial(`${display} ${o}`); setPrevVal(val); }
    setOp(o); setEsperando(true);
  };
  const igual = () => {
    if (prevVal === null || op === null) return;
    const val = parseFloat(display);
    const res = calcOp(prevVal, val, op);
    setHistorial(`${historial} ${display} =`);
    setDisplay(fmtNum(res)); setPrevVal(null); setOp(null); setEsperando(true);
  };
  const limpiar = () => { setDisplay('0'); setPrevVal(null); setOp(null); setEsperando(false); setHistorial(''); };
  const borrar  = () => { if (esperando) return; setDisplay(display.length > 1 ? display.slice(0, -1) : '0'); };

  return (
    <div className="flex flex-col gap-2 bg-gray-50 border border-gray-200 rounded-2xl p-3">
      <div className="bg-gray-900 rounded-xl px-3 py-2.5 flex flex-col items-end gap-0.5">
        <p className="text-gray-500 text-xs h-4 tabular-nums truncate w-full text-right">{historial}</p>
        <p className="text-white text-2xl font-mono tabular-nums leading-tight">
          {Number(display).toLocaleString('es-CO')}
        </p>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        <CalcBtn ch="C"  onClick={limpiar}           wide />
        <CalcBtn ch="⌫"  onClick={borrar} />
        <CalcBtn ch="÷"  onClick={() => presOp('÷')} accent active={op === '÷' && esperando} />
        {[7, 8, 9].map((n) => <CalcBtn key={n} ch={String(n)} onClick={() => presNum(n)} />)}
        <CalcBtn ch="×"  onClick={() => presOp('×')} accent active={op === '×' && esperando} />
        {[4, 5, 6].map((n) => <CalcBtn key={n} ch={String(n)} onClick={() => presNum(n)} />)}
        <CalcBtn ch="−"  onClick={() => presOp('-')} accent active={op === '-' && esperando} />
        {[1, 2, 3].map((n) => <CalcBtn key={n} ch={String(n)} onClick={() => presNum(n)} />)}
        <CalcBtn ch="+"  onClick={() => presOp('+')} accent active={op === '+' && esperando} />
        <CalcBtn ch="0"  onClick={() => presNum(0)}  wide />
        <CalcBtn ch="."  onClick={presDecimal} />
        <CalcBtn ch="="  onClick={igual} />
      </div>
      <Button size="sm" className="w-full" onClick={() => onUsar(display)} disabled={display === '0'}>
        Usar {formatCOP(Math.round(Number(display) || 0))}
      </Button>
    </div>
  );
}

// ─── modal detalle compra ─────────────────────────────────────────────────────

function ModalCompraDetalle({ compraId, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['compra-detalle', compraId],
    queryFn:  () => getCompraById(compraId).then((r) => r.data.data),
    enabled:  !!compraId,
  });

  return (
    <Modal open onClose={onClose} title={`Compra #${String(compraId).padStart(5, '0')}`} size="lg">
      {isLoading ? <Spinner className="py-10" /> : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-400 mb-0.5">Fecha</p>
              <p className="text-sm font-medium text-gray-800">{formatFechaHora(data?.fecha)}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-400 mb-0.5">Estado</p>
              <Badge variant={data?.estado === 'Completada' ? 'green' : 'yellow'}>{data?.estado}</Badge>
            </div>
            {data?.numero_factura && (
              <div className="bg-gray-50 rounded-xl p-3 col-span-2">
                <p className="text-xs text-gray-400 mb-0.5">N° Factura proveedor</p>
                <p className="text-sm font-medium text-gray-800">{data.numero_factura}</p>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-gray-700">Productos</p>
            {(data?.lineas || []).map((l) => (
              <div key={l.id} className="bg-gray-50 rounded-xl p-3 flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{l.nombre_producto}</p>
                  {l.imei
                    ? <p className="text-xs text-gray-400 font-mono mt-0.5">{l.imei}</p>
                    : <p className="text-xs text-gray-400">Cantidad: {l.cantidad}</p>
                  }
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-gray-400">{l.cantidad} × {formatCOP(l.precio_unitario)}</p>
                  <p className="text-sm font-semibold text-gray-900">{formatCOP(l.cantidad * l.precio_unitario)}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between items-center bg-blue-50 rounded-xl px-4 py-3">
            <span className="text-sm font-semibold text-gray-700">Total</span>
            <span className="text-base font-bold text-blue-700">{formatCOP(data?.total)}</span>
          </div>
          {data?.notas && (
            <div className="bg-gray-50 rounded-xl px-3 py-2">
              <p className="text-xs text-gray-400 mb-0.5">Notas</p>
              <p className="text-xs text-gray-600">{data.notas}</p>
            </div>
          )}
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
        </div>
      )}
    </Modal>
  );
}

// ─── modal abono rápido ───────────────────────────────────────────────────────

function ModalAbonoRapido({ acreedor, cargo, onClose, onImprimir }) {
  const queryClient   = useQueryClient();
  const [valor,       setValor]       = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [mostrarCalc, setMostrarCalc] = useState(false);
  const [error,       setError]       = useState('');

  const pendiente    = Number(cargo.saldo_pendiente);
  const tituloCompra = cargo.compra_id
    ? `Compra #${String(cargo.compra_id).padStart(5, '0')}`
    : (cargo.descripcion || 'Cargo');

  const mutation = useMutation({
    mutationFn: () => registrarMovimiento(acreedor.id, {
      tipo:              'Abono',
      valor:             Number(valor),
      descripcion:       descripcion.trim() || undefined,
      cargo_id:          cargo.id,
      registrar_en_caja: true,
      metodo:            'Efectivo',
    }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['compras-con-saldo', acreedor.id], exact: false });
      queryClient.invalidateQueries({ queryKey: ['acreedores'],                     exact: false });
      queryClient.invalidateQueries({ queryKey: ['abonos-cargo', acreedor.id, cargo.id], exact: false });
      const mov = data?.data?.data ?? null;
      if (onImprimir) onImprimir(mov);
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al registrar'),
  });

  return (
    <Modal open onClose={onClose} title={`Abonar — ${tituloCompra}`} size="sm">
      <div className="flex flex-col gap-4">
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <p className="text-xs text-red-400 mb-0.5">Saldo pendiente · {acreedor.nombre}</p>
          <p className="text-2xl font-bold text-red-600">{formatCOP(pendiente)}</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">
              Valor <span className="text-red-400 text-xs">*</span>
            </label>
            <button type="button" onClick={() => setMostrarCalc((v) => !v)}
              className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 transition-colors">
              <Calculator size={12} />
              {mostrarCalc ? 'Cerrar' : 'Calculadora'}
            </button>
          </div>
          <InputMoneda
            value={valor}
            onChange={setValor}
            placeholder="0"
            autoFocus
            className="w-full px-3 py-2 bg-gray-100 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
          />
        </div>

        {mostrarCalc && (
          <Calculadora onUsar={(val) => {
            setValor(String(Math.round(Number(val) || 0)));
            setMostrarCalc(false);
          }} />
        )}

        <Input
          label="Descripción (opcional)"
          placeholder="Ej: Pago parcial enero"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && valor && Number(valor) > 0) mutation.mutate();
          }}
        />

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button
            className="flex-1"
            loading={mutation.isPending}
            disabled={!valor || Number(valor) <= 0}
            onClick={() => mutation.mutate()}
          >
            Registrar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── historial de abonos ──────────────────────────────────────────────────────

function AbonosHistorial({ acreedorId, cargoId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['abonos-cargo', acreedorId, cargoId],
    queryFn:  () => getAbonosPorCargo(acreedorId, cargoId).then((r) => r.data.data),
    staleTime: 0,
  });
  const abonos = Array.isArray(data) ? data : [];

  if (isLoading) return <Spinner className="py-3" />;
  if (abonos.length === 0)
    return <p className="text-xs text-gray-400 italic">Sin abonos registrados aún</p>;

  return (
    <div className="flex flex-col gap-1.5">
      {abonos.map((a) => (
        <div key={a.id}
          className="flex justify-between items-center gap-2 bg-green-50 border border-green-100
            rounded-xl px-3 py-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-700 truncate">{a.descripcion || 'Abono'}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {formatFechaHora(a.fecha)}{a.usuario_nombre && ` · ${a.usuario_nombre}`}
            </p>
          </div>
          <span className="text-sm font-bold text-green-700 flex-shrink-0">
            +{formatCOP(a.valor)}
          </span>
        </div>
      ))}
      <div className="flex justify-between px-1 pt-1 border-t border-gray-100">
        <span className="text-xs text-gray-400">Total abonado</span>
        <span className="text-xs font-bold text-green-700">
          {formatCOP(abonos.reduce((s, a) => s + Number(a.valor), 0))}
        </span>
      </div>
    </div>
  );
}

// ─── compra row ───────────────────────────────────────────────────────────────

function CompraRow({ cargo, acreedorId, onAbonar }) {
  const [expandido, setExpandido] = useState(false);
  const [verCompra, setVerCompra] = useState(false);

  const cfg       = ESTADO_CFG[cargo.estado_pago] || ESTADO_CFG.Pendiente;
  const original  = Number(cargo.valor_original);
  const pagado    = Number(cargo.total_abonado);
  const pendiente = Number(cargo.saldo_pendiente);
  const progreso  = original > 0 ? Math.min((pagado / original) * 100, 100) : 0;

  return (
    <div className={`border rounded-2xl overflow-hidden ${cfg.ring}`}>
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <Badge variant={cfg.variant}>{cargo.estado_pago}</Badge>
              {cargo.compra_id && (
                <button
                  onClick={() => setVerCompra(true)}
                  className="text-xs text-blue-500 bg-blue-50 px-2 py-0.5 rounded-lg border
                    border-blue-100 hover:bg-blue-100 transition-colors">
                  Ver compra #{String(cargo.compra_id).padStart(5, '0')}
                </button>
              )}
            </div>
            <p className="text-sm font-semibold text-gray-800 leading-snug">
              {cargo.descripcion || 'Sin descripción'}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">{formatFechaHora(cargo.fecha)}</p>
          </div>

          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <p className="text-base font-bold text-gray-900">{formatCOP(original)}</p>
            {cargo.estado_pago !== 'Saldada' && (
              <button
                onClick={() => onAbonar(cargo)}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-green-600 text-white
                  hover:bg-green-700 active:scale-95 transition-all shadow-sm">
                Abonar
              </button>
            )}
          </div>
        </div>

        <div className="mt-3">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-green-600 font-medium">
              {pagado > 0 ? `Pagado: ${formatCOP(pagado)}` : 'Sin pagos aún'}
            </span>
            {pendiente > 0 && (
              <span className="text-red-500 font-medium">Falta: {formatCOP(pendiente)}</span>
            )}
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500
                ${progreso >= 100 ? 'bg-green-500' : pagado > 0 ? 'bg-blue-400' : 'bg-gray-300'}`}
              style={{ width: `${progreso}%` }}
            />
          </div>
        </div>

        <button
          onClick={() => setExpandido((v) => !v)}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mt-2.5 transition-colors">
          {expandido ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expandido ? 'Ocultar historial' : 'Ver historial de pagos'}
        </button>
      </div>

      {expandido && (
        <div className="border-t border-dashed border-gray-200 px-3.5 py-3 bg-white/70">
          <AbonosHistorial acreedorId={acreedorId} cargoId={cargo.id} />
        </div>
      )}

      {verCompra && cargo.compra_id && (
        <ModalCompraDetalle compraId={cargo.compra_id} onClose={() => setVerCompra(false)} />
      )}
    </div>
  );
}

// ─── acreedor card ────────────────────────────────────────────────────────────

function AcreedorCard({ acreedor, esAdmin, onEliminar }) {
  const [expanded,     setExpanded]     = useState(false);
  const [cargoAbono,   setCargoAbono]   = useState(null);
  const [movImprimir,  setMovImprimir]  = useState(null);
  const [filtroEstado, setFiltroEstado] = useState('Todas');

  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn:  () => getConfig().then((r) => r.data.data),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['compras-con-saldo', acreedor.id],
    queryFn:  () => getComprasConSaldo(acreedor.id).then((r) => r.data.data),
    enabled:  expanded,
    staleTime: 0,
  });
  const cargos = Array.isArray(data) ? data : [];

  const saldo = Number(acreedor.saldo || 0);

  const countByEstado = {
    Pendiente: cargos.filter((c) => c.estado_pago === 'Pendiente').length,
    Parcial:   cargos.filter((c) => c.estado_pago === 'Parcial').length,
    Saldada:   cargos.filter((c) => c.estado_pago === 'Saldada').length,
  };

  const cargosFiltrados = filtroEstado === 'Todas'
    ? cargos
    : cargos.filter((c) => c.estado_pago === filtroEstado);

  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
      {/* header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3.5 text-left
          hover:bg-gray-50/50 transition-colors">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm
            flex-shrink-0 select-none
            ${saldo > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
            {acreedor.nombre.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-gray-900">{acreedor.nombre}</p>
              {acreedor.proveedor_id && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full border leading-none
                  ${acreedor.proveedor_tipo === 'cruce'
                    ? 'text-amber-700 bg-amber-50 border-amber-200'
                    : 'text-blue-500 bg-blue-50 border-blue-100'}`}>
                  {acreedor.proveedor_tipo === 'cruce' ? 'Cruce' : 'Proveedor'}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400 truncate">
              CC: {acreedor.cedula}{acreedor.telefono && ` · ${acreedor.telefono}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="text-right">
            <p className="text-xs text-gray-400">Deuda total</p>
            <p className={`text-sm font-bold ${saldo > 0 ? 'text-red-500' : 'text-green-600'}`}>
              {saldo > 0 ? formatCOP(saldo) : 'Al día'}
            </p>
          </div>
          {esAdmin && (
            <button
              onClick={(e) => { e.stopPropagation(); onEliminar(acreedor); }}
              className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
              title="Eliminar">
              <Trash2 size={14} />
            </button>
          )}
          {expanded
            ? <ChevronUp size={16} className="text-gray-400" />
            : <ChevronDown size={16} className="text-gray-400" />}
        </div>
      </button>

      {/* contenido expandido */}
      {expanded && (
        <div className="border-t border-gray-100">
          {isLoading ? (
            <div className="p-6 flex justify-center"><Spinner /></div>
          ) : cargos.length === 0 ? (
            <div className="p-4">
              <EmptyState icon={PenLine} titulo="Sin compras a crédito"
                descripcion="Las compras registradas a crédito aparecerán aquí" />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-50 bg-gray-50/60 flex-wrap">
                {['Todas', 'Pendiente', 'Parcial', 'Saldada'].map((e) => {
                  const count = e === 'Todas' ? cargos.length : (countByEstado[e] ?? 0);
                  return (
                    <button key={e} onClick={() => setFiltroEstado(e)}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium
                        transition-all border
                        ${filtroEstado === e
                          ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                          : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}`}>
                      {e}
                      <span className={`rounded-full min-w-[18px] text-center
                        ${filtroEstado === e ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="p-4 flex flex-col gap-3">
                {cargosFiltrados.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-4">
                    No hay compras en este estado
                  </p>
                ) : (
                  cargosFiltrados.map((cargo) => (
                    <CompraRow
                      key={cargo.id}
                      cargo={cargo}
                      acreedorId={acreedor.id}
                      onAbonar={(c) => setCargoAbono(c)}
                    />
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}

      {cargoAbono && (
        <ModalAbonoRapido
          acreedor={acreedor}
          cargo={cargoAbono}
          onClose={() => setCargoAbono(null)}
          onImprimir={(mov) => { setCargoAbono(null); setMovImprimir(mov); }}
        />
      )}

      {movImprimir && (
        <ReciboAcreedor
          acreedor={acreedor}
          movimiento={movImprimir}
          config={configData}
          onClose={() => setMovImprimir(null)}
        />
      )}
    </div>
  );
}

// ─── modal nuevo acreedor ─────────────────────────────────────────────────────

function ModalNuevoAcreedor({ onClose }) {
  const queryClient                   = useQueryClient();
  const [form, setForm]               = useState({ nombre: '', cedula: '', telefono: '' });
  const [proveedorId, setProveedorId] = useState('');
  const [error, setError]             = useState('');

  const { data: proveedoresRaw } = useQuery({
    queryKey: ['proveedores'],
    queryFn:  () => api.get('/proveedores').then((r) => r.data.data),
  });
  const proveedores = normalizarProductos(proveedoresRaw);

  const { data: acreedoresData } = useQuery({
    queryKey: ['acreedores'],
    queryFn:  () => api.get('/acreedores').then((r) => r.data.data),
  });
  const acreedores = normalizarProductos(acreedoresData);

  const handleSeleccionarProveedor = (id) => {
    setProveedorId(id);
    setError('');
    if (!id) return;
    const yaVinculado = acreedores.some((a) => String(a.proveedor_id) === id);
    if (yaVinculado) {
      const existing = acreedores.find((a) => String(a.proveedor_id) === id);
      setError(`Este proveedor ya está vinculado al acreedor "${existing.nombre}"`);
      setProveedorId('');
      return;
    }
    const prov = proveedores.find((p) => String(p.id) === id);
    if (prov) {
      setForm((f) => ({
        ...f,
        nombre:   f.nombre   || prov.nombre   || '',
        cedula:   f.cedula   || prov.nit       || '',
        telefono: f.telefono || prov.telefono  || '',
      }));
    }
  };

  const mutation = useMutation({
    mutationFn: () => crearAcreedor({
      ...form,
      proveedor_id: proveedorId ? Number(proveedorId) : undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['acreedores'], exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al crear'),
  });

  const handleKeyDown = (e, nextId) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (nextId) document.getElementById(nextId)?.focus();
      else mutation.mutate();
    }
  };

  return (
    <Modal open onClose={onClose} title="Nuevo Acreedor" size="sm">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            Proveedor <span className="text-gray-400 font-normal text-xs">(opcional)</span>
          </label>
          <select value={proveedorId}
            onChange={(e) => handleSeleccionarProveedor(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm
              text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Sin proveedor vinculado</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          {proveedorId && (
            <p className="text-xs text-blue-600">Los datos del proveedor se usarán como referencia.</p>
          )}
        </div>

        <Input id="nombre-acreedor" label="Nombre" placeholder="Nombre completo"
          value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
          onKeyDown={(e) => handleKeyDown(e, 'cedula-acreedor')} autoFocus />
        <Input id="cedula-acreedor" label="Cédula / NIT" placeholder="123456789"
          value={form.cedula} onChange={(e) => setForm({ ...form, cedula: e.target.value })}
          onKeyDown={(e) => handleKeyDown(e, 'tel-acreedor')} />
        <Input id="tel-acreedor" label="Teléfono" placeholder="3001234567"
          value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })}
          onKeyDown={(e) => handleKeyDown(e, null)} />

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mutation.isPending} onClick={() => mutation.mutate()}
            disabled={!form.nombre.trim() || !form.cedula.trim()}>
            Guardar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── modal eliminar acreedor ──────────────────────────────────────────────────

function ModalEliminarAcreedor({ acreedor, onClose, onEliminar }) {
  const [pin,         setPin]         = useState('');
  const [error,       setError]       = useState('');
  const [verificando, setVerificando] = useState(false);

  const handleConfirmar = async () => {
    if (!pin.trim()) { setError('Ingresa el PIN de administrador'); return; }
    setVerificando(true);
    setError('');
    try {
      const res = await verificarPin(pin.trim());
      if (!res.data.valido) { setError('PIN incorrecto'); return; }
      onEliminar();
    } catch {
      setError('Error al verificar el PIN. Intenta de nuevo.');
    } finally {
      setVerificando(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Eliminar acreedor" size="sm">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-3 py-2">
          <div className="w-14 h-14 rounded-full bg-red-50 border-2 border-red-200 flex items-center justify-center">
            <AlertTriangle size={26} className="text-red-500" />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold text-gray-900">{acreedor.nombre}</p>
            <p className="text-sm text-gray-500 mt-1">Esta acción no se puede deshacer</p>
          </div>
        </div>

        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex flex-col gap-1">
          <p className="text-sm font-semibold text-red-700">¿Estás seguro?</p>
          <p className="text-xs text-red-600 leading-relaxed">
            Se eliminarán permanentemente todos los datos de este acreedor.
          </p>
        </div>

        <Input label="PIN de administrador" type="password" placeholder="••••"
          value={pin} onChange={(e) => { setPin(e.target.value); setError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmar(); }} autoFocus />

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose}
            className="flex-1 py-2 rounded-xl text-sm font-medium border border-gray-200
              bg-gray-50 text-gray-600 hover:bg-gray-100 transition-colors">
            Cancelar
          </button>
          <Button className="flex-1 bg-red-600 hover:bg-red-700 text-white"
            loading={verificando} onClick={handleConfirmar}>
            <Trash2 size={14} /> Eliminar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── página principal ─────────────────────────────────────────────────────────

export default function AcreedoresPage() {
  const { esAdminNegocio }              = useAuth();
  const esAdmin                         = esAdminNegocio();
  const [busqueda, setBusqueda]         = useState('');
  const [modalNuevo, setModalNuevo]     = useState(false);
  const [acreedorEliminar, setEliminar] = useState(null);
  const queryClient                     = useQueryClient();

  const mutEliminar = useMutation({
    mutationFn: () => eliminarAcreedor(acreedorEliminar.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['acreedores'], exact: false });
      setEliminar(null);
    },
    onError: (err) => {
      setEliminar(null);
      alert(err.response?.data?.error || 'No se puede eliminar este acreedor');
    },
  });

  const { data: acreedoresData, isLoading } = useQuery({
    queryKey: esAdmin ? ['acreedores', busqueda] : ['acreedores-cruces', busqueda],
    queryFn:  () => esAdmin
      ? getAcreedores(busqueda).then((r) => r.data.data)
      : api.get('/acreedores/cruces', { params: { filtro: busqueda || undefined } }).then((r) => r.data.data),
  });
  const acreedores = Array.isArray(acreedoresData) ? acreedoresData : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <SearchInput value={busqueda} onChange={setBusqueda} placeholder="Buscar acreedor..." />
        </div>
        {esAdmin && (
          <button onClick={() => setModalNuevo(true)}
            className="h-10 w-10 bg-blue-600 rounded-xl flex items-center justify-center
              hover:bg-blue-700 transition-colors flex-shrink-0">
            <Plus size={18} className="text-white" />
          </button>
        )}
      </div>

      {isLoading ? (
        <Spinner className="py-20" />
      ) : acreedores.length === 0 ? (
        <EmptyState icon={Users} titulo="Sin acreedores"
          descripcion={esAdmin ? 'Crea el primer acreedor con el botón +' : 'Sin acreedores asignados'} />
      ) : (
        <div className="flex flex-col gap-3">
          {acreedores.map((a) => (
            <AcreedorCard
              key={a.id}
              acreedor={a}
              esAdmin={esAdmin}
              onEliminar={setEliminar}
            />
          ))}
        </div>
      )}

      {modalNuevo && <ModalNuevoAcreedor onClose={() => setModalNuevo(false)} />}

      {acreedorEliminar && (
        <ModalEliminarAcreedor
          acreedor={acreedorEliminar}
          onClose={() => setEliminar(null)}
          onEliminar={() => mutEliminar.mutate()}
        />
      )}
    </div>
  );
}
