// ─────────────────────────────────────────────────────────────────────────────
// Reportes → Gastos: el centro de gastos del mes contable.
//
// Arriba lo que se gastó y cómo va contra lo normal; al lado, registrar un
// gasto en segundos. Después los gastos fijos del mes (pagados / por vencer /
// vencidos), a dónde se fue la plata, cuánto quedó de verdad (estado de
// resultados), los últimos seis meses, el calendario y la lista.
//
// Todo lo calcula el backend (`/gastos/resumen`): esta pantalla solo pinta.
// Las claves de React Query empiezan por 'gastos' (REPORT_QUERY_KEYS).
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Receipt, Tags, Plus, PiggyBank } from 'lucide-react';
import { getResumenGastos, getGastos, registrarGasto } from '../../api/gastos.api';
import { invalidarReportes } from '../../api/reportes.api';
import { formatCOP } from '../../utils/formatters';
import { Spinner } from '../../components/ui/Spinner';
import useSucursalStore from '../../store/sucursalStore';
import { FormGasto } from './gastos/FormGasto';
import { PendientesMes } from './gastos/PendientesMes';
import { ADondeSeFue, SerieMeses, CalendarioMes, Variacion } from './gastos/VisualesGastos';
import { EstadoResultados } from './gastos/EstadoResultados';
import { ListaGastos } from './gastos/ListaGastos';
import { ModalCategorias, ModalRecurrentes } from './gastos/ModalesAdmin';
import { mesActual, sumarMes, nombreMes, mensajeError } from './gastos/gastosUi';

function RegistroRapido({ categorias, mes }) {
  const queryClient = useQueryClient();
  const [version, setVersion] = useState(0);
  const [ultimo, setUltimo] = useState(null);
  const m = useMutation({
    mutationFn: (datos) => registrarGasto(datos).then((r) => r.data.data),
    onSuccess: (g) => {
      invalidarReportes(queryClient);
      setUltimo(g);
      setVersion((v) => v + 1); // remonta el formulario: limpia y renueva la clave
    },
  });
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
        <Plus size={15} className="text-blue-500" /> Registrar un gasto
      </h3>
      {ultimo && (
        <p className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-1.5">
          ✓ Guardado: {formatCOP(ultimo.valor_total)} en {ultimo.categoria_nombre}
          {ultimo.mes_contable !== mes ? ` (queda en ${nombreMes(ultimo.mes_contable)})` : ''}.
        </p>
      )}
      <FormGasto key={version} categorias={categorias} mesVista={mes} guardando={m.isPending}
        error={m.isError ? mensajeError(m.error) : null} onGuardar={(d) => m.mutate(d)} />
    </div>
  );
}

function Encabezado({ r }) {
  const pendiente = r.pendientes.filter((p) => p.estado !== 'pagado').reduce((s, p) => s + p.valor, 0);
  const pctFijos = r.total > 0 ? Math.round((r.fijos / r.total) * 100) : 0;
  return (
    <div className="bg-gradient-to-br from-gray-900 to-gray-800 text-white rounded-2xl p-5 flex flex-col gap-3 shadow-sm">
      <div>
        <p className="text-sm text-gray-300">
          {r.es_mes_actual ? 'En lo que va del mes has gastado' : `En ${nombreMes(r.mes)} gastaste`}
        </p>
        <p className="text-4xl font-bold tracking-tight mt-0.5">{formatCOP(r.total)}</p>
        <p className="text-xs text-gray-400 mt-1">{r.cantidad} gasto{r.cantidad === 1 ? '' : 's'} registrado{r.cantidad === 1 ? '' : 's'}</p>
      </div>
      {r.total > 0 && (
        <>
          <div className="flex h-2 rounded-full overflow-hidden bg-white/10">
            <div className="bg-indigo-400" style={{ width: `${pctFijos}%` }} />
            <div className="bg-amber-400" style={{ width: `${100 - pctFijos}%` }} />
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-indigo-400" />Fijos {formatCOP(r.fijos)}</span>
            <span className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-amber-400" />Variables {formatCOP(r.variables)}</span>
          </div>
        </>
      )}
      <div className="flex flex-col gap-1 text-xs text-gray-300">
        {/* El mes en curso todavía no termina: compararlo contra meses enteros
            siempre daría «vas por debajo». Ahí solo se dice cómo es un mes normal. */}
        {r.promedio !== null && r.es_mes_actual && (
          <p>
            Un mes normal tuyo: <strong className="text-white">{formatCOP(r.promedio)}</strong>
            <span className="text-gray-500"> · promedio de {r.meses_promedio} mes{r.meses_promedio === 1 ? '' : 'es'}</span>
          </p>
        )}
        {r.promedio !== null && !r.es_mes_actual && (
          <p className="flex items-center gap-1.5">
            {r.variacion_pct !== null && Math.abs(r.variacion_pct) >= 1
              ? <>{r.variacion_pct > 0 ? 'Vas por encima' : 'Vas por debajo'} de tu promedio ({formatCOP(r.promedio)}){' '}
                  <span className="bg-white rounded px-1"><Variacion pct={r.variacion_pct} /></span></>
              : <>Igual que tu promedio ({formatCOP(r.promedio)}).</>}
            <span className="text-gray-500">· {r.meses_promedio === 1 ? 'el mes anterior' : `${r.meses_promedio} meses anteriores`}</span>
          </p>
        )}
        {pendiente > 0 && (
          <p>Faltan <strong className="text-white">{formatCOP(pendiente)}</strong> de gastos fijos por pagar en este mes.</p>
        )}
      </div>
    </div>
  );
}

export default function PanelGastos() {
  const [mes, setMes] = useState(mesActual);
  const [filtro, setFiltro] = useState(null);
  const [verAnulados, setVerAnulados] = useState(false);
  const [modal, setModal] = useState(null); // 'categorias' | 'recurrentes'
  // La sede va en las claves: cambiar de sede no puede mostrar la anterior.
  const sede = useSucursalStore((s) => s.sucursalActiva);

  const { data: r, isLoading, isError } = useQuery({
    queryKey: ['gastos', 'resumen', sede, mes],
    queryFn: () => getResumenGastos(mes).then((x) => x.data.data),
  });
  const { data: gastos = [] } = useQuery({
    queryKey: ['gastos', 'lista', sede, mes, verAnulados],
    queryFn: () => getGastos(mes, verAnulados).then((x) => x.data.data),
  });

  const esFuturo = mes > mesActual();
  const cambiarMes = (n) => { setMes((m) => sumarMes(m, n)); setFiltro(null); };

  return (
    <div className="flex flex-col gap-4">
      {/* Mes contable + accesos del admin */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
          <button type="button" onClick={() => cambiarMes(-1)} className="p-1.5 rounded-lg hover:bg-white" title="Mes anterior">
            <ChevronLeft size={16} />
          </button>
          <span className="px-3 text-sm font-semibold text-gray-800 min-w-[140px] text-center">{nombreMes(mes)}</span>
          <button type="button" onClick={() => cambiarMes(1)} className="p-1.5 rounded-lg hover:bg-white" title="Mes siguiente">
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          {mes !== mesActual() && (
            <button type="button" onClick={() => { setMes(mesActual()); setFiltro(null); }}
              className="text-xs font-medium text-blue-600 hover:text-blue-800">Ir al mes actual</button>
          )}
          {r?.permisos?.puede_administrar && (
            <>
              <button type="button" onClick={() => setModal('categorias')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50">
                <Tags size={13} /> Categorías
              </button>
              <button type="button" onClick={() => setModal('recurrentes')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50">
                <PiggyBank size={13} /> Gastos fijos
              </button>
            </>
          )}
        </div>
      </div>
      <p className="text-xs text-gray-400 -mt-2 flex items-center gap-1.5">
        <Receipt size={12} /> Lo que cuesta operar el negocio, por mes contable. La mercancía no va aquí: es el costo de lo vendido.
      </p>

      {isLoading && <Spinner className="py-20" />}
      {isError && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">
          No se pudieron cargar los gastos. Intenta de nuevo.
        </div>
      )}

      {r && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <div className="flex flex-col gap-4">
              <Encabezado r={r} />
              <PendientesMes resumen={r} puedeRegistrar={r.permisos.puede_registrar}
                puedeAdministrar={r.permisos.puede_administrar} onAdministrar={() => setModal('recurrentes')} />
            </div>
            <div className="flex flex-col gap-4">
              {r.permisos.puede_registrar && <RegistroRapido key={mes} categorias={r.categorias} mes={mes} />}
              <ADondeSeFue resumen={r} filtro={filtro} onFiltro={setFiltro} />
            </div>
          </div>

          {r.permisos.ve_resultados && !esFuturo && <EstadoResultados mes={mes} />}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2"><SerieMeses serie={r.serie} mes={mes} onMes={(m) => { setMes(m); setFiltro(null); }} /></div>
            <CalendarioMes mes={mes} gastos={gastos} />
          </div>

          <ListaGastos gastos={gastos} categorias={r.categorias} filtroCategoria={filtro}
            onQuitarFiltro={() => setFiltro(null)} verAnulados={verAnulados} onVerAnulados={setVerAnulados}
            puedeRegistrar={r.permisos.puede_registrar} />
        </>
      )}

      {modal === 'categorias' && <ModalCategorias onClose={() => setModal(null)} />}
      {modal === 'recurrentes' && r && <ModalRecurrentes categorias={r.categorias} onClose={() => setModal(null)} />}
    </div>
  );
}
