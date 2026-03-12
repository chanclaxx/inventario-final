import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPrestamos, registrarAbonoPrestamo, devolverPrestamo } from '../../api/prestamos.api';
import { getCreditos, registrarAbonoCredito }                     from '../../api/creditos.api';
import { formatCOP, formatFechaHora }   from '../../utils/formatters';
import { Badge }                        from '../../components/ui/Badge';
import { Button }                       from '../../components/ui/Button';
import { Modal }                        from '../../components/ui/Modal';
import { Input }                        from '../../components/ui/Input';
import { Spinner }                      from '../../components/ui/Spinner';
import { EmptyState }                   from '../../components/ui/EmptyState';
import { Handshake, CreditCard, Plus, CheckCircle, ChevronDown, ChevronUp } from 'lucide-react';

const TABS = [
  { id: 'prestamos', label: 'Préstamos', icon: Handshake },
  { id: 'creditos',  label: 'Créditos',  icon: CreditCard },
];

// ── Modal Abono Préstamo ───────────────────────────────────────────────────
function ModalAbonoPrestamo({ prestamo, onClose }) {
  const queryClient = useQueryClient();
  const [valor, setValor] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => registrarAbonoPrestamo(prestamo.id, Number(valor)),
    onSuccess: () => { queryClient.invalidateQueries(['prestamos']); onClose(); },
    onError:   (err) => setError(err.response?.data?.error || 'Error al registrar abono'),
  });

  const saldoPendiente = Number(prestamo.valor_prestamo) - Number(prestamo.total_abonado);

  return (
    <Modal open={!!prestamo} onClose={onClose} title="Registrar Abono" size="sm">
      <div className="flex flex-col gap-4">
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-xs text-gray-400">Préstamo — {prestamo.prestatario}</p>
          <p className="text-xs text-gray-500 mt-0.5">{prestamo.nombre_producto}</p>
          {prestamo.empleado_nombre && (
            <p className="text-xs text-blue-500 mt-0.5">Empleado: {prestamo.empleado_nombre}</p>
          )}
          <div className="flex justify-between mt-2">
            <span className="text-xs text-gray-400">Saldo pendiente</span>
            <span className="text-sm font-bold text-red-500">{formatCOP(saldoPendiente)}</span>
          </div>
        </div>
        <Input
          label="Valor del abono"
          type="number"
          placeholder="0"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && mutation.mutate()}
          autoFocus
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

// ── Modal Abono Crédito ───────────────────────────────────────────────────
function ModalAbonoCredito({ credito, onClose }) {
  const queryClient = useQueryClient();
  const [valor,  setValor]  = useState('');
  const [metodo, setMetodo] = useState('Efectivo');
  const [error,  setError]  = useState('');

  const mutation = useMutation({
    mutationFn: () => registrarAbonoCredito(credito.id, { valor: Number(valor), metodo }),
    onSuccess: () => { queryClient.invalidateQueries(['creditos']); onClose(); },
    onError:   (err) => setError(err.response?.data?.error || 'Error al registrar abono'),
  });

  const saldoPendiente = Number(credito.valor_total) - Number(credito.total_abonado);

  return (
    <Modal open={!!credito} onClose={onClose} title="Registrar Abono" size="sm">
      <div className="flex flex-col gap-4">
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-xs text-gray-400">Crédito — {credito.nombre_cliente}</p>
          <div className="flex justify-between mt-2">
            <span className="text-xs text-gray-400">Saldo pendiente</span>
            <span className="text-sm font-bold text-red-500">{formatCOP(saldoPendiente)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {['Efectivo', 'Nequi', 'Transferencia'].map((m) => (
            <button
              key={m}
              onClick={() => setMetodo(m)}
              className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-all
                ${metodo === m
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-gray-50 border-gray-200 text-gray-600'}`}
            >
              {m}
            </button>
          ))}
        </div>
        <Input
          label="Valor del abono"
          type="number"
          placeholder="0"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && mutation.mutate()}
          autoFocus
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

// ── Card de un préstamo individual ────────────────────────────────────────
function CardPrestamo({ prestamo, onAbonar, onDevolver }) {
  const saldo    = Number(prestamo.valor_prestamo) - Number(prestamo.total_abonado);
  const progreso = (Number(prestamo.total_abonado) / Number(prestamo.valor_prestamo)) * 100;

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-800 truncate">{prestamo.nombre_producto}</p>
          {prestamo.imei && (
            <p className="text-xs text-gray-400 font-mono">{prestamo.imei}</p>
          )}
          {prestamo.empleado_nombre && (
            <p className="text-xs text-blue-500 mt-0.5">→ {prestamo.empleado_nombre}</p>
          )}
          <p className="text-xs text-gray-400 mt-0.5">{formatFechaHora(prestamo.fecha)}</p>
        </div>
        <Badge variant={prestamo.estado === 'Activo' ? 'blue' : 'green'}>
          {prestamo.estado}
        </Badge>
      </div>

      <div className="flex flex-col gap-1">
        <div className="w-full bg-gray-100 rounded-full h-1.5">
          <div
            className="bg-blue-500 h-1.5 rounded-full transition-all"
            style={{ width: `${Math.min(progreso, 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">Abonado: {formatCOP(prestamo.total_abonado)}</span>
          <span className="text-red-500 font-medium">Saldo: {formatCOP(saldo)}</span>
        </div>
      </div>

      <div className="flex gap-2">
        <Button size="sm" className="flex-1" onClick={() => onAbonar(prestamo)}>
          <Plus size={14} /> Abonar
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onDevolver(prestamo.id)}>
          <CheckCircle size={14} /> Devuelto
        </Button>
      </div>
    </div>
  );
}

// ── Grupo de préstamos por prestatario ────────────────────────────────────
function GrupoPrestatario({ nombre, prestamos, saldoTotal, onAbonar, onDevolver }) {
  const [abierto, setAbierto] = useState(true);
  const activos = prestamos.filter((p) => p.estado === 'Activo');

  return (
    <div className="border border-gray-100 rounded-2xl overflow-hidden">
      <button
        onClick={() => setAbierto((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3
          bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-semibold text-gray-800 truncate">{nombre}</span>
          <span className="text-xs text-gray-400 flex-shrink-0">
            {activos.length} activo(s)
          </span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {saldoTotal > 0 && (
            <span className="text-sm font-bold text-red-500">
              {formatCOP(saldoTotal)}
            </span>
          )}
          {abierto
            ? <ChevronUp size={16} className="text-gray-400" />
            : <ChevronDown size={16} className="text-gray-400" />
          }
        </div>
      </button>

      {abierto && (
        <div className="flex flex-col gap-3 p-3">
          {activos.length === 0 ? (
            <p className="text-xs text-gray-400 px-1 py-2">Sin préstamos activos</p>
          ) : (
            activos.map((p) => (
              <CardPrestamo
                key={p.id}
                prestamo={p}
                onAbonar={onAbonar}
                onDevolver={onDevolver}
              />
            ))
          )}

          {/* Cerrados colapsables dentro del grupo */}
          {prestamos.filter((p) => p.estado !== 'Activo').length > 0 && (
            <details>
              <summary className="text-xs text-gray-400 cursor-pointer select-none px-1">
                Ver {prestamos.filter((p) => p.estado !== 'Activo').length} cerrado(s)
              </summary>
              <div className="flex flex-col gap-2 mt-2">
                {prestamos.filter((p) => p.estado !== 'Activo').map((p) => (
                  <div key={p.id} className="bg-gray-50 border border-gray-100 rounded-xl p-3 flex justify-between items-center">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-600 truncate">{p.nombre_producto}</p>
                      {p.empleado_nombre && (
                        <p className="text-xs text-gray-400">→ {p.empleado_nombre}</p>
                      )}
                    </div>
                    <Badge variant={p.estado === 'Saldado' ? 'green' : 'gray'}>{p.estado}</Badge>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────
export default function PrestamosPage() {
  const [tabActiva,      setTabActiva]      = useState('prestamos');
  const [prestamoAbono,  setPrestamoAbono]  = useState(null);
  const [creditoAbono,   setCreditoAbono]   = useState(null);
  const queryClient = useQueryClient();

  const { data: prestamosData, isLoading: loadingP } = useQuery({
    queryKey: ['prestamos'],
    queryFn:  () => getPrestamos().then((r) => r.data.data),
  });

  const { data: creditosData, isLoading: loadingC } = useQuery({
    queryKey: ['creditos'],
    queryFn:  () => getCreditos().then((r) => r.data.data),
  });

  const mutDevolver = useMutation({
    mutationFn: devolverPrestamo,
    onSuccess:  () => queryClient.invalidateQueries(['prestamos']),
  });

  const prestamos = prestamosData || [];
  const creditos  = creditosData  || [];

  // Agrupar préstamos: compañeros por prestatario_id, clientes como grupo propio
  const grupos = prestamos.reduce((acc, p) => {
    const key = p.prestatario_id ? `prestatario_${p.prestatario_id}` : 'clientes';
    const nombre = p.prestatario_id ? p.prestatario : 'Clientes';
    if (!acc[key]) acc[key] = { nombre, prestamos: [], saldoTotal: 0 };
    acc[key].prestamos.push(p);
    if (p.estado === 'Activo') {
      acc[key].saldoTotal += Number(p.valor_prestamo) - Number(p.total_abonado);
    }
    return acc;
  }, {});

  const creditosActivos  = creditos.filter((c) => c.estado === 'Activo');
  const creditosSaldados = creditos.filter((c) => c.estado !== 'Activo');

  return (
    <div className="flex flex-col gap-4">

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {TABS.map((tab) => {
          const TabIcon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setTabActiva(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
                ${tabActiva === tab.id
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'}`}
            >
              <TabIcon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* PRÉSTAMOS */}
      {tabActiva === 'prestamos' && (
        <div className="flex flex-col gap-3">
          {loadingP ? (
            <Spinner className="py-20" />
          ) : Object.keys(grupos).length === 0 ? (
            <EmptyState icon={Handshake} titulo="Sin préstamos activos" />
          ) : (
            Object.entries(grupos).map(([key, grupo]) => (
              <GrupoPrestatario
                key={key}
                nombre={grupo.nombre}
                prestamos={grupo.prestamos}
                saldoTotal={grupo.saldoTotal}
                onAbonar={setPrestamoAbono}
                onDevolver={(id) => mutDevolver.mutate(id)}
              />
            ))
          )}
        </div>
      )}

      {/* CRÉDITOS */}
      {tabActiva === 'creditos' && (
        <div className="flex flex-col gap-3">
          {loadingC ? (
            <Spinner className="py-20" />
          ) : (
            <>
              {creditosActivos.length === 0 ? (
                <EmptyState icon={CreditCard} titulo="Sin créditos activos" />
              ) : (
                creditosActivos.map((c) => {
                  const saldo    = Number(c.valor_total) - Number(c.total_abonado);
                  const progreso = (Number(c.total_abonado) / Number(c.valor_total)) * 100;
                  return (
                    <div key={c.id} className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-col gap-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold text-gray-900">{c.nombre_cliente}</p>
                          <p className="text-xs text-gray-400 mt-0.5">Factura #{c.factura_id}</p>
                          {c.fecha_limite && (
                            <p className="text-xs text-gray-400">Vence: {c.fecha_limite}</p>
                          )}
                        </div>
                        <Badge variant={c.estado === 'Activo' ? 'yellow' : 'green'}>
                          {c.estado}
                        </Badge>
                      </div>
                      <div className="flex flex-col gap-1">
                        <div className="w-full bg-gray-100 rounded-full h-1.5">
                          <div
                            className="bg-yellow-400 h-1.5 rounded-full transition-all"
                            style={{ width: `${Math.min(progreso, 100)}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-400">Abonado: {formatCOP(c.total_abonado)}</span>
                          <span className="text-red-500 font-medium">Saldo: {formatCOP(saldo)}</span>
                        </div>
                      </div>
                      <Button size="sm" className="w-full" onClick={() => setCreditoAbono(c)}>
                        <Plus size={14} /> Registrar abono
                      </Button>
                    </div>
                  );
                })
              )}

              {creditosSaldados.length > 0 && (
                <details className="mt-2">
                  <summary className="text-xs text-gray-400 cursor-pointer select-none">
                    Ver {creditosSaldados.length} crédito(s) cerrado(s)
                  </summary>
                  <div className="flex flex-col gap-2 mt-2">
                    {creditosSaldados.map((c) => (
                      <div key={c.id} className="bg-gray-50 border border-gray-100 rounded-xl p-3 flex justify-between items-center">
                        <div>
                          <p className="text-sm font-medium text-gray-600">{c.nombre_cliente}</p>
                          <p className="text-xs text-gray-400">Factura #{c.factura_id}</p>
                        </div>
                        <Badge variant="green">{c.estado}</Badge>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      )}

      {prestamoAbono && (
        <ModalAbonoPrestamo prestamo={prestamoAbono} onClose={() => setPrestamoAbono(null)} />
      )}
      {creditoAbono && (
        <ModalAbonoCredito credito={creditoAbono} onClose={() => setCreditoAbono(null)} />
      )}
    </div>
  );
}