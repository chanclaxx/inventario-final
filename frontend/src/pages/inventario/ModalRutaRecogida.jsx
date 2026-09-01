import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Inbox, CornerDownRight, Route } from 'lucide-react';
import { Modal }      from '../../components/ui/Modal';
import { Button }     from '../../components/ui/Button';
import { Spinner }    from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { getArbolUbicaciones, ubicacionesDeItems } from '../../api/ubicaciones.api';
import { useSucursalKey } from '../../hooks/useSucursalKey';
import { nodoDeItemCarrito, agruparPorRuta, claveNodo } from '../../utils/ubicaciones';

// ─────────────────────────────────────────────────────────────────────────────
// Ruta de recogida — la lista del carrito ordenada por el recorrido de la bodega.
//
// En una bodega grande, juntar ocho productos en el orden en que se escribieron
// significa cruzarla ocho veces. Esta pantalla los agrupa por estante y ordena
// las paradas como se camina: se termina una bodega antes de pasar a la
// siguiente, y dentro de cada nivel se va de arriba abajo y de izquierda a
// derecha si el mapa está dibujado.
//
// Se cuelga del CARRITO y no de una pantalla propia porque el carrito ya es la
// lista compartida del sistema: lo llenan las ventas, los préstamos y los
// traslados. Una lista aparte obligaría a teclear otra vez lo que ya está
// escrito, y entonces nadie la usaría.
//
// Lo que NO tiene ubicación va en su propia parada AL FINAL: es lo que hay que
// buscar a ojo, y enterrarlo entre lo demás haría perder justo lo que más
// tiempo cuesta.
// ─────────────────────────────────────────────────────────────────────────────

export function ModalRutaRecogida({ open, onClose, items }) {
  const { sucursalKey, sucursalLista } = useSucursalKey();

  // Cada línea del carrito baja al nodo MÁS específico que traiga: si dice qué
  // talla se vende, la ruta lleva al cajón de esa talla y no al del producto.
  const nodos = useMemo(
    () => items.map((i) => ({ item: i, nodo: nodoDeItemCarrito(i) })).filter((n) => n.nodo),
    [items]
  );

  const { data: arbol = [] } = useQuery({
    queryKey: ['ubicaciones-arbol', ...sucursalKey],
    queryFn:  () => getArbolUbicaciones().then((r) => r.data.data),
    enabled:  open && sucursalLista,
    staleTime: 30_000,
  });

  const clavePeticion = nodos.map((n) => `${n.nodo.nivel}:${n.nodo.id}`).sort().join(',');

  const { data: sitios = [], isLoading } = useQuery({
    queryKey: ['ubicaciones-ruta', ...sucursalKey, clavePeticion],
    queryFn:  () => ubicacionesDeItems(nodos.map((n) => n.nodo)).then((r) => r.data.data),
    enabled:  open && sucursalLista && nodos.length > 0,
    staleTime: 30_000,
  });

  const paradas = useMemo(() => {
    const porNodo = new Map(sitios.map((s) => [`${s.nivel}:${s.nodo_id}`, s]));

    const lineas = nodos.map(({ item, nodo }) => {
      const sitio = porNodo.get(`${nodo.nivel}:${nodo.id}`);
      return {
        ...item,
        nivel:        nodo.nivel,
        nodo_id:      nodo.id,
        ubicacion_id: sitio?.ubicacion_id ?? null,
        heredada:     sitio?.heredada ?? false,
      };
    });

    return agruparPorRuta(lineas, arbol);
  }, [nodos, sitios, arbol]);

  const ubicados = paradas.filter((p) => p.ubicacion_id !== null).length;

  return (
    <Modal open={open} onClose={onClose} title="Ruta de recogida" size="lg">
      <div className="p-5 flex flex-col gap-4">

        {isLoading ? (
          <Spinner className="py-12" />
        ) : !nodos.length ? (
          <EmptyState
            icon={Route}
            titulo="No hay nada que recoger"
            descripcion="Agrega productos al carrito y aquí saldrá el recorrido para juntarlos."
          />
        ) : (
          <>
            <p className="text-sm text-gray-500">
              {ubicados === 0
                ? 'Ninguno de estos productos tiene ubicación todavía.'
                : `${ubicados} ${ubicados === 1 ? 'parada' : 'paradas'} en este recorrido.`}
            </p>

            <ol className="flex flex-col gap-3">
              {paradas.map((parada, i) => (
                <li
                  key={parada.ubicacion_id ?? 'sin-ubicar'}
                  className={`rounded-xl border overflow-hidden
                    ${parada.ubicacion_id === null
                      ? 'border-amber-200 bg-amber-50/40'
                      : 'border-gray-200'}`}
                >
                  <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-100">
                    {parada.ubicacion_id === null ? (
                      <>
                        <Inbox size={14} className="text-amber-600 flex-shrink-0" />
                        <span className="text-sm font-medium text-amber-800">
                          Sin ubicación — hay que buscarlos
                        </span>
                      </>
                    ) : (
                      <>
                        {/* El número de parada es información real: dice en qué
                            orden caminar, no decora. */}
                        <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[11px]
                          font-semibold flex items-center justify-center flex-shrink-0 tabular-nums">
                          {i + 1}
                        </span>
                        <MapPin size={13} className="text-gray-400 flex-shrink-0" />
                        <span className="text-sm font-medium text-gray-900 truncate">
                          {parada.ruta.length ? parada.ruta.join(' › ') : 'Ubicación eliminada'}
                        </span>
                      </>
                    )}
                    <span className="text-xs text-gray-400 ml-auto flex-shrink-0 tabular-nums">
                      {parada.items.length} {parada.items.length === 1 ? 'línea' : 'líneas'}
                    </span>
                  </div>

                  <div className="flex flex-col divide-y divide-gray-50">
                    {parada.items.map((it) => (
                      <div key={it.key ?? claveNodo(it)} className="flex items-center gap-3 px-3 py-2">
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm text-gray-900 truncate">{it.nombre}</span>
                          {(it.atributo_label || it.imei) && (
                            <span className="block text-xs text-gray-500 truncate">
                              {it.atributo_label}
                              {it.atributo_label && it.imei ? ' · ' : ''}
                              {it.imei}
                            </span>
                          )}
                          {/* Heredada = el sitio es el del producto, no el de
                              esta talla. Cambia lo que vas a encontrar al
                              llegar, así que se dice. */}
                          {it.heredada && (
                            <span className="flex items-center gap-1 text-[10px] text-gray-400">
                              <CornerDownRight size={9} />
                              ubicación del producto, no de esta variante
                            </span>
                          )}
                        </span>
                        <span className="text-sm font-semibold text-gray-900 tabular-nums flex-shrink-0">
                          ×{it.cantidad ?? 1}
                        </span>
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}

        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
