import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Inbox, History, MapPin } from 'lucide-react';
import { Spinner }     from '../../components/ui/Spinner';
import { EmptyState }  from '../../components/ui/EmptyState';
import { getMovimientosUbicacion } from '../../api/ubicaciones.api';
import { useSucursalKey } from '../../hooks/useSucursalKey';
import { formatFechaHora } from '../../utils/formatters';
import { NIVELES } from '../../utils/ubicaciones';

// ─────────────────────────────────────────────────────────────────────────────
// "¿Quién movió esto, y de dónde?"
//
// `ubicaciones_items` guarda quién tocó por ÚLTIMA vez, pero no de dónde venía
// ni qué pasó antes. En una bodega con tres personas esa es justo la pregunta
// que aparece cuando algo no está donde debería.
//
// Muestra las DOS direcciones —lo que entró y lo que salió— porque filtrar solo
// por destino escondería exactamente el movimiento que se está buscando.
//
// Los nombres de las ubicaciones vienen CONGELADOS del backend, no de un JOIN:
// si alguien renombró el estante después, la línea sigue contando lo que pasó
// aquel día en vez de reescribir el pasado.
// ─────────────────────────────────────────────────────────────────────────────

// Un extremo del movimiento. `null` es "sin ubicar", y es un valor legítimo en
// los dos lados: sacar algo de un estante también es moverlo.
function Extremo({ nombre }) {
  if (!nombre) {
    return (
      <span className="inline-flex items-center gap-1 text-gray-400 italic">
        <Inbox size={11} />
        sin ubicar
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-gray-700">
      <MapPin size={11} className="text-gray-400" />
      {nombre}
    </span>
  );
}

export function HistorialUbicacion({ ubicacionId }) {
  const { sucursalKey, sucursalLista } = useSucursalKey();

  const { data: movimientos = [], isLoading } = useQuery({
    queryKey: ['ubicaciones-movimientos', ...sucursalKey, ubicacionId ?? 'todo'],
    queryFn:  () => getMovimientosUbicacion(
      ubicacionId ? { ubicacion_id: ubicacionId } : {}
    ).then((r) => r.data.data),
    enabled: sucursalLista,
    staleTime: 15_000,
  });

  if (isLoading) return <Spinner className="py-16" />;

  if (!movimientos.length) {
    return (
      <EmptyState
        icon={History}
        titulo="Todavía no hay movimientos"
        descripcion="Aquí aparecerá lo que entre y lo que salga de esta ubicación, con quién lo movió."
      />
    );
  }

  return (
    <div className="flex flex-col gap-0.5 p-1">
      {movimientos.map((m) => (
        <div key={m.id} className="px-3 py-2.5 rounded-xl hover:bg-gray-50 transition-colors">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-gray-900 min-w-0 truncate">
              {m.etiqueta || 'Producto eliminado'}
            </p>
            <span className="text-[11px] text-gray-400 flex-shrink-0 tabular-nums">
              {formatFechaHora(m.fecha)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 mt-1 text-xs">
            <Extremo nombre={m.desde_nombre} />
            <ArrowRight size={11} className="text-gray-300 flex-shrink-0" />
            <Extremo nombre={m.hacia_nombre} />

            {NIVELES[m.nivel] && (
              <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium
                ${NIVELES[m.nivel].clase}`}>
                {NIVELES[m.nivel].label}
              </span>
            )}

            {m.usuario_nombre && (
              <span className="text-[11px] text-gray-400 ml-auto">
                {m.usuario_nombre}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
