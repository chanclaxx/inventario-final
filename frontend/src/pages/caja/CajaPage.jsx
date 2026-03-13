import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getCajaActiva, abrirCaja, cerrarCaja,
  registrarMovimiento, getResumenDia,
} from '../../api/caja.api';
import { formatCOP, formatFechaHora } from '../../utils/formatters';
import { Button }     from '../../components/ui/Button';
import { Input }      from '../../components/ui/Input';
import { Modal }      from '../../components/ui/Modal';
import { Badge }      from '../../components/ui/Badge';
import { Spinner }    from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { useSucursalKey } from '../../hooks/useSucursalKey';
import {
  Wallet, Plus, Minus, Lock, ChevronDown, ChevronUp,
  ShoppingCart, CreditCard, ArrowDownCircle, ArrowUpCircle,
  Receipt, Sliders,
} from 'lucide-react';

// ─── Modal: registrar movimiento manual ──────────────────────────────────────

function ModalMovimiento({ cajaId, onClose }) {
  const queryClient = useQueryClient();
  const [form,  setForm]  = useState({ tipo: 'Ingreso', concepto: '', valor: '' });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => registrarMovimiento(cajaId, {
      tipo:     form.tipo,
      concepto: form.concepto,
      valor:    Number(form.valor),
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
            <button
              key={t}
              onClick={() => setForm({ ...form, tipo: t })}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all
                ${form.tipo === t
                  ? t === 'Ingreso'
                    ? 'bg-green-50 border-green-300 text-green-700'
                    : 'bg-red-50 border-red-300 text-red-700'
                  : 'bg-gray-50 border-gray-200 text-gray-600'}`}
            >
              {t}
            </button>
          ))}
        </div>
        <Input
          id="concepto"
          label="Concepto"
          placeholder="Ej: Pago servicios"
          value={form.concepto}
          onChange={(e) => setForm({ ...form, concepto: e.target.value })}
          onKeyDown={(e) => handleKeyDown(e, 'valor-mov')}
        />
        <Input
          id="valor-mov"
          label="Valor"
          type="number"
          placeholder="0"
          value={form.valor}
          onChange={(e) => setForm({ ...form, valor: e.target.value })}
          onKeyDown={(e) => handleKeyDown(e, null)}
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

// ─── Modal: cerrar caja ───────────────────────────────────────────────────────

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
        <Input
          label="Monto de cierre (conteo físico)"
          type="number"
          placeholder="0"
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && mutation.mutate()}
        />
        {diferencia !== null && (
          <div className={`rounded-xl p-3 text-sm font-medium text-center
            ${diferencia === 0 ? 'bg-green-50 text-green-700' :
              diferencia > 0  ? 'bg-blue-50 text-blue-700'   :
                                'bg-red-50 text-red-600'}`}
          >
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

// ─── Tarjeta de grupo de movimientos ─────────────────────────────────────────

const CONFIG_GRUPOS = {
  facturas: {
    icono: Receipt,
    color: 'green',
    bgHeader: 'bg-green-50',
    textHeader: 'text-green-700',
    borderColor: 'border-green-100',
    renderItem: (item) => ({
      descripcion: `Factura #${String(item.factura_id).padStart(6,'0')} — ${item.nombre_cliente}`,
      detalle:     item.metodo,
      fecha:       item.fecha,
    }),
  },
  abonosCredito: {
    icono: CreditCard,
    color: 'blue',
    bgHeader: 'bg-blue-50',
    textHeader: 'text-blue-700',
    borderColor: 'border-blue-100',
    renderItem: (item) => ({
      descripcion: `Crédito Factura #${String(item.factura_id).padStart(6,'0')} — ${item.nombre_cliente}`,
      detalle:     item.metodo,
      fecha:       item.fecha,
    }),
  },
  abonosPrestamo: {
    icono: ArrowDownCircle,
    color: 'purple',
    bgHeader: 'bg-purple-50',
    textHeader: 'text-purple-700',
    borderColor: 'border-purple-100',
    renderItem: (item) => ({
      descripcion: `Préstamo — ${item.prestatario}`,
      detalle:     null,
      fecha:       item.fecha,
    }),
  },
  compras: {
    icono: ShoppingCart,
    color: 'red',
    bgHeader: 'bg-red-50',
    textHeader: 'text-red-700',
    borderColor: 'border-red-100',
    renderItem: (item) => ({
      descripcion: `Compra — ${item.proveedor}`,
      detalle:     item.numero_factura ? `Fact. ${item.numero_factura}` : null,
      fecha:       item.fecha,
    }),
  },
  abonosAcreedor: {
    icono: ArrowUpCircle,
    color: 'yellow',
    bgHeader: 'bg-yellow-50',
    textHeader: 'text-yellow-700',
    borderColor: 'border-yellow-100',
    renderItem: (item) => ({
      descripcion: `Abono a ${item.acreedor}`,
      detalle:     item.descripcion,
      fecha:       item.fecha,
    }),
  },
  manuales: {
    icono: Sliders,
    color: 'gray',
    bgHeader: 'bg-gray-50',
    textHeader: 'text-gray-700',
    borderColor: 'border-gray-100',
    renderItem: (item) => ({
      descripcion: item.concepto,
      detalle:     item.usuario_nombre || null,
      fecha:       item.fecha,
      esMixto:     true,
      tipo:        item.tipo,
    }),
  },
};

function GrupoMovimientos({ grupoKey, grupo }) {
  const [expandido, setExpandido] = useState(false);
  const cfg = CONFIG_GRUPOS[grupoKey];
  if (!cfg || grupo.items.length === 0) return null;

  const GrupoIcono = cfg.icono;
  const esMixto   = grupoKey === 'manuales';
  const esIngreso  = grupo.tipo === 'Ingreso';

  const totalMostrar = esMixto
    ? { ingreso: grupo.totalIngreso, egreso: grupo.totalEgreso }
    : { valor: grupo.total };

  return (
    <div className={`border ${cfg.borderColor} rounded-2xl overflow-hidden`}>
      <button
        onClick={() => setExpandido(!expandido)}
        className={`w-full flex items-center justify-between px-4 py-3 ${cfg.bgHeader} transition-colors hover:brightness-95`}
      >
        <div className="flex items-center gap-2">
          <GrupoIcono size={16} className={cfg.textHeader} />
          <span className={`text-sm font-semibold ${cfg.textHeader}`}>{grupo.label}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full bg-white/60 ${cfg.textHeader}`}>
            {grupo.items.length}
          </span>
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
              {esIngreso ? '+' : '-'}{formatCOP(totalMostrar.valor)}
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
            const rendered      = cfg.renderItem(item);
            const esTipoIngreso = rendered.esMixto ? rendered.tipo === 'Ingreso' : esIngreso;
            return (
              <div key={item.id} className="flex items-center justify-between px-4 py-2.5 bg-white hover:bg-gray-50/50">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 truncate">{rendered.descripcion}</p>
                  <div className="flex items-center gap-2">
                    {rendered.detalle && (
                      <span className="text-xs text-gray-400">{rendered.detalle}</span>
                    )}
                    {rendered.fecha && (
                      <span className="text-xs text-gray-300">{formatFechaHora(rendered.fecha)}</span>
                    )}
                  </div>
                </div>
                <span className={`text-sm font-semibold flex-shrink-0 ml-3
                  ${esTipoIngreso ? 'text-green-600' : 'text-red-500'}`}>
                  {esTipoIngreso ? '+' : '-'}{formatCOP(item.valor)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Page principal ───────────────────────────────────────────────────────────

export default function CajaPage() {
  const queryClient                         = useQueryClient();
  const sucursalKey                         = useSucursalKey();
  const [modalMov,      setModalMov]        = useState(false);
  const [modalCerrar,   setModalCerrar]     = useState(false);
  const [montoApertura, setMontoApertura]   = useState('');

  // caja-activa es de sucursal → incluye sucursalKey
  const { data: caja, isLoading } = useQuery({
    queryKey: ['caja-activa', ...sucursalKey],
    queryFn:  () => getCajaActiva().then((r) => r.data.data),
  });

  // caja-resumen es por ID único de caja abierta → sin sucursalKey
  const { data: resumenData, isLoading: loadingResumen } = useQuery({
    queryKey: ['caja-resumen', caja?.id],
    queryFn:  () => getResumenDia(caja.id).then((r) => r.data.data),
    enabled:  !!caja?.id,
    refetchInterval: 30000,
  });

  const mutAbrir = useMutation({
    mutationFn: () => abrirCaja({ monto_inicial: Number(montoApertura) }),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['caja-activa'], exact: false }),
  });

  const grupos  = useMemo(() => resumenData?.grupos  || {}, [resumenData]);
  const totales = useMemo(
    () => resumenData?.totales || { ingresos: 0, egresos: 0, saldo: 0 },
    [resumenData]
  );

  const saldoActual = useMemo(
    () => Number(caja?.monto_inicial || 0) + totales.ingresos - totales.egresos,
    [caja, totales]
  );

  const hayMovimientos = useMemo(
    () => Object.values(grupos).some((g) => g.items?.length > 0),
    [grupos]
  );

  if (isLoading) return <Spinner className="py-32" />;

  if (!caja) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-6">
        <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center">
          <Wallet size={32} className="text-blue-600" />
        </div>
        <div className="text-center">
          <h2 className="text-lg font-bold text-gray-900">No hay caja abierta</h2>
          <p className="text-sm text-gray-400 mt-1">Ingresa el monto inicial para comenzar</p>
        </div>
        <div className="flex gap-3 w-full max-w-xs">
          <Input
            placeholder="Monto inicial"
            type="number"
            value={montoApertura}
            onChange={(e) => setMontoApertura(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && mutAbrir.mutate()}
          />
          <Button loading={mutAbrir.isPending} onClick={() => mutAbrir.mutate()}>
            Abrir
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">

      {/* ── Cabecera de caja ── */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-400">Saldo actual</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{formatCOP(saldoActual)}</p>
            <p className="text-xs text-gray-400 mt-1">
              Desde: {formatFechaHora(caja.fecha_apertura)}
            </p>
          </div>
          <Badge variant="green">Abierta</Badge>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="bg-gray-50 rounded-xl p-3 text-center">
            <p className="text-xs text-gray-400">Inicial</p>
            <p className="text-sm font-bold text-gray-700">{formatCOP(caja.monto_inicial)}</p>
          </div>
          <div className="bg-green-50 rounded-xl p-3 text-center">
            <p className="text-xs text-green-500">Ingresos</p>
            <p className="text-sm font-bold text-green-700">+{formatCOP(totales.ingresos)}</p>
          </div>
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

      {/* ── Movimientos del día agrupados ── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Movimientos del día</h2>
          {loadingResumen && <Spinner className="py-0 scale-75" />}
        </div>

        {!hayMovimientos ? (
          <EmptyState icon={Wallet} titulo="Sin movimientos aún" />
        ) : (
          <>
            <p className="text-xs text-gray-400 font-medium px-1">Ingresos</p>
            <GrupoMovimientos grupoKey="facturas"       grupo={grupos.facturas       || { items: [] }} />
            <GrupoMovimientos grupoKey="abonosCredito"  grupo={grupos.abonosCredito  || { items: [] }} />
            <GrupoMovimientos grupoKey="abonosPrestamo" grupo={grupos.abonosPrestamo || { items: [] }} />

            <p className="text-xs text-gray-400 font-medium px-1 mt-1">Egresos</p>
            <GrupoMovimientos grupoKey="compras"        grupo={grupos.compras        || { items: [] }} />
            <GrupoMovimientos grupoKey="abonosAcreedor" grupo={grupos.abonosAcreedor || { items: [] }} />

            {(grupos.manuales?.items?.length > 0) && (
              <>
                <p className="text-xs text-gray-400 font-medium px-1 mt-1">Manuales</p>
                <GrupoMovimientos grupoKey="manuales" grupo={grupos.manuales} />
              </>
            )}
          </>
        )}
      </div>

      {/* ── Modales ── */}
      {modalMov    && <ModalMovimiento cajaId={caja.id} onClose={() => setModalMov(false)} />}
      {modalCerrar && (
        <ModalCerrarCaja
          caja={caja}
          resumenTotales={totales}
          onClose={() => setModalCerrar(false)}
        />
      )}
    </div>
  );
}