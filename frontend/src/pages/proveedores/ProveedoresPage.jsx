import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { buscarCompras as buscarComprasApi } from '../../api/busqueda.api';
import { getProveedores, crearProveedor, actualizarProveedor } from '../../api/proveedores.api';
import { getComprasByProveedor, getCompraById, getComprasPaginadas, cancelarCompra as cancelarCompraApi, devolverCompra as devolverCompraApi, editarPreciosCompra as editarPreciosCompraApi } from '../../api/compras.api';
import { getAcreedores, registrarMovimiento as registrarMovAcreedor, getComprasConSaldo, getAbonosPorCargo } from '../../api/acreedores.api';
import { formatCOP, formatFechaHora } from '../../utils/formatters';
import { Button }      from '../../components/ui/Button';
import { Input }       from '../../components/ui/Input';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { Modal }       from '../../components/ui/Modal';
import { Badge }       from '../../components/ui/Badge';
import { Spinner }     from '../../components/ui/Spinner';
import { EmptyState }  from '../../components/ui/EmptyState';
import { SearchInput } from '../../components/ui/SearchInput';
import { ModalCompra } from './ModalCompra';
import { useSucursalKey } from '../../hooks/useSucursalKey';
import { useMetodosPago } from '../../hooks/useMetodosPago';
import api from '../../api/axios.config';
import { useAuth } from '../../context/useAuth';
import {
  Truck, Plus, ShoppingCart, ChevronRight, ChevronLeft, ChevronDown, ChevronUp,
  Package, Hash, User, RefreshCw, ArrowLeftRight, ShoppingBag, Repeat,
  Search, ScanLine, Calculator, Undo2, Pencil,
} from 'lucide-react';

// ─── API helpers ──────────────────────────────────────────────────────────────

const getComprasClienteSerial = (q = '') =>
  api.get('/productos-serial/compras-cliente', { params: { q } })
    .then((r) => r.data.data);

const getHistorialStockCantidad = (q = '') =>
  api.get('/productos-cantidad/historial-stock', { params: { q } })
    .then((r) => r.data.data);

// ─── Utilidad ─────────────────────────────────────────────────────────────────

function norm(data) {
  if (Array.isArray(data)) return data;
  if (data?.items && Array.isArray(data.items)) return data.items;
  return [];
}

function normalizarTexto(texto) {
  return (texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

const PAGE_SIZE = 20;

// ─── Opciones de tipo para el select ──────────────────────────────────────────

const OPCIONES_TIPO = [
  { value: 'proveedor', label: 'Proveedor' },
  { value: 'cruce',     label: 'Cruce'     },
];

// ─── Badge tipo ───────────────────────────────────────────────────────────────

function TipoBadge({ tipo }) {
  const cfg = {
    compra:           { label: 'Compra a cliente',   cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', Icn: Package       },
    retoma:           { label: 'Retoma de factura',  cls: 'bg-purple-100  text-purple-700  border-purple-200',  Icn: ArrowLeftRight },
    compra_cliente:   { label: 'Compra a cliente',   cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', Icn: Package       },
    compra_proveedor: { label: 'Compra a proveedor', cls: 'bg-blue-100    text-blue-700    border-blue-200',    Icn: Truck         },
    ajuste:           { label: 'Ajuste de stock',    cls: 'bg-gray-100    text-gray-600    border-gray-200',    Icn: ShoppingBag   },
    venta:            { label: 'Venta',              cls: 'bg-red-100     text-red-700     border-red-200',     Icn: ShoppingCart  },
  };
  const c   = cfg[tipo] || cfg.ajuste;
  const Icn = c.Icn;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${c.cls}`}>
      <Icn size={10} /> {c.label}
    </span>
  );
}

// ─── ProveedorTipoBadge ───────────────────────────────────────────────────────

function ProveedorTipoBadge({ tipo }) {
  const esCruce = tipo === 'cruce';
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border
      ${esCruce
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-blue-50 text-blue-700 border-blue-200'
      }`}
    >
      {esCruce ? <Repeat size={10} /> : <Truck size={10} />}
      {esCruce ? 'Cruce' : 'Proveedor'}
    </span>
  );
}

// ─── Modal detalle retoma/compra serial ───────────────────────────────────────

function ModalDetalleSerial({ item, historial, onClose }) {
  return (
    <Modal open onClose={onClose} title="Detalle" size="md">
      <div className="flex flex-col gap-4">
        <TipoBadge tipo={item.tipo} />

        <div className="bg-emerald-50 rounded-xl p-3 flex flex-col gap-2">
          <p className="text-xs font-semibold text-emerald-700 mb-0.5">Cliente</p>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Nombre</span>
            <span className="font-medium text-gray-900">{item.nombre_cliente || '—'}</span>
          </div>
          {item.cedula_cliente && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Cédula</span>
              <span className="font-mono text-gray-900">{item.cedula_cliente}</span>
            </div>
          )}
        </div>

        <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-2">
          <p className="text-xs font-semibold text-gray-600 mb-0.5">Producto</p>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Nombre</span>
            <span className="font-medium text-gray-900 text-right max-w-[60%]">
              {item.nombre_producto || '—'}
              {item.marca  ? ` · ${item.marca}`  : ''}
              {item.modelo ? ` ${item.modelo}` : ''}
            </span>
          </div>
          {item.imei && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">IMEI</span>
              <span className="font-mono text-gray-900">{item.imei}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Fecha</span>
            <span className="text-gray-900">{formatFechaHora(item.fecha)}</span>
          </div>
          {item.valor != null && Number(item.valor) > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">{item.tipo === 'compra' ? 'Precio pagado' : 'Valor retoma'}</span>
              <span className="font-semibold text-emerald-700">{formatCOP(item.valor)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Sucursal</span>
            <span className="text-gray-700">{item.sucursal_nombre}</span>
          </div>
          {item.factura_id && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Factura</span>
              <span className="font-mono text-gray-700">#{String(item.factura_numero ?? item.factura_id).padStart(6, '0')}</span>
            </div>
          )}
        </div>

        {historial.length > 1 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-gray-600">
              Historial de {item.nombre_cliente} ({historial.length} registros)
            </p>
            <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
              {historial.map((h, i) => (
                <div key={i} className="bg-white border border-gray-100 rounded-xl px-3 py-2 flex justify-between text-sm">
                  <div>
                    <span className="font-medium text-gray-800">{h.nombre_producto}</span>
                    {h.imei && <span className="text-xs text-gray-400 font-mono ml-2">{h.imei}</span>}
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    {h.valor != null && Number(h.valor) > 0 && (
                      <span className="text-xs font-semibold text-emerald-700">{formatCOP(h.valor)}</span>
                    )}
                    <p className="text-xs text-gray-400">{formatFechaHora(h.fecha)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <Button variant="secondary" onClick={onClose}>Cerrar</Button>
      </div>
    </Modal>
  );
}

// ─── Modal detalle movimiento cantidad ────────────────────────────────────────

function ModalDetalleCantidad({ item, historial, onClose }) {
  return (
    <Modal open onClose={onClose} title="Detalle movimiento" size="md">
      <div className="flex flex-col gap-4">
        <TipoBadge tipo={item.tipo} />

        {(item.cliente_origen || item.cedula_cliente) && (
          <div className="bg-emerald-50 rounded-xl p-3 flex flex-col gap-2">
            <p className="text-xs font-semibold text-emerald-700 mb-0.5">Cliente</p>
            {item.cliente_origen && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Nombre</span>
                <span className="font-medium text-gray-900">{item.cliente_origen}</span>
              </div>
            )}
            {item.cedula_cliente && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Cédula</span>
                <span className="font-mono text-gray-900">{item.cedula_cliente}</span>
              </div>
            )}
          </div>
        )}

        <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-2">
          <p className="text-xs font-semibold text-gray-600 mb-0.5">Movimiento</p>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Producto</span>
            <span className="font-medium text-gray-900 text-right max-w-[60%]">
              {item.nombre_producto}
              {item.unidad_medida ? ` (${item.unidad_medida})` : ''}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Cantidad</span>
            <span className={`font-semibold ${item.cantidad > 0 ? 'text-green-600' : 'text-red-500'}`}>
              {item.cantidad > 0 ? '+' : ''}{item.cantidad}
            </span>
          </div>
          {item.costo_unitario != null && Number(item.costo_unitario) > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Precio unitario</span>
              <span className="font-semibold text-emerald-700">{formatCOP(item.costo_unitario)}</span>
            </div>
          )}
          {item.costo_unitario != null && Number(item.costo_unitario) > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Total</span>
              <span className="font-bold text-gray-900">
                {formatCOP(Math.abs(item.cantidad) * Number(item.costo_unitario))}
              </span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Fecha</span>
            <span className="text-gray-900">{formatFechaHora(item.fecha)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Sucursal</span>
            <span className="text-gray-700">{item.sucursal_nombre}</span>
          </div>
          {item.proveedor_nombre && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Proveedor</span>
              <span className="text-gray-700">{item.proveedor_nombre}</span>
            </div>
          )}
        </div>

        {historial.length > 1 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-gray-600">
              Historial de {item.cliente_origen} ({historial.length} movimientos)
            </p>
            <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
              {historial.map((h, i) => (
                <div key={i} className="bg-white border border-gray-100 rounded-xl px-3 py-2 flex justify-between text-sm">
                  <div>
                    <span className="font-medium text-gray-800">{h.nombre_producto}</span>
                    <span className={`text-xs font-semibold ml-2 ${h.cantidad > 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {h.cantidad > 0 ? '+' : ''}{h.cantidad}
                    </span>
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    {h.costo_unitario != null && Number(h.costo_unitario) > 0 && (
                      <span className="text-xs font-semibold text-emerald-700">{formatCOP(h.costo_unitario)}</span>
                    )}
                    <p className="text-xs text-gray-400">{formatFechaHora(h.fecha)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <Button variant="secondary" onClick={onClose}>Cerrar</Button>
      </div>
    </Modal>
  );
}

// ─── Tab: Retomas de clientes ──────────────────────────────────────────────────

function TabRetomas() {
  const [busqueda,          setBusqueda]          = useState('');
  const [queryDebounced,    setQueryDebounced]    = useState('');
  const [itemDetalle,       setItemDetalle]       = useState(null);
  const [tabFuente,         setTabFuente]         = useState('todas');
  const [pagina,            setPagina]            = useState(1);

  // Debounce + normalización: espera 350 ms tras el último teclazo
  useEffect(() => {
    const t = setTimeout(() => {
      setQueryDebounced(normalizarTexto(busqueda));
      setPagina(1);
    }, 350);
    return () => clearTimeout(t);
  }, [busqueda]);


  const { data: dataSerial, isLoading: loadingSerial } = useQuery({
    queryKey: ['compras-cliente-serial', queryDebounced],
    queryFn:  () => getComprasClienteSerial(queryDebounced),
  });

  const { data: dataCantidad, isLoading: loadingCantidad } = useQuery({
    queryKey: ['historial-stock-cantidad', queryDebounced],
    queryFn:  () => getHistorialStockCantidad(queryDebounced),
  });

  const isLoading = loadingSerial || loadingCantidad;

  const serialesCompra = norm(dataSerial?.seriales).map((s) => ({ ...s, tipo: 'compra',  fuente: 'serial' }));
  const serialesRetoma = norm(dataSerial?.retomas).map((r)  => ({ ...r, tipo: 'retoma',  fuente: 'serial' }));
  const movimientosCantidad = norm(dataCantidad).map((m) => ({ ...m, fuente: 'cantidad' }));

  const todasSerial   = [...serialesCompra, ...serialesRetoma]
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  const todasCantidad = movimientosCantidad;

  const lista = tabFuente === 'todas'
    ? [...todasSerial, ...todasCantidad].sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
    : tabFuente === 'serial'
    ? todasSerial
    : todasCantidad;

  // Con búsqueda activa se muestran todos los resultados; sin búsqueda se pagina
  const hayBusqueda  = queryDebounced.length > 0;
  const listaVisible = hayBusqueda ? lista : lista.slice(0, pagina * PAGE_SIZE);
  const hayMas       = !hayBusqueda && lista.length > pagina * PAGE_SIZE;
  const restantes    = lista.length - pagina * PAGE_SIZE;

  const historialCliente = (item) => {
    if (!item) return [];
    if (item.fuente === 'serial') {
      return todasSerial.filter((i) =>
        normalizarTexto(i.nombre_cliente) === normalizarTexto(item.nombre_cliente)
      );
    }
    return todasCantidad.filter((i) =>
      i.cliente_origen &&
      normalizarTexto(i.cliente_origen) === normalizarTexto(item.cliente_origen)
    );
  };

  const totalSerial   = todasSerial.length;
  const totalCantidad = todasCantidad.length;

  return (
    <div className="flex flex-col gap-4">
      <SearchInput
        value={busqueda}
        onChange={setBusqueda}
        placeholder="Buscar por nombre, cédula, producto o IMEI..."
      />

      <div className="flex gap-2 flex-wrap">
        {[
          { id: 'todas',    label: `Todas (${totalSerial + totalCantidad})` },
          { id: 'serial',   label: `Con IMEI (${totalSerial})`              },
          { id: 'cantidad', label: `Por cantidad (${totalCantidad})`        },
        ].map((t) => (
          <button key={t.id} onClick={() => { setTabFuente(t.id); setPagina(1); }}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all
              ${tabFuente === t.id
                ? 'bg-blue-50 border-blue-300 text-blue-700'
                : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-gray-300'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? <Spinner className="py-20" /> : lista.length === 0 ? (
        <EmptyState
          icon={RefreshCw}
          titulo="Sin registros"
          descripcion={hayBusqueda ? `Sin resultados para "${busqueda}"` : 'Aún no hay retomas ni compras a clientes'}
        />
      ) : (
        <>
          {!hayBusqueda && (
            <p className="text-xs text-gray-400 text-right">
              Mostrando {listaVisible.length} de {lista.length}
            </p>
          )}
          <div className="flex flex-col gap-2">
            {listaVisible.map((item, i) => {
              const esSerial = item.fuente === 'serial';
              const nombreMostrar = esSerial
                ? (item.nombre_cliente || '—')
                : (item.cliente_origen || item.proveedor_nombre || '—');
              const cedulaMostrar = item.cedula_cliente;

              return (
                <button key={`${item.fuente}-${item.tipo}-${item.id}-${i}`}
                  onClick={() => setItemDetalle(item)}
                  className="bg-white border border-gray-100 rounded-2xl p-3 flex items-start
                    justify-between gap-3 hover:border-blue-200 hover:bg-blue-50 transition-all text-left">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <TipoBadge tipo={item.tipo} />
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <User size={12} className="text-gray-400 flex-shrink-0" />
                      <span className="text-sm font-semibold text-gray-900 truncate">{nombreMostrar}</span>
                      {cedulaMostrar && (
                        <span className="text-xs text-gray-400 font-mono flex-shrink-0">CC {cedulaMostrar}</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-700 truncate mt-0.5">
                      {item.nombre_producto || '—'}
                      {item.marca ? ` · ${item.marca}` : ''}
                      {!esSerial && item.unidad_medida ? ` (${item.unidad_medida})` : ''}
                    </p>
                    {item.imei && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <Hash size={10} className="text-gray-400" />
                        <span className="text-xs text-gray-400 font-mono">{item.imei}</span>
                      </div>
                    )}
                    {!esSerial && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        Cantidad: <span className={`font-semibold ${item.cantidad > 0 ? 'text-green-600' : 'text-red-500'}`}>
                          {item.cantidad > 0 ? '+' : ''}{item.cantidad}
                        </span>
                      </p>
                    )}
                    <p className="text-xs text-gray-400 mt-0.5">
                      {formatFechaHora(item.fecha)} · {item.sucursal_nombre}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {(item.valor != null || item.costo_unitario != null) &&
                      Number(item.valor ?? item.costo_unitario) > 0 && (
                      <span className="text-sm font-bold text-emerald-700">
                        {formatCOP(item.valor ?? item.costo_unitario)}
                      </span>
                    )}
                    <ChevronRight size={14} className="text-gray-400" />
                  </div>
                </button>
              );
            })}
          </div>

          {hayMas && (
            <button
              onClick={() => setPagina((p) => p + 1)}
              className="w-full py-2.5 rounded-2xl border border-gray-200 text-sm text-gray-500
                hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50 transition-all font-medium">
              Ver más ({restantes > PAGE_SIZE ? PAGE_SIZE : restantes} de {restantes} restantes)
            </button>
          )}
        </>
      )}

      {itemDetalle && itemDetalle.fuente === 'serial' && (
        <ModalDetalleSerial
          item={itemDetalle}
          historial={historialCliente(itemDetalle)}
          onClose={() => setItemDetalle(null)}
        />
      )}
      {itemDetalle && itemDetalle.fuente === 'cantidad' && (
        <ModalDetalleCantidad
          item={itemDetalle}
          historial={historialCliente(itemDetalle)}
          onClose={() => setItemDetalle(null)}
        />
      )}
    </div>
  );
}

// ─── Modal detalle de compra proveedor ────────────────────────────────────────

function ModalDetalleCompra({ compraId, onClose }) {
  const queryClient = useQueryClient();
  const { usuario }  = useAuth();
  const esAdmin      = usuario?.rol === 'admin_negocio';
  const [confirmando, setConfirmando] = useState(false);
  const [errorCancel, setErrorCancel] = useState('');
  const [modoDevolucion, setModoDevolucion] = useState(false);
  const [cantidades, setCantidades] = useState({});   // { linea_id: cantidad }
  const [motivo, setMotivo]         = useState('');
  const [errorDevol, setErrorDevol] = useState('');
  const [modoEditar, setModoEditar]   = useState(false);
  const [precios, setPrecios]         = useState({});  // { linea_id: precio_unitario }
  const [motivoEditar, setMotivoEditar] = useState('');
  const [errorEditar, setErrorEditar] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['compra-detalle', compraId],
    queryFn:  () => getCompraById(compraId).then((r) => r.data.data),
    enabled:  !!compraId,
  });

  const invalidarCompras = () => {
    queryClient.invalidateQueries({ queryKey: ['compra-detalle', compraId] });
    queryClient.invalidateQueries({ queryKey: ['compras-paginadas'],   exact: false });
    queryClient.invalidateQueries({ queryKey: ['compras-proveedor'],   exact: false });
    queryClient.invalidateQueries({ queryKey: ['acreedores'],          exact: false });
    queryClient.invalidateQueries({ queryKey: ['compras-con-saldo'],   exact: false });
    queryClient.invalidateQueries({ queryKey: ['historial-acreedor'],  exact: false });
  };

  const mutCancelar = useMutation({
    mutationFn: () => cancelarCompraApi(compraId),
    onSuccess: () => {
      invalidarCompras();
      setConfirmando(false);
    },
    onError: (err) => setErrorCancel(err.response?.data?.error || 'Error al cancelar la compra'),
  });

  const mutDevolver = useMutation({
    mutationFn: (lineas) => devolverCompraApi(compraId, { lineas, motivo: motivo.trim() || undefined }),
    onSuccess: () => {
      invalidarCompras();
      setModoDevolucion(false);
      setCantidades({});
      setMotivo('');
    },
    onError: (err) => setErrorDevol(err.response?.data?.error || 'Error al registrar la devolución'),
  });

  const mutEditar = useMutation({
    mutationFn: (lineas) => editarPreciosCompraApi(compraId, { lineas, motivo: motivoEditar.trim() || undefined }),
    onSuccess: () => {
      invalidarCompras();
      // El costo del inventario cambió: refrescar vistas de inventario
      // (reportes y valor de inventario se invalidan globalmente al mutar).
      ['productos-serial', 'productos-cantidad', 'seriales'].forEach((key) =>
        queryClient.invalidateQueries({ queryKey: [key], exact: false }));
      setModoEditar(false);
      setPrecios({});
      setMotivoEditar('');
    },
    onError: (err) => setErrorEditar(err.response?.data?.error || 'Error al corregir los precios'),
  });

  const esCancelada = data?.estado === 'Cancelada';
  const esCredito   = ['Credito', 'Fiado'].includes(data?.metodo);

  // ── Edición de precios ──────────────────────────────────────────────────────
  const abrirEdicion = () => {
    const inicial = {};
    (data?.lineas || []).forEach((l) => { inicial[l.id] = Math.round(Number(l.precio_unitario)); });
    setPrecios(inicial);
    setMotivoEditar('');
    setErrorEditar('');
    setModoEditar(true);
  };
  const cerrarEdicion = () => { setModoEditar(false); setPrecios({}); setMotivoEditar(''); setErrorEditar(''); };
  const setPrecioLinea = (id, val) => setPrecios((prev) => ({ ...prev, [id]: val }));

  const preciosCambiados = (data?.lineas || [])
    .map((l) => ({
      linea_id:        l.id,
      precio_unitario: precios[l.id],
      original:        Math.round(Number(l.precio_unitario)),
    }))
    .filter((x) => x.precio_unitario !== '' && x.precio_unitario != null
      && Number(x.precio_unitario) > 0
      && Number(x.precio_unitario) !== x.original)
    .map((x) => ({ linea_id: x.linea_id, precio_unitario: Number(x.precio_unitario) }));

  const totalEditado = (data?.lineas || []).reduce((s, l) => {
    const p = precios[l.id];
    const precio = (p === '' || p == null) ? Number(l.precio_unitario) : Number(p);
    return s + Number(l.cantidad) * precio;
  }, 0);

  const handleConfirmarEdicion = () => {
    setErrorEditar('');
    if (!preciosCambiados.length) return setErrorEditar('Cambia el precio de al menos un producto');
    mutEditar.mutate(preciosCambiados);
  };

  const setCantidadLinea = (id, val) => setCantidades((prev) => ({ ...prev, [id]: val }));

  const lineasSeleccionadas = (data?.lineas || [])
    .map((l) => {
      const cant = l.imei ? (cantidades[l.id] ? 1 : 0) : Number(cantidades[l.id] || 0);
      return { linea_id: l.id, cantidad: cant };
    })
    .filter((x) => x.cantidad > 0);

  const valorDevolucion = (data?.lineas || []).reduce((s, l) => {
    const cant = l.imei ? (cantidades[l.id] ? 1 : 0) : Number(cantidades[l.id] || 0);
    return s + cant * Number(l.precio_unitario);
  }, 0);

  const handleConfirmarDevolucion = () => {
    setErrorDevol('');
    if (!lineasSeleccionadas.length) return setErrorDevol('Selecciona al menos un producto a devolver');
    mutDevolver.mutate(lineasSeleccionadas);
  };

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
              <Badge variant={data?.estado === 'Completada' ? 'green' : data?.estado === 'Pendiente' ? 'yellow' : 'red'}>
                {data?.estado}
              </Badge>
            </div>
            {data?.numero_factura && (
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400 mb-0.5">N° Factura proveedor</p>
                <p className="text-sm font-medium text-gray-800">{data.numero_factura}</p>
              </div>
            )}
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-400 mb-0.5">Registrado por</p>
              <p className="text-sm font-medium text-gray-800">{data?.usuario_nombre || '—'}</p>
            </div>
            {data?.metodo && (
              <div className={`col-span-2 rounded-xl p-3 ${esCredito ? 'bg-amber-50' : 'bg-green-50'}`}>
                <p className={`text-xs mb-1 ${esCredito ? 'text-amber-500' : 'text-green-500'}`}>Forma de pago</p>
                <div className="flex items-center gap-2 flex-wrap">
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
            <p className="text-sm font-semibold text-gray-700">Productos recibidos</p>
            {(data?.lineas || []).length === 0
              ? <p className="text-sm text-gray-400 italic">Sin líneas registradas</p>
              : (data?.lineas || []).map((l) => {
                  const varianteLabel = l.variante_id
                    ? `${l.variante_tipo_nombre ? l.variante_tipo_nombre + ': ' : ''}${l.variante_valor}`
                    : l.atributo_id
                    ? `${l.atributo_tipo_nombre ? l.atributo_tipo_nombre + ': ' : ''}${l.atributo_valor}`
                    : null;
                  return (
                  <div key={l.id} className="bg-gray-50 rounded-xl p-3 flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-800">{l.nombre_producto}</p>
                        {varianteLabel && (
                          <p className="text-xs text-blue-600 font-medium mt-0.5">{varianteLabel}</p>
                        )}
                        {l.imei
                          ? <div className="flex items-center gap-1 mt-0.5"><Hash size={10} className="text-gray-400" /><p className="text-xs text-gray-400 font-mono">{l.imei}</p></div>
                          : <p className="text-xs text-gray-400">Cantidad: {l.cantidad}</p>
                        }
                        {l.precio_usd && (
                          <p className="text-xs text-gray-400 mt-0.5">${l.precio_usd} USD</p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs text-gray-400">{l.cantidad} × {formatCOP(l.precio_unitario)}</p>
                        <p className="text-sm font-semibold text-gray-900">{formatCOP(l.cantidad * l.precio_unitario)}</p>
                      </div>
                    </div>
                    {modoDevolucion && (
                      <div className="flex items-center justify-between gap-2 border-t border-gray-200 pt-2">
                        <span className="text-xs font-medium text-amber-700">Devolver</span>
                        {l.imei ? (
                          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                            <input type="checkbox"
                              checked={!!cantidades[l.id]}
                              onChange={(e) => setCantidadLinea(l.id, e.target.checked ? 1 : 0)}
                              className="rounded accent-amber-600 w-4 h-4" />
                            Este equipo
                          </label>
                        ) : (
                          <input type="number" min="0" max={l.cantidad}
                            value={cantidades[l.id] ?? ''}
                            placeholder="0"
                            onChange={(e) => {
                              const v = e.target.value === '' ? '' : Math.max(0, Math.min(Number(l.cantidad), Number(e.target.value)));
                              setCantidadLinea(l.id, v);
                            }}
                            className="w-24 text-right px-2 py-1 bg-white border border-amber-200 rounded-lg
                              text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                        )}
                      </div>
                    )}
                    {modoEditar && (
                      <div className="flex items-center justify-between gap-2 border-t border-gray-200 pt-2">
                        <span className="text-xs font-medium text-indigo-700">Precio unitario (costo)</span>
                        <InputMoneda
                          value={precios[l.id] ?? ''}
                          onChange={(v) => setPrecioLinea(l.id, v)}
                          className="w-32 text-right px-2 py-1 bg-white border border-indigo-200 rounded-lg
                            text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                      </div>
                    )}
                  </div>
                  );
                })
            }
          </div>

          <div className="flex justify-between items-center bg-blue-50 rounded-xl px-4 py-3">
            <span className="text-sm font-semibold text-gray-700">Total de la compra</span>
            <span className="text-base font-bold text-blue-700">{formatCOP(modoEditar ? totalEditado : data?.total)}</span>
          </div>

          {data?.notas && (
            <div className="bg-gray-50 rounded-xl px-3 py-2">
              <p className="text-xs text-gray-400 mb-0.5">Notas</p>
              <p className="text-xs text-gray-600">{data.notas}</p>
            </div>
          )}

          {/* Confirmación de cancelación */}
          {!esCancelada && confirmando && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex flex-col gap-3">
              <p className="text-sm font-semibold text-red-700">¿Cancelar esta compra?</p>
              <p className="text-xs text-red-600 leading-relaxed">
                Los IMEIs y productos de esta compra se eliminarán del inventario si aún no han sido vendidos o prestados.
                El registro de la compra quedará marcado como <strong>Cancelada</strong>.
              </p>
              {errorCancel && <p className="text-xs text-red-600 font-medium">{errorCancel}</p>}
              <div className="flex gap-2">
                <button
                  onClick={() => { setConfirmando(false); setErrorCancel(''); }}
                  className="flex-1 py-2 rounded-xl text-sm border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                  No, mantener
                </button>
                <button
                  onClick={() => mutCancelar.mutate()}
                  disabled={mutCancelar.isPending}
                  className="flex-1 py-2 rounded-xl text-sm bg-red-500 hover:bg-red-600 text-white font-medium transition-colors disabled:opacity-50">
                  {mutCancelar.isPending ? 'Cancelando…' : 'Sí, cancelar compra'}
                </button>
              </div>
            </div>
          )}

          {/* Panel de devolución */}
          {!esCancelada && modoDevolucion && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col gap-3">
              <p className="text-sm font-semibold text-amber-800">Devolución de mercancía</p>
              <p className="text-xs text-amber-700 leading-relaxed">
                Indica arriba las cantidades a devolver. Se descontarán del inventario y se
                registrará una nota crédito que <strong>reduce la deuda</strong> con el proveedor
                (si ya estaba pagada, queda como saldo a favor). No afecta la caja.
              </p>
              <Input
                label="Motivo (opcional)"
                placeholder="Ej: producto defectuoso, error de pedido…"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-amber-700">Valor a devolver</span>
                <span className="text-sm font-bold text-amber-800">{formatCOP(valorDevolucion)}</span>
              </div>
              {errorDevol && <p className="text-xs text-red-600 font-medium">{errorDevol}</p>}
              <div className="flex gap-2">
                <button
                  onClick={() => { setModoDevolucion(false); setCantidades({}); setMotivo(''); setErrorDevol(''); }}
                  className="flex-1 py-2 rounded-xl text-sm border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                  Cancelar
                </button>
                <button
                  onClick={handleConfirmarDevolucion}
                  disabled={mutDevolver.isPending || lineasSeleccionadas.length === 0}
                  className="flex-1 py-2 rounded-xl text-sm bg-amber-600 hover:bg-amber-700 text-white font-medium transition-colors disabled:opacity-50">
                  {mutDevolver.isPending ? 'Registrando…' : 'Confirmar devolución'}
                </button>
              </div>
            </div>
          )}

          {/* Panel de corrección de precios (solo admin_negocio) */}
          {!esCancelada && modoEditar && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex flex-col gap-3">
              <p className="text-sm font-semibold text-indigo-800">Corregir precios de compra</p>
              <p className="text-xs text-indigo-700 leading-relaxed">
                Ajusta arriba el precio unitario que se registró mal. Se actualizará el
                <strong> costo del inventario</strong> (equipos/productos), el
                <strong> total de la compra</strong> y la <strong>deuda con el proveedor</strong>.
                No mueve la caja ni los abonos ya registrados.
              </p>
              <Input
                label="Motivo (opcional)"
                placeholder="Ej: se digitó mal el precio de costo…"
                value={motivoEditar}
                onChange={(e) => setMotivoEditar(e.target.value)}
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-indigo-700">Nuevo total</span>
                <span className="text-sm font-bold text-indigo-800">{formatCOP(totalEditado)}</span>
              </div>
              {errorEditar && <p className="text-xs text-red-600 font-medium">{errorEditar}</p>}
              <div className="flex gap-2">
                <button
                  onClick={cerrarEdicion}
                  className="flex-1 py-2 rounded-xl text-sm border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                  Cancelar
                </button>
                <button
                  onClick={handleConfirmarEdicion}
                  disabled={mutEditar.isPending || preciosCambiados.length === 0}
                  className="flex-1 py-2 rounded-xl text-sm bg-indigo-600 hover:bg-indigo-700 text-white font-medium transition-colors disabled:opacity-50">
                  {mutEditar.isPending ? 'Guardando…' : 'Guardar precios'}
                </button>
              </div>
            </div>
          )}

          <div className="flex gap-2 flex-wrap">
            {!esCancelada && !confirmando && !modoDevolucion && !modoEditar && (
              <>
                <button
                  onClick={() => { setModoDevolucion(true); setErrorDevol(''); }}
                  className="px-3 py-2 rounded-xl text-sm border border-amber-200 text-amber-700 bg-amber-50
                    hover:bg-amber-100 transition-colors font-medium flex items-center gap-1.5">
                  <Undo2 size={14} /> Devolver mercancía
                </button>
                {esAdmin && (
                  <button
                    onClick={abrirEdicion}
                    className="px-3 py-2 rounded-xl text-sm border border-indigo-200 text-indigo-700 bg-indigo-50
                      hover:bg-indigo-100 transition-colors font-medium flex items-center gap-1.5">
                    <Pencil size={14} /> Corregir precios
                  </button>
                )}
                <button
                  onClick={() => { setConfirmando(true); setErrorCancel(''); }}
                  className="px-3 py-2 rounded-xl text-sm border border-red-200 text-red-600 bg-red-50
                    hover:bg-red-100 transition-colors font-medium">
                  Cancelar compra
                </button>
              </>
            )}
            <Button variant="secondary" className="flex-1" onClick={onClose}>Cerrar</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── estado cfg ──────────────────────────────────────────────────────────────

const ESTADO_CFG = {
  Saldada:  { variant: 'green',  ring: 'border-green-200 bg-green-50/40'  },
  Parcial:  { variant: 'yellow', ring: 'border-amber-200 bg-amber-50/40'  },
  Pendiente:{ variant: 'red',    ring: 'border-red-200   bg-red-50/40'    },
};

// ─── calculadora ─────────────────────────────────────────────────────────────

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

// ─── modal abono rápido ───────────────────────────────────────────────────────

function ModalAbonoRapido({ acreedorId, acreedorNombre, cargo, onClose }) {
  const queryClient   = useQueryClient();
  const metodosPago   = useMetodosPago();
  const [valor,           setValor]           = useState('');
  const [descripcion,     setDescripcion]     = useState('');
  const [mostrarCalc,     setMostrarCalc]     = useState(false);
  const [metodo,          setMetodo]          = useState(() => metodosPago[0]?.id ?? 'Efectivo');
  const [registrarEnCaja, setRegistrarEnCaja] = useState(true);
  const [error,           setError]           = useState('');

  const pendiente    = Number(cargo.saldo_pendiente);
  const tituloCompra = cargo.compra_id
    ? `Compra #${String(cargo.compra_numero ?? cargo.compra_id).padStart(5, '0')}`
    : (cargo.descripcion || 'Cargo');

  const mutation = useMutation({
    mutationFn: () => registrarMovAcreedor(acreedorId, {
      tipo:              'Abono',
      valor:             Number(valor),
      descripcion:       descripcion.trim() || undefined,
      cargo_id:          cargo.id,
      registrar_en_caja: registrarEnCaja,
      metodo,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compras-con-saldo', acreedorId], exact: false });
      queryClient.invalidateQueries({ queryKey: ['acreedores'],                    exact: false });
      queryClient.invalidateQueries({ queryKey: ['abonos-cargo', acreedorId, cargo.id], exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al registrar'),
  });

  return (
    <Modal open onClose={onClose} title={`Abonar — ${tituloCompra}`} size="sm">
      <div className="flex flex-col gap-4">
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <p className="text-xs text-red-400 mb-0.5">Saldo pendiente · {acreedorNombre}</p>
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

// ─── modal nuevo cargo ────────────────────────────────────────────────────────

function ModalNuevoCargo({ acreedorId, acreedorNombre, onClose }) {
  const queryClient   = useQueryClient();
  const [valor,       setValor]       = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [mostrarCalc, setMostrarCalc] = useState(false);
  const [error,       setError]       = useState('');

  const mutation = useMutation({
    mutationFn: () => registrarMovAcreedor(acreedorId, {
      tipo:              'Cargo',
      valor:             Number(valor),
      descripcion:       descripcion.trim() || undefined,
      registrar_en_caja: false,
      metodo:            null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compras-con-saldo', acreedorId], exact: false });
      queryClient.invalidateQueries({ queryKey: ['acreedores'],                    exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al registrar'),
  });

  return (
    <Modal open onClose={onClose} title={`Agregar cargo — ${acreedorNombre}`} size="sm">
      <div className="flex flex-col gap-4">
        <Input
          label="Descripción"
          placeholder="Ej: Deuda por factura #001..."
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') document.getElementById('valor-nuevo-cargo-prov')?.focus();
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
            id="valor-nuevo-cargo-prov"
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

// ─── historial de abonos ──────────────────────────────────────────────────────

function AbonosHistorial({ acreedorId, cargoId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['abonos-cargo', acreedorId, cargoId],
    queryFn:  () => getAbonosPorCargo(acreedorId, cargoId).then((r) => r.data.data),
    staleTime: 0,
  });
  const abonos = Array.isArray(data) ? data : [];

  if (isLoading) return <Spinner className="py-3" />;
  if (abonos.length === 0)
    return <p className="text-xs text-gray-400 italic">Sin abonos registrados aún</p>;

  return (
    <div className="flex flex-col gap-1.5">
      {abonos.map((a) => (
        <div key={a.id}
          className="flex justify-between items-center gap-2 bg-green-50 border border-green-100
            rounded-xl px-3 py-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-700 truncate">{a.descripcion || 'Abono'}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {formatFechaHora(a.fecha)}{a.usuario_nombre && ` · ${a.usuario_nombre}`}
            </p>
          </div>
          <span className="text-sm font-bold text-green-700 flex-shrink-0">
            +{formatCOP(a.valor)}
          </span>
        </div>
      ))}
      <div className="flex justify-between px-1 pt-1 border-t border-gray-100">
        <span className="text-xs text-gray-400">Total abonado</span>
        <span className="text-xs font-bold text-green-700">
          {formatCOP(abonos.reduce((s, a) => s + Number(a.valor), 0))}
        </span>
      </div>
    </div>
  );
}

// ─── cargo activo ─────────────────────────────────────────────────────────────

function CargoActivo({ cargo, acreedorId, onAbonar }) {
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
            <button
              onClick={(e) => { e.stopPropagation(); onAbonar(cargo); }}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-green-600 text-white
                hover:bg-green-700 active:scale-95 transition-all shadow-sm">
              Abonar
            </button>
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
          <AbonosHistorial acreedorId={acreedorId} cargoId={cargo.id} />
        </div>
      )}

      {modalCompra && cargo.compra_id && (
        <ModalDetalleCompra compraId={cargo.compra_id} onClose={() => setModalCompra(false)} />
      )}
    </div>
  );
}

// ─── cargo saldado ────────────────────────────────────────────────────────────

function CargoSaldado({ cargo, acreedorId }) {
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
          <AbonosHistorial acreedorId={acreedorId} cargoId={cargo.id} />
        </div>
      )}

      {modalCompra && cargo.compra_id && (
        <ModalDetalleCompra compraId={cargo.compra_id} onClose={() => setModalCompra(false)} />
      )}
    </div>
  );
}

// ─── sección cuenta corriente ─────────────────────────────────────────────────

function CuentaCorrienteSection({ acreedorId, acreedorNombre }) {
  const [cargoAbono,       setCargoAbono]       = useState(null);
  const [modalCargo,       setModalCargo]       = useState(false);
  const [saldadasAbiertas, setSaldadasAbiertas] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['compras-con-saldo', acreedorId],
    queryFn:  () => getComprasConSaldo(acreedorId).then((r) => r.data.data),
    staleTime: 0,
  });
  const cargos  = Array.isArray(data) ? data : [];
  const activos  = cargos.filter((c) => c.estado_pago !== 'Saldada');
  const saldados = cargos.filter((c) => c.estado_pago === 'Saldada');

  if (isLoading) return <Spinner className="py-10" />;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">
          {activos.length} pendiente(s) · {saldados.length} saldada(s)
        </p>
        <button
          onClick={() => setModalCargo(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold
            border border-gray-200 bg-white text-gray-600
            hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50 transition-all">
          <Plus size={13} /> Agregar cargo
        </button>
      </div>

      {activos.length === 0 ? (
        <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3 text-center">
          <p className="text-green-700 text-sm font-medium">✓ Sin cargos pendientes</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-0.5">
            Pendientes ({activos.length})
          </p>
          {activos.map((c) => (
            <CargoActivo
              key={c.id}
              cargo={c}
              acreedorId={acreedorId}
              onAbonar={(cargo) => setCargoAbono(cargo)}
            />
          ))}
        </div>
      )}

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
                {saldados.length}
              </span>
            </div>
            {saldadasAbiertas
              ? <ChevronUp size={15} className="text-gray-400" />
              : <ChevronDown size={15} className="text-gray-400" />}
          </button>
          {saldadasAbiertas && (
            <div className="flex flex-col gap-2 p-3">
              {saldados.map((c) => (
                <CargoSaldado key={c.id} cargo={c} acreedorId={acreedorId} />
              ))}
            </div>
          )}
        </div>
      )}

      {cargoAbono && (
        <ModalAbonoRapido
          acreedorId={acreedorId}
          acreedorNombre={acreedorNombre}
          cargo={cargoAbono}
          onClose={() => setCargoAbono(null)}
        />
      )}
      {modalCargo && (
        <ModalNuevoCargo
          acreedorId={acreedorId}
          acreedorNombre={acreedorNombre}
          onClose={() => setModalCargo(false)}
        />
      )}
    </div>
  );
}

// ─── Vista historial proveedor ─────────────────────────────────────────────────

function HistorialProveedor({ proveedor, sucursalKey, sucursalLista, onVolver, onNuevaCompra }) {
  const [compraDetalle, setCompraDetalle] = useState(null);
  const [tabVista,      setTabVista]      = useState('compras');

  const [filtroEstado,    setFiltroEstado]    = useState('Todas');
  const [filtroPago,      setFiltroPago]      = useState('Todos');
  const [fechaDesde,      setFechaDesde]      = useState('');
  const [fechaHasta,      setFechaHasta]      = useState('');
  const [busquedaFactura, setBusquedaFactura] = useState('');

  const { data: comprasData, isLoading } = useQuery({
    queryKey: ['compras-proveedor', proveedor.id, ...sucursalKey],
    queryFn:  () => getComprasByProveedor(proveedor.id).then((r) => r.data.data),
    enabled:  sucursalLista,
  });

  const { data: acreedoresRaw } = useQuery({
    queryKey: ['acreedores'],
    queryFn:  () => getAcreedores().then((r) => r.data.data),
    staleTime: 60_000,
  });
  const acreedoresAll = Array.isArray(acreedoresRaw) ? acreedoresRaw : [];
  const acreedorInfo  = acreedoresAll.find((a) => a.proveedor_id === proveedor.id) || null;
  const saldoAcreedor = acreedorInfo ? Number(acreedorInfo.saldo || 0) : 0;

  const compras       = comprasData || [];
  const totalComprado = compras.reduce((s, c) => s + Number(c.total || 0), 0);

  const comprasFiltradas = compras.filter((c) => {
    if (filtroEstado !== 'Todas' && c.estado !== filtroEstado) return false;
    const esCredito = ['Credito', 'Fiado'].includes(c.metodo);
    if (filtroPago === 'Crédito' && !esCredito) return false;
    if (filtroPago === 'Contado' && esCredito) return false;
    const fechaStr = c.fecha ? c.fecha.slice(0, 10) : '';
    if (fechaDesde && fechaStr < fechaDesde) return false;
    if (fechaHasta && fechaStr > fechaHasta) return false;
    if (busquedaFactura) {
      const q = busquedaFactura.toLowerCase();
      if (!c.numero_factura?.toLowerCase().includes(q) && !String(c.id).includes(q)
          && !String(c.numero ?? '').includes(q)) return false;
    }
    return true;
  });

  const totalFiltrado = comprasFiltradas.reduce((s, c) => s + Number(c.total || 0), 0);
  const hayFiltrosActivos = filtroEstado !== 'Todas' || filtroPago !== 'Todos' || fechaDesde || fechaHasta || busquedaFactura;

  return (
    <div className="flex flex-col gap-4">

      {/* Cabecera */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={onVolver}
          className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0">
          <ChevronLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-bold text-gray-900 truncate">{proveedor.nombre}</h2>
            <ProveedorTipoBadge tipo={proveedor.tipo} />
          </div>
          <p className="text-xs text-gray-400">
            {[proveedor.nit && `NIT: ${proveedor.nit}`, proveedor.telefono].filter(Boolean).join(' · ')}
          </p>
        </div>
        <Button size="sm" onClick={onNuevaCompra} className="flex-shrink-0">
          <ShoppingCart size={14} />
          <span className="hidden sm:inline">Nueva compra</span>
        </Button>
      </div>

      {/* Tarjetas resumen */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-blue-50 rounded-xl p-3">
          <p className="text-xs text-blue-400 mb-0.5">Total comprado</p>
          <p className="text-base font-bold text-blue-700">{formatCOP(totalComprado)}</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-xs text-gray-400 mb-0.5">N° compras</p>
          <p className="text-base font-bold text-gray-800">{compras.length}</p>
        </div>
        {acreedorInfo && (
          <div className={`col-span-2 rounded-xl p-3
            ${saldoAcreedor > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
            <p className={`text-xs mb-0.5 ${saldoAcreedor > 0 ? 'text-red-400' : 'text-green-500'}`}>
              Deuda pendiente con este proveedor
            </p>
            <p className={`text-base font-bold ${saldoAcreedor > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {saldoAcreedor > 0 ? formatCOP(saldoAcreedor) : 'Sin deuda — al día'}
            </p>
          </div>
        )}
      </div>

      {/* Selector de vista */}
      {acreedorInfo && (
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
          {[
            { id: 'compras', label: 'Compras'          },
            { id: 'cuenta',  label: 'Cuenta corriente' },
          ].map((t) => (
            <button key={t.id} onClick={() => setTabVista(t.id)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-150
                ${tabVista === t.id
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'}`}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Pestaña: Compras ── */}
      {tabVista === 'compras' && (
        <>
          <div className="flex flex-col gap-2">
            <SearchInput value={busquedaFactura} onChange={setBusquedaFactura}
              placeholder="Buscar por N° factura o ID…" />
            <div className="flex gap-1.5 items-center">
              <input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)}
                className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400" />
              <span className="text-gray-300 text-xs flex-shrink-0">—</span>
              <input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)}
                className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400" />
              {(fechaDesde || fechaHasta) && (
                <button onClick={() => { setFechaDesde(''); setFechaHasta(''); }}
                  className="text-xs text-gray-400 hover:text-red-500 px-1 flex-shrink-0 transition-colors">✕</button>
              )}
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {['Todas', 'Completada', 'Pendiente', 'Cancelada'].map((e) => (
                <button key={e} onClick={() => setFiltroEstado(e)}
                  className={`px-2.5 py-1 text-xs rounded-lg border font-medium transition-all
                    ${filtroEstado === e
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                  {e}
                </button>
              ))}
              <span className="text-gray-200 self-center">|</span>
              {['Todos', 'Crédito', 'Contado'].map((p) => (
                <button key={p} onClick={() => setFiltroPago(p)}
                  className={`px-2.5 py-1 text-xs rounded-lg border font-medium transition-all
                    ${filtroPago === p
                      ? 'bg-amber-50 border-amber-300 text-amber-700'
                      : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? <Spinner className="py-20" /> : comprasFiltradas.length === 0 ? (
            <EmptyState icon={ShoppingCart} titulo="Sin compras"
              descripcion={compras.length === 0
                ? 'Aún no hay compras registradas a este proveedor'
                : 'Ninguna compra coincide con los filtros aplicados'} />
          ) : (
            <div className="flex flex-col gap-2">
              <div className={`flex items-center justify-between rounded-xl px-3 py-2.5 select-none
                ${hayFiltrosActivos ? 'bg-blue-50 border border-blue-100' : 'bg-gray-50'}`}>
                <p className="text-xs text-gray-400">
                  {comprasFiltradas.length} compra(s)
                  {hayFiltrosActivos && <span className="text-blue-400 ml-1">· con filtros</span>}
                  <span className="hidden sm:inline text-gray-300"> · Doble click para ver detalle</span>
                </p>
                <div className="flex flex-col items-end">
                  {hayFiltrosActivos && (
                    <p className="text-[10px] text-gray-400 leading-none mb-0.5">Total filtrado</p>
                  )}
                  <p className={`text-sm font-bold ${hayFiltrosActivos ? 'text-blue-700' : 'text-gray-700'}`}>
                    {formatCOP(totalFiltrado)}
                  </p>
                </div>
              </div>
              {comprasFiltradas.map((c) => {
                const esCredito = ['Credito', 'Fiado'].includes(c.metodo);
                return (
                  <div key={c.id}
                    onDoubleClick={() => setCompraDetalle(c.id)}
                    className="bg-white border border-gray-100 rounded-xl p-3 flex items-center
                      justify-between hover:border-gray-200 hover:bg-gray-50/50 transition-all
                      cursor-default select-none">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-gray-800">
                          #{String(c.numero ?? c.id).padStart(5, '0')}
                        </span>
                        <Badge variant={c.estado === 'Completada' ? 'green' : c.estado === 'Pendiente' ? 'yellow' : 'red'}>
                          {c.estado}
                        </Badge>
                        {c.metodo && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium border
                            ${esCredito
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-green-50 text-green-700 border-green-200'}`}>
                            {esCredito ? 'Crédito' : c.metodo}
                          </span>
                        )}
                      </div>
                      {c.numero_factura && (
                        <p className="text-xs text-gray-400 mt-0.5">Factura: {c.numero_factura}</p>
                      )}
                      <p className="text-xs text-gray-400">{formatFechaHora(c.fecha)}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-sm font-bold text-gray-900">{formatCOP(c.total)}</span>
                      <button onClick={() => setCompraDetalle(c.id)}
                        className="p-1.5 rounded-lg hover:bg-blue-100 text-gray-300 hover:text-blue-600 transition-colors"
                        title="Ver detalle">
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {compraDetalle && (
            <ModalDetalleCompra compraId={compraDetalle} onClose={() => setCompraDetalle(null)} />
          )}
        </>
      )}

      {/* ── Pestaña: Cuenta corriente ── */}
      {tabVista === 'cuenta' && acreedorInfo && (
        <CuentaCorrienteSection
          acreedorId={acreedorInfo.id}
          acreedorNombre={proveedor.nombre}
        />
      )}
    </div>
  );
}

// ─── Modal proveedor (crear/editar) ────────────────────────────────────────────
// tipoForzado: si se pasa, el campo tipo se fija y no se puede cambiar
// (ej: desde el tab Cruces se fuerza 'cruce')

function ModalProveedor({ proveedor, tipoForzado, onClose }) {
  const queryClient = useQueryClient();
  const tipoInicial = tipoForzado || proveedor?.tipo || 'proveedor';

  const [form, setForm] = useState({
    nombre:    proveedor?.nombre    || '',
    nit:       proveedor?.nit       || '',
    telefono:  proveedor?.telefono  || '',
    email:     proveedor?.email     || '',
    contacto:  proveedor?.contacto  || '',
    direccion: proveedor?.direccion || '',
    tipo:      tipoInicial,
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => proveedor
      ? actualizarProveedor(proveedor.id, form)
      : crearProveedor(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proveedores'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['cruces'],      exact: false });
      onClose();
    },
    onError: (e) => setError(e.response?.data?.error || e.response?.data?.message || 'Error'),
  });

  const handleKeyDown = (e, sig) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (sig) document.getElementById(sig)?.focus();
      else mutation.mutate();
    }
  };

  const puedeEditarTipo = !tipoForzado;

  return (
    <Modal open onClose={onClose} title={proveedor ? 'Editar Proveedor' : tipoForzado === 'cruce' ? 'Nuevo Cruce' : 'Nuevo Proveedor'} size="md">
      <div className="flex flex-col gap-3">
        <Input id="prov-nombre"   label="Nombre *"  value={form.nombre}   onChange={(e) => setForm({ ...form, nombre:   e.target.value })} onKeyDown={(e) => handleKeyDown(e, 'prov-nit')} />
        <Input id="prov-nit"      label="NIT"        value={form.nit}      onChange={(e) => setForm({ ...form, nit:      e.target.value })} onKeyDown={(e) => handleKeyDown(e, 'prov-tel')} />
        <Input id="prov-tel"      label="Teléfono"   value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} onKeyDown={(e) => handleKeyDown(e, 'prov-email')} />
        <Input id="prov-email"    label="Email"       value={form.email}    onChange={(e) => setForm({ ...form, email:    e.target.value })} onKeyDown={(e) => handleKeyDown(e, 'prov-contacto')} />
        <Input id="prov-contacto" label="Contacto"    value={form.contacto} onChange={(e) => setForm({ ...form, contacto: e.target.value })} onKeyDown={(e) => handleKeyDown(e, null)} />

        {/* Selector de tipo: solo editable si no está forzado */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Tipo</label>
          {puedeEditarTipo ? (
            <div className="flex gap-2">
              {OPCIONES_TIPO.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setForm({ ...form, tipo: opt.value })}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-all
                    ${form.tipo === opt.value
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-gray-300'}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="py-2 px-3 bg-gray-50 rounded-xl text-sm text-gray-600 border border-gray-200">
              {tipoForzado === 'cruce' ? 'Cruce' : 'Proveedor'}
            </div>
          )}
          {form.tipo === 'cruce' && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 leading-relaxed">
              Un cruce es un intercambio o compra a crédito con otra empresa. Las deudas se registran en Cuenta corriente y no afectan la caja directamente.
            </p>
          )}
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2 mt-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            {proveedor ? 'Guardar' : 'Crear'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Tab Proveedores (tipo = proveedor) ────────────────────────────────────────

function TabProveedores({ sucursalKey, sucursalLista }) {
  const { usuario }         = useAuth();
  const puedeCrearProveedor = usuario?.rol === 'admin_negocio' || !!usuario?.permisos_proveedores?.crear;

  const [busqueda,        setBusqueda]        = useState('');
  const [modalProveedor,  setModalProveedor]  = useState(false);
  const [proveedorEditar, setProveedorEditar] = useState(null);
  const [proveedorVer,    setProveedorVer]    = useState(null);
  const [modalCompra,     setModalCompra]     = useState(null);

  const { data: proveedoresData, isLoading } = useQuery({
    queryKey: ['proveedores'],
    queryFn:  () => getProveedores().then((r) => r.data.data),
  });

  const { data: acreedoresRaw } = useQuery({
    queryKey:  ['acreedores'],
    queryFn:   () => getAcreedores('').then((r) => r.data.data),
    staleTime: 60_000,
  });
  const acreedoresAll = Array.isArray(acreedoresRaw) ? acreedoresRaw : [];

  const proveedores = (proveedoresData || []).filter((p) =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  if (proveedorVer) {
    return (
      <>
        <HistorialProveedor
          proveedor={proveedorVer}
          sucursalKey={sucursalKey}
          sucursalLista={sucursalLista}
          onVolver={() => setProveedorVer(null)}
          onNuevaCompra={() => setModalCompra(proveedorVer)}
        />
        {modalCompra && <ModalCompra proveedor={modalCompra} onClose={() => setModalCompra(null)} />}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">{proveedores.length} proveedor(es)</p>
        {puedeCrearProveedor && (
          <Button size="sm" onClick={() => setModalProveedor(true)}><Plus size={16} /> Nuevo</Button>
        )}
      </div>
      <SearchInput value={busqueda} onChange={setBusqueda} placeholder="Buscar proveedor..." />
      {isLoading ? <Spinner className="py-20" /> : proveedores.length === 0 ? (
        <EmptyState icon={Truck} titulo="Sin proveedores" />
      ) : (
        proveedores.map((p) => {
          const acreedorVinculado = acreedoresAll.find((a) => a.proveedor_id === p.id);
          const saldo = acreedorVinculado ? Number(acreedorVinculado.saldo || 0) : 0;
          return (
            <div key={p.id} className="bg-white border border-gray-100 rounded-2xl p-4 flex items-center justify-between gap-3">
              <button onClick={() => setProveedorVer(p)} className="flex-1 text-left min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-900 truncate">{p.nombre}</p>
                  <ProveedorTipoBadge tipo={p.tipo} />
                  {saldo > 0 && (
                    <span className="text-xs text-red-600 font-semibold bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                      Debe {formatCOP(saldo)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  {p.nit      && <span className="text-xs text-gray-400">NIT: {p.nit}</span>}
                  {p.telefono && <span className="text-xs text-gray-400">Tel: {p.telefono}</span>}
                  {p.contacto && <span className="text-xs text-gray-400">{p.contacto}</span>}
                </div>
              </button>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button size="sm" onClick={() => setModalCompra(p)}>
                  <ShoppingCart size={14} />
                  <span className="hidden sm:inline">Compra</span>
                </Button>
                <button onClick={() => setProveedorEditar(p)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                  <Package size={16} />
                </button>
              </div>
            </div>
          );
        })
      )}
      {modalProveedor  && <ModalProveedor onClose={() => setModalProveedor(false)} />}
      {proveedorEditar && <ModalProveedor proveedor={proveedorEditar} onClose={() => setProveedorEditar(null)} />}
      {modalCompra     && <ModalCompra proveedor={modalCompra} onClose={() => setModalCompra(null)} />}
    </div>
  );
}

// ─── Tab: Compras (historial paginado) ───────────────────────────────────────

const METODOS_PAGO = ['Contado', 'Transferencia', 'Crédito', 'Fiado'];
const ESTADOS_COMPRA = ['Completada', 'Pendiente', 'Anulada'];
const LIMIT = 20;

function TabCompras() {
  const [busqueda,   setBusqueda]   = useState('');
  const [inputText,  setInputText]  = useState('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [metodo,     setMetodo]     = useState('');
  const [estado,     setEstado]     = useState('');
  const [page,       setPage]       = useState(1);
  const [compraDetalle, setCompraDetalle] = useState(null);

  const queryKey = ['compras-paginadas', page, busqueda, fechaDesde, fechaHasta, metodo, estado];

  const { data, isLoading, isFetching } = useQuery({
    queryKey,
    queryFn: () => getComprasPaginadas({
      page, limit: LIMIT,
      busqueda:   busqueda   || undefined,
      fechaDesde: fechaDesde || undefined,
      fechaHasta: fechaHasta || undefined,
      metodo:     metodo     || undefined,
      estado:     estado     || undefined,
    }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const compras    = data?.rows       || [];
  const total      = data?.total      || 0;
  const totalPages = data?.totalPages || 1;
  const cargando   = isLoading || isFetching;

  const aplicarFiltros = () => {
    setPage(1);
    setBusqueda(inputText.trim());
  };

  const limpiarFiltros = () => {
    setPage(1);
    setBusqueda('');
    setInputText('');
    setFechaDesde('');
    setFechaHasta('');
    setMetodo('');
    setEstado('');
  };

  const hayFiltros = busqueda || fechaDesde || fechaHasta || metodo || estado;

  const totalStr = total === 1 ? '1 compra' : `${total} compras`;

  return (
    <div className="flex flex-col gap-4">

      {/* ── Filtros ── */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-col gap-3">
        {/* Búsqueda por texto */}
        <form onSubmit={(e) => { e.preventDefault(); aplicarFiltros(); }} className="flex gap-2">
          <div className="flex-1">
            <SearchInput
              value={inputText}
              onChange={setInputText}
              placeholder="Buscar por proveedor o N° factura…"
            />
          </div>
          <Button type="submit" size="sm">
            <Search size={15} /> Buscar
          </Button>
        </form>

        {/* Fechas y selects */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Desde</label>
            <input
              type="date"
              value={fechaDesde}
              onChange={(e) => { setFechaDesde(e.target.value); setPage(1); }}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Hasta</label>
            <input
              type="date"
              value={fechaHasta}
              onChange={(e) => { setFechaHasta(e.target.value); setPage(1); }}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Método de pago</label>
            <select
              value={metodo}
              onChange={(e) => { setMetodo(e.target.value); setPage(1); }}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">Todos</option>
              {METODOS_PAGO.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Estado</label>
            <select
              value={estado}
              onChange={(e) => { setEstado(e.target.value); setPage(1); }}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">Todos</option>
              {ESTADOS_COMPRA.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* Resumen filtros activos */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm text-gray-500">
            {cargando ? 'Cargando…' : totalStr}
          </p>
          {hayFiltros && (
            <button
              onClick={limpiarFiltros}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      </div>

      {/* ── Lista ── */}
      {cargando && compras.length === 0 ? (
        <Spinner className="py-20" />
      ) : compras.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          titulo="Sin compras"
          descripcion={hayFiltros ? 'No hay compras que coincidan con los filtros aplicados.' : 'Aún no se han registrado compras.'}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {compras.map((c) => {
            const estadoVariant = c.estado === 'Completada' ? 'green' : c.estado === 'Pendiente' ? 'yellow' : 'red';
            return (
              <button
                key={c.id}
                onClick={() => setCompraDetalle(c.id)}
                className="bg-white border border-gray-100 rounded-2xl p-4 flex items-start justify-between gap-3
                  hover:border-blue-200 hover:bg-blue-50 transition-all text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <ProveedorTipoBadge tipo={c.proveedor_tipo} />
                    <Badge variant={estadoVariant}>{c.estado || 'Completada'}</Badge>
                    {c.metodo && (
                      <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                        {c.metodo}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Truck size={12} className="text-gray-400 flex-shrink-0" />
                    <p className="text-sm font-semibold text-gray-900 truncate">{c.proveedor_nombre}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    {c.numero_factura && (
                      <span className="text-xs text-gray-500">Fact. {c.numero_factura}</span>
                    )}
                    <span className="text-xs text-gray-400">{formatFechaHora(c.fecha)}</span>
                    <span className="text-xs text-gray-400">{c.sucursal_nombre}</span>
                    {c.num_lineas > 0 && (
                      <span className="text-xs text-gray-400">{c.num_lineas} producto(s)</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-sm font-bold text-emerald-700">{formatCOP(c.total)}</span>
                  <ChevronRight size={14} className="text-gray-400" />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Paginación ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-white border border-gray-100 rounded-2xl px-4 py-3">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || cargando}
            className="flex items-center gap-1 text-sm text-gray-600 disabled:opacity-40 hover:text-blue-600 transition-colors"
          >
            <ChevronLeft size={16} /> Anterior
          </button>
          <span className="text-sm text-gray-500">
            Página {page} de {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages || cargando}
            className="flex items-center gap-1 text-sm text-gray-600 disabled:opacity-40 hover:text-blue-600 transition-colors"
          >
            Siguiente <ChevronRight size={16} />
          </button>
        </div>
      )}

      {compraDetalle && (
        <ModalDetalleCompra compraId={compraDetalle} onClose={() => setCompraDetalle(null)} />
      )}
    </div>
  );
}

// ─── Tab: Búsqueda de compras ─────────────────────────────────────────────────

const MODOS_BUSQUEDA = [
  { key: 'imei',   label: 'IMEI / Serial',       Icon: ScanLine, placeholder: 'Escribe parte del IMEI para ver compras candidatas…' },
  { key: 'nombre', label: 'Nombre / Proveedor',   Icon: Search,   placeholder: 'Nombre, proveedor o N° de factura…'     },
];

function TabBusquedaCompras() {
  const [modo,          setModo]          = useState('imei');
  const [input,         setInput]         = useState('');
  const [busqueda,      setBusqueda]      = useState('');
  const [compraDetalle, setCompraDetalle] = useState(null);

  const modoActual = MODOS_BUSQUEDA.find((m) => m.key === modo);

  const handleCambiarModo = (nuevoModo) => {
    setModo(nuevoModo);
    setInput('');
    setBusqueda('');
  };

  const handleBuscar = () => {
    if (input.trim().length >= 2) setBusqueda(input.trim());
  };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['busqueda-compras', modo, busqueda],
    queryFn:  () => buscarComprasApi(busqueda, modo).then((r) => r.data.data),
    enabled:  busqueda.length >= 2,
    staleTime: 30 * 1000,
  });

  const lineas  = data?.lineas  || [];
  const retomas = data?.retomas || [];
  const cargando = isLoading || isFetching;

  return (
    <div className="flex flex-col gap-4">

      {/* Selector de modo */}
      <div className="flex gap-2 flex-wrap">
        {MODOS_BUSQUEDA.map((m) => {
          const ModoIcon = m.Icon;
          return (
            <button key={m.key} type="button" onClick={() => handleCambiarModo(m.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium
                transition-all border
                ${modo === m.key
                  ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:text-gray-700'}`}>
              <ModoIcon size={14} />
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Buscador */}
      <form
        onSubmit={(e) => { e.preventDefault(); handleBuscar(); }}
        className="flex gap-2"
      >
        <div className="flex-1">
          <SearchInput
            value={input}
            onChange={setInput}
            placeholder={modoActual.placeholder}
          />
        </div>
        <Button type="submit" disabled={input.trim().length < 2}>
          <Search size={15} /> Buscar
        </Button>
      </form>

      {/* Estado vacío inicial */}
      {!busqueda && (
        <p className="text-sm text-gray-400 text-center py-10">
          {modo === 'imei'
            ? 'Escribe parte del IMEI (mínimo 2 dígitos) para ver las compras candidatas'
            : 'Busca por nombre de producto, proveedor o número de factura de compra'}
        </p>
      )}

      {busqueda && cargando && <Spinner className="py-10" />}

      {busqueda && !cargando && lineas.length === 0 && retomas.length === 0 && (
        <EmptyState
          icon={Search}
          titulo="Sin resultados"
          descripcion={`No se encontraron compras para "${busqueda}"`}
        />
      )}

      {/* Retomas encontradas (solo aparece en modo IMEI) */}
      {retomas.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide">
            Retomada en facturas ({retomas.length})
          </p>
          {retomas.map((r) => (
            <div key={r.id} className="bg-purple-50 border border-purple-100 rounded-xl p-3 flex items-start gap-3">
              <TipoBadge tipo="retoma" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{r.nombre_producto || r.descripcion || '—'}</p>
                <p className="text-xs text-gray-600 mt-0.5">{r.nombre_cliente}</p>
                <p className="text-xs text-gray-400">{formatFechaHora(r.fecha)} · {r.sucursal_nombre}</p>
              </div>
              {r.valor_retoma && Number(r.valor_retoma) > 0 && (
                <span className="text-sm font-bold text-purple-700 flex-shrink-0">
                  {formatCOP(r.valor_retoma)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lineas de compra encontradas */}
      {lineas.length > 0 && (
        <div className="flex flex-col gap-2">
          {retomas.length > 0 && (
            <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
              Compras a proveedores ({lineas.length})
            </p>
          )}
          {lineas.map((l, i) => (
            <button
              key={`${l.linea_id}-${i}`}
              onClick={() => setCompraDetalle(l.compra_id)}
              className="bg-white border border-gray-100 rounded-2xl p-3 flex items-start
                justify-between gap-3 hover:border-blue-200 hover:bg-blue-50 transition-all text-left"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <ProveedorTipoBadge tipo={l.proveedor_tipo} />
                  <Badge
                    variant={l.estado === 'Completada' ? 'green' : l.estado === 'Pendiente' ? 'yellow' : 'red'}
                  >
                    {l.estado}
                  </Badge>
                </div>
                <p className="text-sm font-semibold text-gray-900 truncate">{l.nombre_producto}</p>
                {l.imei ? (
                  <div className="flex items-center gap-1 mt-0.5">
                    <Hash size={10} className="text-gray-400" />
                    <span className="text-xs text-gray-400 font-mono">{l.imei}</span>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 mt-0.5">Cantidad: {l.cantidad}</p>
                )}
                <div className="flex items-center gap-2 flex-wrap mt-0.5">
                  <Truck size={11} className="text-gray-400" />
                  <span className="text-xs text-gray-700 font-medium">{l.proveedor_nombre}</span>
                  {l.numero_factura && (
                    <span className="text-xs text-gray-400">· Fact. {l.numero_factura}</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {formatFechaHora(l.fecha)} · {l.sucursal_nombre}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {l.precio_unitario && Number(l.precio_unitario) > 0 && (
                  <span className="text-sm font-bold text-emerald-700">
                    {formatCOP(l.precio_unitario)}
                  </span>
                )}
                <ChevronRight size={14} className="text-gray-400" />
              </div>
            </button>
          ))}
        </div>
      )}

      {compraDetalle && (
        <ModalDetalleCompra compraId={compraDetalle} onClose={() => setCompraDetalle(null)} />
      )}
    </div>
  );
}

// ─── Página principal ────────────────────────────────────────────────────────

export default function ProveedoresPage() {
  const { sucursalKey, sucursalLista } = useSucursalKey();
  const { esAdminNegocio, usuario } = useAuth();
  const esAdmin = esAdminNegocio();
  const [tabActivo, setTabActivo] = useState('proveedores');

  const verCompras = esAdmin || usuario?.permisos_proveedores?.ver_compras === true;

  const tabs = [
    { id: 'proveedores', label: 'Proveedores', Icn: Truck        },
    { id: 'retomas',     label: 'Retomas',     Icn: RefreshCw    },
    ...(verCompras ? [{ id: 'compras', label: 'Compras', Icn: ShoppingCart }] : []),
    { id: 'busqueda',    label: 'Búsqueda',    Icn: Search       },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Proveedores</h1>
        <p className="text-sm text-gray-400 mt-0.5">Gestiona tus proveedores, cruces y retomas de clientes</p>
      </div>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
        {tabs.map((tab) => {
          const TabIcon = tab.Icn;
          return (
            <button key={tab.id} onClick={() => setTabActivo(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 sm:px-3 rounded-lg
                text-sm font-medium transition-all
                ${tabActivo === tab.id
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'}`}>
              <TabIcon size={15} />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {tabActivo === 'proveedores' && (
        <TabProveedores sucursalKey={sucursalKey} sucursalLista={sucursalLista} />
      )}
      {tabActivo === 'retomas'    && <TabRetomas />}
      {tabActivo === 'compras'    && <TabCompras />}
      {tabActivo === 'busqueda'   && <TabBusquedaCompras />}
    </div>
  );
}