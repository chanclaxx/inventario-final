import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Search, Package, Hash, ArrowRight, Handshake,
  ShoppingCart, RotateCcw, CheckCircle2, XCircle,
  MapPin, User, Phone, CreditCard, Tag, Loader2,
  AlertCircle, Box, Layers,
} from 'lucide-react';
import { buscarPorIMEI, buscarProductos } from '../../api/busqueda.api';
import { formatCOP, formatFecha } from '../../utils/formatters';
import { useAuth } from '../../context/useAuth';

// ─── Detección automática ─────────────────────────────────────────────────────

const detectarModo = (q) => (/^\d{6,}$/.test(q.trim()) ? 'imei' : 'nombre');

// ─── Componentes de soporte ───────────────────────────────────────────────────

const EstadoBadge = ({ estado }) => {
  const map = {
    cancelada: 'bg-red-100 text-red-700',
    pagada:    'bg-green-100 text-green-700',
    pendiente: 'bg-yellow-100 text-yellow-700',
    Activo:    'bg-blue-100 text-blue-700',
    Saldado:   'bg-green-100 text-green-700',
    Devuelto:  'bg-gray-100 text-gray-600',
  };
  if (!estado) return null;
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${map[estado] || 'bg-gray-100 text-gray-600'}`}>
      {estado}
    </span>
  );
};

const SerialEstado = ({ serial }) => {
  if (serial.vendido)  return <span className="text-xs font-semibold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Vendido</span>;
  if (serial.prestado) return <span className="text-xs font-semibold bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">Prestado</span>;
  return <span className="text-xs font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Disponible</span>;
};

// ─── Línea de tiempo de un IMEI ───────────────────────────────────────────────

const tipoConfig = {
  entrada:  { color: 'bg-blue-500',   icon: Package,       label: 'Entrada al inventario' },
  traslado: { color: 'bg-yellow-500', icon: ArrowRight,    label: 'Traslado'              },
  prestamo: { color: 'bg-orange-500', icon: Handshake,     label: 'Préstamo'              },
  retoma:   { color: 'bg-purple-500', icon: RotateCcw,     label: 'Retoma (entrada usada)'},
  venta:    { color: 'bg-green-500',  icon: ShoppingCart,  label: 'Venta'                 },
};

function EventoEntrada({ d }) {
  return (
    <div className="flex flex-col gap-1">
      {d.proveedor_nombre && (
        <p className="text-sm text-gray-600">
          <span className="font-medium">Proveedor:</span> {d.proveedor_nombre}
        </p>
      )}
      {d.costo_compra != null && (
        <p className="text-sm text-gray-600">
          <span className="font-medium">Costo:</span> {formatCOP(d.costo_compra)}
        </p>
      )}
      {!d.proveedor_nombre && d.costo_compra == null && (
        <p className="text-sm text-gray-400">Sin información de compra registrada</p>
      )}
    </div>
  );
}

function EventoTraslado({ d }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-sm text-gray-700">
        <span className="font-medium">{d.origen}</span>
        <ArrowRight size={13} className="text-gray-400 flex-shrink-0" />
        <span className="font-medium text-blue-700">{d.destino}</span>
      </div>
      {d.usuario && <p className="text-xs text-gray-500">Realizado por: {d.usuario}</p>}
      {d.notas   && <p className="text-xs text-gray-500">{d.notas}</p>}
    </div>
  );
}

function EventoPrestamo({ d }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-sm text-gray-800">{d.prestatario}</span>
        <EstadoBadge estado={d.estado} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500">
        {d.cedula   && <span className="flex items-center gap-1"><CreditCard size={11} />{d.cedula}</span>}
        {d.telefono && <span className="flex items-center gap-1"><Phone size={11} />{d.telefono}</span>}
        {d.sucursal && <span className="flex items-center gap-1"><MapPin size={11} />{d.sucursal}</span>}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500">
        {d.valor_prestamo != null && <span>Valor: <span className="font-medium text-gray-700">{formatCOP(d.valor_prestamo)}</span></span>}
        {d.saldo_pendiente != null && d.saldo_pendiente > 0 && (
          <span className="text-orange-600 font-medium">Saldo: {formatCOP(d.saldo_pendiente)}</span>
        )}
      </div>
      {d.usuario && <p className="text-xs text-gray-400">Registrado por: {d.usuario}</p>}
    </div>
  );
}

function EventoRetoma({ d }) {
  return (
    <div className="flex flex-col gap-1">
      {d.cliente     && <p className="text-sm font-medium text-gray-700">{d.cliente}</p>}
      {d.descripcion && <p className="text-sm text-gray-600">{d.descripcion}</p>}
      <div className="flex flex-wrap gap-x-4 text-xs text-gray-500">
        {d.valor_retoma != null && <span>Valor: <span className="font-medium text-gray-700">{formatCOP(d.valor_retoma)}</span></span>}
        {d.ingreso_inventario && <span className="text-green-600 font-medium">Ingresó al inventario</span>}
        {d.sucursal && <span className="flex items-center gap-1"><MapPin size={11} />{d.sucursal}</span>}
      </div>
    </div>
  );
}

function EventoVenta({ d }) {
  const cancelada = d.estado_factura === 'cancelada';
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-sm text-gray-800">{d.cliente || 'Sin nombre'}</span>
        {cancelada && (
          <span className="flex items-center gap-1 text-xs font-semibold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
            <XCircle size={11} /> Cancelada
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500">
        {d.cedula   && <span className="flex items-center gap-1"><CreditCard size={11} />{d.cedula}</span>}
        {d.celular  && <span className="flex items-center gap-1"><Phone size={11} />{d.celular}</span>}
        {d.sucursal && <span className="flex items-center gap-1"><MapPin size={11} />{d.sucursal}</span>}
        {d.usuario  && <span className="flex items-center gap-1"><User size={11} />{d.usuario}</span>}
      </div>
      {d.precio_venta != null && (
        <p className="text-sm font-semibold text-green-700">
          {formatCOP(d.precio_venta)}
          {cancelada && <span className="text-gray-400 font-normal ml-1 line-through">anulado</span>}
        </p>
      )}
    </div>
  );
}

const detalleComponentes = {
  entrada:  EventoEntrada,
  traslado: EventoTraslado,
  prestamo: EventoPrestamo,
  retoma:   EventoRetoma,
  venta:    EventoVenta,
};

function LineaTiempo({ historial }) {
  if (!historial.length) {
    return <p className="text-sm text-gray-400 py-4 text-center">Sin movimientos registrados</p>;
  }

  return (
    <div className="relative">
      {/* Línea vertical */}
      <div className="absolute left-4 top-0 bottom-0 w-px bg-gray-200" />

      <div className="flex flex-col gap-0">
        {historial.map((ev, i) => {
          const cfg = tipoConfig[ev.tipo] || tipoConfig.entrada;
          const Icon = cfg.icon;
          const Detalle = detalleComponentes[ev.tipo];
          return (
            <div key={i} className="flex gap-4 pb-6 last:pb-0">
              {/* Dot + icono */}
              <div className={`relative z-10 w-8 h-8 rounded-full ${cfg.color} flex items-center
                justify-center shadow-sm flex-shrink-0 mt-0.5`}>
                <Icon size={14} className="text-white" />
              </div>

              {/* Contenido */}
              <div className="flex-1 min-w-0 bg-white border border-gray-100 rounded-2xl px-4 py-3 shadow-sm">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">
                    {cfg.label}
                  </span>
                  <span className="text-xs text-gray-400 flex-shrink-0">{formatFecha(ev.fecha)}</span>
                </div>
                {Detalle && <Detalle d={ev.detalle} />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Tarjeta de serial encontrado ────────────────────────────────────────────

function TarjetaSerial({ serial }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
          <Package size={20} className="text-blue-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <h2 className="text-base font-bold text-gray-900 leading-tight">
                {serial.producto_nombre}
              </h2>
              {(serial.marca || serial.modelo) && (
                <p className="text-xs text-gray-400 mt-0.5">
                  {[serial.marca, serial.modelo].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
            <SerialEstado serial={serial} />
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-500">
            <span className="flex items-center gap-1 font-mono">
              <Hash size={11} />{serial.imei}
            </span>
            {serial.sucursal_nombre && (
              <span className="flex items-center gap-1">
                <MapPin size={11} />{serial.sucursal_nombre}
              </span>
            )}
            {serial.color && (
              <span className="flex items-center gap-1">
                <Tag size={11} />{serial.color}
              </span>
            )}
            {serial.precio != null && (
              <span className="flex items-center gap-1 font-semibold text-gray-700">
                {formatCOP(serial.precio)}
              </span>
            )}
          </div>

          {/* Características si existen */}
          {serial.caracteristicas && Object.keys(serial.caracteristicas).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {Object.entries(serial.caracteristicas).map(([k, v]) => (
                <span key={k} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-md">
                  <span className="font-medium">{k}:</span> {v}
                </span>
              ))}
            </div>
          )}

          {/* Info admin: costo y proveedor */}
          {(serial.costo_compra != null || serial.proveedor_nombre) && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-400 border-t border-dashed border-gray-100 pt-2">
              {serial.proveedor_nombre && (
                <span>Proveedor: <span className="font-medium text-gray-600">{serial.proveedor_nombre}</span></span>
              )}
              {serial.costo_compra != null && (
                <span>Costo: <span className="font-medium text-gray-600">{formatCOP(serial.costo_compra)}</span></span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Resultados por nombre ────────────────────────────────────────────────────

function TarjetaProductoSerial({ p }) {
  const disp = Number(p.disponibles);
  const vend = Number(p.vendidos);
  const prest = Number(p.prestados);
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
          <Package size={18} className="text-blue-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 leading-tight">{p.nombre}</p>
          {(p.marca || p.modelo) && (
            <p className="text-xs text-gray-400 mt-0.5">{[p.marca, p.modelo].filter(Boolean).join(' · ')}</p>
          )}
          {p.sucursal_nombre && (
            <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
              <MapPin size={10} />{p.sucursal_nombre}
            </p>
          )}
          <div className="flex gap-2 mt-2">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full
              ${disp > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-500'}`}>
              {disp} disponible{disp !== 1 ? 's' : ''}
            </span>
            {prest > 0 && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
                {prest} prestado{prest !== 1 ? 's' : ''}
              </span>
            )}
            {vend > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                {vend} vendido{vend !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {p.precio != null && (
            <p className="text-sm font-bold text-gray-700 mt-1">{formatCOP(p.precio)}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function TarjetaProductoCantidad({ p }) {
  const alerta = p.stock_minimo != null && p.stock <= p.stock_minimo;
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 bg-purple-50 rounded-xl flex items-center justify-center flex-shrink-0">
          <Layers size={18} className="text-purple-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 leading-tight">{p.nombre}</p>
          {p.sucursal_nombre && (
            <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
              <MapPin size={10} />{p.sucursal_nombre}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full
              ${alerta ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
              Stock: {p.stock}{p.unidad_medida ? ` ${p.unidad_medida}` : ''}
            </span>
            {alerta && (
              <span className="text-xs text-amber-600 font-medium flex items-center gap-0.5">
                <AlertCircle size={11} />Stock bajo
              </span>
            )}
          </div>
          {p.precio != null && (
            <p className="text-sm font-bold text-gray-700 mt-1">{formatCOP(p.precio)}</p>
          )}
          {p.costo_unitario != null && (
            <p className="text-xs text-gray-400 mt-0.5">
              Costo unit.: {formatCOP(p.costo_unitario)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function BusquedaPage() {
  const { usuario } = useAuth();
  const [input,    setInput]    = useState('');
  const [busqueda, setBusqueda] = useState('');
  const inputRef = useRef(null);

  const modo = busqueda ? detectarModo(busqueda) : null;

  const queryIMEI = useQuery({
    queryKey: ['busqueda-imei', busqueda],
    queryFn:  () => buscarPorIMEI(busqueda).then((r) => r.data.data),
    enabled:  modo === 'imei',
    retry:    false,
    staleTime: 30_000,
  });

  const queryNombre = useQuery({
    queryKey: ['busqueda-nombre', busqueda],
    queryFn:  () => buscarProductos(busqueda).then((r) => r.data.data),
    enabled:  modo === 'nombre',
    retry:    false,
    staleTime: 30_000,
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const q = input.trim();
    if (q.length >= 2) setBusqueda(q);
  };

  const handleLimpiar = () => {
    setInput('');
    setBusqueda('');
    inputRef.current?.focus();
  };

  const loading = queryIMEI.isFetching || queryNombre.isFetching;
  const error   = queryIMEI.error || queryNombre.error;

  const sinResultados =
    (modo === 'imei'   && queryIMEI.isSuccess  && !queryIMEI.data) ||
    (modo === 'nombre' && queryNombre.isSuccess &&
      !queryNombre.data?.seriales?.length && !queryNombre.data?.cantidad?.length);

  return (
    <div className="max-w-3xl mx-auto">

      {/* ── Encabezado ── */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Búsqueda de productos</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Ingresa un IMEI o número de serie para ver el historial completo, o busca por nombre.
        </p>
      </div>

      {/* ── Barra de búsqueda ── */}
      <form onSubmit={handleSubmit} className="flex gap-2 mb-3">
        <div className="flex-1 relative">
          <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="IMEI, número de serie o nombre de producto…"
            autoFocus
            className="w-full pl-10 pr-10 py-2.5 bg-white border border-gray-200 rounded-xl
              text-sm text-gray-800 placeholder-gray-400
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
              transition-all shadow-sm"
          />
          {input && (
            <button
              type="button"
              onClick={handleLimpiar}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400
                hover:text-gray-600 transition-colors"
            >
              <XCircle size={16} />
            </button>
          )}
        </div>
        <button
          type="submit"
          disabled={input.trim().length < 2}
          className="px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl
            hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-40
            disabled:cursor-not-allowed shadow-sm"
        >
          Buscar
        </button>
      </form>

      {/* Hint de modo */}
      {input.trim().length >= 2 && (
        <p className="text-xs text-gray-400 mb-5">
          {detectarModo(input) === 'imei'
            ? '🔢 Se buscará por IMEI / número de serie'
            : '📦 Se buscará por nombre de producto'}
        </p>
      )}

      {/* ── Estado de carga ── */}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-16 text-gray-400">
          <Loader2 size={22} className="animate-spin" />
          <span className="text-sm">Buscando…</span>
        </div>
      )}

      {/* ── Error ── */}
      {!loading && error && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-2xl p-4">
          <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-700">No encontrado</p>
            <p className="text-xs text-red-500 mt-0.5">
              {error.response?.data?.error || 'El producto no existe en tu negocio o revisa el IMEI.'}
            </p>
          </div>
        </div>
      )}

      {/* ── Sin resultados ── */}
      {!loading && !error && sinResultados && (
        <div className="text-center py-14">
          <Box size={36} className="text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-500">Sin resultados</p>
          <p className="text-xs text-gray-400 mt-1">No se encontraron productos con ese nombre.</p>
        </div>
      )}

      {/* ── Resultado IMEI ── */}
      {!loading && !error && modo === 'imei' && queryIMEI.data && (
        <div className="flex flex-col gap-5">
          <TarjetaSerial serial={queryIMEI.data.serial} />

          <div>
            <h3 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
              <CheckCircle2 size={15} className="text-blue-500" />
              Historial de movimientos
            </h3>
            <LineaTiempo historial={queryIMEI.data.historial} />
          </div>
        </div>
      )}

      {/* ── Resultado por nombre ── */}
      {!loading && !error && modo === 'nombre' && queryNombre.data && (
        <div className="flex flex-col gap-6">
          {/* Productos con serial */}
          {queryNombre.data.seriales?.length > 0 && (
            <section>
              <h3 className="text-sm font-bold text-gray-600 mb-3 flex items-center gap-2">
                <Package size={14} className="text-blue-500" />
                Productos con serial ({queryNombre.data.seriales.length})
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {queryNombre.data.seriales.map((p) => (
                  <TarjetaProductoSerial key={p.id + '_' + p.sucursal_id} p={p} />
                ))}
              </div>
            </section>
          )}

          {/* Productos por cantidad */}
          {queryNombre.data.cantidad?.length > 0 && (
            <section>
              <h3 className="text-sm font-bold text-gray-600 mb-3 flex items-center gap-2">
                <Layers size={14} className="text-purple-500" />
                Productos por cantidad ({queryNombre.data.cantidad.length})
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {queryNombre.data.cantidad.map((p) => (
                  <TarjetaProductoCantidad key={p.id + '_' + p.sucursal_id} p={p} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ── Estado inicial (sin búsqueda) ── */}
      {!busqueda && !loading && (
        <div className="text-center py-16">
          <Search size={40} className="text-gray-200 mx-auto mb-4" />
          <p className="text-sm font-medium text-gray-400">
            Escribe un IMEI o nombre para comenzar
          </p>
          <p className="text-xs text-gray-300 mt-1">
            {usuario?.rol === 'admin_negocio'
              ? 'Verás el historial completo incluyendo proveedores y costos.'
              : 'Verás el historial de movimientos del producto.'}
          </p>
        </div>
      )}

    </div>
  );
}
