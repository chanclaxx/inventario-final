import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Bell, CheckCircle2, ChevronRight, RefreshCw,
  Wallet, Truck, ShieldCheck, PackageSearch, ClipboardCheck, Banknote,
  CreditCard, Layers, FileClock,
} from 'lucide-react';
import { getResumenAvisos } from '../../api/notificaciones.api';
import { Spinner }    from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { formatCOP }  from '../../utils/formatters';

// ─────────────────────────────────────────────────────────────────────────────
// AVISOS — el panel al que lleva el resumen del día
//
// ── De dónde salen estos datos ──────────────────────────────────────────────
// De `GET /notificaciones/resumen`, que es EXACTAMENTE el mismo motor que decide
// qué se notifica. No hay una consulta propia de esta pantalla, y eso es
// deliberado: si la pantalla calculara por su cuenta, el usuario abriría el
// resumen que le llegó al celular y encontraría algo distinto a lo que le
// avisaron. Un panel que contradice a la notificación destruye la confianza en
// las dos cosas a la vez.
//
// ── Por qué lo urgente va arriba y separado ─────────────────────────────────
// Es la misma división que usa el envío: lo urgente sonó solo, el resto llegó en
// un resumen. Si aquí se mezclaran, la pantalla estaría diciendo que todo pesa
// igual justo después de que la notificación dijo lo contrario.
//
// ── Lo que esta pantalla NO hace ────────────────────────────────────────────
// No resuelve nada. Cada tarjeta LLEVA al sitio donde se resuelve — la ficha del
// cliente, la orden, la entrada. Un panel que intente cobrar, confirmar y cerrar
// caja termina siendo una segunda versión peor de cuatro pantallas que ya
// existen.
// ─────────────────────────────────────────────────────────────────────────────

// El icono se saca por ACCESO A PROPIEDAD, nunca de una función: para el linter
// una llamada durante el render puede estar creando un componente nuevo cada vez
// (`react-hooks/static-components`).
const ICONOS = {
  cobros:      Wallet,
  proveedores: CreditCard,
  garantias:   ShieldCheck,
  pedidos:     Truck,
  entradas:    ClipboardCheck,
  caja:        Banknote,
  plan:        FileClock,
  borradores:  Layers,
  inventario:  PackageSearch,
};
const ICONO_POR_DEFECTO = Bell;

function Tarjeta({ senal }) {
  const urgente = senal.prioridad === 'urgente';
  // `const` en mayúscula en el cuerpo, no destructurando el parámetro del map:
  // no hay eslint-plugin-react, así que el uso en JSX no cuenta como referencia
  // y solo los `const` en mayúscula entran en `varsIgnorePattern`.
  const Icono = ICONOS[senal.categoria] ?? ICONO_POR_DEFECTO;

  return (
    <Link
      to={senal.url || '/'}
      className={`flex items-center gap-3 p-3.5 rounded-xl border transition-colors
        ${urgente
          ? 'border-red-200 bg-red-50/50 hover:bg-red-50'
          : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50/60'}`}
    >
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0
        ${urgente ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
        <Icono size={17} />
      </div>

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold truncate ${urgente ? 'text-red-900' : 'text-gray-800'}`}>
          {senal.titulo}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">{senal.cuerpo}</p>
      </div>

      {senal.valor > 0 && (
        <span className="text-sm font-semibold text-gray-700 tabular-nums flex-shrink-0 hidden sm:block">
          {formatCOP(senal.valor)}
        </span>
      )}
      <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
    </Link>
  );
}

export default function AvisosPage() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['avisos-resumen'],
    queryFn:  () => getResumenAvisos().then((r) => r.data.data),
    // Recorre cartera, proveedores, garantías y stock: no es una consulta barata
    // y su respuesta no cambia de un minuto a otro.
    staleTime: 2 * 60 * 1000,
  });

  const urgentes = data?.urgentes || [];
  const normales = data?.normales || [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Avisos</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Lo que el sistema encontró pendiente hoy.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 text-xs font-medium text-gray-500
                     hover:text-gray-800 transition-colors disabled:opacity-40"
        >
          <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
          Actualizar
        </button>
      </div>

      {isLoading ? <Spinner className="py-16" /> : isError ? (
        // Sin esto, un endpoint lento o caído se ve como "no tienes nada
        // pendiente" — que es la mentira más cara que puede decir esta pantalla.
        <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 flex items-start gap-2">
          <AlertTriangle size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-amber-800 font-medium">No se pudieron cargar los avisos</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Esto no significa que no haya nada pendiente. Vuelve a intentarlo.
            </p>
          </div>
        </div>
      ) : (urgentes.length === 0 && normales.length === 0) ? (
        <EmptyState
          icon={CheckCircle2}
          titulo="Todo al día"
          descripcion="No hay cobros vencidos, garantías por vencerse ni pedidos atrasados."
        />
      ) : (
        <>
          {urgentes.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-red-500 uppercase tracking-wide flex items-center gap-1.5">
                <AlertTriangle size={12} /> Para hoy
              </p>
              {urgentes.map((s) => <Tarjeta key={s.clave} senal={s} />)}
            </div>
          )}

          {normales.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                Cuando puedas
              </p>
              {normales.map((s) => <Tarjeta key={s.clave} senal={s} />)}
            </div>
          )}

          <p className="text-xs text-gray-400 text-center">
            Estos son los mismos avisos que llegan al celular. Lo urgente suena
            aparte; lo demás va en el resumen de la mañana.
          </p>
        </>
      )}
    </div>
  );
}
