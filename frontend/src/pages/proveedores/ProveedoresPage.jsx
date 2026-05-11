import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { buscarCompras as buscarComprasApi } from '../../api/busqueda.api';
import { getProveedores, crearProveedor, actualizarProveedor } from '../../api/proveedores.api';
import { getCruces, crearCruce } from '../../api/cruces.api';
import { getComprasByProveedor, getCompraById } from '../../api/compras.api';
import { getAcreedores, getAcreedorById, getCargosAbiertos, registrarMovimiento as registrarMovAcreedor } from '../../api/acreedores.api';
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
import {
  Truck, Plus, ShoppingCart, ChevronRight, ChevronLeft,
  Package, Hash, User, RefreshCw, ArrowLeftRight, ShoppingBag, Repeat,
  Search, ScanLine, Wallet, PenLine,
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
              <span className="font-mono text-gray-700">#{String(item.factura_id).padStart(6, '0')}</span>
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
  const [busqueda,    setBusqueda]    = useState('');
  const [itemDetalle, setItemDetalle] = useState(null);
  const [tabFuente,   setTabFuente]   = useState('todas');

  const { data: dataSerial, isLoading: loadingSerial } = useQuery({
    queryKey: ['compras-cliente-serial', busqueda],
    queryFn:  () => getComprasClienteSerial(busqueda),
  });

  const { data: dataCantidad, isLoading: loadingCantidad } = useQuery({
    queryKey: ['historial-stock-cantidad', busqueda],
    queryFn:  () => getHistorialStockCantidad(busqueda),
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

  const historialCliente = (item) => {
    if (!item) return [];
    if (item.fuente === 'serial') {
      return todasSerial.filter((i) =>
        (i.nombre_cliente || '').toLowerCase() === (item.nombre_cliente || '').toLowerCase()
      );
    }
    return todasCantidad.filter((i) =>
      i.cliente_origen &&
      (i.cliente_origen || '').toLowerCase() === (item.cliente_origen || '').toLowerCase()
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
          <button key={t.id} onClick={() => setTabFuente(t.id)}
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
          descripcion={busqueda ? `Sin resultados para "${busqueda}"` : 'Aún no hay retomas ni compras a clientes'}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {lista.map((item, i) => {
            const esSerial = item.fuente === 'serial';
            const nombreMostrar = esSerial
              ? (item.nombre_cliente || '—')
              : (item.cliente_origen || item.proveedor_nombre || '—');
            const cedulaMostrar = esSerial ? item.cedula_cliente : item.cedula_cliente;

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
              : (data?.lineas || []).map((l) => (
                  <div key={l.id} className="bg-gray-50 rounded-xl p-3 flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-800">{l.nombre_producto}</p>
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
                ))
            }
          </div>

          <div className="flex justify-between items-center bg-blue-50 rounded-xl px-4 py-3">
            <span className="text-sm font-semibold text-gray-700">Total de la compra</span>
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

// ─── Modal movimiento acreedor (desde proveedores) ────────────────────────────

function ModalMovimientoProveedor({ acreedorId, nombreProveedor, onClose }) {
  const queryClient = useQueryClient();
  const [form,       setForm]       = useState({ tipo: 'Abono', descripcion: '', valor: '' });
  const [cargoId,    setCargoId]    = useState(null);
  const [error,      setError]      = useState('');
  const metodosPago                 = useMetodosPago();
  const [metodoPago, setMetodoPago] = useState('Efectivo');

  const esAbono = form.tipo === 'Abono';

  const { data: cargosRaw, isLoading: loadingCargos } = useQuery({
    queryKey:  ['cargos-abiertos', acreedorId],
    queryFn:   () => getCargosAbiertos(acreedorId).then((r) => r.data.data),
    enabled:   esAbono,
    staleTime: 0,
  });
  const cargosAbiertos = Array.isArray(cargosRaw) ? cargosRaw : [];

  const mutation = useMutation({
    mutationFn: () => registrarMovAcreedor(acreedorId, {
      tipo:              form.tipo,
      descripcion:       form.descripcion,
      valor:             Number(form.valor),
      registrar_en_caja: esAbono,
      metodo:            metodoPago,
      cargo_id:          esAbono ? cargoId : null,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['acreedor',        acreedorId], exact: false });
      await queryClient.invalidateQueries({ queryKey: ['cargos-abiertos', acreedorId], exact: false });
      await queryClient.invalidateQueries({ queryKey: ['acreedores'],                  exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al registrar'),
  });

  return (
    <Modal open onClose={onClose} title={`Movimiento — ${nombreProveedor}`} size="sm">
      <div className="flex flex-col gap-4">

        <div className="flex gap-2">
          {['Abono', 'Cargo'].map((t) => (
            <button key={t} type="button"
              onClick={() => { setForm({ ...form, tipo: t }); setCargoId(null); }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all
                ${form.tipo === t
                  ? t === 'Cargo'
                    ? 'bg-red-50 border-red-300 text-red-700'
                    : 'bg-green-50 border-green-300 text-green-700'
                  : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
              {t === 'Abono' ? 'Abono (pago)' : 'Cargo (nueva deuda)'}
            </button>
          ))}
        </div>

        <Input label="Descripción" placeholder="Ej: Pago factura mayo"
          value={form.descripcion}
          onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Valor</label>
          <InputMoneda value={form.valor} onChange={(val) => setForm({ ...form, valor: val })}
            placeholder="0"
            className="w-full px-3 py-2 bg-gray-100 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all" />
        </div>

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
                  const sel = cargoId === c.id;
                  return (
                    <button key={c.id} type="button"
                      onClick={() => setCargoId(sel ? null : c.id)}
                      className={`flex items-start justify-between gap-3 text-left px-3 py-2.5 rounded-xl border transition-all
                        ${sel ? 'bg-green-50 border-green-300' : 'bg-gray-50 border-gray-200 hover:border-gray-300'}`}>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-medium truncate ${sel ? 'text-green-800' : 'text-gray-700'}`}>
                          {c.descripcion || 'Sin descripción'}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">{formatFechaHora(c.fecha)}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs text-gray-400 line-through">{formatCOP(c.valor_original)}</p>
                        <p className={`text-xs font-bold ${sel ? 'text-green-700' : 'text-red-500'}`}>
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

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Método de pago</label>
          <div className="flex gap-2 flex-wrap">
            {metodosPago.map((m) => (
              <button key={m.id} type="button" onClick={() => setMetodoPago(m.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all
                  ${metodoPago === m.id
                    ? 'bg-blue-50 border-blue-300 text-blue-700'
                    : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {esAbono && (
          <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
            El abono se registrará en caja como egreso automáticamente.
          </p>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mutation.isPending}
            disabled={!form.valor || Number(form.valor) <= 0}
            onClick={() => mutation.mutate()}>
            Registrar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Vista historial proveedor ─────────────────────────────────────────────────

function HistorialProveedor({ proveedor, sucursalKey, sucursalLista, onVolver, onNuevaCompra }) {
  const queryClient                     = useQueryClient();
  const [compraDetalle, setCompraDetalle] = useState(null);
  const [tabVista,      setTabVista]      = useState('compras');
  const [modalMov,      setModalMov]      = useState(false);

  // ── Filtros compras ────────────────────────────────────────────────────────
  const [filtroEstado,    setFiltroEstado]    = useState('Todas');
  const [filtroPago,      setFiltroPago]      = useState('Todos');
  const [fechaDesde,      setFechaDesde]      = useState('');
  const [fechaHasta,      setFechaHasta]      = useState('');
  const [busquedaFactura, setBusquedaFactura] = useState('');

  // ── Filtros cuenta corriente ───────────────────────────────────────────────
  const [cuentaFechaDesde,  setCuentaFechaDesde]  = useState('');
  const [cuentaFechaHasta,  setCuentaFechaHasta]  = useState('');
  const [cuentaCompraModal, setCuentaCompraModal] = useState(null);

  // ── Compras ────────────────────────────────────────────────────────────────
  const { data: comprasData, isLoading } = useQuery({
    queryKey: ['compras-proveedor', proveedor.id, ...sucursalKey],
    queryFn:  () => getComprasByProveedor(proveedor.id).then((r) => r.data.data),
    enabled:  sucursalLista,
  });

  // ── Acreedor vinculado (lista liviana para saldo) ─────────────────────────
  const { data: acreedoresRaw } = useQuery({
    queryKey: ['acreedores'],
    queryFn:  () => getAcreedores().then((r) => r.data.data),
    staleTime: 60_000,
  });
  const acreedoresAll = Array.isArray(acreedoresRaw) ? acreedoresRaw : [];
  const acreedorInfo  = acreedoresAll.find((a) => a.proveedor_id === proveedor.id) || null;
  const saldoAcreedor = acreedorInfo ? Number(acreedorInfo.saldo || 0) : 0;

  // ── Detalle acreedor con movimientos (carga solo al abrir la pestaña) ─────
  const { data: detalleAcreedor, isLoading: loadingAcreedor } = useQuery({
    queryKey: ['acreedor', acreedorInfo?.id],
    queryFn:  () => getAcreedorById(acreedorInfo.id).then((r) => r.data.data),
    enabled:  tabVista === 'cuenta' && !!acreedorInfo?.id,
  });

  const compras       = comprasData || [];
  const totalComprado = compras.reduce((s, c) => s + Number(c.total || 0), 0);
  const movimientosUI = detalleAcreedor?.movimientos
    ? [...detalleAcreedor.movimientos].reverse()
    : [];

  const movsFiltrados = movimientosUI.filter((m) => {
    const f = m.fecha ? m.fecha.slice(0, 10) : '';
    if (cuentaFechaDesde && f < cuentaFechaDesde) return false;
    if (cuentaFechaHasta && f > cuentaFechaHasta) return false;
    return true;
  });

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
      if (!c.numero_factura?.toLowerCase().includes(q) && !String(c.id).includes(q)) return false;
    }
    return true;
  });

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

      {/* Selector de vista (solo si hay acreedor vinculado) */}
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
          {/* Filtros */}
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
              <p className="text-xs text-gray-400 px-1 select-none">
                {comprasFiltradas.length} compra(s) · Doble click para ver detalle
              </p>
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
                          #{String(c.id).padStart(5, '0')}
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
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-600">
              Movimientos {movsFiltrados.length !== movimientosUI.length && `(${movsFiltrados.length} de ${movimientosUI.length})`}
            </h3>
            <Button size="sm" onClick={() => setModalMov(true)}>
              <PenLine size={14} /> Registrar
            </Button>
          </div>

          {/* Filtros de fecha */}
          <div className="flex gap-1.5 items-center flex-wrap">
            <input type="date" value={cuentaFechaDesde}
              onChange={(e) => setCuentaFechaDesde(e.target.value)}
              className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400" />
            <span className="text-gray-300 text-xs flex-shrink-0">—</span>
            <input type="date" value={cuentaFechaHasta}
              onChange={(e) => setCuentaFechaHasta(e.target.value)}
              className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400" />
            {(cuentaFechaDesde || cuentaFechaHasta) && (
              <button onClick={() => { setCuentaFechaDesde(''); setCuentaFechaHasta(''); }}
                className="text-xs text-gray-400 hover:text-red-500 px-1 flex-shrink-0 transition-colors">✕</button>
            )}
          </div>

          {loadingAcreedor ? <Spinner className="py-10" /> :
           movsFiltrados.length === 0 ? (
            <EmptyState icon={Wallet} titulo="Sin movimientos"
              descripcion={movimientosUI.length === 0
                ? 'Aún no hay cargos ni abonos con este proveedor'
                : 'Ningún movimiento en ese rango de fechas'} />
           ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-gray-400 px-1 select-none">Doble clic en movimientos con compra para ver detalle</p>
              {movsFiltrados.map((m) => (
                <div key={m.id}
                  onDoubleClick={() => m.compra_id && setCuentaCompraModal(m.compra_id)}
                  className={`bg-white border border-gray-100 rounded-xl p-3 flex items-start justify-between gap-3
                    ${m.compra_id ? 'cursor-pointer hover:border-blue-200 hover:shadow-sm transition-all' : ''}`}
                  title={m.compra_id ? 'Doble clic para ver detalle de compra' : undefined}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={m.tipo === 'Cargo' ? 'red' : 'green'}>{m.tipo}</Badge>
                      <span className="text-sm text-gray-700 truncate">{m.descripcion}</span>
                      {m.compra_id && (
                        <span className="text-xs text-blue-400 bg-blue-50 px-1.5 py-0.5 rounded">
                          Compra #{m.compra_id}
                        </span>
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
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <span className={`text-sm font-bold ${m.tipo === 'Cargo' ? 'text-red-500' : 'text-green-600'}`}>
                      {m.tipo === 'Cargo' ? '+' : '-'}{formatCOP(m.valor)}
                    </span>
                    {m.compra_id && (
                      <button onClick={() => setCuentaCompraModal(m.compra_id)}
                        className="p-1 rounded-lg hover:bg-blue-100 text-gray-300 hover:text-blue-600 transition-colors"
                        title="Ver compra">
                        <ChevronRight size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
           )}

          {cuentaCompraModal && (
            <ModalDetalleCompra compraId={cuentaCompraModal} onClose={() => setCuentaCompraModal(null)} />
          )}
        </div>
      )}

      {/* Modal registrar movimiento */}
      {modalMov && acreedorInfo && (
        <ModalMovimientoProveedor
          acreedorId={acreedorInfo.id}
          nombreProveedor={proveedor.nombre}
          onClose={() => {
            setModalMov(false);
            queryClient.invalidateQueries({ queryKey: ['acreedor', acreedorInfo.id], exact: false });
          }}
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
      : tipoForzado === 'cruce'
        ? crearCruce(form)
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
  const [busqueda,        setBusqueda]        = useState('');
  const [modalProveedor,  setModalProveedor]  = useState(false);
  const [proveedorEditar, setProveedorEditar] = useState(null);
  const [proveedorVer,    setProveedorVer]    = useState(null);
  const [modalCompra,     setModalCompra]     = useState(null);

  const { data: proveedoresData, isLoading } = useQuery({
    queryKey: ['proveedores', 'tipo-proveedor'],
    queryFn:  () => getProveedores('proveedor').then((r) => r.data.data),
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
        <Button size="sm" onClick={() => setModalProveedor(true)}><Plus size={16} /> Nuevo</Button>
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

// ─── Tab Cruces (tipo = cruce) ─────────────────────────────────────────────────

function TabCruces({ sucursalKey, sucursalLista }) {
  const [busqueda,     setBusqueda]     = useState('');
  const [modalCruce,   setModalCruce]   = useState(false);
  const [cruceEditar,  setCruceEditar]  = useState(null);
  const [cruceVer,     setCruceVer]     = useState(null);
  const [modalCompra,  setModalCompra]  = useState(null);

  const { data: crucesData, isLoading } = useQuery({
    queryKey: ['cruces'],
    queryFn:  () => getCruces().then((r) => r.data.data),
  });

  const { data: acreedoresRaw } = useQuery({
    queryKey: ['acreedores'],
    queryFn:  () => getAcreedores('').then((r) => r.data.data),
    staleTime: 60_000,
  });
  const acreedoresAll = Array.isArray(acreedoresRaw) ? acreedoresRaw : [];

  const cruces = (crucesData || []).filter((c) =>
    c.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  if (cruceVer) {
    return (
      <>
        <HistorialProveedor
          proveedor={cruceVer}
          sucursalKey={sucursalKey}
          sucursalLista={sucursalLista}
          onVolver={() => setCruceVer(null)}
          onNuevaCompra={() => setModalCompra(cruceVer)}
        />
        {modalCompra && <ModalCompra proveedor={modalCompra} onClose={() => setModalCompra(null)} />}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-400">{cruces.length} cruce(s)</p>
          <p className="text-xs text-gray-400 mt-0.5">Empresas con las que haces intercambios o compras sin pago inmediato en caja</p>
        </div>
        <Button size="sm" onClick={() => setModalCruce(true)}><Plus size={16} /> Nuevo cruce</Button>
      </div>
      <SearchInput value={busqueda} onChange={setBusqueda} placeholder="Buscar cruce..." />
      {isLoading ? <Spinner className="py-20" /> : cruces.length === 0 ? (
        <EmptyState icon={Repeat} titulo="Sin cruces" descripcion="Los cruces son empresas con las que intercambias mercancía o compras a crédito. Su deuda se lleva en Cuenta corriente." />
      ) : (
        cruces.map((c) => {
          const acreedorVinculado = acreedoresAll.find((a) => a.proveedor_id === c.id);
          const saldo = acreedorVinculado ? Number(acreedorVinculado.saldo || 0) : 0;
          return (
            <div key={c.id} className="bg-white border border-gray-100 rounded-2xl p-4 flex items-center justify-between gap-3">
              <button onClick={() => setCruceVer(c)} className="flex-1 text-left min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-900 truncate">{c.nombre}</p>
                  <ProveedorTipoBadge tipo="cruce" />
                  {saldo > 0 && (
                    <span className="text-xs text-red-600 font-semibold bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                      Debe {formatCOP(saldo)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  {c.nit      && <span className="text-xs text-gray-400">NIT: {c.nit}</span>}
                  {c.telefono && <span className="text-xs text-gray-400">Tel: {c.telefono}</span>}
                  {c.contacto && <span className="text-xs text-gray-400">{c.contacto}</span>}
                </div>
              </button>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button size="sm" onClick={() => setModalCompra(c)}>
                  <ShoppingCart size={14} />
                  <span className="hidden sm:inline">Compra</span>
                </Button>
                <button onClick={() => setCruceEditar(c)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                  <Package size={16} />
                </button>
              </div>
            </div>
          );
        })
      )}
      {/* Crear cruce: tipo forzado a 'cruce' */}
      {modalCruce  && <ModalProveedor tipoForzado="cruce" onClose={() => setModalCruce(false)} />}
      {/* Editar cruce: admin puede cambiar tipo si quiere */}
      {cruceEditar && <ModalProveedor proveedor={cruceEditar} onClose={() => setCruceEditar(null)} />}
      {modalCompra && <ModalCompra proveedor={modalCompra} onClose={() => setModalCompra(null)} />}
    </div>
  );
}

// ─── Tab: Búsqueda de compras ─────────────────────────────────────────────────

const MODOS_BUSQUEDA = [
  { key: 'imei',   label: 'IMEI / Serial',       Icon: ScanLine, placeholder: 'Ingresa el IMEI o número de serie…'      },
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
            ? 'Ingresa un IMEI para ver de qué compra proviene el producto'
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
  const [tabActivo, setTabActivo] = useState('proveedores');

  const tabs = [
    { id: 'proveedores', label: 'Proveedores', Icn: Truck     },
    { id: 'cruces',      label: 'Cruces',      Icn: Repeat    },
    { id: 'retomas',     label: 'Retomas',     Icn: RefreshCw },
    { id: 'busqueda',    label: 'Búsqueda',    Icn: Search    },
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
      {tabActivo === 'cruces' && (
        <TabCruces sucursalKey={sucursalKey} sucursalLista={sucursalLista} />
      )}
      {tabActivo === 'retomas'    && <TabRetomas />}
      {tabActivo === 'busqueda'   && <TabBusquedaCompras />}
    </div>
  );
}