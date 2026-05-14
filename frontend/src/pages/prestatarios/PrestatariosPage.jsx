import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getPrestatarios, crearPrestatario,
  getMovimientos,
} from '../../api/prestatarios.api';
import { formatCOP, formatFechaHora } from '../../utils/formatters';
import { useAuth }      from '../../context/useAuth';
import useSucursalStore from '../../store/sucursalStore';
import { Modal }         from '../../components/ui/Modal';
import { Button }        from '../../components/ui/Button';
import { Input }         from '../../components/ui/Input';
import { Spinner }       from '../../components/ui/Spinner';
import { EmptyState }    from '../../components/ui/EmptyState';
import { SearchInput }   from '../../components/ui/SearchInput';
import { Badge }         from '../../components/ui/Badge';
import { ModalMovimiento }       from './ModalMovimiento';
import { ModalAnularMovimiento } from './ModalAnularMovimiento';
import {
  Users, Plus, ChevronLeft, ChevronRight,
  Package, ShoppingBag, Wallet, ArrowUpRight, Sliders, Trash2,
} from 'lucide-react';

// ─── Config visual por tipo ───────────────────────────────────────────────────

const TIPO_CFG = {
  entrega_producto: { label: 'Entrega producto', color: 'text-blue-600',   bg: 'bg-blue-50',   Icn: Package,       signoStr: '+' },
  recibo_producto:  { label: 'Recibe producto',  color: 'text-purple-600', bg: 'bg-purple-50', Icn: ShoppingBag,   signoStr: '−' },
  pago_recibido:    { label: 'Pago recibido',    color: 'text-green-600',  bg: 'bg-green-50',  Icn: Wallet,        signoStr: '−' },
  pago_enviado:     { label: 'Pago enviado',     color: 'text-orange-600', bg: 'bg-orange-50', Icn: ArrowUpRight,  signoStr: '−' },
  ajuste_manual:    { label: 'Ajuste manual',    color: 'text-gray-600',   bg: 'bg-gray-100',  Icn: Sliders,       signoStr: '±' },
};

const ACCIONES = [
  { tipo: 'entrega_producto', label: 'Entregar producto', cls: 'border-blue-200   text-blue-700   hover:bg-blue-50'   },
  { tipo: 'recibo_producto',  label: 'Recibir producto',  cls: 'border-purple-200 text-purple-700 hover:bg-purple-50' },
  { tipo: 'pago_recibido',    label: 'Pago recibido',     cls: 'border-green-200  text-green-700  hover:bg-green-50'  },
  { tipo: 'pago_enviado',     label: 'Pago enviado',      cls: 'border-orange-200 text-orange-700 hover:bg-orange-50' },
  { tipo: 'ajuste_manual',    label: 'Ajuste manual',     cls: 'border-gray-200   text-gray-600   hover:bg-gray-50'   },
];

// ─── Fila de movimiento ───────────────────────────────────────────────────────

function FilaMovimiento({ mov, esAdmin, onAnular }) {
  const cfg = TIPO_CFG[mov.tipo] || TIPO_CFG.ajuste_manual;
  const Icn = cfg.Icn;
  const saldo = Number(mov.saldo_acumulado ?? 0);

  return (
    <div className="flex items-center gap-3 py-3 border-b border-gray-50 last:border-0">
      {/* Ícono tipo */}
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.bg}`}>
        <Icn size={15} className={cfg.color} />
      </div>

      {/* Descripción */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 leading-tight">
          {mov.descripcion || cfg.label}
        </p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
          <span className="text-xs text-gray-400">{formatFechaHora(mov.fecha)}</span>
          {mov.imei && <span className="text-xs text-gray-400 font-mono">{mov.imei}</span>}
          {mov.usuario_nombre && <span className="text-xs text-gray-400">· {mov.usuario_nombre}</span>}
        </div>
      </div>

      {/* Valor y saldo */}
      <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
        <span className={`text-sm font-bold ${mov.signo === 1 ? 'text-red-600' : 'text-green-700'}`}>
          {mov.signo === 1 ? '+' : '−'}{formatCOP(mov.valor)}
        </span>
        <span className={`text-xs font-medium ${saldo > 0 ? 'text-gray-500' : saldo < 0 ? 'text-green-500' : 'text-gray-400'}`}>
          {formatCOP(Math.abs(saldo))}
        </span>
      </div>

      {/* Botón anular */}
      {esAdmin && (
        <button onClick={() => onAnular(mov)}
          className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50
            transition-colors flex-shrink-0"
          title="Anular movimiento">
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}

// ─── Detalle de prestatario ───────────────────────────────────────────────────

function DetallePrestatario({ prestatario, sucursalId, esAdmin, onVolver }) {
  const queryClient = useQueryClient();
  const [tipoModal, setTipoModal] = useState(null);
  const [movAnular, setMovAnular] = useState(null);

  const { data: movs, isLoading } = useQuery({
    queryKey: ['movimientos-prestatario', prestatario.id],
    queryFn:  () => getMovimientos(prestatario.id).then((r) => r.data.data),
    staleTime: 0,
  });

  const movimientos = Array.isArray(movs) ? movs : [];
  const saldo = movimientos.length > 0 ? Number(movimientos[0].saldo_acumulado ?? 0) : Number(prestatario.saldo ?? 0);

  const saldoPositivo = saldo > 0;
  const saldoNegativo = saldo < 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Volver */}
      <button onClick={onVolver}
        className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 w-fit transition-colors">
        <ChevronLeft size={16} /> Volver
      </button>

      {/* Cabecera */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-wrap items-center gap-3 shadow-sm">
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center
          text-base font-bold flex-shrink-0 select-none
          ${saldoPositivo ? 'bg-blue-100 text-blue-700' : saldoNegativo ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'}`}>
          {prestatario.nombre.slice(0, 2).toUpperCase()}
        </div>

        <div className="flex-1 min-w-0 basis-32">
          <p className="font-bold text-gray-900 text-base leading-tight">{prestatario.nombre}</p>
          {prestatario.telefono && <p className="text-xs text-gray-400 mt-0.5">Tel: {prestatario.telefono}</p>}
          <p className="text-xs text-gray-400 mt-0.5">{movimientos.length} movimiento(s)</p>
        </div>

        <div className="flex flex-col items-end flex-shrink-0 ml-auto">
          <p className="text-xs text-gray-400">Saldo</p>
          <p className={`text-xl font-bold leading-tight
            ${saldoPositivo ? 'text-blue-700' : saldoNegativo ? 'text-orange-600' : 'text-gray-400'}`}>
            {saldo !== 0 && (saldoPositivo ? '+' : '−')}{formatCOP(Math.abs(saldo))}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {saldoPositivo ? 'Te debe a ti' : saldoNegativo ? 'Le debes tú' : 'Al día'}
          </p>
        </div>
      </div>

      {/* Botones de acción */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {ACCIONES.map(({ tipo, label, cls }) => (
          <button key={tipo} onClick={() => setTipoModal(tipo)}
            className={`py-2.5 px-3 rounded-xl text-xs font-semibold border bg-white
              transition-all active:scale-95 ${cls}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Leyenda saldo */}
      <div className="flex items-center gap-4 text-xs text-gray-400 px-1">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />Cargo (+) te debe más</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Abono (−) te debe menos</span>
      </div>

      {/* Tabla de movimientos */}
      {isLoading ? (
        <Spinner className="py-16" />
      ) : movimientos.length === 0 ? (
        <div className="bg-gray-50 border border-gray-100 rounded-2xl px-4 py-8 text-center">
          <p className="text-gray-400 text-sm">Sin movimientos registrados aún</p>
          <p className="text-gray-300 text-xs mt-1">Usa los botones de arriba para registrar el primer movimiento</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
          {/* Encabezado tabla */}
          <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-100">
            <span className="flex-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">Movimiento</span>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Valor · Saldo</span>
            {esAdmin && <span className="w-7" />}
          </div>

          <div className="px-4 divide-y divide-gray-50">
            {movimientos.map((m) => (
              <FilaMovimiento key={m.id} mov={m} esAdmin={esAdmin} onAnular={setMovAnular} />
            ))}
          </div>
        </div>
      )}

      {/* Modales de movimiento */}
      {tipoModal && (
        <ModalMovimiento
          prestatario={prestatario}
          tipo={tipoModal}
          sucursalId={sucursalId}
          onClose={() => setTipoModal(null)}
        />
      )}

      {movAnular && (
        <ModalAnularMovimiento
          prestatario={prestatario}
          movimiento={movAnular}
          onClose={() => setMovAnular(null)}
        />
      )}
    </div>
  );
}

// ─── Fila de prestatario en lista ─────────────────────────────────────────────

function FilaPrestatario({ prestatario, onClick }) {
  const saldo = Number(prestatario.saldo ?? 0);
  const saldoPositivo = saldo > 0;

  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3.5 bg-white border border-gray-100
        rounded-2xl text-left hover:border-blue-200 hover:bg-blue-50/20 hover:shadow-sm
        transition-all active:scale-[0.99]">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm
        flex-shrink-0 select-none
        ${saldoPositivo ? 'bg-blue-100 text-blue-700' : saldo < 0 ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-500'}`}>
        {prestatario.nombre.slice(0, 2).toUpperCase()}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900">{prestatario.nombre}</p>
        <p className={`text-xs font-semibold mt-0.5
          ${saldoPositivo ? 'text-blue-600' : saldo < 0 ? 'text-orange-600' : 'text-gray-400'}`}>
          {saldoPositivo
            ? `Te debe: ${formatCOP(saldo)}`
            : saldo < 0
            ? `Le debes: ${formatCOP(Math.abs(saldo))}`
            : 'Al día'}
        </p>
      </div>

      {prestatario.total_empleados > 0 && (
        <Badge variant="gray">{prestatario.total_empleados} emp.</Badge>
      )}

      <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
    </button>
  );
}

// ─── Modal crear prestatario ──────────────────────────────────────────────────

function ModalNuevoPrestatario({ onClose }) {
  const queryClient = useQueryClient();
  const [nombre,   setNombre]   = useState('');
  const [telefono, setTelefono] = useState('');
  const [error,    setError]    = useState('');

  const mutation = useMutation({
    mutationFn: () => crearPrestatario({ nombre: nombre.trim(), telefono: telefono.trim() || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prestatarios'], exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al crear'),
  });

  return (
    <Modal open onClose={onClose} title="Nuevo prestatario" size="sm">
      <div className="flex flex-col gap-4">
        <Input label="Nombre *" placeholder="Nombre completo o empresa"
          value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') document.getElementById('tel-prest')?.focus(); }} />
        <Input id="tel-prest" label="Teléfono (opcional)" placeholder="3001234567"
          value={telefono} onChange={(e) => setTelefono(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && nombre.trim()) mutation.mutate(); }} />

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mutation.isPending}
            disabled={!nombre.trim()} onClick={() => mutation.mutate()}>
            Guardar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function PrestatariosPage() {
  const { esAdminNegocio } = useAuth();
  const esAdmin = esAdminNegocio();

  const sucursalActiva = useSucursalStore((s) => s.sucursalActiva);

  const [busqueda,     setBusqueda]     = useState('');
  const [seleccionado, setSeleccionado] = useState(null);
  const [modalNuevo,   setModalNuevo]   = useState(false);

  const { data: rawData, isLoading } = useQuery({
    queryKey: ['prestatarios'],
    queryFn:  () => getPrestatarios().then((r) => r.data.data),
    staleTime: 60_000,
  });

  const prestatarios = (Array.isArray(rawData) ? rawData : []).filter((p) =>
    !busqueda || p.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  // Si el prestatario seleccionado fue actualizado (saldo cambió), refrescar la referencia
  const prestatarioActual = seleccionado
    ? (prestatarios.find((p) => p.id === seleccionado.id) || seleccionado)
    : null;

  return (
    <>
      {!seleccionado ? (
        <div className="flex flex-col gap-4">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <SearchInput value={busqueda} onChange={setBusqueda} placeholder="Buscar prestatario..." />
            </div>
            <button onClick={() => setModalNuevo(true)}
              className="h-10 w-10 bg-blue-600 rounded-xl flex items-center justify-center
                hover:bg-blue-700 transition-colors flex-shrink-0">
              <Plus size={18} className="text-white" />
            </button>
          </div>

          {/* Leyenda de colores */}
          <div className="flex items-center gap-4 text-xs text-gray-400 px-1">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-blue-100 border border-blue-200 inline-block" />
              Te debe
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-orange-100 border border-orange-200 inline-block" />
              Le debes
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-gray-100 border border-gray-200 inline-block" />
              Al día
            </span>
          </div>

          {/* Lista */}
          {isLoading ? (
            <Spinner className="py-20" />
          ) : prestatarios.length === 0 ? (
            <EmptyState
              icon={Users}
              titulo="Sin prestatarios"
              descripcion={busqueda ? 'No hay resultados para tu búsqueda' : 'Crea el primero con el botón +'}
            />
          ) : (
            <div className="flex flex-col gap-2">
              {prestatarios.map((p) => (
                <FilaPrestatario key={p.id} prestatario={p} onClick={() => setSeleccionado(p)} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <DetallePrestatario
          key={prestatarioActual.id}
          prestatario={prestatarioActual}
          sucursalId={sucursalActiva}
          esAdmin={esAdmin}
          onVolver={() => setSeleccionado(null)}
        />
      )}

      {modalNuevo && <ModalNuevoPrestatario onClose={() => setModalNuevo(false)} />}
    </>
  );
}
