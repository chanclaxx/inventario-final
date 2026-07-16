import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAcreedores,
  crearAcreedor,
  registrarMovimiento,
  eliminarAcreedor,
  getComprasConSaldo,
  getAbonosPorCargo,
  getSaldoAFavor,
  aplicarSaldoAFavor,
  editarAbono,
  eliminarAbono,
  exportarCuentaPdf,
  getHistorialAcreedor,
  registrarAbonoTotal,
} from '../../api/acreedores.api';
import { exportarCuentaAcreedorExcel } from '../../utils/exportarCuentaAcreedorExcel';
import { getConfig, verificarPin } from '../../api/config.api';
import { useMetodosPago } from '../../hooks/useMetodosPago';
import { formatCOP, formatFechaHora } from '../../utils/formatters';
import { useAuth }     from '../../context/useAuth';
import { Button }      from '../../components/ui/Button';
import { Input }       from '../../components/ui/Input';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { Modal }       from '../../components/ui/Modal';
import { Badge }       from '../../components/ui/Badge';
import { Spinner }     from '../../components/ui/Spinner';
import { EmptyState }  from '../../components/ui/EmptyState';
import { SearchInput } from '../../components/ui/SearchInput';
import { ReciboAcreedor } from '../../components/Reciboacreedor';
import {
  Users, Plus, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  Trash2, AlertTriangle, Calculator, PenLine, Wallet, Search, FileDown,
  FileSpreadsheet, Layers, Clock,
} from 'lucide-react';
import api from '../../api/axios.config';
import { getCompraById } from '../../api/compras.api';
import { EstadoCuentaAcreedor } from './EstadoCuentaAcreedor';

// ─── utils ────────────────────────────────────────────────────────────────────

const normalizarProductos = (data) => {
  if (Array.isArray(data)) return data;
  if (data?.items && Array.isArray(data.items)) return data.items;
  return [];
};

const ESTADO_CFG = {
  Saldada:  { variant: 'green',  ring: 'border-green-200 bg-green-50/40'  },
  Parcial:  { variant: 'yellow', ring: 'border-amber-200 bg-amber-50/40'  },
  Pendiente:{ variant: 'red',    ring: 'border-red-200   bg-red-50/40'    },
};

// Tiempo transcurrido desde el último pago — etiqueta + nivel de color
function tiempoUltimoPago(fecha) {
  if (!fecha) return { texto: 'Sin pagos', nivel: 'rojo' };
  const dias = Math.floor((Date.now() - new Date(fecha)) / 86400000);
  let texto;
  if (dias < 1)        texto = 'hoy';
  else if (dias === 1) texto = 'ayer';
  else if (dias < 7)   texto = `hace ${dias} días`;
  else if (dias < 30)  { const s = Math.floor(dias / 7);  texto = `hace ${s} sem.`; }
  else if (dias < 365) { const m = Math.floor(dias / 30); texto = `hace ${m} mes${m > 1 ? 'es' : ''}`; }
  else                   texto = 'hace +1 año';
  const nivel = dias <= 7 ? 'verde' : dias <= 30 ? 'amarillo' : dias <= 60 ? 'naranja' : 'rojo';
  return { texto, nivel };
}

const PAGO_CLASES = {
  verde:    'bg-green-50  text-green-600  border-green-200',
  amarillo: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  naranja:  'bg-orange-50 text-orange-600 border-orange-200',
  rojo:     'bg-red-50    text-red-600    border-red-200',
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
    <Modal open onClose={onClose} title={`Compra #${String(data?.numero ?? compraId).padStart(5, '0')}`} size="lg">
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
  const metodosPago   = useMetodosPago();
  const [valor,           setValor]           = useState('');
  const [descripcion,     setDescripcion]     = useState('');
  const [mostrarCalc,     setMostrarCalc]     = useState(false);
  const [metodo,          setMetodo]          = useState(() => metodosPago[0]?.id ?? 'Efectivo');
  const [registrarEnCaja, setRegistrarEnCaja] = useState(true);
  const [error,           setError]           = useState('');
  const [compraVisible,   setCompraVisible]   = useState(false);

  const pendiente    = Number(cargo.saldo_pendiente);
  const tituloCompra = cargo.compra_id
    ? `Compra #${String(cargo.compra_numero ?? cargo.compra_id).padStart(5, '0')}`
    : (cargo.descripcion || 'Cargo');

  const mutation = useMutation({
    mutationFn: () => registrarMovimiento(acreedor.id, {
      tipo:              'Abono',
      valor:             Number(valor),
      descripcion:       descripcion.trim() || undefined,
      cargo_id:          cargo.id,
      registrar_en_caja: registrarEnCaja,
      metodo,
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
    <>
    <Modal open onClose={onClose} title={`Abonar — ${tituloCompra}`} size="sm">
      <div className="flex flex-col gap-4">
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <p className="text-xs text-red-400">Saldo pendiente · {acreedor.nombre}</p>
            {cargo.compra_id && (
              <button type="button" onClick={() => setCompraVisible(true)}
                className="text-xs text-blue-500 hover:text-blue-700 font-medium transition-colors flex-shrink-0">
                Ver compra →
              </button>
            )}
          </div>
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
          {Number(valor) > 0 && Number(valor) > pendiente && (
            <p className="text-xs text-red-500 px-1">
              El abono no puede superar el saldo pendiente ({formatCOP(pendiente)})
            </p>
          )}
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

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Método de pago</label>
          <div className="flex gap-2 flex-wrap">
            {metodosPago.map((m) => (
              <button key={m.id} type="button" onClick={() => setMetodo(m.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all
                  ${metodo === m.id
                    ? 'bg-blue-50 border-blue-300 text-blue-700'
                    : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className={`rounded-xl p-3 border transition-all
          ${registrarEnCaja ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'}`}>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={registrarEnCaja}
              onChange={(e) => setRegistrarEnCaja(e.target.checked)}
              className="rounded accent-blue-600 w-4 h-4 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-gray-700">Registrar en caja</p>
              <p className="text-xs text-gray-400">Si no se marca, el abono no aparecerá en el resumen de caja del día</p>
            </div>
          </label>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button
            className="flex-1"
            loading={mutation.isPending}
            disabled={!valor || Number(valor) <= 0 || Number(valor) > pendiente}
            onClick={() => mutation.mutate()}
          >
            Registrar
          </Button>
        </div>
      </div>
    </Modal>
    {compraVisible && cargo.compra_id && (
      <ModalCompraDetalle compraId={cargo.compra_id} onClose={() => setCompraVisible(false)} />
    )}
  </>
  );
}

// ─── modal saldo a favor (pago adelantado sin cargo vinculado) ────────────────

function ModalSaldoAFavor({ acreedor, onClose }) {
  const queryClient   = useQueryClient();
  const metodosPago   = useMetodosPago();
  const [valor,           setValor]           = useState('');
  const [descripcion,     setDescripcion]     = useState('Pago adelantado');
  const [mostrarCalc,     setMostrarCalc]     = useState(false);
  const [metodo,          setMetodo]          = useState(() => metodosPago[0]?.id ?? 'Efectivo');
  const [registrarEnCaja, setRegistrarEnCaja] = useState(true);
  const [error,           setError]           = useState('');

  const mutation = useMutation({
    mutationFn: () => registrarMovimiento(acreedor.id, {
      tipo:              'Abono',
      valor:             Number(valor),
      descripcion:       descripcion.trim() || 'Pago adelantado',
      registrar_en_caja: registrarEnCaja,
      metodo,
      // sin cargo_id → queda como saldo a favor
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saldo-a-favor', acreedor.id], exact: false });
      queryClient.invalidateQueries({ queryKey: ['acreedores'],                  exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al registrar'),
  });

  return (
    <Modal open onClose={onClose} title="Registrar saldo a favor" size="sm">
      <div className="flex flex-col gap-4">
        <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3">
          <p className="text-xs text-green-500 mb-0.5">Pago adelantado · {acreedor.nombre}</p>
          <p className="text-xs text-gray-500 leading-relaxed">
            Este abono no se vincula a ninguna compra. Quedará como crédito disponible
            para aplicar en futuras deudas.
          </p>
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
          label="Descripción"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && valor && Number(valor) > 0) mutation.mutate(); }}
        />

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Método de pago</label>
          <div className="flex gap-2 flex-wrap">
            {metodosPago.map((m) => (
              <button key={m.id} type="button" onClick={() => setMetodo(m.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all
                  ${metodo === m.id
                    ? 'bg-blue-50 border-blue-300 text-blue-700'
                    : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className={`rounded-xl p-3 border transition-all
          ${registrarEnCaja ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'}`}>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={registrarEnCaja}
              onChange={(e) => setRegistrarEnCaja(e.target.checked)}
              className="rounded accent-blue-600 w-4 h-4 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-gray-700">Registrar en caja</p>
              <p className="text-xs text-gray-400">Si no se marca, no aparecerá en el resumen de caja del día</p>
            </div>
          </label>
        </div>

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

// ─── modal pago total (distribuye un pago entre los cargos más antiguos) ──────

function ModalAbonoTotal({ acreedor, cargos, onClose }) {
  const queryClient = useQueryClient();
  const metodosPago = useMetodosPago();
  const [valor,           setValor]           = useState('');
  const [metodo,          setMetodo]          = useState(() => metodosPago[0]?.id ?? 'Efectivo');
  const [registrarEnCaja, setRegistrarEnCaja] = useState(true);
  const [error,           setError]           = useState('');

  const totalPendiente = cargos.reduce((s, c) => s + Number(c.saldo_pendiente || 0), 0);

  // Previsualización de la distribución FIFO (más antiguo primero)
  const distribucion = (() => {
    let restante = Number(valor) || 0;
    const ordenados = [...cargos].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    const res = [];
    for (const c of ordenados) {
      if (restante <= 0) break;
      const pend = Number(c.saldo_pendiente || 0);
      if (pend <= 0) continue;
      const aplica = Math.min(restante, pend);
      res.push({ cargo: c, aplica });
      restante -= aplica;
    }
    return res;
  })();

  const mutation = useMutation({
    mutationFn: () => registrarAbonoTotal(acreedor.id, {
      valor:             Number(valor),
      metodo,
      registrar_en_caja: registrarEnCaja,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compras-con-saldo', acreedor.id], exact: false });
      queryClient.invalidateQueries({ queryKey: ['acreedores'],                     exact: false });
      queryClient.invalidateQueries({ queryKey: ['historial-acreedor', acreedor.id], exact: false });
      queryClient.invalidateQueries({ queryKey: ['saldo-a-favor', acreedor.id],     exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al registrar el pago'),
  });

  const handleRegistrar = () => {
    setError('');
    const v = Number(valor);
    if (!v || v <= 0) return setError('El valor debe ser mayor a 0');
    if (v > totalPendiente) return setError(`El pago no puede superar la deuda total (${formatCOP(totalPendiente)})`);
    mutation.mutate();
  };

  return (
    <Modal open onClose={onClose} title={`Pago total — ${acreedor.nombre}`} size="sm">
      <div className="flex flex-col gap-4">
        <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3">
          <p className="text-xs text-indigo-500">Deuda total · {cargos.length} cargo(s) pendiente(s)</p>
          <p className="text-2xl font-bold text-indigo-700">{formatCOP(totalPendiente)}</p>
          <p className="text-xs text-indigo-400 mt-0.5">
            El pago se reparte entre los cargos más antiguos primero.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">
            Valor a pagar <span className="text-red-400 text-xs">*</span>
          </label>
          <InputMoneda
            value={valor} onChange={setValor} placeholder="0" autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleRegistrar()}
            className="w-full px-3 py-2 bg-gray-100 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
          />
          {Number(valor) > totalPendiente && (
            <p className="text-xs text-red-500 px-1">
              Supera la deuda total ({formatCOP(totalPendiente)})
            </p>
          )}
        </div>

        {distribucion.length > 0 && (
          <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-1.5 max-h-44 overflow-y-auto">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Se aplicará a</p>
            {distribucion.map(({ cargo, aplica }) => (
              <div key={cargo.id} className="flex items-center justify-between text-xs gap-2">
                <span className="text-gray-600 truncate">
                  {cargo.descripcion || (cargo.compra_id ? `Compra #${String(cargo.compra_numero ?? cargo.compra_id).padStart(5, '0')}` : 'Cargo')}
                </span>
                <span className="font-semibold text-indigo-600 flex-shrink-0">{formatCOP(aplica)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Método de pago</label>
          <div className="flex gap-2 flex-wrap">
            {metodosPago.map((m) => (
              <button key={m.id} type="button" onClick={() => setMetodo(m.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all
                  ${metodo === m.id
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                    : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className={`rounded-xl p-3 border transition-all
          ${registrarEnCaja ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'}`}>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={registrarEnCaja}
              onChange={(e) => setRegistrarEnCaja(e.target.checked)}
              className="rounded accent-blue-600 w-4 h-4 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-gray-700">Registrar en caja</p>
              <p className="text-xs text-gray-400">Si no se marca, el pago no aparecerá en el resumen de caja del día</p>
            </div>
          </label>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button
            className="flex-1 bg-indigo-600 hover:bg-indigo-700"
            loading={mutation.isPending}
            disabled={!valor || Number(valor) <= 0 || Number(valor) > totalPendiente}
            onClick={handleRegistrar}
          >
            <Layers size={14} /> Registrar pago
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── modal aplicar saldo a favor a un cargo ───────────────────────────────────

function ModalAplicarSaldo({ acreedor, cargo, saldoDisponible, onClose }) {
  const queryClient = useQueryClient();
  const maxAplicar  = Math.min(Number(cargo.saldo_pendiente), saldoDisponible);
  const [valor, setValor] = useState(String(maxAplicar));
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => aplicarSaldoAFavor(acreedor.id, cargo.id, Number(valor)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saldo-a-favor', acreedor.id],          exact: false });
      queryClient.invalidateQueries({ queryKey: ['compras-con-saldo', acreedor.id],       exact: false });
      queryClient.invalidateQueries({ queryKey: ['acreedores'],                            exact: false });
      queryClient.invalidateQueries({ queryKey: ['abonos-cargo', acreedor.id, cargo.id],  exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al aplicar'),
  });

  const valorNum = Number(valor) || 0;

  return (
    <Modal open onClose={onClose} title="Aplicar saldo a favor" size="sm">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-green-50 border border-green-100 rounded-xl px-3 py-2.5">
            <p className="text-xs text-green-500 mb-0.5">Saldo a favor disponible</p>
            <p className="text-lg font-bold text-green-700">{formatCOP(saldoDisponible)}</p>
          </div>
          <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
            <p className="text-xs text-red-400 mb-0.5">Saldo pendiente cargo</p>
            <p className="text-lg font-bold text-red-600">{formatCOP(cargo.saldo_pendiente)}</p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">
            Valor a aplicar <span className="text-red-400 text-xs">*</span>
          </label>
          <InputMoneda
            value={valor}
            onChange={setValor}
            placeholder="0"
            autoFocus
            className="w-full px-3 py-2 bg-gray-100 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
          />
          {valorNum > 0 && valorNum <= maxAplicar && (
            <p className="text-xs text-gray-400 px-1">
              Saldo restante a favor: {formatCOP(saldoDisponible - valorNum)}
            </p>
          )}
          {valorNum > maxAplicar && (
            <p className="text-xs text-red-500 px-1">
              No puede superar {formatCOP(maxAplicar)}
            </p>
          )}
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button
            className="flex-1"
            loading={mutation.isPending}
            disabled={!valorNum || valorNum <= 0 || valorNum > maxAplicar}
            onClick={() => mutation.mutate()}
          >
            Aplicar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── modal nuevo cargo manual ─────────────────────────────────────────────────

function ModalNuevoCargo({ acreedor, onClose }) {
  const queryClient   = useQueryClient();
  const [valor,       setValor]       = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [mostrarCalc, setMostrarCalc] = useState(false);
  const [error,       setError]       = useState('');

  const mutation = useMutation({
    mutationFn: () => registrarMovimiento(acreedor.id, {
      tipo:              'Cargo',
      valor:             Number(valor),
      descripcion:       descripcion.trim() || undefined,
      registrar_en_caja: false,
      metodo:            null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compras-con-saldo', acreedor.id], exact: false });
      queryClient.invalidateQueries({ queryKey: ['acreedores'],                     exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al registrar'),
  });

  return (
    <Modal open onClose={onClose} title="Agregar cargo" size="sm">
      <div className="flex flex-col gap-4">
        <Input
          label="Descripción (opcional)"
          placeholder="Ej: Deuda por factura #001..."
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') document.getElementById('valor-nuevo-cargo')?.focus();
          }}
        />

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
            id="valor-nuevo-cargo"
            value={valor}
            onChange={setValor}
            placeholder="0"
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

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button
            className="flex-1"
            loading={mutation.isPending}
            disabled={!valor || Number(valor) <= 0}
            onClick={() => mutation.mutate()}
          >
            Agregar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── modal editar abono ───────────────────────────────────────────────────────

function ModalEditarAbono({ acreedorId, cargoIdActual, abono, onClose }) {
  const queryClient   = useQueryClient();
  const metodosPago   = useMetodosPago();
  const [valor,           setValor]           = useState(String(Math.round(Number(abono.valor))));
  const [descripcion,     setDescripcion]     = useState(abono.descripcion || '');
  const [metodo,          setMetodo]          = useState(abono.metodo || metodosPago[0]?.id || 'Efectivo');
  const [cargoId,         setCargoId]         = useState(cargoIdActual);
  const [registrarEnCaja, setRegistrarEnCaja] = useState(abono.registrar_en_caja !== false);
  const [error,           setError]           = useState('');

  const { data: cargosRaw } = useQuery({
    queryKey: ['compras-con-saldo', acreedorId],
    queryFn:  () => getComprasConSaldo(acreedorId).then((r) => r.data.data),
    staleTime: 30_000,
  });
  const cargos = Array.isArray(cargosRaw) ? cargosRaw : [];

  const mutation = useMutation({
    mutationFn: () => editarAbono(acreedorId, abono.id, {
      valor:             Number(valor),
      descripcion:       descripcion.trim() || undefined,
      metodo,
      cargo_id:          cargoId || undefined,
      registrar_en_caja: registrarEnCaja,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compras-con-saldo', acreedorId], exact: false });
      queryClient.invalidateQueries({ queryKey: ['acreedores'],                    exact: false });
      queryClient.invalidateQueries({ queryKey: ['abonos-cargo', acreedorId],      exact: false });
      queryClient.invalidateQueries({ queryKey: ['saldo-a-favor', acreedorId],     exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al actualizar'),
  });

  return (
    <Modal open onClose={onClose} title="Editar abono" size="sm">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">
            Valor <span className="text-red-400 text-xs">*</span>
          </label>
          <InputMoneda value={valor} onChange={setValor} placeholder="0" autoFocus
            className="w-full px-3 py-2 bg-gray-100 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all" />
        </div>

        <Input label="Descripción (opcional)" value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)} />

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Método de pago</label>
          <div className="flex gap-2 flex-wrap">
            {metodosPago.map((m) => (
              <button key={m.id} type="button" onClick={() => setMetodo(m.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all
                  ${metodo === m.id
                    ? 'bg-blue-50 border-blue-300 text-blue-700'
                    : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Vinculado a cargo</label>
          <select
            value={cargoId ?? ''}
            onChange={(e) => setCargoId(e.target.value ? Number(e.target.value) : null)}
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm
              text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Sin cargo (saldo a favor)</option>
            {cargos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.compra_id
                  ? `Compra #${String(c.compra_numero ?? c.compra_id).padStart(5, '0')} — ${formatCOP(c.valor_original)}`
                  : `${c.descripcion || 'Cargo'} — ${formatCOP(c.valor_original)}`
                } · {c.estado_pago}
              </option>
            ))}
          </select>
        </div>

        <div className={`rounded-xl p-3 border transition-all
          ${registrarEnCaja ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'}`}>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={registrarEnCaja}
              onChange={(e) => setRegistrarEnCaja(e.target.checked)}
              className="rounded accent-blue-600 w-4 h-4 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-gray-700">Registrar en caja</p>
              <p className="text-xs text-gray-400">Si no se marca, no aparecerá en el resumen de caja del día</p>
            </div>
          </label>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mutation.isPending}
            disabled={!valor || Number(valor) <= 0}
            onClick={() => mutation.mutate()}>
            Guardar cambios
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── historial de abonos ──────────────────────────────────────────────────────

function AbonosHistorial({ acreedorId, cargoId, esAdmin }) {
  const queryClient = useQueryClient();
  const [abonoEditar,   setAbonoEditar]   = useState(null);
  const [abonoEliminar, setAbonoEliminar] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['abonos-cargo', acreedorId, cargoId],
    queryFn:  () => getAbonosPorCargo(acreedorId, cargoId).then((r) => r.data.data),
    staleTime: 0,
  });
  const abonos = Array.isArray(data) ? data : [];

  const mutEliminar = useMutation({
    mutationFn: () => eliminarAbono(acreedorId, abonoEliminar.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compras-con-saldo', acreedorId], exact: false });
      queryClient.invalidateQueries({ queryKey: ['acreedores'],                    exact: false });
      queryClient.invalidateQueries({ queryKey: ['abonos-cargo', acreedorId, cargoId], exact: false });
      queryClient.invalidateQueries({ queryKey: ['saldo-a-favor', acreedorId],     exact: false });
      setAbonoEliminar(null);
    },
    onError: (err) => {
      alert(err.response?.data?.error || 'Error al eliminar');
      setAbonoEliminar(null);
    },
  });

  if (isLoading) return <Spinner className="py-3" />;
  if (abonos.length === 0)
    return <p className="text-xs text-gray-400 italic">Sin abonos registrados aún</p>;

  return (
    <>
      <div className="flex flex-col gap-1.5">
        {abonos.map((a) => (
          <div key={a.id}
            className="flex items-center gap-2 bg-green-50 border border-green-100
              rounded-xl px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-gray-700 truncate">{a.descripcion || 'Abono'}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {formatFechaHora(a.fecha)}{a.usuario_nombre && ` · ${a.usuario_nombre}`}
                {a.metodo && ` · ${a.metodo}`}
              </p>
            </div>
            <span className="text-sm font-bold text-green-700 flex-shrink-0">
              +{formatCOP(a.valor)}
            </span>
            {esAdmin && (
              <div className="flex gap-0.5 flex-shrink-0">
                <button onClick={() => setAbonoEditar(a)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50
                    transition-colors" title="Editar abono">
                  <PenLine size={12} />
                </button>
                <button onClick={() => setAbonoEliminar(a)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50
                    transition-colors" title="Eliminar abono">
                  <Trash2 size={12} />
                </button>
              </div>
            )}
          </div>
        ))}
        <div className="flex justify-between px-1 pt-1 border-t border-gray-100">
          <span className="text-xs text-gray-400">Total abonado</span>
          <span className="text-xs font-bold text-green-700">
            {formatCOP(abonos.reduce((s, a) => s + Number(a.valor), 0))}
          </span>
        </div>
      </div>

      {abonoEditar && (
        <ModalEditarAbono
          acreedorId={acreedorId}
          cargoIdActual={cargoId}
          abono={abonoEditar}
          onClose={() => setAbonoEditar(null)}
        />
      )}

      {abonoEliminar && (
        <Modal open onClose={() => setAbonoEliminar(null)} title="Eliminar abono" size="sm">
          <div className="flex flex-col gap-4">
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
              <p className="text-sm font-semibold text-red-700 mb-1">¿Eliminar este abono?</p>
              <p className="text-xs text-gray-600 truncate">{abonoEliminar.descripcion || 'Abono'}</p>
              <p className="text-xl font-bold text-red-600 mt-1">{formatCOP(abonoEliminar.valor)}</p>
            </div>
            <p className="text-xs text-gray-400">Esta acción no se puede deshacer.</p>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1"
                onClick={() => setAbonoEliminar(null)}>
                Cancelar
              </Button>
              <Button className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                loading={mutEliminar.isPending} onClick={() => mutEliminar.mutate()}>
                <Trash2 size={14} /> Eliminar
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

// ─── cargo activo (pendiente / parcial) ───────────────────────────────────────

function CargoActivo({ cargo, acreedorId, esAdmin, saldoAFavor, onAbonar, onAplicar }) {
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const [modalCompra,      setModalCompra]      = useState(false);

  const cfg       = ESTADO_CFG[cargo.estado_pago] || ESTADO_CFG.Pendiente;
  const original  = Number(cargo.valor_original);
  const pagado    = Number(cargo.total_abonado);
  const pendiente = Number(cargo.saldo_pendiente);
  const progreso  = original > 0 ? Math.min((pagado / original) * 100, 100) : 0;

  return (
    <div
      className={`border rounded-2xl overflow-hidden ${cfg.ring}`}
      onDoubleClick={() => cargo.compra_id && setModalCompra(true)}
      title={cargo.compra_id ? 'Doble clic para ver detalle de la compra' : undefined}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <Badge variant={cfg.variant}>{cargo.estado_pago}</Badge>
              {cargo.compra_id && (
                <button
                  onClick={(e) => { e.stopPropagation(); setModalCompra(true); }}
                  className="text-xs text-blue-500 bg-blue-50 px-2 py-0.5 rounded-lg border
                    border-blue-100 hover:bg-blue-100 transition-colors">
                  Ver compra #{String(cargo.compra_numero ?? cargo.compra_id).padStart(5, '0')}
                </button>
              )}
            </div>
            <p className="text-sm font-semibold text-gray-900 leading-snug">
              {cargo.descripcion || 'Sin descripción'}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">{formatFechaHora(cargo.fecha)}</p>
          </div>

          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <p className="text-base font-bold text-gray-900">{formatCOP(original)}</p>
            <div className="flex gap-1.5">
              {saldoAFavor > 0 && pendiente > 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); onAplicar(cargo); }}
                  className="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-700
                    border border-emerald-200 hover:bg-emerald-100 active:scale-95 transition-all"
                  title={`Aplicar saldo a favor (${formatCOP(saldoAFavor)} disponible)`}>
                  <Wallet size={12} className="inline -mt-px mr-0.5" />
                  Aplicar
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onAbonar(cargo); }}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-green-600 text-white
                  hover:bg-green-700 active:scale-95 transition-all shadow-sm">
                Abonar
              </button>
            </div>
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
                ${pagado > 0 ? 'bg-blue-400' : 'bg-gray-300'}`}
              style={{ width: `${progreso}%` }}
            />
          </div>
        </div>

        <button
          onClick={(e) => { e.stopPropagation(); setHistorialAbierto((v) => !v); }}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600
            mt-2.5 transition-colors">
          {historialAbierto ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {historialAbierto ? 'Ocultar historial' : 'Ver historial de pagos'}
        </button>
      </div>

      {historialAbierto && (
        <div className="border-t border-dashed border-gray-200 px-4 py-3 bg-white/70">
          <AbonosHistorial acreedorId={acreedorId} cargoId={cargo.id} esAdmin={esAdmin} />
        </div>
      )}

      {modalCompra && cargo.compra_id && (
        <ModalCompraDetalle compraId={cargo.compra_id} onClose={() => setModalCompra(false)} />
      )}
    </div>
  );
}

// ─── cargo saldado (colapsable) ───────────────────────────────────────────────

function CargoSaldado({ cargo, acreedorId, esAdmin }) {
  const [expandido,   setExpandido]   = useState(false);
  const [modalCompra, setModalCompra] = useState(false);

  return (
    <div
      className="border border-green-100 rounded-2xl overflow-hidden bg-green-50/30"
      onDoubleClick={() => cargo.compra_id && setModalCompra(true)}
      title={cargo.compra_id ? 'Doble clic para ver detalle de la compra' : undefined}
    >
      <button
        onClick={() => setExpandido((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left
          hover:bg-green-50/60 transition-colors">
        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          <Badge variant="green">Saldada</Badge>
          {cargo.compra_id && (
            <span className="text-xs text-blue-400">
              Compra #{String(cargo.compra_numero ?? cargo.compra_id).padStart(5, '0')}
            </span>
          )}
          <span className="text-xs text-gray-600 font-medium truncate">
            {cargo.descripcion || 'Sin descripción'}
          </span>
          <span className="text-xs text-gray-400">{formatFechaHora(cargo.fecha)}</span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-sm font-bold text-gray-700">{formatCOP(cargo.valor_original)}</span>
          {expandido
            ? <ChevronUp size={14} className="text-gray-400" />
            : <ChevronDown size={14} className="text-gray-400" />}
        </div>
      </button>

      {expandido && (
        <div className="border-t border-dashed border-green-100 px-4 py-3 bg-white/60">
          {cargo.compra_id && (
            <button
              onClick={(e) => { e.stopPropagation(); setModalCompra(true); }}
              className="mb-2 text-xs text-blue-500 hover:text-blue-700 transition-colors">
              Ver productos de compra #{String(cargo.compra_numero ?? cargo.compra_id).padStart(5, '0')} →
            </button>
          )}
          <p className="text-xs font-semibold text-gray-500 mb-2">Historial de pagos</p>
          <AbonosHistorial acreedorId={acreedorId} cargoId={cargo.id} esAdmin={esAdmin} />
        </div>
      )}

      {modalCompra && cargo.compra_id && (
        <ModalCompraDetalle compraId={cargo.compra_id} onClose={() => setModalCompra(false)} />
      )}
    </div>
  );
}

// ─── vista detalle de acreedor ────────────────────────────────────────────────

const TABS_DETALLE = [
  { id: 'cargos', label: 'Cargos'           },
  { id: 'cuenta', label: 'Estado de cuenta' },
];

function DetalleAcreedor({ acreedor, esAdmin, onVolver, onEliminar }) {
  const [tabActivo,        setTabActivo]        = useState('cargos');
  const [cargoAbono,       setCargoAbono]       = useState(null);
  const [cargoAplicar,     setCargoAplicar]     = useState(null);
  const [movImprimir,      setMovImprimir]       = useState(null);
  const [modalCargo,       setModalCargo]       = useState(false);
  const [modalSaldoFavor,  setModalSaldoFavor]  = useState(false);
  const [modalAbonoTotal,  setModalAbonoTotal]  = useState(false);
  const [saldadasAbiertas, setSaldadasAbiertas] = useState(false);
  const [busquedaCargo,    setBusquedaCargo]    = useState('');
  const [filtroEstado,     setFiltroEstado]     = useState('todos');
  const [ordenCargos,      setOrdenCargos]      = useState('fecha_desc');
  const [exportandoPdf,    setExportandoPdf]    = useState(false);
  const [exportandoExcel,  setExportandoExcel]  = useState(false);
  const [menuPdf,          setMenuPdf]          = useState(false);

  const handleExportPdf = async (formato = 'estado') => {
    if (exportandoPdf) return;
    setMenuPdf(false);
    setExportandoPdf(true);
    try {
      const res = await exportarCuentaPdf(acreedor.id, formato);
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      const prefijo = formato === 'resumen' ? 'deuda' : 'cuenta';
      a.download = `${prefijo}_${acreedor.nombre.replace(/\s+/g, '_').toLowerCase()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silencioso — el servidor devuelve error estándar si falla
    } finally {
      setExportandoPdf(false);
    }
  };

  const handleExportExcel = async () => {
    if (exportandoExcel) return;
    setExportandoExcel(true);
    try {
      const res = await getHistorialAcreedor(acreedor.id);
      const movimientos = Array.isArray(res.data?.data) ? res.data.data : [];
      exportarCuentaAcreedorExcel({
        nombre:      acreedor.nombre,
        cedula:      acreedor.cedula,
        telefono:    acreedor.telefono,
        esProveedor: !!acreedor.proveedor_id,
        movimientos,
        cargos:      Array.isArray(data) ? data : [],
        saldoAFavor,
      });
    } catch {
      alert('No se pudo generar el Excel. Intenta de nuevo.');
    } finally {
      setExportandoExcel(false);
    }
  };

  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn:  () => getConfig().then((r) => r.data.data),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['compras-con-saldo', acreedor.id],
    queryFn:  () => getComprasConSaldo(acreedor.id).then((r) => r.data.data),
    staleTime: 0,
  });

  const { data: saldoFavorData } = useQuery({
    queryKey: ['saldo-a-favor', acreedor.id],
    queryFn:  () => getSaldoAFavor(acreedor.id).then((r) => r.data.data),
    staleTime: 0,
  });
  const saldoAFavor = Number(saldoFavorData ?? 0);

  const cargos   = Array.isArray(data) ? data : [];
  const activos  = cargos.filter((c) => c.estado_pago !== 'Saldada');
  const saldados = cargos.filter((c) => c.estado_pago === 'Saldada');
  const saldoTotal = activos.reduce((s, c) => s + Number(c.saldo_pendiente), 0);

  const cargosFiltrados = (() => {
    let lista = [...cargos];
    if (busquedaCargo.trim()) {
      const q = busquedaCargo.toLowerCase().trim();
      lista = lista.filter((c) =>
        (c.descripcion && c.descripcion.toLowerCase().includes(q)) ||
        (c.compra_id && String(c.compra_id).includes(q))
      );
    }
    if (filtroEstado !== 'todos') {
      lista = lista.filter((c) => c.estado_pago === filtroEstado);
    }
    lista.sort((a, b) => {
      if (ordenCargos === 'fecha_desc') return new Date(b.fecha) - new Date(a.fecha);
      if (ordenCargos === 'fecha_asc')  return new Date(a.fecha) - new Date(b.fecha);
      if (ordenCargos === 'monto_desc') return Number(b.valor_original) - Number(a.valor_original);
      if (ordenCargos === 'monto_asc')  return Number(a.valor_original) - Number(b.valor_original);
      return 0;
    });
    return lista;
  })();
  const activosFiltrados  = cargosFiltrados.filter((c) => c.estado_pago !== 'Saldada');
  const saldadosFiltrados = cargosFiltrados.filter((c) => c.estado_pago === 'Saldada');

  return (
    <div className="flex flex-col gap-4">
      {/* Volver */}
      <button onClick={onVolver}
        className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700
          w-fit transition-colors">
        <ChevronLeft size={16} /> Volver
      </button>

      {/* Cabecera del acreedor */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4
        flex flex-wrap items-center gap-3 shadow-sm">
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center
          text-base font-bold flex-shrink-0 select-none
          ${saldoTotal > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
          {acreedor.nombre.slice(0, 2).toUpperCase()}
        </div>

        <div className="flex-1 min-w-0 basis-32">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-gray-900 text-base leading-tight truncate">
              {acreedor.nombre}
            </p>
            {acreedor.proveedor_id && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full border leading-none
                ${acreedor.proveedor_tipo === 'cruce'
                  ? 'text-amber-700 bg-amber-50 border-amber-200'
                  : 'text-blue-500 bg-blue-50 border-blue-100'}`}>
                {acreedor.proveedor_tipo === 'cruce' ? 'Cruce' : 'Proveedor'}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">CC: {acreedor.cedula}</p>
          {acreedor.telefono && <p className="text-xs text-gray-400">Tel: {acreedor.telefono}</p>}
        </div>

        <div className="flex items-center gap-3 flex-shrink-0 ml-auto">
          {saldoAFavor > 0 && (
            <div className="text-right">
              <p className="text-xs text-emerald-500 leading-tight">Saldo a favor</p>
              <p className="text-sm font-bold text-emerald-600">{formatCOP(saldoAFavor)}</p>
            </div>
          )}
          {saldoTotal > 0 && (
            <div className="text-right">
              <p className="text-xs text-gray-400 leading-tight">Deuda total</p>
              <p className="text-sm font-bold text-red-500">{formatCOP(saldoTotal)}</p>
            </div>
          )}
          {saldoTotal === 0 && saldoAFavor === 0 && !isLoading && (
            <span className="text-xs font-semibold text-green-600 bg-green-50 border border-green-200
              px-2.5 py-1 rounded-full">
              ✓ Al día
            </span>
          )}
          {esAdmin && (
            <button onClick={() => onEliminar(acreedor)}
              className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
              title="Eliminar acreedor">
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
        {TABS_DETALLE.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTabActivo(id)}
            className={`flex-1 flex items-center justify-center px-3 py-2 rounded-lg
              text-xs font-semibold transition-all
              ${tabActivo === id
                ? 'bg-white text-gray-800 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Tab: Estado de cuenta */}
      {tabActivo === 'cuenta' && (
        <EstadoCuentaAcreedor acreedorId={acreedor.id} esAdmin={esAdmin} />
      )}

      {/* Tab: Cargos */}
      {tabActivo === 'cargos' && (isLoading ? (
        <div className="py-12 flex justify-center"><Spinner /></div>
      ) : (
        <>
          {/* Toolbar: stats + botones */}
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-gray-400">
              {activos.length} pendiente(s) · {saldados.length} saldada(s)
            </p>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {activos.length > 0 && (
                <button
                  onClick={() => setModalAbonoTotal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold
                    border border-indigo-200 bg-white text-indigo-600
                    hover:bg-indigo-50 transition-all">
                  <Layers size={13} /> Pago total
                </button>
              )}
              <button
                onClick={() => setModalSaldoFavor(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold
                  border border-emerald-200 bg-white text-emerald-600
                  hover:bg-emerald-50 transition-all">
                <Wallet size={13} /> Pago adelantado
              </button>
              <button
                onClick={() => setModalCargo(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold
                  border border-gray-200 bg-white text-gray-600
                  hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50 transition-all">
                <Plus size={13} /> Agregar cargo
              </button>
              <div className="relative">
                <button
                  onClick={() => setMenuPdf((v) => !v)}
                  disabled={exportandoPdf}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold
                    border border-gray-200 bg-white text-gray-600
                    hover:border-gray-400 hover:text-gray-800 hover:bg-gray-50 transition-all
                    disabled:opacity-50 disabled:cursor-not-allowed">
                  <FileDown size={13} /> {exportandoPdf ? 'Generando…' : 'PDF'}
                  <ChevronDown size={12} />
                </button>
                {menuPdf && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenuPdf(false)} />
                    <div className="absolute right-0 mt-1 z-20 bg-white border border-gray-200 rounded-xl
                      shadow-lg overflow-hidden w-44">
                      <button
                        onClick={() => handleExportPdf('estado')}
                        className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors">
                        Estado de cuenta
                      </button>
                      <button
                        onClick={() => handleExportPdf('resumen')}
                        className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors border-t border-gray-100">
                        Resumen de deuda
                      </button>
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={handleExportExcel}
                disabled={exportandoExcel}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold
                  border border-emerald-200 bg-white text-emerald-700
                  hover:border-emerald-400 hover:bg-emerald-50 transition-all
                  disabled:opacity-50 disabled:cursor-not-allowed">
                <FileSpreadsheet size={13} /> {exportandoExcel ? 'Generando…' : 'Excel'}
              </button>
            </div>
          </div>

          {/* Búsqueda + filtros + orden */}
          {cargos.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  <input
                    value={busquedaCargo}
                    onChange={(e) => setBusquedaCargo(e.target.value)}
                    placeholder="Buscar descripción o # compra..."
                    className="w-full pl-8 pr-3 py-2 bg-white border border-gray-200 rounded-xl
                      text-sm text-gray-700 placeholder-gray-400
                      focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <select
                  value={ordenCargos}
                  onChange={(e) => setOrdenCargos(e.target.value)}
                  className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs
                    text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 flex-shrink-0">
                  <option value="fecha_desc">Reciente primero</option>
                  <option value="fecha_asc">Antigua primero</option>
                  <option value="monto_desc">Mayor monto</option>
                  <option value="monto_asc">Menor monto</option>
                </select>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {[
                  { key: 'todos',     label: 'Todos' },
                  { key: 'Pendiente', label: `Pendiente (${cargos.filter((c) => c.estado_pago === 'Pendiente').length})` },
                  { key: 'Parcial',   label: `Parcial (${cargos.filter((c) => c.estado_pago === 'Parcial').length})` },
                  { key: 'Saldada',   label: `Saldada (${saldados.length})` },
                ].map(({ key, label }) => (
                  <button key={key} type="button" onClick={() => setFiltroEstado(key)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all
                      ${filtroEstado === key
                        ? key === 'Pendiente' ? 'bg-red-500 text-white border-red-500'
                          : key === 'Parcial' ? 'bg-amber-500 text-white border-amber-500'
                          : key === 'Saldada' ? 'bg-green-600 text-white border-green-600'
                          : 'bg-gray-800 text-white border-gray-800'
                        : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Cargos activos */}
          {activos.length === 0 ? (
            <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3 text-center">
              <p className="text-green-700 text-sm font-medium">✓ Sin compras pendientes</p>
            </div>
          ) : activosFiltrados.length === 0 && filtroEstado !== 'Saldada' ? (
            <div className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 text-center">
              <p className="text-gray-500 text-sm">Sin pendientes que coincidan con el filtro</p>
            </div>
          ) : activosFiltrados.length > 0 ? (
            <div className="flex flex-col gap-2.5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-0.5">
                Pendientes ({activosFiltrados.length})
              </p>
              {activosFiltrados.map((c) => (
                <CargoActivo
                  key={c.id}
                  cargo={c}
                  acreedorId={acreedor.id}
                  esAdmin={esAdmin}
                  saldoAFavor={saldoAFavor}
                  onAbonar={(cargo) => setCargoAbono(cargo)}
                  onAplicar={(cargo) => setCargoAplicar(cargo)}
                />
              ))}
            </div>
          ) : null}

          {/* Saldadas (colapsable) */}
          {saldados.length > 0 && (
            <div className="border border-gray-100 rounded-2xl overflow-hidden mt-1">
              <button
                onClick={() => setSaldadasAbiertas((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3
                  bg-gray-50 hover:bg-gray-100 transition-colors">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Historial saldadas
                  </span>
                  <span className="text-xs bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full">
                    {saldadosFiltrados.length}/{saldados.length}
                  </span>
                </div>
                {saldadasAbiertas
                  ? <ChevronUp size={15} className="text-gray-400" />
                  : <ChevronDown size={15} className="text-gray-400" />}
              </button>

              {saldadasAbiertas && (
                <div className="flex flex-col gap-2 p-3">
                  {saldadosFiltrados.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-2">Sin resultados para el filtro aplicado</p>
                  ) : (
                    saldadosFiltrados.map((c) => (
                      <CargoSaldado key={c.id} cargo={c} acreedorId={acreedor.id} esAdmin={esAdmin} />
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </>
      ))}

      {cargoAbono && (
        <ModalAbonoRapido
          acreedor={acreedor}
          cargo={cargoAbono}
          onClose={() => setCargoAbono(null)}
          onImprimir={(mov) => { setCargoAbono(null); setMovImprimir(mov); }}
        />
      )}

      {modalCargo && (
        <ModalNuevoCargo acreedor={acreedor} onClose={() => setModalCargo(false)} />
      )}

      {modalSaldoFavor && (
        <ModalSaldoAFavor acreedor={acreedor} onClose={() => setModalSaldoFavor(false)} />
      )}

      {modalAbonoTotal && (
        <ModalAbonoTotal
          acreedor={acreedor}
          cargos={activos}
          onClose={() => setModalAbonoTotal(false)}
        />
      )}

      {cargoAplicar && (
        <ModalAplicarSaldo
          acreedor={acreedor}
          cargo={cargoAplicar}
          saldoDisponible={saldoAFavor}
          onClose={() => setCargoAplicar(null)}
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

// ─── fila acreedor en la lista ────────────────────────────────────────────────

function FilaAcreedor({ acreedor, onClick }) {
  const saldo         = Number(acreedor.saldo || 0);
  const totalCargado  = Number(acreedor.total_cargado || 0);
  const totalAbonado  = Number(acreedor.total_abonado || 0);
  const pct           = totalCargado > 0 ? Math.min(100, (totalAbonado / totalCargado) * 100) : 0;
  const tieneDeuda    = saldo > 0;
  const { texto: pagoTexto, nivel: pagoNivel } = tiempoUltimoPago(acreedor.ultimo_pago);

  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3.5 bg-white border border-gray-100
        rounded-2xl text-left hover:border-blue-200 hover:bg-blue-50/20 hover:shadow-sm
        transition-all active:scale-[0.99]">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm
        flex-shrink-0 select-none
        ${tieneDeuda ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
        {acreedor.nombre.slice(0, 2).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-gray-900 truncate">{acreedor.nombre}</p>
          {tieneDeuda && (
            <span className="text-sm font-bold text-red-500 flex-shrink-0">{formatCOP(saldo)}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {acreedor.proveedor_id && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full border leading-none
              ${acreedor.proveedor_tipo === 'cruce'
                ? 'text-amber-700 bg-amber-50 border-amber-200'
                : 'text-blue-500 bg-blue-50 border-blue-100'}`}>
              {acreedor.proveedor_tipo === 'cruce' ? 'Cruce' : 'Proveedor'}
            </span>
          )}
          {!tieneDeuda && (
            <span className="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded-full font-medium">
              Al día
            </span>
          )}
          {tieneDeuda && (
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium flex items-center gap-1 ${PAGO_CLASES[pagoNivel]}`}>
              <Clock size={10} /> {pagoTexto}
            </span>
          )}
        </div>
        {tieneDeuda && totalCargado > 0 && (
          <div className="mt-2 w-full bg-gray-100 rounded-full h-1">
            <div className="bg-blue-400 h-1 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
    </button>
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
  const [acreedorSel, setAcreedorSel]  = useState(null);
  const [modalNuevo, setModalNuevo]    = useState(false);
  const [acreedorEliminar, setEliminar] = useState(null);
  const queryClient                     = useQueryClient();

  const mutEliminar = useMutation({
    mutationFn: () => eliminarAcreedor(acreedorEliminar.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['acreedores'], exact: false });
      setEliminar(null);
      setAcreedorSel(null);
    },
    onError: (err) => {
      setEliminar(null);
      alert(err.response?.data?.error || 'No se puede eliminar este acreedor');
    },
  });

  const { data: acreedoresData, isLoading } = useQuery({
    queryKey: ['acreedores', busqueda],
    queryFn:  () => getAcreedores(busqueda).then((r) => r.data.data),
  });
  const acreedores = Array.isArray(acreedoresData) ? acreedoresData : [];

  return (
    <>
      {!acreedorSel ? (
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
              descripcion={esAdmin
                ? 'Crea el primer acreedor con el botón +'
                : 'Sin acreedores asignados'} />
          ) : (
            <div className="flex flex-col gap-2">
              {acreedores.map((a) => (
                <FilaAcreedor key={a.id} acreedor={a} onClick={() => setAcreedorSel(a)} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <DetalleAcreedor
          key={acreedorSel.id}
          acreedor={acreedorSel}
          esAdmin={esAdmin}
          onVolver={() => setAcreedorSel(null)}
          onEliminar={(a) => setEliminar(a)}
        />
      )}

      {modalNuevo && <ModalNuevoAcreedor onClose={() => setModalNuevo(false)} />}

      {acreedorEliminar && (
        <ModalEliminarAcreedor
          acreedor={acreedorEliminar}
          onClose={() => setEliminar(null)}
          onEliminar={() => mutEliminar.mutate()}
        />
      )}
    </>
  );
}
