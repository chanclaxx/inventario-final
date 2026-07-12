import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ResponsiveContainer, ComposedChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import {
  Target, TrendingUp, Scale, Sliders, RotateCcw,
  Plus, Trash2, Check, Info, Wallet,
} from 'lucide-react';
import {
  getProyeccion, crearGastoFijo, actualizarGastoFijo, eliminarGastoFijo, invalidarReportes,
} from '../../api/reportes.api';
import { formatCOP } from '../../utils/formatters';
import { Spinner } from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
const formatCompacto = (valor) => {
  const n = Number(valor) || 0;
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `$${Math.round(n / 1_000)}k`;
  return `$${n}`;
};

const labelPeriodo = (periodo) => {
  const d = new Date(`${periodo}T00:00:00-05:00`);
  if (isNaN(d)) return periodo;
  return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', month: 'short', year: '2-digit' }).format(d);
};

const pct = (x) => `${(Number(x) * 100).toFixed(1)}%`;

// ─────────────────────────────────────────────
// CONTROL SEGMENTADO (idéntico patrón a PanelAnalisis)
// ─────────────────────────────────────────────
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

const MetricCard = ({ label, valor, colorClass, sub }) => (
  <div className={`rounded-2xl p-4 ${colorClass}`}>
    <p className="text-xs font-medium opacity-70">{label}</p>
    <p className="text-2xl font-bold mt-1">{valor}</p>
    {sub && <p className="text-xs opacity-60 mt-1">{sub}</p>}
  </div>
);

// ─────────────────────────────────────────────
// FILA EDITABLE DE GASTO FIJO
// ─────────────────────────────────────────────
const FilaGastoFijo = ({ gasto, onGuardar, onEliminar, guardando }) => {
  const [nombre, setNombre] = useState(gasto.nombre);
  const [valor,  setValor]  = useState(String(gasto.valor));

  const dirty = nombre.trim() !== gasto.nombre || Number(valor) !== gasto.valor;
  const valido = nombre.trim() !== '' && !isNaN(Number(valor)) && Number(valor) >= 0;

  return (
    <div className="flex items-center gap-2">
      <input
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        className="flex-1 min-w-0 px-3 py-2 bg-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        placeholder="Concepto (arriendo, nómina…)"
      />
      <input
        type="number" min="0" value={valor}
        onChange={(e) => setValor(e.target.value)}
        className="w-32 px-3 py-2 bg-gray-100 rounded-xl text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
        placeholder="0"
      />
      {dirty && valido && (
        <button
          onClick={() => onGuardar(gasto.id, { nombre: nombre.trim(), valor: Number(valor) })}
          disabled={guardando}
          title="Guardar" className="p-2 rounded-lg bg-green-100 text-green-700 hover:bg-green-200 transition-colors disabled:opacity-50"
        >
          <Check size={15} />
        </button>
      )}
      <button
        onClick={() => onEliminar(gasto.id)}
        disabled={guardando}
        title="Eliminar" className="p-2 rounded-lg bg-gray-100 text-gray-400 hover:bg-red-100 hover:text-red-600 transition-colors disabled:opacity-50"
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
};

// ─────────────────────────────────────────────
// EDITOR DE GASTOS FIJOS
// ─────────────────────────────────────────────
const GastosFijosEditor = ({ gastos, total, realesProm }) => {
  const queryClient = useQueryClient();
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoValor,  setNuevoValor]  = useState('');

  const onSettled = () => invalidarReportes(queryClient);

  const mCrear = useMutation({ mutationFn: (p) => crearGastoFijo(p),        onSuccess: onSettled });
  const mEdit  = useMutation({ mutationFn: ({ id, ...p }) => actualizarGastoFijo(id, p), onSuccess: onSettled });
  const mDel   = useMutation({ mutationFn: (id) => eliminarGastoFijo(id),   onSuccess: onSettled });

  const guardando = mCrear.isPending || mEdit.isPending || mDel.isPending;

  const nuevoValido = nuevoNombre.trim() !== '' && !isNaN(Number(nuevoValor)) && Number(nuevoValor) >= 0;

  const agregar = () => {
    if (!nuevoValido) return;
    mCrear.mutate({ nombre: nuevoNombre.trim(), valor: Number(nuevoValor) }, {
      onSuccess: () => { setNuevoNombre(''); setNuevoValor(''); },
    });
  };

  return (
    <ChartCard titulo="Gastos fijos mensuales" icon={Wallet} color="text-rose-500"
      extra={<span className="text-sm font-bold text-gray-800">{formatCOP(total)}/mes</span>}
    >
      <p className="text-xs text-gray-400 -mt-1">
        Costos que pagas cada mes sin importar las ventas. Se restan de la utilidad para estimar tu ganancia real.
      </p>

      <div className="flex flex-col gap-2">
        {gastos.map((g) => (
          <FilaGastoFijo
            key={g.id} gasto={g} guardando={guardando}
            onGuardar={(id, p) => mEdit.mutate({ id, ...p })}
            onEliminar={(id) => mDel.mutate(id)}
          />
        ))}
      </div>

      {/* Agregar nuevo */}
      <div className="flex items-center gap-2 border-t border-gray-100 pt-3">
        <input
          value={nuevoNombre}
          onChange={(e) => setNuevoNombre(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && agregar()}
          className="flex-1 min-w-0 px-3 py-2 bg-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Nuevo gasto (arriendo, nómina…)"
        />
        <input
          type="number" min="0" value={nuevoValor}
          onChange={(e) => setNuevoValor(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && agregar()}
          className="w-32 px-3 py-2 bg-gray-100 rounded-xl text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="0"
        />
        <button
          onClick={agregar} disabled={!nuevoValido || guardando}
          title="Agregar gasto"
          className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus size={15} />
        </button>
      </div>

      {realesProm > 0 && (
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 text-xs text-blue-700">
          <Info size={13} className="flex-shrink-0 mt-0.5" />
          <span>
            Según Tesorería, tus gastos registrados promedian <strong>{formatCOP(realesProm)}/mes</strong>. Úsalo como referencia para ajustar los valores de arriba.
          </span>
        </div>
      )}
    </ChartCard>
  );
};

// ─────────────────────────────────────────────
// GRÁFICA: meses reales + mes proyectado (punteado)
// ─────────────────────────────────────────────
const GraficaProyeccion = ({ historial, periodoProyectado, ventasProyectadas }) => {
  const data = historial.map((m) => ({ periodo: m.periodo, ventas: m.ventas }));
  // Punto proyectado en línea punteada, conectado al último mes real.
  if (data.length) data[data.length - 1].proyeccion = data[data.length - 1].ventas;
  data.push({ periodo: periodoProyectado, proyeccion: ventasProyectadas });

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="periodo" tickFormatter={labelPeriodo} tick={{ fontSize: 11, fill: '#94a3b8' }} />
        <YAxis tickFormatter={formatCompacto} tick={{ fontSize: 11, fill: '#94a3b8' }} width={60} />
        <Tooltip
          formatter={(v, n) => [formatCOP(v), n === 'proyeccion' ? 'Proyección' : 'Ventas reales']}
          labelFormatter={labelPeriodo}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="ventas" name="Ventas reales" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
        <Line type="monotone" dataKey="proyeccion" name="Proyección" stroke="#8b5cf6" strokeWidth={2}
          strokeDasharray="5 5" dot={{ r: 4 }} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  );
};

// ─────────────────────────────────────────────
// PANEL PRINCIPAL
// ─────────────────────────────────────────────
export default function PanelProyeccion() {
  const [meses, setMeses]           = useState('6');
  const [ventasAjuste, setAjuste]   = useState(null); // null = automático

  const { data, isLoading, isError } = useQuery({
    queryKey: ['proyeccion', meses],
    queryFn: () => getProyeccion(meses).then((r) => r.data.data),
  });

  if (isLoading) return <Spinner className="py-20" />;
  if (isError) return (
    <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">
      Error al cargar la proyección. Intenta de nuevo.
    </div>
  );
  if (!data) return null;

  const base = data.proyeccion;
  const sinDatos = data.meses_con_datos === 0;

  // Recálculo en vivo con el ajuste manual (parte siempre del promedio real).
  const ventas   = ventasAjuste ?? base.ventas_estimadas;
  const costo    = ventas * base.pct_costo;
  const utilBruta = ventas - costo;
  const gastos   = base.gastos_fijos;
  const utilNeta = utilBruta - gastos;
  const margenContrib = ventas > 0 ? utilBruta / ventas : 0;
  const puntoEq  = margenContrib > 0 ? gastos / margenContrib : null;

  const ajustado = ventasAjuste !== null;

  return (
    <div className="flex flex-col gap-4">
      {/* Controles */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">Basado en</label>
          <Segmented
            value={meses} onChange={(v) => { setMeses(v); setAjuste(null); }}
            options={[
              { value: '3',  label: '3 meses'  },
              { value: '6',  label: '6 meses'  },
              { value: '12', label: '12 meses' },
            ]}
          />
        </div>
        <p className="text-xs text-gray-400 max-w-xs">
          Estimación del <strong className="text-gray-600">{labelPeriodo(data.periodo_proyectado)}</strong> según el
          promedio de {data.meses_con_datos} mes(es) con datos.
        </p>
      </div>

      {sinDatos ? (
        <EmptyState icon={Target} titulo="Aún no hay meses completos con ventas para proyectar"
          descripcion="Necesitas al menos un mes calendario cerrado con ventas registradas." />
      ) : (
        <>
          {/* Métricas principales */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard label="Ventas esperadas" valor={formatCOP(ventas)}
              colorClass="bg-blue-50 text-blue-700"
              sub={ajustado ? 'Ajustado manualmente' : `Promedio ${data.meses_con_datos} mes(es)`} />
            <MetricCard label="Costo esperado" valor={formatCOP(costo)}
              colorClass="bg-orange-50 text-orange-700" sub={`${pct(base.pct_costo)} de la venta`} />
            <MetricCard label="Utilidad neta esperada" valor={formatCOP(utilNeta)}
              colorClass={utilNeta >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}
              sub={`Margen ${pct(margenContrib > 0 ? utilNeta / ventas : 0)}`} />
            <MetricCard label="Punto de equilibrio"
              valor={puntoEq !== null ? formatCOP(puntoEq) : '—'}
              colorClass="bg-purple-50 text-purple-700"
              sub="Ventas mínimas para no perder" />
          </div>

          {/* Ajuste manual de ventas esperadas */}
          <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Sliders size={15} className="text-blue-500" /> Ajustar ventas esperadas
              </label>
              {ajustado && (
                <button onClick={() => setAjuste(null)}
                  className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700">
                  <RotateCcw size={13} /> Volver al promedio
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <input
                type="number" min="0"
                value={Math.round(ventas)}
                onChange={(e) => setAjuste(e.target.value === '' ? 0 : Number(e.target.value))}
                className="w-48 px-3 py-2 bg-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-xs text-gray-400">
                Cambia el estimado y el costo/utilidad se recalculan solos.
              </span>
            </div>
          </div>

          {/* Gráfica tendencia + proyección */}
          <ChartCard titulo="Ventas: histórico y proyección" icon={TrendingUp} color="text-blue-500">
            <GraficaProyeccion
              historial={data.historial}
              periodoProyectado={data.periodo_proyectado}
              ventasProyectadas={ventas}
            />
          </ChartCard>

          {/* Desglose de la utilidad esperada */}
          <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-1">
              <Scale size={15} className="text-emerald-500" /> Cómo se arma la utilidad
            </h3>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Ventas esperadas</span>
              <span className="font-medium text-gray-800">{formatCOP(ventas)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">− Costo de mercancía ({pct(base.pct_costo)})</span>
              <span className="font-medium text-orange-600">−{formatCOP(costo)}</span>
            </div>
            <div className="flex justify-between text-sm border-t border-gray-100 pt-2">
              <span className="text-gray-500">= Utilidad bruta</span>
              <span className="font-semibold text-gray-800">{formatCOP(utilBruta)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">− Gastos fijos</span>
              <span className="font-medium text-rose-600">−{formatCOP(gastos)}</span>
            </div>
            <div className="flex justify-between text-base border-t border-gray-200 pt-2 mt-1">
              <span className="font-semibold text-gray-700">= Utilidad neta</span>
              <span className={`font-bold ${utilNeta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {formatCOP(utilNeta)}
              </span>
            </div>
            {puntoEq !== null && (
              <div className="flex items-start gap-2 bg-purple-50 border border-purple-100 rounded-xl px-3 py-2 text-xs text-purple-700 mt-2">
                <Target size={13} className="flex-shrink-0 mt-0.5" />
                <span>
                  Necesitas vender al menos <strong>{formatCOP(puntoEq)}</strong> este mes para cubrir tus gastos fijos y no perder.
                </span>
              </div>
            )}
          </div>

          {/* Editor de gastos fijos */}
          <GastosFijosEditor
            gastos={data.gastos_fijos}
            total={base.gastos_fijos}
            realesProm={data.gastos_reales_prom}
          />
        </>
      )}
    </div>
  );
}
