import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getProveedores, crearProveedor, actualizarProveedor } from '../../api/proveedores.api';
import { getCruces, crearCruce } from '../../api/cruces.api';
import { getComprasByProveedor, getCompraById } from '../../api/compras.api';
import { formatCOP, formatFechaHora } from '../../utils/formatters';
import { Button }      from '../../components/ui/Button';
import { Input }       from '../../components/ui/Input';
import { Modal }       from '../../components/ui/Modal';
import { Badge }       from '../../components/ui/Badge';
import { Spinner }     from '../../components/ui/Spinner';
import { EmptyState }  from '../../components/ui/EmptyState';
import { SearchInput } from '../../components/ui/SearchInput';
import { ModalCompra } from './ModalCompra';
import { useSucursalKey } from '../../hooks/useSucursalKey';
import api from '../../api/axios.config';
import {
  Truck, Plus, ShoppingCart, ChevronRight, ChevronLeft,
  Package, Hash, User, RefreshCw, ArrowLeftRight, ShoppingBag, Repeat,
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
                <p className="text-xs text-gray-400 mb-0.5">N° Factura</p>
                <p className="text-sm font-medium text-gray-800">{data.numero_factura}</p>
              </div>
            )}
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-400 mb-0.5">Registrado por</p>
              <p className="text-sm font-medium text-gray-800">{data?.usuario_nombre || '—'}</p>
            </div>
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
          {data?.notas && <p className="text-xs text-gray-400 italic">Notas: {data.notas}</p>}
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
        </div>
      )}
    </Modal>
  );
}

// ─── Vista historial proveedor ─────────────────────────────────────────────────

function HistorialProveedor({ proveedor, sucursalKey, sucursalLista, onVolver, onNuevaCompra }) {
  const [compraDetalle, setCompraDetalle] = useState(null);

  const { data: comprasData, isLoading } = useQuery({
    queryKey: ['compras-proveedor', proveedor.id, ...sucursalKey],
    queryFn:  () => getComprasByProveedor(proveedor.id).then((r) => r.data.data),
    enabled:  sucursalLista,
  });

  const compras       = comprasData || [];
  const totalComprado = compras.reduce((s, c) => s + Number(c.total || 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button onClick={onVolver} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
          <ChevronLeft size={18} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-gray-900">{proveedor.nombre}</h2>
            <ProveedorTipoBadge tipo={proveedor.tipo} />
          </div>
          <p className="text-xs text-gray-400">Historial de compras</p>
        </div>
        <Button size="sm" onClick={onNuevaCompra}><ShoppingCart size={14} /> Nueva compra</Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-blue-50 rounded-xl p-3">
          <p className="text-xs text-blue-400 mb-0.5">Total comprado</p>
          <p className="text-base font-bold text-blue-700">{formatCOP(totalComprado)}</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-xs text-gray-400 mb-0.5">N° compras</p>
          <p className="text-base font-bold text-gray-800">{compras.length}</p>
        </div>
      </div>
      {isLoading ? <Spinner className="py-20" /> : compras.length === 0 ? (
        <EmptyState icon={ShoppingCart} titulo="Sin compras" descripcion="Aún no hay compras registradas a este proveedor" />
      ) : (
        <div className="flex flex-col gap-2">
          {compras.map((c) => (
            <button key={c.id} onClick={() => setCompraDetalle(c.id)}
              className="bg-white border border-gray-100 rounded-xl p-3 flex items-center justify-between hover:border-blue-200 hover:bg-blue-50 transition-all text-left">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-800">#{String(c.id).padStart(5, '0')}</span>
                  <Badge variant={c.estado === 'Completada' ? 'green' : c.estado === 'Pendiente' ? 'yellow' : 'red'}>{c.estado}</Badge>
                </div>
                {c.numero_factura && <p className="text-xs text-gray-400 mt-0.5">Factura: {c.numero_factura}</p>}
                <p className="text-xs text-gray-400">{formatFechaHora(c.fecha)}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-sm font-bold text-gray-900">{formatCOP(c.total)}</span>
                <ChevronRight size={14} className="text-gray-400" />
              </div>
            </button>
          ))}
        </div>
      )}
      {compraDetalle && <ModalDetalleCompra compraId={compraDetalle} onClose={() => setCompraDetalle(null)} />}
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
        proveedores.map((p) => (
          <div key={p.id} className="bg-white border border-gray-100 rounded-2xl p-4 flex items-center justify-between gap-3">
            <button onClick={() => setProveedorVer(p)} className="flex-1 text-left min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-gray-900">{p.nombre}</p>
                <ProveedorTipoBadge tipo={p.tipo} />
              </div>
              <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                {p.nit      && <span className="text-xs text-gray-400">NIT: {p.nit}</span>}
                {p.telefono && <span className="text-xs text-gray-400">Tel: {p.telefono}</span>}
                {p.contacto && <span className="text-xs text-gray-400">{p.contacto}</span>}
              </div>
            </button>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button size="sm" onClick={() => setModalCompra(p)}><ShoppingCart size={14} /> Compra</Button>
              <button onClick={() => setProveedorEditar(p)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                <Package size={16} />
              </button>
            </div>
          </div>
        ))
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
        <p className="text-sm text-gray-400">{cruces.length} cruce(s)</p>
        <Button size="sm" onClick={() => setModalCruce(true)}><Plus size={16} /> Nuevo cruce</Button>
      </div>
      <SearchInput value={busqueda} onChange={setBusqueda} placeholder="Buscar cruce..." />
      {isLoading ? <Spinner className="py-20" /> : cruces.length === 0 ? (
        <EmptyState icon={Repeat} titulo="Sin cruces" descripcion="Aún no hay cruces registrados" />
      ) : (
        cruces.map((c) => (
          <div key={c.id} className="bg-white border border-gray-100 rounded-2xl p-4 flex items-center justify-between gap-3">
            <button onClick={() => setCruceVer(c)} className="flex-1 text-left min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-gray-900">{c.nombre}</p>
                <ProveedorTipoBadge tipo="cruce" />
              </div>
              <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                {c.nit      && <span className="text-xs text-gray-400">NIT: {c.nit}</span>}
                {c.telefono && <span className="text-xs text-gray-400">Tel: {c.telefono}</span>}
                {c.contacto && <span className="text-xs text-gray-400">{c.contacto}</span>}
              </div>
            </button>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button size="sm" onClick={() => setModalCompra(c)}><ShoppingCart size={14} /> Compra</Button>
              <button onClick={() => setCruceEditar(c)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                <Package size={16} />
              </button>
            </div>
          </div>
        ))
      )}
      {/* Crear cruce: tipo forzado a 'cruce' */}
      {modalCruce  && <ModalProveedor tipoForzado="cruce" onClose={() => setModalCruce(false)} />}
      {/* Editar cruce: admin puede cambiar tipo si quiere */}
      {cruceEditar && <ModalProveedor proveedor={cruceEditar} onClose={() => setCruceEditar(null)} />}
      {modalCompra && <ModalCompra proveedor={modalCompra} onClose={() => setModalCompra(null)} />}
    </div>
  );
}

// ─── Página principal ────────────────────────────────────────────────────────

export default function ProveedoresPage() {
  const { sucursalKey, sucursalLista } = useSucursalKey();
  const [tabActivo, setTabActivo] = useState('proveedores');

  const tabs = [
    { id: 'proveedores', label: 'Proveedores',        Icn: Truck     },
    { id: 'cruces',      label: 'Cruces',              Icn: Repeat    },
    { id: 'retomas',     label: 'Retomas de clientes', Icn: RefreshCw },
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
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg
                text-sm font-medium transition-all
                ${tabActivo === tab.id
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'}`}>
              <TabIcon size={15} />
              {tab.label}
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
      {tabActivo === 'retomas' && <TabRetomas />}
    </div>
  );
}