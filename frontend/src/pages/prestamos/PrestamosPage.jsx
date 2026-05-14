import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { buscarPrestamos as buscarPrestamosApi } from '../../api/busqueda.api';
import { exportarPrestamosExcel } from '../../utils/exportarPrestamosExcel';
import { exportarCarteraPersonaExcel } from '../../utils/exportarCarteraPersonaExcel';
import { getPrestamos, registrarAbonoPrestamo, devolverPrestamo, devolverParcialPrestamo, registrarSaldoAFavor as registrarSaldoAFavorApi, intercambiarPrestamo as intercambiarPrestamoApi, anularAbono as anularAbonoApi, getRetomasDirectas as getRetomasDirectasApi, anularRetomaDirecta as anularRetomaDirectaApi, aplicarSaldoAPrestamo as aplicarSaldoAPrestamoApi, getEstadoCuenta as getEstadoCuentaApi } from '../../api/prestamos.api';
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
import { Spinner }                              from '../../components/ui/Spinner';
import { EmptyState }                           from '../../components/ui/EmptyState';
import { FacturaTermica }                       from '../../components/FacturaTermica';
import { ModalImprimirFactura }                 from '../../components/ui/ModalImprimirFactura';
import { ModalImprimirPrestamo }                from '../../components/ui/ModalImprimirPrestamo';
import { TabCreditos }                          from './TabCreditos';
import { ModalRetomaDirecta }                   from './ModalRetomaDirecta';
import { EstadoDeCuenta }                       from './EstadoDeCuenta';
import { useMetodosPago }                       from '../../hooks/useMetodosPago';
import useExportarPdfPrestamos                  from '../../hooks/useExportarPdfPrestamos';
import api                                      from '../../api/axios.config';
import {
  getProductosSerial, getProductosCantidad,
}                                               from '../../api/productos.api';
import {
  Handshake, CreditCard, Bike, Plus, CheckCircle,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  Users, User, AlertTriangle, FileDown, Loader2, Printer, Search, Wallet,
  ArrowLeftRight, Package, ShoppingBag, XCircle,
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
  const { exportando, exportarPdf } = useExportarPdfPrestamos();
  const handleClick = async (e) => {
    e.stopPropagation();
    try {
      await exportarPdf(tipo, personaId, `prestamos-activos-${nombrePersona.replace(/\s+/g, '-').toLowerCase()}`);
    } catch (err) { alert(err.message || 'Error al generar el PDF'); }
  };
  return (
    <button onClick={handleClick} disabled={exportando}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium
        border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100
        hover:border-blue-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0">
      {exportando ? <Loader2 size={12} className="animate-spin" /> : <FileDown size={12} />}
      PDF
    </button>
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
      queryClient.invalidateQueries({ queryKey: ['prestamos'],     exact: false });
      queryClient.invalidateQueries({ queryKey: ['prestatarios'],  exact: false });
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
  const coloresActivo = configData?.colores_serial_activo === '1';
  const coloresLista  = (() => {
    try { return JSON.parse(configData?.colores_serial_lista || '[]'); } catch { return []; }
  })();

  const [tipoRetoma,          setTipoRetoma]          = useState('serial');
  const [imeiRetoma,          setImeiRetoma]           = useState('');
  const [busquedaSerial,      setBusquedaSerial]       = useState('');
  const [productoSerialSel,   setProductoSerialSel]    = useState(null);
  const [colorRetoma,         setColorRetoma]          = useState('');
  const [busquedaCantidad,    setBusquedaCantidad]     = useState('');
  const [productoCantidadSel, setProductoCantidadSel] = useState(null);
  const [cantidadRetoma,      setCantidadRetoma]       = useState('1');
  const [valorRetoma,         setValorRetoma]          = useState('');
  const [ingresoInventario,   setIngresoInventario]    = useState(true);
  const [error,               setError]                = useState('');

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
    setBusquedaCantidad(''); setProductoCantidadSel(null); setCantidadRetoma('1');
  };

  const saldoPendiente = Number(prestamo.valor_prestamo) - Number(prestamo.total_abonado);
  const retoma         = Number(valorRetoma) || 0;
  const diff           = saldoPendiente - retoma; // positivo = queda deuda, negativo = saldo a favor

  const mutation = useMutation({
    mutationFn: () => intercambiarPrestamoApi(prestamo.id, {
      tipo_retoma:           tipoRetoma,
      imei_retoma:           tipoRetoma === 'serial'   ? (imeiRetoma.trim() || null) : null,
      producto_serial_id:    tipoRetoma === 'serial'   ? (productoSerialSel?.id  || null) : null,
      color_retoma:          tipoRetoma === 'serial'   ? (colorRetoma.trim() || null) : null,
      producto_cantidad_id:  tipoRetoma === 'cantidad' ? (productoCantidadSel?.id || null) : null,
      cantidad_retoma:       tipoRetoma === 'cantidad' ? Number(cantidadRetoma || 1) : 1,
      valor_retoma:          retoma,
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
            </div>
          )}

          {/* Campos cantidad */}
          {tipoRetoma === 'cantidad' && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-600">Producto {ingresoInventario ? '*' : ''}</label>
                <input type="text" placeholder="Buscar producto..." value={busquedaCantidad}
                  onChange={(e) => { setBusquedaCantidad(e.target.value); setProductoCantidadSel(null); }}
                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl
                    text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 transition-all" />
                {busquedaCantidad.length > 0 && !productoCantidadSel && (
                  <div className="flex flex-col max-h-28 overflow-y-auto rounded-xl border border-gray-100 bg-white">
                    {filtradosCantidad.length === 0
                      ? <p className="text-xs text-gray-400 px-3 py-2">Sin resultados</p>
                      : filtradosCantidad.map((p) => (
                          <button key={p.id}
                            onClick={() => { setProductoCantidadSel(p); setBusquedaCantidad(p.nombre); }}
                            className="text-left px-3 py-2 text-sm hover:bg-purple-50 text-gray-700 border-b border-gray-50 last:border-0">
                            {p.nombre}
                            <span className="text-xs text-gray-400 ml-2">Stock: {p.stock}</span>
                          </button>
                        ))
                    }
                  </div>
                )}
                {productoCantidadSel && <p className="text-xs text-purple-600">✓ {productoCantidadSel.nombre}</p>}
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
          <p className="text-xs text-gray-400">Este monto se aplica como abono al préstamo</p>
        </div>

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

function CardPersona({ nombre, tipo, prestamos, saldoTotal, ultimoAbono, onSeleccionar }) {
  const activos  = prestamos.filter((p) => p.estado === 'Activo');
  const cerrados = prestamos.filter((p) => p.estado !== 'Activo');

  const totalVal = activos.reduce((s, p) => s + Number(p.valor_prestamo), 0);
  const totalAbo = activos.reduce((s, p) => s + Number(p.total_abonado),  0);
  const pct      = totalVal > 0 ? Math.min(100, (totalAbo / totalVal) * 100) : 0;

  const avatarClass = tipo === 'companero'
    ? 'bg-blue-100 text-blue-700'
    : 'bg-violet-100 text-violet-700';

  const { texto: abonoTexto, nivel: abonoNivel } = tiempoUltimoAbono(ultimoAbono);

  return (
    <button
      onClick={onSeleccionar}
      className="w-full text-left bg-white border border-gray-100 rounded-2xl p-4
        hover:border-blue-200 hover:shadow-sm active:scale-[0.99] transition-all
        flex items-center gap-3"
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
          {activos.length > 0 && (
            <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">
              {activos.length} activo{activos.length !== 1 ? 's' : ''}
            </span>
          )}
          {cerrados.length > 0 && (
            <span className="text-xs bg-gray-50 text-gray-400 px-2 py-0.5 rounded-full">
              {cerrados.length} cerrado{cerrados.length !== 1 ? 's' : ''}
            </span>
          )}
          {activos.length > 0 && (
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${ABONO_CLASES[abonoNivel]}`}>
              {abonoTexto}
            </span>
          )}
        </div>

        {activos.length > 0 && (
          <div className="mt-2 w-full bg-gray-100 rounded-full h-1">
            <div className="bg-blue-400 h-1 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      <ChevronRight size={15} className="text-gray-300 flex-shrink-0" />
    </button>
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
                <span className="text-xs text-gray-400">{formatFechaHora(abono.fecha)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-green-600 flex-shrink-0">
                  + {formatCOP(abono.valor)}
                </span>
                {!confirmando && (
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

function TarjetaPrestamoDetalle({ prestamo, onAbonar, onDevolver, onImprimir, onIntercambiar, onAplicarSaldo, saldoAFavor = 0, aplicandoSaldo = false, coloresActivo, cerrado = false }) {
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

        {/* Acciones — solo préstamos activos */}
        {prestamo.estado === 'Activo' && (
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" className="flex-1" onClick={() => onAbonar(prestamo)}>
              <Plus size={14} /> Abonar
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onIntercambiar(prestamo)}>
              <ArrowLeftRight size={14} /> Pago en producto
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onDevolver(prestamo)}>
              <CheckCircle size={14} /> Devuelto
            </Button>
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

function VistaDetallePersona({ nombre, tipo, personaId, prestamos, saldoAFavor = 0, onVolver, onAbonar, onDevolver, onImprimir, onIntercambiar, onRegistrarSaldo, onRetomaDirecta, coloresActivo }) {
  const queryClient = useQueryClient();
  const [tabDetalle,          setTabDetalle]          = useState('prestamos'); // 'prestamos' | 'cuenta'
  const [cerradosAbiertos,    setCerradosAbiertos]    = useState(false);
  const [retomasAbiertas,     setRetomasAbiertas]     = useState(false);
  const [confirmAnularRetoma, setConfirmAnularRetoma] = useState(null);
  const [busquedaPrest,       setBusquedaPrest]       = useState('');
  const [fechaPrestDesde,     setFechaPrestDesde]     = useState('');
  const [fechaPrestHasta,     setFechaPrestHasta]     = useState('');
  const [aplicandoSaldoId,    setAplicandoSaldoId]    = useState(null);
  const [resultadoSaldo,      setResultadoSaldo]      = useState(null);

  const mutAplicarSaldo = useMutation({
    mutationFn: (prestamoId) => aplicarSaldoAPrestamoApi(prestamoId),
    onMutate:   (prestamoId) => setAplicandoSaldoId(prestamoId),
    onSuccess:  (res) => {
      queryClient.invalidateQueries({ queryKey: ['prestamos'], exact: false });
      setResultadoSaldo(res.data.data);
      setAplicandoSaldoId(null);
    },
    onError: (err) => {
      alert(err.response?.data?.error || 'Error al aplicar el saldo');
      setAplicandoSaldoId(null);
    },
  });

  const tipoApi = tipo === 'companero' ? 'prestatario' : tipo;

  const { data: retomasDirectas = [] } = useQuery({
    queryKey:  ['retomas-directas', tipoApi, personaId],
    queryFn:   () => getRetomasDirectasApi(tipoApi, personaId).then((r) => r.data.data),
    staleTime: 30_000,
  });

  const mutAnularRetoma = useMutation({
    mutationFn: (retomaId) => anularRetomaDirectaApi(retomaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['retomas-directas', tipoApi, personaId] });
      queryClient.invalidateQueries({ queryKey: ['prestamos'], exact: false });
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
    if (q && !p.nombre_producto?.toLowerCase().includes(q)) return false;
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
          <div className="px-4 py-3 flex flex-col gap-0.5">
            <p className="text-xs text-gray-400">Saldo a favor</p>
            <p className={`text-sm font-bold ${saldoAFavor > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>
              {saldoAFavor > 0 ? formatCOP(saldoAFavor) : '—'}
            </p>
          </div>
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
            onClick={onRegistrarSaldo}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-400
              hover:text-gray-600 transition-colors ml-auto">
            <Plus size={12} />
            {saldoAFavor > 0 ? 'Actualizar saldo' : 'Registrar saldo a favor'}
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
        <EstadoDeCuenta tipo={tipo} personaId={personaId} />
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
              placeholder="Buscar por producto..."
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
            Factura #{String(entrega.factura_id).padStart(6, '0')}
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
        <p className="text-xs text-gray-400">#{String(entrega.factura_id).padStart(6, '0')} · {entrega.domiciliario_nombre}</p>
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
        <p className="text-xs text-gray-500">Factura #{String(e?.factura_id || 0).padStart(6, '0')}{e?.cliente_celular ? ` · ${e.cliente_celular}` : ''}</p>
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

// ─── Hook: obtener abonos de un préstamo para impresión ───────────────────────

function useAbonosPrestamo(prestamoId) {
  const { data = [] } = useQuery({
    queryKey: ['abonos-prestamo', prestamoId],
    queryFn:  () => api.get(`/prestamos/${prestamoId}`).then((r) => r.data.data?.abonos || []),
    enabled:  !!prestamoId,
    staleTime: 0,
  });
  return data;
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

function TarjetaResultadoPrestamo({ prestamo, onAbonar, onDevolver }) {
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
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" onClick={() => onAbonar(prestamo)}>
            <Plus size={14} /> Abonar
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onDevolver(prestamo)}>
            <CheckCircle size={14} /> Devuelto
          </Button>
        </div>
      )}
    </div>
  );
}

function TabBusquedaPrestamos() {
  const [q,          setQ]          = useState('');
  const [estado,     setEstado]     = useState('');
  const [tipo,       setTipo]       = useState('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');

  const [prestamoAbono, setPrestamoAbono] = useState(null);
  const [prestamoDevol, setPrestamoDevol] = useState(null);

  const hasFilter = q.trim().length >= 2 || estado || tipo || fechaDesde || fechaHasta;

  const { data: resultados = [], isLoading } = useQuery({
    queryKey: ['busqueda-prestamos', q, estado, tipo, fechaDesde, fechaHasta],
    queryFn:  () => buscarPrestamosApi({ q: q.trim(), estado, tipo, fechaDesde, fechaHasta })
      .then((r) => r.data.data),
    // ✅ Después
    enabled: !!hasFilter,
    staleTime: 30 * 1000,
  });

  const totalSaldo = resultados
    .filter((p) => p.estado === 'Activo')
    .reduce((s, p) => s + Number(p.saldo_pendiente || 0), 0);

  const limpiar = () => {
    setQ(''); setEstado(''); setTipo(''); setFechaDesde(''); setFechaHasta('');
  };

  return (
    <div className="flex flex-col gap-4">

      {/* Buscador de texto */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre, IMEI, cédula o producto…"
          className="w-full pl-9 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl
            text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
        />
      </div>

      {/* Filtro estado */}
      <div className="flex flex-wrap gap-2">
        {ESTADOS_FILTRO.map((opt) => (
          <button key={opt.v} type="button" onClick={() => setEstado(opt.v)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all
              ${estado === opt.v
                ? 'bg-blue-50 border-blue-300 text-blue-700'
                : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-gray-300'}`}>
            {opt.label}
          </button>
        ))}
      </div>

      {/* Filtro tipo */}
      <div className="flex flex-wrap gap-2">
        {TIPOS_FILTRO.map((opt) => {
          const OptIcon = opt.Icn;
          return (
            <button key={opt.v} type="button" onClick={() => setTipo(opt.v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium
                border transition-all
                ${tipo === opt.v
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-gray-300'}`}>
              <OptIcon size={11} />
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Rango de fechas */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Desde</label>
          <input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)}
            className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Hasta</label>
          <input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)}
            className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all" />
        </div>
      </div>

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
          Filtra por texto, estado, tipo o rango de fechas para buscar préstamos
        </p>
      )}

      {hasFilter && isLoading && <Spinner className="py-10" />}

      {hasFilter && !isLoading && resultados.length === 0 && (
        <EmptyState icon={Search} titulo="Sin resultados"
          descripcion="No se encontraron préstamos con esos filtros" />
      )}

      {/* Resumen y resultados */}
      {resultados.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <p className="text-xs text-gray-400">
                {resultados.length} resultado{resultados.length !== 1 ? 's' : ''}
              </p>
              {totalSaldo > 0 && (
                <p className="text-xs font-semibold text-red-500">
                  Saldo activo: {formatCOP(totalSaldo)}
                </p>
              )}
            </div>
            <Button size="sm" variant="secondary"
              onClick={() => exportarPrestamosExcel(resultados, 'prestamos-filtrados')}>
              <FileDown size={14} /> Exportar Excel
            </Button>
          </div>
          {resultados.map((p) => (
            <TarjetaResultadoPrestamo
              key={p.id}
              prestamo={p}
              onAbonar={setPrestamoAbono}
              onDevolver={setPrestamoDevol}
            />
          ))}
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
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function PrestamosPage() {
  const { coloresActivo } = useColoresConfig();

  const [tabPrincipal,         setTabPrincipal]         = useState('prestamos');
  const [tabPrestamos,         setTabPrestamos]         = useState('companeros');
  const [personaSeleccionadaKey, setPersonaSeleccionadaKey] = useState(null);
  const [prestamoAbono,        setPrestamoAbono]        = useState(null);
  const [prestamoDevol,        setPrestamoDevol]        = useState(null);
  const [busquedaPersonas,     setBusquedaPersonas]     = useState('');
  const [sortPersonas,         setSortPersonas]         = useState('deuda_desc');
  const [filtroEstadoP,        setFiltroEstadoP]        = useState('todos');
  const [paginaPersonas,       setPaginaPersonas]       = useState(1);

  const [prestamoImprimir,    setPrestamoImprimir]    = useState(null);
  const [prestamoIntercambio, setPrestamoIntercambio] = useState(null);
  const [modalSaldoPersona,   setModalSaldoPersona]   = useState(null); // { nombre, tipo, personaId, saldoAFavor }
  const [modalRetomaDirecta,  setModalRetomaDirecta]  = useState(null); // { persona: { tipo, id, nombre } }
  const abonosImprimir = useAbonosPrestamo(prestamoImprimir?.id);

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

  const { data: prestamosData, isLoading: loadingP } = useQuery({
    queryKey: ['prestamos'],
    queryFn:  () => getPrestamos().then((r) => r.data.data),
  });

  const prestamos = prestamosData || [];

  const gruposCompaneros = prestamos.filter((p) => p.prestatario_id).reduce((acc, p) => {
    const key = `prestatario_${p.prestatario_id}`;
    if (!acc[key]) acc[key] = {
      nombre:      p.prestatario_nombre || p.prestatario,
      personaId:   p.prestatario_id,
      prestamos:   [],
      saldoTotal:  0,
      saldoAFavor: Number(p.prestatario_saldo_a_favor ?? 0),
      ultimoAbono: p.ultimo_abono_prestatario ?? null,
    };
    acc[key].prestamos.push(p);
    if (p.estado === 'Activo') acc[key].saldoTotal += Number(p.valor_prestamo) - Number(p.total_abonado);
    return acc;
  }, {});

  const gruposClientes = prestamos.filter((p) => p.cliente_id).reduce((acc, p) => {
    const key = `cliente_${p.cliente_id}`;
    if (!acc[key]) acc[key] = {
      nombre:      p.cliente_nombre || p.prestatario,
      personaId:   p.cliente_id,
      prestamos:   [],
      saldoTotal:  0,
      saldoAFavor: Number(p.cliente_saldo_a_favor ?? 0),
      ultimoAbono: p.ultimo_abono_cliente ?? null,
    };
    acc[key].prestamos.push(p);
    if (p.estado === 'Activo') acc[key].saldoTotal += Number(p.valor_prestamo) - Number(p.total_abonado);
    return acc;
  }, {});

  // La persona seleccionada siempre refleja los datos más recientes del query
  const grupoActual = personaSeleccionadaKey
    ? (gruposCompaneros[personaSeleccionadaKey] || gruposClientes[personaSeleccionadaKey])
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
    setFiltroEstadoP('todos');
    setSortPersonas('deuda_desc');
    setPaginaPersonas(1);
  };

  const PAGE_SIZE_PERSONAS = 10;

  const gruposRaw     = tabPrestamos === 'companeros' ? gruposCompaneros : gruposClientes;
  const gruposEntries = Object.entries(gruposRaw);

  const gruposBuscados = busquedaPersonas.trim()
    ? gruposEntries.filter(([, g]) => g.nombre.toLowerCase().includes(busquedaPersonas.trim().toLowerCase()))
    : gruposEntries;

  const gruposFiltrados = filtroEstadoP === 'activos'
    ? gruposBuscados.filter(([, g]) => g.saldoTotal > 0)
    : filtroEstadoP === 'sin_deuda'
    ? gruposBuscados.filter(([, g]) => g.saldoTotal <= 0)
    : gruposBuscados;

  const gruposOrdenados = [...gruposFiltrados].sort(([, a], [, b]) => {
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
        <Button size="sm" variant="secondary" className="flex-shrink-0"
          disabled={!prestamos.length}
          onClick={() => exportarPrestamosExcel(prestamos, 'prestamos')}>
          <FileDown size={14} /> Exportar Excel
        </Button>
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
                </button>
              );
            })}
          </div>

          {loadingP ? <Spinner className="py-20" /> : (

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
                </div>

                {/* Filtros de estado */}
                <div className="flex items-center gap-1 flex-wrap">
                  {[
                    { id: 'todos',    label: 'Todos' },
                    { id: 'activos',  label: 'Con deuda' },
                    { id: 'sin_deuda', label: 'Saldados' },
                  ].map((f) => (
                    <button key={f.id}
                      onClick={() => { setFiltroEstadoP(f.id); setPaginaPersonas(1); }}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-all
                        ${filtroEstadoP === f.id
                          ? 'bg-blue-100 text-blue-700'
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
                    titulo={busquedaPersonas.trim() ? 'Sin resultados para tu búsqueda' : 'Sin préstamos registrados'}
                  />
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {gruposPagina.map(([key, grupo]) => (
                      <CardPersona key={key} nombre={grupo.nombre}
                        tipo={tabPrestamos === 'companeros' ? 'companero' : 'cliente'}
                        prestamos={grupo.prestamos} saldoTotal={grupo.saldoTotal}
                        ultimoAbono={grupo.ultimoAbono}
                        onSeleccionar={() => setPersonaSeleccionadaKey(key)} />
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

      {tabPrincipal === 'creditos'      && <TabCreditos />}
      {tabPrincipal === 'domiciliarios' && <TabDomiciliarios />}
      {tabPrincipal === 'busqueda'      && <TabBusquedaPrestamos />}

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
          abonos={abonosImprimir}
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

    </div>
  );
}
