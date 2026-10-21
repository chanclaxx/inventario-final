// El estado de resultados del mes: lo que dejaron las ventas, menos los gastos,
// más el ingreso financiero = lo que de verdad quedó. Se pide aparte porque
// arma Reportes → Ventas completo (es la MISMA utilidad bruta) y pesa más que
// el resto de la pestaña. Solo para el admin y quien ve todos los reportes.
import { useQuery } from '@tanstack/react-query';
import { Scale, Info } from 'lucide-react';
import { getEstadoResultados } from '../../../api/gastos.api';
import { formatCOP } from '../../../utils/formatters';
import { Spinner } from '../../../components/ui/Spinner';
import { nombreMes } from './gastosUi';

const Fila = ({ signo, texto, valor, fuerte, color = 'text-gray-800', sub }) => (
  <div className={`flex items-center justify-between gap-3 py-2 ${fuerte ? 'border-t border-gray-200 mt-1' : ''}`}>
    <div className="min-w-0">
      <p className={`text-sm ${fuerte ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
        {signo && <span className="inline-block w-4 text-gray-400">{signo}</span>}{texto}
      </p>
      {sub && <p className="text-[11px] text-gray-400 ml-4">{sub}</p>}
    </div>
    <p className={`whitespace-nowrap ${fuerte ? 'text-lg font-bold' : 'text-sm font-semibold'} ${color}`}>{formatCOP(valor)}</p>
  </div>
);

export function EstadoResultados({ mes }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['gastos', 'estado-resultados', mes],
    queryFn: () => getEstadoResultados(mes).then((r) => r.data.data),
  });

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
        <Scale size={15} className="text-blue-500" /> ¿Cuánto quedó de verdad?
      </h3>
      {isLoading && <Spinner className="py-8" />}
      {isError && <p className="text-sm text-red-600">No se pudo calcular el estado de resultados. Intenta de nuevo.</p>}
      {data && (() => {
        const ub = data.utilidad_bruta;
        const neta = data.utilidad_neta;
        const partes = [
          ['contado', 'ventas de contado'], ['creditos', 'créditos saldados'], ['prestamos', 'préstamos saldados'],
          ['servicios', 'servicios'], ['despachos', 'despachos cobrados'],
        ].filter(([k]) => ub.partes[k]).map(([k, t]) => `${t} ${formatCOP(ub.partes[k])}`).join(' · ');
        return (
          <>
            <div className={`rounded-2xl px-4 py-3 ${neta >= 0 ? 'bg-emerald-50' : 'bg-red-50'}`}>
              <p className={`text-xs ${neta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                Utilidad neta de {nombreMes(data.mes)}{data.parcial ? ' (hasta hoy)' : ''}
              </p>
              <p className={`text-3xl font-bold ${neta >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{formatCOP(neta)}</p>
              {data.gasto_por_cada_100 !== null && (
                <p className={`text-xs mt-1 ${neta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  De cada $100 que vendiste, <strong>${data.gasto_por_cada_100}</strong> se fueron en gastos.
                </p>
              )}
            </div>
            <div className="flex flex-col">
              <Fila texto="Lo que dejaron las ventas (utilidad bruta)" valor={ub.total} color="text-emerald-700" sub={partes || undefined} />
              <Fila signo="−" texto="Gastos fijos" valor={data.gastos.fijos} color="text-rose-600" />
              <Fila signo="−" texto="Gastos variables" valor={data.gastos.variables} color="text-rose-600" />
              <Fila signo="=" texto="Utilidad operacional" valor={data.utilidad_operacional} fuerte
                color={data.utilidad_operacional >= 0 ? 'text-gray-900' : 'text-red-600'} />
              {data.ingresos_financieros.total > 0 && (
                <Fila signo="+" texto="Mora e interés cobrados" valor={data.ingresos_financieros.total} color="text-blue-700" />
              )}
              <Fila signo="=" texto="Utilidad neta" valor={neta} fuerte color={neta >= 0 ? 'text-emerald-700' : 'text-red-600'} />
            </div>
            <p className="text-xs text-gray-400 flex items-start gap-1.5">
              <Info size={12} className="flex-shrink-0 mt-0.5" />
              La utilidad bruta es la misma de Reportes → Ventas (el crédito cuenta cuando se cobra). Los gastos son los de este mes contable.
              {ub.sin_costo > 0 ? ` ${ub.sin_costo} venta(s) sin costo registrado no suman utilidad.` : ''}
            </p>
          </>
        );
      })()}
    </div>
  );
}
