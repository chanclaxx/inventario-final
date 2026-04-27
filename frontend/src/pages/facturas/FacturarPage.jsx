import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useQuery, useInfiniteQuery }       from '@tanstack/react-query';
import { getFacturaById, getFacturasRecientes, buscarFacturas } from '../../api/facturas.api';
import { getGarantiasPorFactura }                 from '../../api/garantias.api';
import { getEntregas }                            from '../../api/domiciliarios.api';
import { formatCOP, formatFecha, formatFechaHora } from '../../utils/formatters';
import { useAuth }              from '../../context/useAuth';
import { Badge }                from '../../components/ui/Badge';
import { Button }               from '../../components/ui/Button';
import { Modal }                from '../../components/ui/Modal';
import { Input }                from '../../components/ui/Input';
import { Spinner }              from '../../components/ui/Spinner';
import { EmptyState }           from '../../components/ui/EmptyState';
import { FacturaTermica }       from '../../components/FacturaTermica';
import { ModalEditarFactura }   from './ModalEditarFactura';
import { ModalCancelarFactura } from './ModalCancelarFactura';
import { useSucursalKey }       from '../../hooks/useSucursalKey';
import { ModalImprimirFactura }   from '../../components/ui/ModalImprimirFactura';
import useSucursalStore         from '../../store/sucursalStore';
import api                      from '../../api/axios.config';

import {
  FileText, ChevronDown, ChevronUp,
  Printer, XCircle, Eye, Search, X, Pencil, Package, Building2, Bike, FileDown,
} from 'lucide-react';

// ─── Utilidades ───────────────────────────────────────────────────────────────

function agruparPorDia(facturas) {
  const grupos = {};
  facturas.forEach((f) => {
    const dia = formatFecha(f.fecha);
    if (!grupos[dia]) grupos[dia] = [];
    grupos[dia].push(f);
  });
  return grupos;
}

function labelTipoRetoma(retoma) {
  if (retoma.imei) return 'Equipo con serial / IMEI';
  return 'Producto por cantidad';
}

// ─── Secciones del detalle (sin cambios) ──────────────────────────────────────

function SeccionRetoma({ retoma }) {
  if (!retoma) return null;
  const nombreProducto = retoma.nombre_producto_serial || retoma.nombre_producto_cantidad || retoma.nombre_producto || null;
  const esCantidad = !retoma.imei;

  return (
    <div className="bg-purple-50 rounded-xl p-3 flex flex-col gap-1.5">
      <p className="text-xs text-purple-500 font-medium">Retoma</p>
      <p className="text-sm text-gray-700">{retoma.descripcion}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1">
        <span className="text-xs text-gray-400">Tipo</span>
        <span className="text-xs text-gray-700">{labelTipoRetoma(retoma)}</span>
        {retoma.imei && (<><span className="text-xs text-gray-400">IMEI</span><span className="text-xs font-mono text-gray-700">{retoma.imei}</span></>)}
        {nombreProducto && (<><span className="text-xs text-gray-400">Producto</span><span className="text-xs text-gray-700">{nombreProducto}</span></>)}
        {esCantidad && Number(retoma.cantidad_retoma) > 0 && (<><span className="text-xs text-gray-400">Cantidad retomada</span><span className="text-xs text-gray-700">{retoma.cantidad_retoma} unidad{Number(retoma.cantidad_retoma) !== 1 ? 'es' : ''}</span></>)}
        <span className="text-xs text-gray-400">Inventario</span>
        <span className="text-xs">{retoma.ingreso_inventario ? <span className="text-green-600 font-medium">✓ Ingresó al inventario</span> : <span className="text-gray-400">No ingresó</span>}</span>
      </div>
      <div className="flex justify-between items-center border-t border-purple-200 mt-1 pt-1.5">
        <span className="text-xs text-gray-500">Valor retoma</span>
        <span className="text-sm font-semibold text-purple-700">- {formatCOP(retoma.valor_retoma)}</span>
      </div>
    </div>
  );
}

function SeccionProveedor({ proveedorNombre }) {
  if (!proveedorNombre) return null;
  return (
    <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 flex items-center gap-3">
      <Package size={16} className="text-amber-500 flex-shrink-0" />
      <div><p className="text-xs text-amber-500 font-medium">Proveedor</p><p className="text-sm font-semibold text-gray-800">{proveedorNombre}</p></div>
    </div>
  );
}

function BloqueCliente({ factura }) {
  const esCompanero = factura?.cedula === 'COMPANERO';
  const tieneCliente = !!factura?.cliente_id;
  return (
    <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-1">
      <p className="text-xs text-gray-400 mb-0.5">Cliente</p>
      <p className="text-sm font-semibold text-gray-800">{factura?.nombre_cliente}</p>
      {!esCompanero && <p className="text-xs text-gray-500">CC: {factura?.cedula}{factura?.celular ? ` · Tel: ${factura.celular}` : ''}</p>}
      {tieneCliente && factura?.cliente_email && <p className="text-xs text-gray-500">{factura.cliente_email}</p>}
      {tieneCliente && factura?.cliente_direccion && <p className="text-xs text-gray-500">{factura.cliente_direccion}</p>}
      {factura?.usuario_nombre && <p className="text-xs text-gray-400 mt-1">Atendido por: <span className="text-gray-600 font-medium">{factura.usuario_nombre}</span></p>}
    </div>
  );
}

const ESTADO_BADGE_DOM = { Pendiente: 'yellow', Entregado: 'green', No_entregado: 'red' };
const ESTADO_LABEL_DOM = { Pendiente: 'Pendiente', Entregado: 'Entregado', No_entregado: 'No entregado' };

function SeccionDomicilio({ facturaId }) {
  const { data: entregasData, isLoading } = useQuery({
    queryKey: ['entrega-por-factura', facturaId],
    queryFn: () => getEntregas({ factura_id: facturaId }).then((r) => r.data.data),
    enabled: !!facturaId, staleTime: 30_000,
  });
  const entrega = entregasData?.[0] || null;
  if (isLoading || !entrega) return null;
  const estadoBadge = ESTADO_BADGE_DOM[entrega.estado] || 'gray';
  const estadoLabel = ESTADO_LABEL_DOM[entrega.estado] || entrega.estado;
  const pct = Number(entrega.valor_total) > 0 ? Math.min(100, Math.round((Number(entrega.total_abonado) / Number(entrega.valor_total)) * 100)) : 0;

  return (
    <div className="bg-orange-50 border border-orange-100 rounded-xl p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5"><Bike size={14} className="text-orange-500 flex-shrink-0" /><p className="text-xs font-semibold text-orange-700">Pedido a domicilio</p></div>
        <Badge variant={estadoBadge}>{estadoLabel}</Badge>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-gray-800">{entrega.domiciliario_nombre}{entrega.domiciliario_telefono && <span className="text-xs text-gray-400 font-normal ml-2">· {entrega.domiciliario_telefono}</span>}</p>
        {entrega.direccion_entrega && <p className="text-xs text-gray-500">{entrega.direccion_entrega}</p>}
        {entrega.notas && <p className="text-xs text-gray-400 italic">{entrega.notas}</p>}
        <div className="flex justify-between text-xs text-gray-400 mt-0.5">
          <span>Asignado: {formatFechaHora(entrega.fecha_asignacion)}</span>
          {entrega.fecha_entrega && <span>Cerrado: {formatFechaHora(entrega.fecha_entrega)}</span>}
        </div>
        {entrega.estado !== 'No_entregado' && (
          <div className="flex flex-col gap-1 mt-1">
            <div className="flex justify-between text-xs text-gray-500">
              <span>Rendido: {formatCOP(Number(entrega.total_abonado))}</span>
              <span>Total: {formatCOP(Number(entrega.valor_total))}</span>
            </div>
            <div className="h-1.5 bg-orange-100 rounded-full overflow-hidden">
              <div className="h-full bg-orange-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ModalDetalle ─────────────────────────────────────────────────────────────

function ModalDetalle({ facturaId, onClose, onAbrirImprimir, onEditar }) {
  const { esAdminNegocio } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['factura-detalle', facturaId], queryFn: () => getFacturaById(facturaId).then((r) => r.data.data), enabled: !!facturaId });
  const { data: configData } = useQuery({ queryKey: ['config'], queryFn: () => api.get('/config').then((r) => r.data.data) });
  const { data: garantiasFactura = [] } = useQuery({ queryKey: ['garantias-factura', facturaId], queryFn: () => getGarantiasPorFactura(facturaId).then((r) => r.data.data), enabled: !!facturaId, staleTime: 0 });

  if (isLoading) return <Modal open onClose={onClose} title="Detalle de Factura" size="lg"><Spinner className="py-10" /></Modal>;

  const f = data;
  const total = f?.lineas?.reduce((s, l) => s + Number(l.subtotal || 0), 0) || 0;
  const totalPagado = f?.pagos?.reduce((s, p) => s + Number(p.valor || 0), 0) || 0;
  const valorRetoma = f?.retomas?.reduce((s, r) => s + Number(r.valor_retoma || 0), 0) || 0;
  const facturaConConfig = { ...f, config: configData };

  return (
    <Modal open onClose={onClose} title={`Factura #${String(facturaId).padStart(6, '0')}`} size="lg">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <Badge variant={f?.estado === 'Activa' ? 'green' : f?.estado === 'Credito' ? 'yellow' : 'red'}>{f?.estado}</Badge>
          <span className="text-xs text-gray-400">{formatFechaHora(f?.fecha)}</span>
        </div>
        {f?.sucursal_nombre && <div className="flex items-center gap-1.5 text-xs text-purple-600 bg-purple-50 border border-purple-100 rounded-lg px-2.5 py-1.5"><Building2 size={12} /><span>{f.sucursal_nombre}</span></div>}
        <BloqueCliente factura={f} />
        <SeccionDomicilio facturaId={facturaId} />
        {esAdminNegocio() && <SeccionProveedor proveedorNombre={f?.proveedor_nombre} />}
        <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-2">
          <p className="text-xs text-gray-400 font-medium">Productos</p>
          {f?.lineas?.map((l) => (
            <div key={l.id} className="flex items-start justify-between text-sm gap-2">
              <div className="flex-1"><p className="font-medium text-gray-800">{l.nombre_producto}</p>{l.imei && <p className="text-xs text-gray-400 font-mono">{l.imei}</p>}{esAdminNegocio() && l.proveedor_nombre && <p className="text-xs text-amber-600 font-medium mt-0.5">{l.proveedor_nombre}</p>}</div>
              <div className="text-right flex-shrink-0"><p className="text-xs text-gray-400">{l.cantidad} x {formatCOP(l.precio)}</p><p className="font-semibold text-gray-900">{formatCOP(l.subtotal)}</p></div>
            </div>
          ))}
        </div>
        {f?.retomas?.length > 0 && (
          <div className="flex flex-col gap-2">
            {f.retomas.map((retoma) => <SeccionRetoma key={retoma.id} retoma={retoma} />)}
            {f.retomas.length > 1 && <div className="flex justify-between text-sm font-medium text-purple-700 bg-purple-50 rounded-xl px-3 py-2 border border-purple-100"><span>Total retomas ({f.retomas.length})</span><span>- {formatCOP(valorRetoma)}</span></div>}
          </div>
        )}
        <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-1.5">
          <p className="text-xs text-gray-400 font-medium">Pagos</p>
          {f?.pagos?.map((p) => <div key={p.id} className="flex justify-between text-sm"><span className="text-gray-600">{p.metodo}</span><span className="font-medium text-gray-800">{formatCOP(p.valor)}</span></div>)}
          <div className="border-t border-gray-200 mt-1 pt-1.5 flex justify-between"><span className="text-sm font-semibold text-gray-700">Total neto</span><span className="text-sm font-bold text-gray-900">{formatCOP(total - valorRetoma)}</span></div>
          <div className="flex justify-between"><span className="text-sm text-gray-500">Total pagado</span><span className="text-sm font-medium text-gray-700">{formatCOP(totalPagado)}</span></div>
        </div>
        {f?.notas && <div className="bg-gray-50 rounded-xl px-3 py-2"><p className="text-xs text-gray-400 mb-0.5">Descripción</p><p className="text-sm text-gray-600">{f.notas}</p></div>}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => onAbrirImprimir(facturaConConfig, garantiasFactura)}>
  <Printer size={16} /> Imprimir
</Button>
          {f?.estado !== 'Cancelada' && <Button variant="secondary" className="flex-1" onClick={() => onEditar(facturaId)}><Pencil size={16} /> Editar</Button>}
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cerrar</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Fila y Grupo (sin cambios) ───────────────────────────────────────────────

function FilaFactura({ factura, onVerDetalle, onInactivar, onEditar, onAbrirPdf, mostrarSucursal }) {
  const total = Number(factura.total || 0) - Number(factura.total_retoma || 0);
  return (
    <div className={`bg-white border rounded-xl p-3 flex items-center justify-between gap-3 ${factura.estado === 'Cancelada' ? 'opacity-50 border-gray-100' : 'border-gray-100'}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-800">#{String(factura.id).padStart(6, '0')}</span>
          <Badge variant={factura.estado === 'Activa' ? 'green' : factura.estado === 'Credito' ? 'yellow' : 'red'}>{factura.estado}</Badge>
          {factura.retoma_descripcion && <Badge variant="purple">Retoma</Badge>}
          {mostrarSucursal && factura.sucursal_nombre && <span className="flex items-center gap-1 text-[10px] text-purple-600 bg-purple-50 border border-purple-100 rounded-full px-2 py-0.5"><Building2 size={9} />{factura.sucursal_nombre}</span>}
        </div>
        <p className="text-sm text-gray-600 truncate mt-0.5">{factura.nombre_cliente}</p>
        {factura.productos_nombres && <p className="text-xs text-gray-400 truncate">{factura.productos_nombres}</p>}
        <p className="text-xs text-gray-400">{formatFechaHora(factura.fecha)}{factura.usuario_nombre && <span className="ml-2 text-gray-300">· {factura.usuario_nombre}</span>}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-sm font-bold text-gray-900">{formatCOP(total)}</span>
        <button onClick={() => onVerDetalle(factura.id)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-blue-600 transition-colors"><Eye size={16} /></button>
        <button
  onClick={(e) => { e.stopPropagation(); onAbrirPdf(factura.id); }}
  title="Descargar / compartir PDF"
  className="p-1.5 rounded-lg hover:bg-purple-50 text-gray-400
    hover:text-purple-600 transition-colors"
>
  <FileDown size={16} />
</button>
        {factura.estado !== 'Cancelada' && <button onClick={() => onEditar(factura.id)} className="p-1.5 rounded-lg hover:bg-yellow-50 text-gray-400 hover:text-yellow-500 transition-colors"><Pencil size={16} /></button>}
        {factura.estado !== 'Cancelada' && <button onClick={() => onInactivar(factura)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"><XCircle size={16} /></button>}
      </div>
    </div>
  );
}

function GrupoDia({ fecha, facturas, onVerDetalle, onInactivar, onEditar, onAbrirPdf, mostrarSucursal }) {
  const [expandido, setExpandido] = useState(true);
  const totalDia = facturas.filter((f) => f.estado !== 'Cancelada').reduce((s, f) => s + Number(f.total || 0) - Number(f.total_retoma || 0), 0);

  return (
    <div className="flex flex-col gap-2">
      <button onClick={() => setExpandido(!expandido)} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-2.5 hover:bg-gray-100 transition-colors">
        <div className="flex items-center gap-3">
          {expandido ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
          <span className="text-sm font-semibold text-gray-700">{fecha}</span>
          <span className="text-xs text-gray-400">{facturas.length} factura(s)</span>
        </div>
        <span className="text-sm font-bold text-green-600">{formatCOP(totalDia)}</span>
      </button>
      {expandido && <div className="flex flex-col gap-2 pl-2">{facturas.map((f) => <FilaFactura key={f.id} factura={f} onVerDetalle={onVerDetalle} onInactivar={onInactivar} onEditar={onEditar} onAbrirPdf={onAbrirPdf} mostrarSucursal={mostrarSucursal} />)}</div>}
    </div>
  );
}

// ─── Panel de búsqueda ────────────────────────────────────────────────────────

function PanelBusqueda({ filtros, onChange, onLimpiar, totalResultados, modo }) {
  const hayFiltros = filtros.texto || filtros.desde || filtros.hasta;

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-col gap-3 shadow-sm">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input type="text" placeholder="Buscar por cliente, producto, IMEI, retoma..."
          value={filtros.texto} onChange={(e) => onChange({ ...filtros, texto: e.target.value })}
          className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all" />
      </div>
      <div className="flex gap-2 items-end flex-wrap">
        <div className="flex-1 min-w-[120px]">
          <Input label="Desde" type="date" value={filtros.desde} onChange={(e) => onChange({ ...filtros, desde: e.target.value })} />
        </div>
        <div className="flex-1 min-w-[120px]">
          <Input label="Hasta" type="date" value={filtros.hasta} onChange={(e) => onChange({ ...filtros, hasta: e.target.value })} />
        </div>
        {hayFiltros && (
          <button onClick={onLimpiar} className="flex items-center gap-1 px-3 py-2.5 text-xs text-gray-500 hover:text-red-500 bg-gray-100 hover:bg-red-50 rounded-xl transition-colors">
            <X size={13} /> Limpiar
          </button>
        )}
      </div>
      {modo === 'busqueda' && totalResultados != null && (
        <p className="text-xs text-gray-400">{totalResultados} resultado(s) encontrado(s)</p>
      )}
    </div>
  );
}

// ─── Hook: observer para scroll infinito ──────────────────────────────────────

function useIntersectionObserver(callback) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) callback();
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [callback]);

  return ref;
}

// ─── Página principal ─────────────────────────────────────────────────────────

const FILTROS_INICIALES = { texto: '', desde: '', hasta: '' };
const DEBOUNCE_MS = 400;

export default function FacturarPage() {
  const { sucursalKey, sucursalLista } = useSucursalKey();
  const esVistaGlobal                  = useSucursalStore((s) => s.esVistaGlobal());

  const [facturaDetalle,   setFacturaDetalle]   = useState(null);
  const [facturaInactivar, setFacturaInactivar] = useState(null);
  const [facturaImprimir,  setFacturaImprimir]  = useState(null);
  const [pdfRapido, setPdfRapido] = useState(null);
  const [facturaEditar,    setFacturaEditar]    = useState(null);
  const [filtros,          setFiltros]          = useState(FILTROS_INICIALES);
  const [debouncedTexto,   setDebouncedTexto]   = useState('');

  // Debounce del texto de búsqueda
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTexto(filtros.texto), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filtros.texto]);

  const hayBusqueda = !!(debouncedTexto.trim() || filtros.desde || filtros.hasta);

  const { data: configData } = useQuery({
  queryKey: ['config'],
  queryFn:  () => api.get('/config').then((r) => r.data.data),
});

const { data: facturaRapidaData } = useQuery({
  queryKey: ['factura-detalle', pdfRapido?.facturaId],
  queryFn:  () => getFacturaById(pdfRapido.facturaId).then((r) => r.data.data),
  enabled:  !!pdfRapido?.facturaId,
});

const { data: garantiasRapidas = [] } = useQuery({
  queryKey: ['garantias-factura', pdfRapido?.facturaId],
  queryFn:  () => getGarantiasPorFactura(pdfRapido.facturaId).then((r) => r.data.data),
  enabled:  !!pdfRapido?.facturaId,
  staleTime: 0,
});

  // ── Modo scroll infinito (sin búsqueda) ─────────────────────────────────
  const infiniteQuery = useInfiniteQuery({
    queryKey:  ['facturas-recientes', ...sucursalKey],
    queryFn:   ({ pageParam }) => getFacturasRecientes(pageParam, 5).then((r) => r.data.data),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage?.siguienteCursor || undefined,
    enabled: sucursalLista && !hayBusqueda,
    staleTime: 0,
  });

  const facturasRecientes = useMemo(
    () => infiniteQuery.data?.pages?.flatMap((p) => p.items || []) || [],
    [infiniteQuery.data]
  );

  // ── Modo búsqueda (con texto, desde, o hasta) ──────────────────────────
  const { data: busquedaData, isLoading: loadingBusqueda } = useQuery({
    queryKey: ['facturas-busqueda', ...sucursalKey, debouncedTexto, filtros.desde, filtros.hasta],
    queryFn:  () => buscarFacturas({
      q:     debouncedTexto.trim(),
      desde: filtros.desde || undefined,
      hasta: filtros.hasta || undefined,
      limit: 200,
    }).then((r) => r.data.data),
    enabled: sucursalLista && hayBusqueda,
    staleTime: 0,
  });

  const facturasBusqueda = busquedaData || [];

  // ── Facturas a mostrar según modo ───────────────────────────────────────
  const facturas = hayBusqueda ? facturasBusqueda : facturasRecientes;
  const isLoading = hayBusqueda ? loadingBusqueda : infiniteQuery.isLoading;

  const grupos = useMemo(() => agruparPorDia(facturas), [facturas]);

  const facturaParaModalRapido = pdfRapido && facturaRapidaData
  ? { ...facturaRapidaData, config: configData }
  : null;

  // Observer para scroll infinito
  const cargarMas = useCallback(() => {
    if (!hayBusqueda && infiniteQuery.hasNextPage && !infiniteQuery.isFetchingNextPage) {
      infiniteQuery.fetchNextPage();
    }
  }, [hayBusqueda, infiniteQuery]);

  const sentinelRef = useIntersectionObserver(cargarMas);

  const handleEditar = (id) => {
    setFacturaDetalle(null);
    setFacturaEditar(id);
  };
  const handleAbrirImprimir = (facturaConConfig, garantias) => {
  setFacturaDetalle(null);
  setFacturaImprimir({ factura: facturaConConfig, garantias });
};

const handleAbrirPdfRapido = (facturaId) => {
  setPdfRapido({ facturaId });
};

  const handleLimpiar = () => {
    setFiltros(FILTROS_INICIALES);
    setDebouncedTexto('');
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Historial de Facturas</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          {hayBusqueda
            ? `${facturas.length} resultado(s)`
            : `Mostrando ${facturas.length} factura(s) recientes`}
        </p>
      </div>

      <PanelBusqueda
        filtros={filtros}
        onChange={setFiltros}
        onLimpiar={handleLimpiar}
        totalResultados={hayBusqueda ? facturas.length : null}
        modo={hayBusqueda ? 'busqueda' : 'recientes'}
      />

      {isLoading ? (
        <Spinner className="py-20" />
      ) : facturas.length === 0 ? (
        <EmptyState icon={FileText}
          titulo={hayBusqueda ? 'Sin resultados' : 'Sin facturas recientes'}
          descripcion={hayBusqueda ? 'Intenta con otros términos de búsqueda' : 'Las facturas aparecerán aquí una vez realizadas'} />
      ) : (
        <div className="flex flex-col gap-4">
          {Object.entries(grupos).map(([fecha, facts]) => (
            <GrupoDia key={fecha} fecha={fecha} facturas={facts}
              onVerDetalle={(id) => setFacturaDetalle(id)}
              onInactivar={(f) => setFacturaInactivar(f)}
              onEditar={handleEditar}
              onAbrirPdf={handleAbrirPdfRapido}
              mostrarSucursal={esVistaGlobal} />
          ))}

          {/* Sentinel para scroll infinito */}
          {!hayBusqueda && (
            <div ref={sentinelRef} className="py-4 flex justify-center">
              {infiniteQuery.isFetchingNextPage && <Spinner className="py-0 scale-75" />}
              {!infiniteQuery.hasNextPage && facturas.length > 0 && (
                <p className="text-xs text-gray-300">No hay más facturas</p>
              )}
            </div>
          )}
        </div>
      )}

      {facturaDetalle && (
        <ModalDetalle facturaId={facturaDetalle} onClose={() => setFacturaDetalle(null)}
          onAbrirImprimir={handleAbrirImprimir}
          onEditar={handleEditar} />
      )}
      {facturaInactivar && <ModalCancelarFactura factura={facturaInactivar} onClose={() => setFacturaInactivar(null)} onSuccess={() => setFacturaInactivar(null)} />}
      {facturaEditar && <ModalEditarFactura facturaId={facturaEditar} onClose={() => setFacturaEditar(null)} onGuardado={() => setFacturaEditar(null)} />}
      {facturaImprimir && !facturaImprimir._posMode && (
  <ModalImprimirFactura
    open
    onClose={() => setFacturaImprimir(null)}
    factura={facturaImprimir.factura}
    garantias={facturaImprimir.garantias}
    onImprimirPos={(f, g) => {
      setFacturaImprimir({ _posMode: true, factura: f, garantias: g });
    }}
  />
)}

{facturaImprimir?._posMode && (
  <FacturaTermica
    factura={facturaImprimir.factura}
    garantias={facturaImprimir.garantias}
    onClose={() => setFacturaImprimir(null)}
  />
)}

{pdfRapido && (
  <ModalImprimirFactura
    open
    onClose={() => setPdfRapido(null)}
    factura={facturaParaModalRapido}
    garantias={garantiasRapidas}
    onImprimirPos={(f, g) => {
      setPdfRapido(null);
      setFacturaImprimir({ _posMode: true, factura: f, garantias: g });
    }}
  />
)}
    </div>
  );
}