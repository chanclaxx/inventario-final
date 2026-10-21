// Las tres miradas visuales del mes: a dónde se fue la plata (por categoría),
// cómo vienen los últimos seis meses, y en qué días salió.
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from 'recharts';
import { PieChart as PieIcon, BarChart3, CalendarDays, ArrowUp, ArrowDown } from 'lucide-react';
import { formatCOP } from '../../../utils/formatters';
import {
  ICONOS_GASTO, ICONO_POR_DEFECTO, formatCompacto, mesCorto, nombreMes, diasDelMes, fechaLarga,
} from './gastosUi';

const Tarjeta = ({ titulo, subtitulo, icon: Icon, color, extra, children }) => (
  <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex flex-col gap-3">
    <div className="flex items-start justify-between gap-2 flex-wrap">
      <div>
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          {Icon && <Icon size={15} className={color} />} {titulo}
        </h3>
        {subtitulo && <p className="text-xs text-gray-400 mt-0.5">{subtitulo}</p>}
      </div>
      {extra}
    </div>
    {children}
  </div>
);

// Una variación que importa (±10 %) se dice con flecha y color; lo demás no.
export const Variacion = ({ pct, invertido = false, soloSubidas = false }) => {
  if (pct === null || pct === undefined || Math.abs(pct) < 10) return null;
  if (soloSubidas && pct < 0) return null;
  const sube = pct > 0;
  const malo = invertido ? !sube : sube;
  const Flecha = sube ? ArrowUp : ArrowDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${malo ? 'text-red-600' : 'text-emerald-600'}`}>
      <Flecha size={11} />{Math.abs(pct)}%
    </span>
  );
};

// En el mes en curso solo se marca lo que YA pasó del promedio: a mitad de mes
// todo va «por debajo» y esa flecha no dice nada.
export function ADondeSeFue({ resumen, filtro, onFiltro }) {
  const cats = resumen.por_categoria.filter((c) => c.total > 0);
  const sinGasto = resumen.por_categoria.filter((c) => c.total === 0 && c.presupuesto);
  const total = resumen.total || 1;
  const max = Math.max(...cats.map((c) => c.total), 1);

  return (
    <Tarjeta titulo="¿A dónde se fue la plata?" icon={PieIcon} color="text-rose-500"
      subtitulo={filtro ? 'Toca otra vez la categoría para quitar el filtro de la lista' : 'Toca una categoría para ver sus gastos'}>
      {cats.length === 0 ? (
        <p className="text-sm text-gray-400 py-2">Todavía no hay gastos en este mes.</p>
      ) : (
        <>
          <div className="flex h-4 rounded-full overflow-hidden bg-gray-100">
            {cats.map((c) => (
              <button key={c.categoria_id} type="button" title={`${c.nombre}: ${formatCOP(c.total)}`}
                onClick={() => onFiltro(filtro === c.categoria_id ? null : c.categoria_id)}
                style={{ width: `${(c.total / total) * 100}%`, backgroundColor: c.color || '#9CA3AF' }}
                className={`h-full transition-opacity ${filtro && filtro !== c.categoria_id ? 'opacity-30' : ''}`} />
            ))}
          </div>
          <div className="flex flex-col gap-1">
            {cats.map((c) => {
              const Icono = ICONOS_GASTO[c.icono] ?? ICONO_POR_DEFECTO;
              const activo = filtro === c.categoria_id;
              const pctMes = Math.round((c.total / total) * 100);
              return (
                <button key={c.categoria_id} type="button" onClick={() => onFiltro(activo ? null : c.categoria_id)}
                  className={`flex items-center gap-3 px-2 py-2 rounded-xl text-left transition-colors
                    ${activo ? 'bg-gray-100' : 'hover:bg-gray-50'} ${filtro && !activo ? 'opacity-50' : ''}`}>
                  <span className="w-7 h-7 rounded-full flex items-center justify-center text-white flex-shrink-0"
                    style={{ backgroundColor: c.color || '#9CA3AF' }}>
                    <Icono size={13} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-gray-700 truncate">
                        {c.nombre}
                        <span className="ml-1.5 text-[10px] uppercase tracking-wide text-gray-400">{c.tipo}</span>
                      </span>
                      <span className="flex items-center gap-1.5 flex-shrink-0">
                        <Variacion pct={c.variacion_pct} soloSubidas={resumen.es_mes_actual} />
                        <span className="text-sm font-semibold text-gray-900">{formatCOP(c.total)}</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(c.total / max) * 100}%`, backgroundColor: c.color || '#9CA3AF' }} />
                      </div>
                      <span className="text-[11px] text-gray-400 w-24 text-right">
                        {pctMes}%{c.presupuesto ? ` · de ${formatCompacto(c.presupuesto)}` : ''}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
      {sinGasto.length > 0 && (
        <p className="text-xs text-gray-400">
          Sin registrar todavía: {sinGasto.map((c) => `${c.nombre} (${formatCompacto(c.presupuesto)})`).join(', ')}.
        </p>
      )}
    </Tarjeta>
  );
}

export function SerieMeses({ serie, mes, onMes }) {
  const datos = serie.map((s) => ({ ...s, etiqueta: mesCorto(s.mes) }));
  return (
    <Tarjeta titulo="Últimos seis meses" icon={BarChart3} color="text-indigo-500"
      subtitulo="Toca un mes para verlo"
      extra={<span className="flex items-center gap-3 text-[11px] text-gray-500">
        <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-indigo-500" />Fijos</span>
        <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-amber-400" />Variables</span>
      </span>}>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={datos} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
            onClick={(e) => e?.activePayload?.[0] && onMes(e.activePayload[0].payload.mes)}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
            <XAxis dataKey="etiqueta" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={formatCompacto} tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} width={48} />
            <Tooltip formatter={(v, n) => [formatCOP(v), n === 'fijos' ? 'Fijos' : 'Variables']}
              labelFormatter={(_, p) => (p?.[0] ? nombreMes(p[0].payload.mes) : '')} cursor={{ fill: '#F9FAFB' }} />
            <Bar dataKey="fijos" stackId="g" radius={[0, 0, 0, 0]} style={{ cursor: 'pointer' }}>
              {datos.map((d) => <Cell key={d.mes} fill={d.mes === mes ? '#4F46E5' : '#A5B4FC'} />)}
            </Bar>
            <Bar dataKey="variables" stackId="g" radius={[6, 6, 0, 0]} style={{ cursor: 'pointer' }}>
              {datos.map((d) => <Cell key={d.mes} fill={d.mes === mes ? '#F59E0B' : '#FDE68A'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Tarjeta>
  );
}

// El mes como calendario: más oscuro el día que más salió. Semana de lunes.
export function CalendarioMes({ mes, gastos }) {
  const porDia = new Map();
  for (const g of gastos) {
    if (g.anulado) continue;
    porDia.set(g.fecha, (porDia.get(g.fecha) || 0) + g.valor_total);
  }
  const dias = diasDelMes(mes);
  const [y, m] = mes.split('-').map(Number);
  const primero = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // lunes = 0
  // Solo los gastos con FECHA en este mes (uno de octubre pagado en noviembre
  // es de octubre pero cae fuera del calendario).
  const valores = [...porDia.entries()].filter(([f]) => f.startsWith(mes)).map(([, v]) => v);
  const max = Math.max(...valores, 1);
  const celdas = [...Array(primero).fill(null), ...Array.from({ length: dias }, (_, i) => i + 1)];
  const fuera = gastos.filter((g) => !g.anulado && !g.fecha.startsWith(mes)).length;

  return (
    <Tarjeta titulo="Días en que salió plata" icon={CalendarDays} color="text-emerald-500"
      subtitulo={fuera ? `${fuera} gasto(s) de este mes se pagaron en otra fecha` : undefined}>
      <div className="grid grid-cols-7 gap-1 text-center">
        {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => (
          <span key={d} className="text-[10px] font-medium text-gray-400">{d}</span>
        ))}
        {celdas.map((d, i) => {
          if (!d) return <span key={`v${i}`} />;
          const fecha = `${mes}-${String(d).padStart(2, '0')}`;
          const v = porDia.get(fecha) || 0;
          const alfa = v ? 0.18 + 0.82 * (v / max) : 0;
          return (
            <span key={fecha} title={v ? `${fechaLarga(fecha)}: ${formatCOP(v)}` : fechaLarga(fecha)}
              className="aspect-square rounded-lg flex items-center justify-center text-[11px] font-medium"
              style={v
                ? { backgroundColor: `rgba(16, 185, 129, ${alfa})`, color: alfa > 0.55 ? '#fff' : '#065F46' }
                : { backgroundColor: '#F9FAFB', color: '#9CA3AF' }}>
              {d}
            </span>
          );
        })}
      </div>
    </Tarjeta>
  );
}
