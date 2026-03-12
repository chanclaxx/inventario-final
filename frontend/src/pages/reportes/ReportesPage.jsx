import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getDashboard,
  getVentasRango,
  getProductosTop,
  getInventarioBajo,
  actualizarCostoCompra,
} from '../../api/reportes.api';
import { formatCOP, formatFecha, formatFechaISO } from '../../utils/formatters';
import { Spinner } from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { Badge } from '../../components/ui/Badge';
import { useAuth } from '../../hooks/useAuth';
import {
  BarChart2,
  TrendingUp,
  Package,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Info,
  Pencil,
  Check,
  X,
} from 'lucide-react';

// ─────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────
const hoy = formatFechaISO(new Date());

const TABS = [
  { id: 'resumen',   label: 'Resumen',    icon: BarChart2 },
  { id: 'ventas',    label: 'Ventas',     icon: TrendingUp },
  { id: 'productos', label: 'Productos',  icon: Package },
  { id: 'stock',     label: 'Stock Bajo', icon: AlertTriangle },
];

// ─────────────────────────────────────────────
// SUB-COMPONENTES GENÉRICOS
// ─────────────────────────────────────────────

const MetricCard = ({ label, valor, colorClass }) => (
  <div className={`rounded-2xl p-4 ${colorClass}`}>
    <p className="text-xs font-medium opacity-70">{label}</p>
    <p className="text-2xl font-bold mt-1">{valor}</p>
  </div>
);

const UtilidadBadge = ({ valor, sinDato = false }) => {
  if (sinDato) {
    return (
      <span className="text-xs text-gray-400 italic flex items-center gap-1">
        <Info size={11} /> Sin costo
      </span>
    );
  }
  const positivo = valor >= 0;
  return (
    <span
      className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
        positivo
          ? 'bg-green-100 text-green-700'
          : 'bg-red-100 text-red-700'
      }`}
    >
      {positivo ? '+' : ''}{formatCOP(valor)}
    </span>
  );
};

const RangoFechas = ({ desde, hasta, onDesde, onHasta }) => (
  <div className="flex gap-3 items-end flex-wrap">
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-600">Desde</label>
      <input
        type="date"
        value={desde}
        onChange={(e) => onDesde(e.target.value)}
        className="px-3 py-2 bg-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-600">Hasta</label>
      <input
        type="date"
        value={hasta}
        onChange={(e) => onHasta(e.target.value)}
        className="px-3 py-2 bg-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  </div>
);

// ─────────────────────────────────────────────
// CELDA EDITABLE DE COSTO
// Se muestra solo para admin_negocio en la columna "Costo"
// ─────────────────────────────────────────────
const CeldaCostoEditable = ({ linea, onGuardado }) => {
  const [editando, setEditando]   = useState(false);
  const [valor, setValor]         = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError]         = useState(null);

  const costoActual = linea.costo_unitario_compra;

  const handleEditar = () => {
    setValor(costoActual !== null ? String(costoActual) : '');
    setError(null);
    setEditando(true);
  };

  const handleCancelar = () => {
    setEditando(false);
    setError(null);
  };

  const handleGuardar = async () => {
    const nuevoCosto = Number(valor);
    if (isNaN(nuevoCosto) || nuevoCosto < 0) {
      setError('Valor inválido');
      return;
    }

    setGuardando(true);
    setError(null);

    try {
      await actualizarCostoCompra({
        tipo:            linea.tipo_producto,
        imei:            linea.imei ?? null,
        nombre_producto: linea.imei ? null : linea.nombre_producto,
        nuevo_costo:     nuevoCosto,
      });

      setEditando(false);
      onGuardado(linea, nuevoCosto);
    } catch {
      setError('Error al guardar');
    } finally {
      setGuardando(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter')  handleGuardar();
    if (e.key === 'Escape') handleCancelar();
  };

  if (editando) {
    return (
      <div className="flex items-center gap-1 justify-end">
        <input
          type="number"
          min="0"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          className={`w-24 text-right text-xs px-2 py-1 border rounded-lg focus:outline-none focus:ring-2
            ${error ? 'border-red-400 focus:ring-red-300' : 'border-blue-400 focus:ring-blue-300'}`}
        />
        {guardando ? (
          <span className="text-xs text-gray-400 animate-pulse">...</span>
        ) : (
          <>
            <button
              onClick={handleGuardar}
              title="Guardar"
              className="text-green-600 hover:text-green-800 transition-colors"
            >
              <Check size={13} />
            </button>
            <button
              onClick={handleCancelar}
              title="Cancelar"
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X size={13} />
            </button>
          </>
        )}
        {error && (
          <span className="text-xs text-red-500 ml-1">{error}</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1 group">
      <span className="text-gray-500">
        {costoActual !== null
          ? formatCOP(costoActual)
          : <span className="text-gray-300 italic">N/A</span>
        }
      </span>
      <button
        onClick={handleEditar}
        title="Editar costo de compra"
        className="opacity-0 group-hover:opacity-100 transition-opacity text-blue-400 hover:text-blue-600"
      >
        <Pencil size={11} />
      </button>
    </div>
  );
};

// ─────────────────────────────────────────────
// FILA EXPANDIBLE DE FACTURA
// ─────────────────────────────────────────────
const FilaFactura = ({ factura, esAdmin }) => {
  const [expandida, setExpandida] = useState(false);

  // Estado local de líneas para recalcular utilidad sin refetch
  const [lineas, setLineas] = useState(factura.lineas);

  // Recalcula la utilidad neta de la factura a partir del estado local de líneas
  const utilidadNeta = (() => {
    const bruta = lineas.reduce(
      (acc, i) => (i.utilidad !== null ? acc + i.utilidad : acc),
      0,
    );
    return bruta - Number(factura.total_retomas);
  })();

  const tieneCostoIncompleto = lineas.some((i) => i.costo_unitario_compra === null);

  // Callback que recibe la línea editada y el nuevo costo, y actualiza el estado local
  const handleCostoGuardado = useCallback((lineaEditada, nuevoCosto) => {
    setLineas((prev) =>
      prev.map((l) => {
        // Para seriales: identificar por imei; para cantidad: por nombre_producto
        const esLaMisma = lineaEditada.imei
          ? l.imei === lineaEditada.imei
          : l.nombre_producto === lineaEditada.nombre_producto && !l.imei;

        if (!esLaMisma) return l;

        const costoTotal = nuevoCosto * l.cantidad;
        return {
          ...l,
          costo_unitario_compra: nuevoCosto,
          costo_total:           costoTotal,
          utilidad:              Number(l.subtotal) - costoTotal,
        };
      }),
    );
  }, []);

  const estadoVariant =
    factura.estado === 'Activa'   ? 'green'  :
    factura.estado === 'Credito'  ? 'yellow' : 'red';

  return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
      {/* Cabecera */}
      <button
        onClick={() => setExpandida((v) => !v)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">
              {factura.nombre_cliente}
            </p>
            <p className="text-xs text-gray-400">
              {formatFecha(factura.fecha)} · #{factura.id}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          <Badge variant={estadoVariant}>{factura.estado}</Badge>
          <div className="text-right hidden sm:block">
            <p className="text-sm font-bold text-gray-900">{formatCOP(factura.total_venta)}</p>
            {factura.total_retomas > 0 && (
              <p className="text-xs text-orange-500">-{formatCOP(factura.total_retomas)} retoma</p>
            )}
          </div>
          <div className="text-right hidden sm:block">
            <UtilidadBadge
              valor={utilidadNeta}
              sinDato={tieneCostoIncompleto && utilidadNeta === 0}
            />
          </div>
          {expandida
            ? <ChevronUp size={16} className="text-gray-400" />
            : <ChevronDown size={16} className="text-gray-400" />
          }
        </div>
      </button>

      {/* Totales en móvil */}
      <div className="flex items-center justify-between px-4 pb-2 sm:hidden">
        <span className="text-sm font-bold text-gray-900">{formatCOP(factura.total_venta)}</span>
        <UtilidadBadge
          valor={utilidadNeta}
          sinDato={tieneCostoIncompleto && utilidadNeta === 0}
        />
      </div>

      {/* Detalle de líneas */}
      {expandida && (
        <div className="border-t border-gray-100 px-4 py-3 flex flex-col gap-2 bg-gray-50">
          {/* Encabezado de la tabla */}
          <div className="grid grid-cols-12 gap-1 text-xs font-medium text-gray-400 pb-1 border-b border-gray-200">
            <span className="col-span-4">Producto</span>
            <span className="col-span-2 text-center">Cant.</span>
            <span className="col-span-2 text-right">Precio</span>
            <span className={`text-right ${esAdmin ? 'col-span-2' : 'col-span-2'}`}>
              Costo{esAdmin && <span className="text-blue-400 ml-0.5" title="Editable">✎</span>}
            </span>
            <span className="col-span-2 text-right">Utilidad</span>
          </div>

          {lineas.map((linea, idx) => {
            const sinCosto = linea.costo_unitario_compra === null;
            return (
              <div key={idx} className="grid grid-cols-12 gap-1 text-xs items-center py-1">
                <div className="col-span-4 min-w-0">
                  <p className="font-medium text-gray-700 truncate">{linea.nombre_producto}</p>
                  {linea.imei && (
                    <p className="text-gray-400 font-mono truncate">{linea.imei}</p>
                  )}
                </div>

                <span className="col-span-2 text-center text-gray-600">{linea.cantidad}</span>
                <span className="col-span-2 text-right text-gray-700">{formatCOP(linea.precio_venta)}</span>

                <span className="col-span-2 text-right">
                  {esAdmin ? (
                    <CeldaCostoEditable
                      linea={linea}
                      onGuardado={handleCostoGuardado}
                    />
                  ) : (
                    sinCosto
                      ? <span className="text-gray-300 italic">N/A</span>
                      : formatCOP(linea.costo_unitario_compra)
                  )}
                </span>

                <span className="col-span-2 text-right">
                  <UtilidadBadge valor={linea.utilidad} sinDato={sinCosto} />
                </span>
              </div>
            );
          })}

          {/* Totales de la factura */}
          <div className="border-t border-gray-200 pt-2 mt-1 flex flex-col gap-1">
            <div className="flex justify-between text-xs text-gray-600">
              <span>Total venta</span>
              <span className="font-semibold">{formatCOP(factura.total_venta)}</span>
            </div>
            {factura.total_retomas > 0 && (
              <div className="flex justify-between text-xs text-orange-600">
                <span>Retoma descontada</span>
                <span className="font-semibold">-{formatCOP(factura.total_retomas)}</span>
              </div>
            )}
            <div className="flex justify-between text-xs font-bold text-gray-800">
              <span>Utilidad neta</span>
              <UtilidadBadge
                valor={utilidadNeta}
                sinDato={tieneCostoIncompleto && utilidadNeta === 0}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────
// FILA DE PRODUCTO TOP (sin cambios)
// ─────────────────────────────────────────────
const FilaProducto = ({ producto, posicion }) => {
  const sinCosto = producto.costo_unitario_promedio === null;

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-3 flex items-center gap-3 shadow-sm">
      <span className="w-7 h-7 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0">
        {posicion}
      </span>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800 truncate">{producto.nombre_producto}</p>
        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
          <span className="text-xs text-gray-400">{producto.cantidad_vendida} vendido(s)</span>
          <span className="text-xs text-gray-400">
            Costo:{' '}
            {sinCosto ? (
              <span className="italic text-gray-300">Sin costo</span>
            ) : (
              <span className="font-medium text-gray-600">{formatCOP(producto.costo_unitario_promedio)}</span>
            )}
          </span>
          {producto.margen_porcentaje !== null && (
            <span
              className={`text-xs font-medium ${
                producto.margen_porcentaje >= 0 ? 'text-green-600' : 'text-red-500'
              }`}
            >
              {producto.margen_porcentaje.toFixed(1)}% margen
            </span>
          )}
        </div>
      </div>

      <div className="text-right flex-shrink-0">
        <p className="text-sm font-bold text-gray-900">{formatCOP(producto.total_ventas)}</p>
        {!sinCosto && <UtilidadBadge valor={producto.utilidad} />}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// PÁGINA PRINCIPAL
// ─────────────────────────────────────────────
export default function ReportesPage() {
  const [tabActiva, setTabActiva] = useState('resumen');
  const [desde, setDesde]         = useState(hoy);
  const [hasta, setHasta]         = useState(hoy);

  const { esAdminNegocio } = useAuth();
  const esAdmin = esAdminNegocio();

  const { data: dashboard, isLoading: loadingD } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => getDashboard().then((r) => r.data.data),
  });

  const { data: ventasData, isLoading: loadingV } = useQuery({
    queryKey: ['ventas-rango', desde, hasta],
    queryFn: () => getVentasRango(desde, hasta).then((r) => r.data.data),
    enabled: tabActiva === 'ventas',
  });

  const { data: topProductos, isLoading: loadingT } = useQuery({
    queryKey: ['productos-top', desde, hasta],
    queryFn: () => getProductosTop(desde, hasta).then((r) => r.data.data),
    enabled: tabActiva === 'productos',
  });

  const { data: stockBajo, isLoading: loadingS } = useQuery({
    queryKey: ['inventario-bajo'],
    queryFn: () => getInventarioBajo().then((r) => r.data.data),
    enabled: tabActiva === 'stock',
  });

  const facturas = ventasData?.facturas ?? [];
  const resumen  = ventasData?.resumen ?? null;

  return (
    <div className="flex flex-col gap-4">

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit overflow-x-auto max-w-full">
        {TABS.map((tab) => {
          const TabIcon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setTabActiva(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                transition-all whitespace-nowrap
                ${tabActiva === tab.id
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
                }`}
            >
              <TabIcon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── RESUMEN ── */}
      {tabActiva === 'resumen' && (
        loadingD ? <Spinner className="py-20" /> : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: 'Ventas hoy',          valor: formatCOP(dashboard?.ventas_hoy || 0),                                    colorClass: 'bg-green-50 text-green-700' },
                { label: 'Utilidad hoy',         valor: formatCOP(dashboard?.utilidad_hoy || 0),                                  colorClass: 'bg-emerald-50 text-emerald-700' },
                { label: 'Utilidad pendiente',   valor: formatCOP(dashboard?.utilidad_pendiente || 0),                            colorClass: 'bg-yellow-50 text-yellow-700' },
                { label: 'Facturas hoy',         valor: dashboard?.facturas_hoy || 0,                                             colorClass: 'bg-blue-50 text-blue-700' },
                { label: 'Préstamos activos',    valor: dashboard?.prestamos_activos?.cantidad || 0,                              colorClass: 'bg-indigo-50 text-indigo-700' },
                { label: 'Deuda préstamos',      valor: formatCOP(dashboard?.prestamos_activos?.deuda_total || 0),                colorClass: 'bg-red-50 text-red-700' },
                { label: 'Créditos activos',     valor: dashboard?.creditos_activos?.cantidad || 0,                               colorClass: 'bg-purple-50 text-purple-700' },
                { label: 'Deuda créditos',       valor: formatCOP(dashboard?.creditos_activos?.deuda_total || 0),                 colorClass: 'bg-rose-50 text-rose-700' },
              ].map((s) => (
                <MetricCard key={s.label} {...s} />
              ))}
            </div>

            {dashboard?.pagos_hoy?.length > 0 && (
              <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">
                  Pagos de hoy por método
                </h3>
                <div className="flex flex-col gap-2">
                  {dashboard.pagos_hoy.map((p) => (
                    <div key={p.metodo} className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">{p.metodo}</span>
                      <span className="text-sm font-bold text-gray-900">{formatCOP(p.total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      )}

      {/* ── VENTAS ── */}
      {tabActiva === 'ventas' && (
        <div className="flex flex-col gap-4">
          <RangoFechas
            desde={desde}
            hasta={hasta}
            onDesde={setDesde}
            onHasta={setHasta}
          />

          {loadingV ? <Spinner className="py-20" /> : (
            facturas.length === 0 ? (
              <EmptyState icon={TrendingUp} titulo="Sin ventas en este período" />
            ) : (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <MetricCard label="Total vendido"    valor={formatCOP(resumen.total_ventas)}          colorClass="bg-green-50 text-green-700" />
                  <MetricCard label="Utilidad neta"    valor={formatCOP(resumen.utilidad_neta_total)}   colorClass="bg-emerald-50 text-emerald-700" />
                  <MetricCard label="Utilidad pendiente" valor={formatCOP(resumen.utilidad_pendiente)} colorClass="bg-yellow-50 text-yellow-700" />
                  <MetricCard
                    label={`${resumen.total_facturas} factura(s)`}
                    valor={`${resumen.facturas_activas} activas · ${resumen.facturas_credito} crédito`}
                    colorClass="bg-blue-50 text-blue-700"
                  />
                </div>

                {resumen.total_retomas > 0 && (
                  <div className="flex items-center gap-2 bg-orange-50 border border-orange-100 rounded-xl px-4 py-2 text-sm text-orange-700">
                    <Info size={14} />
                    Retomas descontadas del período: <strong>{formatCOP(resumen.total_retomas)}</strong>
                  </div>
                )}

                {esAdmin && (
                  <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-2 text-xs text-blue-600">
                    <Pencil size={12} />
                    Puedes editar el costo de compra de cada línea pasando el cursor sobre la columna <strong>Costo</strong>.
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  {facturas.map((factura) => (
                    <FilaFactura
                      key={factura.id}
                      factura={factura}
                      esAdmin={esAdmin}
                    />
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      )}

      {/* ── PRODUCTOS ── */}
      {tabActiva === 'productos' && (
        <div className="flex flex-col gap-4">
          <RangoFechas
            desde={desde}
            hasta={hasta}
            onDesde={setDesde}
            onHasta={setHasta}
          />

          {loadingT ? <Spinner className="py-20" /> : (
            !topProductos?.length ? (
              <EmptyState icon={Package} titulo="Sin datos en este período" />
            ) : (
              <div className="flex flex-col gap-3">
                {(() => {
                  const totalVentas   = topProductos.reduce((s, p) => s + p.total_ventas, 0);
                  const totalUtilidad = topProductos.reduce((s, p) => p.utilidad !== null ? s + p.utilidad : s, 0);
                  const conSinCosto   = topProductos.some((p) => p.costo_unitario_promedio === null);
                  return (
                    <div className="grid grid-cols-2 gap-3">
                      <MetricCard
                        label="Total vendido (período)"
                        valor={formatCOP(totalVentas)}
                        colorClass="bg-blue-50 text-blue-700"
                      />
                      <div className="bg-emerald-50 text-emerald-700 rounded-2xl p-4">
                        <p className="text-xs font-medium opacity-70">
                          Utilidad productos{conSinCosto ? ' *' : ''}
                        </p>
                        <p className="text-2xl font-bold mt-1">{formatCOP(totalUtilidad)}</p>
                        {conSinCosto && (
                          <p className="text-xs opacity-60 mt-1">* Excluye productos sin costo registrado</p>
                        )}
                      </div>
                    </div>
                  );
                })()}

                <div className="flex flex-col gap-2">
                  {topProductos.map((producto, idx) => (
                    <FilaProducto
                      key={producto.nombre_producto}
                      producto={producto}
                      posicion={idx + 1}
                    />
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      )}

      {/* ── STOCK BAJO ── */}
      {tabActiva === 'stock' && (
        loadingS ? <Spinner className="py-20" /> : (
          !stockBajo?.length ? (
            <EmptyState
              icon={AlertTriangle}
              titulo="Todo el stock está bien"
              descripcion="No hay productos con stock bajo"
            />
          ) : (
            <div className="flex flex-col gap-2">
              {stockBajo.map((producto) => (
                <div
                  key={producto.id}
                  className="bg-white border border-gray-100 rounded-xl p-3 flex items-center justify-between shadow-sm"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-800">{producto.nombre}</p>
                    <p className="text-xs text-gray-400">
                      Mínimo: {producto.stock_minimo} · {producto.unidad_medida}
                    </p>
                    {producto.costo_unitario !== null && (
                      <p className="text-xs text-gray-400">
                        Costo: <span className="font-medium text-gray-600">{formatCOP(producto.costo_unitario)}</span>
                      </p>
                    )}
                  </div>
                  <Badge variant={producto.stock === 0 ? 'red' : 'yellow'}>
                    Stock: {producto.stock}
                  </Badge>
                </div>
              ))}
            </div>
          )
        )
      )}
    </div>
  );
}