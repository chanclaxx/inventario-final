import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CornerDownRight, Inbox, MapPin } from 'lucide-react';
import { Modal }  from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { moverAUbicacion } from '../../api/ubicaciones.api';
import { aplanarArbol, ICONOS_UBICACION, ICONO_POR_DEFECTO, claseColor } from '../../utils/ubicaciones';

// ─────────────────────────────────────────────────────────────────────────────
// Mover lo seleccionado a otra ubicación (o sacarlo de todas).
//
// Se manda la lista COMPLETA en una sola petición porque el backend la resuelve
// en una transacción: si un nodo de la lista no es válido, no puede quedar la
// mitad movida. Media mudanza en una bodega es peor que ninguna, porque nadie
// sabe cuál mitad se movió.
//
// "Quitar de la ubicación" es una opción de primera clase: devolver algo a la
// bandeja de "sin ubicar" tiene que ser tan fácil como sacarlo de ahí, o la
// gente deja de corregir sus errores y la lista se vuelve mentira.
// ─────────────────────────────────────────────────────────────────────────────

export function ModalMoverUbicacion({ open, onClose, items, arbol, origenId = null, onMovido }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState(null);

  const destinos = aplanarArbol(arbol).filter((u) => Number(u.id) !== Number(origenId));
  const total    = items?.length ?? 0;

  const mover = useMutation({
    mutationFn: (ubicacionId) => moverAUbicacion({
      ubicacion_id: ubicacionId,
      items: items.map((i) => ({ nivel: i.nivel, id: i.nodo_id })),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ubicaciones-arbol'] });
      queryClient.invalidateQueries({ queryKey: ['ubicaciones-items'] });
      queryClient.invalidateQueries({ queryKey: ['ubicaciones-sin-asignar'] });
      queryClient.invalidateQueries({ queryKey: ['ubicaciones'] });
      // El MutationCache global de main.jsx solo refresca reportes, así que el
      // historial hay que invalidarlo aquí o el movimiento recién hecho no
      // aparecería hasta recargar.
      queryClient.invalidateQueries({ queryKey: ['ubicaciones-movimientos'] });
      onMovido?.();
      onClose();
    },
    onError: (err) => {
      setError(err?.response?.data?.error ?? 'No se pudo mover');
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={total === 1 ? 'Mover 1 producto' : `Mover ${total} productos`}
    >
      <div className="p-5 flex flex-col gap-4">

        {total > 0 && (
          <div className="bg-gray-50 rounded-xl p-3 max-h-32 overflow-y-auto flex flex-col gap-1">
            {items.slice(0, 8).map((i) => (
              <p key={`${i.nivel}:${i.nodo_id}`} className="text-xs text-gray-600 truncate">
                {i.nombre}{i.detalle ? ` · ${i.detalle}` : ''}
              </p>
            ))}
            {total > 8 && (
              <p className="text-xs text-gray-400">y {total - 8} más…</p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-700">Mover a</span>

          <div className="flex flex-col gap-1 max-h-72 overflow-y-auto">
            {destinos.map((u) => {
              const Icn = ICONOS_UBICACION[u.tipo] ?? ICONO_POR_DEFECTO;
              return (
                <button
                  key={u.id}
                  type="button"
                  disabled={mover.isPending}
                  onClick={() => { setError(null); mover.mutate(Number(u.id)); }}
                  style={{ paddingLeft: `${12 + u.profundidad * 18}px` }}
                  className="flex items-center gap-2 pr-3 py-2.5 rounded-xl text-left
                    hover:bg-blue-50 transition-colors disabled:opacity-50"
                >
                  {u.profundidad > 0 && (
                    <CornerDownRight size={12} className="text-gray-300 flex-shrink-0" />
                  )}
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${claseColor(u.color)}`} />
                  <Icn size={15} className="text-gray-400 flex-shrink-0" />
                  <span className="text-sm text-gray-800 truncate">{u.nombre}</span>
                  <span className="text-xs text-gray-400 ml-auto flex-shrink-0">
                    {u.items_total}
                  </span>
                </button>
              );
            })}

            {!destinos.length && (
              <p className="text-sm text-gray-400 px-3 py-4 text-center">
                No hay otra ubicación creada todavía.
              </p>
            )}
          </div>
        </div>

        <button
          type="button"
          disabled={mover.isPending}
          onClick={() => { setError(null); mover.mutate(null); }}
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-left border
            border-dashed border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <Inbox size={15} className="text-gray-400 flex-shrink-0" />
          <span className="text-sm text-gray-700">Quitar de la ubicación</span>
          <span className="text-xs text-gray-400 ml-auto">vuelve a «Sin ubicar»</span>
        </button>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Chip de "aquí no hay nada" reutilizable por la lista y por el mapa. */
export function SinUbicacion() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-gray-400">
      <MapPin size={11} /> sin ubicar
    </span>
  );
}
