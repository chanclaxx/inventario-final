import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell,
} from 'recharts';
import {
  Users, Trophy, TrendingUp, Package, ChevronDown, ChevronUp,
  Info, ShoppingBag, BadgeCheck,
} from 'lucide-react';
import { getVentasPorVendedor } from '../../api/reportes.api';
import { formatCOP, formatFechaISO, fechaHoyBogota } from '../../utils/formatters';
import { Spinner }    from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { Badge }      from '../../components/ui/Badge';

const COLORES = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#ef4444', '#14b8a6'];

const formatCompacto = (valor) => {
  const n = Number(valor) || 0;
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `$${Math.round(n / 1_000)}k`;
  return `$${n}`;
};

const primerDiaMes = () => {
  const d = new Date();
  d.setDate(1);
  return formatFechaISO(d);
};

// ─── Control segmentado ───────────────────────────────────────────────────────
const Segmented = ({ value, onChange, options }) => (
  <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
    {options.map((opt) => {
      const activo = value === opt.value;
      return (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap
            ${activo ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          {opt.label}
        </button>
      );
    })}
  </div>
);

const MetricCard = ({ label, valor, colorClass, sub }) => (
  <div className={`rounded-2xl p-4 ${colorClass}`}>
    <p className="text-xs font-medium opacity-70">{label}</p>
    <p className="text-2xl font-bold mt-1">{valor}</p>
    {sub && <p className="text-xs opacity-60 mt-1">{sub}</p>}
  </div>
);

// ─── Gráfica de ranking (barras horizontales) ─────────────────────────────────
const GraficaRanking = ({ vendedores, criterio }) => {
  const dataKey = criterio === 'utilidad' ? 'utilidad' : 'total_vendido';
  const data = [...vendedores]
    .sort((a, b) => (Number(b[dataKey]) || 0) - (Number(a[dataKey]) || 0))
    .slice(0, 10)
    .map((v) => ({
      nombre:        v.vendedor_nombre || 'Sin nombre',
      total_vendido: v.total_vendido,
      utilidad:      v.utilidad,
    }));

  if (!data.length) return <EmptyState icon={Users} titulo="Sin datos de vendedores" />;

  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 44)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
        <XAxis type="number" tickFormatter={formatCompacto} tick={{ fontSize: 11, fill: '#94a3b8' }} />
        <YAxis
          type="category" dataKey="nombre" width={110}
          tick={{ fontSize: 11, fill: '#64748b' }}
          tickFormatter={(v) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)}
        />
        <Tooltip
          formatter={(valor) => formatCOP(valor)}
          labelStyle={{ fontWeight: 600 }}
        />
        <Bar dataKey={dataKey} name={criterio === 'utilidad' ? 'Utilidad' : 'Total vendido'} radius={[0, 4, 4, 0]}>
          {data.map((_, i) => <Cell key={i} fill={COLORES[i % COLORES.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

// ─── Fila expandible de vendedor ──────────────────────────────────────────────
const FilaVendedor = ({ vendedor, posicion }) => {
  const [expandida, setExpandida] = useState(false);
  const {
    vendedor_nombre, vendedor_activo, num_facturas, unidades,
    total_vendido, utilidad, margen_porcentaje, ticket_promedio,
    participacion, top_productos,
  } = vendedor;

  const medalla = posicion === 1 ? 'bg-amber-100 text-amber-700'
    : posicion === 2 ? 'bg-gray-200 text-gray-600'
    : posicion === 3 ? 'bg-orange-100 text-orange-700'
    : 'bg-blue-50 text-blue-600';

  return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
      <button
        onClick={() => setExpandida((v) => !v)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${medalla}`}>
            {posicion}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-gray-800 truncate">{vendedor_nombre || 'Sin nombre'}</p>
              {vendedor_activo === false && <Badge variant="red">Inactivo</Badge>}
            </div>
            <p className="text-xs text-gray-400">
              {num_facturas} factura(s) · {unidades} u. · ticket {formatCOP(ticket_promedio)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 ml-2">
          <div className="text-right">
            <p className="text-sm font-bold text-gray-900">{formatCOP(total_vendido)}</p>
            <p className="text-xs text-gray-400">{participacion.toFixed(1)}% del total</p>
          </div>
          {expandida ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </div>
      </button>

      {expandida && (
        <div className="border-t border-gray-100 px-4 py-3 flex flex-col gap-3 bg-gray-50">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <div className="bg-white rounded-lg p-2 border border-gray-100">
              <p className="text-xs text-gray-400">Vendido</p>
              <p className="text-sm font-bold text-gray-800">{formatCOP(total_vendido)}</p>
            </div>
            <div className="bg-white rounded-lg p-2 border border-gray-100">
              <p className="text-xs text-gray-400">Utilidad</p>
              <p className={`text-sm font-bold ${utilidad >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {formatCOP(utilidad)}
              </p>
            </div>
            <div className="bg-white rounded-lg p-2 border border-gray-100">
              <p className="text-xs text-gray-400">Margen</p>
              <p className="text-sm font-bold text-gray-800">
                {margen_porcentaje !== null ? `${margen_porcentaje.toFixed(1)}%` : '—'}
              </p>
            </div>
            <div className="bg-white rounded-lg p-2 border border-gray-100">
              <p className="text-xs text-gray-400">Ticket prom.</p>
              <p className="text-sm font-bold text-gray-800">{formatCOP(ticket_promedio)}</p>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
              <ShoppingBag size={12} /> Productos más vendidos
            </p>
            {top_productos.length === 0 ? (
              <p className="text-xs text-gray-400">Sin productos en el período.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {top_productos.map((p, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs bg-white rounded-lg px-3 py-1.5 border border-gray-100">
                    <span className="text-gray-700 truncate flex-1">{p.nombre_producto}</span>
                    <span className="text-gray-400 mx-2 flex-shrink-0">{p.cantidad} u.</span>
                    <span className="font-semibold text-gray-800 flex-shrink-0">{formatCOP(p.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Panel principal ──────────────────────────────────────────────────────────
export default function PanelVendedores() {
  const [desde, setDesde]     = useState(primerDiaMes);
  const [hasta, setHasta]     = useState(fechaHoyBogota);
  const [criterio, setCrit]   = useState('ventas');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['ventas-vendedor', desde, hasta],
    queryFn: () => getVentasPorVendedor(desde, hasta).then((r) => r.data.data),
  });

  const vendedores  = data?.vendedores  ?? [];
  const sinVendedor = data?.sin_vendedor ?? null;
  const totales     = data?.totales     ?? null;
  const activo      = data?.activo;

  return (
    <div className="flex flex-col gap-4">
      {/* Rango de fechas */}
      <div className="flex gap-3 items-end flex-wrap">
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
      </div>

      {isLoading && <Spinner className="py-20" />}
      {isError && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">
          Error al cargar el análisis por vendedor. Intenta de nuevo.
        </div>
      )}

      {!isLoading && !isError && activo === false && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-4 flex items-start gap-3">
          <BadgeCheck size={18} className="text-blue-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-700">
            <p className="font-semibold">La opción de vendedores está desactivada.</p>
            <p className="text-blue-600 mt-0.5">
              Actívala en <strong>Configuración → Equipo → Vendedores en facturas</strong> y asigna
              un vendedor a cada venta para ver aquí el análisis de desempeño.
            </p>
          </div>
        </div>
      )}

      {!isLoading && !isError && activo && vendedores.length === 0 && (
        <EmptyState icon={Users} titulo="Sin ventas con vendedor en el período seleccionado" />
      )}

      {!isLoading && !isError && activo && vendedores.length > 0 && (
        <>
          {/* Métricas */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard label="Total vendido" valor={formatCOP(totales.total_vendido)}
              colorClass="bg-blue-50 text-blue-700" sub={`${totales.num_facturas} factura(s)`} />
            <MetricCard label="Utilidad total" valor={formatCOP(totales.utilidad)}
              colorClass="bg-emerald-50 text-emerald-700" sub={`${totales.unidades} u. vendidas`} />
            <MetricCard label="Vendedores con ventas" valor={vendedores.length}
              colorClass="bg-purple-50 text-purple-700" />
            <MetricCard label="Mejor vendedor" valor={vendedores[0]?.vendedor_nombre || '—'}
              colorClass="bg-amber-50 text-amber-700" sub={formatCOP(vendedores[0]?.total_vendido || 0)} />
          </div>

          {/* Ranking */}
          <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Trophy size={15} className="text-amber-500" /> Ranking de vendedores
              </h3>
              <Segmented
                value={criterio} onChange={setCrit}
                options={[
                  { value: 'ventas',   label: 'Por ventas'   },
                  { value: 'utilidad', label: 'Por utilidad' },
                ]}
              />
            </div>
            <GraficaRanking vendedores={vendedores} criterio={criterio} />
          </div>

          {/* Detalle por vendedor */}
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <TrendingUp size={15} className="text-blue-500" /> Desempeño por vendedor
            </h3>
            {vendedores.map((v, idx) => (
              <FilaVendedor key={v.vendedor_id} vendedor={v} posicion={idx + 1} />
            ))}
          </div>

          {/* Facturas sin vendedor asignado */}
          {sinVendedor && sinVendedor.num_facturas > 0 && (
            <div className="flex items-start gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
              <Info size={15} className="text-gray-400 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-gray-500">
                <span className="font-semibold text-gray-600">{sinVendedor.num_facturas} factura(s)</span> sin
                vendedor asignado ({formatCOP(sinVendedor.total_vendido)}) — normalmente ventas anteriores a
                activar la opción. No se cuentan en el ranking.
              </div>
            </div>
          )}

          <p className="text-xs text-gray-400 flex items-center gap-1.5">
            <Package size={12} />
            La utilidad usa los costos registrados (faltantes se cuentan como 0). La retoma no se descuenta.
          </p>
        </>
      )}
    </div>
  );
}
