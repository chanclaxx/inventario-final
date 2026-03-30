import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getCreditos, getCreditoById, registrarAbonoCredito, saldarCredito, cancelarCredito } from '../../api/creditos.api';
import { formatCOP, formatFechaHora } from '../../utils/formatters';
import { Badge }       from '../../components/ui/Badge';
import { Button }      from '../../components/ui/Button';
import { Modal }       from '../../components/ui/Modal';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { Spinner }     from '../../components/ui/Spinner';
import { EmptyState }  from '../../components/ui/EmptyState';
import {
  CreditCard, Plus, CheckCircle, XCircle, AlertTriangle,
  ChevronLeft, ChevronDown, ChevronUp,
} from 'lucide-react';

// ─── Modal Abono ──────────────────────────────────────────────────────────────

function ModalAbonoCredito({ credito, onClose }) {
  const queryClient = useQueryClient();
  const [valor,  setValor]  = useState('');
  const [metodo, setMetodo] = useState('Efectivo');
  const [notas,  setNotas]  = useState('');
  const [error,  setError]  = useState('');

  const cuotaInicial   = Number(credito.cuota_inicial || 0);
  const totalAbonado   = Number(credito.total_abonado || 0);
  const valorTotal     = Number(credito.valor_total);
  const saldoPendiente = Number(credito.saldo_pendiente ?? (valorTotal - cuotaInicial - totalAbonado));

  const METODOS = ['Efectivo', 'Nequi', 'Daviplata', 'Transferencia', 'Tarjeta'];

  const mutation = useMutation({
    mutationFn: () => registrarAbonoCredito(credito.id, {
      valor: Number(valor), metodo, notas: notas || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creditos'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['credito-detalle'], exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al registrar abono'),
  });

  return (
    <Modal open onClose={onClose} title="Registrar Abono" size="sm">
      <div className="flex flex-col gap-4">
        <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-1">
          <p className="text-xs text-gray-400">Crédito — {credito.nombre_cliente}</p>
          <div className="flex justify-between mt-1">
            <span className="text-xs text-gray-400">Saldo pendiente</span>
            <span className="text-sm font-bold text-red-500">{formatCOP(saldoPendiente)}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {METODOS.map((m) => (
            <button key={m} onClick={() => setMetodo(m)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all
                ${metodo === m
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
              {m}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Valor del abono</label>
          <InputMoneda
            value={valor}
            onChange={setValor}
            placeholder="0"
            onKeyDown={(e) => e.key === 'Enter' && mutation.mutate()}
            autoFocus
            className="w-full px-3 py-2 bg-gray-100 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">
            Notas <span className="text-gray-400 font-normal">(opcional)</span>
          </label>
          <textarea rows={2} placeholder="Observaciones..."
            value={notas} onChange={(e) => setNotas(e.target.value)}
            className="w-full px-3 py-2 bg-gray-100 border-0 rounded-xl text-sm
              placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500
              focus:bg-white transition-all resize-none" />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mutation.isPending}
            disabled={!valor || Number(valor) <= 0}
            onClick={() => mutation.mutate()}>
            Registrar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal confirmar saldo ────────────────────────────────────────────────────

function ModalSaldarCredito({ credito, onClose }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');

  const cuotaInicial   = Number(credito.cuota_inicial || 0);
  const totalAbonado   = Number(credito.total_abonado || 0);
  const valorTotal     = Number(credito.valor_total);
  const saldoPendiente = Number(credito.saldo_pendiente ?? (valorTotal - cuotaInicial - totalAbonado));

  const mutation = useMutation({
    mutationFn: () => saldarCredito(credito.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creditos'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['credito-detalle'], exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al saldar crédito'),
  });

  return (
    <Modal open onClose={onClose} title="Saldar Crédito" size="sm">
      <div className="flex flex-col gap-4">
        <div className="bg-yellow-50 border border-yellow-100 rounded-xl p-3 flex flex-col gap-1">
          <p className="text-sm text-gray-700">
            ¿Marcar como saldado el crédito de <span className="font-semibold">{credito.nombre_cliente}</span>?
          </p>
          {saldoPendiente > 0 && (
            <p className="text-xs text-yellow-700 mt-1">
              Saldo pendiente: <span className="font-bold">{formatCOP(saldoPendiente)}</span>
              {' '}— se marcará como saldado sin registrar abono adicional.
            </p>
          )}
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            <CheckCircle size={15} /> Confirmar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal cancelar crédito ───────────────────────────────────────────────────

function ModalCancelarCredito({ credito, onClose }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => cancelarCredito(credito.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creditos'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['credito-detalle'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['facturas'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-serial'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['seriales'], exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al cancelar crédito'),
  });

  return (
    <Modal open onClose={onClose} title="Cancelar Crédito" size="sm">
      <div className="flex flex-col gap-4">
        <div className="bg-red-50 border border-red-100 rounded-xl p-3 flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <AlertTriangle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-red-700">
                ¿Cancelar el crédito de {credito.nombre_cliente}?
              </p>
              <p className="text-xs text-red-600">
                Esto cancelará la factura asociada y devolverá los productos al inventario.
                Esta acción no se puede deshacer.
              </p>
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>No, volver</Button>
          <Button className="flex-1 bg-red-500 hover:bg-red-600" loading={mutation.isPending}
            onClick={() => mutation.mutate()}>
            <XCircle size={15} /> Sí, cancelar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Panel detalle crédito ────────────────────────────────────────────────────

function PanelDetalleCredito({ creditoId, onVolver, onAbonar, onSaldar, onCancelar }) {
  const { data, isLoading } = useQuery({
    queryKey: ['credito-detalle', creditoId],
    queryFn:  () => getCreditoById(creditoId).then((r) => r.data.data),
    enabled:  !!creditoId,
    staleTime: 0,
  });

  if (isLoading) return <Spinner className="py-10" />;
  if (!data) return null;

  const c = data;
  const cuotaInicial   = Number(c.cuota_inicial || 0);
  const totalAbonado   = Number(c.total_abonado || 0);
  const valorTotal     = Number(c.valor_total);
  const saldoPendiente = valorTotal - cuotaInicial - totalAbonado;
  const progreso       = ((cuotaInicial + totalAbonado) / valorTotal) * 100;
  const esActivo       = c.estado === 'Activo';

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onVolver}
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 w-fit">
        <ChevronLeft size={13} /> Volver
      </button>

      <div className="bg-yellow-50 border border-yellow-100 rounded-xl p-3 flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-800">{c.nombre_cliente}</p>
          <Badge variant={esActivo ? 'yellow' : 'green'}>{c.estado}</Badge>
        </div>
        <p className="text-xs text-gray-500">
          Factura #{String(c.factura_id).padStart(6, '0')}
          {c.celular ? ` · ${c.celular}` : ''}
        </p>
        {c.cedula && <p className="text-xs text-gray-400">CC: {c.cedula}</p>}
        <p className="text-xs text-gray-400">{formatFechaHora(c.creado_en)}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="w-full bg-gray-100 rounded-full h-2">
          <div className="bg-yellow-400 h-2 rounded-full transition-all"
            style={{ width: `${Math.min(progreso, 100)}%` }} />
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">Pagado: {formatCOP(cuotaInicial + totalAbonado)}</span>
          <span className="text-red-500 font-medium">Saldo: {formatCOP(Math.max(0, saldoPendiente))}</span>
        </div>
        <div className="flex justify-between text-xs text-gray-400">
          <span>Total: {formatCOP(valorTotal)}</span>
          {cuotaInicial > 0 && <span>Cuota inicial: {formatCOP(cuotaInicial)}</span>}
        </div>
      </div>

      {c.abonos && c.abonos.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Historial de abonos
          </p>
          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
            {c.abonos.map((abono) => {
              const abonoId = abono.id;
              return (
                <div key={abonoId}
                  className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
                  <div>
                    <p className="text-xs text-gray-500">{formatFechaHora(abono.fecha)}</p>
                    <p className="text-xs text-gray-400">
                      {abono.metodo}
                      {abono.usuario_nombre ? ` · ${abono.usuario_nombre}` : ''}
                    </p>
                    {abono.notas && <p className="text-xs text-gray-400 italic">{abono.notas}</p>}
                  </div>
                  <span className="text-sm font-semibold text-green-600">
                    + {formatCOP(abono.valor)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {esActivo && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" onClick={() => onAbonar(c)}>
              <Plus size={14} /> Abonar
            </Button>
            <Button size="sm" variant="secondary" className="flex-1" onClick={() => onSaldar(c)}>
              <CheckCircle size={14} /> Saldado
            </Button>
          </div>
          <button onClick={() => onCancelar(c)}
            className="w-full py-2 rounded-xl text-xs font-medium border border-red-200
              text-red-500 bg-red-50 hover:bg-red-100 transition-colors">
            <XCircle size={13} className="inline mr-1" />
            Cancelar crédito y devolver productos
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Card de crédito ──────────────────────────────────────────────────────────

function CardCredito({ credito, onAbonar, onSaldar, onCancelar, onVerDetalle }) {
  const cuotaInicial   = Number(credito.cuota_inicial || 0);
  const totalAbonado   = Number(credito.total_abonado || 0);
  const valorTotal     = Number(credito.valor_total);
  const saldoPendiente = Number(credito.saldo_pendiente ?? (valorTotal - cuotaInicial - totalAbonado));
  const progreso       = ((cuotaInicial + totalAbonado) / valorTotal) * 100;
  const productos      = credito.productos || [];

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 truncate">{credito.nombre_cliente}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Factura #{String(credito.factura_id).padStart(6, '0')}
            {credito.celular ? ` · ${credito.celular}` : ''}
          </p>
          {credito.cedula && (
            <p className="text-xs text-gray-400">CC: {credito.cedula}</p>
          )}
        </div>
        <Badge variant={credito.estado === 'Activo' ? 'yellow' : 'green'}>
          {credito.estado}
        </Badge>
      </div>

      {/* Productos con detalle */}
      {productos.length > 0 && (
        <div className="bg-gray-50 rounded-xl p-2.5 flex flex-col gap-1.5">
          {productos.map((prod, idx) => {
            const prodKey = `${credito.id}-${idx}`;
            return (
              <div key={prodKey} className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-700 truncate">{prod.nombre}</p>
                  {prod.imei && (
                    <p className="text-[11px] text-gray-400 font-mono">{prod.imei}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {Number(prod.cantidad) > 1 && (
                    <span className="text-[11px] text-gray-400">x{prod.cantidad}</span>
                  )}
                  <span className="text-xs font-semibold text-gray-600">
                    {formatCOP(prod.precio)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Barra de progreso */}
      <div className="flex flex-col gap-1">
        <div className="w-full bg-gray-100 rounded-full h-1.5">
          <div className="bg-yellow-400 h-1.5 rounded-full transition-all"
            style={{ width: `${Math.min(progreso, 100)}%` }} />
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">Pagado: {formatCOP(cuotaInicial + totalAbonado)}</span>
          <span className="text-red-500 font-medium">Saldo: {formatCOP(Math.max(0, saldoPendiente))}</span>
        </div>
      </div>

      {/* Acciones */}
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" onClick={() => onAbonar(credito)}>
          <Plus size={14} /> Abonar
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onSaldar(credito)}>
          <CheckCircle size={14} /> Saldado
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <button onClick={() => onVerDetalle(credito.id)}
          className="text-xs text-yellow-600 hover:text-yellow-700 transition-colors">
          Ver detalle y abonos →
        </button>
        <button onClick={() => onCancelar(credito)}
          className="text-xs text-red-400 hover:text-red-600 transition-colors">
          Cancelar crédito
        </button>
      </div>
    </div>
  );
}

// ─── Sección colapsable de créditos saldados ─────────────────────────────────

function CreditosSaldados({ creditos }) {
  const [abierto, setAbierto] = useState(false);

  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden mt-2">
      <button onClick={() => setAbierto((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5
          bg-gray-50 hover:bg-gray-100 transition-colors">
        <span className="text-xs font-semibold text-gray-500">
          {creditos.length} crédito{creditos.length !== 1 ? 's' : ''} cerrado{creditos.length !== 1 ? 's' : ''}
        </span>
        {abierto
          ? <ChevronUp   size={15} className="text-gray-400" />
          : <ChevronDown size={15} className="text-gray-400" />}
      </button>

      {abierto && (
        <div className="flex flex-col gap-2 p-3">
          {creditos.map((c) => {
            const creditoId   = c.id;
            const esCancelado = c.estado === 'Cancelado';
            return (
              <div key={creditoId}
                className="bg-gray-50 border border-gray-100 rounded-xl p-3
                  flex justify-between items-center">
                <div>
                  <p className="text-sm font-medium text-gray-600">{c.nombre_cliente}</p>
                  <p className="text-xs text-gray-400">
                    Factura #{String(c.factura_id).padStart(6, '0')}
                    {' · '}{formatCOP(c.valor_total)}
                  </p>
                </div>
                <Badge variant={esCancelado ? 'red' : 'green'}>{c.estado}</Badge>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Componente principal del tab ─────────────────────────────────────────────

export function TabCreditos() {
  const [creditoAbono,    setCreditoAbono]    = useState(null);
  const [creditoSaldar,   setCreditoSaldar]   = useState(null);
  const [creditoCancelar, setCreditoCancelar] = useState(null);
  const [creditoDetalle,  setCreditoDetalle]  = useState(null);

  const { data: creditosData, isLoading } = useQuery({
    queryKey: ['creditos'],
    queryFn:  () => getCreditos().then((r) => r.data.data),
  });

  const creditos         = creditosData || [];
  const creditosActivos  = creditos.filter((c) => c.estado === 'Activo');
  const creditosCerrados = creditos.filter((c) => c.estado !== 'Activo');

  // ── Vista detalle ──────────────────────────────────────────────────────────
  if (creditoDetalle) {
    return (
      <>
        <PanelDetalleCredito
          creditoId={creditoDetalle}
          onVolver={() => setCreditoDetalle(null)}
          onAbonar={setCreditoAbono}
          onSaldar={setCreditoSaldar}
          onCancelar={setCreditoCancelar}
        />

        {creditoAbono && (
          <ModalAbonoCredito credito={creditoAbono} onClose={() => setCreditoAbono(null)} />
        )}
        {creditoSaldar && (
          <ModalSaldarCredito credito={creditoSaldar} onClose={() => setCreditoSaldar(null)} />
        )}
        {creditoCancelar && (
          <ModalCancelarCredito credito={creditoCancelar} onClose={() => { setCreditoCancelar(null); setCreditoDetalle(null); }} />
        )}
      </>
    );
  }

  // ── Vista lista ────────────────────────────────────────────────────────────
  if (isLoading) return <Spinner className="py-20" />;

  return (
    <>
      <div className="flex flex-col gap-3">
        {creditosActivos.length === 0 ? (
          <EmptyState icon={CreditCard} titulo="Sin créditos activos"
            descripcion="Los créditos aparecen al crear facturas a crédito" />
        ) : (
          creditosActivos.map((c) => {
            const creditoId = c.id;
            return (
              <CardCredito
                key={creditoId}
                credito={c}
                onAbonar={setCreditoAbono}
                onSaldar={setCreditoSaldar}
                onCancelar={setCreditoCancelar}
                onVerDetalle={setCreditoDetalle}
              />
            );
          })
        )}

        {creditosCerrados.length > 0 && (
          <CreditosSaldados creditos={creditosCerrados} />
        )}
      </div>

      {creditoAbono && (
        <ModalAbonoCredito credito={creditoAbono} onClose={() => setCreditoAbono(null)} />
      )}
      {creditoSaldar && (
        <ModalSaldarCredito credito={creditoSaldar} onClose={() => setCreditoSaldar(null)} />
      )}
      {creditoCancelar && (
        <ModalCancelarCredito credito={creditoCancelar} onClose={() => setCreditoCancelar(null)} />
      )}
    </>
  );
}