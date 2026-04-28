import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPrestamos, registrarAbonoPrestamo, devolverPrestamo, devolverParcialPrestamo } from '../../api/prestamos.api';
import {
  getDomiciliarios,
  getEntregas,
  getEntregaById,
  registrarAbono    as registrarAbonoDomicilio,
  marcarDevolucion  as marcarDevolucionDomicilio,
} from '../../api/domiciliarios.api';
import { getFacturaById }         from '../../api/facturas.api';
import { getGarantiasPorFactura } from '../../api/garantias.api';
import { formatCOP, formatFechaHora }           from '../../utils/formatters';
import { Badge }                                from '../../components/ui/Badge';
import { Button }                               from '../../components/ui/Button';
import { Modal }                                from '../../components/ui/Modal';
import { Input }                                from '../../components/ui/Input';
import { InputMoneda }                          from '../../components/ui/InputMoneda';
import { Spinner }                              from '../../components/ui/Spinner';
import { EmptyState }                           from '../../components/ui/EmptyState';
import { FacturaTermica }                       from '../../components/FacturaTermica';
import { ModalImprimirFactura }                 from '../../components/ui/ModalImprimirFactura';
import { TabCreditos }                          from './TabCreditos';
import { useMetodosPago }                       from '../../hooks/useMetodosPago';
import useExportarPdfPrestamos                  from '../../hooks/useExportarPdfPrestamos';
import api                                      from '../../api/axios.config';
import {
  Handshake, CreditCard, Bike, Plus, CheckCircle,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  Users, User, AlertTriangle, FileDown, Loader2,
} from 'lucide-react';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TABS_PRINCIPALES = [
  { id: 'prestamos',     label: 'Préstamos',     Icn: Handshake },
  { id: 'creditos',      label: 'Créditos',      Icn: CreditCard },
  { id: 'domiciliarios', label: 'Domiciliarios', Icn: Bike },
];

const TABS_PRESTAMOS = [
  { id: 'companeros', label: 'Compañeros', Icn: User  },
  { id: 'clientes',   label: 'Clientes',   Icn: Users },
];

const ESTADO_ENTREGA_BADGE = {
  Pendiente:    'yellow',
  Entregado:    'green',
  No_entregado: 'red',
};

const ESTADO_ENTREGA_LABEL = {
  Pendiente:    'Pendiente',
  Entregado:    'Entregado',
  No_entregado: 'No entregado',
};

// ─── Helper: parsear lista de colores desde config ────────────────────────────
function parsearColoresConfig(configData) {
  try {
    const lista = JSON.parse(configData?.colores_serial_lista || '[]');
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

// ─── Hook: config de colores ──────────────────────────────────────────────────
function useColoresConfig() {
  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
  });
  return {
    coloresActivo: configData?.colores_serial_activo === '1',
    coloresConfig: parsearColoresConfig(configData),
  };
}

// ─── Chip de color ────────────────────────────────────────────────────────────
function ChipColor({ color }) {
  if (!color) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full bg-gray-400 flex-shrink-0 border border-gray-300" />
      <span className="text-xs text-gray-500">{color}</span>
    </span>
  );
}

// ─── Botón exportar PDF ───────────────────────────────────────────────────────

function BotonExportarPdf({ tipo, personaId, nombrePersona }) {
  const { exportando, exportarPdf } = useExportarPdfPrestamos();

  const handleClick = async (e) => {
    e.stopPropagation();
    try {
      const nombreArchivo = `prestamos-activos-${nombrePersona.replace(/\s+/g, '-').toLowerCase()}`;
      await exportarPdf(tipo, personaId, nombreArchivo);
    } catch (err) {
      alert(err.message || 'Error al generar el PDF');
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={exportando}
      title="Exportar préstamos activos en PDF"
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium
        border border-blue-200 text-blue-600 bg-blue-50
        hover:bg-blue-100 hover:border-blue-300 transition-colors
        disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
    >
      {exportando
        ? <Loader2 size={12} className="animate-spin" />
        : <FileDown size={12} />}
      Exportar PDF
    </button>
  );
}

// ─── Hook interno: carga factura recién creada al saldar ─────────────────────

function useFacturaSaldada(facturaId) {
  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
    enabled:  !!facturaId,
  });

  const { data: facturaData } = useQuery({
    queryKey: ['factura-detalle', facturaId],
    queryFn:  () => getFacturaById(facturaId).then((r) => r.data.data),
    enabled:  !!facturaId,
    staleTime: 0,
  });

  const { data: garantiasData = [] } = useQuery({
    queryKey: ['garantias-factura', facturaId],
    queryFn:  () => getGarantiasPorFactura(facturaId).then((r) => r.data.data),
    enabled:  !!facturaId,
    staleTime: 0,
  });

  const facturaConConfig = facturaData && configData
    ? { ...facturaData, config: configData }
    : null;

  return { facturaConConfig, garantias: garantiasData };
}

// ─── Modal Abono Préstamo ─────────────────────────────────────────────────────

function ModalAbonoPrestamo({ prestamo, onClose }) {
  const queryClient = useQueryClient();
  const metodosPago = useMetodosPago();

  const [valor,             setValor]             = useState('');
  const [metodo,            setMetodo]            = useState('Efectivo');
  const [error,             setError]             = useState('');
  const [facturaId,         setFacturaId]         = useState(null);
  const [mostrarOpcionFact, setMostrarOpcionFact] = useState(false);
  const [modalImprimir,     setModalImprimir]     = useState(null);
  const [facturaTermica,    setFacturaTermica]    = useState(null);

  const { facturaConConfig, garantias } = useFacturaSaldada(facturaId);

  const saldoPendiente = Number(prestamo.valor_prestamo) - Number(prestamo.total_abonado);

  const mutation = useMutation({
    mutationFn: () => registrarAbonoPrestamo(prestamo.id, Number(valor), metodo),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['prestamos'],  exact: false });
      queryClient.invalidateQueries({ queryKey: ['facturas'],   exact: false });

      const data = res.data?.data;
      if (data?.saldado && data?.factura_id) {
        setFacturaId(data.factura_id);
        setMostrarOpcionFact(true);
      } else {
        onClose();
      }
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al registrar abono'),
  });

  const handleRegistrar = () => {
    setError('');
    if (!valor || Number(valor) <= 0) return setError('El valor debe ser mayor a 0');
    mutation.mutate();
  };

  const handleNoFactura = () => onClose();

  const handleSiFactura = () => {
    if (!facturaConConfig) return;
    setMostrarOpcionFact(false);
    setModalImprimir({ factura: facturaConConfig, garantias });
  };

  // Pantalla post-saldo: preguntar si genera factura
  if (mostrarOpcionFact) {
    return (
      <>
        <Modal open onClose={handleNoFactura} title="Préstamo saldado" size="sm">
          <div className="flex flex-col gap-5">
            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-center">
              <p className="text-green-700 font-semibold text-sm">
                ✓ El préstamo quedó completamente saldado
              </p>
              <p className="text-green-600 text-xs mt-1">
                {prestamo.nombre_producto} — {prestamo.prestatario}
              </p>
            </div>
            <p className="text-sm text-gray-600 text-center">
              ¿Deseas generar una factura por este pago?
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={handleNoFactura}>
                No, cerrar
              </Button>
              <Button
                className="flex-1"
                disabled={!facturaConConfig}
                loading={!facturaConConfig}
                onClick={handleSiFactura}
              >
                Sí, generar factura
              </Button>
            </div>
          </div>
        </Modal>

        {modalImprimir && (
          <ModalImprimirFactura
            open
            onClose={() => { setModalImprimir(null); onClose(); }}
            factura={modalImprimir.factura}
            garantias={modalImprimir.garantias}
            onImprimirPos={(f, g) => {
              setModalImprimir(null);
              setFacturaTermica({ factura: f, garantias: g });
            }}
          />
        )}

        {facturaTermica && (
          <FacturaTermica
            factura={facturaTermica.factura}
            garantias={facturaTermica.garantias}
            onClose={() => { setFacturaTermica(null); onClose(); }}
          />
        )}
      </>
    );
  }

  // Pantalla normal de abono
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
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Valor del abono</label>
          <InputMoneda
            value={valor}
            onChange={setValor}
            placeholder="0"
            onKeyDown={(e) => e.key === 'Enter' && handleRegistrar()}
            autoFocus
            className="w-full px-3 py-2 bg-gray-100 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Método de pago</label>
          <div className="flex flex-wrap gap-2">
            {metodosPago.map((m) => {
              const mId    = m.id;
              const mLabel = m.label;
              return (
                <button key={mId} type="button" onClick={() => setMetodo(mId)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all
                    ${metodo === mId
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
          <Button className="flex-1" loading={mutation.isPending} onClick={handleRegistrar}>
            Registrar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal Devolución préstamo ────────────────────────────────────────────────
function ModalDevolucion({ prestamo, onClose }) {
  const queryClient = useQueryClient();
  const [cantidad, setCantidad] = useState('');
  const [error,    setError]    = useState('');

  const esPorCantidad = !prestamo.imei;
  const cantidadMax   = Number(prestamo.cantidad_prestada) || 1;

  const mutDevolver = useMutation({
    mutationFn: () => devolverPrestamo(prestamo.id),
    onSuccess:  () => { queryClient.invalidateQueries(['prestamos']); onClose(); },
    onError:    (err) => setError(err.response?.data?.error || 'Error al registrar devolución'),
  });

  const mutDevolverParcial = useMutation({
    mutationFn: (cant) => devolverParcialPrestamo(prestamo.id, cant),
    onSuccess:  () => { queryClient.invalidateQueries(['prestamos']); onClose(); },
    onError:    (err) => setError(err.response?.data?.error || 'Error al registrar devolución'),
  });

  const handleConfirmar = () => {
    setError('');
    if (!esPorCantidad || cantidadMax === 1) { mutDevolver.mutate(); return; }
    const cant = Number(cantidad);
    if (!cantidad || cant < 1 || cant > cantidadMax)
      return setError(`Ingresa una cantidad entre 1 y ${cantidadMax}`);
    cant === cantidadMax ? mutDevolver.mutate() : mutDevolverParcial.mutate(cant);
  };

  const isPending = mutDevolver.isPending || mutDevolverParcial.isPending;

  return (
    <Modal open={!!prestamo} onClose={onClose} title="Registrar Devolución" size="sm">
      <div className="flex flex-col gap-4">
        <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-1">
          <p className="text-xs text-gray-400">{prestamo.prestatario}</p>
          <p className="text-sm font-medium text-gray-800">{prestamo.nombre_producto}</p>
          {prestamo.imei && <p className="text-xs text-gray-400 font-mono">IMEI: {prestamo.imei}</p>}
          {esPorCantidad && (
            <p className="text-xs text-gray-500">
              Cantidad prestada: <span className="font-semibold">{cantidadMax}</span>
            </p>
          )}
        </div>
        {esPorCantidad && cantidadMax > 1 ? (
          <div className="flex flex-col gap-1">
            <Input label={`¿Cuántas unidades devuelve? (máx. ${cantidadMax})`}
              type="number" min="1" max={cantidadMax} placeholder={String(cantidadMax)}
              value={cantidad} onChange={(e) => setCantidad(e.target.value)} autoFocus />
            {cantidad && Number(cantidad) < cantidadMax && Number(cantidad) > 0 && (
              <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-1.5">
                Quedarán <strong>{cantidadMax - Number(cantidad)}</strong> unidad(es) pendiente(s).
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-600">¿Confirmas que el equipo fue devuelto?</p>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={isPending} onClick={handleConfirmar}>
            <CheckCircle size={15} /> Confirmar devolución
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Cards préstamos ──────────────────────────────────────────────────────────

function CardPrestamoCompanero({ prestamo, onAbonar, onDevolver, coloresActivo }) {
  const saldo    = Number(prestamo.valor_prestamo) - Number(prestamo.total_abonado);
  const progreso = (Number(prestamo.total_abonado) / Number(prestamo.valor_prestamo)) * 100;

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-800 truncate">{prestamo.nombre_producto}</p>
          {prestamo.imei && <p className="text-xs text-gray-400 font-mono">{prestamo.imei}</p>}
          {!prestamo.imei && prestamo.cantidad_prestada > 1 && (
            <p className="text-xs text-gray-400">Cantidad: {prestamo.cantidad_prestada}</p>
          )}
          {coloresActivo && prestamo.serial_color && (
            <ChipColor color={prestamo.serial_color} />
          )}
          {prestamo.empleado_nombre && (
            <p className="text-xs text-blue-500 mt-0.5">→ {prestamo.empleado_nombre}</p>
          )}
          <p className="text-xs text-gray-400 mt-0.5">{formatFechaHora(prestamo.fecha)}</p>
        </div>
        <Badge variant={prestamo.estado === 'Activo' ? 'blue' : 'green'}>{prestamo.estado}</Badge>
      </div>
      <div className="flex flex-col gap-1">
        <div className="w-full bg-gray-100 rounded-full h-1.5">
          <div className="bg-blue-500 h-1.5 rounded-full transition-all"
            style={{ width: `${Math.min(progreso, 100)}%` }} />
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
        <Button size="sm" variant="secondary" onClick={() => onDevolver(prestamo)}>
          <CheckCircle size={14} /> Devuelto
        </Button>
      </div>
    </div>
  );
}

function CardPrestamoCliente({ prestamo, onAbonar, onDevolver }) {
  const saldo    = Number(prestamo.valor_prestamo) - Number(prestamo.total_abonado);
  const progreso = (Number(prestamo.total_abonado) / Number(prestamo.valor_prestamo)) * 100;

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-800 truncate">{prestamo.nombre_producto}</p>
          {prestamo.imei && <p className="text-xs text-gray-400 font-mono">{prestamo.imei}</p>}
          {!prestamo.imei && prestamo.cantidad_prestada > 1 && (
            <p className="text-xs text-gray-400">Cantidad: {prestamo.cantidad_prestada}</p>
          )}
          <p className="text-xs text-gray-400 mt-0.5">{formatFechaHora(prestamo.fecha)}</p>
        </div>
        <Badge variant={prestamo.estado === 'Activo' ? 'blue' : 'green'}>{prestamo.estado}</Badge>
      </div>
      {(prestamo.cedula || prestamo.telefono) && (
        <div className="bg-gray-50 rounded-xl px-3 py-2 flex flex-col gap-0.5">
          {prestamo.cedula   && <p className="text-xs text-gray-500">CC: {prestamo.cedula}</p>}
          {prestamo.telefono && <p className="text-xs text-gray-500">Tel: {prestamo.telefono}</p>}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <div className="w-full bg-gray-100 rounded-full h-1.5">
          <div className="bg-blue-500 h-1.5 rounded-full transition-all"
            style={{ width: `${Math.min(progreso, 100)}%` }} />
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
        <Button size="sm" variant="secondary" onClick={() => onDevolver(prestamo)}>
          <CheckCircle size={14} /> Devuelto
        </Button>
      </div>
    </div>
  );
}

// ─── Grupo colapsable ─────────────────────────────────────────────────────────

function GrupoPrestatario({ nombre, tipo, personaId, prestamos, saldoTotal, onAbonar, onDevolver, CardItem, coloresActivo }) {
  const [abierto, setAbierto] = useState(true);
  const activos  = prestamos.filter((p) => p.estado === 'Activo');
  const cerrados = prestamos.filter((p) => p.estado !== 'Activo');
  const Card     = CardItem;

  return (
    <div className="border border-gray-100 rounded-2xl overflow-hidden">
      <button
        onClick={() => setAbierto((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3
          bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-semibold text-gray-800 truncate">{nombre}</span>
          <span className="text-xs text-gray-400 flex-shrink-0">{activos.length} activo(s)</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {saldoTotal > 0 && (
            <span className="text-sm font-bold text-red-500">{formatCOP(saldoTotal)}</span>
          )}
          {activos.length > 0 && (
            <BotonExportarPdf tipo={tipo} personaId={personaId} nombrePersona={nombre} />
          )}
          {abierto
            ? <ChevronUp   size={16} className="text-gray-400" />
            : <ChevronDown size={16} className="text-gray-400" />}
        </div>
      </button>

      {abierto && (
        <div className="flex flex-col gap-3 p-3">
          {activos.length === 0 ? (
            <p className="text-xs text-gray-400 px-1 py-2">Sin préstamos activos</p>
          ) : (
            activos.map((p) => (
              <Card
                key={p.id}
                prestamo={p}
                onAbonar={onAbonar}
                onDevolver={onDevolver}
                coloresActivo={coloresActivo}
              />
            ))
          )}
          {cerrados.length > 0 && (
            <details>
              <summary className="text-xs text-gray-400 cursor-pointer select-none px-1">
                Ver {cerrados.length} cerrado(s)
              </summary>
              <div className="flex flex-col gap-2 mt-2">
                {cerrados.map((p) => {
                  const prestamoCerradoId = p.id;
                  const esSaldado         = p.estado === 'Saldado';
                  return (
                    <div key={prestamoCerradoId}
                      className="bg-gray-50 border border-gray-100 rounded-xl p-3 flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-600 truncate">{p.nombre_producto}</p>
                          {p.imei && <p className="text-xs text-gray-400 font-mono">{p.imei}</p>}
                          {!p.imei && p.cantidad_prestada > 1 && (
                            <p className="text-xs text-gray-400">Cantidad: {p.cantidad_prestada}</p>
                          )}
                          {p.empleado_nombre && (
                            <p className="text-xs text-gray-400">→ {p.empleado_nombre}</p>
                          )}
                        </div>
                        <Badge variant={esSaldado ? 'green' : 'gray'} className="flex-shrink-0">
                          {p.estado}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-xs border-t border-gray-100 pt-2">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-gray-400">
                            Valor: <span className="text-gray-600 font-medium">{formatCOP(Number(p.valor_prestamo))}</span>
                          </span>
                          {esSaldado && (
                            <span className="text-green-600 font-medium">
                              ✓ Abonado: {formatCOP(Number(p.total_abonado))}
                            </span>
                          )}
                          {!esSaldado && (
                            <span className="text-gray-400">
                              Abonado: <span className="text-gray-600">{formatCOP(Number(p.total_abonado))}</span>
                            </span>
                          )}
                        </div>
                        <span className="text-gray-400">{formatFechaHora(p.fecha)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab domiciliarios ────────────────────────────────────────────────────────

function BarraProgreso({ abonado, total }) {
  const pct = total > 0 ? Math.min(100, Math.round((abonado / total) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs text-gray-500">
        <span>Abonado: {formatCOP(abonado)}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className="h-full bg-orange-400 rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-xs text-gray-400">
        <span>Pendiente: {formatCOP(Math.max(0, total - abonado))}</span>
        <span>Total: {formatCOP(total)}</span>
      </div>
    </div>
  );
}

function TarjetaEntregaPendiente({ entrega, onSeleccionar }) {
  return (
    <button onClick={() => onSeleccionar(entrega.id)}
      className="w-full text-left bg-white border border-orange-200 rounded-xl p-3
        hover:border-orange-400 hover:bg-orange-50/30 transition-colors flex flex-col gap-2.5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800 truncate">{entrega.nombre_cliente}</p>
          <p className="text-xs text-gray-500">
            Factura #{String(entrega.factura_id).padStart(6, '0')}
            {entrega.cliente_celular ? ` · ${entrega.cliente_celular}` : ''}
          </p>
          {entrega.direccion_entrega && (
            <p className="text-xs text-gray-400 truncate mt-0.5">{entrega.direccion_entrega}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <Badge variant="yellow">Pendiente</Badge>
          <span className="text-xs text-gray-400">{formatFechaHora(entrega.fecha_asignacion)}</span>
        </div>
      </div>
      <BarraProgreso
        abonado={Number(entrega.total_abonado)}
        total={Number(entrega.valor_total)}
      />
      <div className="flex items-center justify-between pt-0.5">
        <span className="text-xs text-orange-600 font-medium">{entrega.domiciliario_nombre}</span>
        <ChevronRight size={14} className="text-orange-300" />
      </div>
    </button>
  );
}

function FilaEntregaCompacta({ entrega, onSeleccionar }) {
  const estadoBadge = ESTADO_ENTREGA_BADGE[entrega.estado] || 'gray';
  const estadoLabel = ESTADO_ENTREGA_LABEL[entrega.estado] || entrega.estado;

  return (
    <button onClick={() => onSeleccionar(entrega.id)}
      className="w-full text-left flex items-center justify-between gap-3 px-3 py-2.5
        hover:bg-gray-50 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-700 truncate">{entrega.nombre_cliente}</p>
        <p className="text-xs text-gray-400">
          #{String(entrega.factura_id).padStart(6, '0')} · {entrega.domiciliario_nombre}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-xs text-gray-400 hidden sm:block">
          {formatFechaHora(entrega.fecha_asignacion)}
        </span>
        <Badge variant={estadoBadge}>{estadoLabel}</Badge>
        <ChevronRight size={13} className="text-gray-300" />
      </div>
    </button>
  );
}

function DesplegableHistorial({ entregas, onSeleccionar }) {
  const [abierto, setAbierto] = useState(false);
  if (entregas.length === 0) return null;

  const entregados   = entregas.filter((e) => e.estado === 'Entregado');
  const noEntregados = entregas.filter((e) => e.estado === 'No_entregado');

  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <button onClick={() => setAbierto((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5
          bg-gray-50 hover:bg-gray-100 transition-colors">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-gray-500">Historial</span>
          {entregados.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
              {entregados.length} entregado{entregados.length !== 1 ? 's' : ''}
            </span>
          )}
          {noEntregados.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">
              {noEntregados.length} devuelto{noEntregados.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        {abierto
          ? <ChevronUp   size={15} className="text-gray-400" />
          : <ChevronDown size={15} className="text-gray-400" />}
      </button>
      {abierto && (
        <div className="flex flex-col divide-y divide-gray-50 bg-white">
          {entregas.map((entrega) => {
            const entregaId = entrega.id;
            return (
              <FilaEntregaCompacta key={entregaId} entrega={entrega} onSeleccionar={onSeleccionar} />
            );
          })}
        </div>
      )}
    </div>
  );
}

function PanelDetalleEntrega({ entregaId, onVolver }) {
  const queryClient = useQueryClient();
  const [valorAbono,   setValorAbono]   = useState('');
  const [notasAbono,   setNotasAbono]   = useState('');
  const [errorLocal,   setErrorLocal]   = useState('');
  const [confirmarDev, setConfirmarDev] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['entrega-detalle', entregaId],
    queryFn:  () => getEntregaById(entregaId).then((r) => r.data.data),
    enabled:  !!entregaId,
  });

  const mutAbono = useMutation({
    mutationFn: (datos) => registrarAbonoDomicilio(entregaId, datos),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entregas-domicilio'], exact: false });
      refetch();
      setValorAbono('');
      setNotasAbono('');
      setErrorLocal('');
    },
    onError: (err) => setErrorLocal(err.response?.data?.error || 'Error al registrar abono'),
  });

  const mutDevolucion = useMutation({
    mutationFn: () => marcarDevolucionDomicilio(entregaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entregas-domicilio'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['facturas'],           exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-serial'],   exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'],  exact: false });
      refetch();
      setConfirmarDev(false);
    },
    onError: (err) => setErrorLocal(err.response?.data?.error || 'Error al procesar devolución'),
  });

  const handleAbono = () => {
    setErrorLocal('');
    const val = Number(valorAbono);
    if (!val || val <= 0) return setErrorLocal('El valor debe ser mayor a 0');
    mutAbono.mutate({ valor: val, notas: notasAbono || null });
  };

  if (isLoading) return <Spinner className="py-10" />;

  const e              = data;
  const saldoPendiente = Math.max(0, Number(e?.valor_total || 0) - Number(e?.total_abonado || 0));
  const esPendiente    = e?.estado === 'Pendiente';

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onVolver}
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 w-fit">
        <ChevronLeft size={13} /> Volver a la lista
      </button>

      <div className="bg-orange-50 border border-orange-100 rounded-xl p-3 flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-800">{e?.nombre_cliente}</p>
          <Badge variant={ESTADO_ENTREGA_BADGE[e?.estado] || 'gray'}>
            {ESTADO_ENTREGA_LABEL[e?.estado] || e?.estado}
          </Badge>
        </div>
        <p className="text-xs text-gray-500">
          Factura #{String(e?.factura_id || 0).padStart(6, '0')}
          {e?.cliente_celular ? ` · ${e.cliente_celular}` : ''}
        </p>
        <p className="text-xs text-orange-600 font-medium">
          Domiciliario: {e?.domiciliario_nombre}
          {e?.domiciliario_telefono ? ` · ${e.domiciliario_telefono}` : ''}
        </p>
        {e?.direccion_entrega && <p className="text-xs text-gray-500">{e.direccion_entrega}</p>}
        {e?.notas && <p className="text-xs text-gray-400 italic">{e.notas}</p>}
        <p className="text-xs text-gray-400">{formatFechaHora(e?.fecha_asignacion)}</p>
      </div>

      <BarraProgreso
        abonado={Number(e?.total_abonado || 0)}
        total={Number(e?.valor_total || 0)}
      />

      {e?.abonos?.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Historial de abonos
          </p>
          <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
            {e.abonos.map((abono) => {
              const abonoId = abono.id;
              return (
                <div key={abonoId}
                  className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
                  <div>
                    <p className="text-xs text-gray-500">{formatFechaHora(abono.fecha)}</p>
                    {abono.notas && <p className="text-xs text-gray-400 italic">{abono.notas}</p>}
                    {abono.usuario_nombre && (
                      <p className="text-xs text-gray-400">por {abono.usuario_nombre}</p>
                    )}
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

      {esPendiente && (
        <div className="flex flex-col gap-2 p-3 bg-green-50 border border-green-100 rounded-xl">
          <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">
            Registrar abono
          </p>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">
              Valor (máx. {formatCOP(saldoPendiente)})
            </label>
            <InputMoneda value={valorAbono} onChange={setValorAbono} placeholder="0"
              className="w-full px-3 py-2 bg-white border border-green-200 rounded-xl text-sm
                focus:outline-none focus:ring-2 focus:ring-green-400 transition-all" />
          </div>
          <Input label="Notas (opcional)" placeholder="Observaciones del abono..."
            value={notasAbono} onChange={(e) => setNotasAbono(e.target.value)} />
          <Button size="sm" loading={mutAbono.isPending}
            disabled={!valorAbono || Number(valorAbono) <= 0}
            onClick={handleAbono}>
            Registrar abono
          </Button>
        </div>
      )}

      {esPendiente && !confirmarDev && (
        <button onClick={() => setConfirmarDev(true)}
          className="w-full py-2.5 rounded-xl text-sm font-medium border border-red-200
            text-red-500 bg-red-50 hover:bg-red-100 transition-colors">
          Marcar como no entregado (devolución)
        </button>
      )}

      {esPendiente && confirmarDev && (
        <div className="flex flex-col gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-700">
              Esto cancelará la factura y revertirá el stock al inventario. Esta acción no se puede deshacer.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" className="flex-1"
              onClick={() => setConfirmarDev(false)}>
              Cancelar
            </Button>
            <Button size="sm" className="flex-1 bg-red-500 hover:bg-red-600"
              loading={mutDevolucion.isPending}
              onClick={() => mutDevolucion.mutate()}>
              Confirmar devolución
            </Button>
          </div>
        </div>
      )}

      {errorLocal && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2">
          <p className="text-sm text-red-600">{errorLocal}</p>
        </div>
      )}
    </div>
  );
}

function TabDomiciliarios() {
  const [filtroDomiciliario,  setFiltroDomiciliario]  = useState('');
  const [entregaSeleccionada, setEntregaSeleccionada] = useState(null);

  const { data: domiciliariosData } = useQuery({
    queryKey: ['domiciliarios'],
    queryFn:  () => getDomiciliarios().then((r) => r.data.data),
  });

  const { data: entregasData, isLoading } = useQuery({
    queryKey: ['entregas-domicilio', filtroDomiciliario],
    queryFn:  () => getEntregas({
      domiciliario_id: filtroDomiciliario || undefined,
    }).then((r) => r.data.data),
  });

  const domiciliarios = domiciliariosData || [];
  const entregas      = entregasData      || [];
  const pendientes    = entregas.filter((e) => e.estado === 'Pendiente');
  const historial     = entregas.filter((e) => e.estado !== 'Pendiente');

  if (entregaSeleccionada) {
    return (
      <PanelDetalleEntrega
        entregaId={entregaSeleccionada}
        onVolver={() => setEntregaSeleccionada(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {domiciliarios.length > 0 && (
        <select value={filtroDomiciliario}
          onChange={(e) => setFiltroDomiciliario(e.target.value)}
          className="w-full py-2 px-3 bg-gray-50 border border-gray-200
            rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400
            focus:bg-white transition-all text-gray-700">
          <option value="">Todos los domiciliarios</option>
          {domiciliarios.map((d) => {
            const domId = d.id;
            return <option key={domId} value={domId}>{d.nombre}</option>;
          })}
        </select>
      )}

      {isLoading ? (
        <Spinner className="py-8" />
      ) : entregas.length === 0 ? (
        <EmptyState icon={Bike}
          titulo="Sin pedidos domiciliarios"
          descripcion="Los pedidos aparecen al crear facturas con domicilio" />
      ) : (
        <div className="flex flex-col gap-3">
          {pendientes.length === 0 ? (
            <p className="text-xs text-gray-400 px-1">Sin pedidos pendientes</p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-1">
                Pendientes ({pendientes.length})
              </p>
              {pendientes.map((entrega) => {
                const entregaId = entrega.id;
                return (
                  <TarjetaEntregaPendiente
                    key={entregaId}
                    entrega={entrega}
                    onSeleccionar={setEntregaSeleccionada}
                  />
                );
              })}
            </div>
          )}
          <DesplegableHistorial
            entregas={historial}
            onSeleccionar={setEntregaSeleccionada}
          />
        </div>
      )}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function PrestamosPage() {
  const [tabPrincipal,  setTabPrincipal]  = useState('prestamos');
  const [tabPrestamos,  setTabPrestamos]  = useState('companeros');
  const [prestamoAbono, setPrestamoAbono] = useState(null);
  const [prestamoDevol, setPrestamoDevol] = useState(null);

  const { coloresActivo } = useColoresConfig();

  const { data: prestamosData, isLoading: loadingP } = useQuery({
    queryKey: ['prestamos'],
    queryFn:  () => getPrestamos().then((r) => r.data.data),
  });

  const prestamos = prestamosData || [];

  const gruposCompaneros = prestamos
    .filter((p) => p.prestatario_id)
    .reduce((acc, p) => {
      const key = `prestatario_${p.prestatario_id}`;
      if (!acc[key]) {
        acc[key] = {
          nombre:    p.prestatario_nombre || p.prestatario,
          personaId: p.prestatario_id,
          prestamos:  [],
          saldoTotal: 0,
        };
      }
      acc[key].prestamos.push(p);
      if (p.estado === 'Activo') acc[key].saldoTotal += Number(p.valor_prestamo) - Number(p.total_abonado);
      return acc;
    }, {});

  const gruposClientes = prestamos
    .filter((p) => p.cliente_id)
    .reduce((acc, p) => {
      const key = `cliente_${p.cliente_id}`;
      if (!acc[key]) {
        acc[key] = {
          nombre:    p.cliente_nombre || p.prestatario,
          personaId: p.cliente_id,
          prestamos:  [],
          saldoTotal: 0,
        };
      }
      acc[key].prestamos.push(p);
      if (p.estado === 'Activo') acc[key].saldoTotal += Number(p.valor_prestamo) - Number(p.total_abonado);
      return acc;
    }, {});

  return (
    <div className="flex flex-col gap-4">

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {TABS_PRINCIPALES.map((tab) => {
          const tabId    = tab.id;
          const tabLabel = tab.label;
          const TabIcon  = tab.Icn;
          return (
            <button key={tabId} onClick={() => setTabPrincipal(tabId)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
                ${tabPrincipal === tabId
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'}`}>
              <TabIcon size={16} />
              {tabLabel}
            </button>
          );
        })}
      </div>

      {tabPrincipal === 'prestamos' && (
        <div className="flex flex-col gap-4">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
            {TABS_PRESTAMOS.map((tab) => {
              const tabId    = tab.id;
              const tabLabel = tab.label;
              const TabIcon  = tab.Icn;
              const count = tabId === 'companeros'
                ? Object.keys(gruposCompaneros).length
                : Object.keys(gruposClientes).length;
              return (
                <button key={tabId} onClick={() => setTabPrestamos(tabId)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
                    ${tabPrestamos === tabId
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'}`}>
                  <TabIcon size={15} />
                  {tabLabel}
                  {count > 0 && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold
                      ${tabPrestamos === tabId
                        ? 'bg-blue-100 text-blue-600'
                        : 'bg-gray-200 text-gray-500'}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {loadingP ? (
            <Spinner className="py-20" />
          ) : (
            <>
              {tabPrestamos === 'companeros' && (
                <div className="flex flex-col gap-3">
                  {Object.keys(gruposCompaneros).length === 0 ? (
                    <EmptyState icon={User} titulo="Sin préstamos a compañeros" />
                  ) : (
                    Object.entries(gruposCompaneros).map(([key, grupo]) => (
                      <GrupoPrestatario
                        key={key}
                        tipo="prestatario"
                        nombre={grupo.nombre}
                        personaId={grupo.personaId}
                        prestamos={grupo.prestamos}
                        saldoTotal={grupo.saldoTotal}
                        onAbonar={setPrestamoAbono}
                        onDevolver={setPrestamoDevol}
                        CardItem={CardPrestamoCompanero}
                        coloresActivo={coloresActivo}
                      />
                    ))
                  )}
                </div>
              )}
              {tabPrestamos === 'clientes' && (
                <div className="flex flex-col gap-3">
                  {Object.keys(gruposClientes).length === 0 ? (
                    <EmptyState icon={Users} titulo="Sin préstamos a clientes" />
                  ) : (
                    Object.entries(gruposClientes).map(([key, grupo]) => (
                      <GrupoPrestatario
                        key={key}
                        tipo="cliente"
                        nombre={grupo.nombre}
                        personaId={grupo.personaId}
                        prestamos={grupo.prestamos}
                        saldoTotal={grupo.saldoTotal}
                        onAbonar={setPrestamoAbono}
                        onDevolver={setPrestamoDevol}
                        CardItem={CardPrestamoCliente}
                        coloresActivo={coloresActivo}
                      />
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tabPrincipal === 'creditos' && <TabCreditos />}
      {tabPrincipal === 'domiciliarios' && <TabDomiciliarios />}

      {prestamoAbono && (
        <ModalAbonoPrestamo
          prestamo={prestamoAbono}
          onClose={() => setPrestamoAbono(null)}
        />
      )}
      {prestamoDevol && (
        <ModalDevolucion
          prestamo={prestamoDevol}
          onClose={() => setPrestamoDevol(null)}
        />
      )}
    </div>
  );
}