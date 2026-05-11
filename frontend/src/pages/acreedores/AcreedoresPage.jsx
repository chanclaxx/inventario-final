import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAcreedores, getAcreedorById, getCargosAbiertos, crearAcreedor, registrarMovimiento, eliminarAcreedor } from '../../api/acreedores.api';
import { getConfig, verificarPin } from '../../api/config.api';
import { formatCOP, formatFechaHora } from '../../utils/formatters';
import { useAuth }     from '../../context/useAuth';
import { Button }      from '../../components/ui/Button';
import { Input }       from '../../components/ui/Input';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { useMetodosPago } from '../../hooks/useMetodosPago';
import { Modal }       from '../../components/ui/Modal';
import { Badge }       from '../../components/ui/Badge';
import { Spinner }     from '../../components/ui/Spinner';
import { EmptyState }  from '../../components/ui/EmptyState';
import { SearchInput } from '../../components/ui/SearchInput';
import { ReciboAcreedor } from '../../components/Reciboacreedor';
import { Users, Plus, ChevronRight, ChevronLeft, ChevronUp, PenLine, Printer, Trash2, AlertTriangle, Calculator } from 'lucide-react';
import api from '../../api/axios.config';
import { getCompraById } from '../../api/compras.api';

// ─────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────
const normalizarProductos = (data) => {
  if (Array.isArray(data)) return data;
  if (data?.items && Array.isArray(data.items)) return data.items;
  return [];
};

const PAGE_SIZE = 10;

// ─────────────────────────────────────────────
// CALCULADORA
// ─────────────────────────────────────────────
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
  const [display,    setDisplay]    = useState('0');
  const [prevVal,    setPrevVal]    = useState(null);
  const [op,         setOp]         = useState(null);
  const [esperando,  setEsperando]  = useState(false);
  const [historial,  setHistorial]  = useState('');

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
      setDisplay(fmtNum(res));
      setHistorial(`${fmtNum(res)} ${o}`);
      setPrevVal(res);
    } else {
      setHistorial(`${display} ${o}`);
      setPrevVal(val);
    }
    setOp(o);
    setEsperando(true);
  };

  const igual = () => {
    if (prevVal === null || op === null) return;
    const val = parseFloat(display);
    const res = calcOp(prevVal, val, op);
    setHistorial(`${historial} ${display} =`);
    setDisplay(fmtNum(res));
    setPrevVal(null); setOp(null); setEsperando(true);
  };

  const limpiar = () => {
    setDisplay('0'); setPrevVal(null); setOp(null); setEsperando(false); setHistorial('');
  };

  const borrar = () => {
    if (esperando) return;
    setDisplay(display.length > 1 ? display.slice(0, -1) : '0');
  };

  return (
    <div className="flex flex-col gap-2 bg-gray-50 border border-gray-200 rounded-2xl p-3">
      {/* Display */}
      <div className="bg-gray-900 rounded-xl px-3 py-2.5 flex flex-col items-end gap-0.5">
        <p className="text-gray-500 text-xs h-4 tabular-nums truncate w-full text-right">{historial}</p>
        <p className="text-white text-2xl font-mono tabular-nums leading-tight">
          {Number(display).toLocaleString('es-CO')}
        </p>
      </div>

      {/* Teclado */}
      <div className="grid grid-cols-4 gap-1.5">
        <CalcBtn ch="C"  onClick={limpiar}            wide />
        <CalcBtn ch="⌫"  onClick={borrar} />
        <CalcBtn ch="÷"  onClick={() => presOp('÷')}  accent active={op === '÷' && esperando} />

        {[7, 8, 9].map((n) => <CalcBtn key={n} ch={String(n)} onClick={() => presNum(n)} />)}
        <CalcBtn ch="×"  onClick={() => presOp('×')}  accent active={op === '×' && esperando} />

        {[4, 5, 6].map((n) => <CalcBtn key={n} ch={String(n)} onClick={() => presNum(n)} />)}
        <CalcBtn ch="−"  onClick={() => presOp('-')}  accent active={op === '-' && esperando} />

        {[1, 2, 3].map((n) => <CalcBtn key={n} ch={String(n)} onClick={() => presNum(n)} />)}
        <CalcBtn ch="+"  onClick={() => presOp('+')}  accent active={op === '+' && esperando} />

        <CalcBtn ch="0"  onClick={() => presNum(0)}   wide />
        <CalcBtn ch="."  onClick={presDecimal} />
        <CalcBtn ch="="  onClick={igual} />
      </div>

      <Button size="sm" className="w-full" onClick={() => onUsar(display)}
        disabled={display === '0'}>
        Usar {formatCOP(Math.round(Number(display) || 0))}
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────
// DETALLE EXPANDIBLE DE COMPRA
// ─────────────────────────────────────────────
function DetalleCompraInline({ compraId }) {
  const [expandido, setExpandido] = useState(false);

  const { data: compra, isLoading } = useQuery({
    queryKey: ['compra-detalle', compraId],
    queryFn:  () => getCompraById(compraId).then((r) => r.data.data),
    enabled:  expandido && !!compraId,
  });

  return (
    <div className="mt-2">
      <button onClick={() => setExpandido((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-700 font-medium transition-colors">
        {expandido ? <ChevronUp size={13} /> : <ChevronRight size={13} />}
        {expandido ? 'Ocultar compra' : `Ver compra #${String(compraId).padStart(6, '0')}`}
      </button>

      {expandido && (
        <div className="mt-2 bg-amber-50 border border-amber-100 rounded-xl p-3 flex flex-col gap-2">
          {isLoading ? (
            <Spinner className="py-4" />
          ) : !compra ? (
            <p className="text-xs text-gray-400">No se pudo cargar la compra</p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-amber-700">Compra #{String(compra.id).padStart(6, '0')}</p>
                <span className="text-xs text-gray-400">{formatFechaHora(compra.fecha)}</span>
              </div>
              {compra.proveedor_nombre && (
                <p className="text-xs text-gray-600">Proveedor: <span className="font-medium">{compra.proveedor_nombre}</span></p>
              )}
              <div className="flex flex-col gap-1.5 mt-1">
                {compra.lineas?.map((l) => (
                  <div key={l.id} className="flex items-start justify-between text-xs gap-2 bg-white rounded-lg px-2.5 py-2 border border-amber-100">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800 truncate">{l.nombre_producto}</p>
                      {l.imei && <p className="text-gray-400 font-mono">{l.imei}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-gray-500">{l.cantidad} × {formatCOP(l.precio_unitario)}</p>
                      <p className="font-semibold text-gray-800">{formatCOP(l.cantidad * l.precio_unitario)}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-center border-t border-amber-200 pt-2 mt-1">
                <span className="text-xs text-gray-500">Total compra</span>
                <span className="text-sm font-bold text-amber-700">{formatCOP(compra.total)}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// MODAL DETALLE COMPRA (desde doble-click en movimiento)
// ─────────────────────────────────────────────
function ModalCompraDetalle({ compraId, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['compra-detalle', compraId],
    queryFn:  () => getCompraById(compraId).then((r) => r.data.data),
    enabled:  !!compraId,
  });
  const esCredito = ['Credito', 'Fiado'].includes(data?.metodo);

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
              <Badge variant={data?.estado === 'Completada' ? 'green' : data?.estado === 'Pendiente' ? 'yellow' : 'red'}>
                {data?.estado}
              </Badge>
            </div>
            {data?.proveedor_nombre && (
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400 mb-0.5">Proveedor</p>
                <p className="text-sm font-medium text-gray-800">{data.proveedor_nombre}</p>
              </div>
            )}
            {data?.numero_factura && (
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400 mb-0.5">N° Factura proveedor</p>
                <p className="text-sm font-medium text-gray-800">{data.numero_factura}</p>
              </div>
            )}
            {data?.metodo && (
              <div className={`col-span-2 rounded-xl p-3 ${esCredito ? 'bg-amber-50' : 'bg-green-50'}`}>
                <p className={`text-xs mb-1 ${esCredito ? 'text-amber-500' : 'text-green-500'}`}>Forma de pago</p>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-semibold ${esCredito ? 'text-amber-700' : 'text-green-700'}`}>
                    {data.metodo}
                  </span>
                  <span className="text-xs text-gray-400">·</span>
                  <span className="text-xs text-gray-500">
                    {data.registrar_en_caja ? 'Registrado en caja' : 'No afectó caja (crédito)'}
                  </span>
                </div>
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

// ─────────────────────────────────────────────
// MODAL MOVIMIENTO (con checkbox registrar en caja)
// ─────────────────────────────────────────────
function ModalMovimiento({ acreedor, proveedorTipo, onClose, onImprimir }) {
  const queryClient               = useQueryClient();
  const [form,  setForm]          = useState({ tipo: 'Cargo', descripcion: '', valor: '' });
  const [registrarEnCaja, setRegistrarEnCaja] = useState(proveedorTipo !== 'proveedor');
  const [mostrarCalc, setMostrarCalc]         = useState(false);
  const [cargoId, setCargoId]     = useState(null);
  const [error, setError]         = useState('');
  const metodosPago = useMetodosPago();
  const [metodoPago, setMetodoPago] = useState('Efectivo');

  const esAbono       = form.tipo === 'Abono';
  const esProveedor   = proveedorTipo === 'proveedor';
  const mostrarCheckbox = esProveedor;

  const { data: cargosRaw, isLoading: loadingCargos } = useQuery({
    queryKey:  ['cargos-abiertos', acreedor.id],
    queryFn:   () => getCargosAbiertos(acreedor.id).then((r) => r.data.data),
    enabled:   esAbono,
    staleTime: 0,
  });
  const cargosAbiertos = Array.isArray(cargosRaw) ? cargosRaw : [];

  const mutation = useMutation({
    mutationFn: () => registrarMovimiento(acreedor.id, {
      tipo:              form.tipo,
      descripcion:       form.descripcion,
      valor:             Number(form.valor),
      registrar_en_caja: esAbono ? registrarEnCaja : false,
      metodo:            metodoPago,
      cargo_id:          esAbono ? cargoId : null,
    }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['acreedor',        acreedor.id], exact: false });
      queryClient.invalidateQueries({ queryKey: ['cargos-abiertos', acreedor.id], exact: false });
      queryClient.invalidateQueries({ queryKey: ['acreedores'],                   exact: false });
      const mov = data?.data?.data ?? null;
      onImprimir(mov);
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al registrar'),
  });

  const handleKeyDown = (e, siguienteId) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (siguienteId) document.getElementById(siguienteId)?.focus();
    }
  };

  return (
    <Modal open onClose={onClose} title={`Movimiento — ${acreedor.nombre}`} size="md">
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          {['Cargo', 'Abono'].map((t) => (
            <button key={t}
              onClick={() => {
                setForm({ ...form, tipo: t });
                setCargoId(null);
                if (t === 'Cargo') setRegistrarEnCaja(false);
                if (t === 'Abono') setRegistrarEnCaja(proveedorTipo !== 'proveedor');
              }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all
                ${form.tipo === t
                  ? t === 'Cargo'
                    ? 'bg-red-50 border-red-300 text-red-700'
                    : 'bg-green-50 border-green-300 text-green-700'
                  : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
              {t}
            </button>
          ))}
        </div>

        <Input id="descripcion-mov" label="Descripción" placeholder="Ej: Compra mercancía"
          value={form.descripcion}
          onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
          onKeyDown={(e) => handleKeyDown(e, 'valor-acreedor')} />

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">Valor</label>
            <button type="button" onClick={() => setMostrarCalc((v) => !v)}
              className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 transition-colors">
              <Calculator size={12} />
              {mostrarCalc ? 'Cerrar' : 'Calculadora'}
            </button>
          </div>
          <InputMoneda id="valor-acreedor" value={form.valor}
            onChange={(val) => setForm({ ...form, valor: val })} placeholder="0"
            className="w-full px-3 py-2 bg-gray-100 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all" />
        </div>

        {mostrarCalc && (
          <Calculadora onUsar={(val) => {
            setForm((f) => ({ ...f, valor: String(Math.round(Number(val) || 0)) }));
            setMostrarCalc(false);
          }} />
        )}

        {esAbono && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-gray-700">
              Aplicar a cargo pendiente <span className="text-xs font-normal text-gray-400">(opcional)</span>
            </p>
            {loadingCargos ? (
              <Spinner className="py-3" />
            ) : cargosAbiertos.length === 0 ? (
              <p className="text-xs text-gray-400 bg-gray-50 rounded-xl px-3 py-2">
                No hay cargos pendientes sin saldar
              </p>
            ) : (
              <div className="flex flex-col gap-1.5 max-h-44 overflow-y-auto pr-0.5">
                {cargosAbiertos.map((c) => {
                  const seleccionado = cargoId === c.id;
                  return (
                    <button key={c.id} type="button"
                      onClick={() => setCargoId(seleccionado ? null : c.id)}
                      className={`flex items-start justify-between gap-3 text-left px-3 py-2.5 rounded-xl border transition-all
                        ${seleccionado
                          ? 'bg-green-50 border-green-300'
                          : 'bg-gray-50 border-gray-200 hover:border-gray-300'}`}>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-medium truncate ${seleccionado ? 'text-green-800' : 'text-gray-700'}`}>
                          {c.descripcion || 'Sin descripción'}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">{formatFechaHora(c.fecha)}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs text-gray-400 line-through">{formatCOP(c.valor_original)}</p>
                        <p className={`text-xs font-bold ${seleccionado ? 'text-green-700' : 'text-red-500'}`}>
                          Pendiente: {formatCOP(c.saldo_pendiente)}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {mostrarCheckbox && esAbono && (
          <div className={`rounded-xl p-3 border transition-all
            ${registrarEnCaja ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'}`}>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={registrarEnCaja}
                onChange={(e) => setRegistrarEnCaja(e.target.checked)}
                className="rounded accent-blue-600 w-4 h-4 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-gray-700">Registrar en caja</p>
                <p className="text-xs text-gray-400">Si no se marca, el abono no aparecerá en el resumen de caja</p>
              </div>
            </label>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Método de pago</label>
          <div className="flex gap-2 flex-wrap">
            {metodosPago.map((m) => {
              const mId    = m.id;
              const mLabel = m.label;
              return (
                <button key={mId} type="button" onClick={() => setMetodoPago(mId)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all
                    ${metodoPago === mId
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                  {mLabel}
                </button>
              );
            })}
          </div>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Registrar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────
// MODAL NUEVO ACREEDOR
// ─────────────────────────────────────────────
function ModalNuevoAcreedor({ onClose }) {
  const queryClient                  = useQueryClient();
  const [form, setForm]              = useState({ nombre: '', cedula: '', telefono: '' });
  const [proveedorId, setProveedorId] = useState('');
  const [error, setError]            = useState('');

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
      const acreedorExistente = acreedores.find((a) => String(a.proveedor_id) === id);
      setError(`Este proveedor ya está vinculado al acreedor "${acreedorExistente.nombre}"`);
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

  const handleKeyDown = (e, siguienteId) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (siguienteId) document.getElementById(siguienteId)?.focus();
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

// ─────────────────────────────────────────────
// LISTA DE ACREEDORES
// ─────────────────────────────────────────────
function ListaAcreedores({ acreedores, acreedorSel, isLoading, busqueda, setBusqueda, onSeleccionar, onNuevo, esAdmin }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <SearchInput value={busqueda} onChange={setBusqueda} placeholder="Buscar acreedor..." />
        {esAdmin && (
          <button onClick={onNuevo}
            className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center flex-shrink-0 hover:bg-blue-700 transition-colors">
            <Plus size={18} className="text-white" />
          </button>
        )}
      </div>
      {isLoading ? (
        <Spinner className="py-10" />
      ) : (
        <div className="flex flex-col gap-1 overflow-y-auto max-h-[65vh]">
          {acreedores.length === 0 ? (
            <EmptyState icon={Users} titulo="Sin acreedores"
              descripcion={esAdmin ? undefined : 'No hay acreedores vinculados a cruces'} />
          ) : (
            acreedores.map((a) => {
              const saldo = Number(a.saldo || 0);
              return (
                <button key={a.id} onClick={() => onSeleccionar(a)}
                  className={`flex items-center justify-between p-3 rounded-xl text-left transition-all border
                    ${acreedorSel?.id === a.id
                      ? 'bg-blue-50 border-blue-200 text-blue-700'
                      : 'bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50'}`}>
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-medium text-gray-800">{a.nombre}</p>
                      {a.proveedor_id && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full leading-none border
                          ${a.proveedor_tipo === 'cruce'
                            ? 'text-amber-700 bg-amber-50 border-amber-200'
                            : 'text-blue-500 bg-blue-50 border-blue-100'}`}>
                          {a.proveedor_tipo === 'cruce' ? 'Cruce' : 'Proveedor'}
                        </span>
                      )}
                    </div>
                    <p className={`text-xs font-semibold mt-0.5 ${saldo > 0 ? 'text-red-500' : 'text-green-600'}`}>
                      {saldo > 0 ? `Debemos: ${formatCOP(saldo)}` : 'Al día'}
                    </p>
                  </div>
                  <ChevronRight size={16} className="text-gray-300" />
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// MODAL ELIMINAR ACREEDOR
// ─────────────────────────────────────────────
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
            Se eliminarán permanentemente todos los datos de este acreedor. Esta operación no se puede revertir.
          </p>
        </div>

        <Input label="PIN de administrador" type="password" placeholder="••••"
          value={pin} onChange={(e) => { setPin(e.target.value); setError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmar(); }} autoFocus />

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose}
            className="flex-1 py-2 rounded-xl text-sm font-medium border border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100 transition-colors">
            Cancelar
          </button>
          <Button className="flex-1 bg-red-600 hover:bg-red-700 text-white" loading={verificando} onClick={handleConfirmar}>
            <Trash2 size={14} /> Eliminar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────
// DETALLE ACREEDOR
// ─────────────────────────────────────────────
function DetalleAcreedor({ detalle, loadingDetalle, movimientosUI, onRegistrar, onImprimir, onVolver, onEliminar, esAdmin }) {
  const [pagina,        setPagina]        = useState(1);
  const [fechaDesde,    setFechaDesde]    = useState('');
  const [fechaHasta,    setFechaHasta]    = useState('');
  const [compraModal,   setCompraModal]   = useState(null);

  if (loadingDetalle) return <Spinner className="py-20" />;

  const movsFiltrados = movimientosUI.filter((m) => {
    const f = m.fecha ? m.fecha.slice(0, 10) : '';
    if (fechaDesde && f < fechaDesde) return false;
    if (fechaHasta && f > fechaHasta) return false;
    return true;
  });

  const totalPaginas = Math.ceil(movsFiltrados.length / PAGE_SIZE);
  const movsPagina   = movsFiltrados.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onVolver}
        className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 transition-colors lg:hidden w-fit">
        <ChevronLeft size={16} /> Volver a lista
      </button>

      <div className="bg-white border border-gray-100 rounded-2xl p-4 flex items-start justify-between shadow-sm">
        <div>
          <h2 className="font-bold text-gray-900">{detalle?.nombre}</h2>
          <p className="text-xs text-gray-400">CC: {detalle?.cedula} · {detalle?.telefono}</p>
          <p className={`text-lg font-bold mt-2 ${Number(detalle?.saldo) > 0 ? 'text-red-500' : 'text-green-600'}`}>
            {Number(detalle?.saldo) > 0 ? `Debemos: ${formatCOP(detalle?.saldo)}` : 'Sin deuda'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={onRegistrar}><PenLine size={16} /> Registrar</Button>
          {esAdmin && (
            <button onClick={onEliminar}
              className="p-2 rounded-xl border border-dashed border-red-200 text-red-400
                hover:text-red-600 hover:bg-red-50 hover:border-red-300 transition-colors"
              title="Eliminar acreedor">
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Filtros de fecha */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-500">Desde</label>
          <input
            type="date"
            value={fechaDesde}
            onChange={(e) => { setFechaDesde(e.target.value); setPagina(1); }}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-500">Hasta</label>
          <input
            type="date"
            value={fechaHasta}
            onChange={(e) => { setFechaHasta(e.target.value); setPagina(1); }}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300"
          />
        </div>
        {(fechaDesde || fechaHasta) && (
          <button
            onClick={() => { setFechaDesde(''); setFechaHasta(''); setPagina(1); }}
            className="text-xs text-gray-400 hover:text-gray-600 underline">
            Limpiar
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-gray-600">
          Historial {movsFiltrados.length !== movimientosUI.length && `(${movsFiltrados.length} de ${movimientosUI.length})`}
        </h3>
        {movsFiltrados.length === 0 ? (
          <EmptyState icon={PenLine} titulo="Sin movimientos" descripcion={movimientosUI.length > 0 ? 'Ningún movimiento en ese rango de fechas' : undefined} />
        ) : (
          <>
            {movsPagina.map((m) => (
              <div
                key={m.id}
                onDoubleClick={() => m.compra_id && setCompraModal(m.compra_id)}
                className={`bg-white border border-gray-100 rounded-xl p-3 flex items-start justify-between gap-3 ${m.compra_id ? 'cursor-pointer hover:border-blue-200 hover:shadow-sm transition-all' : ''}`}
                title={m.compra_id ? 'Doble clic para ver detalle de compra' : undefined}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={m.tipo === 'Cargo' ? 'red' : 'green'}>{m.tipo}</Badge>
                    <span className="text-sm text-gray-700">{m.descripcion}</span>
                    {m.registrar_en_caja === false && (
                      <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">Sin caja</span>
                    )}
                    {m.compra_id && (
                      <span className="text-xs text-blue-400 bg-blue-50 px-1.5 py-0.5 rounded">Compra #{m.compra_id}</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{formatFechaHora(m.fecha)}</p>
                  <div className="flex items-center gap-1 mt-1 text-xs text-gray-400">
                    <span>{formatCOP(m.saldo_antes)}</span>
                    <span>→</span>
                    <span className="font-semibold text-gray-600">{formatCOP(m.saldo_despues)}</span>
                  </div>
                  {m.tipo === 'Abono' && m.cargo_id && (
                    <p className="text-xs text-green-700 bg-green-50 border border-green-100 rounded-lg px-2 py-1 mt-1.5">
                      → Abono a: <span className="font-medium">{m.cargo_descripcion || `Cargo #${m.cargo_id}`}</span>
                    </p>
                  )}
                  {m.firma && <img src={m.firma} alt="firma" className="mt-2 h-12 border border-gray-100 rounded-lg" />}
                </div>
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <span className={`text-sm font-bold ${m.tipo === 'Cargo' ? 'text-red-500' : 'text-green-600'}`}>
                    {m.tipo === 'Cargo' ? '+' : '-'}{formatCOP(m.valor)}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {m.compra_id && (
                      <button
                        onClick={() => setCompraModal(m.compra_id)}
                        className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-600 transition-colors"
                        title="Ver compra">
                        <ChevronRight size={14} />
                      </button>
                    )}
                    <button onClick={() => onImprimir(m)}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600 transition-colors"
                      title="Imprimir recibo">
                      <Printer size={14} />
                      <span className="hidden sm:inline">Recibo</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {totalPaginas > 1 && (
              <div className="flex items-center justify-center gap-3 pt-1">
                <button
                  disabled={pagina === 1}
                  onClick={() => setPagina((p) => p - 1)}
                  className="p-1.5 rounded-lg border border-gray-200 disabled:opacity-30 hover:bg-gray-50 transition-colors">
                  <ChevronLeft size={15} />
                </button>
                <span className="text-xs text-gray-500 tabular-nums">{pagina} / {totalPaginas}</span>
                <button
                  disabled={pagina === totalPaginas}
                  onClick={() => setPagina((p) => p + 1)}
                  className="p-1.5 rounded-lg border border-gray-200 disabled:opacity-30 hover:bg-gray-50 transition-colors">
                  <ChevronRight size={15} />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {compraModal && (
        <ModalCompraDetalle compraId={compraModal} onClose={() => setCompraModal(null)} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// PÁGINA PRINCIPAL
// ─────────────────────────────────────────────
export default function AcreedoresPage() {
  const { esAdminNegocio } = useAuth();
  const esAdmin            = esAdminNegocio();

  const [busqueda,      setBusqueda]      = useState('');
  const [acreedorSel,   setAcreedorSel]   = useState(null);
  const [modalMov,      setModalMov]      = useState(false);
  const [modalNuevo,    setModalNuevo]    = useState(false);
  const [movImprimir,   setMovImprimir]   = useState(null);
  const [modalEliminar, setModalEliminar] = useState(false);

  const queryClient = useQueryClient();

  const mutEliminar = useMutation({
    mutationFn: () => eliminarAcreedor(acreedorSel.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['acreedores'], exact: false });
      setModalEliminar(false);
      setAcreedorSel(null);
    },
    onError: (err) => {
      setModalEliminar(false);
      alert(err.response?.data?.error || 'No se puede eliminar este acreedor');
    },
  });

  // Admin ve todos los acreedores, supervisor ve solo los de cruces
  const { data: acreedoresData, isLoading } = useQuery({
    queryKey: esAdmin ? ['acreedores', busqueda] : ['acreedores-cruces', busqueda],
    queryFn:  () => esAdmin
      ? getAcreedores(busqueda).then((r) => r.data.data)
      : api.get('/acreedores/cruces', { params: { filtro: busqueda || undefined } }).then((r) => r.data.data),
  });

  const { data: detalle, isLoading: loadingDetalle } = useQuery({
    queryKey: ['acreedor', acreedorSel?.id],
    queryFn:  () => getAcreedorById(acreedorSel.id).then((r) => r.data.data),
    enabled:  !!acreedorSel,
  });

  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn:  () => getConfig().then((r) => r.data.data),
  });

  const acreedores    = acreedoresData || [];
  const movimientosUI = detalle?.movimientos ? [...detalle.movimientos].reverse() : [];

  const handleSeleccionar = (a) => setAcreedorSel(a);
  const handleVolver      = () => setAcreedorSel(null);
  const handleImprimir    = (mov) => { setModalMov(false); setMovImprimir(mov); };

  const listaProps = {
    acreedores, acreedorSel, isLoading, busqueda, setBusqueda, esAdmin,
    onSeleccionar: handleSeleccionar,
    onNuevo: () => setModalNuevo(true),
  };

  const detalleProps = {
    detalle, loadingDetalle, movimientosUI, esAdmin,
    onRegistrar: () => setModalMov(true),
    onImprimir:  handleImprimir,
    onVolver:    handleVolver,
    onEliminar:  () => setModalEliminar(true),
  };

  return (
    <>
      <div className="hidden lg:flex gap-4">
        <div className="w-64 flex-shrink-0">
          <ListaAcreedores {...listaProps} />
        </div>
        <div className="flex-1">
          {!acreedorSel ? (
            <EmptyState icon={Users} titulo="Selecciona un acreedor"
              descripcion="Elige un acreedor para ver su historial" />
          ) : (
            <DetalleAcreedor key={acreedorSel.id} {...detalleProps} />
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:hidden">
        {!acreedorSel ? (
          <ListaAcreedores {...listaProps} />
        ) : (
          <DetalleAcreedor key={acreedorSel.id} {...detalleProps} />
        )}
      </div>

      {modalMov && acreedorSel && (
        <ModalMovimiento
          acreedor={acreedorSel}
          proveedorTipo={esAdmin ? 'proveedor' : 'cruce'}
          onClose={() => setModalMov(false)}
          onImprimir={handleImprimir}
        />
      )}
      {modalNuevo && <ModalNuevoAcreedor onClose={() => setModalNuevo(false)} />}
      {modalEliminar && acreedorSel && (
        <ModalEliminarAcreedor acreedor={acreedorSel} onClose={() => setModalEliminar(false)} onEliminar={() => mutEliminar.mutate()} />
      )}
      {movImprimir && detalle && (
        <ReciboAcreedor acreedor={detalle} movimiento={movImprimir} config={configData} onClose={() => setMovImprimir(null)} />
      )}
    </>
  );
}