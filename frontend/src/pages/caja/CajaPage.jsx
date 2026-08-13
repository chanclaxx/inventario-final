import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getCajaActiva, abrirCaja, cerrarCaja,
  registrarMovimiento, getResumenDia, toggleMovimiento, getHistorialCajas,
} from '../../api/caja.api';
import { formatCOP, formatFecha, formatFechaHora } from '../../utils/formatters';
import { Button }     from '../../components/ui/Button';
import { Input }      from '../../components/ui/Input';
import { Modal }      from '../../components/ui/Modal';
import { Badge }      from '../../components/ui/Badge';
import { Spinner }    from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { useSucursalKey }  from '../../hooks/useSucursalKey';
import { useMetodosPago }  from '../../hooks/useMetodosPago';
import {
  Wallet, Plus, Lock, ChevronDown, ChevronUp,
  ShoppingCart, CreditCard, ArrowDownCircle, ArrowUpCircle,
  Receipt, Sliders, RefreshCw, Bike, Ban, RotateCcw, Wrench,
  History, CalendarDays, CheckCircle2, AlertTriangle,
} from 'lucide-react';

const METODOS_PAGO_ORDEN = ['Efectivo', 'Nequi', 'Daviplata', 'Transferencia', 'Tarjeta'];

// ─── Helper: nombre visible según rol y tipo_proveedor ───────────────────────
// Admin ve todo. Supervisores ven nombre solo si es cruce; proveedores → "Proveedor".
function nombreVisible(nombreReal, tipoProveedor, esAdmin) {
  if (esAdmin) return nombreReal || 'Proveedor';
  if (tipoProveedor === 'cruce') return nombreReal || 'Cruce';
  return 'Proveedor';
}

// ─── Helper: cómo se lee un ingreso de préstamos en el arqueo ────────────────
// La lista mezcla dos cosas: el abono a UN préstamo y el pago total, que no
// tiene préstamo porque se repartió entre varios (por eso venía como
// "Préstamo #null"). El pago total puede traer la descripción que escribió
// quien lo registró.
function etiquetaAbonoPrestamo(item) {
  const base = item.prestamo_id || item.prestamo_numero
    ? `Préstamo #${String(item.prestamo_numero ?? item.prestamo_id).padStart(4, '0')} — ${item.prestatario}`
    : `Pago total — ${item.prestatario}`;
  return item.descripcion ? `${base} · ${item.descripcion}` : base;
}

const CONFIG_GRUPOS = {
  facturas: {
    icono:      Receipt,
    color:      'green',
    bgHeader:   'bg-green-50',
    textHeader: 'text-green-700',
    borderColor:'border-green-100',
    renderItem: (item) => ({
      descripcion: `Factura #${String(item.factura_numero ?? item.factura_id).padStart(6, '0')} — ${item.nombre_cliente}`,
      detalle:     [item.productos, item.metodo].filter(Boolean).join(' · ') || null,
      fecha:       item.fecha,
    }),
  },
  abonosCredito: {
    icono:      CreditCard,
    color:      'blue',
    bgHeader:   'bg-blue-50',
    textHeader: 'text-blue-700',
    borderColor:'border-blue-100',
    renderItem: (item) => ({
      descripcion: `Crédito Factura #${String(item.factura_numero ?? item.factura_id).padStart(6, '0')} — ${item.nombre_cliente}`,
      detalle:     [item.productos, item.metodo].filter(Boolean).join(' · ') || null,
      fecha:       item.fecha,
    }),
  },
 abonosPrestamo: {
  icono:      ArrowDownCircle,
  color:      'purple',
  bgHeader:   'bg-purple-50',
  textHeader: 'text-purple-700',
  borderColor:'border-purple-100',
  renderItem: (item) => ({
    descripcion: etiquetaAbonoPrestamo(item),
    detalle:     item.metodo || null,
    fecha:       item.fecha,
  }),
},
  abonosServicio: {
  icono:      Wrench,
  color:      'blue',
  bgHeader:   'bg-blue-50',
  textHeader: 'text-blue-700',
  borderColor:'border-blue-100',
  renderItem: (item) => {
    const equipo   = item.equipo_nombre || item.equipo_tipo || '';
    const cliente  = item.cliente_nombre || '';
    const ordenNum = item.orden_id ? `#OS-${String(item.orden_numero ?? item.orden_id).padStart(4, '0')}` : '';
    const partes   = [ordenNum, equipo, cliente].filter(Boolean).join(' — ');
    return {
      descripcion: partes || item.concepto || 'Servicio técnico',
      detalle:     item.metodo || null,   // ← agregar método
      fecha:       item.fecha,
      };
    },
  },
  retomas: {
    icono:      RefreshCw,
    color:      'orange',
    bgHeader:   'bg-orange-50',
    textHeader: 'text-orange-700',
    borderColor:'border-orange-100',
    renderItem: (item) => ({
      descripcion: item.factura_id
        ? `Retoma — Factura #${String(item.factura_numero ?? item.factura_id).padStart(6, '0')} · ${item.nombre_cliente || ''}`
        : (item.descripcion || item.nombre_producto || 'Retoma'),
      detalle: item.imei
        ? `IMEI: ${item.imei}`
        : (item.nombre_producto || item.descripcion || null),
      fecha: item.fecha,
    }),
  },
  devoluciones: {
    icono:      RefreshCw,
    color:      'red',
    bgHeader:   'bg-red-50',
    textHeader: 'text-red-700',
    borderColor:'border-red-100',
    renderItem: (item) => ({
      descripcion: item.referencia_id
        ? `Dev. Factura #${String(item.referencia_id).padStart(6, '0')}${item.concepto ? ` — ${item.concepto}` : ''}`
        : (item.concepto || 'Devolución'),
      detalle:     item.usuario_nombre || null,
      fecha:       item.fecha,
    }),
  },
  compras: {
  icono:      ShoppingCart,
  color:      'red',
  bgHeader:   'bg-red-50',
  textHeader: 'text-red-700',
  borderColor:'border-red-100',
  renderItem: (item, opciones) => {
    const nombre = nombreVisible(item.proveedor, item.tipo_proveedor, opciones?.esAdmin);
    return {
      descripcion: `Compra — ${nombre}`,
      detalle:     [item.productos, item.numero_factura ? `Fact. ${item.numero_factura}` : null, item.metodo || null]
                     .filter(Boolean).join(' · ') || null,
      fecha:       item.fecha,
    };
  },
},
  abonosAcreedor: {
  icono:      ArrowUpCircle,
  color:      'yellow',
  bgHeader:   'bg-yellow-50',
  textHeader: 'text-yellow-700',
  borderColor:'border-yellow-100',
  renderItem: (item, opciones) => {
    const nombre = nombreVisible(item.acreedor, item.tipo_proveedor, opciones?.esAdmin);
    return {
      descripcion: `Abono a ${nombre}`,
      detalle:     [opciones?.esAdmin ? item.descripcion : null, item.metodo || null]
                     .filter(Boolean).join(' · ') || null,
      fecha:       item.fecha,
    };
  },
},
  abonosDomicilio: {
    icono:      Bike,
    color:      'orange',
    bgHeader:   'bg-orange-50',
    textHeader: 'text-orange-700',
    borderColor:'border-orange-200',
    renderItem: (item) => ({
      descripcion: item.referencia_id
        ? `Domicilio Factura #${String(item.referencia_id).padStart(6, '0')}${item.concepto ? ` — ${item.concepto}` : ''}`
        : (item.concepto || 'Abono domicilio'),
      detalle:     item.usuario_nombre || null,
      fecha:       item.fecha,
    }),
  },
  manuales: {
    icono:      Sliders,
    color:      'gray',
    bgHeader:   'bg-gray-50',
    textHeader: 'text-gray-700',
    borderColor:'border-gray-100',
    renderItem: (item) => ({
      descripcion: item.concepto,
      detalle:     item.usuario_nombre || null,
      fecha:       item.fecha,
      esMixto:     true,
      tipo:        item.tipo,
    }),
  },
};

function ModalMovimiento({ cajaId, onClose }) {
  const queryClient = useQueryClient();
  const metodos     = useMetodosPago();
  // El método es obligatorio para que Tesorería asigne el movimiento a la
  // cuenta correcta (efectivo, banco, billetera…).
  const [form,  setForm]  = useState({ tipo: 'Ingreso', concepto: '', valor: '', metodo: 'Efectivo' });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => registrarMovimiento(cajaId, {
      tipo:     form.tipo,
      concepto: form.concepto,
      valor:    Number(form.valor),
      metodo:   form.metodo,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['caja-resumen', cajaId], exact: false });
      queryClient.invalidateQueries({ queryKey: ['caja-activa'],           exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al registrar'),
  });

  const handleKeyDown = (e, siguienteId) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (siguienteId) document.getElementById(siguienteId)?.focus();
      else mutation.mutate();
    }
  };

  return (
    <Modal open onClose={onClose} title="Registrar Movimiento" size="sm">
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          {['Ingreso', 'Egreso'].map((t) => (
            <button key={t} onClick={() => setForm({ ...form, tipo: t })}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all
                ${form.tipo === t
                  ? t === 'Ingreso' ? 'bg-green-50 border-green-300 text-green-700'
                                    : 'bg-red-50 border-red-300 text-red-700'
                  : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
              {t}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Método de pago</label>
          <select
            value={form.metodo}
            onChange={(e) => setForm({ ...form, metodo: e.target.value })}
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm
              text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {metodos.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
        <Input id="concepto" label="Concepto" placeholder="Ej: Pago servicios"
          value={form.concepto} onChange={(e) => setForm({ ...form, concepto: e.target.value })}
          onKeyDown={(e) => handleKeyDown(e, 'valor-mov')} />
        <Input id="valor-mov" label="Valor" type="number" placeholder="0"
          value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })}
          onKeyDown={(e) => handleKeyDown(e, null)} />
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

function ModalCerrarCaja({ caja, resumenTotales, onClose }) {
  const queryClient = useQueryClient();
  const [monto, setMonto] = useState('');
  const [error, setError] = useState('');

  const saldoEsperado = Number(caja.monto_inicial)
    + Number(resumenTotales?.ingresos || 0)
    - Number(resumenTotales?.egresos  || 0);

  const mutation = useMutation({
    mutationFn: () => cerrarCaja(caja.id, { monto_cierre: Number(monto) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['caja-activa'], exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al cerrar'),
  });

  const diferencia = monto !== '' ? Number(monto) - saldoEsperado : null;

  return (
    <Modal open onClose={onClose} title="Cerrar Caja" size="sm">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-xs text-gray-400">Monto inicial</p>
            <p className="text-base font-bold text-gray-900">{formatCOP(caja.monto_inicial)}</p>
          </div>
          <div className="bg-blue-50 rounded-xl p-3">
            <p className="text-xs text-blue-400">Saldo esperado</p>
            <p className="text-base font-bold text-blue-700">{formatCOP(saldoEsperado)}</p>
          </div>
        </div>
        {resumenTotales?.pendienteDomicilios > 0 && (
          <div className="flex items-center gap-2 bg-orange-50 border border-orange-100 rounded-xl px-3 py-2">
            <Bike size={14} className="text-orange-500 flex-shrink-0" />
            <p className="text-xs text-orange-700">
              Hay <span className="font-semibold">{formatCOP(resumenTotales.pendienteDomicilios)}</span> pendientes
              de rendir por domiciliarios. Ese monto no está incluido en el saldo esperado.
            </p>
          </div>
        )}
        <Input label="Monto de cierre (conteo físico)" type="number" placeholder="0"
          value={monto} onChange={(e) => setMonto(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && mutation.mutate()} />
        {diferencia !== null && (
          <div className={`rounded-xl p-3 text-sm font-medium text-center
            ${diferencia === 0 ? 'bg-green-50 text-green-700' :
              diferencia > 0  ? 'bg-blue-50 text-blue-700'   :
                                'bg-red-50 text-red-600'}`}>
            {diferencia === 0 && '✓ Caja cuadrada perfectamente'}
            {diferencia > 0  && `Sobrante: +${formatCOP(diferencia)}`}
            {diferencia < 0  && `Faltante: ${formatCOP(diferencia)}`}
          </div>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button variant="danger" className="flex-1" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Cerrar Caja
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ResumenMetodosPago({ metodosPagoDetalle }) {
  const detalle = metodosPagoDetalle || {};
  const metodos = Object.keys(detalle);
  if (metodos.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {/* Cards por método */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {metodos.map((metodo) => {
          const datos = detalle[metodo];
          const saldo = datos.ingresos - datos.egresos;
          return (
            <div key={metodo} className="bg-white border border-gray-100 rounded-2xl p-3 flex flex-col gap-1.5 shadow-sm">
              <p className="text-xs font-semibold text-gray-500">{metodo}</p>
              <div className="flex items-baseline justify-between">
                <span className={`text-lg font-bold ${saldo >= 0 ? 'text-gray-900' : 'text-red-600'}`}>
                  {formatCOP(saldo)}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-green-600">+{formatCOP(datos.ingresos)}</span>
                {datos.egresos > 0 && (
                  <span className="text-red-500">-{formatCOP(datos.egresos)}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Tabla resumen */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Resumen por método de pago
          </p>
        </div>
        <div className="divide-y divide-gray-50">
          <div className="grid grid-cols-4 px-4 py-2 text-xs font-medium text-gray-400">
            <span>Método</span>
            <span className="text-right">Entradas</span>
            <span className="text-right">Salidas</span>
            <span className="text-right">Saldo</span>
          </div>
          {metodos.map((metodo) => {
            const datos = detalle[metodo];
            const saldo = datos.ingresos - datos.egresos;
            return (
              <div key={metodo} className="grid grid-cols-4 px-4 py-2.5 text-sm items-center">
                <span className="font-medium text-gray-700">{metodo}</span>
                <span className="text-right text-green-600">+{formatCOP(datos.ingresos)}</span>
                <span className="text-right text-red-500">
                  {datos.egresos > 0 ? `-${formatCOP(datos.egresos)}` : '—'}
                </span>
                <span className={`text-right font-semibold ${saldo >= 0 ? 'text-gray-900' : 'text-red-600'}`}>
                  {formatCOP(saldo)}
                </span>
              </div>
            );
          })}
          <div className="grid grid-cols-4 px-4 py-2.5 text-sm font-bold bg-gray-50 border-t border-gray-200">
            <span className="text-gray-700">Total</span>
            <span className="text-right text-green-600">
              +{formatCOP(metodos.reduce((s, m) => s + detalle[m].ingresos, 0))}
            </span>
            <span className="text-right text-red-500">
              -{formatCOP(metodos.reduce((s, m) => s + detalle[m].egresos, 0))}
            </span>
            <span className="text-right text-gray-900">
              {formatCOP(metodos.reduce((s, m) => s + detalle[m].ingresos - detalle[m].egresos, 0))}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── GrupoMovimientos ────────────────────────────────────────────────────────

function ItemMovimiento({ item, rendered, esTipoIngreso, cajaId, readOnly = false }) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => toggleMovimiento(item.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['caja-resumen', cajaId], exact: false });
    },
  });

  const tieneToggle = item.activo !== undefined && !readOnly;
  const estaActivo  = item.activo !== false;

  return (
    <div className={`flex items-center justify-between px-4 py-2.5 bg-white
      hover:bg-gray-50/50 transition-colors
      ${!estaActivo ? 'bg-red-50/30' : ''}`}>
      <div className="flex-1 min-w-0">
        <p className={`text-sm truncate ${!estaActivo ? 'line-through text-gray-400' : 'text-gray-800'}`}>
          {rendered.descripcion}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {rendered.detalle && (
            <span className="text-xs text-gray-400">{rendered.detalle}</span>
          )}
          {rendered.fecha && (
            <span className="text-xs text-gray-300">{formatFechaHora(rendered.fecha)}</span>
          )}
          {!estaActivo && (
            <span className="text-xs bg-red-100 text-red-500 font-semibold px-1.5 py-0.5 rounded-full">Anulado</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0 ml-3">
        <span className={`text-sm font-semibold
          ${!estaActivo ? 'line-through text-gray-300' : esTipoIngreso ? 'text-green-600' : 'text-red-500'}`}>
          {esTipoIngreso ? '+' : '-'}{formatCOP(item.valor)}
        </span>

        {tieneToggle && (
          estaActivo ? (
            <button onClick={(e) => { e.stopPropagation(); mutation.mutate(); }}
              disabled={mutation.isPending} title="Anular movimiento"
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium
                text-red-400 bg-red-50 border border-red-200
                hover:text-red-600 hover:bg-red-100 hover:border-red-300
                transition-all disabled:opacity-30">
              <Ban size={12} />
              <span className="hidden sm:inline">Anular</span>
            </button>
          ) : (
            <button onClick={(e) => { e.stopPropagation(); mutation.mutate(); }}
              disabled={mutation.isPending} title="Reactivar movimiento"
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium
                text-green-600 bg-green-50 border border-green-200
                hover:bg-green-100 transition-all disabled:opacity-40">
              <RotateCcw size={12} />
              <span className="hidden sm:inline">Reactivar</span>
            </button>
          )
        )}
      </div>
    </div>
  );
}

function GrupoMovimientos({ grupoKey, grupo, cajaId, opciones, readOnly = false }) {
  const [expandido, setExpandido] = useState(false);
  const cfg = CONFIG_GRUPOS[grupoKey];
  if (!cfg || grupo.items.length === 0) return null;

  const GrupoIcono = cfg.icono;
  const esMixto    = grupoKey === 'manuales';
  const esIngreso  = grupo.tipo === 'Ingreso';
  const anulados   = grupo.items.filter((i) => i.activo === false).length;

  return (
    <div className={`border ${cfg.borderColor} rounded-2xl overflow-hidden`}>
      <button onClick={() => setExpandido(!expandido)}
        className={`w-full flex items-center justify-between px-4 py-3 ${cfg.bgHeader} transition-colors hover:brightness-95`}>
        <div className="flex items-center gap-2">
          <GrupoIcono size={16} className={cfg.textHeader} />
          <span className={`text-sm font-semibold ${cfg.textHeader}`}>{grupo.label}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full bg-white/60 ${cfg.textHeader}`}>
            {grupo.items.length}
          </span>
          {anulados > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-500">
              {anulados} anulado{anulados !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {esMixto ? (
            <div className="flex gap-2 text-xs">
              {grupo.totalIngreso > 0 && (
                <span className="text-green-600 font-semibold">+{formatCOP(grupo.totalIngreso)}</span>
              )}
              {grupo.totalEgreso > 0 && (
                <span className="text-red-500 font-semibold">-{formatCOP(grupo.totalEgreso)}</span>
              )}
            </div>
          ) : (
            <span className={`text-sm font-bold ${esIngreso ? 'text-green-600' : 'text-red-500'}`}>
              {esIngreso ? '+' : '-'}{formatCOP(grupo.total)}
            </span>
          )}
          {expandido
            ? <ChevronUp size={15} className={cfg.textHeader} />
            : <ChevronDown size={15} className={cfg.textHeader} />}
        </div>
      </button>
      {expandido && (
        <div className="divide-y divide-gray-50">
          {grupo.items.map((item) => {
            const rendered      = cfg.renderItem(item, opciones);
            const esTipoIngreso = rendered.esMixto ? rendered.tipo === 'Ingreso' : esIngreso;
            return (
              <ItemMovimiento key={item.id} item={item} rendered={rendered}
                esTipoIngreso={esTipoIngreso} cajaId={cajaId} readOnly={readOnly} />
            );
          })}
        </div>
      )}
    </div>
  );
}

function GrupoMovimientosInformativo(props) {
  const { grupo, badge = 'por rendir' } = props;
  const [expandido, setExpandido] = useState(false);
  if (!grupo || grupo.items.length === 0) return null;

  return (
    <div className="border border-gray-200 border-dashed rounded-2xl overflow-hidden">
      <button onClick={() => setExpandido(!expandido)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors">
        <div className="flex items-center gap-2">
          {props.Icono
            ? <props.Icono size={16} className="text-gray-400" />
            : <Bike size={16} className="text-gray-400" />}
          <span className="text-sm font-semibold text-gray-500">{grupo.label}</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-white/80 text-gray-400">
            {grupo.items.length}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-400">{formatCOP(grupo.total)}</span>
          <span className="text-xs text-gray-400 bg-gray-200 px-2 py-0.5 rounded-full">{badge}</span>
          {expandido
            ? <ChevronUp size={15} className="text-gray-400" />
            : <ChevronDown size={15} className="text-gray-400" />}
        </div>
      </button>
      {expandido && (
        <div className="divide-y divide-gray-50">
          {grupo.items.map((item) => (
            <div key={item.id}
              className="flex items-center justify-between px-4 py-2.5 bg-white hover:bg-gray-50/50">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-600 truncate">
                  Factura #{String(item.factura_numero ?? item.factura_id).padStart(6,'0')} — {item.nombre_cliente}
                </p>
                <div className="flex items-center gap-2">
                  {item.metodo && <span className="text-xs text-gray-400">{item.metodo}</span>}
                  {item.fecha  && <span className="text-xs text-gray-300">{formatFechaHora(item.fecha)}</span>}
                </div>
              </div>
              <span className="text-sm font-medium text-gray-400 flex-shrink-0 ml-3">
                {formatCOP(item.valor)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ModalMovimientoMetodo ────────────────────────────────────────────────────
function ModalMovimientoMetodo({ cajaId, metodoInicial, onClose }) {
  const queryClient = useQueryClient();
  const metodos     = useMetodosPago();
  const [form,  setForm]  = useState({
    tipo:    'Ingreso',
    concepto: '',
    valor:   '',
    metodo:  metodoInicial || metodos[0]?.id || 'Efectivo',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => registrarMovimiento(cajaId, {
      tipo:     form.tipo,
      concepto: form.concepto.trim() || `${form.tipo} - ${form.metodo}`,
      valor:    Number(form.valor),
      metodo:   form.metodo,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['caja-resumen', cajaId], exact: false });
      await queryClient.invalidateQueries({ queryKey: ['caja-activa'],           exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al registrar'),
  });

  return (
    <Modal open onClose={onClose} title="Registrar Movimiento" size="sm">
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          {['Ingreso', 'Egreso'].map((t) => (
            <button key={t} onClick={() => setForm({ ...form, tipo: t })}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all
                ${form.tipo === t
                  ? t === 'Ingreso' ? 'bg-green-50 border-green-300 text-green-700'
                                    : 'bg-red-50 border-red-300 text-red-700'
                  : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
              {t}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Método de pago</label>
          <select
            value={form.metodo}
            onChange={(e) => setForm({ ...form, metodo: e.target.value })}
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm
              text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {metodos.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>

        <Input
          label="Concepto (opcional)"
          placeholder="Ej: Retiro para gastos"
          value={form.concepto}
          onChange={(e) => setForm({ ...form, concepto: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') document.getElementById('valor-metodo-mov')?.focus(); }}
        />
        <Input
          id="valor-metodo-mov"
          label="Valor"
          type="number" placeholder="0"
          value={form.valor}
          onChange={(e) => setForm({ ...form, valor: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') mutation.mutate(); }}
        />
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

// ─── TabMetodos ───────────────────────────────────────────────────────────────

function _buildItemsPorMetodo(grupos) {
  const result = {};

  const add = (item, descripcion, tipo) => {
    if (!item.metodo) return;
    if (!result[item.metodo]) result[item.metodo] = [];
    result[item.metodo].push({
      id: `${tipo}-${item.id}`,
      descripcion,
      valor:  Number(item.valor || 0),
      tipo,
      fecha:  item.fecha,
      activo: item.activo,
    });
  };

  (grupos.facturas?.items || []).forEach((item) =>
    add(item, `Factura #${String(item.factura_numero ?? item.factura_id).padStart(6, '0')} — ${item.nombre_cliente}`, 'Ingreso')
  );
  (grupos.abonosCredito?.items || []).forEach((item) =>
    add(item, `Crédito Factura #${String(item.factura_numero ?? item.factura_id).padStart(6, '0')} — ${item.nombre_cliente}`, 'Ingreso')
  );
  (grupos.abonosPrestamo?.items || []).forEach((item) =>
    add(item, etiquetaAbonoPrestamo(item), 'Ingreso')
  );
  (grupos.abonosServicio?.items || []).forEach((item) => {
    const partes = [
      item.orden_id ? `#OS-${String(item.orden_numero ?? item.orden_id).padStart(4, '0')}` : '',
      item.equipo_nombre || item.equipo_tipo || '',
      item.cliente_nombre || '',
    ].filter(Boolean);
    add(item, partes.join(' — ') || 'Servicio técnico', 'Ingreso');
  });
  (grupos.abonosDomicilio?.items || []).forEach((item) =>
    add(item, item.concepto || 'Abono domicilio', 'Ingreso')
  );
  (grupos.compras?.items || []).forEach((item) =>
    add(item, `Compra — ${item.proveedor || 'Proveedor'}`, 'Egreso')
  );
  (grupos.abonosAcreedor?.items || []).forEach((item) =>
    add(item, `Abono a ${item.acreedor || 'Acreedor'}`, 'Egreso')
  );
  (grupos.manuales?.items || []).forEach((item) => {
    if (!item.metodo) return;
    if (!result[item.metodo]) result[item.metodo] = [];
    result[item.metodo].push({
      id: `manual-${item.id}`,
      descripcion: item.concepto,
      valor:  Number(item.valor || 0),
      tipo:   item.tipo,
      fecha:  item.fecha,
      activo: item.activo,
    });
  });

  Object.values(result).forEach((items) =>
    items.sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
  );
  return result;
}

function TarjetaMetodo({ metodo, ingresos, egresos, items, onAgregar }) {
  const [expandido, setExpandido] = useState(false);
  const saldo = ingresos - egresos;

  return (
    <div className="border border-gray-100 rounded-2xl overflow-hidden bg-white shadow-sm">
      {/* Cabecera */}
      <div className="flex items-center justify-between px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <Wallet size={17} className="text-blue-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{metodo.label}</p>
            <div className="flex items-center gap-2 mt-0.5">
              {ingresos > 0 && <span className="text-xs text-green-600">+{formatCOP(ingresos)}</span>}
              {egresos  > 0 && <span className="text-xs text-red-500">-{formatCOP(egresos)}</span>}
              {ingresos === 0 && egresos === 0 && (
                <span className="text-xs text-gray-400">Sin movimientos</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-base font-bold ${saldo < 0 ? 'text-red-600' : 'text-gray-900'}`}>
            {formatCOP(saldo)}
          </span>
          <button
            onClick={onAgregar}
            className="p-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
            title="Agregar movimiento"
          >
            <Plus size={15} />
          </button>
          {items.length > 0 && (
            <button
              onClick={() => setExpandido((v) => !v)}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-400"
            >
              {expandido ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
          )}
        </div>
      </div>

      {/* Historial */}
      {expandido && items.length > 0 && (
        <div className="border-t border-gray-100 divide-y divide-gray-50">
          {items.map((item) => (
            <div
              key={item.id}
              className={`flex items-center justify-between px-4 py-2.5 bg-white
                ${item.activo === false ? 'bg-red-50/30' : ''}`}
            >
              <div className="flex-1 min-w-0">
                <p className={`text-sm truncate
                  ${item.activo === false ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                  {item.descripcion}
                </p>
                <div className="flex items-center gap-2">
                  {item.fecha && (
                    <span className="text-xs text-gray-300">{formatFechaHora(item.fecha)}</span>
                  )}
                  {item.activo === false && (
                    <span className="text-xs bg-red-100 text-red-500 font-semibold px-1.5 py-0.5 rounded-full">
                      Anulado
                    </span>
                  )}
                </div>
              </div>
              <span className={`text-sm font-semibold flex-shrink-0 ml-3
                ${item.activo === false
                  ? 'line-through text-gray-300'
                  : item.tipo === 'Ingreso' ? 'text-green-600' : 'text-red-500'}`}>
                {item.tipo === 'Ingreso' ? '+' : '-'}{formatCOP(item.valor)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TabMetodos({ grupos, metodosPagoDetalle, cajaId }) {
  const metodos                  = useMetodosPago();
  const [modalMetodo, setModalMetodo] = useState(null);
  const itemsPorMetodo           = useMemo(() => _buildItemsPorMetodo(grupos), [grupos]);

  return (
    <div className="flex flex-col gap-3">
      {metodos.map((m) => {
        const datos = metodosPagoDetalle?.[m.id] || { ingresos: 0, egresos: 0 };
        return (
          <TarjetaMetodo
            key={m.id}
            metodo={m}
            ingresos={datos.ingresos}
            egresos={datos.egresos}
            items={itemsPorMetodo[m.id] || []}
            onAgregar={() => setModalMetodo(m.id)}
          />
        );
      })}

      {modalMetodo && (
        <ModalMovimientoMetodo
          cajaId={cajaId}
          metodoInicial={modalMetodo}
          onClose={() => setModalMetodo(null)}
        />
      )}
    </div>
  );
}

// ─── Histórico de cajas ───────────────────────────────────────────────────────

// Bloque reutilizable: renderiza los grupos de un resumen (ingresos/egresos/etc).
function ResumenGrupos({ grupos, cajaId, opciones, readOnly = false }) {
  const g = grupos || {};
  const has = (keys) => keys.some((k) => g[k]?.items?.length > 0);
  const ingresoKeys = ['facturas', 'abonosCredito', 'abonosPrestamo', 'abonosServicio', 'abonosDomicilio'];
  // Retomas NO van en egresos: los pagos de factura ya vienen netos de retoma
  const egresoKeys  = ['devoluciones', 'compras', 'abonosAcreedor'];
  const hayNada = Object.values(g).every((x) => !x?.items?.length);

  if (hayNada) return <EmptyState icon={Wallet} titulo="Sin movimientos" />;

  return (
    <div className="flex flex-col gap-3">
      {has(ingresoKeys) && <p className="text-xs text-gray-400 font-medium px-1">Ingresos</p>}
      {ingresoKeys.map((k) => (
        <GrupoMovimientos key={k} grupoKey={k} grupo={g[k] || { items: [] }}
          cajaId={cajaId} opciones={opciones} readOnly={readOnly} />
      ))}

      {g.facturasDomicilio?.items?.length > 0 && (
        <>
          <p className="text-xs text-gray-400 font-medium px-1 mt-1">En poder del domiciliario</p>
          <GrupoMovimientosInformativo grupo={g.facturasDomicilio} />
        </>
      )}

      {g.retomas?.items?.length > 0 && (
        <>
          <p className="text-xs text-gray-400 font-medium px-1 mt-1">Retomas (informativo)</p>
          <GrupoMovimientosInformativo grupo={g.retomas} badge="ya descontada" Icono={RefreshCw} />
        </>
      )}

      {has(egresoKeys) && <p className="text-xs text-gray-400 font-medium px-1 mt-1">Egresos</p>}
      {egresoKeys.map((k) => (
        <GrupoMovimientos key={k} grupoKey={k} grupo={g[k] || { items: [] }}
          cajaId={cajaId} opciones={opciones} readOnly={readOnly} />
      ))}

      {g.manuales?.items?.length > 0 && (
        <>
          <p className="text-xs text-gray-400 font-medium px-1 mt-1">Manuales</p>
          <GrupoMovimientos grupoKey="manuales" grupo={g.manuales}
            cajaId={cajaId} opciones={opciones} readOnly={readOnly} />
        </>
      )}
    </div>
  );
}

// Detalle de una caja del histórico — carga el resumen (foto si está cerrada) al abrir.
function DetalleCajaHist({ cajaId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['caja-hist-detalle', cajaId],
    queryFn:  () => getResumenDia(cajaId).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <Spinner className="py-8" />;
  const resumen  = data?.data;
  const opciones = { esAdmin: data?.nivel === 'admin_negocio' };
  if (!resumen) return <p className="text-sm text-gray-400 px-1 py-4">No se pudo cargar el detalle.</p>;

  return (
    <div className="flex flex-col gap-4 pt-1">
      <ResumenMetodosPago metodosPagoDetalle={resumen.metodosPagoDetalle} />
      <ResumenGrupos grupos={resumen.grupos} cajaId={cajaId} opciones={opciones} readOnly />
    </div>
  );
}

function CajaHistCard({ caja }) {
  const [abierto, setAbierto] = useState(false);
  const cerrada = caja.estado === 'Cerrada';
  const t = caja.totales; // null si no hay foto (caja abierta o previa a la migración)

  const inicial = Number(caja.monto_inicial || 0);
  const ingresos = t ? Number(t.ingresos || 0) : null;
  const egresos  = t ? Number(t.egresos  || 0) : null;
  const saldoEsperado = t ? inicial + ingresos - egresos : null;
  const conteo   = caja.monto_cierre != null ? Number(caja.monto_cierre) : null;
  const dif      = (cerrada && t && conteo != null) ? conteo - saldoEsperado : null;

  return (
    <div className={`border rounded-2xl overflow-hidden ${cerrada ? 'border-gray-100' : 'border-green-200'}`}>
      <button onClick={() => setAbierto((v) => !v)}
        className="w-full flex items-start justify-between gap-3 px-4 py-3 bg-white hover:bg-gray-50/60 transition-colors text-left">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <CalendarDays size={14} className="text-gray-400 flex-shrink-0" />
            <span className="text-sm font-semibold text-gray-800">{formatFecha(caja.fecha_apertura)}</span>
            <Badge variant={cerrada ? 'gray' : 'green'}>{cerrada ? 'Cerrada' : 'Abierta'}</Badge>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            {caja.usuario_nombre || 'Sin cajero'} · {formatFechaHora(caja.fecha_apertura)}
            {caja.fecha_cierre ? ` → ${formatFechaHora(caja.fecha_cierre)}` : ''}
          </p>
          {t ? (
            <div className="flex items-center gap-3 mt-1.5 text-xs flex-wrap">
              <span className="text-green-600 font-medium">+{formatCOP(ingresos)}</span>
              <span className="text-red-500 font-medium">-{formatCOP(egresos)}</span>
              <span className="text-gray-500">Saldo <span className="font-semibold text-gray-800">{formatCOP(t.saldo)}</span></span>
            </div>
          ) : (
            <p className="text-xs text-gray-300 mt-1.5">{cerrada ? 'Toca para ver el detalle' : 'En curso'}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {dif != null && (
            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full
              ${dif === 0 ? 'bg-green-50 text-green-600' : dif > 0 ? 'bg-blue-50 text-blue-600' : 'bg-red-50 text-red-500'}`}>
              {dif === 0 ? <><CheckCircle2 size={12} /> Cuadró</>
                : dif > 0 ? `Sobra ${formatCOP(dif)}`
                : <><AlertTriangle size={12} /> Falta {formatCOP(Math.abs(dif))}</>}
            </span>
          )}
          {abierto ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </div>
      </button>
      {abierto && (
        <div className="px-3 pb-3 border-t border-gray-50 bg-gray-50/30">
          {cerrada && conteo != null && t && (
            <div className="grid grid-cols-3 gap-2 py-3">
              <div className="bg-white rounded-xl p-2.5 text-center border border-gray-100">
                <p className="text-[11px] text-gray-400">Inicial</p>
                <p className="text-sm font-bold text-gray-700">{formatCOP(inicial)}</p>
              </div>
              <div className="bg-white rounded-xl p-2.5 text-center border border-gray-100">
                <p className="text-[11px] text-blue-400">Esperado</p>
                <p className="text-sm font-bold text-blue-700">{formatCOP(saldoEsperado)}</p>
              </div>
              <div className="bg-white rounded-xl p-2.5 text-center border border-gray-100">
                <p className="text-[11px] text-gray-400">Conteo</p>
                <p className="text-sm font-bold text-gray-700">{formatCOP(conteo)}</p>
              </div>
            </div>
          )}
          <DetalleCajaHist cajaId={caja.id} />
        </div>
      )}
    </div>
  );
}

function HistorialCajas() {
  const { sucursalKey, sucursalLista } = useSucursalKey();
  const { data: cajas, isLoading } = useQuery({
    queryKey: ['caja-historial', ...sucursalKey],
    queryFn:  () => getHistorialCajas().then((r) => r.data.data),
    enabled:  sucursalLista,
  });

  if (!sucursalLista) {
    return <EmptyState icon={History} titulo="Selecciona una sucursal"
      descripcion="Elige una sucursal para ver su historial de cajas." />;
  }
  if (isLoading) return <Spinner className="py-16" />;
  if (!cajas?.length) {
    return <EmptyState icon={History} titulo="Sin cajas registradas"
      descripcion="Aquí verás el historial de cajas abiertas y cerradas." />;
  }

  return (
    <div className="flex flex-col gap-3">
      {cajas.map((c) => <CajaHistCard key={c.id} caja={c} />)}
    </div>
  );
}

export default function CajaPage() {
  const queryClient                       = useQueryClient();
  const { sucursalKey, sucursalLista }    = useSucursalKey();
  const [vista,         setVista]         = useState('actual'); // 'actual' | 'historial'
  const [tabVista,      setTabVista]      = useState('movimientos');
  const [modalMov,      setModalMov]      = useState(false);
  const [modalCerrar,   setModalCerrar]   = useState(false);
  const [montoApertura, setMontoApertura] = useState('');

  const { data: caja, isLoading } = useQuery({
    queryKey: ['caja-activa', ...sucursalKey],
    queryFn:  () => getCajaActiva().then((r) => r.data.data),
    enabled:  sucursalLista,
  });

  const { data: resumenRaw, isLoading: loadingResumen } = useQuery({
    queryKey: ['caja-resumen', caja?.id],
    queryFn:  () => getResumenDia(caja.id).then((r) => r.data),
    enabled:  !!caja?.id,
    refetchInterval: 30000,
  });

  const resumenData    = resumenRaw?.data ?? null;
  const nivelUsuario   = resumenRaw?.nivel ?? null;
  const esAdmin        = nivelUsuario === 'admin_negocio';

  const mutAbrir = useMutation({
    mutationFn: () => abrirCaja({ monto_inicial: Number(montoApertura) }),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['caja-activa'], exact: false }),
  });

  const grupos      = useMemo(() => resumenData?.grupos      || {}, [resumenData]);
  const totales     = useMemo(
    () => resumenData?.totales || { ingresosBruto: 0, retomas: 0, ingresos: 0, egresos: 0, saldo: 0, pendienteDomicilios: 0 },
    [resumenData]
  );
  

  // Opciones para renderItem: esAdmin determina si se muestra el nombre real
  const opcionesGrupo = useMemo(() => ({ esAdmin }), [esAdmin]);

  const saldoActual = useMemo(
    () => Number(caja?.monto_inicial || 0) + totales.ingresos - totales.egresos,
    [caja, totales]
  );

  const hayMovimientos = useMemo(
    () => Object.values(grupos).some((g) => g.items?.length > 0),
    [grupos]
  );

  if (isLoading) return <Spinner className="py-32" />;

  const topTabs = (
    <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
      {[{ id: 'actual', label: 'Caja actual' }, { id: 'historial', label: 'Historial' }].map((tab) => (
        <button key={tab.id} onClick={() => setVista(tab.id)}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150
            ${vista === tab.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          {tab.id === 'historial' && <History size={14} />}{tab.label}
        </button>
      ))}
    </div>
  );

  if (vista === 'historial') {
    return (
      <div className="flex flex-col gap-5">
        {topTabs}
        <HistorialCajas />
      </div>
    );
  }

  if (!caja) {
    return (
      <div className="flex flex-col gap-5">
        {topTabs}
        <div className="flex flex-col items-center justify-center py-20 gap-6">
          <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center">
            <Wallet size={32} className="text-blue-600" />
          </div>
          <div className="text-center">
            <h2 className="text-lg font-bold text-gray-900">No hay caja abierta</h2>
            <p className="text-sm text-gray-400 mt-1">Ingresa el monto inicial para comenzar</p>
          </div>
          <div className="flex gap-3 w-full max-w-xs">
            <Input placeholder="Monto inicial" type="number" value={montoApertura}
              onChange={(e) => setMontoApertura(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && mutAbrir.mutate()} />
            <Button loading={mutAbrir.isPending} onClick={() => mutAbrir.mutate()}>Abrir</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {topTabs}

      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-400">Saldo actual</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{formatCOP(saldoActual)}</p>
            <p className="text-xs text-gray-400 mt-1">Desde: {formatFechaHora(caja.fecha_apertura)}</p>
          </div>
          <Badge variant="green">Abierta</Badge>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-4 sm:grid-cols-4">
          <div className="bg-gray-50 rounded-xl p-3 text-center">
            <p className="text-xs text-gray-400">Inicial</p>
            <p className="text-sm font-bold text-gray-700">{formatCOP(caja.monto_inicial)}</p>
          </div>
          <div className="bg-green-50 rounded-xl p-3 text-center">
            <p className="text-xs text-green-500">Ingresos netos</p>
            <p className="text-sm font-bold text-green-700">+{formatCOP(totales.ingresos)}</p>
          </div>
          {totales.retomas > 0 && (
            <div className="bg-purple-50 rounded-xl p-3 text-center" title="Ya descontadas en el pago de la factura — no restan de la caja">
              <p className="text-xs text-purple-500">Retomas (ya en factura)</p>
              <p className="text-sm font-bold text-purple-700">{formatCOP(totales.retomas)}</p>
            </div>
          )}
          {totales.pendienteDomicilios > 0 && (
            <div className="bg-gray-100 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-400">En domiciliarios</p>
              <p className="text-sm font-bold text-gray-500">{formatCOP(totales.pendienteDomicilios)}</p>
            </div>
          )}
          <div className="bg-red-50 rounded-xl p-3 text-center">
            <p className="text-xs text-red-400">Egresos</p>
            <p className="text-sm font-bold text-red-600">-{formatCOP(totales.egresos)}</p>
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <Button className="flex-1" onClick={() => setModalMov(true)}>
            <Plus size={16} /> Movimiento
          </Button>
          <Button variant="danger" onClick={() => setModalCerrar(true)}>
            <Lock size={16} /> Cerrar Caja
          </Button>
        </div>
      </div>

      {/* ── Tab switcher ── */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {[
          { id: 'movimientos', label: 'Movimientos' },
          { id: 'metodos',     label: 'Por Método'  },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setTabVista(tab.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150
              ${tabVista === tab.id
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'}`}
          >
            {tab.label}
          </button>
        ))}
        {loadingResumen && <Spinner className="py-0 scale-75 ml-1" />}
      </div>

      {/* ── Tab: Movimientos ── */}
      {tabVista === 'movimientos' && (
        <>
          <ResumenMetodosPago metodosPagoDetalle={resumenData?.metodosPagoDetalle} />

          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-gray-700">Movimientos del período</h2>

            {!hayMovimientos ? (
              <EmptyState icon={Wallet} titulo="Sin movimientos aún" />
            ) : (
              <>
                <p className="text-xs text-gray-400 font-medium px-1">Ingresos</p>
                <GrupoMovimientos grupoKey="facturas"        grupo={grupos.facturas        || { items: [] }} cajaId={caja.id} opciones={opcionesGrupo} />
                <GrupoMovimientos grupoKey="abonosCredito"   grupo={grupos.abonosCredito   || { items: [] }} cajaId={caja.id} opciones={opcionesGrupo} />
                <GrupoMovimientos grupoKey="abonosPrestamo"  grupo={grupos.abonosPrestamo  || { items: [] }} cajaId={caja.id} opciones={opcionesGrupo} />
                <GrupoMovimientos grupoKey="abonosServicio"  grupo={grupos.abonosServicio  || { items: [] }} cajaId={caja.id} opciones={opcionesGrupo} />
                <GrupoMovimientos grupoKey="abonosDomicilio" grupo={grupos.abonosDomicilio || { items: [] }} cajaId={caja.id} opciones={opcionesGrupo} />

                {grupos.facturasDomicilio?.items?.length > 0 && (
                  <>
                    <p className="text-xs text-gray-400 font-medium px-1 mt-1">En poder del domiciliario</p>
                    <GrupoMovimientosInformativo grupo={grupos.facturasDomicilio} />
                  </>
                )}

                {grupos.retomas?.items?.length > 0 && (
                  <>
                    <p className="text-xs text-gray-400 font-medium px-1 mt-1">Retomas (informativo)</p>
                    <GrupoMovimientosInformativo grupo={grupos.retomas} badge="ya descontada" Icono={RefreshCw} />
                  </>
                )}

                <p className="text-xs text-gray-400 font-medium px-1 mt-1">Egresos</p>
                <GrupoMovimientos grupoKey="devoluciones"   grupo={grupos.devoluciones   || { items: [] }} cajaId={caja.id} opciones={opcionesGrupo} />
                <GrupoMovimientos grupoKey="compras"        grupo={grupos.compras        || { items: [] }} cajaId={caja.id} opciones={opcionesGrupo} />
                <GrupoMovimientos grupoKey="abonosAcreedor" grupo={grupos.abonosAcreedor || { items: [] }} cajaId={caja.id} opciones={opcionesGrupo} />

                {grupos.manuales?.items?.length > 0 && (
                  <>
                    <p className="text-xs text-gray-400 font-medium px-1 mt-1">Manuales</p>
                    <GrupoMovimientos grupoKey="manuales" grupo={grupos.manuales} cajaId={caja.id} opciones={opcionesGrupo} />
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* ── Tab: Por Método ── */}
      {tabVista === 'metodos' && (
        <TabMetodos
          grupos={grupos}
          metodosPagoDetalle={resumenData?.metodosPagoDetalle}
          cajaId={caja.id}
        />
      )}

      {modalMov    && <ModalMovimiento cajaId={caja.id} onClose={() => setModalMov(false)} />}
      {modalCerrar && (
        <ModalCerrarCaja caja={caja} resumenTotales={totales} onClose={() => setModalCerrar(false)} />
      )}
    </div>
  );
}