import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { buscarPrestamos as buscarPrestamosApi } from '../../api/busqueda.api';
import { exportarPrestamosExcel } from '../../utils/exportarPrestamosExcel';
import { exportarCarteraPersonaExcel } from '../../utils/exportarCarteraPersonaExcel';
import { getPrestamos, getResumenPersonas, getPrestamosDePersona, getPrestamoById, registrarAbonoPrestamo, devolverPrestamo, devolverParcialPrestamo, registrarSaldoAFavor as registrarSaldoAFavorApi, intercambiarPrestamo as intercambiarPrestamoApi, anularAbono as anularAbonoApi, getRetomasDirectas as getRetomasDirectasApi, anularRetomaDirecta as anularRetomaDirectaApi, aplicarSaldoAPrestamo as aplicarSaldoAPrestamoApi, getEstadoCuenta as getEstadoCuentaApi, crearAjusteDeuda as crearAjusteDeudaApi, getSaldoSucursal as getSaldoSucursalApi, getHistorialSaldoSucursal as getHistorialSaldoSucursalApi } from '../../api/prestamos.api';
import { ModalEditarValorPrestamo } from './ModalEditarValorPrestamo';
import { crearPrestatario as crearPrestatarioApi, getPrestatarios, actualizarPrestatario as actualizarPrestatarioApi } from '../../api/prestatarios.api';
import { actualizarCliente as actualizarClienteApi } from '../../api/clientes.api';
import { getCreditos } from '../../api/creditos.api';
import {
  getDomiciliarios,
  getEntregas,
  getEntregaById,
  registrarAbono    as registrarAbonoDomicilio,
  marcarDevolucion  as marcarDevolucionDomicilio,
} from '../../api/domiciliarios.api';
import { getFacturaById }           from '../../api/facturas.api';
import { getGarantiasPorFactura }   from '../../api/garantias.api';
import { formatCOP, formatFechaHora }           from '../../utils/formatters';
import { Badge }                                from '../../components/ui/Badge';
import { Button }                               from '../../components/ui/Button';
import { Modal }                                from '../../components/ui/Modal';
import { Input }                                from '../../components/ui/Input';
import { InputMoneda }                          from '../../components/ui/InputMoneda';
import { SelectorNodoRetoma }                   from '../../components/ui/SelectorNodoRetoma';
import { Spinner }                              from '../../components/ui/Spinner';
import { EmptyState }                           from '../../components/ui/EmptyState';
import { FacturaTermica }                       from '../../components/FacturaTermica';
import { ModalImprimirFactura }                 from '../../components/ui/ModalImprimirFactura';
import { ModalImprimirPrestamo }                from '../../components/ui/ModalImprimirPrestamo';
import { TabCreditos }                          from './TabCreditos';
import { ModalRetomaDirecta }                   from './ModalRetomaDirecta';
import { EstadoDeCuenta }                       from './EstadoDeCuenta';
import { ModalAbonoTotal }                      from './ModalAbonoTotal';
import { BadgeVencidosPersona }                 from './BadgeVencidosPersona';
import {
  agruparPorPersona, resumenBusqueda, ordenarGrupos, ordenarPrestamos, ORDENES_BUSQUEDA,
}                                               from '../../utils/busquedaPrestamos';
import { useMetodosPago }                       from '../../hooks/useMetodosPago';
import { useMora }                              from '../../hooks/useMora';
import { useInteres }                           from '../../hooks/useInteres';
import { PanelMora }                            from '../../components/ui/PanelMora';
import { PanelInteres }                         from '../../components/ui/PanelInteres';
import {
  fijarPlazoPrestamo, cobrarMoraPrestamo, condonarMoraPrestamo, fijarInteresPrestamo,
} from '../../api/prestamos.api';
import { ModalExportarPdfPrestamos }             from './ModalExportarPdfPrestamos';
import api                                      from '../../api/axios.config';
import useSucursalStore                         from '../../store/sucursalStore';
import {
  getProductosSerial, getProductosCantidad,
}                                               from '../../api/productos.api';
import {
  Handshake, CreditCard, Bike, Plus, CheckCircle,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  Users, User, AlertTriangle, FileDown, Loader2, Printer, Search, Wallet,
  ArrowLeftRight, Package, ShoppingBag, XCircle, SlidersHorizontal, UserPlus, Pencil, Settings, Layers,
  Clock,
} from 'lucide-react';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TABS_PRINCIPALES = [
  { id: 'prestamos',     label: 'Préstamos',     Icn: Handshake  },
  { id: 'creditos',      label: 'Créditos',      Icn: CreditCard },
  { id: 'domiciliarios', label: 'Domiciliarios', Icn: Bike       },
  { id: 'busqueda',      label: 'Búsqueda',      Icn: Search     },
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

function parsearColoresConfig(configData) {
  try {
    const lista = JSON.parse(configData?.colores_serial_lista || '[]');
    return Array.isArray(lista) ? lista : [];
  } catch { return []; }
}

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

function iniciales(nombre) {
  return (nombre || '?')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function ChipColor({ color }) {
  if (!color) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full bg-gray-400 flex-shrink-0 border border-gray-300" />
      <span className="text-xs text-gray-500">{color}</span>
    </span>
  );
}

function BotonExportarPdf({ tipo, personaId, nombrePersona }) {
  const [modalAbierto, setModalAbierto] = useState(false);
  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); setModalAbierto(true); }}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium
          border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100
          hover:border-blue-300 transition-colors flex-shrink-0">
        <FileDown size={12} />
        PDF
      </button>
      {modalAbierto && (
        <ModalExportarPdfPrestamos
          tipo={tipo}
          personaId={personaId}
          personaNombre={nombrePersona}
          onClose={() => setModalAbierto(false)}
        />
      )}
    </>
  );
}

function BotonExportarExcel({ tipo, personaId, nombre, cedula, telefono, prestamos, saldoAFavor }) {
  const [cargando, setCargando] = useState(false);

  const handleClick = async (e) => {
    e.stopPropagation();
    if (cargando) return;
    setCargando(true);
    try {
      const res = await getEstadoCuentaApi(tipo, personaId);
      const movimientos = res.data.data || [];
      exportarCarteraPersonaExcel({ nombre, tipo, cedula, telefono, prestamos, movimientos, saldoAFavor });
    } catch {
      alert('No se pudo generar el Excel. Intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  };

  return (
    <button onClick={handleClick} disabled={cargando}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium
        border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100
        hover:border-emerald-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0">
      {cargando ? <Loader2 size={12} className="animate-spin" /> : <FileDown size={12} />}
      Excel
    </button>
  );
}

function BotonImprimirPrestamo({ prestamo, onClick }) {
  if (prestamo.estado === 'Devuelto') return null;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(prestamo); }}
      title="Imprimir comprobante"
      className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50
        transition-colors flex-shrink-0"
    >
      <Printer size={14} />
    </button>
  );
}

// ─── Modal Abono Préstamo ─────────────────────────────────────────────────────

function ModalAbonoPrestamo({ prestamo, onClose, onSaldado }) {
  const queryClient = useQueryClient();
  const metodosPago = useMetodosPago();
  const [valor,  setValor]  = useState('');
  const [metodo, setMetodo] = useState('Efectivo');
  const [error,  setError]  = useState('');

  const saldoPendiente = Number(prestamo.valor_prestamo) - Number(prestamo.total_abonado);

  const mutation = useMutation({
    mutationFn: () => registrarAbonoPrestamo(prestamo.id, Number(valor), metodo),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['prestamos'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['facturas'],  exact: false });
      const data = res.data?.data;
      if (data?.saldado && data?.factura_id) {
        onSaldado(data.factura_id, prestamo);
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

  return (
    <Modal open onClose={onClose} title="Registrar Abono" size="sm">
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
          <InputMoneda value={valor} onChange={setValor} placeholder="0"
            onKeyDown={(e) => e.key === 'Enter' && handleRegistrar()} autoFocus
            className="w-full px-3 py-2 bg-gray-100 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Método de pago</label>
          <div className="flex flex-wrap gap-2">
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

// ─── Modal confirmar factura post-saldo ───────────────────────────────────────

function ModalConfirmarFactura({ prestamo, facturaConConfig, garantias, onNo, onSi }) {
  return (
    <Modal open onClose={onNo} title="Préstamo saldado" size="sm">
      <div className="flex flex-col gap-5">
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-center">
          <p className="text-green-700 font-semibold text-sm">✓ El préstamo quedó completamente saldado</p>
          <p className="text-green-600 text-xs mt-1">{prestamo?.nombre_producto} — {prestamo?.prestatario}</p>
        </div>
        <p className="text-sm text-gray-600 text-center">¿Deseas generar una factura por este pago?</p>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onNo}>No, cerrar</Button>
          <Button className="flex-1" disabled={!facturaConConfig} loading={!facturaConConfig}
            onClick={() => facturaConConfig && onSi(facturaConConfig, garantias)}>
            {facturaConConfig ? 'Sí, generar factura' : 'Cargando...'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal Devolución ─────────────────────────────────────────────────────────

function ModalDevolucion({ prestamo, onClose }) {
  const queryClient = useQueryClient();
  const [cantidad, setCantidad] = useState('');
  const [error,    setError]    = useState('');
  // Arranca sin elegir: la opción por defecto depende de si el pago vino de un
  // reparto, y eso solo se sabe cuando llega el detalle. Se DERIVA en vez de
  // sincronizarse con un efecto, que además el linter rechaza.
  const [decision, setDecision] = useState(null);

  // El detalle trae los abonos, y de ahí sale si el pago lo escogió el vendedor
  // o lo repartió el programa. Solo se pide cuando el préstamo tiene abonos.
  const { data: detalle } = useQuery({
    queryKey: ['prestamo-detalle', prestamo.id],
    queryFn:  () => getPrestamoById(prestamo.id).then((r) => r.data.data),
    enabled:  Number(prestamo.total_abonado) > 0,
    staleTime: 0,
  });

  const esPorCantidad = !prestamo.imei;
  const cantidadMax   = Number(prestamo.cantidad_prestada) || 1;
  // Lo que la persona YA pagó por este préstamo. Al devolver el producto ese
  // cobro sale de su cuenta y el pago se queda sin nada que pagar, así que hay
  // que decidir qué se hace con él — y decidirlo AHORA, no después.
  const yaAbonado     = Number(prestamo.total_abonado) || 0;

  // Al devolver TODO hay que resolver el abonado completo; en una devolución
  // parcial el préstamo sigue vivo con lo que queda.
  const devuelveTodo  = !esPorCantidad || cantidadMax === 1 || Number(cantidad) === cantidadMax;
  const hayQueDecidir = yaAbonado > 0 && devuelveTodo;

  // De dónde salió el pago cambia las opciones. Con un abono INDIVIDUAL el
  // vendedor escogió a mano este préstamo. Con un PAGO TOTAL fue el programa el
  // que repartió: nadie eligió que esa plata cayera aquí, y por eso aparece la
  // opción de devolverla al reparto.
  const dePagoTotal = detalle?.abonos?.some((a) => a.abono_total_id) ?? false;

  // Con un pago total la salida sana es devolver la plata al reparto: la deuda
  // de la persona baja de verdad y no queda nadie decidiendo después qué pasó
  // con un pago anulado. Anular se conserva, pero deja de ser el camino fácil.
  const decisionEfectiva = decision ?? (dePagoTotal ? 'reasignar' : 'anular');

  const invalidarTodo = () => {
    queryClient.invalidateQueries({ queryKey: ['prestamos'],               exact: false });
    queryClient.invalidateQueries({ queryKey: ['prestatarios'],            exact: false });
    queryClient.invalidateQueries({ queryKey: ['saldo-sucursal'],          exact: false });
    queryClient.invalidateQueries({ queryKey: ['historial-saldo-sucursal'], exact: false });
    queryClient.invalidateQueries({ queryKey: ['estado-cuenta'],           exact: false });
  };

  const mutDevolver = useMutation({
    mutationFn: () => devolverPrestamo(prestamo.id, decisionEfectiva),
    onSuccess:  () => { invalidarTodo(); onClose(); },
    onError:    (err) => setError(err.response?.data?.error || 'Error al registrar devolución'),
  });

  const mutDevolverParcial = useMutation({
    mutationFn: (cant) => devolverParcialPrestamo(prestamo.id, cant, decisionEfectiva),
    onSuccess:  () => { invalidarTodo(); onClose(); },
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
            <p className="text-xs text-gray-500">Cantidad prestada: <span className="font-semibold">{cantidadMax}</span></p>
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
        {hayQueDecidir && (
          <div className="flex flex-col gap-2">
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 flex flex-col gap-1">
              <p className="text-xs font-semibold text-amber-800">
                Ya pagó {formatCOP(yaAbonado)} por este préstamo
              </p>
              <p className="text-xs text-amber-700">
                Al devolver el producto, ese cobro sale de su cuenta y ese pago queda
                sin nada que pagar. <strong>¿Qué se hace con esa plata?</strong>
              </p>
              {dePagoTotal && (
                <p className="text-xs text-amber-700 bg-white/70 rounded-lg px-2 py-1.5 mt-1">
                  Ese pago vino de un <strong>pago total</strong>: lo repartió el programa
                  entre lo que la persona debía, nadie escogió que cayera en este producto.
                </p>
              )}
            </div>

            {[
              ...(dePagoTotal ? [{ id: 'reasignar', titulo: 'Pasarla a sus otros préstamos',
                texto: 'Vuelve al reparto y le baja lo que debe, como si el pago se hubiera hecho hoy.' }] : []),
              { id: 'saldo_a_favor', titulo: 'Dejársela a favor',
                texto: 'Queda como crédito a su nombre para usarlo después.' },
              { id: 'anular', titulo: 'No se le devuelve',
                texto: 'La plata se queda con el negocio. Su deuda no cambia.' },
            ].map((o) => (
              <button
                key={o.id} type="button"
                onClick={() => { setDecision(o.id); setError(''); }}
                className={`text-left rounded-xl border p-2.5 transition ${
                  decisionEfectiva === o.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                }`}>
                <p className="text-sm font-medium text-gray-900">{o.titulo}</p>
                <p className="text-xs text-gray-500">{o.texto}</p>
              </button>
            ))}

            <p className="text-[11px] text-gray-400">
              Quede lo que quede, el pago no se borra: aparece en el estado de cuenta
              marcado y con la razón anotada.
            </p>
          </div>
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

// ─── Modal saldo a favor ──────────────────────────────────────────────────────

function ModalSaldoAFavor({ nombre, tipo, personaId, montoActual, onClose }) {
  const queryClient = useQueryClient();
  const [monto, setMonto] = useState(montoActual > 0 ? String(montoActual) : '');
  const [error, setError]  = useState('');

  const tipoApi = tipo === 'companero' ? 'prestatario' : 'cliente';

  const mutation = useMutation({
    mutationFn: () => registrarSaldoAFavorApi(tipoApi, personaId, Number(monto)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prestamos'],               exact: false });
      queryClient.invalidateQueries({ queryKey: ['prestatarios'],            exact: false });
      queryClient.invalidateQueries({ queryKey: ['saldo-sucursal'],          exact: false });
      queryClient.invalidateQueries({ queryKey: ['historial-saldo-sucursal'], exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al guardar el saldo'),
  });

  const handleGuardar = () => {
    setError('');
    const val = Number(monto);
    if (isNaN(val) || val < 0) return setError('El monto debe ser mayor o igual a 0');
    mutation.mutate();
  };

  return (
    <Modal open onClose={onClose} title="Saldo a favor" size="sm">
      <div className="flex flex-col gap-4">
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">
          <p className="text-xs text-emerald-600">Persona</p>
          <p className="text-sm font-semibold text-emerald-800">{nombre}</p>
          {montoActual > 0 && (
            <p className="text-xs text-emerald-600 mt-1">
              Saldo actual: <span className="font-bold">{formatCOP(montoActual)}</span>
            </p>
          )}
        </div>
        <p className="text-sm text-gray-600">
          Este monto se descontará automáticamente del próximo préstamo que registres a esta persona.
        </p>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Monto del saldo a favor</label>
          <InputMoneda
            value={monto}
            onChange={setMonto}
            placeholder="0"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleGuardar()}
            className="w-full px-3 py-2 bg-gray-100 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all"
          />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button
            className="flex-1 bg-emerald-600 hover:bg-emerald-700"
            loading={mutation.isPending}
            onClick={handleGuardar}
          >
            <Wallet size={14} /> Guardar saldo
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal Historial Saldo a favor por sucursal ───────────────────────────────

function ModalHistorialSaldo({ nombre, tipo, personaId, onClose }) {
  const tipoApi        = tipo === 'companero' ? 'prestatario' : tipo;
  const sucursalActiva = useSucursalStore((s) => s.sucursalActiva);

  const { data: saldoData, isLoading: loadingSaldo } = useQuery({
    queryKey:  ['saldo-sucursal', tipoApi, personaId, sucursalActiva],
    queryFn:   () => getSaldoSucursalApi(tipoApi, personaId).then((r) => r.data.data),
    staleTime: 0,
  });

  const { data: historial = [], isLoading: loadingHist } = useQuery({
    queryKey:  ['historial-saldo-sucursal', tipoApi, personaId, sucursalActiva],
    queryFn:   () => getHistorialSaldoSucursalApi(tipoApi, personaId).then((r) => r.data.data),
    staleTime: 0,
  });

  const saldo = Number(saldoData?.saldo ?? 0);

  return (
    <Modal open onClose={onClose} title="Historial saldo a favor" size="md">
      <div className="flex flex-col gap-4">
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-emerald-600">Persona</p>
            <p className="text-sm font-semibold text-emerald-800">{nombre}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-emerald-600">Saldo actual (esta sucursal)</p>
            <p className={`text-lg font-bold ${saldo > 0 ? 'text-emerald-700' : 'text-gray-400'}`}>
              {loadingSaldo ? '...' : saldo > 0 ? formatCOP(saldo) : '—'}
            </p>
          </div>
        </div>

        {loadingHist ? (
          <Spinner className="py-8" />
        ) : historial.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">Sin movimientos registrados en esta sucursal.</p>
        ) : (
          <div className="flex flex-col gap-1 max-h-80 overflow-y-auto">
            {historial.map((mov) => (
              <div key={mov.id}
                className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-gray-50 text-sm">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-800 truncate">{mov.concepto}</p>
                  <p className="text-xs text-gray-400">
                    {formatFechaHora(mov.creado_en)}
                    {mov.usuario_nombre ? ` · ${mov.usuario_nombre}` : ''}
                  </p>
                </div>
                <span className={`ml-3 font-semibold flex-shrink-0 ${mov.tipo_movimiento === 'credito' ? 'text-emerald-600' : 'text-red-500'}`}>
                  {mov.tipo_movimiento === 'credito' ? '+' : '-'}{formatCOP(mov.monto)}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal Crear Prestamista ──────────────────────────────────────────────────

function ModalCrearPrestatario({ onClose }) {
  const queryClient = useQueryClient();
  const [nombre,   setNombre]   = useState('');
  const [telefono, setTelefono] = useState('');
  const [error,    setError]    = useState('');

  const mutation = useMutation({
    mutationFn: () => crearPrestatarioApi({ nombre: nombre.trim(), telefono: telefono.trim() || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prestamos'], exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al crear el prestamista'),
  });

  const handleCrear = () => {
    setError('');
    if (!nombre.trim()) return setError('El nombre es requerido');
    mutation.mutate();
  };

  return (
    <Modal open onClose={onClose} title="Nuevo prestamista" size="sm">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            Nombre <span className="text-red-500">*</span>
          </label>
          <Input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre completo"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleCrear()}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            Teléfono <span className="text-xs text-gray-400">(opcional)</span>
          </label>
          <Input
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="Número de teléfono"
            onKeyDown={(e) => e.key === 'Enter' && handleCrear()}
          />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mutation.isPending} onClick={handleCrear}>
            <UserPlus size={14} /> Crear prestamista
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal Editar Prestatario ─────────────────────────────────────────────────

function ModalEditarPrestatario({ prestatario, onClose }) {
  const queryClient = useQueryClient();
  const [nombre,   setNombre]   = useState(prestatario.nombre);
  const [telefono, setTelefono] = useState(prestatario.telefono || '');
  const [error,    setError]    = useState('');

  const mutation = useMutation({
    mutationFn: () => actualizarPrestatarioApi(prestatario.id, {
      nombre:   nombre.trim(),
      telefono: telefono.trim() || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prestatarios'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['prestamos'],    exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al actualizar el prestamista'),
  });

  const handleGuardar = () => {
    setError('');
    if (!nombre.trim()) return setError('El nombre es requerido');
    mutation.mutate();
  };

  return (
    <Modal open onClose={onClose} title="Editar prestamista" size="sm">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            Nombre <span className="text-red-500">*</span>
          </label>
          <Input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre completo"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleGuardar()}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            Teléfono <span className="text-xs text-gray-400">(opcional)</span>
          </label>
          <Input
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="Número de teléfono"
            onKeyDown={(e) => e.key === 'Enter' && handleGuardar()}
          />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mutation.isPending} onClick={handleGuardar}>
            <Pencil size={14} /> Guardar cambios
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal Editar Cliente ─────────────────────────────────────────────────────

function ModalEditarCliente({ cliente, onClose }) {
  const queryClient = useQueryClient();
  const [nombre,  setNombre]  = useState(cliente.nombre);
  const [celular, setCelular] = useState(cliente.celular || '');
  const [error,   setError]   = useState('');

  const mutation = useMutation({
    mutationFn: () => actualizarClienteApi(cliente.id, {
      nombre:  nombre.trim(),
      celular: celular.trim() || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clientes'],          exact: false });
      queryClient.invalidateQueries({ queryKey: ['clientes-prestamo'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['prestamos'],         exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al actualizar el cliente'),
  });

  const handleGuardar = () => {
    setError('');
    if (!nombre.trim()) return setError('El nombre es requerido');
    mutation.mutate();
  };

  return (
    <Modal open onClose={onClose} title="Editar cliente" size="sm">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            Nombre <span className="text-red-500">*</span>
          </label>
          <Input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre completo"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleGuardar()}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            Celular <span className="text-xs text-gray-400">(opcional)</span>
          </label>
          <Input
            value={celular}
            onChange={(e) => setCelular(e.target.value)}
            placeholder="Número de celular"
            onKeyDown={(e) => e.key === 'Enter' && handleGuardar()}
          />
        </div>
        <p className="text-xs text-gray-400">
          La cédula no se puede modificar: es la que enlaza al cliente con sus facturas.
        </p>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mutation.isPending} onClick={handleGuardar}>
            <Pencil size={14} /> Guardar cambios
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal Ajuste de Cuentas ──────────────────────────────────────────────────

function ModalAjusteDeuda({ nombre, tipo, personaId, sucursalId, onClose }) {
  const queryClient = useQueryClient();
  const [valor,       setValor]       = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [error,       setError]       = useState('');

  const tipoApi = tipo === 'companero' ? 'prestatario' : 'cliente';

  const mutation = useMutation({
    mutationFn: () => crearAjusteDeudaApi({
      tipo:        tipoApi,
      persona_id:  personaId,
      valor:       Number(valor),
      descripcion: descripcion.trim() || undefined,
      sucursal_id: sucursalId,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prestamos'], exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al registrar el ajuste'),
  });

  const handleConfirmar = () => {
    setError('');
    if (!valor || Number(valor) <= 0) return setError('El valor debe ser mayor a 0');
    mutation.mutate();
  };

  return (
    <Modal open onClose={onClose} title="Ajuste de cuentas" size="sm">
      <div className="flex flex-col gap-4">

        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-xs font-semibold text-amber-700">Cargo de ajuste</p>
          <p className="text-xs text-amber-600 mt-0.5">
            Se creará un nuevo cargo para <span className="font-semibold">{nombre}</span> que
            quedará registrado en su estado de cuenta.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            Valor del ajuste <span className="text-red-500">*</span>
          </label>
          <InputMoneda
            value={valor}
            onChange={setValor}
            placeholder="0"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleConfirmar()}
            className="w-full px-3 py-2 bg-gray-100 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition-all"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            Descripción <span className="text-xs text-gray-400">(opcional)</span>
          </label>
          <Input
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Ej: Cobro adicional, Error en préstamo anterior..."
            onKeyDown={(e) => e.key === 'Enter' && handleConfirmar()}
          />
          <p className="text-xs text-gray-400">
            Si no escribes nada aparecerá como "Ajuste de deuda".
          </p>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button
            className="flex-1 bg-amber-600 hover:bg-amber-700"
            loading={mutation.isPending}
            onClick={handleConfirmar}
          >
            <SlidersHorizontal size={14} /> Registrar ajuste
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal Intercambio ────────────────────────────────────────────────────────
// El prestatario paga con un producto en lugar de efectivo.
// El producto entra al inventario como retoma y su valor se aplica al préstamo.

const IMEI_MIN = 8;

function normalizarProductos(data) {
  if (Array.isArray(data)) return data;
  if (data?.items && Array.isArray(data.items)) return data.items;
  return [];
}

function ModalIntercambio({ prestamo, onClose, onSaldado }) {
  const queryClient = useQueryClient();

  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
  });
  const coloresActivo          = configData?.colores_serial_activo === '1';
  const coloresLista           = (() => {
    try { return JSON.parse(configData?.colores_serial_lista || '[]'); } catch { return []; }
  })();
  const caracteristicasActivo  = configData?.caracteristicas_serial_activo === '1';
  const caracteristicasLista   = (() => {
    try { return JSON.parse(configData?.caracteristicas_serial_lista || '[]'); } catch { return []; }
  })();

  const [tipoRetoma,            setTipoRetoma]            = useState('serial');
  const [imeiRetoma,            setImeiRetoma]             = useState('');
  const [busquedaSerial,        setBusquedaSerial]         = useState('');
  const [productoSerialSel,     setProductoSerialSel]      = useState(null);
  const [colorRetoma,           setColorRetoma]            = useState('');
  const [caracteristicasRetoma, setCaracteristicasRetoma]  = useState({});
  const [busquedaCantidad,      setBusquedaCantidad]       = useState('');
  const [productoCantidadSel,   setProductoCantidadSel]    = useState(null);
  const [cantidadRetoma,        setCantidadRetoma]         = useState('1');
  const [nodoSel,               setNodoSel]                = useState(null);
  const [valorRetoma,           setValorRetoma]            = useState('');
  // Precio de venta del usado. Vacío = no se toca el precio que la referencia
  // tenga. El backend escribía `precio = valor_retoma`, o sea que el artículo
  // quedaba ofrecido en lo que se acababa de pagar por él.
  const [precioVenta,           setPrecioVenta]            = useState('');
  const [ingresoInventario,     setIngresoInventario]      = useState(true);
  const [error,                 setError]                  = useState('');

  const { data: rawSerial   } = useQuery({
    queryKey: ['productos-serial'],
    queryFn:  () => getProductosSerial().then((r) => r.data.data),
  });
  const { data: rawCantidad } = useQuery({
    queryKey: ['productos-cantidad'],
    queryFn:  () => getProductosCantidad().then((r) => r.data.data),
  });
  const productosSerial   = normalizarProductos(rawSerial);
  const productosCantidad = normalizarProductos(rawCantidad);

  const filtradosSerial   = productosSerial.filter((p) =>
    p.nombre.toLowerCase().includes(busquedaSerial.toLowerCase())
  );
  const filtradosCantidad = productosCantidad.filter((p) =>
    p.nombre.toLowerCase().includes(busquedaCantidad.toLowerCase())
  );

  const resetCamposProducto = () => {
    setImeiRetoma(''); setBusquedaSerial(''); setProductoSerialSel(null); setColorRetoma('');
    setCaracteristicasRetoma({});
    setBusquedaCantidad(''); setProductoCantidadSel(null); setCantidadRetoma('1');
    setNodoSel(null); setPrecioVenta('');
  };

  const saldoPendiente = Number(prestamo.valor_prestamo) - Number(prestamo.total_abonado);
  const retoma         = Number(valorRetoma) || 0;
  const diff           = saldoPendiente - retoma; // positivo = queda deuda, negativo = saldo a favor

  const mutation = useMutation({
    mutationFn: () => intercambiarPrestamoApi(prestamo.id, {
      tipo_retoma:            tipoRetoma,
      imei_retoma:            tipoRetoma === 'serial' ? (imeiRetoma.trim() || null) : null,
      producto_serial_id:     tipoRetoma === 'serial' ? (productoSerialSel?.id || null) : null,
      color_retoma:           tipoRetoma === 'serial' ? (colorRetoma.trim() || null) : null,
      caracteristicas_retoma: tipoRetoma === 'serial' && caracteristicasActivo && caracteristicasLista.length > 0
        ? Object.fromEntries(Object.entries(caracteristicasRetoma).filter(([, v]) => v.trim()))
        : null,
      producto_cantidad_id:  tipoRetoma === 'cantidad' ? (productoCantidadSel?.id || null) : null,
      atributo_id:           tipoRetoma === 'cantidad' ? (nodoSel?.atributo_id || null)    : null,
      variante_id:           tipoRetoma === 'cantidad' ? (nodoSel?.variante_id || null)    : null,
      cantidad_retoma:       tipoRetoma === 'cantidad' ? Number(cantidadRetoma || 1) : 1,
      valor_retoma:          retoma,
      precio_venta:          Number(precioVenta) > 0 ? Number(precioVenta) : null,
      ingreso_inventario:    ingresoInventario,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['prestamos'],    exact: false });
      queryClient.invalidateQueries({ queryKey: ['inventario'],   exact: false });
      const data = res.data?.data;
      if (data?.saldado && data?.factura_id && onSaldado) {
        onSaldado(data.factura_id, prestamo);
      } else {
        onClose();
      }
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al registrar el pago en producto'),
  });

  const handleConfirmar = () => {
    setError('');
    if (!retoma || retoma <= 0) return setError('Ingresa el valor del artículo');
    if (ingresoInventario) {
      if (tipoRetoma === 'serial' && !productoSerialSel)
        return setError('Selecciona la línea de producto del artículo');
      if (tipoRetoma === 'serial' && !imeiRetoma.trim())
        return setError('Ingresa el IMEI del artículo');
      if (tipoRetoma === 'cantidad' && !productoCantidadSel)
        return setError('Selecciona el artículo');
    }
    mutation.mutate();
  };

  return (
    <Modal open onClose={onClose} title="Pago en producto" size="md">
      <div className="flex flex-col gap-4">

        {/* Préstamo actual */}
        <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-1">
          <p className="text-xs text-gray-400">Préstamo de {prestamo.prestatario}</p>
          <p className="text-sm font-semibold text-gray-800">{prestamo.nombre_producto}</p>
          {prestamo.imei && <p className="text-xs text-gray-400 font-mono">{prestamo.imei}</p>}
          <div className="flex justify-between mt-1">
            <span className="text-xs text-gray-400">Saldo pendiente</span>
            <span className="text-sm font-bold text-red-500">{formatCOP(saldoPendiente)}</span>
          </div>
        </div>

        {/* Producto que entrega */}
        <div className="flex flex-col gap-3 p-3 bg-purple-50 rounded-xl border border-purple-100">
          <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide">Producto que entrega</p>

          {/* Toggle serial / cantidad */}
          <div className="flex gap-2">
            {[
              { id: 'serial',   label: 'Con serial / IMEI', Icn: Package     },
              { id: 'cantidad', label: 'Por cantidad',       Icn: ShoppingBag },
            ].map((opt) => {
              const Icn = opt.Icn;
              return (
                <button key={opt.id} onClick={() => { setTipoRetoma(opt.id); resetCamposProducto(); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl
                    text-xs font-medium border transition-all
                    ${tipoRetoma === opt.id
                      ? 'bg-purple-100 border-purple-400 text-purple-800'
                      : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                  <Icn size={13} /> {opt.label}
                </button>
              );
            })}
          </div>

          {/* Campos serial */}
          {tipoRetoma === 'serial' && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-600">IMEI del equipo retomado {ingresoInventario ? '*' : ''}</label>
                <input type="text" placeholder="Ej: 356789012345678" value={imeiRetoma}
                  onChange={(e) => setImeiRetoma(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl
                    text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 transition-all" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-600">Línea de producto {ingresoInventario ? '*' : ''}</label>
                <input type="text" placeholder="Buscar modelo..." value={busquedaSerial}
                  onChange={(e) => { setBusquedaSerial(e.target.value); setProductoSerialSel(null); }}
                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl
                    text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 transition-all" />
                {busquedaSerial.length > 0 && !productoSerialSel && (
                  <div className="flex flex-col max-h-28 overflow-y-auto rounded-xl border border-gray-100 bg-white">
                    {filtradosSerial.length === 0
                      ? <p className="text-xs text-gray-400 px-3 py-2">Sin resultados</p>
                      : filtradosSerial.map((p) => (
                          <button key={p.id}
                            onClick={() => { setProductoSerialSel(p); setBusquedaSerial(p.nombre); }}
                            className="text-left px-3 py-2 text-sm hover:bg-purple-50 text-gray-700 border-b border-gray-50 last:border-0">
                            {p.nombre}
                          </button>
                        ))
                    }
                  </div>
                )}
                {productoSerialSel && <p className="text-xs text-purple-600">✓ {productoSerialSel.nombre}</p>}
              </div>
              {coloresActivo && coloresLista.length > 0 && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-600">Color (opcional)</label>
                  <div className="flex flex-wrap gap-2">
                    {coloresLista.map((c) => (
                      <button key={c} type="button"
                        onClick={() => setColorRetoma(colorRetoma === c ? '' : c)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all
                          ${colorRetoma === c
                            ? 'bg-purple-100 border-purple-400 text-purple-800'
                            : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {caracteristicasActivo && caracteristicasLista.length > 0 && (
                <div className="flex flex-col gap-2">
                  {caracteristicasLista.map((campo) => (
                    <div key={campo} className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-gray-600">{campo} (opcional)</label>
                      <input type="text" placeholder={campo}
                        value={caracteristicasRetoma[campo] || ''}
                        onChange={(e) => setCaracteristicasRetoma((prev) => ({ ...prev, [campo]: e.target.value }))}
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl
                          text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 transition-all" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Campos cantidad */}
          {tipoRetoma === 'cantidad' && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-600">Producto {ingresoInventario ? '*' : ''}</label>
                <input type="text" placeholder="Buscar producto..." value={busquedaCantidad}
                  onChange={(e) => { setBusquedaCantidad(e.target.value); setProductoCantidadSel(null); setNodoSel(null); }}
                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl
                    text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 transition-all" />
                {busquedaCantidad.length > 0 && !productoCantidadSel && (
                  <div className="flex flex-col max-h-28 overflow-y-auto rounded-xl border border-gray-100 bg-white">
                    {filtradosCantidad.length === 0
                      ? <p className="text-xs text-gray-400 px-3 py-2">Sin resultados</p>
                      : filtradosCantidad.map((p) => (
                          <button key={p.id}
                            onClick={() => { setProductoCantidadSel(p); setNodoSel(null); setBusquedaCantidad(p.nombre); }}
                            className="text-left px-3 py-2 text-sm hover:bg-purple-50 text-gray-700 border-b border-gray-50 last:border-0">
                            {p.nombre}
                            <span className="text-xs text-gray-400 ml-2">Stock: {p.stock}</span>
                          </button>
                        ))
                    }
                  </div>
                )}
                {productoCantidadSel && (
                  <p className="text-xs text-purple-600">
                    ✓ {productoCantidadSel.nombre}{nodoSel?.label ? ` · ${nodoSel.label}` : ''}
                  </p>
                )}
                {ingresoInventario && productoCantidadSel && (
                  <SelectorNodoRetoma
                    productoId={productoCantidadSel.id}
                    sucursalId={prestamo.sucursal_id}
                    atributoId={nodoSel?.atributo_id}
                    varianteId={nodoSel?.variante_id}
                    onElegir={setNodoSel} />
                )}
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-600">Cantidad</label>
                <input type="number" min="1" placeholder="1" value={cantidadRetoma}
                  onChange={(e) => setCantidadRetoma(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl
                    text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 transition-all" />
              </div>
            </div>
          )}



          {/* Toggle ingreso inventario */}
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={ingresoInventario}
              onChange={(e) => setIngresoInventario(e.target.checked)}
              className="rounded accent-purple-600" />
            Ingresar al inventario
          </label>
        </div>

        {/* Valor de la retoma */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Valor de la retoma *</label>
          <InputMoneda value={valorRetoma} onChange={setValorRetoma} placeholder="0" autoFocus
            className="w-full px-3 py-2 bg-gray-100 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white transition-all" />
          <p className="text-xs text-gray-400">
            Este monto se aplica como abono al préstamo y es el costo con el que el artículo entra al inventario
          </p>
        </div>

        {/* Precio de venta del usado. Aparte del valor porque son dos cifras
            distintas: lo que se abona por él y a cuánto se va a revender. */}
        {ingresoInventario && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">
              Precio de venta <span className="text-gray-400 font-normal text-xs">(opcional)</span>
            </label>
            <InputMoneda value={precioVenta} onChange={setPrecioVenta}
              placeholder="Dejar vacío para no cambiarlo"
              className="w-full px-3 py-2 bg-gray-100 rounded-xl text-sm
                focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white transition-all" />
            <p className="text-xs text-gray-400">
              A cuánto se va a revender. Vacío deja el precio que ya tenía la referencia.
            </p>
          </div>
        )}

        {/* Resumen */}
        {retoma > 0 && (
          <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-1.5">
            <div className="flex justify-between text-xs text-gray-500">
              <span>Saldo pendiente:</span>
              <span className="font-medium text-gray-700">{formatCOP(saldoPendiente)}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>Artículo recibido:</span>
              <span className="font-medium text-purple-700">− {formatCOP(Math.min(retoma, saldoPendiente))}</span>
            </div>
            <div className={`flex justify-between text-sm font-semibold mt-1 pt-1 border-t border-gray-200
              ${diff > 0 ? 'text-red-600' : diff < 0 ? 'text-emerald-600' : 'text-green-600'}`}>
              <span>{diff > 0 ? 'Queda pendiente' : diff < 0 ? 'Saldo a favor generado' : 'Resultado'}</span>
              <span>
                {diff > 0 ? formatCOP(diff) : diff < 0 ? formatCOP(Math.abs(diff)) : 'Préstamo saldado ✓'}
              </span>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mutation.isPending} onClick={handleConfirmar}>
            <ArrowLeftRight size={14} /> Registrar pago en producto
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Helper: tiempo desde último abono ───────────────────────────────────────

function tiempoUltimoAbono(fecha) {
  if (!fecha) return { texto: 'Sin abonos', nivel: 'rojo' };

  const ahora   = new Date();
  const d       = new Date(fecha);
  const diffMs  = ahora - d;
  const dias    = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let texto;
  if (dias < 1)        texto = 'hoy';
  else if (dias === 1) texto = 'ayer';
  else if (dias < 7)   texto = `hace ${dias} días`;
  else if (dias < 30)  { const s = Math.floor(dias / 7);  texto = `hace ${s} semana${s > 1 ? 's' : ''}`; }
  else if (dias < 365) { const m = Math.floor(dias / 30); texto = `hace ${m} mes${m > 1 ? 'es' : ''}`; }
  else                   texto = 'hace más de 1 año';

  const nivel = dias <= 7 ? 'verde' : dias <= 30 ? 'amarillo' : dias <= 60 ? 'naranja' : 'rojo';
  return { texto, nivel };
}

const ABONO_CLASES = {
  verde:    'bg-green-50  text-green-600  border-green-200',
  amarillo: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  naranja:  'bg-orange-50 text-orange-600 border-orange-200',
  rojo:     'bg-red-50    text-red-600    border-red-200',
};

// ─── Card resumen de persona ──────────────────────────────────────────────────

// Recibe las cifras ya agregadas en vez de la lista de préstamos. Las cuentas
// son las mismas —contar activos y cerrados, y sumar valor y abonado de los
// activos— solo que ahora las hace la base: para pintar diez tarjetas no hacía
// falta bajarse los 9.976 préstamos del negocio al navegador.
function CardPersona({ nombre, tipo, nActivos, nCerrados, valorActivos, abonadoActivos, saldoTotal, ultimoAbono, nVencidos = 0, diasVencidoMax = 0, onSeleccionar, onEditar }) {
  const pct = valorActivos > 0 ? Math.min(100, (abonadoActivos / valorActivos) * 100) : 0;

  const avatarClass = tipo === 'companero'
    ? 'bg-blue-100 text-blue-700'
    : 'bg-violet-100 text-violet-700';

  const { texto: abonoTexto, nivel: abonoNivel } = tiempoUltimoAbono(ultimoAbono);

  return (
    <div
      onClick={onSeleccionar}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSeleccionar()}
      className="w-full text-left bg-white border border-gray-100 rounded-2xl p-4
        hover:border-blue-200 hover:shadow-sm active:scale-[0.99] transition-all
        flex items-center gap-3 cursor-pointer"
    >
      {/* Avatar */}
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center
        flex-shrink-0 text-sm font-bold ${avatarClass}`}>
        {iniciales(nombre)}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-gray-900 leading-tight truncate">{nombre}</p>
          {saldoTotal > 0 && (
            <span className="text-sm font-bold text-red-500 flex-shrink-0 leading-tight">
              {formatCOP(saldoTotal)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {nActivos > 0 && (
            <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">
              {nActivos} activo{nActivos !== 1 ? 's' : ''}
            </span>
          )}
          {nCerrados > 0 && (
            <span className="text-xs bg-gray-50 text-gray-400 px-2 py-0.5 rounded-full">
              {nCerrados} cerrado{nCerrados !== 1 ? 's' : ''}
            </span>
          )}
          {nActivos > 0 && (
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${ABONO_CLASES[abonoNivel]}`}>
              {abonoTexto}
            </span>
          )}
          <BadgeVencidosPersona cuantos={nVencidos} diasMax={diasVencidoMax} />
        </div>

        {nActivos > 0 && (
          <div className="mt-2 w-full bg-gray-100 rounded-full h-1">
            <div className="bg-blue-400 h-1 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        {onEditar && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onEditar(); }}
            title={tipo === 'companero' ? 'Editar prestamista' : 'Editar cliente'}
            className="p-1.5 rounded-lg text-gray-300 hover:text-blue-500 hover:bg-blue-50 transition-colors"
          >
            <Settings size={15} />
          </button>
        )}
        <ChevronRight size={15} className="text-gray-300" />
      </div>
    </div>
  );
}

// ─── Tarjeta de préstamo individual (en vista detalle) ────────────────────────

const METODO_BADGE = {
  Efectivo:        'bg-green-100 text-green-700',
  Transferencia:   'bg-blue-100 text-blue-700',
  Intercambio:     'bg-purple-100 text-purple-700',
  'Saldo a favor': 'bg-yellow-100 text-yellow-700',
};

const METODO_LABEL = {
  Intercambio: 'Pago en producto',
};

function HistorialPrestamo({ prestamoId, prestamoEstado }) {
  const queryClient = useQueryClient();
  const [confirmandoId, setConfirmandoId] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['prestamo-detalle', prestamoId],
    queryFn:  () => api.get(`/prestamos/${prestamoId}`).then((r) => r.data.data),
    staleTime: 0,
  });

  const mutAnular = useMutation({
    mutationFn: ({ abonoId, retomaId }) => anularAbonoApi(prestamoId, abonoId, retomaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prestamo-detalle', prestamoId] });
      queryClient.invalidateQueries({ queryKey: ['prestamos'], exact: false });
      setConfirmandoId(null);
    },
    onError: (err) => {
      alert(err.response?.data?.error || 'Error al anular el abono');
      setConfirmandoId(null);
    },
  });

  if (isLoading) return <div className="py-2 text-center"><Loader2 size={14} className="animate-spin text-gray-400 mx-auto" /></div>;

  const abonos  = data?.abonos  || [];
  const retomas = data?.retomas || [];

  if (!abonos.length && !retomas.length) {
    return <p className="text-xs text-gray-400 text-center py-1">Sin movimientos registrados</p>;
  }

  // Empareja cada abono de tipo Intercambio con su retoma (orden de inserción 1:1)
  let retomaIdx = 0;
  const retomaByAbonoId = {};
  abonos.forEach((ab) => {
    if (ab.metodo === 'Intercambio' && retomaIdx < retomas.length) {
      retomaByAbonoId[ab.id] = retomas[retomaIdx++];
    }
  });

  return (
    <div className="flex flex-col gap-2">
      {abonos.map((abono) => {
        const retoma     = retomaByAbonoId[abono.id] || null;
        const badgeClass = METODO_BADGE[abono.metodo] || 'bg-gray-100 text-gray-600';
        const confirmando = confirmandoId === abono.id;

        return (
          <div key={abono.id} className="flex flex-col gap-1 bg-gray-50 rounded-xl px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badgeClass}`}>
                  {METODO_LABEL[abono.metodo] ?? abono.metodo}
                </span>
                {abono.abono_total_id && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                    Pago total {formatCOP(abono.abono_total_valor)}
                  </span>
                )}
                {abono.abono_total_descripcion && (
                  <span className="text-xs text-indigo-400 italic">
                    {abono.abono_total_descripcion}
                  </span>
                )}
                <span className="text-xs text-gray-400">{formatFechaHora(abono.fecha)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-green-600 flex-shrink-0">
                  + {formatCOP(abono.valor)}
                </span>
                {!confirmando && !abono.abono_total_id && (
                  <button
                    onClick={() => setConfirmandoId(abono.id)}
                    title="Anular abono"
                    className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0">
                    <XCircle size={15} />
                  </button>
                )}
              </div>
            </div>

            {abono.usuario_nombre && (
              <p className="text-xs text-gray-400">por {abono.usuario_nombre}</p>
            )}

            {/* Confirmación inline */}
            {confirmando && (
              <div className="mt-1 p-2 bg-red-50 border border-red-200 rounded-lg flex flex-col gap-1.5">
                <p className="text-xs font-medium text-red-700">
                  ¿Anular este abono de {formatCOP(abono.valor)}?
                </p>
                {prestamoEstado === 'Saldado' && (
                  <p className="text-xs text-red-500">
                    El préstamo volverá a Activo y la factura será cancelada.
                  </p>
                )}
                {retoma?.ingreso_inventario && (
                  <p className="text-xs text-red-500">
                    El producto retomado será eliminado del inventario.
                  </p>
                )}
                <div className="flex gap-2 mt-0.5">
                  <button
                    onClick={() => mutAnular.mutate({ abonoId: abono.id, retomaId: retoma?.id || null })}
                    disabled={mutAnular.isPending}
                    className="flex-1 text-xs py-1 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50">
                    {mutAnular.isPending ? 'Anulando…' : 'Sí, anular'}
                  </button>
                  <button
                    onClick={() => setConfirmandoId(null)}
                    className="flex-1 text-xs py-1 bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors">
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {abono.metodo === 'Intercambio' && retoma && !confirmando && (
              <div className="mt-1 pt-1 border-t border-purple-100 flex flex-col gap-0.5">
                <p className="text-xs font-medium text-purple-700">
                  Artículo recibido: {retoma.nombre_producto || retoma.producto_serial_nombre || retoma.producto_cantidad_nombre}
                </p>
                {retoma.imei && (
                  <p className="text-xs text-gray-400 font-mono">IMEI: {retoma.imei}</p>
                )}
                {retoma.color && (
                  <p className="text-xs text-gray-400">Color: {retoma.color}</p>
                )}
                <p className="text-xs text-purple-600">
                  Valor: {formatCOP(retoma.valor_retoma)}
                  {retoma.ingreso_inventario ? ' · ingresó al inventario' : ''}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TarjetaPrestamoDetalle({ prestamo, onAbonar, onDevolver, onImprimir, onIntercambiar, onAplicarSaldo, onEditar, saldoAFavor = 0, aplicandoSaldo = false, coloresActivo, cerrado = false }) {
  const configMora    = useMora();
  const configInteres = useInteres();
  // useMetodosPago devuelve {id,label}; PanelMora solo necesita los ids.
  const metodosPagoMora = useMetodosPago().map((m) => m.id);
  const [historialAbierto, setHistorialAbierto] = useState(false);

  const saldo    = Number(prestamo.valor_prestamo) - Number(prestamo.total_abonado);
  const progreso = (Number(prestamo.total_abonado) / Number(prestamo.valor_prestamo)) * 100;
  const esSaldado = prestamo.estado === 'Saldado';
  const tieneMovimientos = Number(prestamo.total_abonado) > 0;

  return (
    <div className={`rounded-2xl border flex flex-col gap-0 overflow-hidden
      ${cerrado ? 'bg-gray-50 border-gray-100' : 'bg-white border-gray-200'}`}>

      <div className="p-4 flex flex-col gap-3">
        {/* Encabezado del producto */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-semibold truncate ${cerrado ? 'text-gray-500' : 'text-gray-800'}`}>
              {prestamo.nombre_producto}
            </p>
            {prestamo.imei && (
              <p className="text-xs text-gray-400 font-mono mt-0.5">{prestamo.imei}</p>
            )}
            {!prestamo.imei && prestamo.cantidad_prestada > 1 && (
              <p className="text-xs text-gray-400 mt-0.5">Cantidad: {prestamo.cantidad_prestada}</p>
            )}
            {(prestamo.atributo_label || prestamo.variante_label) && (
              <div className="flex flex-wrap gap-1 mt-0.5">
                {prestamo.atributo_label && (
                  <span className="text-xs bg-blue-50 text-blue-600 border border-blue-100 px-2 py-0.5 rounded-full">
                    {prestamo.atributo_label}
                  </span>
                )}
                {prestamo.variante_label && (
                  <span className="text-xs bg-purple-50 text-purple-600 border border-purple-100 px-2 py-0.5 rounded-full">
                    {prestamo.variante_label}
                  </span>
                )}
              </div>
            )}
            {prestamo.linea_nombre && (
              <span className="text-xs bg-gray-100 text-gray-500 border border-gray-200 px-2 py-0.5 rounded-full w-fit">
                {prestamo.linea_nombre}
              </span>
            )}
            {coloresActivo && prestamo.serial_color && <ChipColor color={prestamo.serial_color} />}
            {prestamo.empleado_nombre && (
              <p className="text-xs text-blue-500 mt-0.5">→ {prestamo.empleado_nombre}</p>
            )}
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-xs text-gray-400">{formatFechaHora(prestamo.fecha)}</span>
              {prestamo.usuario_nombre && (
                <span className="text-xs text-gray-400">· registrado por {prestamo.usuario_nombre}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <BotonImprimirPrestamo prestamo={prestamo} onClick={onImprimir} />
            <Badge variant={prestamo.estado === 'Activo' ? 'blue' : esSaldado ? 'green' : 'gray'}>
              {prestamo.estado}
            </Badge>
          </div>
        </div>

        {/* Barra de progreso */}
        <div className="flex flex-col gap-1">
          <div className="w-full bg-gray-100 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all ${esSaldado ? 'bg-green-400' : 'bg-blue-500'}`}
              style={{ width: `${Math.min(progreso, 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-400">
              {esSaldado ? '✓ ' : ''}Abonado: {formatCOP(Number(prestamo.total_abonado))}
            </span>
            {!esSaldado && (
              <span className={`font-medium ${saldo > 0 ? 'text-red-500' : 'text-green-600'}`}>
                Saldo: {formatCOP(saldo)}
              </span>
            )}
          </div>
        </div>

        {/* Plazo de pago y mora (solo si el negocio activó la feature).
            Los números vienen calculados del backend en prestamo.mora. */}
        {prestamo.estado === 'Activo' && (
          <PanelMora
            documento={prestamo}
            configMora={configMora}
            metodosPago={metodosPagoMora}
            invalidar={[['prestamos'], ['estado-cuenta'], ['caja'], ['facturas']]}
            api={{
              fijarPlazo:   (d) => fijarPlazoPrestamo(prestamo.id, d),
              cobrarMora:   (d) => cobrarMoraPrestamo(prestamo.id, d),
              condonarMora: (d) => condonarMoraPrestamo(prestamo.id, d),
            }}
          />
        )}

        {/* Interés por financiar. Panel aparte porque es un cargo distinto:
            se puede perdonar la mora y seguir cobrando el interés pactado. */}
        {prestamo.estado === 'Activo' && (
          <PanelInteres
            documento={prestamo}
            configInteres={configInteres}
            metodosPago={metodosPagoMora}
            invalidar={[['prestamos'], ['estado-cuenta'], ['caja'], ['facturas']]}
            api={{
              fijarInteres:  (d) => fijarInteresPrestamo(prestamo.id, d),
              cobrarCargo:   (d) => cobrarMoraPrestamo(prestamo.id, d),
              condonarCargo: (d) => condonarMoraPrestamo(prestamo.id, d),
            }}
          />
        )}

        {/* Acciones — solo préstamos activos */}
        {prestamo.estado === 'Activo' && (
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" className="flex-1" onClick={() => onAbonar(prestamo)}>
              <Plus size={14} /> Abonar
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onIntercambiar(prestamo)}>
              <ArrowLeftRight size={14} /> Pago en producto
            </Button>
            {prestamo.cedula !== 'AJUSTE' && (
              <Button size="sm" variant="secondary" onClick={() => onDevolver(prestamo)}>
                <CheckCircle size={14} /> Devuelto
              </Button>
            )}
            {saldoAFavor > 0 && saldo > 0 && (
              <button
                onClick={() => onAplicarSaldo(prestamo.id)}
                disabled={aplicandoSaldo}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
                  border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100
                  transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {aplicandoSaldo
                  ? <Loader2 size={12} className="animate-spin" />
                  : <Wallet size={12} />}
                Aplicar saldo a favor
              </button>
            )}
            {onEditar && (
              <button
                onClick={() => onEditar(prestamo)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
                  border border-gray-200 text-gray-500 bg-white hover:bg-gray-50
                  transition-colors">
                <Pencil size={12} /> Editar valor
              </button>
            )}
          </div>
        )}
      </div>

      {/* Historial desplegable */}
      {tieneMovimientos && (
        <div className="border-t border-gray-100">
          <button
            onClick={() => setHistorialAbierto((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2 text-xs text-gray-500
              hover:bg-gray-50 transition-colors font-medium">
            <span>Historial de movimientos</span>
            {historialAbierto
              ? <ChevronUp size={13} className="text-gray-400" />
              : <ChevronDown size={13} className="text-gray-400" />}
          </button>
          {historialAbierto && (
            <div className="px-4 pb-4">
              <HistorialPrestamo prestamoId={prestamo.id} prestamoEstado={prestamo.estado} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Vista detalle de persona ─────────────────────────────────────────────────

function VistaDetallePersona({ nombre, tipo, personaId, prestamos, saldoAFavor = 0, onVolver, onAbonar, onDevolver, onImprimir, onIntercambiar, onRegistrarSaldo, onRetomaDirecta, onAjusteCuentas, coloresActivo, onVerHistorialSaldo }) {
  const queryClient    = useQueryClient();
  const sucursalActiva = useSucursalStore((s) => s.sucursalActiva);

  const [tabDetalle,          setTabDetalle]          = useState('prestamos'); // 'prestamos' | 'cuenta'
  const [cerradosAbiertos,    setCerradosAbiertos]    = useState(false);
  const [retomasAbiertas,     setRetomasAbiertas]     = useState(false);
  const [confirmAnularRetoma, setConfirmAnularRetoma] = useState(null);
  const [busquedaPrest,       setBusquedaPrest]       = useState('');
  const [fechaPrestDesde,     setFechaPrestDesde]     = useState('');
  const [fechaPrestHasta,     setFechaPrestHasta]     = useState('');
  const [aplicandoSaldoId,    setAplicandoSaldoId]    = useState(null);
  const [resultadoSaldo,      setResultadoSaldo]      = useState(null);
  const [editandoPrestamo,    setEditandoPrestamo]    = useState(null);
  const [modalAbonoTotal,     setModalAbonoTotal]     = useState(null); // null | { mode, abonoTotalId?, valorActual?, metodoActual? }
  const tipoApi = tipo === 'companero' ? 'prestatario' : tipo;

  // Saldo real de esta sucursal (no el global de prestatarios/clientes)
  const { data: saldoSucData } = useQuery({
    queryKey:  ['saldo-sucursal', tipoApi, personaId, sucursalActiva],
    queryFn:   () => getSaldoSucursalApi(tipoApi, personaId).then((r) => r.data.data),
    staleTime: 0,
  });
  const saldoSucursal = Number(saldoSucData?.saldo ?? 0);

  const _invalidarSaldo = () => {
    queryClient.invalidateQueries({ queryKey: ['prestamos'],       exact: false });
    queryClient.invalidateQueries({ queryKey: ['saldo-sucursal'],  exact: false });
    queryClient.invalidateQueries({ queryKey: ['historial-saldo-sucursal'], exact: false });
  };

  const mutAplicarSaldo = useMutation({
    mutationFn: (prestamoId) => aplicarSaldoAPrestamoApi(prestamoId),
    onMutate:   (prestamoId) => setAplicandoSaldoId(prestamoId),
    onSuccess:  (res) => {
      _invalidarSaldo();
      setResultadoSaldo(res.data.data);
      setAplicandoSaldoId(null);
    },
    onError: (err) => {
      alert(err.response?.data?.error || 'Error al aplicar el saldo');
      setAplicandoSaldoId(null);
    },
  });

  const { data: retomasDirectas = [] } = useQuery({
    queryKey:  ['retomas-directas', tipoApi, personaId],
    queryFn:   () => getRetomasDirectasApi(tipoApi, personaId).then((r) => r.data.data),
    staleTime: 30_000,
  });

  const mutAnularRetoma = useMutation({
    mutationFn: (retomaId) => anularRetomaDirectaApi(retomaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['retomas-directas', tipoApi, personaId] });
      _invalidarSaldo();
      setConfirmAnularRetoma(null);
    },
    onError: (err) => {
      alert(err.response?.data?.error || 'Error al anular la retoma');
      setConfirmAnularRetoma(null);
    },
  });

  const activosAll  = prestamos.filter((p) => p.estado === 'Activo');
  const cerradosAll = prestamos.filter((p) => p.estado !== 'Activo');
  const saldoTotal  = activosAll.reduce(
    (s, p) => s + (Number(p.valor_prestamo) - Number(p.total_abonado)), 0
  );
  const pagadoTotal = prestamos.reduce((s, p) => s + Number(p.total_abonado), 0);

  const hayFiltrosPrest = busquedaPrest.trim() || fechaPrestDesde || fechaPrestHasta;

  const filtrarPrest = (lista) => lista.filter((p) => {
    const q = busquedaPrest.trim().toLowerCase();
    if (q && !p.nombre_producto?.toLowerCase().includes(q) && !p.linea_nombre?.toLowerCase().includes(q)) return false;
    if (fechaPrestDesde && p.fecha && new Date(p.fecha) < new Date(fechaPrestDesde)) return false;
    if (fechaPrestHasta && p.fecha && new Date(p.fecha) > new Date(fechaPrestHasta + 'T23:59:59')) return false;
    return true;
  });

  const activos  = filtrarPrest(activosAll);
  const cerrados = filtrarPrest(cerradosAll);

  const ref      = prestamos[0] || {};
  const cedula   = ref.cedula   !== 'COMPANERO' ? ref.cedula   : null;
  const telefono = ref.telefono !== '0000000000' ? ref.telefono : null;

  const avatarClass = tipo === 'companero'
    ? 'bg-blue-100 text-blue-700'
    : 'bg-violet-100 text-violet-700';

  return (
    <div className="flex flex-col gap-4">

      {/* Botón volver */}
      <button onClick={onVolver}
        className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 w-fit transition-colors">
        <ChevronLeft size={16} /> Volver
      </button>

      {/* Ficha de cuenta */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">

        {/* Fila 1: identidad */}
        <div className="p-4 flex items-center gap-3">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center
            text-sm font-bold flex-shrink-0 ${avatarClass}`}>
            {iniciales(nombre)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-900 text-base leading-tight truncate">{nombre}</p>
            <div className="flex flex-wrap gap-x-3 mt-0.5">
              {cedula   && <p className="text-xs text-gray-400">CC: {cedula}</p>}
              {telefono && <p className="text-xs text-gray-400">Tel: {telefono}</p>}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {activosAll.length > 0 && (
              <BotonExportarPdf
                tipo={tipo === 'companero' ? 'prestatario' : 'cliente'}
                personaId={personaId}
                nombrePersona={nombre}
              />
            )}
            <BotonExportarExcel
              tipo={tipo === 'companero' ? 'prestatario' : 'cliente'}
              personaId={personaId}
              nombre={nombre}
              cedula={cedula}
              telefono={telefono}
              prestamos={prestamos}
              saldoAFavor={saldoAFavor}
            />
          </div>
        </div>

        {/* Fila 2: métricas de cuenta */}
        <div className="grid grid-cols-3 divide-x divide-gray-100 border-t border-gray-100">
          <div className="px-4 py-3 flex flex-col gap-0.5">
            <p className="text-xs text-gray-400">Deuda total</p>
            <p className={`text-sm font-bold ${saldoTotal > 0 ? 'text-red-500' : 'text-gray-400'}`}>
              {saldoTotal > 0 ? formatCOP(saldoTotal) : '—'}
            </p>
          </div>
          <button
            onClick={onVerHistorialSaldo}
            className="px-4 py-3 flex flex-col gap-0.5 text-left hover:bg-emerald-50 transition-colors rounded-none">
            <p className="text-xs text-gray-400">Saldo a favor</p>
            <p className={`text-sm font-bold ${saldoSucursal > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>
              {saldoSucursal > 0 ? formatCOP(saldoSucursal) : '—'}
            </p>
          </button>
          <div className="px-4 py-3 flex flex-col gap-0.5">
            <p className="text-xs text-gray-400">Total pagado</p>
            <p className={`text-sm font-bold ${pagadoTotal > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
              {pagadoTotal > 0 ? formatCOP(pagadoTotal) : '—'}
            </p>
          </div>
        </div>

        {/* Fila 3: acciones */}
        <div className="px-4 py-3 border-t border-gray-100 flex flex-wrap items-center gap-2">
          <button
            onClick={onRetomaDirecta}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
              border border-purple-200 text-purple-600 bg-purple-50 hover:bg-purple-100 transition-colors">
            <ArrowLeftRight size={12} /> Comprar artículo
          </button>
          <button
            onClick={onAjusteCuentas}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
              border border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors">
            <SlidersHorizontal size={12} /> Ajuste de cuentas
          </button>
          {activosAll.length > 1 && (
            <button
              onClick={() => setModalAbonoTotal({ mode: 'crear' })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors">
              <Layers size={12} /> Abono total
            </button>
          )}
          <button
            onClick={onRegistrarSaldo}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-400
              hover:text-gray-600 transition-colors ml-auto">
            <Plus size={12} />
            {saldoSucursal > 0 ? 'Actualizar saldo' : 'Registrar saldo a favor'}
          </button>
        </div>
      </div>

      {/* Tabs: Préstamos / Estado de cuenta */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {[
          { id: 'prestamos', label: 'Préstamos' },
          { id: 'cuenta',    label: 'Estado de cuenta' },
        ].map((tab) => (
          <button key={tab.id} onClick={() => setTabDetalle(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all
              ${tabDetalle === tab.id
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Estado de cuenta ── */}
      {tabDetalle === 'cuenta' && (
        <EstadoDeCuenta
          tipo={tipo}
          personaId={personaId}
          onEditarAbonoTotal={(mov) => setModalAbonoTotal({
            mode:         'editar',
            abonoTotalId: mov.referencia_id,
            valorActual:  mov.abono,
            // El método sale del concepto, así que la descripción viaja aparte:
            // pegada ahí se colaría dentro del método al reabrir el pago.
            metodoActual: mov.concepto?.replace('Pago total ', '') || 'Efectivo',
            descripcionActual: mov.descripcion || '',
          })}
        />
      )}

      {/* ── Tab: Préstamos ── */}
      {tabDetalle === 'prestamos' && (
        <>

      {/* Barra búsqueda + fechas */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Buscar por producto o línea..."
              value={busquedaPrest}
              onChange={(e) => setBusquedaPrest(e.target.value)}
              className="w-full pl-8 pr-3 py-2 bg-white border border-gray-200 rounded-xl text-sm
                focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition-all"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-gray-400 whitespace-nowrap">Desde</label>
            <input type="date" value={fechaPrestDesde}
              onChange={(e) => setFechaPrestDesde(e.target.value)}
              className="px-2 py-2 bg-white border border-gray-200 rounded-xl text-xs text-gray-700
                focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all" />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-gray-400 whitespace-nowrap">Hasta</label>
            <input type="date" value={fechaPrestHasta}
              onChange={(e) => setFechaPrestHasta(e.target.value)}
              className="px-2 py-2 bg-white border border-gray-200 rounded-xl text-xs text-gray-700
                focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all" />
          </div>
          {hayFiltrosPrest && (
            <button
              onClick={() => { setBusquedaPrest(''); setFechaPrestDesde(''); setFechaPrestHasta(''); }}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors whitespace-nowrap">
              Limpiar
            </button>
          )}
        </div>
        {hayFiltrosPrest && (
          <p className="text-xs text-gray-400">
            {activos.length + cerrados.length} préstamo{activos.length + cerrados.length !== 1 ? 's' : ''} encontrado{activos.length + cerrados.length !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {/* Préstamos activos */}
      {activos.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-1">
            Activos ({activos.length})
          </p>
          {activos.map((p) => (
            <TarjetaPrestamoDetalle key={p.id} prestamo={p}
              onAbonar={onAbonar} onDevolver={onDevolver} onImprimir={onImprimir}
              onIntercambiar={onIntercambiar}
              saldoAFavor={saldoAFavor}
              onAplicarSaldo={(id) => mutAplicarSaldo.mutate(id)}
              aplicandoSaldo={aplicandoSaldoId === p.id}
              onEditar={(p) => setEditandoPrestamo(p)}
              coloresActivo={coloresActivo} />
          ))}
        </div>
      )}

      {activos.length === 0 && (
        <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3 text-center">
          <p className="text-green-700 text-sm font-medium">✓ Sin préstamos activos</p>
        </div>
      )}

      {/* Artículos comprados (colapsable) */}
      {retomasDirectas.length > 0 && (
        <div className="border border-purple-100 rounded-2xl overflow-hidden">
          <button
            onClick={() => setRetomasAbiertas((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3
              bg-purple-50 hover:bg-purple-100 transition-colors">
            <div className="flex items-center gap-2">
              <ArrowLeftRight size={13} className="text-purple-500" />
              <span className="text-xs font-semibold text-purple-700 uppercase tracking-wide">
                Artículos comprados al cliente
              </span>
              <span className="text-xs bg-purple-200 text-purple-700 px-2 py-0.5 rounded-full">
                {retomasDirectas.length}
              </span>
            </div>
            {retomasAbiertas
              ? <ChevronUp size={15} className="text-purple-400" />
              : <ChevronDown size={15} className="text-purple-400" />}
          </button>

          {retomasAbiertas && (
            <div className="flex flex-col gap-2 p-3">
              {retomasDirectas.map((r) => {
                const confirmando = confirmAnularRetoma === r.id;
                return (
                  <div key={r.id} className="bg-white border border-purple-100 rounded-xl px-3 py-2 flex flex-col gap-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{r.nombre_producto}</p>
                        {r.imei && <p className="text-xs text-gray-400 font-mono">IMEI: {r.imei}</p>}
                        {r.color && <p className="text-xs text-gray-400">Color: {r.color}</p>}
                        {r.fecha && <p className="text-xs text-gray-400">{formatFechaHora(r.fecha)}</p>}
                        <p className="text-xs text-purple-600 mt-0.5">
                          {formatCOP(r.valor_retoma)}
                          {r.ingreso_inventario ? ' · en inventario' : ' · sin inventario'}
                        </p>
                      </div>
                      {!confirmando && (
                        <button
                          onClick={() => setConfirmAnularRetoma(r.id)}
                          title="Anular compra de artículo"
                          className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0 mt-0.5">
                          <XCircle size={15} />
                        </button>
                      )}
                    </div>

                    {confirmando && (
                      <div className="mt-1 p-2 bg-red-50 border border-red-200 rounded-lg flex flex-col gap-1.5">
                        <p className="text-xs font-medium text-red-700">
                          ¿Anular esta compra de artículo por {formatCOP(r.valor_retoma)}?
                        </p>
                        {r.ingreso_inventario && (
                          <p className="text-xs text-red-500">El producto será eliminado del inventario.</p>
                        )}
                        <p className="text-xs text-red-500">
                          Se reducirá el saldo a favor en {formatCOP(r.valor_retoma)}.
                        </p>
                        <div className="flex gap-2 mt-0.5">
                          <button
                            onClick={() => mutAnularRetoma.mutate(r.id)}
                            disabled={mutAnularRetoma.isPending}
                            className="flex-1 text-xs py-1 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50">
                            {mutAnularRetoma.isPending ? 'Anulando…' : 'Sí, anular'}
                          </button>
                          <button
                            onClick={() => setConfirmAnularRetoma(null)}
                            className="flex-1 text-xs py-1 bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors">
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Préstamos cerrados (colapsable) */}
      {cerrados.length > 0 && (
        <div className="border border-gray-100 rounded-2xl overflow-hidden">
          <button
            onClick={() => setCerradosAbiertos((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3
              bg-gray-50 hover:bg-gray-100 transition-colors">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Historial cerrados
              </span>
              <span className="text-xs bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full">
                {cerrados.length}
              </span>
            </div>
            {cerradosAbiertos
              ? <ChevronUp size={15} className="text-gray-400" />
              : <ChevronDown size={15} className="text-gray-400" />}
          </button>

          {cerradosAbiertos && (
            <div className="flex flex-col gap-2.5 p-3">
              {cerrados.map((p) => (
                <TarjetaPrestamoDetalle key={p.id} prestamo={p}
                  onAbonar={onAbonar} onDevolver={onDevolver} onImprimir={onImprimir}
                  onIntercambiar={onIntercambiar}
                  coloresActivo={coloresActivo} cerrado />
              ))}
            </div>
          )}
        </div>
      )}
        </>
      )}

      {/* Modal editar valor de préstamo */}
      {editandoPrestamo && (
        <ModalEditarValorPrestamo
          key={editandoPrestamo.id}
          open
          onClose={() => setEditandoPrestamo(null)}
          mov={{
            referencia_id: editandoPrestamo.id,
            concepto:      `Préstamo — ${editandoPrestamo.nombre_producto}`,
            cargo:         Number(editandoPrestamo.valor_prestamo),
          }}
          tipoApi={tipoApi}
          personaId={personaId}
        />
      )}

      {/* Modal informativo — resultado de aplicar saldo */}
      {resultadoSaldo && (
        <Modal open onClose={() => setResultadoSaldo(null)} title="Saldo aplicado" size="sm">
          <div className="flex flex-col gap-4">
            <div className={`rounded-xl px-4 py-3 text-center border
              ${resultadoSaldo.saldado
                ? 'bg-green-50 border-green-200'
                : 'bg-emerald-50 border-emerald-200'}`}>
              <p className={`font-semibold text-sm ${resultadoSaldo.saldado ? 'text-green-700' : 'text-emerald-700'}`}>
                {resultadoSaldo.saldado ? '✓ Préstamo saldado' : '✓ Saldo aplicado correctamente'}
              </p>
              <p className="text-xs mt-0.5 text-gray-500">{resultadoSaldo.nombre_producto}</p>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Monto aplicado</span>
                <span className="font-semibold text-emerald-700">− {formatCOP(resultadoSaldo.abono_aplicado)}</span>
              </div>
              <div className="flex justify-between text-sm border-t border-gray-100 pt-2">
                <span className="text-gray-500">Saldo a favor restante</span>
                <span className={`font-semibold ${resultadoSaldo.saldo_restante > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>
                  {formatCOP(resultadoSaldo.saldo_restante)}
                </span>
              </div>
            </div>
            <Button onClick={() => setResultadoSaldo(null)}>Cerrar</Button>
          </div>
        </Modal>
      )}

      {/* Modal abono total */}
      {modalAbonoTotal && (
        <ModalAbonoTotal
          nombre={nombre}
          tipo={tipo}
          personaId={personaId}
          prestamos={prestamos}
          mode={modalAbonoTotal.mode}
          abonoTotalId={modalAbonoTotal.abonoTotalId}
          valorActual={modalAbonoTotal.valorActual}
          metodoActual={modalAbonoTotal.metodoActual}
          descripcionActual={modalAbonoTotal.descripcionActual}
          onClose={() => setModalAbonoTotal(null)}
        />
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
        <span>Abonado: {formatCOP(abonado)}</span><span>{pct}%</span>
      </div>
      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className="h-full bg-orange-400 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
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
            Factura #{String(entrega.factura_numero ?? entrega.factura_id).padStart(6, '0')}
            {entrega.cliente_celular ? ` · ${entrega.cliente_celular}` : ''}
          </p>
          {entrega.direccion_entrega && <p className="text-xs text-gray-400 truncate mt-0.5">{entrega.direccion_entrega}</p>}
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <Badge variant="yellow">Pendiente</Badge>
          <span className="text-xs text-gray-400">{formatFechaHora(entrega.fecha_asignacion)}</span>
        </div>
      </div>
      <BarraProgreso abonado={Number(entrega.total_abonado)} total={Number(entrega.valor_total)} />
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
      className="w-full text-left flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-700 truncate">{entrega.nombre_cliente}</p>
        <p className="text-xs text-gray-400">#{String(entrega.factura_numero ?? entrega.factura_id).padStart(6, '0')} · {entrega.domiciliario_nombre}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-xs text-gray-400 hidden sm:block">{formatFechaHora(entrega.fecha_asignacion)}</span>
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
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors">
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
        {abierto ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
      </button>
      {abierto && (
        <div className="flex flex-col divide-y divide-gray-50 bg-white">
          {entregas.map((entrega) => (
            <FilaEntregaCompacta key={entrega.id} entrega={entrega} onSeleccionar={onSeleccionar} />
          ))}
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
      refetch(); setValorAbono(''); setNotasAbono(''); setErrorLocal('');
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
      refetch(); setConfirmarDev(false);
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
      <button onClick={onVolver} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 w-fit">
        <ChevronLeft size={13} /> Volver a la lista
      </button>
      <div className="bg-orange-50 border border-orange-100 rounded-xl p-3 flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-800">{e?.nombre_cliente}</p>
          <Badge variant={ESTADO_ENTREGA_BADGE[e?.estado] || 'gray'}>{ESTADO_ENTREGA_LABEL[e?.estado] || e?.estado}</Badge>
        </div>
        <p className="text-xs text-gray-500">Factura #{String(e?.factura_numero ?? e?.factura_id ?? 0).padStart(6, '0')}{e?.cliente_celular ? ` · ${e.cliente_celular}` : ''}</p>
        <p className="text-xs text-orange-600 font-medium">Domiciliario: {e?.domiciliario_nombre}{e?.domiciliario_telefono ? ` · ${e.domiciliario_telefono}` : ''}</p>
        {e?.direccion_entrega && <p className="text-xs text-gray-500">{e.direccion_entrega}</p>}
        {e?.notas && <p className="text-xs text-gray-400 italic">{e.notas}</p>}
        <p className="text-xs text-gray-400">{formatFechaHora(e?.fecha_asignacion)}</p>
      </div>
      <BarraProgreso abonado={Number(e?.total_abonado || 0)} total={Number(e?.valor_total || 0)} />
      {e?.abonos?.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Historial de abonos</p>
          <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
            {e.abonos.map((abono) => (
              <div key={abono.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
                <div>
                  <p className="text-xs text-gray-500">{formatFechaHora(abono.fecha)}</p>
                  {abono.notas && <p className="text-xs text-gray-400 italic">{abono.notas}</p>}
                  {abono.usuario_nombre && <p className="text-xs text-gray-400">por {abono.usuario_nombre}</p>}
                </div>
                <span className="text-sm font-semibold text-green-600">+ {formatCOP(abono.valor)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {esPendiente && (
        <div className="flex flex-col gap-2 p-3 bg-green-50 border border-green-100 rounded-xl">
          <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Registrar abono</p>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Valor (máx. {formatCOP(saldoPendiente)})</label>
            <InputMoneda value={valorAbono} onChange={setValorAbono} placeholder="0"
              className="w-full px-3 py-2 bg-white border border-green-200 rounded-xl text-sm
                focus:outline-none focus:ring-2 focus:ring-green-400 transition-all" />
          </div>
          <Input label="Notas (opcional)" placeholder="Observaciones del abono..."
            value={notasAbono} onChange={(e) => setNotasAbono(e.target.value)} />
          <Button size="sm" loading={mutAbono.isPending} disabled={!valorAbono || Number(valorAbono) <= 0} onClick={handleAbono}>
            Registrar abono
          </Button>
        </div>
      )}
      {esPendiente && !confirmarDev && (
        <button onClick={() => setConfirmarDev(true)}
          className="w-full py-2.5 rounded-xl text-sm font-medium border border-red-200 text-red-500 bg-red-50 hover:bg-red-100 transition-colors">
          Marcar como no entregado (devolución)
        </button>
      )}
      {esPendiente && confirmarDev && (
        <div className="flex flex-col gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-700">Esto cancelará la factura y revertirá el stock al inventario. Esta acción no se puede deshacer.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" className="flex-1" onClick={() => setConfirmarDev(false)}>Cancelar</Button>
            <Button size="sm" className="flex-1 bg-red-500 hover:bg-red-600" loading={mutDevolucion.isPending} onClick={() => mutDevolucion.mutate()}>
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

  const { data: domiciliariosData } = useQuery({ queryKey: ['domiciliarios'], queryFn: () => getDomiciliarios().then((r) => r.data.data) });
  const { data: entregasData, isLoading } = useQuery({
    queryKey: ['entregas-domicilio', filtroDomiciliario],
    queryFn:  () => getEntregas({ domiciliario_id: filtroDomiciliario || undefined }).then((r) => r.data.data),
  });

  const domiciliarios = domiciliariosData || [];
  const entregas      = entregasData      || [];
  const pendientes    = entregas.filter((e) => e.estado === 'Pendiente');
  const historial     = entregas.filter((e) => e.estado !== 'Pendiente');

  if (entregaSeleccionada) {
    return <PanelDetalleEntrega entregaId={entregaSeleccionada} onVolver={() => setEntregaSeleccionada(null)} />;
  }

  return (
    <div className="flex flex-col gap-4">
      {domiciliarios.length > 0 && (
        <select value={filtroDomiciliario} onChange={(e) => setFiltroDomiciliario(e.target.value)}
          className="w-full py-2 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm
            focus:outline-none focus:ring-2 focus:ring-orange-400 focus:bg-white transition-all text-gray-700">
          <option value="">Todos los domiciliarios</option>
          {domiciliarios.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
        </select>
      )}
      {isLoading ? <Spinner className="py-8" /> : entregas.length === 0 ? (
        <EmptyState icon={Bike} titulo="Sin pedidos domiciliarios" descripcion="Los pedidos aparecen al crear facturas con domicilio" />
      ) : (
        <div className="flex flex-col gap-3">
          {pendientes.length === 0 ? (
            <p className="text-xs text-gray-400 px-1">Sin pedidos pendientes</p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-1">Pendientes ({pendientes.length})</p>
              {pendientes.map((entrega) => <TarjetaEntregaPendiente key={entrega.id} entrega={entrega} onSeleccionar={setEntregaSeleccionada} />)}
            </div>
          )}
          <DesplegableHistorial entregas={historial} onSeleccionar={setEntregaSeleccionada} />
        </div>
      )}
    </div>
  );
}

// ─── Tab: Búsqueda de préstamos ──────────────────────────────────────────────

const ESTADOS_FILTRO = [
  { v: '',         label: 'Todos'    },
  { v: 'Activo',   label: 'Activo'   },
  { v: 'Saldado',  label: 'Saldado'  },
  { v: 'Devuelto', label: 'Devuelto' },
];

const TIPOS_FILTRO = [
  { v: '',          label: 'Todos',      Icn: Users },
  { v: 'companero', label: 'Compañeros', Icn: User  },
  { v: 'cliente',   label: 'Clientes',   Icn: Users },
];

function TipoPrestamoBadge({ prestatarioId }) {
  if (prestatarioId) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5
        rounded-full border bg-blue-50 text-blue-700 border-blue-200">
        <User size={9} /> Compañero
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5
      rounded-full border bg-violet-50 text-violet-700 border-violet-200">
      <Users size={9} /> Cliente
    </span>
  );
}

/**
 * Situación de un préstamo en los resultados de búsqueda: vencido, por vencer,
 * y lo que tiene de mora e interés. Todo llega calculado del backend
 * (`situacion`, `dias_vencidos`, `mora_pendiente`, `interes_pendiente`); aquí
 * solo se pinta. Reemplaza al aviso anterior, que leía `prestamo.mora` de una
 * consulta que no la traía y por eso nunca aparecía.
 */
function BadgeSituacion({ prestamo }) {
  const chips = [];
  if (prestamo.situacion === 'vencido') {
    const d = Number(prestamo.dias_vencidos || 0);
    chips.push(
      <span key="v" className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-600 text-white">
        <AlertTriangle size={10} /> Vencido{d > 0 ? ` hace ${d} día${d === 1 ? '' : 's'}` : ''}
      </span>,
    );
  } else if (prestamo.situacion === 'por_vencer') {
    const d = Number(prestamo.dias_para_vencer || 0);
    chips.push(
      <span key="p" className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
        <Clock size={10} /> {d === 0 ? 'Vence hoy' : `Vence en ${d} día${d === 1 ? '' : 's'}`}
      </span>,
    );
  }
  if (Number(prestamo.mora_pendiente) > 0) {
    chips.push(
      <span key="m" className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">
        Mora {formatCOP(prestamo.mora_pendiente)}
      </span>,
    );
  }
  if (Number(prestamo.interes_pendiente) > 0) {
    chips.push(
      <span key="i" className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200">
        Interés {formatCOP(prestamo.interes_pendiente)}
      </span>,
    );
  }
  return chips.length ? <>{chips}</> : null;
}

function TarjetaResultadoPrestamo({ prestamo, onAbonar, onDevolver, onEditar }) {
  const saldo    = Number(prestamo.saldo_pendiente);
  const progreso = Number(prestamo.valor_prestamo) > 0
    ? Math.min(100, (Number(prestamo.total_abonado) / Number(prestamo.valor_prestamo)) * 100)
    : 0;
  const esSaldado = prestamo.estado === 'Saldado';
  const nombre    = prestamo.prestatario_nombre || prestamo.cliente_nombre || prestamo.prestatario;

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <TipoPrestamoBadge prestatarioId={prestamo.prestatario_id} />
            <Badge variant={prestamo.estado === 'Activo' ? 'blue' : esSaldado ? 'green' : 'gray'}>
              {prestamo.estado}
            </Badge>
            {/* En los resultados de búsqueda no cabe el panel de mora, pero sí
                el aviso: es donde el vendedor busca a un cliente que llega a pagar. */}
            <BadgeSituacion prestamo={prestamo} />
          </div>
          <p className="text-sm font-semibold text-gray-900 truncate">{nombre}</p>
          {prestamo.empleado_nombre && (
            <p className="text-xs text-blue-500 mt-0.5">→ {prestamo.empleado_nombre}</p>
          )}
          <p className="text-sm text-gray-700 truncate mt-0.5">{prestamo.nombre_producto}</p>
          {prestamo.imei && (
            <p className="text-xs text-gray-400 font-mono mt-0.5">{prestamo.imei}</p>
          )}
          {!prestamo.imei && Number(prestamo.cantidad_prestada) > 1 && (
            <p className="text-xs text-gray-400 mt-0.5">Cantidad: {prestamo.cantidad_prestada}</p>
          )}
          {(prestamo.atributo_label || prestamo.variante_label) && (
            <div className="flex flex-wrap gap-1 mt-0.5">
              {prestamo.atributo_label && (
                <span className="text-xs bg-blue-50 text-blue-600 border border-blue-100 px-2 py-0.5 rounded-full">
                  {prestamo.atributo_label}
                </span>
              )}
              {prestamo.variante_label && (
                <span className="text-xs bg-purple-50 text-purple-600 border border-purple-100 px-2 py-0.5 rounded-full">
                  {prestamo.variante_label}
                </span>
              )}
            </div>
          )}
          <p className="text-xs text-gray-400 mt-0.5">
            {formatFechaHora(prestamo.fecha)} · {prestamo.sucursal_nombre}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-bold text-gray-900">{formatCOP(Number(prestamo.valor_prestamo))}</p>
          {prestamo.estado === 'Activo' && saldo > 0 && (
            <p className="text-xs text-red-500 mt-0.5">Saldo: {formatCOP(saldo)}</p>
          )}
          {esSaldado && <p className="text-xs text-green-600 mt-0.5">✓ Saldado</p>}
        </div>
      </div>

      <div className="w-full bg-gray-100 rounded-full h-1">
        <div
          className={`h-1 rounded-full transition-all ${esSaldado ? 'bg-green-400' : 'bg-blue-500'}`}
          style={{ width: `${progreso}%` }}
        />
      </div>

      {prestamo.estado === 'Activo' && (
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" className="flex-1" onClick={() => onAbonar(prestamo)}>
            <Plus size={14} /> Abonar
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onDevolver(prestamo)}>
            <CheckCircle size={14} /> Devuelto
          </Button>
          {onEditar && (
            <button
              onClick={() => onEditar(prestamo)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
                border border-gray-200 text-gray-500 bg-white hover:bg-gray-50 transition-colors">
              <Pencil size={12} /> Editar valor
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Búsqueda: situación, cargos y agrupación por persona ─────────────────────
//
// Atajos de SITUACIÓN y de CARGO que filtran en el backend (así «Vencidos» a
// secas, sin escribir nada, trae todos los vencidos del negocio), tarjetas de
// resumen que también filtran al tocarlas, y los resultados AGRUPADOS POR
// PERSONA: quien busca en Préstamos casi siempre está buscando a alguien, y un
// cliente con seis préstamos eran seis tarjetas sueltas.
// La regla de «vencido» y «por vencer» es la del aviso de cobros; la mora y el
// interés los calcula el backend con el mismo motor de la ficha.

const SITUACIONES_FILTRO = [
  { v: '',           label: 'Todas'      },
  { v: 'vencido',    label: 'Vencidos'   },
  { v: 'por_vencer', label: 'Por vencer' },
  { v: 'al_dia',     label: 'Al día'     },
  { v: 'sin_plazo',  label: 'Sin plazo'  },
];

const CARGOS_FILTRO = [
  { v: '',        label: 'Todos'       },
  { v: 'mora',    label: 'Con mora'    },
  { v: 'interes', label: 'Con interés' },
];

const TONO_CHIP = {
  vencido:    'bg-red-600 border-red-600 text-white',
  por_vencer: 'bg-amber-500 border-amber-500 text-white',
  mora:       'bg-red-50 border-red-300 text-red-700',
  interes:    'bg-teal-50 border-teal-300 text-teal-700',
};

function ChipFiltro({ activo, tono, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all
        ${activo
          ? (tono || 'bg-blue-50 border-blue-300 text-blue-700')
          : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-gray-300'}`}>
      {children}
    </button>
  );
}

/** Tarjeta del resumen: dice cuántos hay y, al tocarla, filtra a esos. */
function TarjetaResumenBusqueda({ titulo, valor, detalle, tono, activa, onClick }) {
  const tonos = {
    rojo:  'bg-red-50 border-red-200 text-red-700',
    ambar: 'bg-amber-50 border-amber-200 text-amber-700',
    teal:  'bg-teal-50 border-teal-200 text-teal-700',
    gris:  'bg-gray-50 border-gray-200 text-gray-600',
  };
  return (
    <button type="button" onClick={onClick}
      className={`flex-1 min-w-[8rem] text-left rounded-xl border px-3 py-2 transition-all
        ${tonos[tono]} ${activa ? 'ring-2 ring-offset-1 ring-blue-400' : 'hover:shadow-sm'}`}>
      <p className="text-[11px] opacity-80 truncate">{titulo}</p>
      <p className="text-base font-bold tabular-nums truncate">{valor}</p>
      {detalle && <p className="text-[11px] opacity-70 truncate">{detalle}</p>}
    </button>
  );
}

const _plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

/** Una persona con todos sus préstamos encontrados. */
function TarjetaGrupoPersona({ grupo, abierto, onAlternar, onAbrirPersona, renderPrestamo }) {
  const tieneFicha = grupo.tipo !== 'libre' && !!onAbrirPersona;
  const dMin = grupo.dias_para_vencer_min;
  return (
    <div className={`bg-white border rounded-2xl overflow-hidden
      ${grupo.n_vencidos > 0 ? 'border-red-200' : 'border-gray-100'}`}>
      <button type="button" onClick={onAlternar} aria-expanded={abierto}
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-gray-50/60 transition-colors">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-sm font-bold
          ${grupo.tipo === 'companero' ? 'bg-blue-100 text-blue-700'
            : grupo.tipo === 'cliente' ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-500'}`}>
          {iniciales(grupo.nombre)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-gray-900 truncate">{grupo.nombre}</p>
            {grupo.total_a_pagar > 0 && (
              <span className="text-sm font-bold text-red-500 flex-shrink-0 tabular-nums">
                {formatCOP(grupo.total_a_pagar)}
              </span>
            )}
          </div>
          {grupo.cedula && grupo.cedula !== 'COMPANERO' && (
            <p className="text-xs text-gray-400">CC: {grupo.cedula}</p>
          )}
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {grupo.tipo !== 'libre' && (
              <TipoPrestamoBadge prestatarioId={grupo.tipo === 'companero' ? 1 : null} />
            )}
            <span className="text-xs bg-gray-50 text-gray-500 px-2 py-0.5 rounded-full">
              {_plural(grupo.prestamos.length, 'préstamo', 'préstamos')}
              {grupo.n_activos > 0 && grupo.n_cerrados > 0
                ? ` · ${_plural(grupo.n_activos, 'activo', 'activos')}` : ''}
            </span>
            <BadgeVencidosPersona cuantos={grupo.n_vencidos} diasMax={grupo.dias_vencido_max} />
            {grupo.n_por_vencer > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                <Clock size={10} />
                {grupo.n_por_vencer} por vencer
                {dMin != null && (dMin === 0 ? ' · hoy' : ` · en ${_plural(dMin, 'día', 'días')}`)}
              </span>
            )}
            {grupo.mora > 0 && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">
                Mora {formatCOP(grupo.mora)}
              </span>
            )}
            {grupo.interes > 0 && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200">
                Interés {formatCOP(grupo.interes)}
              </span>
            )}
          </div>
        </div>
        {abierto
          ? <ChevronUp size={16} className="text-gray-400 flex-shrink-0 mt-1" />
          : <ChevronDown size={16} className="text-gray-400 flex-shrink-0 mt-1" />}
      </button>

      {abierto && (
        <div className="border-t border-gray-100 bg-gray-50/50 p-3 flex flex-col gap-2.5">
          {tieneFicha && (
            <button type="button" onClick={() => onAbrirPersona(grupo.clave)}
              className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors">
              <ChevronRight size={12} /> Abrir su cuenta completa
            </button>
          )}
          {grupo.prestamos.map(renderPrestamo)}
        </div>
      )}
    </div>
  );
}

function TabBusquedaPrestamos({ onAbrirPersona }) {
  const [q,              setQ]              = useState('');
  const [estado,         setEstado]         = useState('');
  const [tipo,           setTipo]           = useState('');
  const [situacion,      setSituacion]      = useState('');
  const [cargo,          setCargo]          = useState('');
  const [fechaDesde,     setFechaDesde]     = useState('');
  const [fechaHasta,     setFechaHasta]     = useState('');
  const [masFiltros,    setMasFiltros]     = useState(false);
  const [vista,          setVista]          = useState('personas'); // 'personas' | 'prestamos'
  const [orden,          setOrden]          = useState('urgencia');
  // Grupos abiertos. Con UNA sola persona se abre sola (ver `abiertoDe`).
  const [abiertos,       setAbiertos]       = useState(() => new Set());

  const [prestamoAbono,   setPrestamoAbono]   = useState(null);
  const [prestamoDevol,   setPrestamoDevol]   = useState(null);
  const [prestamoEditar,  setPrestamoEditar]  = useState(null);

  const hasFilter = q.trim().length >= 2 || estado || tipo || situacion || cargo || fechaDesde || fechaHasta;

  const { data: searchData, isLoading } = useQuery({
    queryKey: ['busqueda-prestamos', q, estado, tipo, situacion, cargo, fechaDesde, fechaHasta],
    queryFn:  () => buscarPrestamosApi({
      q: q.trim(), estado, tipo, fechaDesde, fechaHasta,
      ...(situacion && { situacion }),
      ...(cargo && { cargo }),
    }).then((r) => r.data.data),
    enabled: !!hasFilter,
    staleTime: 30 * 1000,
  });

  const resultados    = searchData?.prestamos    ?? [];
  const abonosTotales = searchData?.abonosTotales ?? [];
  const diasAviso     = searchData?.dias_aviso;

  const resumen = resumenBusqueda(resultados);
  const grupos  = ordenarGrupos(agruparPorPersona(resultados), orden);
  const sueltos = ordenarPrestamos(resultados, orden);

  const abiertoDe = (clave) => abiertos.has(clave) || grupos.length === 1;
  const alternar  = (clave) => setAbiertos((prev) => {
    const sig = new Set(prev);
    if (sig.has(clave)) sig.delete(clave); else sig.add(clave);
    return sig;
  });

  // Tocar una tarjeta del resumen filtra a eso; tocarla otra vez lo quita.
  const alternarSituacion = (v) => setSituacion((s) => (s === v ? '' : v));
  const alternarCargo     = (v) => setCargo((c) => (c === v ? '' : v));

  const limpiar = () => {
    setQ(''); setEstado(''); setTipo(''); setSituacion(''); setCargo('');
    setFechaDesde(''); setFechaHasta('');
  };

  const filtrosOcultosActivos = [estado, tipo, fechaDesde, fechaHasta].filter(Boolean).length;

  const renderPrestamo = (p) => (
    <TarjetaResultadoPrestamo
      key={p.id}
      prestamo={p}
      onAbonar={setPrestamoAbono}
      onDevolver={setPrestamoDevol}
      onEditar={setPrestamoEditar}
    />
  );

  return (
    <div className="flex flex-col gap-4">

      {/* Buscador de texto */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre, cédula, teléfono, IMEI, producto o línea…"
          className="w-full pl-9 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl
            text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
        />
      </div>

      {/* Atajos: situación y cargos. Funcionan solos, sin escribir nada. */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium text-gray-400 w-16">Situación</span>
          {SITUACIONES_FILTRO.map((opt) => (
            <ChipFiltro key={opt.v || 'todas'} activo={situacion === opt.v}
              tono={TONO_CHIP[opt.v]} onClick={() => setSituacion(opt.v)}>
              {opt.label}
            </ChipFiltro>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium text-gray-400 w-16">Cargos</span>
          {CARGOS_FILTRO.map((opt) => (
            <ChipFiltro key={opt.v || 'todos'} activo={cargo === opt.v}
              tono={TONO_CHIP[opt.v]} onClick={() => setCargo(opt.v)}>
              {opt.label}
            </ChipFiltro>
          ))}
        </div>
        {situacion === 'por_vencer' && diasAviso != null && (
          <p className="text-[11px] text-gray-400">
            «Por vencer» = vence en {_plural(diasAviso, 'día', 'días')} o menos (se cambia en Ajustes → Mora).
          </p>
        )}
      </div>

      {/* Más filtros: estado, tipo y fechas */}
      <button type="button" onClick={() => setMasFiltros((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 w-fit">
        <SlidersHorizontal size={13} />
        {masFiltros ? 'Menos filtros' : 'Más filtros'}
        {!masFiltros && filtrosOcultosActivos > 0 && (
          <span className="px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-semibold">
            {filtrosOcultosActivos}
          </span>
        )}
      </button>

      {masFiltros && (
        <div className="flex flex-col gap-3 p-3 bg-gray-50 border border-gray-100 rounded-xl">
          <div className="flex flex-wrap gap-2">
            {ESTADOS_FILTRO.map((opt) => (
              <ChipFiltro key={opt.v || 'todos'} activo={estado === opt.v} onClick={() => setEstado(opt.v)}>
                {opt.label}
              </ChipFiltro>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {TIPOS_FILTRO.map((opt) => {
              const OptIcon = opt.Icn;
              return (
                <ChipFiltro key={opt.v || 'todos'} activo={tipo === opt.v} onClick={() => setTipo(opt.v)}>
                  <span className="flex items-center gap-1.5"><OptIcon size={11} />{opt.label}</span>
                </ChipFiltro>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Prestado desde</label>
              <input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)}
                className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-700
                  focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Hasta</label>
              <input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)}
                className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-700
                  focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" />
            </div>
          </div>
        </div>
      )}

      {/* Limpiar */}
      {hasFilter && (
        <button type="button" onClick={limpiar}
          className="text-xs text-gray-400 hover:text-gray-600 w-fit transition-colors">
          Limpiar filtros
        </button>
      )}

      {/* Estado vacío inicial */}
      {!hasFilter && (
        <p className="text-sm text-gray-400 text-center py-10">
          Escribe un nombre o toca un atajo —por ejemplo <strong>Vencidos</strong>— para ver a quién hay que cobrarle
        </p>
      )}

      {hasFilter && isLoading && <Spinner className="py-10" />}

      {hasFilter && !isLoading && resultados.length === 0 && (
        <EmptyState icon={Search} titulo="Sin resultados"
          descripcion="No se encontraron préstamos con esos filtros" />
      )}

      {resultados.length > 0 && (
        <div className="flex flex-col gap-3">

          {/* Resumen de lo encontrado: cada tarjeta filtra a lo suyo */}
          <div className="flex gap-2 flex-wrap">
            {(resumen.vencido.n > 0 || situacion === 'vencido') && (
              <TarjetaResumenBusqueda tono="rojo" titulo="Vencidos"
                valor={_plural(resumen.vencido.personas, 'persona', 'personas')}
                detalle={_plural(resumen.vencido.n, 'préstamo', 'préstamos')}
                activa={situacion === 'vencido'} onClick={() => alternarSituacion('vencido')} />
            )}
            {(resumen.por_vencer.n > 0 || situacion === 'por_vencer') && (
              <TarjetaResumenBusqueda tono="ambar" titulo="Por vencer"
                valor={_plural(resumen.por_vencer.personas, 'persona', 'personas')}
                detalle={_plural(resumen.por_vencer.n, 'préstamo', 'préstamos')}
                activa={situacion === 'por_vencer'} onClick={() => alternarSituacion('por_vencer')} />
            )}
            {(resumen.con_mora.n > 0 || cargo === 'mora') && (
              <TarjetaResumenBusqueda tono="rojo" titulo="Mora pendiente"
                valor={formatCOP(resumen.con_mora.valor)}
                detalle={_plural(resumen.con_mora.n, 'préstamo', 'préstamos')}
                activa={cargo === 'mora'} onClick={() => alternarCargo('mora')} />
            )}
            {(resumen.con_interes.n > 0 || cargo === 'interes') && (
              <TarjetaResumenBusqueda tono="teal" titulo="Interés pendiente"
                valor={formatCOP(resumen.con_interes.valor)}
                detalle={_plural(resumen.con_interes.n, 'préstamo', 'préstamos')}
                activa={cargo === 'interes'} onClick={() => alternarCargo('interes')} />
            )}
            <TarjetaResumenBusqueda tono="gris" titulo="Saldo activo"
              valor={formatCOP(resumen.saldo)}
              detalle={`${_plural(resumen.personas, 'persona', 'personas')} · ${_plural(resumen.total, 'préstamo', 'préstamos')}`}
              activa={false} onClick={() => { setSituacion(''); setCargo(''); }} />
          </div>

          {/* Vista, orden y exportar */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
              {[
                { id: 'personas',  label: 'Por persona',  Icn: Users  },
                { id: 'prestamos', label: 'Por préstamo', Icn: Layers },
              ].map((v) => {
                const VIcn = v.Icn;
                return (
                  <button key={v.id} type="button" onClick={() => setVista(v.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                      ${vista === v.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                    <VIcn size={12} /> {v.label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <select value={orden} onChange={(e) => setOrden(e.target.value)}
                className="px-3 py-1.5 bg-white border border-gray-200 rounded-xl text-xs text-gray-700
                  focus:outline-none focus:ring-2 focus:ring-blue-400">
                {ORDENES_BUSQUEDA.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
              <Button size="sm" variant="secondary"
                onClick={() => exportarPrestamosExcel({
                  prestamos: resultados, abonosTotales,
                  titulo:  'PRÉSTAMOS FILTRADOS',
                  archivo: 'prestamos-filtrados',
                })}>
                <FileDown size={14} /> Excel
              </Button>
            </div>
          </div>

          {vista === 'personas'
            ? grupos.map((g) => (
                <TarjetaGrupoPersona
                  key={g.clave}
                  grupo={g}
                  abierto={abiertoDe(g.clave)}
                  onAlternar={() => alternar(g.clave)}
                  onAbrirPersona={onAbrirPersona}
                  renderPrestamo={renderPrestamo}
                />
              ))
            : sueltos.map(renderPrestamo)}
        </div>
      )}

      {prestamoAbono && (
        <ModalAbonoPrestamo
          prestamo={prestamoAbono}
          onClose={() => setPrestamoAbono(null)}
          onSaldado={() => setPrestamoAbono(null)}
        />
      )}
      {prestamoDevol && (
        <ModalDevolucion prestamo={prestamoDevol} onClose={() => setPrestamoDevol(null)} />
      )}
      {prestamoEditar && (
        <ModalEditarValorPrestamo
          key={prestamoEditar.id}
          open
          onClose={() => setPrestamoEditar(null)}
          mov={{
            referencia_id: prestamoEditar.id,
            concepto:      `Préstamo — ${prestamoEditar.nombre_producto}`,
            cargo:         Number(prestamoEditar.valor_prestamo),
          }}
          tipoApi={prestamoEditar.prestatario_id ? 'prestatario' : 'cliente'}
          personaId={prestamoEditar.prestatario_id ?? prestamoEditar.cliente_id}
        />
      )}
    </div>
  );
}

/**
 * Adaptador de despliegue.
 *
 * Vercel y Railway se despliegan por SEPARADO, así que existe una ventana —y un
 * rollback del backend la reabre— en la que este frontend habla con un backend
 * que todavía no conoce `?vista=personas`. Ese backend ignora el parámetro y
 * responde el historial completo (un ARRAY). Sin esto la pantalla de Préstamos
 * mostraría CERO personas hasta que Railway terminara, que es justo el susto que
 * no puede dar una pantalla de dinero.
 *
 * Se detecta por la FORMA de la respuesta, no por una versión: un array es el
 * backend viejo y se agrupa aquí, que es exactamente lo que esta pantalla hacía
 * antes. Con el backend nuevo no se ejecuta nada de esto.
 */
function adaptarResumenPersonas(data) {
  if (data && !Array.isArray(data)) return data;

  // Vencidos con la misma regla del SQL: activo y fecha límite antes de HOY EN
  // BOGOTÁ. La fecha límite es DATE y llega como 'YYYY-MM-DD'.
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const diasDesde = (fecha) => {
    const [ay, am, ad] = hoy.split('-').map(Number);
    const [by, bm, bd] = fecha.split('-').map(Number);
    return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
  };

  const acumular =(filas, campoId, campoNombre, campoSaldo, campoAbono, campoCelular) => {
    const mapa = new Map();
    for (const p of filas) {
      const id = p[campoId];
      if (!id) continue;
      if (!mapa.has(id)) mapa.set(id, {
        persona_id:      id,
        nombre:          p[campoNombre] || p.prestatario,
        celular:         campoCelular ? (p[campoCelular] || '') : undefined,
        saldo_a_favor:   Number(p[campoSaldo] ?? 0),
        ultimo_abono:    p[campoAbono] ?? null,
        n_activos:       0,
        n_cerrados:      0,
        valor_activos:   0,
        abonado_activos: 0,
        saldo_total:     0,
        n_vencidos:       0,
        dias_vencido_max: 0,
      });
      const g = mapa.get(id);
      if (p.estado === 'Activo') {
        g.n_activos       += 1;
        g.valor_activos   += Number(p.valor_prestamo);
        g.abonado_activos += Number(p.total_abonado);
        g.saldo_total     += Number(p.valor_prestamo) - Number(p.total_abonado);
        // Por HTTP llega como texto; un Date (sin serializar) daría «Wed Apr 01»
        // con String() y nunca compararía como fecha.
        const limite = !p.fecha_limite ? null
          : p.fecha_limite instanceof Date ? p.fecha_limite.toISOString().slice(0, 10)
          : String(p.fecha_limite).slice(0, 10);
        if (limite && limite < hoy) {
          g.n_vencidos      += 1;
          g.dias_vencido_max = Math.max(g.dias_vencido_max, diasDesde(limite));
        }
      } else {
        g.n_cerrados += 1;
      }
    }
    return [...mapa.values()];
  };

  const filas = data ?? [];
  return {
    prestatarios: acumular(filas, 'prestatario_id', 'prestatario_nombre',
      'prestatario_saldo_a_favor', 'ultimo_abono_prestatario', null),
    clientes: acumular(filas, 'cliente_id', 'cliente_nombre',
      'cliente_saldo_a_favor', 'ultimo_abono_cliente', 'cliente_celular'),
  };
}

// ─── Página principal ─────────────────────────────────────────────────────────

/**
 * Exporta la cartera completa: el historial de préstamos y los créditos, los dos
 * pedidos recién al hacer clic. Los créditos se piden con `fetchQuery` y la
 * MISMA clave que TabCreditos, para reusar su caché en vez de montar una segunda
 * consulta permanente en la página.
 *
 * El historial va con la API pelada y NO por el caché: es la única parte de la
 * pantalla que de verdad necesita las 9.976 filas, son 13,6 MB, y dejarlas
 * guardadas para un botón que se usa una vez al mes es justo lo que hacía lenta
 * a esta pantalla. Se piden, se escribe el Excel y se sueltan.
 */
function BotonExportarCartera({ hayPersonas, prestatarios }) {
  const queryClient = useQueryClient();
  const [cargando, setCargando] = useState(false);

  const handleClick = async () => {
    if (cargando) return;
    setCargando(true);
    try {
      const prestamos = await getPrestamos().then((r) => r.data.data);
      let creditos = [];
      try {
        creditos = await queryClient.fetchQuery({
          queryKey: ['creditos'],
          queryFn:  () => getCreditos().then((r) => r.data.data),
        });
      } catch {
        // Si los créditos no llegan, se exporta igual lo que sí hay: el usuario
        // pidió su Excel, no una consulta.
      }
      exportarPrestamosExcel({ prestamos, prestatarios, creditos: creditos || [] });
    } catch {
      alert('No se pudo descargar la cartera para exportar. Intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  };

  return (
    <Button size="sm" variant="secondary" className="flex-shrink-0"
      disabled={cargando || !hayPersonas} onClick={handleClick}>
      {cargando ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
      Exportar Excel
    </Button>
  );
}

export default function PrestamosPage() {
  const { coloresActivo }  = useColoresConfig();
  const sucursalActiva     = useSucursalStore((s) => s.sucursalActiva);

  // ── Entrada desde una notificación ────────────────────────────────────────
  //
  // Los avisos de cobro traen a quién hay que cobrarle:
  //   /prestamos?tab=prestamos&persona=prestatario_12
  //   /prestamos?tab=creditos&persona=1032456789
  //
  // Se lee SOLO en el primer render (inicializador perezoso de useState). Si se
  // leyera en cada render, cerrar la ficha volvería a abrirla sola y el usuario
  // quedaría atrapado en esa pantalla.
  //
  // Y el aviso «N cobros vencidos» trae a DÓNDE están y que se filtre a ellos:
  //   /prestamos?tab=prestamos&sub=clientes&filtro=vencidos
  //   /prestamos?tab=creditos&filtro=vencidos
  const [params] = useSearchParams();
  const paramTab     = params.get('tab');
  const paramPersona = params.get('persona');
  const paramSub     = params.get('sub');
  const paramFiltro  = params.get('filtro') === 'vencidos' ? 'vencidos' : null;

  const [tabPrincipal,         setTabPrincipal]         = useState(
    () => (paramTab === 'creditos' ? 'creditos' : 'prestamos'));
  const [tabPrestamos,         setTabPrestamos]         = useState(
    // La ficha se abre igual con cualquiera de los dos sub-tabs (el detalle
    // busca en los dos grupos), pero arrancar en el correcto evita que al
    // volver atrás la lista se vea vacía.
    () => (String(paramPersona || '').startsWith('cliente_') || paramSub === 'clientes'
      ? 'clientes' : 'companeros'));
  const [personaSeleccionadaKey, setPersonaSeleccionadaKey] = useState(
    () => (paramTab === 'creditos' ? null : (paramPersona || null)));

  // Cliente que debe quedar abierto en la pestaña de créditos, si el aviso venía
  // de una factura a crédito.
  const personaCreditoInicial = paramTab === 'creditos' ? paramPersona : null;
  const filtroCreditoInicial  = paramTab === 'creditos' ? paramFiltro  : null;
  const [prestamoAbono,        setPrestamoAbono]        = useState(null);
  const [prestamoDevol,        setPrestamoDevol]        = useState(null);
  const [busquedaPersonas,     setBusquedaPersonas]     = useState('');
  const [sortPersonas,         setSortPersonas]         = useState('deuda_desc');
  const [filtroEstadoP,        setFiltroEstadoP]        = useState(
    () => (paramTab !== 'creditos' && paramFiltro ? paramFiltro : 'todos'));
  const [paginaPersonas,       setPaginaPersonas]       = useState(1);

  const [prestamoImprimir,    setPrestamoImprimir]    = useState(null);
  const [prestamoIntercambio, setPrestamoIntercambio] = useState(null);
  const [modalSaldoPersona,   setModalSaldoPersona]   = useState(null); // { nombre, tipo, personaId, saldoAFavor }
  const [modalHistorialSaldo, setModalHistorialSaldo] = useState(null); // { nombre, tipo, personaId }
  const [modalRetomaDirecta,  setModalRetomaDirecta]  = useState(null); // { persona: { tipo, id, nombre } }
  const [modalAjusteCuentas,  setModalAjusteCuentas]  = useState(null); // { nombre, tipo, personaId, sucursalId }
  const [modalCrearPrestatario,   setModalCrearPrestatario]   = useState(false);
  const [modalEditarPrestatario,  setModalEditarPrestatario]  = useState(null);
  const [modalEditarCliente,      setModalEditarCliente]      = useState(null);
  // Los abonos del comprobante ya no se piden aquí: ModalImprimirPrestamo carga
  // el `resumen` completo del backend (con el saldo corrido de cada abono).

  const [saldadoFacturaId,   setSaldadoFacturaId]   = useState(null);
  const [saldadoPrestamo,    setSaldadoPrestamo]     = useState(null);
  const [modalImprimir,      setModalImprimir]       = useState(null);
  const [facturaTermicaData, setFacturaTermicaData]  = useState(null);

  const { data: configDataSaldado } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
    enabled:  !!saldadoFacturaId,
  });

  const { data: facturaDataSaldada } = useQuery({
    queryKey: ['factura-detalle', saldadoFacturaId],
    queryFn:  () => getFacturaById(saldadoFacturaId).then((r) => r.data.data),
    enabled:  !!saldadoFacturaId,
    staleTime: 0,
  });

  const { data: garantiasSaldadas = [] } = useQuery({
    queryKey: ['garantias-factura', saldadoFacturaId],
    queryFn:  () => getGarantiasPorFactura(saldadoFacturaId).then((r) => r.data.data),
    enabled:  !!saldadoFacturaId,
    staleTime: 0,
  });

  const facturaConConfigSaldada = facturaDataSaldada && configDataSaldado
    ? { ...facturaDataSaldada, config: configDataSaldado }
    : null;

  // La lista de personas se pide YA AGREGADA. Antes esta misma pantalla bajaba
  // el historial completo del negocio —13,6 MB y 9.976 filas en Cellsite— para
  // agrupar en memoria y pintar diez tarjetas, y lo volvía a bajar entero
  // después de CADA abono, porque toda mutación invalida ['prestamos'].
  // El resumen son 144 KB y las cuentas son exactamente las mismas.
  const { data: resumen, isLoading: loadingP } = useQuery({
    queryKey: ['prestamos', 'resumen-personas', sucursalActiva],
    queryFn:  () => getResumenPersonas().then((r) => adaptarResumenPersonas(r.data.data)),
  });

  const { data: prestatariosData = [] } = useQuery({
    queryKey: ['prestatarios'],
    queryFn:  () => getPrestatarios().then((r) => r.data.data),
  });

  // La clave es la misma de siempre ("prestatario_12" / "cliente_1032"), así que
  // el enlace de las notificaciones de cobro sigue abriendo la ficha igual.
  const personaAbierta = personaSeleccionadaKey
    ? {
        tipo: personaSeleccionadaKey.startsWith('cliente_') ? 'cliente' : 'prestatario',
        id:   Number(personaSeleccionadaKey.split('_')[1]),
      }
    : null;

  // Los préstamos de la persona ABIERTA, que es lo único que se pinta. Son las
  // mismas filas que antes se recortaban del historial completo en el navegador.
  const { data: prestamosPersona, isLoading: loadingPersona } = useQuery({
    queryKey: ['prestamos', 'persona', personaAbierta?.tipo, personaAbierta?.id, sucursalActiva],
    queryFn:  () => getPrestamosDePersona(personaAbierta.tipo, personaAbierta.id).then((r) => {
      const { tipo, id } = personaAbierta;
      // Defensa en profundidad, por la misma ventana de despliegue: un backend
      // que ignorara el filtro respondería el historial ENTERO, y la ficha de
      // una persona acabaría mostrando los préstamos de todas. Contra el backend
      // nuevo este filtro no quita ni una fila.
      return (r.data.data ?? []).filter(
        (p) => (tipo === 'cliente' ? p.cliente_id : p.prestatario_id) === id);
    }),
    enabled:  !!personaAbierta?.id,
  });

  // Las claves de los dos queries empiezan por 'prestamos', así que los
  // invalidateQueries({ queryKey: ['prestamos'], exact: false } ) que ya
  // existían por toda la pantalla los siguen refrescando a los dos. Ninguna
  // mutación cambia.
  const gruposCompaneros = {};
  for (const r of resumen?.prestatarios ?? []) {
    gruposCompaneros[`prestatario_${r.persona_id}`] = {
      nombre:         r.nombre,
      personaId:      r.persona_id,
      saldoTotal:     Number(r.saldo_total),
      saldoAFavor:    Number(r.saldo_a_favor ?? 0),
      ultimoAbono:    r.ultimo_abono ?? null,
      nActivos:       Number(r.n_activos),
      nCerrados:      Number(r.n_cerrados),
      valorActivos:   Number(r.valor_activos),
      abonadoActivos: Number(r.abonado_activos),
      nVencidos:      Number(r.n_vencidos ?? 0),
      diasVencidoMax: Number(r.dias_vencido_max ?? 0),
    };
  }

  // Incluir prestamistas sin préstamos (recién creados) y enriquecer con telefono
  prestatariosData.forEach((pr) => {
    const key = `prestatario_${pr.id}`;
    if (!gruposCompaneros[key]) {
      gruposCompaneros[key] = {
        nombre:         pr.nombre,
        personaId:      pr.id,
        saldoTotal:     0,
        saldoAFavor:    Number(pr.saldo_a_favor ?? 0),
        ultimoAbono:    null,
        nActivos:       0,
        nCerrados:      0,
        valorActivos:   0,
        abonadoActivos: 0,
      };
    }
    gruposCompaneros[key].telefono = pr.telefono || '';
  });

  const gruposClientes = {};
  for (const r of resumen?.clientes ?? []) {
    gruposClientes[`cliente_${r.persona_id}`] = {
      nombre:         r.nombre,
      personaId:      r.persona_id,
      celular:        r.celular || '',
      saldoTotal:     Number(r.saldo_total),
      saldoAFavor:    Number(r.saldo_a_favor ?? 0),
      ultimoAbono:    r.ultimo_abono ?? null,
      nActivos:       Number(r.n_activos),
      nCerrados:      Number(r.n_cerrados),
      valorActivos:   Number(r.valor_activos),
      abonadoActivos: Number(r.abonado_activos),
      nVencidos:      Number(r.n_vencidos ?? 0),
      diasVencidoMax: Number(r.dias_vencido_max ?? 0),
    };
  }

  // La persona seleccionada siempre refleja los datos más recientes del query.
  // `prestamos` se le adjunta desde su propio query: el resto de la ficha (saldo
  // a favor, nombre, sucursal del ajuste) se lee igual que antes.
  const grupoBase = personaSeleccionadaKey
    ? (gruposCompaneros[personaSeleccionadaKey] || gruposClientes[personaSeleccionadaKey])
    : null;
  const grupoActual = grupoBase
    ? { ...grupoBase, prestamos: prestamosPersona ?? [] }
    : null;

  const handleSaldado = (facturaId, prestamo) => {
    setPrestamoAbono(null);
    setSaldadoFacturaId(facturaId);
    setSaldadoPrestamo(prestamo);
  };

  const limpiarSaldado = () => {
    setSaldadoFacturaId(null);
    setSaldadoPrestamo(null);
    setModalImprimir(null);
    setFacturaTermicaData(null);
  };

  const cambiarTabPrestamos = (id) => {
    setTabPrestamos(id);
    setPersonaSeleccionadaKey(null);
    setBusquedaPersonas('');
    // Mirando vencidos se sigue mirando vencidos: el botón de la otra pestaña
    // dice que allá también hay, y se cambia justo para verlos.
    setFiltroEstadoP((f) => (f === 'vencidos' ? 'vencidos' : 'todos'));
    setSortPersonas('deuda_desc');
    setPaginaPersonas(1);
  };

  const PAGE_SIZE_PERSONAS = 10;

  const gruposRaw     = tabPrestamos === 'companeros' ? gruposCompaneros : gruposClientes;
  const gruposEntries = Object.entries(gruposRaw);

  const gruposBuscados = busquedaPersonas.trim()
    ? gruposEntries.filter(([, g]) => g.nombre.toLowerCase().includes(busquedaPersonas.trim().toLowerCase()))
    : gruposEntries;

  // Cuántas personas tienen algo vencido en cada sub-pestaña: va en el botón de
  // la pestaña y en el filtro, para que se vea dónde están sin entrar a buscar.
  const vencidosEn = (grupos) => Object.values(grupos).filter((g) => g.nVencidos > 0).length;
  const nVencidosTab = vencidosEn(gruposRaw);

  const gruposFiltrados = filtroEstadoP === 'vencidos'
    ? gruposBuscados.filter(([, g]) => g.nVencidos > 0)
    : filtroEstadoP === 'activos'
    ? gruposBuscados.filter(([, g]) => g.saldoTotal > 0)
    : filtroEstadoP === 'sin_deuda'
    ? gruposBuscados.filter(([, g]) => g.saldoTotal <= 0)
    : gruposBuscados;

  const gruposOrdenados = [...gruposFiltrados].sort(([, a], [, b]) => {
    // Mirando los vencidos con el orden por defecto, arriba va a quien hay que
    // llamar primero: el más atrasado.
    if (filtroEstadoP === 'vencidos' && sortPersonas === 'deuda_desc') {
      return (b.diasVencidoMax - a.diasVencidoMax) || (b.saldoTotal - a.saldoTotal);
    }
    if (sortPersonas === 'deuda_asc')      return a.saldoTotal - b.saldoTotal;
    if (sortPersonas === 'nombre_asc')     return a.nombre.localeCompare(b.nombre, 'es');
    if (sortPersonas === 'nombre_desc')    return b.nombre.localeCompare(a.nombre, 'es');
    if (sortPersonas === 'abono_reciente') {
      const da = a.ultimoAbono ? new Date(a.ultimoAbono).getTime() : 0;
      const db = b.ultimoAbono ? new Date(b.ultimoAbono).getTime() : 0;
      return db - da;
    }
    return b.saldoTotal - a.saldoTotal;
  });

  const totalPersonasFiltradas = gruposOrdenados.length;
  const totalPaginasPersonas   = Math.max(1, Math.ceil(totalPersonasFiltradas / PAGE_SIZE_PERSONAS));
  const paginaPersonasActual   = Math.min(paginaPersonas, totalPaginasPersonas);
  const gruposPagina = gruposOrdenados.slice(
    (paginaPersonasActual - 1) * PAGE_SIZE_PERSONAS,
    paginaPersonasActual * PAGE_SIZE_PERSONAS,
  );

  return (
    <div className="flex flex-col gap-4">

      {/* ── Cabecera ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900">Préstamos</h1>
          <p className="text-sm text-gray-400 mt-0.5">Gestiona préstamos, créditos y domicilios</p>
        </div>
        <BotonExportarCartera
          hayPersonas={Object.keys(gruposCompaneros).length > 0 || Object.keys(gruposClientes).length > 0}
          prestatarios={prestatariosData} />
      </div>

      {/* ── Tabs principales ── */}
      <div className="overflow-x-auto">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-max">
          {TABS_PRINCIPALES.map((tab) => {
            const TabIcon = tab.Icn;
            return (
              <button key={tab.id} onClick={() => setTabPrincipal(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all flex-shrink-0 whitespace-nowrap
                  ${tabPrincipal === tab.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                <TabIcon size={16} />{tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tab Préstamos ── */}
      {tabPrincipal === 'prestamos' && (
        <div className="flex flex-col gap-4">

          {/* Sub-tabs Compañeros / Clientes */}
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
            {TABS_PRESTAMOS.map((tab) => {
              const count = tab.id === 'companeros'
                ? Object.keys(gruposCompaneros).length
                : Object.keys(gruposClientes).length;
              const vencidosTab = vencidosEn(tab.id === 'companeros' ? gruposCompaneros : gruposClientes);
              const TabIcon = tab.Icn;
              return (
                <button key={tab.id} onClick={() => cambiarTabPrestamos(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
                    ${tabPrestamos === tab.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  <TabIcon size={15} />{tab.label}
                  {count > 0 && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold
                      ${tabPrestamos === tab.id ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 text-gray-500'}`}>
                      {count}
                    </span>
                  )}
                  {vencidosTab > 0 && (
                    <span title={`${vencidosTab} con cobros vencidos`}
                      className="text-xs px-1.5 py-0.5 rounded-full font-semibold bg-red-600 text-white">
                      {vencidosTab} vencido{vencidosTab !== 1 ? 's' : ''}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Los préstamos de la persona abierta llegan en su propia consulta, así
              que la ficha espera a tenerlos. Sin esta espera, VistaDetallePersona
              se pintaría un instante con la lista vacía y diría que la persona no
              tiene préstamos. */}
          {loadingP || (personaAbierta && loadingPersona && !prestamosPersona)
            ? <Spinner className="py-20" /> : (

            /* ── Vista detalle persona ── */
            grupoActual ? (
              <VistaDetallePersona
                nombre={grupoActual.nombre}
                tipo={tabPrestamos === 'companeros' ? 'companero' : 'cliente'}
                personaId={grupoActual.personaId}
                prestamos={grupoActual.prestamos}
                saldoAFavor={grupoActual.saldoAFavor ?? 0}
                onVolver={() => setPersonaSeleccionadaKey(null)}
                onAbonar={setPrestamoAbono}
                onDevolver={setPrestamoDevol}
                onImprimir={setPrestamoImprimir}
                onIntercambiar={setPrestamoIntercambio}
                onRegistrarSaldo={() => setModalSaldoPersona({
                  nombre:     grupoActual.nombre,
                  tipo:       tabPrestamos === 'companeros' ? 'companero' : 'cliente',
                  personaId:  grupoActual.personaId,
                  saldoAFavor: grupoActual.saldoAFavor ?? 0,
                })}
                onRetomaDirecta={() => setModalRetomaDirecta({
                  persona: {
                    tipo:   tabPrestamos === 'companeros' ? 'companero' : 'cliente',
                    id:     grupoActual.personaId,
                    nombre: grupoActual.nombre,
                  },
                })}
                onAjusteCuentas={() => setModalAjusteCuentas({
                  nombre:     grupoActual.nombre,
                  tipo:       tabPrestamos === 'companeros' ? 'companero' : 'cliente',
                  personaId:  grupoActual.personaId,
                  sucursalId: grupoActual.prestamos[0]?.sucursal_id ?? null,
                })}
                onVerHistorialSaldo={() => setModalHistorialSaldo({
                  nombre:    grupoActual.nombre,
                  tipo:      tabPrestamos === 'companeros' ? 'companero' : 'cliente',
                  personaId: grupoActual.personaId,
                })}
                coloresActivo={coloresActivo}
              />
            ) : (

              /* ── Lista de cards de persona ── */
              <div className="flex flex-col gap-3">

                {/* Barra búsqueda + ordenamiento */}
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative flex-1 min-w-[180px]">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Buscar por nombre..."
                      value={busquedaPersonas}
                      onChange={(e) => { setBusquedaPersonas(e.target.value); setPaginaPersonas(1); }}
                      className="w-full pl-8 pr-3 py-2 bg-white border border-gray-200 rounded-xl text-sm
                        focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition-all"
                    />
                  </div>
                  <select
                    value={sortPersonas}
                    onChange={(e) => { setSortPersonas(e.target.value); setPaginaPersonas(1); }}
                    className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-700
                      focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all cursor-pointer"
                  >
                    <option value="deuda_desc">Mayor deuda</option>
                    <option value="deuda_asc">Menor deuda</option>
                    <option value="nombre_asc">Nombre A → Z</option>
                    <option value="nombre_desc">Nombre Z → A</option>
                    <option value="abono_reciente">Último abono</option>
                  </select>
                  {tabPrestamos === 'companeros' && (
                    <Button size="sm" variant="secondary" onClick={() => setModalCrearPrestatario(true)}
                      className="flex-shrink-0">
                      <UserPlus size={14} /> Nuevo prestamista
                    </Button>
                  )}
                </div>

                {/* Filtros de estado */}
                <div className="flex items-center gap-1 flex-wrap">
                  {[
                    { id: 'todos',    label: 'Todos' },
                    // Solo si hay a quién mostrar (o si se llegó filtrando desde
                    // el aviso): un «Vencidos (0)» fijo sería ruido.
                    ...(nVencidosTab > 0 || filtroEstadoP === 'vencidos'
                      ? [{ id: 'vencidos', label: `Vencidos (${nVencidosTab})` }] : []),
                    { id: 'activos',  label: 'Con deuda' },
                    { id: 'sin_deuda', label: 'Saldados' },
                  ].map((f) => (
                    <button key={f.id}
                      onClick={() => { setFiltroEstadoP(f.id); setPaginaPersonas(1); }}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-all
                        ${filtroEstadoP === f.id
                          ? f.id === 'vencidos' ? 'bg-red-600 text-white' : 'bg-blue-100 text-blue-700'
                          : f.id === 'vencidos' ? 'bg-red-50 text-red-600 hover:bg-red-100'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                      {f.label}
                    </button>
                  ))}
                  <span className="ml-auto text-xs text-gray-400">
                    {totalPersonasFiltradas} persona{totalPersonasFiltradas !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Cards */}
                {gruposPagina.length === 0 ? (
                  <EmptyState
                    icon={tabPrestamos === 'companeros' ? User : Users}
                    titulo={busquedaPersonas.trim() ? 'Sin resultados para tu búsqueda'
                      : filtroEstadoP === 'vencidos' ? 'Nadie con cobros vencidos aquí'
                      : 'Sin préstamos registrados'}
                  />
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {gruposPagina.map(([key, grupo]) => (
                      <CardPersona key={key} nombre={grupo.nombre}
                        tipo={tabPrestamos === 'companeros' ? 'companero' : 'cliente'}
                        nActivos={grupo.nActivos} nCerrados={grupo.nCerrados}
                        valorActivos={grupo.valorActivos} abonadoActivos={grupo.abonadoActivos}
                        saldoTotal={grupo.saldoTotal}
                        ultimoAbono={grupo.ultimoAbono}
                        nVencidos={grupo.nVencidos} diasVencidoMax={grupo.diasVencidoMax}
                        onSeleccionar={() => setPersonaSeleccionadaKey(key)}
                        onEditar={tabPrestamos === 'companeros'
                          ? () => setModalEditarPrestatario({
                              id:       grupo.personaId,
                              nombre:   grupo.nombre,
                              telefono: grupo.telefono || '',
                            })
                          : () => setModalEditarCliente({
                              id:      grupo.personaId,
                              nombre:  grupo.nombre,
                              celular: grupo.celular || '',
                            })}
                      />
                    ))}
                  </div>
                )}

                {/* Paginación */}
                {totalPaginasPersonas > 1 && (
                  <div className="flex items-center justify-between px-1 pt-1">
                    <button
                      onClick={() => setPaginaPersonas((p) => Math.max(1, p - 1))}
                      disabled={paginaPersonasActual === 1}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm text-gray-600
                        border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                      <ChevronLeft size={14} /> Anterior
                    </button>
                    <span className="text-xs text-gray-500">
                      Página {paginaPersonasActual} de {totalPaginasPersonas}
                    </span>
                    <button
                      onClick={() => setPaginaPersonas((p) => Math.min(totalPaginasPersonas, p + 1))}
                      disabled={paginaPersonasActual === totalPaginasPersonas}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm text-gray-600
                        border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                      Siguiente <ChevronRight size={14} />
                    </button>
                  </div>
                )}
              </div>
            )
          )}
        </div>
      )}

      {tabPrincipal === 'creditos'      && <TabCreditos personaInicial={personaCreditoInicial} filtroInicial={filtroCreditoInicial} />}
      {tabPrincipal === 'domiciliarios' && <TabDomiciliarios />}
      {tabPrincipal === 'busqueda'      && (
        <TabBusquedaPrestamos onAbrirPersona={(clave) => {
          // La misma clave de la lista de personas: abre su ficha en Préstamos.
          setTabPrincipal('prestamos');
          setTabPrestamos(clave.startsWith('cliente_') ? 'clientes' : 'companeros');
          setPersonaSeleccionadaKey(clave);
        }} />
      )}

      {prestamoAbono && (
        <ModalAbonoPrestamo prestamo={prestamoAbono}
          onClose={() => setPrestamoAbono(null)} onSaldado={handleSaldado} />
      )}

      {prestamoDevol && (
        <ModalDevolucion prestamo={prestamoDevol} onClose={() => setPrestamoDevol(null)} />
      )}

      {prestamoImprimir && (
        <ModalImprimirPrestamo
          prestamo={prestamoImprimir}
          onClose={() => setPrestamoImprimir(null)}
        />
      )}

      {saldadoFacturaId && !modalImprimir && !facturaTermicaData && (
        <ModalConfirmarFactura
          prestamo={saldadoPrestamo}
          facturaConConfig={facturaConConfigSaldada}
          garantias={garantiasSaldadas}
          onNo={limpiarSaldado}
          onSi={(f, g) => setModalImprimir({ factura: f, garantias: g })}
        />
      )}

      {modalImprimir && !facturaTermicaData && (
        <ModalImprimirFactura open onClose={limpiarSaldado}
          factura={modalImprimir.factura} garantias={modalImprimir.garantias}
          onImprimirPos={(f, g) => { setModalImprimir(null); setFacturaTermicaData({ factura: f, garantias: g }); }}
        />
      )}

      {facturaTermicaData && (
        <FacturaTermica factura={facturaTermicaData.factura}
          garantias={facturaTermicaData.garantias} onClose={limpiarSaldado} />
      )}

      {modalSaldoPersona && (
        <ModalSaldoAFavor
          nombre={modalSaldoPersona.nombre}
          tipo={modalSaldoPersona.tipo}
          personaId={modalSaldoPersona.personaId}
          montoActual={modalSaldoPersona.saldoAFavor}
          onClose={() => setModalSaldoPersona(null)}
        />
      )}

      {modalHistorialSaldo && (
        <ModalHistorialSaldo
          nombre={modalHistorialSaldo.nombre}
          tipo={modalHistorialSaldo.tipo}
          personaId={modalHistorialSaldo.personaId}
          onClose={() => setModalHistorialSaldo(null)}
        />
      )}

      {prestamoIntercambio && (
        <ModalIntercambio
          prestamo={prestamoIntercambio}
          onClose={() => setPrestamoIntercambio(null)}
          onSaldado={(fid, p) => {
            setPrestamoIntercambio(null);
            setSaldadoFacturaId(fid);
            setSaldadoPrestamo(p);
          }}
        />
      )}

      {modalRetomaDirecta && (
        <ModalRetomaDirecta
          persona={modalRetomaDirecta.persona}
          sucursalId={null}
          onClose={() => setModalRetomaDirecta(null)}
          onSuccess={() => {
            setModalRetomaDirecta(null);
          }}
        />
      )}

      {modalCrearPrestatario && (
        <ModalCrearPrestatario onClose={() => setModalCrearPrestatario(false)} />
      )}

      {modalEditarPrestatario && (
        <ModalEditarPrestatario
          prestatario={modalEditarPrestatario}
          onClose={() => setModalEditarPrestatario(null)}
        />
      )}

      {modalEditarCliente && (
        <ModalEditarCliente
          cliente={modalEditarCliente}
          onClose={() => setModalEditarCliente(null)}
        />
      )}

      {modalAjusteCuentas && (
        <ModalAjusteDeuda
          nombre={modalAjusteCuentas.nombre}
          tipo={modalAjusteCuentas.tipo}
          personaId={modalAjusteCuentas.personaId}
          sucursalId={modalAjusteCuentas.sucursalId}
          onClose={() => setModalAjusteCuentas(null)}
        />
      )}

    </div>
  );
}
