import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, BarChart,
} from 'recharts';
import {
  LineChart as LineIcon, BarChart3, AreaChart as AreaIcon,
  TrendingUp, PieChart as PieIcon, CreditCard, Package, FileDown,
} from 'lucide-react';
import { getAnalisis, getProductosTop, exportarAnalisisPdf } from '../../api/reportes.api';
import { formatCOP, formatFechaISO, fechaHoyBogota } from '../../utils/formatters';
import { Spinner } from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
const COLORES = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#ef4444'];

// Formato compacto para ejes: $1.2M, $850k
const formatCompacto = (valor) => {
  const n = Number(valor) || 0;
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `$${Math.round(n / 1_000)}k`;
  return `$${n}`;
};

// Etiqueta del periodo según la agrupación
const labelPeriodo = (periodo, unit) => {
  // periodo = 'YYYY-MM-DD' (medianoche Colombia)
  const d = new Date(`${periodo}T00:00:00-05:00`);
  if (isNaN(d)) return periodo;
  if (unit === 'month') {
    return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', month: 'short', year: '2-digit' }).format(d);
  }
  return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short' }).format(d);
};

const seisMesesAtras = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 5);
  d.setDate(1);
  return formatFechaISO(d);
};

// ─────────────────────────────────────────────
// CONTROL SEGMENTADO (botones tipo toggle)
// ─────────────────────────────────────────────
const Segmented = ({ value, onChange, options }) => (
  <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
    {options.map((opt) => {
      const Icon = opt.icon;
      const activo = value === opt.value;
      return (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          title={opt.label}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap
            ${activo ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          {Icon && <Icon size={14} />}
          {opt.label}
        </button>
      );
    })}
  </div>
);

// ─────────────────────────────────────────────
// CARD CONTENEDORA DE GRÁFICA
// ─────────────────────────────────────────────
const ChartCard = ({ titulo, icon: Icon, color = 'text-blue-500', extra, children }) => (
  <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex flex-col gap-3">
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
        {Icon && <Icon size={15} className={color} />}
        {titulo}
      </h3>
      {extra}
    </div>
    {children}
  </div>
);

// ─────────────────────────────────────────────
// TOOLTIP TENDENCIA — total, utilidad, facturas, ticket
// ─────────────────────────────────────────────
const TooltipTendencia = ({ active, payload, unit }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-800 mb-1.5 capitalize">{labelPeriodo(d.periodo, unit)}</p>
      <div className="flex flex-col gap-1">
        <Linea color="#3b82f6" label="Total vendido" valor={formatCOP(d.total_vendido)} />
        <Linea color="#10b981" label="Utilidad" valor={formatCOP(d.utilidad)} />
        <Linea color="#f59e0b" label="Costo" valor={formatCOP(d.costo)} />
        <div className="border-t border-gray-100 mt-1 pt-1 flex flex-col gap-0.5 text-gray-500">
          <span>{d.num_facturas} factura(s)</span>
          <span>Ticket promedio: {formatCOP(d.ticket_promedio)}</span>
        </div>
      </div>
    </div>
  );
};

const Linea = ({ color, label, valor }) => (
  <div className="flex items-center justify-between gap-4">
    <span className="flex items-center gap-1.5 text-gray-600">
      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
    <span className="font-semibold text-gray-800">{valor}</span>
  </div>
);

// ─────────────────────────────────────────────
// GRÁFICA DE TENDENCIA
// ─────────────────────────────────────────────
const GraficaTendencia = ({ serie, unit, tipo, puntos }) => {
  const renderSerie = (dataKey, color, nombre) => {
    const common = { dataKey, name: nombre, stroke: color };
    if (tipo === 'barras') return <Bar key={dataKey} dataKey={dataKey} name={nombre} fill={color} radius={[4, 4, 0, 0]} />;
    if (tipo === 'area') {
      return (
        <Area key={dataKey} type="monotone" {...common}
          fill={color} fillOpacity={0.15} strokeWidth={2}
          dot={puntos ? { r: 3 } : false} activeDot={{ r: 5 }} />
      );
    }
    return (
      <Line key={dataKey} type="monotone" {...common}
        strokeWidth={2} dot={puntos ? { r: 3 } : false} activeDot={{ r: 5 }} />
    );
  };

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={serie} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="periodo" tickFormatter={(v) => labelPeriodo(v, unit)} tick={{ fontSize: 11, fill: '#94a3b8' }} />
        <YAxis tickFormatter={formatCompacto} tick={{ fontSize: 11, fill: '#94a3b8' }} width={60} />
        <Tooltip content={<TooltipTendencia unit={unit} />} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {renderSerie('total_vendido', '#3b82f6', 'Total vendido')}
        {renderSerie('utilidad', '#10b981', 'Utilidad')}
      </ComposedChart>
    </ResponsiveContainer>
  );
};

// ─────────────────────────────────────────────
// GRÁFICA DE TORTA GENÉRICA
// ─────────────────────────────────────────────
const GraficaTorta = ({ data, dataKey, nameKey }) => {
  const total = data.reduce((s, d) => s + d[dataKey], 0);
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={data} dataKey={dataKey} nameKey={nameKey}
          cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2}
        >
          {data.map((_, i) => <Cell key={i} fill={COLORES[i % COLORES.length]} />)}
        </Pie>
        <Tooltip
          formatter={(valor, nombre) => [
            `${formatCOP(valor)} (${total > 0 ? ((valor / total) * 100).toFixed(1) : 0}%)`,
            nombre,
          ]}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
};

// ─────────────────────────────────────────────
// GRÁFICA PRODUCTOS (barras horizontales)
// ─────────────────────────────────────────────
const GraficaProductos = ({ productos, criterio }) => {
  const dataKey = criterio === 'utilidad' ? 'utilidad' : 'cantidad_vendida';
  const data = productos
    .filter((p) => (criterio === 'utilidad' ? p.utilidad !== null : true))
    .sort((a, b) => (Number(b[dataKey]) || 0) - (Number(a[dataKey]) || 0))
    .slice(0, 8)
    .map((p) => ({ nombre: p.nombre_producto, utilidad: p.utilidad, cantidad_vendida: p.cantidad_vendida }));

  if (!data.length) return <EmptyState icon={Package} titulo="Sin datos de productos" />;

  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 42)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={criterio === 'utilidad' ? formatCompacto : undefined}
          tick={{ fontSize: 11, fill: '#94a3b8' }}
        />
        <YAxis
          type="category" dataKey="nombre" width={110}
          tick={{ fontSize: 11, fill: '#64748b' }}
          tickFormatter={(v) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)}
        />
        <Tooltip
          formatter={(valor) => (criterio === 'utilidad' ? formatCOP(valor) : `${valor} u.`)}
          labelStyle={{ fontWeight: 600 }}
        />
        <Bar
          dataKey={dataKey}
          name={criterio === 'utilidad' ? 'Utilidad' : 'Cantidad vendida'}
          radius={[0, 4, 4, 0]}
        >
          {data.map((_, i) => <Cell key={i} fill={COLORES[i % COLORES.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

// ─────────────────────────────────────────────
// PANEL PRINCIPAL
// ─────────────────────────────────────────────
export default function PanelAnalisis() {
  const [desde, setDesde]           = useState(seisMesesAtras);
  const [hasta, setHasta]           = useState(fechaHoyBogota);
  const [agrupacion, setAgrupacion] = useState('mes');
  const [tipoGrafica, setTipo]      = useState('barras');
  const [puntos, setPuntos]         = useState(true);
  const [critProductos, setCrit]    = useState('utilidad');
  const [exportando, setExportando] = useState(false);
  const [errorPdf, setErrorPdf]     = useState(null);
  const [detalleFacturas, setDetalleFacturas] = useState(false);

  const handleExportarPdf = async () => {
    setExportando(true);
    setErrorPdf(null);
    try {
      const res = await exportarAnalisisPdf(desde, hasta, agrupacion, detalleFacturas ? 'completo' : 'resumen');
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `reporte-gestion-${desde}_a_${hasta}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      let msg = 'No se pudo generar el PDF. Intenta de nuevo.';
      if (err.response?.data instanceof Blob) {
        try { msg = JSON.parse(await err.response.data.text()).error || msg; } catch { /* usa mensaje por defecto */ }
      }
      setErrorPdf(msg);
    } finally {
      setExportando(false);
    }
  };

  const { data: analisis, isLoading, isError } = useQuery({
    queryKey: ['analisis', desde, hasta, agrupacion],
    queryFn: () => getAnalisis(desde, hasta, agrupacion).then((r) => r.data.data),
  });

  const { data: productos } = useQuery({
    queryKey: ['productos-top', desde, hasta],
    queryFn: () => getProductosTop(desde, hasta).then((r) => r.data.data),
  });

  const serie        = analisis?.serie        ?? [];
  const composicion  = analisis?.composicion  ?? [];
  const metodosPago  = analisis?.metodos_pago ?? [];
  const unit         = analisis?.agrupacion   ?? 'month';

  return (
    <div className="flex flex-col gap-4">
      {/* Controles globales */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 flex-wrap">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
            className="px-3 py-2 bg-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
            className="px-3 py-2 bg-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">Agrupar por</label>
          <Segmented
            value={agrupacion} onChange={setAgrupacion}
            options={[
              { value: 'dia',    label: 'Día'    },
              { value: 'semana', label: 'Semana' },
              { value: 'mes',    label: 'Mes'    },
            ]}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:ml-auto">
          <label className="flex items-center gap-2 text-xs font-medium text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={detalleFacturas}
              onChange={(e) => setDetalleFacturas(e.target.checked)}
              className="rounded border-gray-300 text-gray-900 focus:ring-gray-400"
            />
            Detalle de facturas
          </label>
          <button
            onClick={handleExportarPdf}
            disabled={exportando}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-gray-900 text-white
              hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileDown size={16} />
            {exportando ? 'Generando…' : 'Exportar PDF'}
          </button>
        </div>
      </div>

      {errorPdf && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">
          {errorPdf}
        </div>
      )}

      {isLoading && <Spinner className="py-20" />}
      {isError && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">
          Error al cargar el análisis. Intenta de nuevo.
        </div>
      )}

      {!isLoading && !isError && (
        <>
          {/* Tendencia */}
          <ChartCard
            titulo="Tendencia de ventas y utilidad" icon={TrendingUp} color="text-blue-500"
            extra={
              <div className="flex items-center gap-2 flex-wrap">
                <Segmented
                  value={tipoGrafica} onChange={setTipo}
                  options={[
                    { value: 'barras', label: 'Barras', icon: BarChart3 },
                    { value: 'linea',  label: 'Línea',  icon: LineIcon  },
                    { value: 'area',   label: 'Área',   icon: AreaIcon  },
                  ]}
                />
                {tipoGrafica !== 'barras' && (
                  <button
                    onClick={() => setPuntos((v) => !v)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border
                      ${puntos ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-gray-50 text-gray-400 border-gray-200'}`}
                  >
                    Puntos
                  </button>
                )}
              </div>
            }
          >
            {serie.length === 0
              ? <EmptyState icon={TrendingUp} titulo="Sin ventas en el período seleccionado" />
              : <GraficaTendencia serie={serie} unit={unit} tipo={tipoGrafica} puntos={puntos} />}
          </ChartCard>

          {/* Composición + Métodos de pago */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard titulo="Composición de ingresos" icon={PieIcon} color="text-emerald-500">
              {composicion.length === 0
                ? <EmptyState icon={PieIcon} titulo="Sin ingresos en el período" />
                : <GraficaTorta data={composicion} dataKey="total" nameKey="fuente" />}
            </ChartCard>

            <ChartCard titulo="Ventas por método de pago" icon={CreditCard} color="text-purple-500">
              {metodosPago.length === 0
                ? <EmptyState icon={CreditCard} titulo="Sin pagos en el período" />
                : <GraficaTorta data={metodosPago} dataKey="total" nameKey="metodo" />}
            </ChartCard>
          </div>

          {/* Productos */}
          <ChartCard
            titulo="Productos destacados" icon={Package} color="text-amber-500"
            extra={
              <Segmented
                value={critProductos} onChange={setCrit}
                options={[
                  { value: 'utilidad', label: 'Por utilidad' },
                  { value: 'cantidad', label: 'Por cantidad' },
                ]}
              />
            }
          >
            {!productos?.length
              ? <EmptyState icon={Package} titulo="Sin datos de productos" />
              : <GraficaProductos productos={productos} criterio={critProductos} />}
          </ChartCard>
        </>
      )}
    </div>
  );
}
