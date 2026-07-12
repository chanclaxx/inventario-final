import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ResponsiveContainer, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import {
  Target, Sliders, RotateCcw, Plus, Trash2, Check, Info, Wallet,
  FileDown, CheckCircle2, AlertTriangle, TrendingUp,
} from 'lucide-react';
import {
  getProyeccion, crearGastoFijo, actualizarGastoFijo, eliminarGastoFijo,
  exportarProyeccionPdf, invalidarReportes,
} from '../../api/reportes.api';
import { formatCOP } from '../../utils/formatters';
import { Spinner } from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { InputMoneda } from '../../components/ui/InputMoneda';

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

const labelMes = (periodo) => {
  const d = new Date(`${periodo}T00:00:00-05:00`);
  if (isNaN(d)) return periodo;
  return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', month: 'short', year: '2-digit' }).format(d);
};

const labelMesLargo = (periodo) => {
  const d = new Date(`${periodo}T00:00:00-05:00`);
  if (isNaN(d)) return periodo;
  const s = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', month: 'long', year: 'numeric' }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// Estado (semáforo) en lenguaje llano
const calcularEstado = ({ gastos, utilNeta, ventas, puntoEq }) => {
  if (gastos === 0) {
    return { tono: 'blue', titulo: 'Configura tus gastos fijos',
      mensaje: 'Agrega abajo tus gastos del mes (arriendo, nómina, servicios) para ver tu ganancia real y cuánto necesitas vender para no perder.' };
  }
  if (utilNeta < 0) {
    return { tono: 'red', titulo: 'Cuidado, estarías perdiendo',
      mensaje: 'Con este nivel de ventas no alcanzas a cubrir tus costos y gastos. Necesitas vender más o reducir gastos.' };
  }
  if (puntoEq !== null && ventas < puntoEq * 1.15) {
    return { tono: 'yellow', titulo: 'Vas justo',
      mensaje: 'Cubres tus costos y gastos, pero cualquier bajón en ventas te dejaría en pérdida.' };
  }
  return { tono: 'green', titulo: 'Vas por buen camino',
    mensaje: 'Tus ventas cubren la mercancía y los gastos, y te queda ganancia con un buen margen.' };
};

const TONO = {
  green:  { card: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-800', sub: 'text-emerald-600', icon: CheckCircle2 },
  yellow: { card: 'bg-amber-50 border-amber-200',     text: 'text-amber-800',   sub: 'text-amber-600',   icon: AlertTriangle },
  red:    { card: 'bg-red-50 border-red-200',         text: 'text-red-800',     sub: 'text-red-600',     icon: AlertTriangle },
  blue:   { card: 'bg-blue-50 border-blue-200',       text: 'text-blue-800',    sub: 'text-blue-600',    icon: Info },
};

// ─────────────────────────────────────────────
// PRIMITIVAS UI
// ─────────────────────────────────────────────
const Segmented = ({ value, onChange, options }) => (
  <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
    {options.map((opt) => {
      const activo = value === opt.value;
      return (
        <button key={opt.value} onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap
            ${activo ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          {opt.label}
        </button>
      );
    })}
  </div>
);

const ChartCard = ({ titulo, subtitulo, icon: Icon, color = 'text-blue-500', extra, children }) => (
  <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex flex-col gap-3">
    <div className="flex items-start justify-between gap-2 flex-wrap">
      <div>
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          {Icon && <Icon size={15} className={color} />}
          {titulo}
        </h3>
        {subtitulo && <p className="text-xs text-gray-400 mt-0.5">{subtitulo}</p>}
      </div>
      {extra}
    </div>
    {children}
  </div>
);

// Tarjeta de métrica con explicación en lenguaje simple
const MetricCard = ({ label, valor, colorClass, ayuda }) => (
  <div className={`rounded-2xl p-4 ${colorClass}`}>
    <p className="text-xs font-medium opacity-70">{label}</p>
    <p className="text-2xl font-bold mt-1 leading-tight">{valor}</p>
    {ayuda && <p className="text-xs opacity-70 mt-1">{ayuda}</p>}
  </div>
);

// Barra horizontal simple (para comparación de punto de equilibrio)
const BarraComparativa = ({ label, valor, max, colorBar, colorTxt }) => {
  const ancho = max > 0 ? Math.max(3, (valor / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500 w-40 flex-shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
        <div className={`h-full rounded-full ${colorBar} flex items-center justify-end pr-2`} style={{ width: `${ancho}%` }}>
        </div>
      </div>
      <span className={`text-sm font-bold w-28 text-right flex-shrink-0 ${colorTxt}`}>{formatCOP(valor)}</span>
    </div>
  );
};

// ─────────────────────────────────────────────
// TOOLTIP DE LA GRÁFICA (lenguaje llano)
// ─────────────────────────────────────────────
const TooltipVentas = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-800 mb-0.5">{d.mesLargo}</p>
      <p className={d.proyeccion ? 'text-purple-600' : 'text-blue-600'}>
        {d.proyeccion ? 'Proyección: ' : 'Ventas reales: '}
        <strong>{formatCOP(d.valor)}</strong>
      </p>
    </div>
  );
};

// ─────────────────────────────────────────────
// GRÁFICA DE BARRAS: meses reales + mes proyectado
// ─────────────────────────────────────────────
const GraficaVentas = ({ historial, periodoProyectado, ventasProyectadas, puntoEquilibrio }) => {
  const data = [
    ...historial.map((m) => ({ mes: labelMes(m.periodo), mesLargo: labelMesLargo(m.periodo), valor: m.ventas, proyeccion: false })),
    { mes: labelMes(periodoProyectado), mesLargo: labelMesLargo(periodoProyectado), valor: ventasProyectadas, proyeccion: true },
  ];

  return (
    <>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#94a3b8' }} />
          <YAxis tickFormatter={formatCompacto} tick={{ fontSize: 11, fill: '#94a3b8' }} width={54} />
          <Tooltip content={<TooltipVentas />} cursor={{ fill: '#f8fafc' }} />
          {puntoEquilibrio !== null && puntoEquilibrio > 0 && (
            <ReferenceLine
              y={puntoEquilibrio} stroke="#ef4444" strokeDasharray="5 4" strokeWidth={1.5}
              label={{ value: 'Mínimo para no perder', position: 'insideTopLeft', fill: '#ef4444', fontSize: 10, fontWeight: 600 }}
            />
          )}
          <Bar dataKey="valor" radius={[5, 5, 0, 0]} maxBarSize={54}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.proyeccion ? '#8b5cf6' : '#3b82f6'} fillOpacity={d.proyeccion ? 0.95 : 1} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Leyenda clara */}
      <div className="flex items-center justify-center gap-4 flex-wrap text-xs text-gray-500 pt-1">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-500" /> Meses pasados (real)</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-purple-500" /> Próximo mes (proyección)</span>
        {puntoEquilibrio !== null && puntoEquilibrio > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="w-4 border-t-2 border-dashed border-red-500" /> Punto de equilibrio
          </span>
        )}
      </div>
    </>
  );
};

// ─────────────────────────────────────────────
// "A DÓNDE VA CADA PESO" — barra apilada
// ─────────────────────────────────────────────
const DondeVaCadaPeso = ({ ventas, costo, gastos, utilNeta }) => {
  if (ventas <= 0) return null;
  const queda = Math.max(0, utilNeta);
  const seg = [
    { label: 'Mercancía',    valor: costo,  color: 'bg-amber-400',   chip: 'bg-amber-400' },
    { label: 'Gastos fijos', valor: gastos, color: 'bg-rose-400',    chip: 'bg-rose-400' },
    { label: 'Te queda',     valor: queda,  color: 'bg-emerald-500', chip: 'bg-emerald-500' },
  ];
  const de100Costo  = Math.round((costo / ventas) * 100);
  const de100Gastos = Math.round((gastos / ventas) * 100);
  const de100Queda  = 100 - de100Costo - de100Gastos;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex w-full h-8 rounded-lg overflow-hidden bg-gray-100">
        {seg.map((s, i) => {
          const w = (s.valor / ventas) * 100;
          if (w <= 0) return null;
          return <div key={i} className={s.color} style={{ width: `${w}%` }} title={`${s.label}: ${formatCOP(s.valor)}`} />;
        })}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {seg.map((s, i) => (
          <div key={i} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 text-gray-500">
              <span className={`w-3 h-3 rounded-sm ${s.chip}`} /> {s.label}
            </span>
            <span className="font-semibold text-gray-700">{formatCOP(s.valor)}</span>
          </div>
        ))}
      </div>
      <div className="bg-gray-50 border border-gray-100 rounded-xl px-3 py-2 text-xs text-gray-600">
        De cada <strong>$100</strong> que vendes: <strong className="text-amber-600">${de100Costo}</strong> se van en mercancía,{' '}
        <strong className="text-rose-600">${de100Gastos}</strong> en gastos fijos, y
        {de100Queda >= 0
          ? <> te quedan <strong className="text-emerald-600">${de100Queda}</strong> de ganancia.</>
          : <> te faltan <strong className="text-red-600">${Math.abs(de100Queda)}</strong> (estás en pérdida).</>}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// EDITOR DE GASTOS FIJOS
// ─────────────────────────────────────────────
const FilaGastoFijo = ({ gasto, onGuardar, onEliminar, guardando }) => {
  const [nombre, setNombre] = useState(gasto.nombre);
  const [valor,  setValor]  = useState(gasto.valor);
  const dirty  = nombre.trim() !== gasto.nombre || Number(valor) !== gasto.valor;
  const valido = nombre.trim() !== '' && valor !== '' && !isNaN(Number(valor)) && Number(valor) >= 0;

  return (
    <div className="flex items-center gap-2">
      <input value={nombre} onChange={(e) => setNombre(e.target.value)}
        className="flex-1 min-w-0 px-3 py-2 bg-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        placeholder="Concepto (arriendo, nómina…)" />
      <InputMoneda value={valor} onChange={setValor}
        className="w-32 px-3 py-2 bg-gray-100 rounded-xl text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
        placeholder="0" />
      {dirty && valido && (
        <button onClick={() => onGuardar(gasto.id, { nombre: nombre.trim(), valor: Number(valor) })}
          disabled={guardando} title="Guardar cambios"
          className="p-2 rounded-lg bg-green-100 text-green-700 hover:bg-green-200 transition-colors disabled:opacity-50">
          <Check size={15} />
        </button>
      )}
      <button onClick={() => onEliminar(gasto.id)} disabled={guardando} title="Eliminar"
        className="p-2 rounded-lg bg-gray-100 text-gray-400 hover:bg-red-100 hover:text-red-600 transition-colors disabled:opacity-50">
        <Trash2 size={15} />
      </button>
    </div>
  );
};

const GastosFijosEditor = ({ gastos, total, realesProm }) => {
  const queryClient = useQueryClient();
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoValor,  setNuevoValor]  = useState('');

  const onSettled = () => invalidarReportes(queryClient);
  const mCrear = useMutation({ mutationFn: (p) => crearGastoFijo(p),                    onSuccess: onSettled });
  const mEdit  = useMutation({ mutationFn: ({ id, ...p }) => actualizarGastoFijo(id, p), onSuccess: onSettled });
  const mDel   = useMutation({ mutationFn: (id) => eliminarGastoFijo(id),               onSuccess: onSettled });
  const guardando = mCrear.isPending || mEdit.isPending || mDel.isPending;

  const nuevoValido = nuevoNombre.trim() !== '' && nuevoValor !== '' && !isNaN(Number(nuevoValor)) && Number(nuevoValor) >= 0;
  const agregar = () => {
    if (!nuevoValido) return;
    mCrear.mutate({ nombre: nuevoNombre.trim(), valor: Number(nuevoValor) }, {
      onSuccess: () => { setNuevoNombre(''); setNuevoValor(''); },
    });
  };

  return (
    <ChartCard titulo="Tus gastos fijos del mes" icon={Wallet} color="text-rose-500"
      subtitulo="Lo que pagas cada mes vendas o no (arriendo, nómina, servicios). Se restan de tu ganancia."
      extra={<span className="text-sm font-bold text-gray-800 whitespace-nowrap">{formatCOP(total)}/mes</span>}
    >
      <div className="flex flex-col gap-2">
        {gastos.map((g) => (
          <FilaGastoFijo key={g.id} gasto={g} guardando={guardando}
            onGuardar={(id, p) => mEdit.mutate({ id, ...p })}
            onEliminar={(id) => mDel.mutate(id)} />
        ))}
        {gastos.length === 0 && (
          <p className="text-xs text-gray-400 py-1">Aún no has agregado gastos. Empieza por el arriendo o la nómina 👇</p>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-gray-100 pt-3">
        <input value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && agregar()}
          className="flex-1 min-w-0 px-3 py-2 bg-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Nuevo gasto (arriendo, nómina…)" />
        <InputMoneda value={nuevoValor} onChange={setNuevoValor}
          onKeyDown={(e) => e.key === 'Enter' && agregar()}
          className="w-32 px-3 py-2 bg-gray-100 rounded-xl text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="0" />
        <button onClick={agregar} disabled={!nuevoValido || guardando} title="Agregar gasto"
          className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          <Plus size={15} />
        </button>
      </div>

      {realesProm > 0 && (
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 text-xs text-blue-700">
          <Info size={13} className="flex-shrink-0 mt-0.5" />
          <span>Según Tesorería, tus gastos registrados promedian <strong>{formatCOP(realesProm)}/mes</strong>. Úsalo de referencia.</span>
        </div>
      )}
    </ChartCard>
  );
};

// ─────────────────────────────────────────────
// PANEL PRINCIPAL
// ─────────────────────────────────────────────
export default function PanelProyeccion() {
  const [meses, setMeses]         = useState('6');
  const [ventasAjuste, setAjuste] = useState(null);   // null = automático
  const [descargando, setDescargando] = useState(false);
  const [errorPdf, setErrorPdf]   = useState(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['proyeccion', meses],
    queryFn: () => getProyeccion(meses).then((r) => r.data.data),
  });

  const handlePdf = async () => {
    setDescargando(true); setErrorPdf(null);
    try {
      const res = await exportarProyeccionPdf(meses);
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `proyeccion-${data?.periodo_proyectado || ''}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setErrorPdf('No se pudo generar el PDF. Intenta de nuevo.');
    } finally {
      setDescargando(false);
    }
  };

  if (isLoading) return <Spinner className="py-20" />;
  if (isError) return (
    <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">
      Error al cargar la proyección. Intenta de nuevo.
    </div>
  );
  if (!data) return null;

  const base = data.proyeccion;
  const mes  = data.mes_en_curso;
  const sinDatos = !data.puede_proyectar;

  // Recálculo en vivo con el ajuste manual (parte siempre del promedio real).
  const ventas    = ventasAjuste ?? base.ventas_estimadas;
  const costo     = ventas * base.pct_costo;
  const utilBruta = ventas - costo;
  const gastos    = base.gastos_fijos;
  const utilNeta  = utilBruta - gastos;
  const margenContrib = ventas > 0 ? utilBruta / ventas : 0;
  const puntoEq   = margenContrib > 0 ? gastos / margenContrib : null;
  const ajustado  = ventasAjuste !== null;
  const mesTexto  = labelMesLargo(data.periodo_proyectado);

  const estado = calcularEstado({ gastos, utilNeta, ventas, puntoEq });
  const tono   = TONO[estado.tono];
  const EstadoIcon = tono.icon;

  return (
    <div className="flex flex-col gap-4">
      {/* Controles */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">Calcular con el promedio de</label>
          <Segmented value={meses} onChange={(v) => { setMeses(v); setAjuste(null); }}
            options={[
              { value: '3',  label: '3 meses'  },
              { value: '6',  label: '6 meses'  },
              { value: '12', label: '12 meses' },
            ]} />
        </div>
        <button onClick={handlePdf} disabled={descargando || sinDatos}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-gray-900 text-white
            hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed self-end">
          <FileDown size={16} />
          {descargando ? 'Generando…' : 'Descargar PDF'}
        </button>
      </div>

      {errorPdf && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">{errorPdf}</div>
      )}

      {sinDatos ? (
        <EmptyState icon={Target} titulo="Todavía no podemos proyectar"
          descripcion="Necesitas al menos un mes calendario cerrado con ventas registradas. Sigue vendiendo y vuelve el próximo mes." />
      ) : (
        <>
          {/* HERO: resumen en lenguaje llano + semáforo */}
          <div className={`border rounded-2xl p-5 flex flex-col gap-3 ${tono.card}`}>
            <div className="flex items-center gap-2">
              <EstadoIcon size={20} className={tono.sub} />
              <div>
                <p className={`text-base font-bold ${tono.text}`}>{estado.titulo}</p>
                <p className={`text-xs ${tono.sub}`}>Proyección para {mesTexto}</p>
              </div>
            </div>
            <p className={`text-sm leading-relaxed ${tono.text}`}>
              Esperamos que vendas alrededor de <strong>{formatCOP(ventas)}</strong>. Después de pagar la
              mercancía (<strong>−{formatCOP(costo)}</strong>) y tus gastos fijos (<strong>−{formatCOP(gastos)}</strong>),
              te quedaría una ganancia de <strong>{formatCOP(utilNeta)}</strong>.
            </p>
            <p className={`text-xs ${tono.sub}`}>{estado.mensaje}</p>
          </div>

          {/* Así vas este mes (usa los datos que ya hay del mes en curso) */}
          {mes.con_datos && (
            <div className="flex items-start gap-2 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2.5 text-sm text-indigo-700">
              <TrendingUp size={15} className="flex-shrink-0 mt-0.5" />
              <span>
                Llevas <strong>{formatCOP(mes.ventas)}</strong> vendidos en los primeros <strong>{mes.dias_transcurridos}</strong> días de {mesTexto}.
                Ya lo tuvimos en cuenta: proyectamos el cierre del mes con {mes.dias_restantes} día(s) por delante.
              </span>
            </div>
          )}

          {/* Métricas grandes con explicación simple */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard label="Esperas vender" valor={formatCOP(ventas)}
              colorClass="bg-blue-50 text-blue-700"
              ayuda={ajustado ? 'Ajustado por ti' : (mes.con_datos ? 'Cómo cerrará el mes' : `Promedio de ${data.meses_con_datos} mes(es)`)} />
            <MetricCard label="Te queda (ganancia)" valor={formatCOP(utilNeta)}
              colorClass={utilNeta >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}
              ayuda="Después de costos y gastos" />
            <MetricCard label="Para no perder" valor={puntoEq !== null ? formatCOP(puntoEq) : '—'}
              colorClass="bg-purple-50 text-purple-700"
              ayuda="Mínimo que debes vender" />
            <MetricCard label="De cada $100, te quedan" valor={`$${Math.round(margenContrib > 0 ? (utilNeta / ventas) * 100 : 0)}`}
              colorClass="bg-gray-100 text-gray-700"
              ayuda="Tu margen de ganancia" />
          </div>

          {/* Gráfica de barras */}
          <ChartCard titulo="¿Cómo vienen tus ventas?" icon={TrendingUp} color="text-blue-500"
            subtitulo="Las barras azules son meses que ya cerraron. La morada es cómo esperamos que cierre este mes.">
            <GraficaVentas
              historial={data.historial}
              periodoProyectado={data.periodo_proyectado}
              ventasProyectadas={ventas}
              puntoEquilibrio={puntoEq} />
          </ChartCard>

          {/* ¿Vas a ganar o a perder? */}
          {puntoEq !== null && (
            <ChartCard titulo="¿Vas a ganar o a perder?" icon={Target} color="text-purple-500"
              subtitulo="Compara lo que esperas vender contra el mínimo para no perder.">
              <div className="flex flex-col gap-3 pt-1">
                <BarraComparativa label="Mínimo para no perder" valor={puntoEq}
                  max={Math.max(ventas, puntoEq)} colorBar="bg-purple-500" colorTxt="text-purple-600" />
                <BarraComparativa label="Esperas vender" valor={ventas}
                  max={Math.max(ventas, puntoEq)} colorBar="bg-emerald-500" colorTxt="text-emerald-600" />
              </div>
              <div className={`rounded-xl px-3 py-2 text-xs mt-1 ${ventas >= puntoEq ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                {ventas >= puntoEq
                  ? <>Esperas vender <strong>{formatCOP(ventas - puntoEq)}</strong> por encima del mínimo. Ese colchón es tu margen de seguridad. ✓</>
                  : <>Te faltan <strong>{formatCOP(puntoEq - ventas)}</strong> de ventas para no perder. Enfócate en vender más o bajar gastos.</>}
              </div>
            </ChartCard>
          )}

          {/* A dónde va cada peso */}
          <ChartCard titulo="¿A dónde va cada peso que vendes?" icon={Wallet} color="text-amber-500"
            subtitulo="De todo lo que vendes, esto se va en mercancía, esto en gastos, y esto te queda.">
            <DondeVaCadaPeso ventas={ventas} costo={costo} gastos={gastos} utilNeta={utilNeta} />
          </ChartCard>

          {/* Ajuste manual */}
          <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Sliders size={15} className="text-blue-500" /> ¿Y si vendes más o menos?
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">Escribe un número y mira cómo cambia tu ganancia.</p>
              </div>
              {ajustado && (
                <button onClick={() => setAjuste(null)}
                  className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700">
                  <RotateCcw size={13} /> Volver al promedio
                </button>
              )}
            </div>
            <InputMoneda value={Math.round(ventas)}
              onChange={(v) => setAjuste(v === '' ? 0 : v)}
              className="w-full sm:w-56 px-3 py-2 bg-gray-100 rounded-xl text-base font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {/* Gastos fijos */}
          <GastosFijosEditor gastos={data.gastos_fijos} total={base.gastos_fijos} realesProm={data.gastos_reales_prom} />

          <p className="text-xs text-gray-400 px-1">
            Esta es una estimación basada en tu propio historial; no es una promesa. Los resultados reales dependen de tus ventas del mes.
          </p>
        </>
      )}
    </div>
  );
}
